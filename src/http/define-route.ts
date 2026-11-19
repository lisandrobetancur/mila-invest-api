/**
 * `defineRoute`: registra una ruta de Fastify a partir de sus schemas Joi (§5).
 *
 * 1. Valida `body`, `querystring`, `params` y `headers` con Joi
 *    (`validatorCompiler` propio de la ruta).
 * 2. Convierte cada schema a JSON Schema con `joi-to-json` (variante OpenAPI)
 *    para que `@fastify/swagger` documente la ruta y para que
 *    `schema.response` filtre y serialice la respuesta.
 * 3. En `APP_ENV=test`, valida además la respuesta contra su schema Joi en un
 *    hook `onSend`: si no cumple, la respuesta pasa a ser `INTERNAL_ERROR`.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  RouteGenericInterface,
} from 'fastify';
import type Joi from 'joi';
import joiToJson from 'joi-to-json';
import { AppError, ERROR_CATALOG, type ErrorCode } from '../core/errors.js';
import { requireAuth } from './auth.js';
import { PROBLEM_CONTENT_TYPE } from './error-handler.js';
import {
  RESPONSE_JOI_OPTIONS,
  canonicalHeaderName,
  createJoiValidatorCompiler,
  type JoiSchemasByPart,
} from './joi-validator.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type JsonSchema = Record<string, unknown>;

/** `$id` del schema compartido de errores; se registra en `buildApp`. */
export const PROBLEM_SCHEMA_ID = 'Problem';

export interface RouteRateLimit {
  max: number;
  timeWindow: string | number;
  /** `preHandler` permite usar el cuerpo ya validado en `keyGenerator`. */
  hook?: 'onRequest' | 'preHandler';
  keyGenerator?: (request: FastifyRequest) => string;
}

export interface RouteSchemas {
  body?: Joi.ObjectSchema;
  querystring?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  headers?: Joi.ObjectSchema;
  /** Un único status de éxito con su schema; `null` para respuestas sin cuerpo (204). */
  response: Partial<Record<number, Joi.Schema | null>>;
}

export interface RouteDefinition<T extends RouteGenericInterface> {
  method: HttpMethod;
  url: string;
  auth: boolean;
  summary: string;
  description?: string;
  tags: readonly string[];
  schema: RouteSchemas;
  /** Códigos de error de negocio que puede devolver, para documentarlos. */
  errors?: readonly ErrorCode[];
  /** Límite propio de la ruta; `false` la excluye del rate limit. */
  rateLimit?: RouteRateLimit | false;
  handler: (request: FastifyRequest<T>, reply: FastifyReply) => Promise<T['Reply']> | T['Reply'];
}

/** Convierte un schema Joi a JSON Schema en su variante OpenAPI 3.0. */
export function toJsonSchema(schema: Joi.Schema): JsonSchema {
  const convert = joiToJson as unknown as (joi: Joi.Schema, mode: string) => unknown;
  return convert(schema, 'open-api') as JsonSchema;
}

/** En el OpenAPI los headers se documentan con su nombre canónico (`Idempotency-Key`). */
function headersJsonSchema(schema: Joi.Schema): JsonSchema {
  const json = toJsonSchema(schema);
  const properties = (json.properties ?? {}) as Record<string, unknown>;
  const required = (json.required ?? []) as string[];
  return {
    ...json,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, value]) => [canonicalHeaderName(name), value]),
    ),
    required: required.map(canonicalHeaderName),
    // Cualquier otro header está permitido (`allowUnknown: true`).
    additionalProperties: true,
  };
}

function problemResponse(codes: readonly ErrorCode[]): JsonSchema {
  return {
    description: codes.map((code) => `\`${code}\``).join(', '),
    content: {
      [PROBLEM_CONTENT_TYPE]: { schema: { $ref: `${PROBLEM_SCHEMA_ID}#` } },
    },
  };
}

function successStatusOf(response: RouteSchemas['response']): number {
  const statuses = Object.keys(response).map((key) => Number.parseInt(key, 10));
  const [status, ...rest] = statuses;
  if (status === undefined || rest.length > 0 || status < 200 || status > 299) {
    throw new Error('defineRoute: `schema.response` debe tener exactamente un status 2xx');
  }
  return status;
}

function buildFastifySchema<T extends RouteGenericInterface>(
  definition: RouteDefinition<T>,
  successStatus: number,
): FastifySchema {
  const { schema } = definition;
  const hasInput =
    schema.body !== undefined ||
    schema.querystring !== undefined ||
    schema.params !== undefined ||
    schema.headers !== undefined;

  const errorCodes = new Set<ErrorCode>(definition.errors ?? []);
  if (hasInput) errorCodes.add('VALIDATION_ERROR');
  if (definition.auth) {
    errorCodes.add('AUTH_TOKEN_INVALID');
    errorCodes.add('AUTH_TOKEN_EXPIRED');
  }
  if (schema.body !== undefined) errorCodes.add('PAYLOAD_TOO_LARGE');
  errorCodes.add('RATE_LIMITED');
  errorCodes.add('INTERNAL_ERROR');

  const codesByStatus = new Map<number, ErrorCode[]>();
  for (const code of errorCodes) {
    const status = ERROR_CATALOG[code].status;
    codesByStatus.set(status, [...(codesByStatus.get(status) ?? []), code]);
  }

  const successSchema = schema.response[successStatus];
  const response: Record<string, JsonSchema> = {
    [String(successStatus)]:
      successSchema === null || successSchema === undefined
        ? { description: 'Sin contenido', type: 'null' }
        : { description: 'Respuesta exitosa', ...toJsonSchema(successSchema) },
  };
  for (const [status, codes] of [...codesByStatus.entries()].sort(([a], [b]) => a - b)) {
    response[String(status)] = problemResponse(codes);
  }

  const fastifySchema: Record<string, unknown> = {
    summary: definition.summary,
    tags: [...definition.tags],
    response,
  };
  if (definition.description !== undefined) fastifySchema.description = definition.description;
  if (definition.auth) fastifySchema.security = [{ bearerAuth: [] }];
  if (schema.body !== undefined) fastifySchema.body = toJsonSchema(schema.body);
  if (schema.querystring !== undefined) {
    fastifySchema.querystring = toJsonSchema(schema.querystring);
  }
  if (schema.params !== undefined) fastifySchema.params = toJsonSchema(schema.params);
  if (schema.headers !== undefined) fastifySchema.headers = headersJsonSchema(schema.headers);
  return fastifySchema;
}

/** Valida el cuerpo ya serializado contra el schema Joi de la respuesta. */
export function findContractViolation(
  schema: Joi.Schema | null | undefined,
  payload: unknown,
): string | undefined {
  if (schema === null || schema === undefined) {
    const empty = payload === undefined || payload === null || payload === '';
    return empty ? undefined : 'se esperaba una respuesta sin cuerpo';
  }
  if (typeof payload !== 'string') return 'la respuesta no es JSON serializado';

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return 'la respuesta no es JSON válido';
  }
  const result = schema.validate(parsed, RESPONSE_JOI_OPTIONS);
  return result.error?.details.map((detail) => detail.message).join('; ');
}

export function defineRoute<T extends RouteGenericInterface = RouteGenericInterface>(
  app: FastifyInstance,
  definition: RouteDefinition<T>,
): void {
  const successStatus = successStatusOf(definition.schema.response);
  const responseSchema = definition.schema.response[successStatus];
  const validateResponses = app.services.config.appEnv === 'test';

  const joiSchemas: JoiSchemasByPart = {};
  if (definition.schema.body !== undefined) joiSchemas.body = definition.schema.body;
  if (definition.schema.querystring !== undefined) {
    joiSchemas.querystring = definition.schema.querystring;
  }
  if (definition.schema.params !== undefined) joiSchemas.params = definition.schema.params;
  if (definition.schema.headers !== undefined) joiSchemas.headers = definition.schema.headers;

  app.route({
    method: definition.method,
    url: definition.url,
    schema: buildFastifySchema(definition, successStatus),
    validatorCompiler: createJoiValidatorCompiler(joiSchemas),
    config: definition.rateLimit === undefined ? {} : { rateLimit: definition.rateLimit },
    ...(definition.auth ? { preParsing: requireAuth } : {}),
    ...(validateResponses
      ? {
          onSend: async (request, reply, payload: unknown) => {
            if (reply.statusCode !== successStatus) return payload;
            const violation = findContractViolation(responseSchema, payload);
            if (violation === undefined) return payload;

            request.log.error(
              { violation, method: definition.method, url: definition.url },
              'La respuesta no cumple su schema Joi',
            );
            const problem = new AppError('INTERNAL_ERROR', {
              detail: `Respuesta fuera de contrato: ${violation}`,
            }).toProblem();
            void reply.code(problem.status).type(`${PROBLEM_CONTENT_TYPE}; charset=utf-8`);
            return JSON.stringify(problem);
          },
        }
      : {}),
    handler: async (request, reply) => {
      const result = await definition.handler(request as FastifyRequest<T>, reply);
      void reply.code(successStatus);
      return result;
    },
  });
}
