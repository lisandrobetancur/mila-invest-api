import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { refreshTokens, type NewRefreshTokenRow, type RefreshTokenRow } from './table.js';

export class RefreshTokensRepository {
  public async insert(executor: DbExecutor, row: NewRefreshTokenRow): Promise<void> {
    await executor.insert(refreshTokens).values(row);
  }

  /** Busca por hash y bloquea la fila: dos rotaciones del mismo token no pueden cruzarse. */
  public async findByHashForUpdate(
    executor: DbExecutor,
    tokenHash: string,
  ): Promise<RefreshTokenRow | undefined> {
    const [row] = await executor
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
      .for('update');
    return row;
  }

  public async markRotated(
    executor: DbExecutor,
    id: string,
    replacedBy: string,
    now: Date,
  ): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: now, replacedBy })
      .where(eq(refreshTokens.id, id));
  }

  public async revoke(executor: DbExecutor, id: string, now: Date): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
  }

  /** Revoca todos los tokens vivos de la familia (reutilización detectada). */
  public async revokeFamily(executor: DbExecutor, familyId: string, now: Date): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  public async listByFamily(executor: DbExecutor, familyId: string): Promise<RefreshTokenRow[]> {
    return executor.select().from(refreshTokens).where(eq(refreshTokens.familyId, familyId));
  }
}
