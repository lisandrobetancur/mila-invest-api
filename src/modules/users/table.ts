import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import type { Country, DocumentType, UserCurrency } from '../../core/domain.js';
import { instant } from '../../db/columns.js';

export const users = pgTable(
  'users',
  {
    id: text('id').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    country: text('country').$type<Country>().notNull(),
    baseCurrency: text('base_currency').$type<UserCurrency>().notNull(),
    documentType: text('document_type').$type<DocumentType>().notNull(),
    /** HMAC-SHA256(pepper, país|tipo|número): el número nunca se guarda en claro. */
    documentHash: text('document_hash').notNull(),
    documentLast4: text('document_last4').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_users', columns: [table.id] }),
    unique('uq_users_email').on(table.email),
    unique('uq_users_document_hash').on(table.documentHash),
    check('ck_users_country', sql`${table.country} IN ('CO', 'MX', 'PE')`),
    check('ck_users_base_currency', sql`${table.baseCurrency} IN ('COP', 'MXN', 'PEN')`),
    check('ck_users_document_type', sql`${table.documentType} IN ('CC', 'CE', 'CURP', 'DNI')`),
    check('ck_users_email_lowercase', sql`${table.email} = lower(${table.email})`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
