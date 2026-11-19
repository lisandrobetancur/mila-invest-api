import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accounts,
  ledgerEntries,
  ledgerJournals,
  orders,
  positions,
  transactions,
} from '../../src/db/schema.js';
import type { Page } from '../../src/core/pagination.js';
import type { AccountResponse } from '../../src/modules/accounts/schemas.js';
import type { OrderPreviewResponse, OrderResponse } from '../../src/modules/orders/schemas.js';
import type { PortfolioResponse } from '../../src/modules/portfolio/schemas.js';
import type { TransactionResponse } from '../../src/modules/transactions/schemas.js';
import { TEST_NOW, buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import {
  bearer,
  createFundedUser,
  freezePrice,
  get,
  idempotencyKey,
  orderBody,
  placeOrder,
  post,
  previewOrder,
  type Session,
} from '../helpers/factories.js';
import { expectLedgerBalanced } from '../helpers/ledger.js';
import { raceOnAccount } from '../helpers/locks.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await buildTestApp();
});

beforeEach(async () => {
  // Estado limpio de overrides: precios del modelo, mercado siempre abierto, reloj base.
  ctx.clock.set(TEST_NOW);
  await post(ctx.app, '/_testing/clock', { now: null });
  for (const country of ['CO', 'MX', 'PE']) {
    await post(ctx.app, `/_testing/market/${country}`, { always_open: null });
  }
  await freezePrice(ctx.app, 'ECOPETROL-CO', '2500.00');
  await freezePrice(ctx.app, 'WALMEX-MX', '60.00');
  await freezePrice(ctx.app, 'FERREYC1-PE', '2.50');
});

afterEach(async () => {
  await expectLedgerBalanced(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

async function available(session: Session, currency = 'COP'): Promise<string> {
  const response = await get(ctx.app, '/accounts', session.headers);
  const account = response
    .json<AccountResponse[]>()
    .find((candidate) => candidate.currency === currency);
  return account?.available ?? 'missing';
}

async function position(session: Session, instrumentId: string) {
  const [row] = await ctx.db
    .select()
    .from(positions)
    .where(and(eq(positions.userId, session.user.id), eq(positions.instrumentId, instrumentId)));
  return row;
}

async function countRows(session: Session): Promise<{ orders: number; transactions: number }> {
  const [orderCount] = await ctx.db
    .select({ value: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.userId, session.user.id));
  const [transactionCount] = await ctx.db
    .select({ value: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.userId, session.user.id));
  return { orders: orderCount?.value ?? 0, transactions: transactionCount?.value ?? 0 };
}

/** Access token nuevo, emitido con el reloj actual (el anterior vence al mover el reloj). */
async function reauth(session: Session): Promise<Session> {
  const token = await ctx.security.signAccessToken(session.user.id, idempotencyKey());
  return { ...session, accessToken: token, headers: bearer(token) };
}

describe('POST /orders/preview', () => {
  it('calcula precio con spread, bruto, comisión y total, sin escribir nada', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const before = await countRows(session);

    const response = await previewOrder(ctx.app, session);
    expect(response.statusCode).toBe(200);
    expect(response.json<OrderPreviewResponse>()).toEqual({
      estimated_price: '2502.50',
      gross: '25025.00',
      commission: '5000.00',
      total: '30025.00',
      currency: 'COP',
      available_after: '69975.00',
      warnings: ['PRICE_MAY_CHANGE'],
    });

    expect(await countRows(session)).toEqual(before);
    expect(await available(session)).toBe('100000.00');
    expect(await position(session, 'ECOPETROL-CO')).toBeUndefined();
  });

  it('en una venta el total es el neto que se acredita', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { COP: '1000.00' },
      positions: [{ instrument_id: 'ECOPETROL-CO', quantity: 10, avg_cost: '2000.00' }],
    });
    const response = await previewOrder(ctx.app, session, { side: 'SELL', quantity: 4 });
    expect(response.json<OrderPreviewResponse>()).toEqual({
      estimated_price: '2497.50',
      gross: '9990.00',
      commission: '5000.00',
      total: '4990.00',
      currency: 'COP',
      available_after: '5990.00',
      warnings: ['PRICE_MAY_CHANGE'],
    });
  });

  it('avisa MARKET_CLOSING_SOON cuando faltan menos de 15 minutos para el cierre', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    await post(ctx.app, '/_testing/clock', { now: '2026-11-18T20:50:00Z' });
    const response = await previewOrder(ctx.app, await reauth(session));
    expect(response.json<OrderPreviewResponse>().warnings).toEqual([
      'MARKET_CLOSING_SOON',
      'PRICE_MAY_CHANGE',
    ]);
  });

  it('sin saldo → INSUFFICIENT_FUNDS con el disponible en el detalle', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '12000.00' } });
    const response = await previewOrder(ctx.app, session);
    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Insufficient funds',
      status: 422,
      code: 'INSUFFICIENT_FUNDS',
      detail: 'Available 12000.00 COP',
      errors: [{ field: 'quantity', code: 'TOO_LARGE' }],
    });
  });

  it('venta por más de lo que se tiene → INSUFFICIENT_POSITION', async () => {
    const session = await createFundedUser(ctx.app, {
      positions: [{ instrument_id: 'ECOPETROL-CO', quantity: 3 }],
    });
    const response = await previewOrder(ctx.app, session, { side: 'SELL', quantity: 4 });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'INSUFFICIENT_POSITION',
      detail: 'Held 3 ECOPETROL',
      errors: [{ field: 'quantity', code: 'TOO_LARGE' }],
    });
  });

  it('instrumento inexistente → INSTRUMENT_NOT_FOUND', async () => {
    const session = await createFundedUser(ctx.app);
    const response = await previewOrder(ctx.app, session, { instrument_id: 'NOEXISTE-CO' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'INSTRUMENT_NOT_FOUND' });
  });
});

describe('POST /orders — compra', () => {
  it('ejecuta la orden y deja ledger, posición, transacciones y saldo exactos', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const response = await placeOrder(ctx.app, session);
    expect(response.statusCode).toBe(201);

    const order = response.json<OrderResponse>();
    expect(order).toEqual({
      id: expect.stringMatching(/^ord_/) as string,
      instrument_id: 'ECOPETROL-CO',
      side: 'BUY',
      type: 'MARKET',
      quantity: 10,
      status: 'FILLED',
      executed_price: '2502.50',
      gross: '25025.00',
      commission: '5000.00',
      total: '30025.00',
      currency: 'COP',
      reject_code: null,
      created_at: '2026-11-18T15:00:00Z',
      filled_at: '2026-11-18T15:00:00Z',
    });

    // Saldo: se debita bruto + comisión.
    expect(await available(session)).toBe('69975.00');

    // Posición nueva con el precio de ejecución como costo promedio.
    expect(await position(session, 'ECOPETROL-CO')).toMatchObject({
      quantity: 10,
      avgCost: '2502.500000',
      currency: 'COP',
    });

    // Transacciones: BUY por el bruto y FEE por la comisión, de la misma orden.
    const list = await get(ctx.app, '/transactions?limit=2', session.headers);
    const items = list.json<Page<TransactionResponse>>().items;
    expect(
      items.map((item) => [item.type, item.amount, item.description, item.order_id]).sort(),
    ).toEqual([
      ['BUY', '-25025.00', 'Compra 10 ECOPETROL', order.id],
      ['FEE', '-5000.00', 'Comisión compra 10 ECOPETROL', order.id],
    ]);
    // La suma de las dos es el total de la orden.
    expect(items.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2)).toBe('-30025.00');

    // Journal: usuario −bruto −comisión; system:market +bruto; system:fees +comisión.
    const [journal] = await ctx.db
      .select()
      .from(ledgerJournals)
      .where(eq(ledgerJournals.description, `Orden ${order.id}`));
    const entries = await ctx.db
      .select({ amount: ledgerEntries.amount, code: accounts.systemCode })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(eq(ledgerEntries.journalId, journal?.id ?? ''));
    expect(entries.map((entry) => [entry.code ?? 'user', entry.amount]).sort()).toEqual([
      ['system:fees:COP', '5000.0000'],
      ['system:market:COP', '25025.0000'],
      ['user', '-25025.0000'],
      ['user', '-5000.0000'],
    ]);
  });

  it('por encima del mínimo, la comisión es el 0,30 % del bruto', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '3000000.00' } });
    const order = (await placeOrder(ctx.app, session, { quantity: 1000 })).json<OrderResponse>();
    expect(order).toMatchObject({
      status: 'FILLED',
      gross: '2502500.00',
      commission: '7507.50',
      total: '2510007.50',
    });
    expect(await available(session)).toBe('489992.50');
  });

  it('en México la comisión lleva IVA y se paga con la cuenta en MXN', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { MXN: '10000.00', COP: '500.00' },
    });
    const order = (
      await placeOrder(ctx.app, session, { instrument_id: 'WALMEX-MX', quantity: 100 })
    ).json<OrderResponse>();
    // 0,25 % de 6006 = 15,015; con IVA del 16 % = 17,4174 → 17,42.
    expect(order).toMatchObject({
      status: 'FILLED',
      executed_price: '60.06',
      gross: '6006.00',
      commission: '17.42',
      total: '6023.42',
      currency: 'MXN',
    });
    expect(await available(session, 'MXN')).toBe('3976.58');
    // No hay conversión automática: la cuenta en COP no se toca.
    expect(await available(session, 'COP')).toBe('500.00');
  });

  it('permite gastar el saldo justo y deja la cuenta en cero', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '30025.00' } });
    expect((await placeOrder(ctx.app, session)).json<OrderResponse>().status).toBe('FILLED');
    expect(await available(session)).toBe('0.00');
  });

  it('con un centavo menos que el total → INSUFFICIENT_FUNDS y no crea orden', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '30024.99' } });
    const before = await countRows(session);

    const response = await placeOrder(ctx.app, session);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      detail: 'Available 30024.99 COP',
      errors: [{ field: 'quantity', code: 'TOO_LARGE' }],
    });
    expect(await countRows(session)).toEqual(before);
    expect(await available(session)).toBe('30024.99');
  });

  it('no paga una compra en COP con saldo en otra moneda', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { MXN: '500000.00', PEN: '100000.00' },
    });
    const response = await placeOrder(ctx.app, session);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      detail: 'Available 0.00 COP',
    });
  });

  it('la segunda compra promedia el costo de la posición', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '200000.00' } });
    await placeOrder(ctx.app, session, { quantity: 10 });
    await freezePrice(ctx.app, 'ECOPETROL-CO', '3000.00');
    const second = (await placeOrder(ctx.app, session, { quantity: 30 })).json<OrderResponse>();
    expect(second.executed_price).toBe('3003.00');

    // (10 × 2502,50 + 30 × 3003,00) / 40 = 2877,875
    expect(await position(session, 'ECOPETROL-CO')).toMatchObject({
      quantity: 40,
      avgCost: '2877.875000',
    });
  });
});

describe('POST /orders — venta', () => {
  const holder = () =>
    createFundedUser(ctx.app, {
      balances: { COP: '1000.00' },
      positions: [{ instrument_id: 'ECOPETROL-CO', quantity: 10, avg_cost: '2000.00' }],
    });

  it('acredita el neto, reduce la posición y no cambia el costo promedio', async () => {
    const session = await holder();
    await freezePrice(ctx.app, 'ECOPETROL-CO', '2600.00');
    const response = await placeOrder(ctx.app, session, { side: 'SELL', quantity: 4 });
    expect(response.statusCode).toBe(201);

    const order = response.json<OrderResponse>();
    expect(order).toMatchObject({
      side: 'SELL',
      status: 'FILLED',
      executed_price: '2597.40',
      gross: '10389.60',
      commission: '5000.00',
      // En una venta el total es bruto − comisión.
      total: '5389.60',
    });
    expect(await available(session)).toBe('6389.60');
    expect(await position(session, 'ECOPETROL-CO')).toMatchObject({
      quantity: 6,
      avgCost: '2000.000000',
    });

    // Ganancia realizada: (2597,40 − 2000,00) × 4. Columna interna, no sale en la respuesta.
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.realizedPnl).toBe('2389.6000');
    expect(order).not.toHaveProperty('realized_pnl');

    const items = (await get(ctx.app, '/transactions?limit=2', session.headers)).json<
      Page<TransactionResponse>
    >().items;
    expect(items.map((item) => [item.type, item.amount, item.description]).sort()).toEqual([
      ['FEE', '-5000.00', 'Comisión venta 4 ECOPETROL'],
      ['SELL', '10389.60', 'Venta 4 ECOPETROL'],
    ]);
    expect(items.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2)).toBe(order.total);
  });

  it('vender toda la posición la borra', async () => {
    const session = await holder();
    const order = (
      await placeOrder(ctx.app, session, { side: 'SELL', quantity: 10 })
    ).json<OrderResponse>();
    expect(order.status).toBe('FILLED');
    expect(await position(session, 'ECOPETROL-CO')).toBeUndefined();

    const portfolio = (await get(ctx.app, '/portfolio', session.headers)).json<PortfolioResponse>();
    expect(portfolio.positions).toEqual([]);
  });

  it('no hay ventas en corto: sin posición → INSUFFICIENT_POSITION y no crea orden', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const response = await placeOrder(ctx.app, session, { side: 'SELL', quantity: 1 });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'INSUFFICIENT_POSITION',
      detail: 'Held 0 ECOPETROL',
      errors: [{ field: 'quantity', code: 'TOO_LARGE' }],
    });
    expect((await countRows(session)).orders).toBe(0);
  });

  it('vender más de lo que se tiene → INSUFFICIENT_POSITION', async () => {
    const session = await holder();
    const response = await placeOrder(ctx.app, session, { side: 'SELL', quantity: 11 });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'INSUFFICIENT_POSITION',
      detail: 'Held 10 ECOPETROL',
    });
    expect(await position(session, 'ECOPETROL-CO')).toMatchObject({ quantity: 10 });
  });

  it('si la comisión mínima supera al bruto, el neto negativo sale del saldo', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { PEN: '10.00' },
      positions: [{ instrument_id: 'FERREYC1-PE', quantity: 2, avg_cost: '2.00' }],
    });
    const order = (
      await placeOrder(ctx.app, session, {
        instrument_id: 'FERREYC1-PE',
        side: 'SELL',
        quantity: 1,
      })
    ).json<OrderResponse>();
    // Precio 2,50 − 0,10 % = 2,4975 → 2,50; comisión mínima PEN 5.
    expect(order).toMatchObject({
      status: 'FILLED',
      gross: '2.50',
      commission: '5.00',
      total: '-2.50',
    });
    expect(await available(session, 'PEN')).toBe('7.50');
  });

  it('una venta cuyo costo neto no se puede pagar → INSUFFICIENT_FUNDS', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { PEN: '1.00' },
      positions: [{ instrument_id: 'FERREYC1-PE', quantity: 2, avg_cost: '2.00' }],
    });
    const response = await placeOrder(ctx.app, session, {
      instrument_id: 'FERREYC1-PE',
      side: 'SELL',
      quantity: 1,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      detail: 'Available 1.00 PEN',
    });
  });
});

describe('POST /orders — validación', () => {
  it('quantity como string → VALIDATION_ERROR con el campo y el código', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const response = await placeOrder(ctx.app, session, { quantity: '10' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'quantity', code: 'INVALID_FORMAT' }],
    });
    expect((await countRows(session)).orders).toBe(0);
  });

  it('informa todos los campos inválidos a la vez', async () => {
    const session = await createFundedUser(ctx.app);
    const response = await placeOrder(ctx.app, session, {
      instrument_id: 'ecopetrol',
      side: 'HOLD',
      type: 'LIMIT',
      quantity: 0,
    });
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'instrument_id', code: 'INVALID_FORMAT' },
        { field: 'side', code: 'NOT_ALLOWED' },
        { field: 'type', code: 'NOT_ALLOWED' },
        { field: 'quantity', code: 'TOO_SMALL' },
      ],
    });
  });

  it('sin Idempotency-Key → VALIDATION_ERROR en el campo Idempotency-Key', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const response = await post(ctx.app, '/orders', orderBody(), session.headers);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'Idempotency-Key', code: 'REQUIRED' }],
    });
    expect((await countRows(session)).orders).toBe(0);
  });

  it('instrumento inexistente → INSTRUMENT_NOT_FOUND', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const response = await placeOrder(ctx.app, session, { instrument_id: 'NOEXISTE-CO' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'INSTRUMENT_NOT_FOUND' });
  });
});

describe('mercado cerrado', () => {
  it('con el reloj fuera de horario y sin always-open, preview y orden responden MARKET_CLOSED', async () => {
    let session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    await post(ctx.app, '/_testing/market/CO', { always_open: false });
    // 17:30 en Bogotá: el mercado cerró a las 16:00.
    await post(ctx.app, '/_testing/clock', { now: '2026-11-18T22:30:00Z' });
    session = await reauth(session);

    const preview = await previewOrder(ctx.app, session);
    expect(preview.statusCode).toBe(422);
    expect(preview.json()).toMatchObject({ code: 'MARKET_CLOSED' });

    const order = await placeOrder(ctx.app, session);
    expect(order.statusCode).toBe(422);
    expect(order.json()).toMatchObject({ code: 'MARKET_CLOSED', status: 422 });
    expect((await countRows(session)).orders).toBe(0);
    expect(await available(session)).toBe('100000.00');
  });

  it('el cierre es por país: con Colombia cerrado, Perú puede seguir operando', async () => {
    let session = await createFundedUser(ctx.app, {
      balances: { COP: '100000.00', PEN: '1000.00' },
    });
    for (const country of ['CO', 'PE'])
      await post(ctx.app, `/_testing/market/${country}`, { always_open: false });
    // 09:10 en Bogotá y Lima: Lima abrió a las 09:00, Bogotá abre 09:30.
    await post(ctx.app, '/_testing/clock', { now: '2026-11-18T14:10:00Z' });
    session = await reauth(session);

    expect((await placeOrder(ctx.app, session)).json()).toMatchObject({ code: 'MARKET_CLOSED' });
    const peru = await placeOrder(ctx.app, session, {
      instrument_id: 'FERREYC1-PE',
      quantity: 100,
    });
    expect(peru.json<OrderResponse>().status).toBe('FILLED');
  });

  it('dentro del horario la orden se ejecuta aunque no haya always-open', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    await post(ctx.app, '/_testing/market/CO', { always_open: false });
    expect((await placeOrder(ctx.app, session)).json<OrderResponse>().status).toBe('FILLED');
  });
});

describe('precio que cambia entre el preview y la ejecución', () => {
  it('la orden se ejecuta al precio del instante de ejecución', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const preview = (await previewOrder(ctx.app, session)).json<OrderPreviewResponse>();
    expect(preview.estimated_price).toBe('2502.50');

    await freezePrice(ctx.app, 'ECOPETROL-CO', '2600.00');
    const order = (await placeOrder(ctx.app, session)).json<OrderResponse>();
    expect(order).toMatchObject({
      status: 'FILLED',
      executed_price: '2602.60',
      gross: '26026.00',
      total: '31026.00',
    });
    expect(await available(session)).toBe('68974.00');
  });

  it('si con el precio nuevo ya no alcanza, responde INSUFFICIENT_FUNDS', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '30025.00' } });
    expect((await previewOrder(ctx.app, session)).statusCode).toBe(200);
    await freezePrice(ctx.app, 'ECOPETROL-CO', '2600.00');
    expect((await placeOrder(ctx.app, session)).json()).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
  });
});

describe('idempotencia de órdenes', () => {
  it('misma clave y mismo cuerpo → misma respuesta y una sola orden', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const key = idempotencyKey();
    const first = await placeOrder(ctx.app, session, {}, key);
    const second = await placeOrder(ctx.app, session, {}, key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await countRows(session)).toEqual({ orders: 1, transactions: 3 });
    expect(await available(session)).toBe('69975.00');
    expect(await position(session, 'ECOPETROL-CO')).toMatchObject({ quantity: 10 });
  });

  it('la repetición devuelve la respuesta guardada aunque el estado haya cambiado', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '30025.00' } });
    const key = idempotencyKey();
    const first = await placeOrder(ctx.app, session, {}, key);
    expect(await available(session)).toBe('0.00');

    // Ya no hay saldo ni es el mismo precio: igual se responde la orden original.
    await freezePrice(ctx.app, 'ECOPETROL-CO', '9999.00');
    const retry = await placeOrder(ctx.app, session, {}, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect((await countRows(session)).orders).toBe(1);
  });

  it('misma clave y otro cuerpo → IDEMPOTENCY_CONFLICT', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const key = idempotencyKey();
    await placeOrder(ctx.app, session, {}, key);

    const response = await placeOrder(ctx.app, session, { quantity: 11 }, key);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await countRows(session)).orders).toBe(1);
  });

  it('una orden rechazada con error no consume la clave', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '1000.00' } });
    const key = idempotencyKey();
    expect((await placeOrder(ctx.app, session, {}, key)).statusCode).toBe(422);

    await post(
      ctx.app,
      `/accounts/COP/deposits`,
      { amount: '100000.00' },
      { ...session.headers, 'idempotency-key': idempotencyKey() },
    );
    const retry = await placeOrder(ctx.app, session, {}, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.json<OrderResponse>().status).toBe('FILLED');
  });

  it('la misma clave enviada en simultáneo ejecuta una sola orden', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '500000.00' } });
    const key = idempotencyKey();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => placeOrder(ctx.app, session, {}, key)),
    );

    expect(new Set(responses.map((response) => response.statusCode))).toEqual(new Set([201]));
    expect(new Set(responses.map((response) => response.json<OrderResponse>().id)).size).toBe(1);
    expect((await countRows(session)).orders).toBe(1);
    expect(await available(session)).toBe('469975.00');
  });
});

describe('rechazo al momento de ejecutar (REJECTED)', () => {
  it('dos compras que compiten por el mismo saldo: una FILLED y la otra REJECTED con 201', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '40000.00' } });

    const responses = await raceOnAccount(ctx.db, {
      userId: session.user.id,
      currency: 'COP',
      fire: () => [placeOrder(ctx.app, session), placeOrder(ctx.app, session)],
    });

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    const results = responses.map((response) => response.json<OrderResponse>());
    const filled = results.find((order) => order.status === 'FILLED');
    const rejected = results.find((order) => order.status === 'REJECTED');

    expect(filled).toMatchObject({
      executed_price: '2502.50',
      total: '30025.00',
      reject_code: null,
    });
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      reject_code: 'INSUFFICIENT_FUNDS',
      executed_price: null,
      filled_at: null,
      gross: '25025.00',
      commission: '5000.00',
      total: '30025.00',
    });

    // La rechazada quedó guardada, pero no movió dinero ni posiciones.
    expect(await countRows(session)).toEqual({ orders: 2, transactions: 3 });
    expect(await available(session)).toBe('9975.00');
    expect(await position(session, 'ECOPETROL-CO')).toMatchObject({ quantity: 10 });

    const stored = await get(ctx.app, `/orders/${rejected?.id ?? ''}`, session.headers);
    expect(stored.json()).toEqual(rejected);
    const onlyRejected = await get(ctx.app, '/orders?status=REJECTED', session.headers);
    expect(onlyRejected.json<Page<OrderResponse>>().items.map((order) => order.id)).toEqual([
      rejected?.id,
    ]);
  });

  it('dos ventas que compiten por la misma posición: la segunda queda INSUFFICIENT_POSITION', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { COP: '50000.00' },
      positions: [{ instrument_id: 'ECOPETROL-CO', quantity: 10, avg_cost: '2000.00' }],
    });

    const responses = await raceOnAccount(ctx.db, {
      userId: session.user.id,
      currency: 'COP',
      fire: () => [
        placeOrder(ctx.app, session, { side: 'SELL', quantity: 10 }),
        placeOrder(ctx.app, session, { side: 'SELL', quantity: 10 }),
      ],
    });

    const results = responses.map((response) => response.json<OrderResponse>());
    expect(results.map((order) => order.status).sort()).toEqual(['FILLED', 'REJECTED']);
    expect(results.find((order) => order.status === 'REJECTED')?.reject_code).toBe(
      'INSUFFICIENT_POSITION',
    );
    expect(await position(session, 'ECOPETROL-CO')).toBeUndefined();
  });

  it('si el mercado cierra mientras la orden espera, queda REJECTED con MARKET_CLOSED', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    await post(ctx.app, '/_testing/market/CO', { always_open: false });

    const [response] = await raceOnAccount(ctx.db, {
      userId: session.user.id,
      currency: 'COP',
      fire: () => [placeOrder(ctx.app, session)],
      beforeRelease: async () => {
        await post(ctx.app, '/_testing/clock', { now: '2026-11-18T21:00:05Z' });
      },
    });

    expect(response?.statusCode).toBe(201);
    expect(response?.json<OrderResponse>()).toMatchObject({
      status: 'REJECTED',
      reject_code: 'MARKET_CLOSED',
      executed_price: null,
      filled_at: null,
      created_at: '2026-11-18T21:00:05Z',
    });
    await post(ctx.app, '/_testing/clock', { now: null });
    expect(await available(session)).toBe('100000.00');
  });

  it('una orden rechazada se reproduce igual con la misma Idempotency-Key', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '40000.00' } });
    const keys = [idempotencyKey(), idempotencyKey()];
    const responses = await raceOnAccount(ctx.db, {
      userId: session.user.id,
      currency: 'COP',
      fire: () => keys.map((key) => placeOrder(ctx.app, session, {}, key)),
    });
    const rejectedIndex = responses.findIndex(
      (response) => response.json<OrderResponse>().status === 'REJECTED',
    );
    expect(rejectedIndex).toBeGreaterThanOrEqual(0);

    const replay = await placeOrder(ctx.app, session, {}, keys[rejectedIndex]);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(responses[rejectedIndex]?.json());
    expect((await countRows(session)).orders).toBe(2);
  });
});

describe('GET /orders y GET /orders/{id}', () => {
  it('lista las órdenes del usuario, de la más nueva a la más vieja, paginadas por cursor', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '1000000.00' } });
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ctx.clock.advance(1_000);
      created.push(
        (await placeOrder(ctx.app, session, { quantity: index + 1 })).json<OrderResponse>().id,
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await get(
        ctx.app,
        `/orders?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
        session.headers,
      );
      const page = response.json<Page<OrderResponse>>();
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((order) => order.id));
      cursor = page.next_cursor;
    } while (cursor !== null);

    expect(seen).toEqual([...created].reverse());

    const filled = await get(ctx.app, '/orders?status=FILLED&limit=100', session.headers);
    expect(filled.json<Page<OrderResponse>>().items).toHaveLength(5);
    const pending = await get(ctx.app, '/orders?status=PENDING', session.headers);
    expect(pending.json()).toEqual({ items: [], next_cursor: null });
  });

  it('el orden es estable aunque varias órdenes tengan el mismo created_at', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '1000000.00' } });
    for (let index = 0; index < 6; index += 1) await placeOrder(ctx.app, session, { quantity: 1 });

    const all = (await get(ctx.app, '/orders?limit=100', session.headers)).json<
      Page<OrderResponse>
    >().items;
    expect(new Set(all.map((order) => order.created_at)).size).toBe(1);
    expect(all.map((order) => order.id)).toEqual(
      [...all.map((order) => order.id)].sort().reverse(),
    );

    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<OrderResponse> = (
        await get(
          ctx.app,
          `/orders?limit=4${cursor === null ? '' : `&cursor=${cursor}`}`,
          session.headers,
        )
      ).json<Page<OrderResponse>>();
      paged.push(...page.items.map((order) => order.id));
      cursor = page.next_cursor;
    } while (cursor !== null);
    expect(paged).toEqual(all.map((order) => order.id));
  });

  it('una orden ajena o inexistente responde 404, no 403', async () => {
    const owner = await createFundedUser(ctx.app, { balances: { COP: '100000.00' } });
    const other = await createFundedUser(ctx.app);
    const order = (await placeOrder(ctx.app, owner)).json<OrderResponse>();

    const own = await get(ctx.app, `/orders/${order.id}`, owner.headers);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toEqual(order);

    const foreign = await get(ctx.app, `/orders/${order.id}`, other.headers);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'ORDER_NOT_FOUND' });

    const missing = await get(ctx.app, '/orders/ord_01JC0000000000000000009999', owner.headers);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'ORDER_NOT_FOUND' });

    expect((await get(ctx.app, '/orders', other.headers)).json()).toEqual({
      items: [],
      next_cursor: null,
    });
    expect((await get(ctx.app, '/orders/abc', owner.headers)).statusCode).toBe(422);
  });
});
