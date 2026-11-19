import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { TransactionType } from '../../core/domain.js';
import type { CursorPayload } from '../../core/pagination.js';
import type { DbExecutor } from '../../db/client.js';
import { keysetAfter } from '../../db/keyset.js';
import { transactions, type NewTransactionRow, type TransactionRow } from './table.js';

export interface TransactionFilters {
  type?: TransactionType | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: CursorPayload | undefined;
}

export class TransactionsRepository {
  public async insert(executor: DbExecutor, row: NewTransactionRow): Promise<TransactionRow> {
    const [inserted] = await executor.insert(transactions).values(row).returning();
    if (inserted === undefined) throw new Error('No se pudo insertar la transacción');
    return inserted;
  }

  public async insertMany(executor: DbExecutor, rows: NewTransactionRow[]): Promise<void> {
    if (rows.length === 0) return;
    await executor.insert(transactions).values(rows);
  }

  /** Orden estable `created_at DESC, id DESC`; pide `limit` filas tal cual se le indica. */
  public async listByUser(
    executor: DbExecutor,
    userId: string,
    filters: TransactionFilters,
    limit: number,
  ): Promise<TransactionRow[]> {
    const conditions: SQL[] = [eq(transactions.userId, userId)];
    if (filters.type !== undefined) conditions.push(eq(transactions.type, filters.type));
    if (filters.from !== undefined) conditions.push(gte(transactions.createdAt, filters.from));
    if (filters.to !== undefined) conditions.push(lte(transactions.createdAt, filters.to));
    if (filters.cursor !== undefined) {
      conditions.push(keysetAfter(transactions.createdAt, transactions.id, filters.cursor));
    }
    return executor
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(limit);
  }

  public async listByOrder(executor: DbExecutor, orderId: string): Promise<TransactionRow[]> {
    return executor.select().from(transactions).where(eq(transactions.orderId, orderId));
  }
}
