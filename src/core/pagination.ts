/**
 * Paginación por cursor opaco (§7.1).
 *
 * El cursor es el base64url de `(created_at, id)`, y el orden es siempre
 * `created_at DESC, id DESC`, que es estable incluso con varias filas en el
 * mismo milisegundo.
 */
import { AppError } from './errors.js';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface CursorPayload {
  createdAt: Date;
  id: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(payload: CursorPayload): string {
  const raw = `${payload.createdAt.toISOString()}|${payload.id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/** Decodifica un cursor; si está corrupto responde `VALIDATION_ERROR` en su campo. */
export function decodeCursor(cursor: string, field = 'cursor'): CursorPayload {
  const invalid = (): AppError =>
    new AppError('VALIDATION_ERROR', {
      detail: 'El cursor de paginación no es válido',
      fieldErrors: [{ field, code: 'INVALID_FORMAT' }],
    });

  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw invalid();
  }

  const separator = raw.indexOf('|');
  if (separator <= 0) throw invalid();
  const isoDate = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (id.length === 0) throw invalid();

  const createdAt = new Date(isoDate);
  if (Number.isNaN(createdAt.getTime())) throw invalid();

  return { createdAt, id };
}

/**
 * Arma la página a partir de las filas pedidas con `limit + 1`: la fila extra
 * solo indica que hay más y no se devuelve.
 */
export function buildPage<Row, Item>(
  rows: readonly Row[],
  limit: number,
  map: (row: Row) => Item,
  cursorOf: (row: Row) => CursorPayload,
): Page<Item> {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(map),
    next_cursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}

/** Cursor opaco genérico para órdenes que no son `(created_at, id)`, p. ej. `(country, ticker)`. */
export function encodeKeyCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

export function decodeKeyCursor(cursor: string, length: number, field = 'cursor'): string[] {
  const invalid = (): AppError =>
    new AppError('VALIDATION_ERROR', {
      detail: 'El cursor de paginación no es válido',
      fieldErrors: [{ field, code: 'INVALID_FORMAT' }],
    });

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== length ||
    !parsed.every((part): part is string => typeof part === 'string' && part.length > 0)
  ) {
    throw invalid();
  }
  return parsed;
}
