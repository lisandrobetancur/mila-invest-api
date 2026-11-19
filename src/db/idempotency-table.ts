import { foreignKey, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { users } from '../modules/users/table.js';
import { instant } from './columns.js';

/**
 * Registros de `Idempotency-Key` (decisión 8 de §14). Se escriben en la misma
 * transacción que la operación; `status_code` y `response_body` quedan en
 * `null` solo mientras esa transacción está en curso.
 */
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    responseBody: jsonb('response_body').$type<unknown>(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_idempotency_records', columns: [table.id] }),
    foreignKey({
      name: 'fk_idempotency_records_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('uq_idempotency_records_user_key').on(table.userId, table.key),
  ],
);

export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect;
