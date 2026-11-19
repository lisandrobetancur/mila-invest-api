/**
 * Contrato de las respuestas reales: recorre el flujo completo del usuario demo
 * contra la app y verifica que toda respuesta de éxito cumple su schema Joi y
 * que todo error es problem+json con un `code` del catálogo.
 *
 * La validación de respuestas en `APP_ENV=test` (§5) ya convierte cualquier
 * desvío en un 500, así que acá basta con que no aparezca ninguno.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { ERROR_CATALOG, FIELD_ERROR_CODES } from '../../src/core/errors.js';
import { problemSchema } from '../../src/http/schemas/common.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import {
  bearer,
  deposit,
  get,
  idempotencyKey,
  placeOrder,
  post,
  previewOrder,
  type Session,
} from '../helpers/factories.js';
import { expectResponseValid } from '../helpers/schema-assertions.js';

let ctx: TestApp;
let demo: Session;
const responses: LightMyRequestResponse[] = [];

const track = async (pending: Promise<LightMyRequestResponse>): Promise<LightMyRequestResponse> => {
  const response = await pending;
  responses.push(response);
  return response;
};

beforeAll(async () => {
  ctx = await buildTestApp({ demo: true });
  const login = await post(ctx.app, '/auth/login', {
    email: 'demo@milainvest.app',
    password: 'Demo1234!',
  });
  const tokens = login.json<{ access_token: string; refresh_token: string }>();
  demo = {
    user: (await get(ctx.app, '/me', bearer(tokens.access_token))).json(),
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    headers: bearer(tokens.access_token),
  };
});

afterAll(async () => {
  await ctx.close();
});

describe('flujo del usuario demo (criterio de listo 5)', () => {
  it('login → portafolio → depósito → preview → compra → orden, posición y transacciones → venta → ledger cuadrado', async () => {
    const h = demo.headers;
    expect((await track(get(ctx.app, '/portfolio', h))).statusCode).toBe(200);
    expect((await track(deposit(ctx.app, demo, 'COP', '1000000.00'))).statusCode).toBe(201);
    expect((await track(previewOrder(ctx.app, demo))).statusCode).toBe(200);

    const buy = await track(placeOrder(ctx.app, demo));
    expect(buy.statusCode).toBe(201);
    const orderId = buy.json<{ id: string }>().id;
    expect((await track(get(ctx.app, `/orders/${orderId}`, h))).statusCode).toBe(200);
    expect((await track(get(ctx.app, '/orders', h))).statusCode).toBe(200);
    const portfolio = await track(get(ctx.app, '/portfolio', h));
    expect(
      portfolio
        .json<{ positions: { instrument: { id: string }; quantity: number }[] }>()
        .positions.find((p) => p.instrument.id === 'ECOPETROL-CO')?.quantity,
    ).toBe(130);
    expect((await track(get(ctx.app, '/transactions', h))).statusCode).toBe(200);

    const sell = await track(placeOrder(ctx.app, demo, { side: 'SELL', quantity: 30 }));
    expect(sell.json<{ status: string }>().status).toBe('FILLED');

    const ledger = await track(get(ctx.app, '/_testing/ledger'));
    expect(ledger.json()).toMatchObject({ balanced: true });

    for (const url of [
      '/me',
      '/accounts',
      '/meta/countries',
      '/instruments',
      '/instruments/BAP-PE',
      '/instruments/BAP-PE/prices?range=1M',
      '/dashboard/summary',
    ]) {
      expect((await track(get(ctx.app, url, h))).statusCode, url).toBe(200);
    }
    expect(
      (await track(post(ctx.app, '/auth/refresh', { refresh_token: demo.refreshToken })))
        .statusCode,
    ).toBe(200);
  });

  it('ninguna respuesta de éxito salió de su schema (no hubo 500 por contrato)', () => {
    expect(responses.length).toBeGreaterThan(15);
    expect(
      responses.filter((response) => response.statusCode >= 500).map((response) => response.body),
    ).toEqual([]);
  });
});

describe('errores', () => {
  it('toda respuesta de error es problem+json con un code del catálogo', async () => {
    const errors = await Promise.all([
      get(ctx.app, '/no-existe'),
      get(ctx.app, '/me'),
      get(ctx.app, '/me', bearer('x.y.z')),
      post(ctx.app, '/auth/login', { email: 'demo@milainvest.app', password: 'Mala1234' }),
      post(ctx.app, '/auth/refresh', { refresh_token: 'r'.repeat(43) }),
      post(ctx.app, '/auth/register', {
        email: 'demo@milainvest.app',
        password: 'Secret123',
        full_name: 'Otra Persona',
        country: 'CO',
        document_type: 'CC',
        document_number: '9999999999',
      }),
      get(ctx.app, '/instruments/NOEXISTE-CO', demo.headers),
      get(ctx.app, '/orders/ord_01JC0000000000000000009999', demo.headers),
      placeOrder(ctx.app, demo, { quantity: '10' }),
      placeOrder(ctx.app, demo, { quantity: 1_000_000 }),
      placeOrder(ctx.app, demo, { side: 'SELL', instrument_id: 'ISA-CO' }),
      deposit(ctx.app, demo, 'COP', 1000),
      post(ctx.app, '/accounts/COP/deposits', { amount: '1.00' }, demo.headers),
      post(ctx.app, '/auth/login', { email: 'a@example.com', password: 'x'.repeat(70_000) }),
    ]);

    const key = idempotencyKey();
    await deposit(ctx.app, demo, 'PEN', '1.00', key);
    errors.push(await deposit(ctx.app, demo, 'PEN', '2.00', key));

    const codes = new Set<string>();
    for (const response of errors) {
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
      expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
      const problem = response.json<{
        code: keyof typeof ERROR_CATALOG;
        status: number;
        errors?: { code: string }[];
      }>();
      expectResponseValid(problemSchema, problem);
      expect(problem.status).toBe(response.statusCode);
      expect(ERROR_CATALOG[problem.code].status).toBe(response.statusCode);
      for (const fieldError of problem.errors ?? [])
        expect(FIELD_ERROR_CODES).toContain(fieldError.code);
      codes.add(problem.code);
    }
    expect([...codes].sort()).toEqual([
      'AUTH_EMAIL_TAKEN',
      'AUTH_INVALID_CREDENTIALS',
      'AUTH_REFRESH_INVALID',
      'AUTH_TOKEN_INVALID',
      'IDEMPOTENCY_CONFLICT',
      'INSTRUMENT_NOT_FOUND',
      'INSUFFICIENT_FUNDS',
      'INSUFFICIENT_POSITION',
      'NOT_FOUND',
      'ORDER_NOT_FOUND',
      'PAYLOAD_TOO_LARGE',
      'VALIDATION_ERROR',
    ]);
  });
});
