/**
 * Servicio de `Idempotency-Key` (decisión 8 de §14).
 *
 * El registro se escribe **en la misma transacción** que la operación: o se
 * confirman los dos o ninguno. Flujo de `run`:
 *
 * 1. Inserta un registro con `ON CONFLICT DO NOTHING`. Si otra transacción con
 *    la misma clave está en curso, PostgreSQL espera a que termine.
 * 2. Si lo insertó, ejecuta la operación y guarda su respuesta.
 * 3. Si ya existía: con otro cuerpo → `IDEMPOTENCY_CONFLICT`; con el mismo
 *    cuerpo → devuelve la respuesta guardada, sin ejecutar nada.
 *
 * Los registros valen 24 h; uno vencido se reutiliza como si fuera nuevo.
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { idempotencyRecords } from '../db/idempotency-table.js';
import type { Clock } from './clock.js';
import { AppError } from './errors.js';
import type { IdGenerator } from './ids.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyInput {
  userId: string;
  key: string;
  /** Hash de método + ruta + cuerpo; ver `hashRequest`. */
  requestHash: string;
}

export interface IdempotentResponse<T> {
  statusCode: number;
  body: T;
}

export interface IdempotentResult<T> extends IdempotentResponse<T> {
  /** `true` si la respuesta salió del registro y la operación no se ejecutó. */
  replayed: boolean;
}

/** JSON canónico: mismas claves en cualquier orden producen el mismo string. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

export class IdempotencyService {
  public constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Hash que identifica "la misma petición": operación + cuerpo validado. */
  public hashRequest(operation: string, payload: unknown): string {
    return createHash('sha256')
      .update(`${operation}\n${stableStringify(payload)}`, 'utf8')
      .digest('hex');
  }

  public async run<T>(
    tx: Tx,
    input: IdempotencyInput,
    operation: () => Promise<IdempotentResponse<T>>,
  ): Promise<IdempotentResult<T>> {
    const now = this.clock.now();
    const recordId = await this.claim(tx, input, now);

    if (recordId === null) {
      const [existing] = await tx
        .select()
        .from(idempotencyRecords)
        .where(
          and(eq(idempotencyRecords.userId, input.userId), eq(idempotencyRecords.key, input.key)),
        )
        .for('update');

      if (existing === undefined) {
        // El registro en conflicto desapareció entre las dos sentencias: se reintenta.
        throw new AppError('IDEMPOTENCY_CONFLICT', {
          detail: 'La Idempotency-Key está siendo usada por otra petición',
        });
      }

      const expired = existing.createdAt.getTime() + IDEMPOTENCY_TTL_MS <= now.getTime();
      if (!expired) {
        if (existing.requestHash !== input.requestHash) {
          throw new AppError('IDEMPOTENCY_CONFLICT', {
            detail: 'La Idempotency-Key ya se usó con otro cuerpo',
          });
        }
        if (existing.statusCode !== null) {
          return {
            statusCode: existing.statusCode,
            body: existing.responseBody as T,
            replayed: true,
          };
        }
      }

      // Vencido (o sin respuesta guardada): se reutiliza la fila para esta petición.
      await tx
        .update(idempotencyRecords)
        .set({
          requestHash: input.requestHash,
          statusCode: null,
          responseBody: null,
          createdAt: now,
        })
        .where(eq(idempotencyRecords.id, existing.id));
      return this.execute(tx, existing.id, operation);
    }

    return this.execute(tx, recordId, operation);
  }

  /** Devuelve el id del registro si esta transacción lo creó, o `null` si ya existía. */
  private async claim(tx: Tx, input: IdempotencyInput, now: Date): Promise<string | null> {
    const inserted = await tx
      .insert(idempotencyRecords)
      .values({
        id: this.ids.next('idempotency'),
        userId: input.userId,
        key: input.key,
        requestHash: input.requestHash,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [idempotencyRecords.userId, idempotencyRecords.key] })
      .returning({ id: idempotencyRecords.id });
    return inserted[0]?.id ?? null;
  }

  private async execute<T>(
    tx: Tx,
    recordId: string,
    operation: () => Promise<IdempotentResponse<T>>,
  ): Promise<IdempotentResult<T>> {
    const response = await operation();
    await tx
      .update(idempotencyRecords)
      .set({ statusCode: response.statusCode, responseBody: response.body })
      .where(eq(idempotencyRecords.id, recordId));
    return { ...response, replayed: false };
  }
}
