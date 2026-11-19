/**
 * `withTransaction`: la única forma de abrir una transacción (regla 4 de §4).
 *
 * Aislamiento `READ COMMITTED` con bloqueos explícitos (`FOR UPDATE`).
 * Reintenta hasta 3 veces ante deadlock (`40P01`) o fallo de serialización
 * (`40001`); como el callback se vuelve a ejecutar completo, la operación
 * reutiliza la misma `Idempotency-Key`.
 */
import type { Db, Tx } from './client.js';

export const PG_DEADLOCK_DETECTED = '40P01';
export const PG_SERIALIZATION_FAILURE = '40001';
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';

export const MAX_TRANSACTION_RETRIES = 3;

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/** Busca el error original de `pg` siguiendo la cadena de `cause` (drizzle lo envuelve). */
function findPgError(error: unknown): { code: string; constraint: string | undefined } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

export function pgErrorCode(error: unknown): string | undefined {
  return findPgError(error)?.code;
}

export function pgConstraintName(error: unknown): string | undefined {
  return findPgError(error)?.constraint;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const found = findPgError(error);
  if (found?.code !== PG_UNIQUE_VIOLATION) return false;
  return constraint === undefined || found.constraint === constraint;
}

export function isRetryableTransactionError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === PG_DEADLOCK_DETECTED || code === PG_SERIALIZATION_FAILURE;
}

export interface TransactionOptions {
  maxRetries?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withTransaction<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_TRANSACTION_RETRIES;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.transaction(fn, { isolationLevel: 'read committed' });
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableTransactionError(error)) throw error;
      options.onRetry?.(attempt + 1, error);
    }
  }
}
