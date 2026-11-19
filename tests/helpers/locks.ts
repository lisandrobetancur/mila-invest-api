/**
 * Fuerza carreras de forma determinística: retiene el bloqueo de la cuenta de
 * un usuario mientras se disparan peticiones, espera a que todas queden
 * esperando ese bloqueo y recién entonces lo libera.
 *
 * Así se puede probar el rechazo "al momento de ejecutar" (§7.3): las
 * peticiones pasan los chequeos previos con el saldo original y compiten
 * después por la misma fila.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../src/db/client.js';

async function blockedBackends(db: Db): Promise<number> {
  const result = await db.execute<{ blocked: string }>(sql`
    SELECT count(*)::text AS blocked
    FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `);
  return Number.parseInt(result.rows[0]?.blocked ?? '0', 10);
}

async function waitForBlocked(db: Db, expected: number): Promise<void> {
  const deadline = performance.now() + 4_000;
  while (performance.now() < deadline) {
    if ((await blockedBackends(db)) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`No se llegó a ${String(expected)} conexiones esperando el bloqueo`);
}

export async function raceOnAccount<T>(
  db: Db,
  input: {
    userId: string;
    currency: string;
    /** Dispara las peticiones (sin esperarlas). */
    fire: () => Promise<T>[];
    /** Se ejecuta cuando todas están bloqueadas, antes de liberar la cuenta. */
    beforeRelease?: () => Promise<void>;
  },
): Promise<T[]> {
  const holder = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM accounts WHERE user_id = ${input.userId} AND currency = ${input.currency} FOR UPDATE`,
    );
    const pending = input.fire();
    await waitForBlocked(db, pending.length);
    await input.beforeRelease?.();
    // Se devuelve envuelto para no esperar las peticiones dentro de la transacción.
    return { pending };
  });
  return Promise.all(holder.pending);
}
