/**
 * Seed determinístico e idempotente (§10).
 *
 * - Siempre: cuentas de sistema e instrumentos de §8.7.
 * - Con `includeDemo`: el usuario demo con sus saldos y tres posiciones, creadas
 *   con journals y órdenes reales para que el ledger cuadre.
 *
 * Correrlo dos veces no cambia nada: cada fila se inserta solo si no existe.
 */
import { eq, sql } from 'drizzle-orm';
import { SystemClock } from '../core/clock.js';
import { loadConfig } from '../core/config.js';
import { USER_CURRENCIES, type UserCurrency } from '../core/domain.js';
import { createLogger } from '../core/logger.js';
import { formatAmount, formatStoredPrice, quantizeAmount, toDecimal } from '../core/money.js';
import { Security, documentLast4 } from '../core/security.js';
import { assertBalanced } from '../modules/accounts/ledger.js';
import { SYSTEM_ACCOUNT_KINDS, systemAccountCode } from '../modules/accounts/repository.js';
import { commissionFor } from '../modules/meta/rules.js';
import { createDb, type Db, type Tx } from './client.js';
import { isMainModule } from './run-script.js';
import {
  accounts,
  instruments,
  ledgerEntries,
  ledgerJournals,
  orders,
  positions,
  transactions,
  users,
} from './schema.js';
import {
  DEMO_HOLDINGS,
  DEMO_USER,
  SEED_CREATED_AT,
  SEED_DEPOSITS_AT,
  SEED_INSTRUMENTS,
  SEED_ORDERS_AT,
  instrumentDescription,
  seedId,
} from './seed-data.js';
import { withTransaction } from './transaction.js';

export interface SeedOptions {
  /** Crea el usuario demo. Los tests usan el seed mínimo, sin él. */
  includeDemo: boolean;
  security: Security;
}

/** Id literal de la cuenta de sistema `system:<kind>:<currency>`. */
export function systemAccountId(
  kind: (typeof SYSTEM_ACCOUNT_KINDS)[number],
  currency: UserCurrency,
): string {
  const sequence =
    SYSTEM_ACCOUNT_KINDS.indexOf(kind) * USER_CURRENCIES.length +
    USER_CURRENCIES.indexOf(currency) +
    1;
  return seedId('account', sequence);
}

/** Id literal de la cuenta del usuario demo en una moneda. */
export function demoAccountId(currency: UserCurrency): string {
  return seedId('account', 100 + USER_CURRENCIES.indexOf(currency) + 1);
}

async function seedSystemAccounts(tx: Tx): Promise<void> {
  const rows = SYSTEM_ACCOUNT_KINDS.flatMap((kind) =>
    USER_CURRENCIES.map((currency) => ({
      id: systemAccountId(kind, currency),
      userId: null,
      systemCode: systemAccountCode(kind, currency),
      currency,
      available: '0',
      reserved: '0',
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    })),
  );
  await tx.insert(accounts).values(rows).onConflictDoNothing();
}

async function seedInstruments(tx: Tx): Promise<void> {
  await tx
    .insert(instruments)
    .values(
      SEED_INSTRUMENTS.map((instrument) => ({
        id: `${instrument.ticker}-${instrument.country}`,
        ticker: instrument.ticker,
        name: instrument.name,
        country: instrument.country,
        type: instrument.type,
        currency: instrument.currency,
        basePrice: instrument.basePrice,
        dailyVolatilityPct: instrument.dailyVolatilityPct,
        baseVolume: instrument.baseVolume,
        description: instrumentDescription(instrument),
        createdAt: SEED_CREATED_AT,
      })),
    )
    .onConflictDoNothing();
}

async function addToAvailable(tx: Tx, accountId: string, delta: string, at: Date): Promise<void> {
  await tx
    .update(accounts)
    .set({ available: sql`${accounts.available} + ${delta}::numeric`, updatedAt: at })
    .where(eq(accounts.id, accountId));
}

async function seedDemoUser(tx: Tx, security: Security): Promise<void> {
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, DEMO_USER.id));
  if (existing !== undefined) return;

  await tx.insert(users).values({
    id: DEMO_USER.id,
    email: DEMO_USER.email,
    passwordHash: await security.hashPassword(DEMO_USER.password, DEMO_USER.passwordSalt),
    fullName: DEMO_USER.fullName,
    country: DEMO_USER.country,
    baseCurrency: DEMO_USER.baseCurrency,
    documentType: DEMO_USER.documentType,
    documentHash: security.documentHash(
      DEMO_USER.country,
      DEMO_USER.documentType,
      DEMO_USER.documentNumber,
    ),
    documentLast4: documentLast4(DEMO_USER.documentNumber),
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  });

  await tx.insert(accounts).values(
    USER_CURRENCIES.map((currency) => ({
      id: demoAccountId(currency),
      userId: DEMO_USER.id,
      systemCode: null,
      currency,
      available: '0',
      reserved: '0',
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    })),
  );

  for (const [index, holding] of DEMO_HOLDINGS.entries()) {
    const sequence = index + 1;
    const { currency } = holding;
    const userAccount = demoAccountId(currency);
    const price = toDecimal(holding.price);
    const gross = quantizeAmount(price.times(holding.quantity), currency);
    const commission = commissionFor(holding.country, gross);
    const total = gross.plus(commission);
    // Se deposita lo justo para que, después de la compra, quede el saldo del seed.
    const deposit = toDecimal(holding.balanceAfter).plus(total);

    // --- depósito: system:deposits → usuario ---
    const depositJournal = seedId('journal', sequence);
    const depositEntries = [
      { accountId: systemAccountId('deposits', currency), amount: deposit.negated(), currency },
      { accountId: userAccount, amount: deposit, currency },
    ];
    assertBalanced(depositEntries);
    await tx.insert(ledgerJournals).values({
      id: depositJournal,
      kind: 'DEPOSIT',
      description: `Depósito virtual ${currency}`,
      createdAt: SEED_DEPOSITS_AT,
    });
    await tx.insert(ledgerEntries).values(
      depositEntries.map((entry, entryIndex) => ({
        id: seedId('entry', sequence * 10 + entryIndex),
        journalId: depositJournal,
        accountId: entry.accountId,
        amount: formatAmount(entry.amount, currency),
        currency,
        createdAt: SEED_DEPOSITS_AT,
      })),
    );
    for (const entry of depositEntries) {
      await addToAvailable(
        tx,
        entry.accountId,
        formatAmount(entry.amount, currency),
        SEED_DEPOSITS_AT,
      );
    }
    await tx.insert(transactions).values({
      id: seedId('transaction', sequence * 10),
      userId: DEMO_USER.id,
      type: 'DEPOSIT',
      amount: formatAmount(deposit, currency),
      currency,
      description: 'Depósito virtual',
      orderId: null,
      journalId: depositJournal,
      createdAt: SEED_DEPOSITS_AT,
    });

    // --- compra: usuario → system:market (bruto) y system:fees (comisión) ---
    const orderId = seedId('order', sequence);
    const orderJournal = seedId('journal', 100 + sequence);
    const orderEntries = [
      { accountId: userAccount, amount: gross.negated(), currency },
      { accountId: systemAccountId('market', currency), amount: gross, currency },
      { accountId: userAccount, amount: commission.negated(), currency },
      { accountId: systemAccountId('fees', currency), amount: commission, currency },
    ];
    assertBalanced(orderEntries);

    await tx.insert(orders).values({
      id: orderId,
      userId: DEMO_USER.id,
      instrumentId: holding.instrumentId,
      side: 'BUY',
      type: 'MARKET',
      quantity: holding.quantity,
      limitPrice: null,
      status: 'FILLED',
      executedPrice: formatStoredPrice(price),
      gross: formatAmount(gross, currency),
      commission: formatAmount(commission, currency),
      total: formatAmount(total, currency),
      currency,
      rejectCode: null,
      realizedPnl: null,
      createdAt: SEED_ORDERS_AT,
      filledAt: SEED_ORDERS_AT,
    });
    await tx.insert(ledgerJournals).values({
      id: orderJournal,
      kind: 'ORDER',
      description: `Orden ${orderId}`,
      createdAt: SEED_ORDERS_AT,
    });
    await tx.insert(ledgerEntries).values(
      orderEntries.map((entry, entryIndex) => ({
        id: seedId('entry', 1000 + sequence * 10 + entryIndex),
        journalId: orderJournal,
        accountId: entry.accountId,
        amount: formatAmount(entry.amount, currency),
        currency,
        createdAt: SEED_ORDERS_AT,
      })),
    );
    for (const entry of orderEntries) {
      await addToAvailable(
        tx,
        entry.accountId,
        formatAmount(entry.amount, currency),
        SEED_ORDERS_AT,
      );
    }
    await tx.insert(positions).values({
      id: seedId('position', sequence),
      userId: DEMO_USER.id,
      instrumentId: holding.instrumentId,
      quantity: holding.quantity,
      avgCost: formatStoredPrice(price),
      currency,
      createdAt: SEED_ORDERS_AT,
      updatedAt: SEED_ORDERS_AT,
    });
    const label = `${String(holding.quantity)} ${holding.ticker}`;
    await tx.insert(transactions).values([
      {
        id: seedId('transaction', sequence * 10 + 1),
        userId: DEMO_USER.id,
        type: 'BUY',
        amount: formatAmount(gross.negated(), currency),
        currency,
        description: `Compra ${label}`,
        orderId,
        journalId: orderJournal,
        createdAt: SEED_ORDERS_AT,
      },
      {
        id: seedId('transaction', sequence * 10 + 2),
        userId: DEMO_USER.id,
        type: 'FEE',
        amount: formatAmount(commission.negated(), currency),
        currency,
        description: `Comisión compra ${label}`,
        orderId,
        journalId: orderJournal,
        createdAt: SEED_ORDERS_AT,
      },
    ]);
  }
}

export async function seedDatabase(db: Db, options: SeedOptions): Promise<void> {
  await withTransaction(db, async (tx) => {
    // Un solo seed a la vez: dos corridas simultáneas no pueden duplicar el usuario demo.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(727001)`);
    await seedSystemAccounts(tx);
    await seedInstruments(tx);
    if (options.includeDemo) await seedDemoUser(tx, options.security);
  });
}

/** Borra todos los datos (no el esquema). Lo usan los tests y `POST /_testing/reset`. */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      idempotency_records, transactions, positions, orders, ledger_entries,
      ledger_journals, refresh_tokens, accounts, instruments, users
    RESTART IDENTITY CASCADE
  `);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const handle = createDb(config);
  try {
    const security = new Security(config, new SystemClock());
    await seedDatabase(handle.db, { includeDemo: true, security });
    logger.info({ demoUser: DEMO_USER.email }, 'Seed aplicado');
  } catch (error) {
    logger.error({ err: error }, 'Falló el seed');
    process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
