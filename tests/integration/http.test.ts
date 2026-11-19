import Fastify, { type FastifyInstance } from 'fastify';
import Joi from 'joi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../../src/app.js';
import { parseConfig } from '../../src/core/config.js';
import { ERROR_CATALOG } from '../../src/core/errors.js';
import { PROBLEM_SCHEMA_ID, defineRoute, toJsonSchema } from '../../src/http/define-route.js';
import { registerErrorHandling } from '../../src/http/error-handler.js';
import { problemSchema } from '../../src/http/schemas/common.js';
import type { Services } from '../../src/services.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { API, get, post, registerUser } from '../helpers/factories.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await buildTestApp();
});

afterAll(async () => {
  await ctx.close();
});

function expectProblem(
  response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown },
  code: keyof typeof ERROR_CATALOG,
): Record<string, unknown> {
  const body = response.json() as Record<string, unknown>;
  expect(response.statusCode).toBe(ERROR_CATALOG[code].status);
  expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
  expect(body).toMatchObject({
    type: 'about:blank',
    title: ERROR_CATALOG[code].title,
    status: ERROR_CATALOG[code].status,
    code,
  });
  return body;
}

describe('salud y documentación', () => {
  it('GET /health responde ok, fuera de /api/v1', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: 'ok' });
    expect((await get(ctx.app, '/health')).statusCode).toBe(404);
  });

  it('GET /openapi.json expone el OpenAPI 3 generado desde Joi', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(document.openapi).toBe('3.0.3');
    expect(Object.keys(document.paths)).toContain('/api/v1/orders');
    expect(Object.keys(document.paths)).not.toContain('/openapi.json');
  });

  it('GET /docs sirve Swagger UI', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/docs/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(String(response.headers['content-security-policy'])).not.toMatch(
      /upgrade-insecure-requests/,
    );
  });
});

describe('X-Request-Id', () => {
  it('genera un id cuando el cliente no manda uno', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('respeta el id que manda el cliente, también en los errores', async () => {
    const ok = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-abc-123' },
    });
    expect(ok.headers['x-request-id']).toBe('req-abc-123');
    const notFound = await ctx.app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'req-404' },
    });
    expect(notFound.headers['x-request-id']).toBe('req-404');
  });
});

describe('errores problem+json', () => {
  it('una ruta inexistente responde NOT_FOUND', async () => {
    const body = expectProblem(await get(ctx.app, '/does-not-exist?x=1'), 'NOT_FOUND');
    expect(body.detail).toBe('No existe la ruta GET /api/v1/does-not-exist');
  });

  it('un método no soportado en una ruta existente responde NOT_FOUND', async () => {
    expectProblem(await ctx.app.inject({ method: 'DELETE', url: `${API}/me` }), 'NOT_FOUND');
  });

  it('un cuerpo mayor que 64 KB responde PAYLOAD_TOO_LARGE', async () => {
    const response = await post(ctx.app, '/auth/login', {
      email: 'a@example.com',
      password: 'x'.repeat(70_000),
    });
    expectProblem(response, 'PAYLOAD_TOO_LARGE');
  });

  it('un JSON malformado responde VALIDATION_ERROR en vez del 400 de Fastify', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${API}/auth/login`,
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    });
    const body = expectProblem(response, 'VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'body', code: 'INVALID_FORMAT' }]);
  });

  it('un content-type no soportado responde VALIDATION_ERROR', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${API}/auth/login`,
      headers: { 'content-type': 'text/csv' },
      payload: 'a,b',
    });
    expectProblem(response, 'VALIDATION_ERROR');
  });

  it('un body ausente informa cada campo obligatorio', async () => {
    const body = expectProblem(
      await ctx.app.inject({ method: 'POST', url: `${API}/auth/login` }),
      'VALIDATION_ERROR',
    );
    expect(body.errors).toEqual([
      { field: 'email', code: 'REQUIRED' },
      { field: 'password', code: 'REQUIRED' },
    ]);
  });

  it('los errores de query y de path también son VALIDATION_ERROR por campo', async () => {
    const session = await registerUser(ctx.app);
    const query = expectProblem(
      await get(ctx.app, '/orders?limit=500&foo=1', session.headers),
      'VALIDATION_ERROR',
    );
    expect(query.errors).toEqual([
      { field: 'limit', code: 'TOO_LARGE' },
      { field: 'foo', code: 'NOT_ALLOWED' },
    ]);
    const path = expectProblem(
      await get(ctx.app, '/instruments/minusculas', session.headers),
      'VALIDATION_ERROR',
    );
    expect(path.errors).toEqual([{ field: 'id', code: 'INVALID_FORMAT' }]);
  });

  it('nunca incluye un stack trace', async () => {
    const response = await get(ctx.app, '/does-not-exist');
    expect(response.body).not.toMatch(/\bat\b.*\.(ts|js)/);
    expect(response.json()).not.toHaveProperty('stack');
  });
});

describe('autenticación por Bearer', () => {
  it('sin token responde AUTH_TOKEN_INVALID', async () => {
    expectProblem(await get(ctx.app, '/me'), 'AUTH_TOKEN_INVALID');
  });

  it.each([
    'Basic abc',
    'Bearer',
    'Bearer  dos espacios',
    'bearer minuscula.con.puntos',
    'Bearer no-es-jwt',
  ])('rechaza la cabecera "%s"', async (authorization) => {
    expectProblem(await get(ctx.app, '/me', { authorization }), 'AUTH_TOKEN_INVALID');
  });

  it('la autenticación se evalúa antes que la validación del cuerpo', async () => {
    expectProblem(await post(ctx.app, '/orders', { nada: true }), 'AUTH_TOKEN_INVALID');
  });

  it('un token válido de un usuario que ya no existe no sirve', async () => {
    const session = await registerUser(ctx.app);
    await ctx.reset();
    expectProblem(await get(ctx.app, '/me', session.headers), 'AUTH_TOKEN_INVALID');
  });
});

describe('CORS', () => {
  const preflight = (origin: string) =>
    ctx.app.inject({
      method: 'OPTIONS',
      url: `${API}/orders`,
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,idempotency-key',
      },
    });

  it('en dev y test acepta localhost y 127.0.0.1 en cualquier puerto (Flutter web)', async () => {
    for (const origin of ['http://localhost:53124', 'http://127.0.0.1:8080', 'http://localhost']) {
      const response = await preflight(origin);
      expect(response.statusCode, origin).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(String(response.headers['access-control-allow-headers'])).toMatch(/Idempotency-Key/);
      expect(String(response.headers['access-control-allow-methods'])).toMatch(/POST/);
    }
    const actual = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:53124' },
    });
    expect(actual.headers['access-control-allow-origin']).toBe('http://localhost:53124');
    expect(String(actual.headers['access-control-expose-headers'])).toMatch(/X-Request-Id/);
  });

  it('no autoriza otros orígenes', async () => {
    const response = await preflight('https://evil.example.com');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(
      (await preflight('http://localhost.evil.com')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('en prod solo valen los orígenes de CORS_ORIGINS', () => {
    const prod = parseConfig({
      APP_ENV: 'prod',
      JWT_SECRET: 'a-secret-with-at-least-32-characters!!',
      DOCUMENT_PEPPER: 'a-production-pepper-value',
      CORS_ORIGINS: 'https://app.milainvest.app',
    });
    expect(isOriginAllowed(prod, 'https://app.milainvest.app')).toBe(true);
    expect(isOriginAllowed(prod, 'http://localhost:3000')).toBe(false);
    expect(isOriginAllowed(ctx.config, 'http://localhost:3000')).toBe(true);
    expect(isOriginAllowed(ctx.config, 'https://app.milainvest.app')).toBe(false);
  });
});

describe('cabeceras de seguridad', () => {
  it('helmet agrega las cabeceras básicas', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('defineRoute', () => {
  const services = { config: { appEnv: 'test' } } as unknown as Services;

  async function appWith(
    register: (app: FastifyInstance) => void,
    appEnv = 'test',
  ): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorate('services', { ...services, config: { appEnv } } as unknown as Services);
    app.decorateRequest('user', null);
    app.decorateRequest('accessClaims', null);
    app.decorateRequest('authError', null);
    registerErrorHandling(app);
    app.addSchema({ $id: PROBLEM_SCHEMA_ID, ...toJsonSchema(problemSchema) });
    register(app);
    await app.ready();
    return app;
  }

  const response = Joi.object({ id: Joi.string().required(), amount: Joi.string().required() });
  const register =
    (payload: unknown) =>
    (app: FastifyInstance): void => {
      defineRoute(app, {
        method: 'GET',
        url: '/thing',
        auth: false,
        summary: 'Ruta de prueba',
        tags: ['test'],
        schema: { response: { 200: response } },
        handler: () => payload,
      });
    };

  it('en APP_ENV=test una respuesta fuera de contrato se convierte en INTERNAL_ERROR', async () => {
    const app = await appWith(register({ id: 'a' }));
    const result = await app.inject({ method: 'GET', url: '/thing' });
    expect(result.statusCode).toBe(500);
    expect(result.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(result.json()).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    await app.close();
  });

  it('una respuesta que cumple el contrato pasa, y los campos de más se filtran', async () => {
    const app = await appWith(register({ id: 'a', amount: '1.00', secreto: 'no sale' }));
    const result = await app.inject({ method: 'GET', url: '/thing' });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ id: 'a', amount: '1.00' });
    await app.close();
  });

  it('exige exactamente un status 2xx en schema.response', async () => {
    const invalid = (schema: Record<number, Joi.Schema | null>) => () =>
      appWith((app) => {
        defineRoute(app, {
          method: 'GET',
          url: '/x',
          auth: false,
          summary: 'x',
          tags: ['test'],
          schema: { response: schema },
          handler: () => ({}),
        });
      });
    await expect(invalid({})()).rejects.toThrow(/exactamente un status 2xx/);
    await expect(invalid({ 200: response, 201: response })()).rejects.toThrow(
      /exactamente un status 2xx/,
    );
    await expect(invalid({ 404: response })()).rejects.toThrow(/exactamente un status 2xx/);
  });

  it('una ruta 204 no devuelve cuerpo', async () => {
    const app = await appWith((instance) => {
      defineRoute(instance, {
        method: 'POST',
        url: '/empty',
        auth: false,
        summary: 'sin cuerpo',
        description: 'Ruta sin contenido',
        tags: ['test'],
        schema: { response: { 204: null } },
        handler: () => undefined,
      });
    });
    const result = await app.inject({ method: 'POST', url: '/empty' });
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    await app.close();
  });
});
