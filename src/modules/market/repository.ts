import { and, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Country, InstrumentType } from '../../core/domain.js';
import type { DbExecutor } from '../../db/client.js';
import { instruments, type InstrumentRow, type NewInstrumentRow } from './table.js';

export interface InstrumentFilters {
  country?: Country | undefined;
  type?: InstrumentType | undefined;
  q?: string | undefined;
  /** Última fila de la página anterior, en el orden `(country, ticker)`. */
  after?: { country: string; ticker: string } | undefined;
}

/** Escapa los comodines de `LIKE` para buscar el texto literal. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export class InstrumentsRepository {
  public async findById(executor: DbExecutor, id: string): Promise<InstrumentRow | undefined> {
    const [row] = await executor.select().from(instruments).where(eq(instruments.id, id)).limit(1);
    return row;
  }

  public async findByIds(executor: DbExecutor, ids: string[]): Promise<InstrumentRow[]> {
    if (ids.length === 0) return [];
    return executor.select().from(instruments).where(inArray(instruments.id, ids));
  }

  public async listAll(executor: DbExecutor): Promise<InstrumentRow[]> {
    return executor
      .select()
      .from(instruments)
      .orderBy(asc(instruments.country), asc(instruments.ticker));
  }

  /** Orden estable `country ASC, ticker ASC`. */
  public async list(
    executor: DbExecutor,
    filters: InstrumentFilters,
    limit: number,
  ): Promise<InstrumentRow[]> {
    const conditions: SQL[] = [];
    if (filters.country !== undefined) conditions.push(eq(instruments.country, filters.country));
    if (filters.type !== undefined) conditions.push(eq(instruments.type, filters.type));
    if (filters.q !== undefined) {
      const pattern = `%${escapeLike(filters.q)}%`;
      const match = or(ilike(instruments.ticker, pattern), ilike(instruments.name, pattern));
      if (match !== undefined) conditions.push(match);
    }
    if (filters.after !== undefined) {
      conditions.push(
        sql`(${instruments.country}, ${instruments.ticker}) > (${filters.after.country}, ${filters.after.ticker})`,
      );
    }
    return executor
      .select()
      .from(instruments)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(instruments.country), asc(instruments.ticker))
      .limit(limit);
  }

  public async upsertMany(executor: DbExecutor, rows: NewInstrumentRow[]): Promise<void> {
    if (rows.length === 0) return;
    await executor.insert(instruments).values(rows).onConflictDoNothing({ target: instruments.id });
  }
}
