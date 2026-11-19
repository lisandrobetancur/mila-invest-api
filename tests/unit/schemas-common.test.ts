import Joi from 'joi';
import { describe, expect, it } from 'vitest';
import type { ProblemDocument } from '../../src/core/errors.js';
import {
  country,
  currency,
  cursor,
  decimalString,
  idempotencyKeyHeader,
  inputTimestamp,
  instrumentId,
  limit,
  paginated,
  positiveDecimalString,
  prefixedId,
  problemSchema,
  timestamp,
  userCurrency,
} from '../../src/http/schemas/common.js';
import {
  expectInvalid,
  expectResponseValid,
  expectValid,
  responseErrors,
} from '../helpers/schema-assertions.js';

const wrap = (schema: Joi.Schema): Joi.ObjectSchema => Joi.object({ value: schema.required() });

describe('decimalString', () => {
  const schema = wrap(decimalString());

  it.each(['0', '1234.56', '-23860.00', '0.000001', '9999999999999999.999999'])(
    'acepta %s',
    (value) => {
      expectValid(schema, { value });
    },
  );

  it('rechaza un monto enviado como número JSON', () => {
    expectInvalid(schema, { value: 1000 }, 'value', 'INVALID_FORMAT');
    expectInvalid(schema, { value: 1000.5 }, 'value', 'INVALID_FORMAT');
  });

  it.each(['1,5', '1.', '.5', '1e3', 'abc', '1.1234567', '12345678901234567', '+1', ' 1'])(
    'rechaza %s',
    (value) => {
      expectInvalid(schema, { value }, 'value', 'INVALID_FORMAT');
    },
  );

  it('rechaza el string vacío y la ausencia', () => {
    expectInvalid(schema, { value: '' }, 'value', 'REQUIRED');
    expectInvalid(schema, {}, 'value', 'REQUIRED');
  });
});

describe('positiveDecimalString', () => {
  const schema = wrap(positiveDecimalString());

  it('acepta montos mayores que 0', () => {
    expectValid(schema, { value: '0.01' });
    expectValid(schema, { value: '1000000.00' });
  });

  it.each(['0', '0.00', '-1', '-0.01'])('rechaza %s con TOO_SMALL', (value) => {
    expectInvalid(schema, { value }, 'value', 'TOO_SMALL');
  });

  it('sigue rechazando números y formatos inválidos', () => {
    expectInvalid(schema, { value: 1000 }, 'value', 'INVALID_FORMAT');
    expectInvalid(schema, { value: 'mil' }, 'value', 'INVALID_FORMAT');
  });
});

describe('enums e ids', () => {
  it('currency, userCurrency y country son enums cerrados', () => {
    for (const value of ['COP', 'MXN', 'PEN', 'USD']) expectValid(wrap(currency()), { value });
    expectInvalid(wrap(currency()), { value: 'EUR' }, 'value', 'NOT_ALLOWED');
    expectInvalid(wrap(currency()), { value: 'cop' }, 'value', 'NOT_ALLOWED');

    for (const value of ['COP', 'MXN', 'PEN']) expectValid(wrap(userCurrency()), { value });
    expectInvalid(wrap(userCurrency()), { value: 'USD' }, 'value', 'NOT_ALLOWED');

    for (const value of ['CO', 'MX', 'PE']) expectValid(wrap(country()), { value });
    expectInvalid(wrap(country()), { value: 'AR' }, 'value', 'NOT_ALLOWED');
  });

  it('instrumentId es <TICKER>-<PAÍS>', () => {
    for (const value of ['ECOPETROL-CO', 'FERREYC1-PE', 'A-MX'])
      expectValid(wrap(instrumentId()), { value });
    for (const value of [
      'ECOPETROL',
      'ecopetrol-CO',
      'ECOPETROL-AR',
      'TICKERDEMASIADOLARGO-CO',
      '-CO',
    ]) {
      expectInvalid(wrap(instrumentId()), { value }, 'value', 'INVALID_FORMAT');
    }
  });

  it('prefixedId exige el prefijo del tipo', () => {
    expectValid(wrap(prefixedId('order')), { value: 'ord_01JC0000000000000000000001' });
    expectInvalid(
      wrap(prefixedId('order')),
      { value: 'usr_01JC0000000000000000000001' },
      'value',
      'INVALID_FORMAT',
    );
    expectInvalid(wrap(prefixedId('order')), { value: 'ord_123' }, 'value', 'INVALID_FORMAT');
  });

  it('timestamp de salida es ISO 8601 UTC con Z y sin milisegundos', () => {
    expectValid(wrap(timestamp()), { value: '2026-11-18T14:42:00Z' });
    for (const value of [
      '2026-11-18T14:42:00.000Z',
      '2026-11-18T09:42:00-05:00',
      '2026-11-18',
      '18/11/2026',
    ]) {
      expectInvalid(wrap(timestamp()), { value }, 'value', 'INVALID_FORMAT');
    }
  });

  it('timestamp de entrada acepta Z u offset, con o sin segundos', () => {
    for (const value of [
      '2026-11-18T14:42:00Z',
      '2026-11-18T14:42Z',
      '2026-11-18T14:42:00.123Z',
      '2026-11-18T09:42:00-05:00',
    ]) {
      expectValid(wrap(inputTimestamp()), { value });
    }
    for (const value of ['2026-11-18', '2026-11-18T14:42:00', 'ayer', '2026-11-18 14:42:00Z']) {
      expectInvalid(wrap(inputTimestamp()), { value }, 'value', 'INVALID_FORMAT');
    }
  });
});

describe('paginación', () => {
  const query = Joi.object({ cursor: cursor(), limit: limit() });

  it('limit va de 1 a 100, con default 20, y se convierte desde la URL', () => {
    expect(expectValid(query, {}, 'querystring')).toEqual({ limit: 20 });
    expect(expectValid(query, { limit: '100' }, 'querystring')).toEqual({ limit: 100 });
    expectInvalid(query, { limit: '0' }, 'limit', 'TOO_SMALL', 'querystring');
    expectInvalid(query, { limit: '101' }, 'limit', 'TOO_LARGE', 'querystring');
    expectInvalid(query, { limit: '2.5' }, 'limit', 'INVALID_FORMAT', 'querystring');
    expectInvalid(query, { limit: 'veinte' }, 'limit', 'INVALID_FORMAT', 'querystring');
  });

  it('cursor es base64url acotado', () => {
    expectValid(query, { cursor: 'MjAyNi0xMS0xOA_-' }, 'querystring');
    expectInvalid(query, { cursor: 'con espacios' }, 'cursor', 'INVALID_FORMAT', 'querystring');
    expectInvalid(query, { cursor: 'a'.repeat(513) }, 'cursor', 'TOO_LONG', 'querystring');
    expectInvalid(query, { cursor: '' }, 'cursor', 'REQUIRED', 'querystring');
  });

  it('paginated exige items y next_cursor', () => {
    const page = paginated(Joi.object({ id: Joi.string().required() }));
    expectResponseValid(page, { items: [{ id: 'a' }], next_cursor: null });
    expectResponseValid(page, { items: [], next_cursor: 'abc' });
    expect(responseErrors(page, { items: [] })).toEqual(['next_cursor']);
    expect(responseErrors(page, { items: [{}], next_cursor: null })).toEqual(['items.0.id']);
    expect(responseErrors(page, { next_cursor: null })).toEqual(['items']);
  });
});

describe('Idempotency-Key', () => {
  const headers = idempotencyKeyHeader();

  it('acepta un UUID v4 y deja pasar otras cabeceras', () => {
    const value = { 'idempotency-key': '7c9e6679-7425-40de-944b-e07fc1f90ae7', accept: '*/*' };
    expect(expectValid(headers, value, 'headers')).toEqual(value);
  });

  it('es obligatorio y tiene que ser UUID v4', () => {
    expectInvalid(headers, {}, 'Idempotency-Key', 'REQUIRED', 'headers');
    expectInvalid(
      headers,
      { 'idempotency-key': 'abc' },
      'Idempotency-Key',
      'INVALID_FORMAT',
      'headers',
    );
    // UUID v1: versión no admitida.
    expectInvalid(
      headers,
      { 'idempotency-key': 'c232ab00-9414-11ec-b3c8-9f6bdeced846' },
      'Idempotency-Key',
      'INVALID_FORMAT',
      'headers',
    );
  });
});

describe('problemSchema', () => {
  const problem: ProblemDocument = {
    type: 'about:blank',
    title: 'Insufficient funds',
    status: 422,
    code: 'INSUFFICIENT_FUNDS',
    detail: 'Available 12000.00 COP',
    errors: [{ field: 'quantity', code: 'TOO_LARGE' }],
  };

  it('acepta el ejemplo del contrato, con y sin detail/errors', () => {
    expectResponseValid(problemSchema, problem);
    expectResponseValid(problemSchema, {
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('rechaza códigos fuera del catálogo', () => {
    expect(responseErrors(problemSchema, { ...problem, code: 'SOMETHING_ELSE' })).toEqual(['code']);
    expect(
      responseErrors(problemSchema, { ...problem, errors: [{ field: 'a', code: 'WRONG' }] }),
    ).toEqual(['errors.0.code']);
    expect(responseErrors(problemSchema, { ...problem, status: 200 })).toEqual(['status']);
    expect(responseErrors(problemSchema, { ...problem, stack: 'Error: ...' })).toEqual(['stack']);
  });
});
