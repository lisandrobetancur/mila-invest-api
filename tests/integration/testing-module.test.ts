import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeDocumentFor } from '../../src/modules/testing/service.js';
import { DOCUMENT_PATTERNS } from '../../src/modules/auth/schemas.js';
import type { AccountResponse } from '../../src/modules/accounts/schemas.js';
import type { PortfolioResponse } from '../../src/modules/portfolio/schemas.js';
import type { LedgerCheckResponse } from '../../src/modules/testing/schemas.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { API, createFundedUser, get, post, registerUser } from '../helpers/factories.js';
import { expectLedgerBalanced } from '../helpers/ledger.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await buildTestApp();
});

afterAll(async () => {
  await ctx.close();
});

describe('POST /_testing/users', () => {
  it('crea un usuario con saldos y posiciones a medida y devuelve sus tokens', async () => {
    const session = await createFundedUser(ctx.app, {
      email: 'QA.Escenario@Example.com',
      country: 'PE',
      balances: { PEN: '1234.56', MXN: '10.00' },
      positions: [{ instrument_id: 'BAP-PE', quantity: 7, avg_cost: '600.00' }],
    });
    expect(session.user).toMatchObject({
      email: 'qa.escenario@example.com',
      country: 'PE',
      base_currency: 'PEN',
      document_type: 'DNI',
    });

    const accounts = (await get(ctx.app, '/accounts', session.headers)).json<AccountResponse[]>();
    expect(
      Object.fromEntries(accounts.map((account) => [account.currency, account.available])),
    ).toEqual({
      COP: '0.00',
      MXN: '10.00',
      PEN: '1234.56',
    });

    const portfolio = (await get(ctx.app, '/portfolio', session.headers)).json<PortfolioResponse>();
    expect(portfolio.positions).toHaveLength(1);
    expect(portfolio.positions[0]).toMatchObject({
      quantity: 7,
      avg_cost: '600.00',
      currency: 'PEN',
    });
    await expectLedgerBalanced(ctx.db);
  });

  it('sin avg_cost usa el último precio, y con cuerpo vacío crea un usuario en CO sin saldo', async () => {
    const withDefaultCost = await createFundedUser(ctx.app, {
      positions: [{ instrument_id: 'GEB-CO', quantity: 1 }],
    });
    const portfolio = (
      await get(ctx.app, '/portfolio', withDefaultCost.headers)
    ).json<PortfolioResponse>();
    expect(portfolio.positions[0]?.avg_cost).toBe(portfolio.positions[0]?.instrument.last_price);
    expect(portfolio.cash_value).toBe('0.00');

    const empty = await createFundedUser(ctx.app);
    expect(empty.user).toMatchObject({
      country: 'CO',
      base_currency: 'COP',
      full_name: 'Usuario QA',
    });
    // La contraseña por defecto permite hacer login.
    expect(
      (await post(ctx.app, '/auth/login', { email: empty.user.email, password: 'Test1234!' }))
        .statusCode,
    ).toBe(200);
    await expectLedgerBalanced(ctx.db);
  });

  it('un saldo en cero no genera movimientos', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '0.00' } });
    expect((await get(ctx.app, '/transactions', session.headers)).json()).toEqual({
      items: [],
      next_cursor: null,
    });
  });

  it('un instrumento inexistente → INSTRUMENT_NOT_FOUND, sin crear el usuario', async () => {
    const response = await post(ctx.app, '/_testing/users', {
      email: 'fantasma@example.com',
      positions: [{ instrument_id: 'NOEXISTE-CO', quantity: 1 }],
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'INSTRUMENT_NOT_FOUND' });
    expect(
      (await post(ctx.app, '/_testing/users', { email: 'fantasma@example.com' })).statusCode,
    ).toBe(201);
  });

  it('valida el cuerpo con Joi', async () => {
    const response = await post(ctx.app, '/_testing/users', { balances: { COP: 100 } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'balances.COP', code: 'INVALID_FORMAT' }],
    });
  });

  it('genera documentos válidos para cada país', () => {
    for (const seed of ['a', 'b', 'c', 'semilla-larga-0123']) {
      expect(fakeDocumentFor('CO', seed)).toMatch(DOCUMENT_PATTERNS.CC);
      expect(fakeDocumentFor('PE', seed)).toMatch(DOCUMENT_PATTERNS.DNI);
      expect(fakeDocumentFor('MX', seed)).toMatch(DOCUMENT_PATTERNS.CURP);
    }
  });
});

describe('POST /_testing/clock', () => {
  it('fija el reloj del servidor y lo libera con null', async () => {
    const frozen = await post(ctx.app, '/_testing/clock', { now: '2026-11-18T15:55:00Z' });
    expect(frozen.statusCode).toBe(200);
    expect(frozen.json()).toEqual({ now: '2026-11-18T15:55:00Z', frozen: true });

    const session = await registerUser(ctx.app);
    const countries = (await get(ctx.app, '/meta/countries')).json<
      { market: { opens_at: string } }[]
    >();
    expect(countries[0]?.market.opens_at).toBe('2026-11-18T14:30:00Z');
    expect(session.user.id).toMatch(/^usr_/);

    const released = await post(ctx.app, '/_testing/clock', { now: null });
    expect(released.json()).toEqual({ now: '2026-11-18T15:00:00Z', frozen: false });
  });

  it('acepta offsets y rechaza formatos inválidos', async () => {
    expect(
      (await post(ctx.app, '/_testing/clock', { now: '2026-11-18T10:55:00-05:00' })).json(),
    ).toEqual({
      now: '2026-11-18T15:55:00Z',
      frozen: true,
    });
    const invalid = await post(ctx.app, '/_testing/clock', { now: 'mañana' });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ errors: [{ field: 'now', code: 'INVALID_FORMAT' }] });
    await post(ctx.app, '/_testing/clock', { now: null });
  });
});

describe('POST /_testing/market/{country}', () => {
  it('fuerza el horario por país y vuelve a la configuración con null', async () => {
    await post(ctx.app, '/_testing/clock', { now: '2026-11-21T15:00:00Z' });

    const closed = await post(ctx.app, '/_testing/market/CO', { always_open: false });
    expect(closed.json()).toEqual({
      country: 'CO',
      always_open: false,
      market: {
        status: 'CLOSED',
        opens_at: '2026-11-23T14:30:00Z',
        closes_at: '2026-11-23T21:00:00Z',
      },
    });
    const meta = (await get(ctx.app, '/meta/countries')).json<
      { code: string; market: { status: string } }[]
    >();
    expect(meta.map((country) => [country.code, country.market.status])).toEqual([
      ['CO', 'CLOSED'],
      ['MX', 'OPEN'],
      ['PE', 'OPEN'],
    ]);

    const open = await post(ctx.app, '/_testing/market/CO', { always_open: true });
    expect(open.json()).toMatchObject({ always_open: true, market: { status: 'OPEN' } });
    const reset = await post(ctx.app, '/_testing/market/CO', { always_open: null });
    expect(reset.json()).toMatchObject({ always_open: true });

    expect((await post(ctx.app, '/_testing/market/AR', { always_open: true })).statusCode).toBe(
      422,
    );
    await post(ctx.app, '/_testing/clock', { now: null });
  });
});

describe('POST /_testing/prices/{instrument_id}', () => {
  it('congela y libera el precio', async () => {
    const frozen = await post(ctx.app, '/_testing/prices/ECOPETROL-CO', { price: '2500.00' });
    expect(frozen.json()).toEqual({
      instrument_id: 'ECOPETROL-CO',
      frozen: true,
      last_price: '2500.00',
    });
    const released = await post(ctx.app, '/_testing/prices/ECOPETROL-CO', { price: null });
    expect(released.json()).toMatchObject({ instrument_id: 'ECOPETROL-CO', frozen: false });
    expect(released.json<{ last_price: string }>().last_price).not.toBe('2500.00');
  });

  it('valida el precio y el instrumento', async () => {
    expect((await post(ctx.app, '/_testing/prices/ECOPETROL-CO', { price: 2500 })).statusCode).toBe(
      422,
    );
    expect(
      (await post(ctx.app, '/_testing/prices/ECOPETROL-CO', { price: '0' })).json(),
    ).toMatchObject({
      errors: [{ field: 'price', code: 'TOO_SMALL' }],
    });
    const missing = await post(ctx.app, '/_testing/prices/NOEXISTE-CO', { price: '1.00' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'INSTRUMENT_NOT_FOUND' });
  });
});

describe('GET /_testing/ledger', () => {
  it('informa si el ledger cuadra', async () => {
    const response = await get(ctx.app, '/_testing/ledger');
    expect(response.statusCode).toBe(200);
    const check = response.json<LedgerCheckResponse>();
    expect(check).toMatchObject({
      balanced: true,
      mismatched_accounts: [],
      unbalanced_journals: [],
    });
    expect(check.accounts_checked).toBeGreaterThanOrEqual(9);
  });
});

describe('POST /_testing/reset', () => {
  it('trunca, vuelve a sembrar con el usuario demo y quita los overrides', async () => {
    await registerUser(ctx.app, { email: 'se-borra@example.com' });
    await post(ctx.app, '/_testing/prices/ISA-CO', { price: '1.00' });
    await post(ctx.app, '/_testing/market/MX', { always_open: false });
    await post(ctx.app, '/_testing/clock', { now: '2026-11-22T15:00:00Z' });

    const response = await post(ctx.app, '/_testing/reset', undefined);
    expect(response.statusCode).toBe(204);

    // El usuario demo existe con su contraseña del seed; el resto se borró.
    const login = await post(ctx.app, '/auth/login', {
      email: 'demo@milainvest.app',
      password: 'Demo1234!',
    });
    expect(login.statusCode).toBe(200);
    const token = login.json<{ access_token: string }>().access_token;
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (await post(ctx.app, '/auth/login', { email: 'se-borra@example.com', password: 'Secret123' }))
        .statusCode,
    ).toBe(401);

    const accounts = (await get(ctx.app, '/accounts', headers)).json<AccountResponse[]>();
    expect(
      Object.fromEntries(accounts.map((account) => [account.currency, account.available])),
    ).toEqual({
      COP: '50000000.00',
      MXN: '200000.00',
      PEN: '40000.00',
    });
    const portfolio = (await get(ctx.app, '/portfolio', headers)).json<PortfolioResponse>();
    expect(
      portfolio.positions.map((position) => [
        position.instrument.id,
        position.quantity,
        position.avg_cost,
      ]),
    ).toEqual([
      ['BAP-PE', 10, '640.00'],
      ['ECOPETROL-CO', 120, '2210.50'],
      ['WALMEX-MX', 50, '58.40'],
    ]);
    expect(
      (await get(ctx.app, '/instruments/ISA-CO', headers)).json<{ last_price: string }>()
        .last_price,
    ).not.toBe('1.00');
    const meta = (await get(ctx.app, '/meta/countries')).json<{ market: { status: string } }[]>();
    expect(meta.every((country) => country.market.status === 'OPEN')).toBe(true);
    expect((await post(ctx.app, '/_testing/clock', { now: null })).json()).toMatchObject({
      frozen: false,
    });

    // El historial del demo trae las órdenes y depósitos del seed.
    const orders = (await get(ctx.app, '/orders', headers)).json<{ items: { status: string }[] }>();
    expect(orders.items).toHaveLength(3);
    await expectLedgerBalanced(ctx.db);
  });

  it('correr el seed dos veces no duplica nada', async () => {
    await post(ctx.app, '/_testing/reset', undefined);
    const { seedDatabase } = await import('../../src/db/seed.js');
    await seedDatabase(ctx.db, { includeDemo: true, security: ctx.security });
    const login = await post(ctx.app, '/auth/login', {
      email: 'demo@milainvest.app',
      password: 'Demo1234!',
    });
    const headers = {
      authorization: `Bearer ${login.json<{ access_token: string }>().access_token}`,
    };
    expect(
      (await get(ctx.app, '/orders', headers)).json<{ items: unknown[] }>().items,
    ).toHaveLength(3);
    expect(
      (await get(ctx.app, '/instruments?limit=100', headers)).json<{ items: unknown[] }>().items,
    ).toHaveLength(13);
    await expectLedgerBalanced(ctx.db);
  });
});

describe('endpoints de testing en prod', () => {
  it('con APP_ENV=prod las rutas /_testing/* no existen (404)', async () => {
    const prod = await buildTestApp({ env: { APP_ENV: 'prod' } });
    try {
      expect(prod.app.services.testing).toBeNull();
      for (const [method, url] of [
        ['POST', '/_testing/reset'],
        ['POST', '/_testing/clock'],
        ['POST', '/_testing/market/CO'],
        ['POST', '/_testing/prices/ECOPETROL-CO'],
        ['POST', '/_testing/users'],
        ['GET', '/_testing/ledger'],
      ] as const) {
        const response = await prod.app.inject({
          method,
          url: `${API}${url}`,
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        expect(response.statusCode, url).toBe(404);
        expect(response.json(), url).toMatchObject({ code: 'NOT_FOUND' });
      }
      const openapi = (await prod.app.inject({ method: 'GET', url: '/openapi.json' })).json<{
        paths: object;
        tags: { name: string }[];
      }>();
      expect(Object.keys(openapi.paths).some((path) => path.includes('_testing'))).toBe(false);
      expect(openapi.tags.map((tag) => tag.name)).not.toContain('testing');
    } finally {
      await prod.close();
    }
  });

  it('con APP_ENV=prod la respuesta no se valida contra Joi pero sí se filtra por el schema', async () => {
    const prod = await buildTestApp({ env: { APP_ENV: 'prod' } });
    try {
      const response = await prod.app.inject({ method: 'GET', url: '/health' });
      expect(response.json()).toEqual({ status: 'ok', db: 'ok' });
    } finally {
      await prod.close();
    }
  });
});
