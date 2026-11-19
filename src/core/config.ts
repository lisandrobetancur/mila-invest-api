/**
 * Configuración de la aplicación.
 *
 * Es el **único** archivo de `src/` que lee `process.env` (regla 8 de §4). Las
 * variables se validan con Joi —la misma librería que valida las peticiones— y
 * el resultado es un objeto `Config` congelado y tipado.
 *
 * Si falta un secreto obligatorio, la app no arranca y el error dice qué
 * variable falta.
 */
import { existsSync } from 'node:fs';
import Joi from 'joi';
import { APP_ENVS, type AppEnv } from './domain.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly appEnv: AppEnv;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly dbPoolSize: number;
  readonly jwtSecret: string;
  readonly jwtAccessTtlSeconds: number;
  readonly refreshTtlDays: number;
  readonly documentPepper: string;
  /** Orígenes explícitos. En `dev`/`test` además se acepta localhost en cualquier puerto. */
  readonly corsOrigins: readonly string[];
  readonly priceSeed: string;
  readonly marketAlwaysOpen: boolean;
  /** Peticiones por minuto a `/auth/login`, por IP + email. */
  readonly rateLimitLogin: number;
  /** Peticiones por minuto, por usuario autenticado (o IP si no hay). */
  readonly rateLimitDefault: number;
  readonly logLevel: LogLevel;
  readonly trustProxy: boolean;
}

/** Forma de las variables de entorno después de validar y convertir. */
interface EnvShape {
  APP_ENV: AppEnv;
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  DB_POOL_SIZE: number;
  JWT_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  REFRESH_TTL_DAYS: number;
  DOCUMENT_PEPPER: string;
  CORS_ORIGINS: string;
  PRICE_SEED: string;
  MARKET_ALWAYS_OPEN: boolean;
  RATE_LIMIT_LOGIN: number;
  RATE_LIMIT_DEFAULT: number;
  LOG_LEVEL: LogLevel;
  TRUST_PROXY: boolean;
}

const ENV_FILE = '.env';

/** Pepper de desarrollo: solo se usa si `APP_ENV` no es `prod` y no se definió otro. */
const DEV_DOCUMENT_PEPPER = 'dev-only-document-pepper-not-for-production';

const isProd = Joi.valid('prod');

export const envSchema: Joi.ObjectSchema<EnvShape> = Joi.object<EnvShape>({
  APP_ENV: Joi.string()
    .valid(...APP_ENVS)
    .default('dev'),
  HOST: Joi.string().min(1).default('0.0.0.0'),
  PORT: Joi.number().integer().min(1).max(65_535).default(8000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .default('postgres://mila:mila@db:5432/mila'),
  DB_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(1).default(900),
  REFRESH_TTL_DAYS: Joi.number().integer().min(1).default(7),
  DOCUMENT_PEPPER: Joi.string()
    .min(16)
    .when('APP_ENV', {
      is: isProd,
      then: Joi.required(),
      otherwise: Joi.string().default(DEV_DOCUMENT_PEPPER),
    }),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  PRICE_SEED: Joi.string().min(1).default('20261118'),
  MARKET_ALWAYS_OPEN: Joi.boolean().when('APP_ENV', {
    is: isProd,
    then: Joi.boolean().default(false),
    otherwise: Joi.boolean().default(true),
  }),
  RATE_LIMIT_LOGIN: Joi.number().integer().min(1).default(5),
  RATE_LIMIT_DEFAULT: Joi.number().integer().min(1).default(120),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),
  TRUST_PROXY: Joi.boolean().default(false),
});

export class ConfigError extends Error {
  public constructor(public readonly problems: readonly string[]) {
    super(`Configuración inválida:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

function describeProblem(detail: Joi.ValidationErrorItem): string {
  const variable = detail.path.join('.');
  if (detail.type === 'any.required') return `falta la variable obligatoria ${variable}`;
  return `${variable}: ${detail.message}`;
}

/** Valida un conjunto de variables de entorno y devuelve la configuración congelada. */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = envSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true,
    convert: true,
  });

  if (result.error !== undefined) {
    throw new ConfigError(result.error.details.map(describeProblem));
  }

  const value = result.value;
  const corsOrigins = value.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return Object.freeze({
    appEnv: value.APP_ENV,
    host: value.HOST,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    dbPoolSize: value.DB_POOL_SIZE,
    jwtSecret: value.JWT_SECRET,
    jwtAccessTtlSeconds: value.JWT_ACCESS_TTL_SECONDS,
    refreshTtlDays: value.REFRESH_TTL_DAYS,
    documentPepper: value.DOCUMENT_PEPPER,
    corsOrigins: Object.freeze(corsOrigins),
    priceSeed: value.PRICE_SEED,
    marketAlwaysOpen: value.MARKET_ALWAYS_OPEN,
    rateLimitLogin: value.RATE_LIMIT_LOGIN,
    rateLimitDefault: value.RATE_LIMIT_DEFAULT,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
  });
}

/**
 * Lee `process.env`. Nadie más debe hacerlo.
 *
 * Si hay un `.env` en el directorio de trabajo, lo carga con el soporte nativo
 * de Node (`process.loadEnvFile`, sin `dotenv`). Las variables ya definidas en
 * el entorno tienen prioridad sobre las del archivo.
 */
export function loadConfig(): Config {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  return parseConfig(process.env);
}

/** `true` en los entornos donde se registran los endpoints `_testing` (§11). */
export function isTestingEnabled(config: Pick<Config, 'appEnv'>): boolean {
  return config.appEnv === 'dev' || config.appEnv === 'test';
}
