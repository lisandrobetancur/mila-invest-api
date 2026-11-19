/**
 * Entorno de los tests. Es el único lugar de `tests/` que lee `process.env`.
 *
 * La base de test es **distinta** de la de desarrollo y su nombre tiene que
 * terminar en `_test`: los tests truncan todas las tablas.
 */
import { parseConfig, type Config } from '../../src/core/config.js';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://mila:mila@localhost:5432/mila_test';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const database = new URL(url).pathname.replace(/^\//, '');
  if (!database.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL apunta a "${database}": el nombre de la base de test debe terminar en "_test"`,
    );
  }
  return url;
}

export const TEST_JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
export const TEST_DOCUMENT_PEPPER = 'test-pepper-0123456789abcdef';

/** Configuración de `APP_ENV=test`, con rate limits altos para que no interfieran. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return parseConfig({
    APP_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    DB_POOL_SIZE: '15',
    JWT_SECRET: TEST_JWT_SECRET,
    DOCUMENT_PEPPER: TEST_DOCUMENT_PEPPER,
    MARKET_ALWAYS_OPEN: 'true',
    RATE_LIMIT_LOGIN: '100000',
    RATE_LIMIT_DEFAULT: '100000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}
