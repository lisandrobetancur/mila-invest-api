/**
 * Error handler global: todo error sale como `application/problem+json` (§7.3).
 *
 * - `AppError` → su `code` y `status`;
 * - errores de Joi → `VALIDATION_ERROR` (422) con `errors[]` por campo, en
 *   reemplazo del 400 por defecto de Fastify;
 * - errores propios de Fastify (cuerpo muy grande, JSON malformado…) → el
 *   código del catálogo que corresponde;
 * - cualquier otro → `INTERNAL_ERROR`, sin stack trace en la respuesta.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isAppError, type ProblemDocument } from '../core/errors.js';
import { RequestValidationError, joiErrorToFieldErrors } from './joi-validator.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

interface ErrorWithStatus {
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as ErrorWithStatus).statusCode;
  return typeof status === 'number' ? status : undefined;
}

/** Traduce cualquier error a un `AppError` del catálogo. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof RequestValidationError) {
    return new AppError('VALIDATION_ERROR', {
      detail: 'La petición no cumple el contrato',
      fieldErrors: joiErrorToFieldErrors(error.joiError, error.part),
    });
  }

  const status = statusOf(error);
  if (status === 413) {
    return new AppError('PAYLOAD_TOO_LARGE', { detail: 'El cuerpo supera el máximo de 64 KB' });
  }
  if (status === 404) return new AppError('NOT_FOUND');
  if (status === 429) return new AppError('RATE_LIMITED');
  if (status !== undefined && status >= 400 && status < 500) {
    // JSON malformado, content-type no soportado, cuerpo vacío, etc.
    return new AppError('VALIDATION_ERROR', {
      detail: 'El cuerpo de la petición no se pudo interpretar',
      fieldErrors: [{ field: 'body', code: 'INVALID_FORMAT' }],
    });
  }

  return new AppError('INTERNAL_ERROR', { cause: error });
}

export function sendProblem(reply: FastifyReply, problem: ProblemDocument): FastifyReply {
  return reply.code(problem.status).type(`${PROBLEM_CONTENT_TYPE}; charset=utf-8`).send(problem);
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply) => {
    const appError = toAppError(error);

    if (appError.status >= 500) {
      request.log.error({ err: error, code: appError.code }, 'Error no controlado');
    } else {
      request.log.info({ code: appError.code, status: appError.status }, 'Petición rechazada');
    }

    if (appError.headers !== undefined) {
      for (const [name, value] of Object.entries(appError.headers)) {
        void reply.header(name, value);
      }
    }
    return sendProblem(reply, appError.toProblem());
  });

  app.setNotFoundHandler((request, reply) => {
    const appError = new AppError('NOT_FOUND', {
      detail: `No existe la ruta ${request.method} ${request.url.split('?')[0] ?? ''}`,
    });
    return sendProblem(reply, appError.toProblem());
  });
}
