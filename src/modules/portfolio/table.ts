import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import type { UserCurrency } from '../../core/domain.js';
import { instant, price, shares } from '../../db/columns.js';
import { instruments } from '../market/table.js';
import { users } from '../users/table.js';

/**
 * Posición de un usuario en un instrumento. Si la cantidad llega a 0 la fila
 * se borra (§8.4), por eso `quantity > 0`.
 */
export const positions = pgTable(
  'positions',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    instrumentId: text('instrument_id').notNull(),
    quantity: shares('quantity').notNull(),
    /** Costo promedio ponderado de las compras. */
    avgCost: price('avg_cost').notNull(),
    currency: text('currency').$type<UserCurrency>().notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_positions', columns: [table.id] }),
    foreignKey({
      name: 'fk_positions_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_positions_instrument_id',
      columns: [table.instrumentId],
      foreignColumns: [instruments.id],
    }),
    unique('uq_positions_user_instrument').on(table.userId, table.instrumentId),
    check('ck_positions_quantity_positive', sql`${table.quantity} > 0`),
    check('ck_positions_avg_cost_non_negative', sql`${table.avgCost} >= 0`),
    check('ck_positions_currency', sql`${table.currency} IN ('COP', 'MXN', 'PEN')`),
  ],
);

export type PositionRow = typeof positions.$inferSelect;
export type NewPositionRow = typeof positions.$inferInsert;
