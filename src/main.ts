/** Punto de entrada: lee la configuración, construye la app y escucha en el puerto. */
import { buildApp } from './app.js';
import { ControllableClock, SystemClock, type Clock } from './core/clock.js';
import { ConfigError, isTestingEnabled, loadConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { createDb } from './db/client.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Sin configuración no hay logger: el motivo va a stderr y el proceso termina.
    process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const logger = createLogger(config);
  // En dev y test el reloj se puede congelar desde `POST /_testing/clock`.
  const clock: Clock = isTestingEnabled(config) ? new ControllableClock() : new SystemClock();
  const database = createDb(config);
  const app = await buildApp({ config, clock, db: database.db, logger });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Cerrando el servidor');
    app
      .close()
      .then(() => database.close())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Error al cerrar');
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    logger.error({ err: error }, 'No se pudo iniciar el servidor');
    await database.close();
    process.exit(1);
  }
}

await main();
