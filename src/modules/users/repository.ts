import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { users, type NewUserRow, type UserRow } from './table.js';

export class UsersRepository {
  public async findById(executor: DbExecutor, id: string): Promise<UserRow | undefined> {
    const [row] = await executor.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  public async findByEmail(executor: DbExecutor, email: string): Promise<UserRow | undefined> {
    const [row] = await executor.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  }

  public async findByDocumentHash(
    executor: DbExecutor,
    documentHash: string,
  ): Promise<UserRow | undefined> {
    const [row] = await executor
      .select()
      .from(users)
      .where(eq(users.documentHash, documentHash))
      .limit(1);
    return row;
  }

  public async insert(executor: DbExecutor, row: NewUserRow): Promise<UserRow> {
    const [inserted] = await executor.insert(users).values(row).returning();
    if (inserted === undefined) throw new Error('No se pudo insertar el usuario');
    return inserted;
  }

  public async updatePasswordHash(
    executor: DbExecutor,
    id: string,
    passwordHash: string,
    now: Date,
  ): Promise<void> {
    await executor.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, id));
  }
}
