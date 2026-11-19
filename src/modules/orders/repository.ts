import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { OrderStatus } from '../../core/domain.js';
import type { CursorPayload } from '../../core/pagination.js';
import type { DbExecutor } from '../../db/client.js';
import { keysetAfter } from '../../db/keyset.js';
import { orders, type NewOrderRow, type OrderRow } from './table.js';

export class OrdersRepository {
  public async insert(executor: DbExecutor, row: NewOrderRow): Promise<OrderRow> {
    const [inserted] = await executor.insert(orders).values(row).returning();
    if (inserted === undefined) throw new Error('No se pudo insertar la orden');
    return inserted;
  }

  /** Solo devuelve la orden si es del usuario: una ajena se ve como inexistente. */
  public async findByIdForUser(
    executor: DbExecutor,
    id: string,
    userId: string,
  ): Promise<OrderRow | undefined> {
    const [row] = await executor
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .limit(1);
    return row;
  }

  /** Orden estable `created_at DESC, id DESC`. */
  public async listByUser(
    executor: DbExecutor,
    userId: string,
    filters: { status?: OrderStatus | undefined; cursor?: CursorPayload | undefined },
    limit: number,
  ): Promise<OrderRow[]> {
    const conditions: SQL[] = [eq(orders.userId, userId)];
    if (filters.status !== undefined) conditions.push(eq(orders.status, filters.status));
    if (filters.cursor !== undefined) {
      conditions.push(keysetAfter(orders.createdAt, orders.id, filters.cursor));
    }
    return executor
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit);
  }
}
