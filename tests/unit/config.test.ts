import { describe, expect, it } from 'vitest';
import { ConfigError, isTestingEnabled, parseConfig } from '../../src/core/config.js';

const SECRET = 'a-secret-with-at-least-32-characters!!';

function problemsOf(env: Record<string, string>): readonly string[] {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('config', () => {
  it('aplica los defaults de dev', () => {
    const config = parseConfig({ JWT_SECRET: SECRET });
    expect(config).toMatchObject({
      appEnv: 'dev',
      host: '0.0.0.0',
      port: 8000,
      databaseUrl: 'postgres://mila:mila@db:5432/mila',
      dbPoolSize: 10,
      jwtAccessTtlSeconds: 900,
      refreshTtlDays: 7,
      corsOrigins: [],
      priceSeed: '20261118',
      marketAlwaysOpen: true,
      rateLimitLogin: 5,
      rateLimitDefault: 120,
      logLevel: 'info',
      trustProxy: false,
    });
    expect(config.documentPepper.length).toBeGreaterThanOrEqual(16);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.corsOrigins)).toBe(true);
  });

  it('convierte tipos y separa CORS_ORIGINS por comas', () => {
    const config = parseConfig({
      APP_ENV: 'test',
      JWT_SECRET: SECRET,
      PORT: '9000',
      DB_POOL_SIZE: '3',
      MARKET_ALWAYS_OPEN: 'false',
      CORS_ORIGINS: 'https://app.example.com, http://localhost:5000 ,',
      TRUST_PROXY: 'true',
      UNRELATED_VARIABLE: 'ignored',
    });
    expect(config.port).toBe(9000);
    expect(config.dbPoolSize).toBe(3);
    expect(config.marketAlwaysOpen).toBe(false);
    expect(config.trustProxy).toBe(true);
    expect(config.corsOrigins).toEqual(['https://app.example.com', 'http://localhost:5000']);
    expect(config).not.toHaveProperty('UNRELATED_VARIABLE');
  });

  it('en prod el mercado respeta el horario por defecto', () => {
    const config = parseConfig({
      APP_ENV: 'prod',
      JWT_SECRET: SECRET,
      DOCUMENT_PEPPER: 'a-production-pepper-value',
    });
    expect(config.marketAlwaysOpen).toBe(false);
    expect(isTestingEnabled(config)).toBe(false);
  });

  it('habilita los endpoints de testing solo en dev y test', () => {
    expect(isTestingEnabled({ appEnv: 'dev' })).toBe(true);
    expect(isTestingEnabled({ appEnv: 'test' })).toBe(true);
    expect(isTestingEnabled({ appEnv: 'prod' })).toBe(false);
  });

  it('no arranca sin JWT_SECRET y dice qué variable falta', () => {
    expect(problemsOf({})).toEqual(['falta la variable obligatoria JWT_SECRET']);
    expect(() => parseConfig({})).toThrow(/JWT_SECRET/);
  });

  it('en prod exige DOCUMENT_PEPPER', () => {
    expect(problemsOf({ APP_ENV: 'prod', JWT_SECRET: SECRET })).toEqual([
      'falta la variable obligatoria DOCUMENT_PEPPER',
    ]);
  });

  it('informa todos los valores inválidos a la vez', () => {
    const problems = problemsOf({
      APP_ENV: 'staging',
      JWT_SECRET: 'corto',
      PORT: 'abc',
      LOG_LEVEL: 'verbose',
      DATABASE_URL: 'mysql://x',
    });
    expect(problems).toHaveLength(5);
    expect(problems.join('\n')).toMatch(/APP_ENV/);
    expect(problems.join('\n')).toMatch(/JWT_SECRET/);
    expect(problems.join('\n')).toMatch(/PORT/);
    expect(problems.join('\n')).toMatch(/LOG_LEVEL/);
    expect(problems.join('\n')).toMatch(/DATABASE_URL/);
  });
});
