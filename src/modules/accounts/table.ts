import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import type { Currency } from '../../core/domain.js';
import { amount, instant } from '../../db/columns.js';
import { users } from '../users/table.js';

export const JOURNAL_KINDS = ['DEPOSIT', 'ORDER'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/**
 * Cuentas del ledger (§6).
 *
 * - Cuentas de usuario: una por usuario y moneda, con `user_id`.
 * - Cuentas de sistema: sin usuario, identificadas por `system_code`
 *   (`system:deposits:COP`, `system:fees:COP`, `system:market:COP`). Son la
 *   contrapartida de cada movimiento y por eso pueden quedar en negativo; la
 *   restricción de saldo no negativo aplica solo a las cuentas de usuario.
 *
 * `available` y `reserved` son saldos cacheados: se actualizan en la misma
 * transacción que las entradas del ledger.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').notNull(),
    userId: text('user_id'),
    systemCode: text('system_code'),
    currency: text('currency').$type<Currency>().notNull(),
    available: amount('available').notNull().default('0'),
    /** Fase 2: fondos retenidos por órdenes límite pendientes. */
    reserved: amount('reserved').notNull().default('0'),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_accounts', columns: [table.id] }),
    foreignKey({
      name: 'fk_accounts_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('uq_accounts_user_currency').on(table.userId, table.currency),
    unique('uq_accounts_system_code').on(table.systemCode),
    check('ck_accounts_currency', sql`${table.currency} IN ('COP', 'MXN', 'PEN', 'USD')`),
    check('ck_accounts_owner', sql`(${table.userId} IS NULL) <> (${table.systemCode} IS NULL)`),
    check(
      'ck_accounts_non_negative',
      sql`${table.userId} IS NULL OR (${table.available} >= 0 AND ${table.reserved} >= 0)`,
    ),
  ],
);

/** Un journal agrupa las entradas de un movimiento; sus entradas suman cero por moneda. */
export const ledgerJournals = pgTable(
  'ledger_journals',
  {
    id: text('id').notNull(),
    kind: text('kind').$type<JournalKind>().notNull(),
    description: text('description').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_ledger_journals', columns: [table.id] }),
    check('ck_ledger_journals_kind', sql`${table.kind} IN ('DEPOSIT', 'ORDER')`),
  ],
);

/** `amount` positivo = crédito a la cuenta; negativo = débito. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id').notNull(),
    journalId: text('journal_id').notNull(),
    accountId: text('account_id').notNull(),
    amount: amount('amount').notNull(),
    currency: text('currency').$type<Currency>().notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_ledger_entries', columns: [table.id] }),
    foreignKey({
      name: 'fk_ledger_entries_journal_id',
      columns: [table.journalId],
      foreignColumns: [ledgerJournals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_ledger_entries_account_id',
      columns: [table.accountId],
      foreignColumns: [accounts.id],
    }).onDelete('cascade'),
    index('ix_ledger_entries_journal_id').on(table.journalId),
    index('ix_ledger_entries_account_id').on(table.accountId),
    check('ck_ledger_entries_amount_non_zero', sql`${table.amount} <> 0`),
    check('ck_ledger_entries_currency', sql`${table.currency} IN ('COP', 'MXN', 'PEN', 'USD')`),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
export type LedgerJournalRow = typeof ledgerJournals.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntryRow = typeof ledgerEntries.$inferInsert;
