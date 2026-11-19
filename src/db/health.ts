import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

/** Chequeo de la base para `GET /health`. */
export class HealthService {
  public constructor(private readonly db: Db) {}

  public async databaseIsUp(): Promise<boolean> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
