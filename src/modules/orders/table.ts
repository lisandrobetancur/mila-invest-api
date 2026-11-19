import { desc, sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import type { OrderSide, OrderStatus, OrderType, UserCurrency } from '../../core/domain.js';
import { amount, instant, price, shares } from '../../db/columns.js';
import { instruments } from '../market/table.js';
import { users } from '../users/table.js';
import type { RejectCode } from './errors.js';

export const orders = pgTable(
  'orders',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    instrumentId: text('instrument_id').notNull(),
    side: text('side').$type<OrderSide>().notNull(),
    /** Fase 1: solo `MARKET`. `LIMIT` queda previsto en el enum y en `limit_price`. */
    type: text('type').$type<OrderType>().notNull(),
    quantity: shares('quantity').notNull(),
    /** Fase 2: precio límite. */
    limitPrice: price('limit_price'),
    status: text('status').$type<OrderStatus>().notNull(),
    /** `null` si la orden fue rechazada: no hubo ejecución. */
    executedPrice: price('executed_price'),
    gross: amount('gross').notNull(),
    commission: amount('commission').notNull(),
    total: amount('total').notNull(),
    currency: text('currency').$type<UserCurrency>().notNull(),
    rejectCode: text('reject_code').$type<RejectCode>(),
    /** Ganancia realizada de una venta. Columna interna; se expone en la fase 3. */
    realizedPnl: amount('realized_pnl'),
    createdAt: instant('created_at').notNull(),
    filledAt: instant('filled_at'),
  },
  (table) => [
    primaryKey({ name: 'pk_orders', columns: [table.id] }),
    foreignKey({
      name: 'fk_orders_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_orders_instrument_id',
      columns: [table.instrumentId],
      foreignColumns: [instruments.id],
    }),
    index('ix_orders_user_created').on(table.userId, desc(table.createdAt), desc(table.id)),
    index('ix_orders_user_status_created').on(
      table.userId,
      table.status,
      desc(table.createdAt),
      desc(table.id),
    ),
    check('ck_orders_side', sql`${table.side} IN ('BUY', 'SELL')`),
    check('ck_orders_type', sql`${table.type} IN ('MARKET', 'LIMIT')`),
    check(
      'ck_orders_status',
      sql`${table.status} IN ('PENDING', 'FILLED', 'REJECTED', 'CANCELLED')`,
    ),
    check('ck_orders_quantity_range', sql`${table.quantity} BETWEEN 1 AND 1000000`),
    check('ck_orders_currency', sql`${table.currency} IN ('COP', 'MXN', 'PEN')`),
    // `total` puede ser negativo: en una venta chica la comisión mínima supera al bruto.
    check('ck_orders_amounts_non_negative', sql`${table.gross} >= 0 AND ${table.commission} >= 0`),
    check(
      'ck_orders_filled_consistency',
      sql`(${table.status} = 'FILLED') = (${table.filledAt} IS NOT NULL AND ${table.executedPrice} IS NOT NULL)`,
    ),
    check(
      'ck_orders_reject_consistency',
      sql`(${table.status} = 'REJECTED') = (${table.rejectCode} IS NOT NULL)`,
    ),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
