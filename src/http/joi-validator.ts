/**
 * `validatorCompiler` de Fastify basado en Joi (§5).
 *
 * Joi es la única fuente de validación de entrada. Cada parte de la petición
 * se valida con sus propias opciones, y el validador **devuelve el valor
 * validado** (con defaults y normalizaciones), que es el que recibe el handler.
 */
import type { FastifySchemaCompiler } from 'fastify';
import type Joi from 'joi';
import type { FieldError, FieldErrorCode } from '../core/errors.js';

export const HTTP_PARTS = ['body', 'querystring', 'params', 'headers'] as const;
export type HttpPart = (typeof HTTP_PARTS)[number];

export const JOI_OPTIONS: Readonly<Record<HttpPart, Joi.ValidationOptions>> = Object.freeze({
  body: { abortEarly: false, allowUnknown: false, convert: false },
  // Los valores de la URL siempre llegan como string: se convierten a número o booleano.
  querystring: { abortEarly: false, allowUnknown: false, convert: true },
  params: { abortEarly: false, allowUnknown: false, convert: true },
  headers: { abortEarly: false, allowUnknown: true, convert: true },
});

/** Opciones con las que se valida una **respuesta** en `APP_ENV=test`. */
export const RESPONSE_JOI_OPTIONS: Readonly<Joi.ValidationOptions> = Object.freeze({
  abortEarly: false,
  allowUnknown: false,
  convert: false,
});

/** Error de validación de una parte de la petición; lo traduce el error handler. */
export class RequestValidationError extends Error {
  public constructor(
    public readonly part: HttpPart,
    public readonly joiError: Joi.ValidationError,
  ) {
    super(joiError.message);
    this.name = 'RequestValidationError';
  }
}

const TYPE_TO_CODE: Readonly<Record<string, FieldErrorCode>> = Object.freeze({
  'any.required': 'REQUIRED',
  'string.empty': 'REQUIRED',
  'string.base': 'INVALID_FORMAT',
  'number.base': 'INVALID_FORMAT',
  'boolean.base': 'INVALID_FORMAT',
  'string.pattern.base': 'INVALID_FORMAT',
  'string.email': 'INVALID_FORMAT',
  'string.guid': 'INVALID_FORMAT',
  'date.format': 'INVALID_FORMAT',
  'number.integer': 'INVALID_FORMAT',
  'string.min': 'TOO_SHORT',
  'string.max': 'TOO_LONG',
  'number.min': 'TOO_SMALL',
  'number.greater': 'TOO_SMALL',
  'number.positive': 'TOO_SMALL',
  'number.max': 'TOO_LARGE',
  'number.less': 'TOO_LARGE',
  'any.only': 'NOT_ALLOWED',
  'object.unknown': 'NOT_ALLOWED',
  'any.invalid': 'NOT_ALLOWED',
});

/** Mapeo de tipos de error de Joi a `errors[].code` (§5). Cualquier otro → `INVALID_FORMAT`. */
export function mapJoiErrorType(type: string): FieldErrorCode {
  return TYPE_TO_CODE[type] ?? 'INVALID_FORMAT';
}

/** `idempotency-key` → `Idempotency-Key`. */
export function canonicalHeaderName(name: string): string {
  return name
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join('-');
}

/**
 * Convierte un error de Joi en `errors[]`. El `field` es la ruta del campo
 * unida con puntos (`items.0.quantity`); en headers, el nombre del header.
 */
export function joiErrorToFieldErrors(error: Joi.ValidationError, part: HttpPart): FieldError[] {
  const seen = new Set<string>();
  const fieldErrors: FieldError[] = [];
  for (const detail of error.details) {
    const path = detail.path.map(String).join('.');
    const field = part === 'headers' ? canonicalHeaderName(path) : path.length > 0 ? path : part;
    const code = mapJoiErrorType(detail.type);
    const key = `${field}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fieldErrors.push({ field, code });
  }
  return fieldErrors;
}

export type JoiSchemasByPart = Partial<Record<HttpPart, Joi.Schema>>;

function isHttpPart(value: string | undefined): value is HttpPart {
  return (HTTP_PARTS as readonly string[]).includes(value ?? '');
}

/**
 * Crea el `validatorCompiler` de una ruta. Fastify le pasa el JSON Schema que
 * documenta la ruta, pero la validación real la hace el schema Joi de la parte.
 */
export function createJoiValidatorCompiler(
  schemas: JoiSchemasByPart,
): FastifySchemaCompiler<unknown> {
  return ({ httpPart }) => {
    const part = isHttpPart(httpPart) ? httpPart : undefined;
    const schema = part === undefined ? undefined : schemas[part];
    if (part === undefined || schema === undefined) {
      return (data: unknown) => ({ value: data });
    }
    return (data: unknown) => {
      // Un body ausente se valida como objeto vacío: así cada campo obligatorio
      // responde `REQUIRED` en vez de un error genérico sobre el cuerpo.
      const input = data ?? {};
      const result = schema.validate(input, JOI_OPTIONS[part]);
      if (result.error !== undefined) {
        return { error: new RequestValidationError(part, result.error) };
      }
      return { value: result.value as unknown };
    };
  };
}
