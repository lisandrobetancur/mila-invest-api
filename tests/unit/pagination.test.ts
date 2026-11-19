import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import {
  buildPage,
  decodeCursor,
  decodeKeyCursor,
  encodeCursor,
  encodeKeyCursor,
} from '../../src/core/pagination.js';

function validationFieldsOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, errors: error.fieldErrors };
    throw error;
  }
  return undefined;
}

describe('cursores de paginación', () => {
  const payload = {
    createdAt: new Date('2026-11-18T14:43:10.123Z'),
    id: 'ord_01JC0000000000000000000001',
  };

  it('codifica y decodifica (created_at, id) sin perder milisegundos', () => {
    const cursor = encodeCursor(payload);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it.each([
    '%%%',
    'bm8tc2VwYXJhdG9y',
    Buffer.from('|id').toString('base64url'),
    Buffer.from('2026-11-18T14:43:10.123Z|').toString('base64url'),
    Buffer.from('no-es-fecha|id').toString('base64url'),
  ])('rechaza el cursor corrupto %s con VALIDATION_ERROR', (cursor) => {
    expect(validationFieldsOf(() => decodeCursor(cursor))).toEqual({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'cursor', code: 'INVALID_FORMAT' }],
    });
  });

  it('arma la página con limit + 1 filas y expone next_cursor solo si hay más', () => {
    const rows = [1, 2, 3].map((n) => ({
      id: `row-${String(n)}`,
      createdAt: new Date(Date.UTC(2026, 0, n)),
    }));
    const cursorOf = (row: (typeof rows)[number]) => ({ createdAt: row.createdAt, id: row.id });

    const full = buildPage(rows, 2, (row) => row.id, cursorOf);
    expect(full.items).toEqual(['row-1', 'row-2']);
    expect(full.next_cursor).not.toBeNull();
    expect(decodeCursor(full.next_cursor!)).toEqual({ createdAt: rows[1]!.createdAt, id: 'row-2' });

    const last = buildPage(rows, 3, (row) => row.id, cursorOf);
    expect(last.items).toHaveLength(3);
    expect(last.next_cursor).toBeNull();

    expect(
      buildPage(
        [],
        20,
        (row: { id: string }) => row.id,
        () => payload,
      ),
    ).toEqual({
      items: [],
      next_cursor: null,
    });
  });

  it('codifica cursores de clave compuesta y valida su forma', () => {
    const cursor = encodeKeyCursor(['CO', 'ECOPETROL']);
    expect(decodeKeyCursor(cursor, 2)).toEqual(['CO', 'ECOPETROL']);

    const invalid = [
      '%%%',
      Buffer.from('no-json').toString('base64url'),
      Buffer.from(JSON.stringify(['CO'])).toString('base64url'),
      Buffer.from(JSON.stringify(['CO', 7])).toString('base64url'),
      Buffer.from(JSON.stringify(['CO', ''])).toString('base64url'),
      Buffer.from(JSON.stringify({ a: 1 })).toString('base64url'),
    ];
    for (const value of invalid) {
      expect(
        validationFieldsOf(() => decodeKeyCursor(value, 2)),
        value,
      ).toEqual({
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'cursor', code: 'INVALID_FORMAT' }],
      });
    }
  });
});
