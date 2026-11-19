import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from '../../src/core/pagination.js';
import type { DashboardSummaryResponse } from '../../src/modules/dashboard/schemas.js';
import type { InstrumentResponse } from '../../src/modules/market/schemas.js';
import type { PortfolioResponse } from '../../src/modules/portfolio/schemas.js';
import type { TransactionResponse } from '../../src/modules/transactions/schemas.js';
import { TEST_NOW, buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import {
  createFundedUser,
  deposit,
  freezePrice,
  get,
  placeOrder,
  post,
  registerUser,
  type Session,
} from '../helpers/factories.js';
import { expectLedgerBalanced } from '../helpers/ledger.js';

let ctx: TestApp;

/** Cierres anteriores (17-nov) = precios base del seed. */
const FROZEN: Record<string, string> = {
  'ECOPETROL-CO': '2500.00', // base 2.400 → +4,17 %
  'ISA-CO': '17100.00', // base 18.000 → −5,00 %
  'WALMEX-MX': '63.00', // base 60 → +5,00 %
  'BAP-PE': '617.50', // base 650 → −5,00 %
};

beforeAll(async () => {
  ctx = await buildTestApp();
});

beforeEach(async () => {
  ctx.clock.set(TEST_NOW);
  await post(ctx.app, '/_testing/clock', { now: null });
  for (const [id, price] of Object.entries(FROZEN)) await freezePrice(ctx.app, id, price);
});

afterEach(async () => {
  await expectLedgerBalanced(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

const portfolioOf = async (session: Session): Promise<PortfolioResponse> => {
  const response = await get(ctx.app, '/portfolio', session.headers);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<PortfolioResponse>();
};

describe('GET /portfolio', () => {
  it('un usuario nuevo tiene todo en cero', async () => {
    const session = await registerUser(ctx.app);
    expect(await portfolioOf(session)).toEqual({
      base_currency: 'COP',
      total_value: '0.00',
      cash_value: '0.00',
      invested_value: '0.00',
      day_change: '0.00',
      day_change_pct: '0.00',
      positions: [],
      allocation: [
        { type: 'CASH', value: '0.00', pct: '0.00' },
        { type: 'STOCK', value: '0.00', pct: '0.00' },
        { type: 'ETF', value: '0.00', pct: '0.00' },
      ],
      fx_rates_used: [
        { from: 'MXN', to: 'COP', rate: '216.216216', as_of: '2026-11-18T15:00:00Z' },
        { from: 'PEN', to: 'COP', rate: '1066.666667', as_of: '2026-11-18T15:00:00Z' },
      ],
    });
  });

  it('valoriza posiciones y efectivo en la moneda base con las tasas fijas', async () => {
    const session = await createFundedUser(ctx.app, {
      country: 'CO',
      balances: { COP: '1000000.00', MXN: '1000.00', PEN: '100.00' },
      positions: [
        { instrument_id: 'ECOPETROL-CO', quantity: 120, avg_cost: '2210.50' },
        { instrument_id: 'WALMEX-MX', quantity: 50, avg_cost: '58.40' },
        { instrument_id: 'BAP-PE', quantity: 10, avg_cost: '640.00' },
      ],
    });
    const portfolio = await portfolioOf(session);

    expect(portfolio.positions.map((position) => position.instrument.id)).toEqual([
      'BAP-PE',
      'ECOPETROL-CO',
      'WALMEX-MX',
    ]);

    const ecopetrol = portfolio.positions.find(
      (position) => position.instrument.id === 'ECOPETROL-CO',
    );
    expect(ecopetrol).toMatchObject({
      quantity: 120,
      avg_cost: '2210.50',
      market_value: '300000.00',
      // 300.000 − 265.260 = 34.740; 34.740 / 265.260 = 13,10 %.
      unrealized_pnl: '34740.00',
      unrealized_pnl_pct: '13.10',
      currency: 'COP',
    });
    expect(ecopetrol?.instrument).toMatchObject({
      last_price: '2500.00',
      change: '100.00',
      change_pct: '4.17',
    });

    expect(
      portfolio.positions.find((position) => position.instrument.id === 'WALMEX-MX'),
    ).toMatchObject({
      market_value: '3150.00',
      unrealized_pnl: '230.00',
      unrealized_pnl_pct: '7.88',
      currency: 'MXN',
    });
    expect(
      portfolio.positions.find((position) => position.instrument.id === 'BAP-PE'),
    ).toMatchObject({
      market_value: '6175.00',
      unrealized_pnl: '-225.00',
      unrealized_pnl_pct: '-3.52',
      currency: 'PEN',
    });

    // Efectivo: 1.000.000 + 1.000 × 4000/18,5 + 100 × 4000/3,75 = 1.322.882,88.
    // Invertido: 300.000 + 3.150 × 216,2162… + 6.175 × 1066,666… = 7.567.747,75.
    expect(portfolio).toMatchObject({
      base_currency: 'COP',
      cash_value: '1322882.88',
      invested_value: '7567747.75',
      total_value: '8890630.63',
    });

    // Variación del día de las posiciones actuales contra el cierre anterior:
    // 120 × 100 + 50 × 3 × 216,2162… + 10 × (−32,50) × 1066,666… = −302.234,23.
    expect(portfolio.day_change).toBe('-302234.23');
    expect(portfolio.day_change_pct).toBe('-3.84');

    expect(portfolio.allocation).toEqual([
      { type: 'CASH', value: '1322882.88', pct: '14.88' },
      { type: 'STOCK', value: '7567747.75', pct: '85.12' },
      { type: 'ETF', value: '0.00', pct: '0.00' },
    ]);
  });

  it('la moneda base es la del país del usuario', async () => {
    const session = await createFundedUser(ctx.app, {
      country: 'MX',
      balances: { COP: '4000.00', MXN: '100.00' },
      positions: [{ instrument_id: 'ICOLCAP-CO', quantity: 1, avg_cost: '14800.00' }],
    });
    await freezePrice(ctx.app, 'ICOLCAP-CO', '15000.00');
    const portfolio = await portfolioOf(session);
    // 4.000 COP = 18,50 MXN; 15.000 COP = 69,375 MXN.
    expect(portfolio).toMatchObject({
      base_currency: 'MXN',
      cash_value: '118.50',
      invested_value: '69.38',
      total_value: '187.88',
    });
    expect(portfolio.fx_rates_used.map((rate) => `${rate.from}/${rate.to}`)).toEqual([
      'COP/MXN',
      'PEN/MXN',
    ]);
    expect(portfolio.allocation.find((entry) => entry.type === 'ETF')).toEqual({
      type: 'ETF',
      value: '69.38',
      pct: '36.93',
    });
  });

  it('refleja las compras y ventas hechas por la API', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    await placeOrder(ctx.app, session, { quantity: 10 });
    const after = await portfolioOf(session);
    // Compra a 2.502,50; el mercado está a 2.500: −25 de P&L.
    expect(after.positions[0]).toMatchObject({
      quantity: 10,
      avg_cost: '2502.50',
      market_value: '25000.00',
      unrealized_pnl: '-25.00',
    });
    expect(after.cash_value).toBe('69975.00');
    expect(after.total_value).toBe('94975.00');
  });

  it('requiere autenticación', async () => {
    expect((await get(ctx.app, '/portfolio')).statusCode).toBe(401);
  });
});

describe('GET /transactions', () => {
  const page = async (session: Session, query = ''): Promise<Page<TransactionResponse>> => {
    const response = await get(ctx.app, `/transactions${query}`, session.headers);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<TransactionResponse>>();
  };

  it('lista los movimientos con signo, de más nuevo a más viejo', async () => {
    const session = await registerUser(ctx.app);
    await deposit(ctx.app, session, 'COP', '100000.00');
    ctx.clock.advance(60_000);
    const order = (await placeOrder(ctx.app, session)).json<{ id: string }>();

    const { items, next_cursor } = await page(session);
    expect(next_cursor).toBeNull();
    expect(items.map((item) => [item.type, item.amount, item.order_id])).toEqual([
      ['FEE', '-5000.00', order.id],
      ['BUY', '-25025.00', order.id],
      ['DEPOSIT', '100000.00', null],
    ]);
    expect(items[2]?.created_at).toBe('2026-11-18T15:00:00Z');
    expect(items[0]?.created_at).toBe('2026-11-18T15:01:00Z');
  });

  it('filtra por tipo y por rango de fechas inclusivo', async () => {
    let session = await registerUser(ctx.app);
    const reauth = async (): Promise<void> => {
      const token = await ctx.security.signAccessToken(
        session.user.id,
        `jti-${String(ctx.clock.now().getTime())}`,
      );
      session = { ...session, headers: { authorization: `Bearer ${token}` } };
    };
    await deposit(ctx.app, session, 'COP', '1000.00');
    ctx.clock.advance(3_600_000);
    await reauth();
    await deposit(ctx.app, session, 'COP', '2000.00');
    ctx.clock.advance(3_600_000);
    await reauth();
    await deposit(ctx.app, session, 'MXN', '3000.00');

    expect((await page(session, '?type=DEPOSIT')).items).toHaveLength(3);
    expect((await page(session, '?type=FEE')).items).toEqual([]);
    const from = await page(session, '?from=2026-11-18T16:00:00Z');
    expect(from.items.map((item) => item.amount)).toEqual(['3000.00', '2000.00']);
    const to = await page(session, '?to=2026-11-18T16:00:00Z');
    expect(to.items.map((item) => item.amount)).toEqual(['2000.00', '1000.00']);
    const window = await page(session, '?from=2026-11-18T10:30:00-05:00&to=2026-11-18T16:30:00Z');
    expect(window.items.map((item) => item.amount)).toEqual(['2000.00']);
  });

  it('pagina por cursor con orden estable', async () => {
    const session = await registerUser(ctx.app);
    for (let index = 1; index <= 7; index += 1)
      await deposit(ctx.app, session, 'PEN', `${String(index)}.00`);

    const first = await page(session, '?limit=3');
    expect(first.items.map((item) => item.amount)).toEqual(['7.00', '6.00', '5.00']);
    const second = await page(session, `?limit=3&cursor=${first.next_cursor ?? ''}`);
    expect(second.items.map((item) => item.amount)).toEqual(['4.00', '3.00', '2.00']);
    const third = await page(session, `?limit=3&cursor=${second.next_cursor ?? ''}`);
    expect(third.items.map((item) => item.amount)).toEqual(['1.00']);
    expect(third.next_cursor).toBeNull();
  });

  it('solo muestra los movimientos propios y valida los filtros', async () => {
    const alice = await registerUser(ctx.app);
    const bob = await registerUser(ctx.app);
    await deposit(ctx.app, alice, 'COP', '10.00');
    expect((await page(bob)).items).toEqual([]);

    const invalid = await get(ctx.app, '/transactions?type=REFUND&cursor=%%%', bob.headers);
    expect(invalid.statusCode).toBe(422);
    const corrupt = await get(ctx.app, '/transactions?cursor=bm9wZQ', bob.headers);
    expect(corrupt.json()).toMatchObject({ errors: [{ field: 'cursor', code: 'INVALID_FORMAT' }] });
  });
});

describe('GET /dashboard/summary', () => {
  it('junta el resumen del portafolio, los movers del día y las últimas transacciones', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { COP: '100000.00' },
      positions: [{ instrument_id: 'ECOPETROL-CO', quantity: 10, avg_cost: '2000.00' }],
    });
    for (let index = 0; index < 4; index += 1) {
      ctx.clock.advance(1_000);
      await deposit(ctx.app, session, 'COP', `${String(index + 1)}.00`);
    }

    const response = await get(ctx.app, '/dashboard/summary', session.headers);
    expect(response.statusCode, response.body).toBe(200);
    const summary = response.json<DashboardSummaryResponse>();
    const portfolio = await portfolioOf(session);

    expect(summary.portfolio_summary).toEqual({
      base_currency: portfolio.base_currency,
      total_value: portfolio.total_value,
      cash_value: portfolio.cash_value,
      invested_value: portfolio.invested_value,
      day_change: portfolio.day_change,
      day_change_pct: portfolio.day_change_pct,
    });

    // Los precios congelados fuerzan quiénes encabezan cada lista.
    const pct = (items: InstrumentResponse[]): number[] =>
      items.map((item) => Number(item.change_pct));
    expect(summary.top_movers.gainers.length).toBeLessThanOrEqual(3);
    expect(summary.top_movers.losers.length).toBeLessThanOrEqual(3);
    expect(summary.top_movers.gainers[0]?.id).toBe('WALMEX-MX');
    expect(summary.top_movers.gainers[1]?.id).toBe('ECOPETROL-CO');
    expect(pct(summary.top_movers.gainers)).toEqual(
      [...pct(summary.top_movers.gainers)].sort((a, b) => b - a),
    );
    expect(pct(summary.top_movers.losers)).toEqual(
      [...pct(summary.top_movers.losers)].sort((a, b) => a - b),
    );
    expect(summary.top_movers.gainers.every((item) => Number(item.change_pct) > 0)).toBe(true);
    expect(summary.top_movers.losers.every((item) => Number(item.change_pct) < 0)).toBe(true);
    expect(
      summary.top_movers.losers
        .map((item) => item.id)
        .slice(0, 2)
        .sort(),
    ).toEqual(['BAP-PE', 'ISA-CO']);

    // Las 5 más recientes, la primera es el último depósito.
    expect(summary.recent_transactions).toHaveLength(5);
    expect(summary.recent_transactions[0]).toMatchObject({ type: 'DEPOSIT', amount: '4.00' });
  });

  it('con todos los precios en su cierre anterior no hay movers', async () => {
    const session = await registerUser(ctx.app);
    const all = await get(ctx.app, '/instruments?limit=100', session.headers);
    for (const instrument of all.json<Page<InstrumentResponse>>().items) {
      const detail = await get(ctx.app, `/instruments/${instrument.id}`, session.headers);
      await freezePrice(ctx.app, instrument.id, detail.json<{ prev_close: string }>().prev_close);
    }
    const response = await get(ctx.app, '/dashboard/summary', session.headers);
    expect(response.json<DashboardSummaryResponse>()).toMatchObject({
      top_movers: { gainers: [], losers: [] },
      recent_transactions: [],
    });
  });

  it('requiere autenticación', async () => {
    expect((await get(ctx.app, '/dashboard/summary')).statusCode).toBe(401);
  });
});
