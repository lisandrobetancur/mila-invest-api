/**
 * Logger estructurado (pino, el mismo que usa Fastify).
 *
 * `redact` evita que se logueen contraseñas, tokens, cabeceras de
 * autorización y números de documento (regla 9 de §4 y §12).
 */
import { pino, type Logger, type LoggerOptions } from 'pino';
import type { Config } from './config.js';

export type AppLogger = Logger;

export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'password',
  'refresh_token',
  'access_token',
  'document_number',
  '*.password',
  '*.refresh_token',
  '*.access_token',
  '*.document_number',
  'body.password',
  'body.refresh_token',
  'body.document_number',
];

export function loggerOptions(config: Pick<Config, 'logLevel'>): LoggerOptions {
  return {
    level: config.logLevel,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function createLogger(config: Pick<Config, 'logLevel'>): AppLogger {
  return pino(loggerOptions(config));
}
