import { foreignKey, index, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { instant } from '../../db/columns.js';
import { users } from '../users/table.js';

/**
 * Refresh tokens opacos. Solo se guarda el `sha256` del token (§12).
 * `family_id` agrupa la cadena de rotaciones: si llega un token ya rotado, se
 * revoca la familia entera.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    familyId: text('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    /** Id del refresh token que reemplazó a este al rotar. */
    replacedBy: text('replaced_by'),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_refresh_tokens', columns: [table.id] }),
    foreignKey({
      name: 'fk_refresh_tokens_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('uq_refresh_tokens_token_hash').on(table.tokenHash),
    index('ix_refresh_tokens_family_id').on(table.familyId),
    index('ix_refresh_tokens_user_id').on(table.userId),
  ],
);

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenRow = typeof refreshTokens.$inferInsert;
