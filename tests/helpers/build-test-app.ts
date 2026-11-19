/**
 * `buildTestApp()`: la app real (`buildApp`) con un `FrozenClock` y la base de
 * test truncada con el seed mínimo (cuentas de sistema + instrumentos).
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { ControllableClock, FrozenClock } from '../../src/core/clock.js';
import type { Config } from '../../src/core/config.js';
import { createLogger } from '../../src/core/logger.js';
import { Security } from '../../src/core/security.js';
import { createDb, type Db } from '../../src/db/client.js';
import { seedDatabase, truncateAll } from '../../src/db/seed.js';
import { testConfig } from './test-env.js';

/** Miércoles 18-nov-2026, 10:00 en Bogotá y Lima, 09:00 en Ciudad de México: mercados abiertos. */
export const TEST_NOW = '2026-11-18T15:00:00.000Z';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  config: Config;
  /** Reloj base de los tests: detenido, y se mueve con `set` / `advance`. */
  clock: FrozenClock;
  security: Security;
  /** Trunca la base y vuelve a sembrar el seed mínimo (o el completo con `demo: true`). */
  reset(options?: { demo?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Variables de entorno a pisar (p. ej. `{ MARKET_ALWAYS_OPEN: 'false' }`). */
  env?: Record<string, string>;
  now?: string;
  /** Incluye el usuario demo en el seed inicial. */
  demo?: boolean;
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = testConfig(options.env);
  const clock = new FrozenClock(options.now ?? TEST_NOW);
  // `ControllableClock` permite que `POST /_testing/clock` congele el tiempo por encima.
  const appClock = new ControllableClock(clock);
  const handle = createDb(config);
  const security = new Security(config, appClock);

  const reset = async (resetOptions: { demo?: boolean } = {}): Promise<void> => {
    await truncateAll(handle.db);
    await seedDatabase(handle.db, { includeDemo: resetOptions.demo ?? false, security });
  };
  await reset({ demo: options.demo ?? false });

  const app = await buildApp({
    config,
    clock: appClock,
    db: handle.db,
    logger: createLogger(config),
  });
  await app.ready();

  return {
    app,
    db: handle.db,
    config,
    clock,
    security,
    reset,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}
