import Joi from 'joi';
import { describe, expect, it } from 'vitest';
import type { FieldErrorCode } from '../../src/core/errors.js';
import { findContractViolation } from '../../src/http/define-route.js';
import { toAppError } from '../../src/http/error-handler.js';
import {
  JOI_OPTIONS,
  RequestValidationError,
  canonicalHeaderName,
  createJoiValidatorCompiler,
  joiErrorToFieldErrors,
  mapJoiErrorType,
  type HttpPart,
} from '../../src/http/joi-validator.js';

type Validator = (data: unknown) => { value?: unknown; error?: unknown };

function compile(part: HttpPart | 'other', schema?: Joi.Schema): Validator {
  const compiler = createJoiValidatorCompiler(schema === undefined ? {} : { [part]: schema });
  return compiler({ schema: {}, method: 'POST', url: '/x', httpPart: part }) as Validator;
}

/** Valida `value` con las opciones del body y devuelve el tipo del primer error de Joi. */
function joiTypeOf(schema: Joi.Schema, value: unknown): string | undefined {
  return schema.validate(value, JOI_OPTIONS.body).error?.details[0]?.type;
}

describe('mapeo de tipos de error de Joi a errors[].code', () => {
  const cases: [string, Joi.Schema, unknown, FieldErrorCode][] = [
    ['any.required', Joi.object({ a: Joi.string().required() }), {}, 'REQUIRED'],
    ['string.empty', Joi.string(), '', 'REQUIRED'],
    ['string.base', Joi.string(), 1000, 'INVALID_FORMAT'],
    ['number.base', Joi.number(), '10', 'INVALID_FORMAT'],
    ['boolean.base', Joi.boolean(), 'true', 'INVALID_FORMAT'],
    ['string.pattern.base', Joi.string().pattern(/^\d+$/), 'abc', 'INVALID_FORMAT'],
    ['string.email', Joi.string().email(), 'no-es-email', 'INVALID_FORMAT'],
    ['string.guid', Joi.string().guid(), 'no-es-uuid', 'INVALID_FORMAT'],
    // Solo aparece con conversión activa (query y params): sin ella un string es `date.base`.
    ['date.format', Joi.date().iso().prefs({ convert: true }), 'ayer', 'INVALID_FORMAT'],
    ['number.integer', Joi.number().integer(), 1.5, 'INVALID_FORMAT'],
    ['string.min', Joi.string().min(3), 'ab', 'TOO_SHORT'],
    ['string.max', Joi.string().max(3), 'abcd', 'TOO_LONG'],
    ['number.min', Joi.number().min(1), 0, 'TOO_SMALL'],
    ['number.greater', Joi.number().greater(0), 0, 'TOO_SMALL'],
    ['number.positive', Joi.number().positive(), -1, 'TOO_SMALL'],
    ['number.max', Joi.number().max(10), 11, 'TOO_LARGE'],
    ['number.less', Joi.number().less(10), 10, 'TOO_LARGE'],
    ['any.only', Joi.string().valid('BUY', 'SELL'), 'HOLD', 'NOT_ALLOWED'],
    ['object.unknown', Joi.object({ a: Joi.string() }), { b: 1 }, 'NOT_ALLOWED'],
    ['any.invalid', Joi.string().invalid('x'), 'x', 'NOT_ALLOWED'],
  ];

  it.each(cases)('%s', (type, schema, value, code) => {
    // El caso produce de verdad ese tipo de error en Joi…
    expect(joiTypeOf(schema, value)).toBe(type);
    // …y ese tipo se traduce al código del contrato.
    expect(mapJoiErrorType(type)).toBe(code);
  });

  it('cualquier otro tipo se informa como INVALID_FORMAT', () => {
    expect(joiTypeOf(Joi.array(), 'x')).toBe('array.base');
    expect(mapJoiErrorType('array.base')).toBe('INVALID_FORMAT');
    expect(mapJoiErrorType('string.isoDate')).toBe('INVALID_FORMAT');
    expect(mapJoiErrorType('algo.desconocido')).toBe('INVALID_FORMAT');
  });
});

describe('errors[] por campo', () => {
  const schema = Joi.object({
    items: Joi.array().items(Joi.object({ quantity: Joi.number().integer().min(1).required() })),
    side: Joi.string().valid('BUY', 'SELL').required(),
  });

  it('une la ruta del campo con puntos y junta todos los errores', () => {
    const error = schema.validate(
      { items: [{ quantity: 0 }], extra: true },
      JOI_OPTIONS.body,
    ).error!;
    expect(joiErrorToFieldErrors(error, 'body')).toEqual([
      { field: 'items.0.quantity', code: 'TOO_SMALL' },
      { field: 'side', code: 'REQUIRED' },
      { field: 'extra', code: 'NOT_ALLOWED' },
    ]);
  });

  it('los errores de header usan el nombre canónico del header', () => {
    const headers = Joi.object({
      'idempotency-key': Joi.string().guid({ version: 'uuidv4' }).required(),
    });
    const missing = headers.validate({}, JOI_OPTIONS.headers).error!;
    expect(joiErrorToFieldErrors(missing, 'headers')).toEqual([
      { field: 'Idempotency-Key', code: 'REQUIRED' },
    ]);
    const malformed = headers.validate({ 'idempotency-key': 'abc' }, JOI_OPTIONS.headers).error!;
    expect(joiErrorToFieldErrors(malformed, 'headers')).toEqual([
      { field: 'Idempotency-Key', code: 'INVALID_FORMAT' },
    ]);
    expect(canonicalHeaderName('x-request-id')).toBe('X-Request-Id');
  });

  it('no repite el mismo error del mismo campo y nombra la parte si no hay ruta', () => {
    const twice = Joi.string().pattern(/a/).pattern(/b/).validate('zzz', JOI_OPTIONS.body).error!;
    expect(joiErrorToFieldErrors(twice, 'body')).toEqual([
      { field: 'body', code: 'INVALID_FORMAT' },
    ]);
  });
});

describe('validatorCompiler de Joi', () => {
  const body = Joi.object({
    quantity: Joi.number().integer().min(1).required(),
    limit: Joi.number().integer().default(20),
  });

  it('body: no convierte tipos, aplica defaults y devuelve el valor validado', () => {
    const validate = compile('body', body);
    expect(validate({ quantity: 10 })).toEqual({ value: { quantity: 10, limit: 20 } });

    const result = validate({ quantity: '10' });
    expect(result.error).toBeInstanceOf(RequestValidationError);
    expect(toAppError(result.error).toProblem()).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'quantity', code: 'INVALID_FORMAT' }],
    });
  });

  it('un body ausente se valida como objeto vacío', () => {
    const result = compile('body', body)(null);
    expect(toAppError(result.error).fieldErrors).toEqual([{ field: 'quantity', code: 'REQUIRED' }]);
  });

  it('querystring y params: convierten los strings de la URL', () => {
    const query = Joi.object({
      limit: Joi.number().integer().min(1).max(100).default(20),
      open: Joi.boolean(),
    });
    expect(compile('querystring', query)({ limit: '50', open: 'true' })).toEqual({
      value: { limit: 50, open: true },
    });
    expect(compile('querystring', query)({})).toEqual({ value: { limit: 20 } });
    expect(
      toAppError(compile('querystring', query)({ limit: '500', page: '2' }).error).fieldErrors,
    ).toEqual([
      { field: 'limit', code: 'TOO_LARGE' },
      { field: 'page', code: 'NOT_ALLOWED' },
    ]);
    expect(compile('params', Joi.object({ id: Joi.number().required() }))({ id: '7' })).toEqual({
      value: { id: 7 },
    });
  });

  it('headers: permite cabeceras desconocidas', () => {
    const headers = Joi.object({
      'idempotency-key': Joi.string().guid({ version: 'uuidv4' }).required(),
    });
    const input = {
      'idempotency-key': '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      'user-agent': 'vitest',
    };
    expect(compile('headers', headers)(input)).toEqual({ value: input });
  });

  it('una parte sin schema Joi pasa tal cual', () => {
    expect(compile('body')({ anything: 1 })).toEqual({ value: { anything: 1 } });
    expect(compile('other', Joi.object())({ anything: 1 })).toEqual({ value: { anything: 1 } });
  });
});

describe('traducción de errores a AppError', () => {
  it('convierte los errores propios de Fastify según su status', () => {
    expect(toAppError(Object.assign(new Error('too large'), { statusCode: 413 })).code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    expect(toAppError(Object.assign(new Error('nope'), { statusCode: 404 })).code).toBe(
      'NOT_FOUND',
    );
    expect(toAppError(Object.assign(new Error('slow down'), { statusCode: 429 })).code).toBe(
      'RATE_LIMITED',
    );
    expect(
      toAppError(Object.assign(new Error('bad json'), { statusCode: 400 })).toProblem(),
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'body', code: 'INVALID_FORMAT' }],
    });
    expect(toAppError(Object.assign(new Error('media'), { statusCode: 415 })).code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('cualquier otra cosa es INTERNAL_ERROR, sin filtrar el mensaje original', () => {
    for (const thrown of [
      new Error('secreto interno'),
      'string',
      null,
      { statusCode: 'x' },
      { statusCode: 503 },
    ]) {
      const problem = toAppError(thrown).toProblem();
      expect(problem).toEqual({
        type: 'about:blank',
        title: 'Internal server error',
        status: 500,
        code: 'INTERNAL_ERROR',
      });
    }
  });
});

describe('validación de respuestas (APP_ENV=test)', () => {
  const schema = Joi.object({ id: Joi.string().required(), amount: Joi.string().required() });

  it('acepta una respuesta que cumple su schema', () => {
    expect(
      findContractViolation(schema, JSON.stringify({ id: 'a', amount: '1.00' })),
    ).toBeUndefined();
  });

  it('detecta campos faltantes, tipos incorrectos y campos de más', () => {
    expect(findContractViolation(schema, JSON.stringify({ id: 'a' }))).toMatch(/amount/);
    expect(findContractViolation(schema, JSON.stringify({ id: 'a', amount: 1 }))).toMatch(/amount/);
    expect(
      findContractViolation(schema, JSON.stringify({ id: 'a', amount: '1', extra: 1 })),
    ).toMatch(/extra/);
    expect(findContractViolation(schema, 'no es json')).toMatch(/JSON válido/);
    expect(findContractViolation(schema, undefined)).toMatch(/serializado/);
  });

  it('una respuesta sin schema no puede traer cuerpo', () => {
    expect(findContractViolation(null, '')).toBeUndefined();
    expect(findContractViolation(null, undefined)).toBeUndefined();
    expect(findContractViolation(undefined, null)).toBeUndefined();
    expect(findContractViolation(null, '{"a":1}')).toMatch(/sin cuerpo/);
  });
});
