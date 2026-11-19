/**
 * Pool de `pg` + instancia de drizzle.
 *
 * El pool tiene tamaño configurable y un `statement_timeout` de 5 s (§6). Las
 * sesiones trabajan en UTC.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../core/config.js';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** Transacción de drizzle, tal como la recibe el callback de `db.transaction`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Lo que recibe un repository: el cliente o una transacción abierta por el service. */
export type DbExecutor = Db | Tx;

export const STATEMENT_TIMEOUT_MS = 5_000;

export interface DbHandle {
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

export function createDb(config: Pick<Config, 'databaseUrl' | 'dbPoolSize'>): DbHandle {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolSize,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    options: '-c timezone=UTC',
    application_name: 'mila-invest-api',
  });
  const db = drizzle(pool, { schema });
  return {
    pool,
    db,
    close: async () => {
      await pool.end();
    },
  };
}
