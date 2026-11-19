import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { idempotencyRecords, ledgerEntries, transactions } from '../../src/db/schema.js';
import { IDEMPOTENCY_TTL_MS } from '../../src/core/idempotency.js';
import type { AccountResponse } from '../../src/modules/accounts/schemas.js';
import type { TransactionResponse } from '../../src/modules/transactions/schemas.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import {
  deposit,
  get,
  idempotencyKey,
  post,
  registerUser,
  type Session,
} from '../helpers/factories.js';
import { expectLedgerBalanced } from '../helpers/ledger.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await buildTestApp();
});

afterEach(async () => {
  // Invariantes del ledger después de cada escenario que mueve dinero.
  await expectLedgerBalanced(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

async function balances(session: Session): Promise<Record<string, string>> {
  const response = await get(ctx.app, '/accounts', session.headers);
  expect(response.statusCode).toBe(200);
  return Object.fromEntries(
    response.json<AccountResponse[]>().map((account) => [account.currency, account.available]),
  );
}

describe('GET /accounts', () => {
  it('requiere autenticación', async () => {
    expect((await get(ctx.app, '/accounts')).statusCode).toBe(401);
  });

  it('solo devuelve las cuentas del propio usuario', async () => {
    const alice = await registerUser(ctx.app);
    const bob = await registerUser(ctx.app);
    await deposit(ctx.app, alice, 'COP', '1000.00');

    expect(await balances(alice)).toEqual({ COP: '1000.00', MXN: '0.00', PEN: '0.00' });
    expect(await balances(bob)).toEqual({ COP: '0.00', MXN: '0.00', PEN: '0.00' });
    const aliceIds = (await get(ctx.app, '/accounts', alice.headers))
      .json<AccountResponse[]>()
      .map((a) => a.id);
    const bobIds = (await get(ctx.app, '/accounts', bob.headers))
      .json<AccountResponse[]>()
      .map((a) => a.id);
    expect(aliceIds.some((id) => bobIds.includes(id))).toBe(false);
  });
});

describe('POST /accounts/{currency}/deposits', () => {
  it('acredita la cuenta, registra el journal y devuelve la transacción DEPOSIT', async () => {
    const session = await registerUser(ctx.app);
    const response = await deposit(ctx.app, session, 'COP', '1500000.50');
    expect(response.statusCode).toBe(201);

    const transaction = response.json<TransactionResponse>();
    expect(transaction).toEqual({
      id: expect.stringMatching(/^txn_/) as string,
      type: 'DEPOSIT',
      amount: '1500000.50',
      currency: 'COP',
      description: 'Depósito virtual',
      order_id: null,
      created_at: '2026-11-18T15:00:00Z',
    });
    expect(await balances(session)).toEqual({ COP: '1500000.50', MXN: '0.00', PEN: '0.00' });

    // Doble partida: débito a system:deposits y crédito al usuario, que suman cero.
    const [row] = await ctx.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transaction.id));
    const entries = await ctx.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.journalId, row?.journalId ?? ''));
    expect(entries.map((entry) => entry.amount).sort()).toEqual(['-1500000.5000', '1500000.5000']);
  });

  it.each([
    ['COP', '100000000.00'],
    ['MXN', '500000.00'],
    ['PEN', '100000.00'],
  ])('acepta exactamente el máximo por depósito en %s', async (currency, amount) => {
    const session = await registerUser(ctx.app);
    expect((await deposit(ctx.app, session, currency, amount)).statusCode).toBe(201);
    expect((await balances(session))[currency]).toBe(amount);
  });

  it.each([
    ['COP', '100000000.01'],
    ['MXN', '500000.01'],
    ['PEN', '100000.01'],
  ])('por encima del máximo por depósito en %s → amount TOO_LARGE', async (currency, amount) => {
    const session = await registerUser(ctx.app);
    const response = await deposit(ctx.app, session, currency, amount);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'amount', code: 'TOO_LARGE' }],
    });
    expect((await balances(session))[currency]).toBe('0.00');
  });

  it('el acumulado por cuenta no puede superar 10 veces el máximo', async () => {
    const session = await registerUser(ctx.app);
    for (let index = 0; index < 10; index += 1) {
      expect((await deposit(ctx.app, session, 'PEN', '100000.00')).statusCode).toBe(201);
    }
    expect((await balances(session)).PEN).toBe('1000000.00');

    const response = await deposit(ctx.app, session, 'PEN', '0.01');
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'amount', code: 'TOO_LARGE' }],
    });
    // El límite es por cuenta: las otras monedas siguen aceptando depósitos.
    expect((await deposit(ctx.app, session, 'MXN', '10.00')).statusCode).toBe(201);
    expect((await balances(session)).PEN).toBe('1000000.00');
  });

  it('un monto como número JSON → VALIDATION_ERROR en amount', async () => {
    const session = await registerUser(ctx.app);
    const response = await deposit(ctx.app, session, 'COP', 1000);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'amount', code: 'INVALID_FORMAT' }],
    });
  });

  it.each([
    ['0', 'TOO_SMALL'],
    ['-10.00', 'TOO_SMALL'],
    ['abc', 'INVALID_FORMAT'],
    ['10.005', 'INVALID_FORMAT'],
  ])('amount = "%s" → %s', async (amount, code) => {
    const session = await registerUser(ctx.app);
    const response = await deposit(ctx.app, session, 'COP', amount);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'amount', code }],
    });
  });

  it('una moneda que no es de usuario → VALIDATION_ERROR en currency', async () => {
    const session = await registerUser(ctx.app);
    const response = await deposit(ctx.app, session, 'USD', '10.00');
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field: 'currency', code: 'NOT_ALLOWED' }] });
  });

  it('sin Idempotency-Key → VALIDATION_ERROR en el campo Idempotency-Key', async () => {
    const session = await registerUser(ctx.app);
    const missing = await post(
      ctx.app,
      '/accounts/COP/deposits',
      { amount: '10.00' },
      session.headers,
    );
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'Idempotency-Key', code: 'REQUIRED' }],
    });

    const malformed = await deposit(ctx.app, session, 'COP', '10.00', 'no-es-uuid');
    expect(malformed.statusCode).toBe(422);
    expect(malformed.json()).toMatchObject({
      errors: [{ field: 'Idempotency-Key', code: 'INVALID_FORMAT' }],
    });
    expect((await balances(session)).COP).toBe('0.00');
  });

  it('requiere autenticación', async () => {
    const response = await post(
      ctx.app,
      '/accounts/COP/deposits',
      { amount: '10.00' },
      { 'idempotency-key': idempotencyKey() },
    );
    expect(response.statusCode).toBe(401);
  });
});

describe('idempotencia de depósitos', () => {
  it('misma clave y mismo cuerpo → misma respuesta y un solo depósito', async () => {
    const session = await registerUser(ctx.app);
    const key = idempotencyKey();
    const first = await deposit(ctx.app, session, 'MXN', '250.00', key);
    const second = await deposit(ctx.app, session, 'MXN', '250.00', key);
    // El formato del monto no cambia la identidad de la petición.
    const third = await deposit(ctx.app, session, 'MXN', '250', key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(third.json()).toEqual(first.json());
    expect((await balances(session)).MXN).toBe('250.00');
  });

  it('misma clave y otro cuerpo → IDEMPOTENCY_CONFLICT', async () => {
    const session = await registerUser(ctx.app);
    const key = idempotencyKey();
    await deposit(ctx.app, session, 'MXN', '250.00', key);

    const otherAmount = await deposit(ctx.app, session, 'MXN', '300.00', key);
    expect(otherAmount.statusCode).toBe(409);
    expect(otherAmount.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const otherCurrency = await deposit(ctx.app, session, 'PEN', '250.00', key);
    expect(otherCurrency.statusCode).toBe(409);
    expect(await balances(session)).toEqual({ COP: '0.00', MXN: '250.00', PEN: '0.00' });
  });

  it('la clave es por usuario: otro usuario puede usar la misma', async () => {
    const alice = await registerUser(ctx.app);
    const bob = await registerUser(ctx.app);
    const key = idempotencyKey();
    const first = await deposit(ctx.app, alice, 'COP', '100.00', key);
    const second = await deposit(ctx.app, bob, 'COP', '999.00', key);
    expect(second.statusCode).toBe(201);
    expect(second.json<TransactionResponse>().id).not.toBe(first.json<TransactionResponse>().id);
    expect((await balances(bob)).COP).toBe('999.00');
  });

  it('una petición rechazada no consume la clave', async () => {
    const session = await registerUser(ctx.app);
    const key = idempotencyKey();
    expect((await deposit(ctx.app, session, 'COP', '100000000.01', key)).statusCode).toBe(422);
    expect((await deposit(ctx.app, session, 'COP', '100.00', key)).statusCode).toBe(201);
    expect((await balances(session)).COP).toBe('100.00');
  });

  it('la clave vale 24 horas: después se puede reutilizar', async () => {
    const session = await registerUser(ctx.app);
    const key = idempotencyKey();
    const first = await deposit(ctx.app, session, 'COP', '100.00', key);

    ctx.clock.advance(IDEMPOTENCY_TTL_MS - 60_000);
    // El access token ya venció: se entra de nuevo con otro usuario del mismo dueño de la clave.
    const [record] = await ctx.db
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.key, key));
    expect(record?.statusCode).toBe(201);

    const fresh = {
      ...session,
      headers: {
        authorization: `Bearer ${await ctx.security.signAccessToken(session.user.id, 'jti-1')}`,
      },
    };
    expect((await deposit(ctx.app, fresh, 'COP', '100.00', key)).json()).toEqual(first.json());

    ctx.clock.advance(120_000);
    const later = {
      ...session,
      headers: {
        authorization: `Bearer ${await ctx.security.signAccessToken(session.user.id, 'jti-2')}`,
      },
    };
    const reused = await deposit(ctx.app, later, 'COP', '70.00', key);
    expect(reused.statusCode).toBe(201);
    expect(reused.json<TransactionResponse>().id).not.toBe(first.json<TransactionResponse>().id);
    expect((await balances(later)).COP).toBe('170.00');
  });

  it('depósitos concurrentes con la misma Idempotency-Key acreditan una sola vez', async () => {
    const session = await registerUser(ctx.app);
    const key = idempotencyKey();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => deposit(ctx.app, session, 'COP', '5000.00', key)),
    );

    expect(responses.map((response) => response.statusCode)).toEqual(
      Array.from({ length: 12 }, () => 201),
    );
    const ids = new Set(responses.map((response) => response.json<TransactionResponse>().id));
    expect(ids.size).toBe(1);
    expect((await balances(session)).COP).toBe('5000.00');

    const rows = await ctx.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, session.user.id));
    expect(rows).toHaveLength(1);
  });

  it('depósitos concurrentes con claves distintas se acreditan todos', async () => {
    const session = await registerUser(ctx.app);
    const responses = await Promise.all(
      Array.from({ length: 15 }, () => deposit(ctx.app, session, 'COP', '1000.00')),
    );
    expect(responses.every((response) => response.statusCode === 201)).toBe(true);
    expect((await balances(session)).COP).toBe('15000.00');
  });
});
