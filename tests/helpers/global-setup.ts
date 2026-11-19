/**
 * Corre una vez antes de toda la suite: crea la base de test si no existe y
 * aplica las migraciones. Los tests usan un PostgreSQL real, nunca mocks.
 */
import pg from 'pg';
import { createDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { testDatabaseUrl } from './test-env.js';

export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const database = url.pathname.replace(/^\//, '');

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (existing.rowCount === 0) {
      // El nombre ya fue validado (`…_test`) y no admite parámetros en CREATE DATABASE.
      await admin.query(`CREATE DATABASE "${database.replaceAll('"', '')}"`);
    }
  } finally {
    await admin.end();
  }

  const handle = createDb({ databaseUrl: url.toString(), dbPoolSize: 2 });
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
