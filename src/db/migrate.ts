/**
 * Aplica las migraciones de `drizzle/`. Se usa como script (`pnpm db:migrate`)
 * y como función desde los tests.
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { createDb, type Db } from './client.js';
import { isMainModule } from './run-script.js';

/** Carpeta `drizzle/` en la raíz del repo (y junto a `dist/` en la imagen). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const handle = createDb(config);
  try {
    await runMigrations(handle.db);
    logger.info('Migraciones aplicadas');
  } catch (error) {
    logger.error({ err: error }, 'Falló la aplicación de migraciones');
    process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
