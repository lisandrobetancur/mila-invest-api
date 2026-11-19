import { desc, sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import type { TransactionType, UserCurrency } from '../../core/domain.js';
import { amount, instant } from '../../db/columns.js';
import { ledgerJournals } from '../accounts/table.js';
import { orders } from '../orders/table.js';
import { users } from '../users/table.js';

/**
 * Movimientos vistos por el usuario. `amount` lleva signo desde su punto de
 * vista: un depósito es positivo, una compra y una comisión son negativas.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    type: text('type').$type<TransactionType>().notNull(),
    amount: amount('amount').notNull(),
    currency: text('currency').$type<UserCurrency>().notNull(),
    description: text('description').notNull(),
    orderId: text('order_id'),
    journalId: text('journal_id').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_transactions', columns: [table.id] }),
    foreignKey({
      name: 'fk_transactions_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_transactions_order_id',
      columns: [table.orderId],
      foreignColumns: [orders.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_transactions_journal_id',
      columns: [table.journalId],
      foreignColumns: [ledgerJournals.id],
    }).onDelete('cascade'),
    index('ix_transactions_user_created').on(table.userId, desc(table.createdAt), desc(table.id)),
    index('ix_transactions_user_type_created').on(
      table.userId,
      table.type,
      desc(table.createdAt),
      desc(table.id),
    ),
    index('ix_transactions_order_id').on(table.orderId),
    check('ck_transactions_type', sql`${table.type} IN ('DEPOSIT', 'BUY', 'SELL', 'FEE')`),
    check('ck_transactions_currency', sql`${table.currency} IN ('COP', 'MXN', 'PEN')`),
  ],
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
