import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Decimal } from '../../src/core/money.js';
import { accounts, ledgerEntries, orders, positions, transactions } from '../../src/db/schema.js';
import {
  MAX_TRANSACTION_RETRIES,
  isRetryableTransactionError,
  isUniqueViolation,
  pgConstraintName,
  pgErrorCode,
  withTransaction,
} from '../../src/db/transaction.js';
import type { OrderResponse } from '../../src/modules/orders/schemas.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { createFundedUser, deposit, freezePrice, placeOrder } from '../helpers/factories.js';
import { expectLedgerBalanced } from '../helpers/ledger.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await buildTestApp();
  await freezePrice(ctx.app, 'ECOPETROL-CO', '2500.00');
  await freezePrice(ctx.app, 'WALMEX-MX', '60.00');
});

afterEach(async () => {
  await expectLedgerBalanced(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

describe('20 órdenes de compra concurrentes que juntas superan el saldo', () => {
  it('terminan con saldo >= 0, sin órdenes fantasma y con el ledger cuadrado', async () => {
    // Cada orden cuesta 30.025,00 (bruto 25.025 + comisión 5.000): alcanza para 7 de las 20.
    const orderTotal = new Decimal('30025.00');
    const initial = new Decimal('220000.00');
    const session = await createFundedUser(ctx.app, { balances: { COP: initial.toFixed(2) } });

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => placeOrder(ctx.app, session)),
    );

    // Cada respuesta es una orden creada (201) o un rechazo previo sin orden (422).
    const created = responses
      .filter((response) => response.statusCode === 201)
      .map((response) => response.json<OrderResponse>());
    const refused = responses.filter((response) => response.statusCode === 422);
    expect(created.length + refused.length).toBe(20);
    for (const response of refused)
      expect(response.json()).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    const filled = created.filter((order) => order.status === 'FILLED');
    const rejected = created.filter((order) => order.status === 'REJECTED');
    expect(filled.length + rejected.length).toBe(created.length);
    for (const order of rejected) expect(order.reject_code).toBe('INSUFFICIENT_FUNDS');

    // Se ejecutaron exactamente las que el saldo permitía: ni una más, ni una menos.
    expect(filled).toHaveLength(7);
    for (const order of filled) expect(order.total).toBe('30025.00');

    // Saldo final exacto y no negativo.
    const [account] = await ctx.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, session.user.id), eq(accounts.currency, 'COP')));
    const balance = new Decimal(account?.available ?? 'NaN');
    expect(balance.greaterThanOrEqualTo(0)).toBe(true);
    expect(balance.toFixed(2)).toBe(initial.minus(orderTotal.times(7)).toFixed(2));

    // Sin órdenes fantasma: en la base hay exactamente las órdenes que se respondieron.
    const stored = await ctx.db.select().from(orders).where(eq(orders.userId, session.user.id));
    expect(stored).toHaveLength(created.length);
    expect(stored.map((order) => order.id).sort()).toEqual(created.map((order) => order.id).sort());
    expect(stored.filter((order) => order.status === 'FILLED')).toHaveLength(7);

    // La posición refleja solo las órdenes ejecutadas.
    const [position] = await ctx.db
      .select()
      .from(positions)
      .where(eq(positions.userId, session.user.id));
    expect(position).toMatchObject({ quantity: 70, avgCost: '2502.500000' });

    // Cada orden ejecutada tiene su BUY y su FEE; las rechazadas, ninguna transacción.
    const movements = await ctx.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, session.user.id));
    const byOrder = new Map<string, string[]>();
    for (const movement of movements) {
      if (movement.orderId === null) continue;
      byOrder.set(
        movement.orderId,
        [...(byOrder.get(movement.orderId) ?? []), movement.type].sort(),
      );
    }
    expect([...byOrder.keys()].sort()).toEqual(filled.map((order) => order.id).sort());
    for (const types of byOrder.values()) expect(types).toEqual(['BUY', 'FEE']);

    // Lo que salió de la cuenta del usuario es exactamente lo que dicen sus entradas del ledger.
    const [ledger] = await ctx.db
      .select({ total: sql<string>`SUM(${ledgerEntries.amount})::text` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, account?.id ?? ''));
    expect(new Decimal(ledger?.total ?? 'NaN').equals(balance)).toBe(true);
  });

  it('compras y ventas concurrentes del mismo usuario no pierden ni duplican acciones', async () => {
    const session = await createFundedUser(ctx.app, {
      balances: { COP: '500000.00' },
      positions: [{ instrument_id: 'ECOPETROL-CO', quantity: 50, avg_cost: '2000.00' }],
    });

    const responses = await Promise.all([
      ...Array.from({ length: 8 }, () =>
        placeOrder(ctx.app, session, { side: 'BUY', quantity: 5 }),
      ),
      ...Array.from({ length: 8 }, () =>
        placeOrder(ctx.app, session, { side: 'SELL', quantity: 5 }),
      ),
    ]);

    const filled = responses
      .filter((response) => response.statusCode === 201)
      .map((response) => response.json<OrderResponse>())
      .filter((order) => order.status === 'FILLED');
    const bought = filled.filter((order) => order.side === 'BUY').length * 5;
    const sold = filled.filter((order) => order.side === 'SELL').length * 5;
    expect(filled).toHaveLength(16);

    const [position] = await ctx.db
      .select()
      .from(positions)
      .where(eq(positions.userId, session.user.id));
    expect(position?.quantity).toBe(50 + bought - sold);
  });

  it('usuarios distintos operando a la vez no se bloquean ni se mezclan', async () => {
    const sessions = await Promise.all(
      Array.from({ length: 6 }, () =>
        createFundedUser(ctx.app, { balances: { COP: '100000.00', MXN: '10000.00' } }),
      ),
    );

    const responses = await Promise.all(
      sessions.flatMap((session) => [
        placeOrder(ctx.app, session),
        placeOrder(ctx.app, session, { instrument_id: 'WALMEX-MX', quantity: 10 }),
        deposit(ctx.app, session, 'COP', '1000.00'),
      ]),
    );
    expect(responses.every((response) => response.statusCode === 201)).toBe(true);

    for (const session of sessions) {
      const rows = await ctx.db.select().from(accounts).where(eq(accounts.userId, session.user.id));
      const byCurrency = Object.fromEntries(rows.map((row) => [row.currency, row.available]));
      // COP: 100.000 − 30.025 + 1.000. MXN: 10.000 − (600,60 + 17,40).
      expect(byCurrency).toEqual({ COP: '70975.0000', MXN: '9382.0000', PEN: '0.0000' });
    }
  });
});

describe('withTransaction', () => {
  const pgError = (code: string, constraint?: string): Error =>
    Object.assign(new Error(`pg ${code}`), {
      code,
      ...(constraint === undefined ? {} : { constraint }),
    });

  it('reintenta ante deadlock y fallo de serialización, y devuelve el resultado', async () => {
    for (const code of ['40P01', '40001']) {
      let attempts = 0;
      const retries: number[] = [];
      const result = await withTransaction(
        ctx.db,
        () => {
          attempts += 1;
          return attempts < 3 ? Promise.reject(pgError(code)) : Promise.resolve('ok');
        },
        { onRetry: (attempt) => retries.push(attempt) },
      );
      expect(result).toBe('ok');
      expect(attempts).toBe(3);
      expect(retries).toEqual([1, 2]);
    }
  });

  it('se rinde después de 3 reintentos', async () => {
    let attempts = 0;
    await expect(
      withTransaction(ctx.db, () => {
        attempts += 1;
        return Promise.reject(pgError('40P01'));
      }),
    ).rejects.toThrow('pg 40P01');
    expect(attempts).toBe(MAX_TRANSACTION_RETRIES + 1);
  });

  it('no reintenta otros errores y revierte lo escrito', async () => {
    let attempts = 0;
    const session = await createFundedUser(ctx.app, { balances: { COP: '100.00' } });
    await expect(
      withTransaction(ctx.db, async (tx) => {
        attempts += 1;
        await tx
          .update(accounts)
          .set({ available: '999.0000' })
          .where(eq(accounts.userId, session.user.id));
        throw new Error('regla de negocio');
      }),
    ).rejects.toThrow('regla de negocio');
    expect(attempts).toBe(1);

    const [account] = await ctx.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, session.user.id), eq(accounts.currency, 'COP')));
    expect(account?.available).toBe('100.0000');
  });

  it('reconoce el código y la restricción aunque drizzle envuelva el error', () => {
    const wrapped = new Error('Failed query', { cause: pgError('23505', 'uq_users_email') });
    expect(pgErrorCode(wrapped)).toBe('23505');
    expect(pgConstraintName(wrapped)).toBe('uq_users_email');
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, 'uq_users_email')).toBe(true);
    expect(isUniqueViolation(wrapped, 'uq_users_document_hash')).toBe(false);
    expect(isUniqueViolation(pgError('40001'))).toBe(false);
    expect(isRetryableTransactionError(new Error('x', { cause: pgError('40001') }))).toBe(true);
    expect(isRetryableTransactionError(new Error('sin código'))).toBe(false);
    expect(pgErrorCode('no es un error')).toBeUndefined();
    expect(pgErrorCode({ code: 'ECONNRESET' })).toBeUndefined();
    expect(pgConstraintName(pgError('23505'))).toBeUndefined();
  });

  it('la base rechaza un saldo de usuario negativo (CHECK)', async () => {
    const session = await createFundedUser(ctx.app, { balances: { COP: '100.00' } });
    const attempt = ctx.db
      .update(accounts)
      .set({ available: '-0.0100' })
      .where(and(eq(accounts.userId, session.user.id), eq(accounts.currency, 'COP')));
    await expect(attempt).rejects.toSatisfy(
      (error: unknown) =>
        pgErrorCode(error) === '23514' && pgConstraintName(error) === 'ck_accounts_non_negative',
    );
  });
});
