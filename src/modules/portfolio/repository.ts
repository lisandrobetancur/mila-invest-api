import { and, asc, eq } from 'drizzle-orm';
import type { DecimalString } from '../../core/money.js';
import type { DbExecutor } from '../../db/client.js';
import { positions, type NewPositionRow, type PositionRow } from './table.js';

export class PositionsRepository {
  public async listByUser(executor: DbExecutor, userId: string): Promise<PositionRow[]> {
    return executor
      .select()
      .from(positions)
      .where(eq(positions.userId, userId))
      .orderBy(asc(positions.instrumentId));
  }

  public async find(
    executor: DbExecutor,
    userId: string,
    instrumentId: string,
  ): Promise<PositionRow | undefined> {
    const [row] = await executor
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.instrumentId, instrumentId)))
      .limit(1);
    return row;
  }

  /** Bloquea la posición (`FOR UPDATE`). Siempre después de bloquear la cuenta. */
  public async findForUpdate(
    executor: DbExecutor,
    userId: string,
    instrumentId: string,
  ): Promise<PositionRow | undefined> {
    const [row] = await executor
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.instrumentId, instrumentId)))
      .limit(1)
      .for('update');
    return row;
  }

  public async insert(executor: DbExecutor, row: NewPositionRow): Promise<void> {
    await executor.insert(positions).values(row);
  }

  public async update(
    executor: DbExecutor,
    id: string,
    changes: { quantity: number; avgCost: DecimalString; updatedAt: Date },
  ): Promise<void> {
    await executor.update(positions).set(changes).where(eq(positions.id, id));
  }

  public async delete(executor: DbExecutor, id: string): Promise<void> {
    await executor.delete(positions).where(eq(positions.id, id));
  }
}
