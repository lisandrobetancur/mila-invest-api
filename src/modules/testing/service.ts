/**
 * Control de escenarios para QA (§11): reset de datos, reloj, estado del
 * mercado, precios congelados y usuarios con saldos y posiciones a medida.
 *
 * Solo se construye y se registra si `APP_ENV` es `dev` o `test`.
 */
import { createHash } from 'node:crypto';
import { isControllableClock, toIsoUtc, type Clock } from '../../core/clock.js';
import { USER_CURRENCIES, type Country, type DocumentType } from '../../core/domain.js';
import { AppError } from '../../core/errors.js';
import type { IdGenerator } from '../../core/ids.js';
import {
  ZERO,
  formatAmount,
  formatPrice,
  formatStoredPrice,
  quantizeAmount,
  toDecimal,
  type Decimal,
  type DecimalString,
} from '../../core/money.js';
import type { Security } from '../../core/security.js';
import type { Db, Tx } from '../../db/client.js';
import { seedDatabase, truncateAll } from '../../db/seed.js';
import { withTransaction } from '../../db/transaction.js';
import type { Ledger } from '../accounts/ledger.js';
import type { AccountsRepository } from '../accounts/repository.js';
import type { RegisterResponse } from '../auth/schemas.js';
import type { AuthService } from '../auth/service.js';
import type { MarketService } from '../market/service.js';
import type { InstrumentRow } from '../market/table.js';
import type { MetaService } from '../meta/service.js';
import type { OrdersRepository } from '../orders/repository.js';
import type { PositionsRepository } from '../portfolio/repository.js';
import type { TransactionsRepository } from '../transactions/repository.js';
import type {
  ClockResponse,
  CreateTestUserBody,
  LedgerCheckResponse,
  MarketOverrideResponse,
  PriceOverrideResponse,
} from './schemas.js';

const DOCUMENT_TYPE_BY_COUNTRY: Readonly<Record<Country, DocumentType>> = {
  CO: 'CC',
  MX: 'CURP',
  PE: 'DNI',
};

/** Número de documento válido para el país, derivado de una semilla única. */
export function fakeDocumentFor(country: Country, seed: string): string {
  const hash = createHash('sha256').update(seed, 'utf8').digest();
  const digits = (count: number, offset: number): string =>
    Array.from({ length: count }, (_, index) => String((hash[offset + index] ?? 0) % 10)).join('');
  const letters = (count: number, offset: number): string =>
    Array.from({ length: count }, (_, index) =>
      String.fromCharCode(65 + ((hash[offset + index] ?? 0) % 26)),
    ).join('');

  if (country === 'CO') return `1${digits(9, 0)}`;
  if (country === 'PE') return digits(8, 0);
  return `${letters(4, 0)}${digits(6, 4)}H${letters(5, 10)}0${digits(1, 15)}`;
}

export interface TestingDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  security: Security;
  meta: MetaService;
  market: MarketService;
  auth: AuthService;
  ledger: Ledger;
  accounts: AccountsRepository;
  orders: OrdersRepository;
  positions: PositionsRepository;
  transactions: TransactionsRepository;
}

export class TestingService {
  public constructor(private readonly deps: TestingDeps) {}

  /** Trunca los datos, vuelve a correr el seed y quita todos los overrides en memoria. */
  public async reset(): Promise<void> {
    const { db, security, meta, market, clock } = this.deps;
    await truncateAll(db);
    await seedDatabase(db, { includeDemo: true, security });
    meta.clearOverrides();
    market.clearFrozenPrices();
    if (isControllableClock(clock)) clock.freeze(null);
  }

  public setClock(now: string | null): ClockResponse {
    const { clock } = this.deps;
    if (!isControllableClock(clock)) {
      throw new AppError('INTERNAL_ERROR', { detail: 'El reloj de la app no es controlable' });
    }
    clock.freeze(now);
    return { now: toIsoUtc(clock.now()), frozen: clock.isFrozen };
  }

  public setMarket(country: Country, alwaysOpen: boolean | null): MarketOverrideResponse {
    const { meta } = this.deps;
    meta.setAlwaysOpenOverride(country, alwaysOpen);
    const state = meta.marketState(country);
    return {
      country,
      always_open: meta.isAlwaysOpen(country),
      market: {
        status: state.status,
        opens_at: toIsoUtc(state.session.open),
        closes_at: toIsoUtc(state.session.close),
      },
    };
  }

  public async setPrice(
    instrumentId: string,
    price: DecimalString | null,
  ): Promise<PriceOverrideResponse> {
    const { market } = this.deps;
    const instrument = await market.freezePrice(instrumentId, price);
    return {
      instrument_id: instrument.id,
      frozen: price !== null,
      last_price: formatPrice(market.snapshot(instrument).lastPrice),
    };
  }

  /**
   * Crea un usuario con los saldos y posiciones pedidos y devuelve sus tokens.
   * Todo pasa por el ledger: los saldos entran como depósitos y las posiciones
   * como compras sin comisión, así las invariantes siguen valiendo.
   */
  public async createUser(body: CreateTestUserBody): Promise<RegisterResponse> {
    const { db, ids, auth, market } = this.deps;
    const unique = ids.ulid().toLowerCase();

    const instruments = await market.findInstruments(
      db,
      body.positions.map((position) => position.instrument_id),
    );
    for (const position of body.positions) {
      if (!instruments.has(position.instrument_id)) {
        throw new AppError('INSTRUMENT_NOT_FOUND', {
          detail: `No existe el instrumento ${position.instrument_id}`,
        });
      }
    }

    const registered = await auth.register({
      email: body.email ?? `qa+${unique}@example.com`,
      password: body.password,
      full_name: body.full_name,
      country: body.country,
      document_type: DOCUMENT_TYPE_BY_COUNTRY[body.country],
      document_number: fakeDocumentFor(body.country, unique),
    });

    await withTransaction(db, async (tx) => {
      for (const currency of USER_CURRENCIES) {
        const balance = body.balances[currency];
        if (balance !== undefined) {
          await this.fund(tx, registered.user.id, currency, toDecimal(balance));
        }
      }
      for (const position of body.positions) {
        const instrument = instruments.get(position.instrument_id);
        if (instrument !== undefined) {
          await this.grantPosition(tx, registered.user.id, instrument, position);
        }
      }
    });

    return registered;
  }

  private async fund(
    tx: Tx,
    userId: string,
    currency: (typeof USER_CURRENCIES)[number],
    rawAmount: Decimal,
  ): Promise<void> {
    const { accounts, ledger, transactions, ids, clock } = this.deps;
    const amount = quantizeAmount(rawAmount, currency);
    if (amount.lessThanOrEqualTo(ZERO)) return;

    const account = await accounts.findUserAccountForUpdate(tx, userId, currency);
    const system = await accounts.findSystemAccount(tx, 'deposits', currency);
    if (account === undefined || system === undefined) {
      throw new AppError('INTERNAL_ERROR', { detail: `Faltan cuentas ${currency}` });
    }
    const journalId = await ledger.post(tx, {
      kind: 'DEPOSIT',
      description: `Depósito de prueba ${currency}`,
      entries: [
        { accountId: system.id, amount: amount.negated(), currency },
        { accountId: account.id, amount, currency },
      ],
    });
    await transactions.insert(tx, {
      id: ids.next('transaction'),
      userId,
      type: 'DEPOSIT',
      amount: formatAmount(amount, currency),
      currency,
      description: 'Depósito virtual',
      orderId: null,
      journalId,
      createdAt: clock.now(),
    });
  }

  private async grantPosition(
    tx: Tx,
    userId: string,
    instrument: InstrumentRow,
    input: { quantity: number; avg_cost?: DecimalString },
  ): Promise<void> {
    const { accounts, ledger, orders, positions, transactions, ids, clock, market } = this.deps;
    const { currency } = instrument;
    const price =
      input.avg_cost === undefined
        ? market.snapshot(instrument).lastPrice
        : toDecimal(input.avg_cost);
    const gross = quantizeAmount(price.times(input.quantity), currency);

    // Primero se deposita el costo, para que la compra no altere el saldo pedido.
    await this.fund(tx, userId, currency, gross);

    const account = await accounts.findUserAccountForUpdate(tx, userId, currency);
    const marketAccount = await accounts.findSystemAccount(tx, 'market', currency);
    if (account === undefined || marketAccount === undefined) {
      throw new AppError('INTERNAL_ERROR', { detail: `Faltan cuentas ${currency}` });
    }

    const now = clock.now();
    const order = await orders.insert(tx, {
      id: ids.next('order'),
      userId,
      instrumentId: instrument.id,
      side: 'BUY',
      type: 'MARKET',
      quantity: input.quantity,
      limitPrice: null,
      status: 'FILLED',
      executedPrice: formatStoredPrice(price),
      gross: formatAmount(gross, currency),
      commission: formatAmount(ZERO, currency),
      total: formatAmount(gross, currency),
      currency,
      rejectCode: null,
      realizedPnl: null,
      createdAt: now,
      filledAt: now,
    });
    const journalId = await ledger.post(tx, {
      kind: 'ORDER',
      description: `Orden ${order.id}`,
      entries: [
        { accountId: account.id, amount: gross.negated(), currency },
        { accountId: marketAccount.id, amount: gross, currency },
      ],
    });
    await positions.insert(tx, {
      id: ids.next('position'),
      userId,
      instrumentId: instrument.id,
      quantity: input.quantity,
      avgCost: formatStoredPrice(price),
      currency,
      createdAt: now,
      updatedAt: now,
    });
    await transactions.insert(tx, {
      id: ids.next('transaction'),
      userId,
      type: 'BUY',
      amount: formatAmount(gross.negated(), currency),
      currency,
      description: `Compra ${String(input.quantity)} ${instrument.ticker}`,
      orderId: order.id,
      journalId,
      createdAt: now,
    });
  }

  /** Verifica las invariantes del ledger (§6) sobre toda la base. */
  public async checkLedger(): Promise<LedgerCheckResponse> {
    const { db, accounts } = this.deps;
    const [checks, unbalanced] = await Promise.all([
      accounts.balanceChecks(db),
      accounts.unbalancedJournals(db),
    ]);
    const mismatched = checks.filter((check) => !toDecimal(check.cached).equals(check.ledger));
    return {
      balanced: mismatched.length === 0 && unbalanced.length === 0,
      accounts_checked: checks.length,
      mismatched_accounts: mismatched.map((check) => ({
        account_id: check.accountId,
        cached: toDecimal(check.cached).toFixed(2),
        ledger: toDecimal(check.ledger).toFixed(2),
      })),
      unbalanced_journals: [...new Set(unbalanced.map((journal) => journal.journalId))],
    };
  }
}
