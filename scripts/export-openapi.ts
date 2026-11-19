/**
 * Escribe `docs/openapi.json` a partir de la app real (`APP_ENV=dev`, así
 * aparecen también los endpoints `_testing`). No abre conexiones a la base:
 * el pool de `pg` es perezoso y acá nunca se usa.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { FrozenClock } from '../src/core/clock.js';
import { parseConfig } from '../src/core/config.js';
import { createLogger } from '../src/core/logger.js';
import { createDb } from '../src/db/client.js';

export const OPENAPI_PATH = fileURLToPath(new URL('../docs/openapi.json', import.meta.url));

/** Configuración fija: el documento no depende del entorno de quien lo genera. */
export const OPENAPI_ENV = {
  APP_ENV: 'dev',
  PORT: '8000',
  JWT_SECRET: 'openapi-export-secret-0123456789abcdef',
  LOG_LEVEL: 'silent',
} as const;

export async function generateOpenApi(): Promise<string> {
  const config = parseConfig(OPENAPI_ENV);
  const handle = createDb(config);
  const app = await buildApp({
    config,
    clock: new FrozenClock('2026-11-18T15:00:00Z'),
    db: handle.db,
    logger: createLogger(config),
  });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
    await handle.close();
  }
}

async function main(): Promise<void> {
  const document = await generateOpenApi();
  await mkdir(dirname(OPENAPI_PATH), { recursive: true });
  await writeFile(OPENAPI_PATH, document, 'utf8');
  process.stdout.write(`OpenAPI escrito en ${OPENAPI_PATH}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
