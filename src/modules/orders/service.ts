import { toIsoUtc, type Clock } from '../../core/clock.js';
import type { OrderSide, OrderWarning, UserCurrency } from '../../core/domain.js';
import { AppError } from '../../core/errors.js';
import type { IdGenerator } from '../../core/ids.js';
import type { IdempotencyService, IdempotentResult } from '../../core/idempotency.js';
import {
  formatAmount,
  formatPrice,
  formatStoredPrice,
  quantizeAmount,
  toDecimal,
  type Decimal,
} from '../../core/money.js';
import { buildPage, decodeCursor, type Page } from '../../core/pagination.js';
import type { Db, DbExecutor, Tx } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import type { Ledger } from '../accounts/ledger.js';
import type { AccountsRepository } from '../accounts/repository.js';
import type { AccountRow } from '../accounts/table.js';
import type { MarketService } from '../market/service.js';
import type { InstrumentRow } from '../market/table.js';
import type { MetaService } from '../meta/service.js';
import type { PositionsRepository } from '../portfolio/repository.js';
import type { PositionRow } from '../portfolio/table.js';
import type { TransactionsRepository } from '../transactions/repository.js';
import {
  insufficientFunds,
  insufficientPosition,
  marketClosed,
  orderNotFound,
  type RejectCode,
} from './errors.js';
import type { OrdersRepository } from './repository.js';
import type {
  CreateOrderBody,
  ListOrdersQuery,
  OrderPreviewResponse,
  OrderResponse,
} from './schemas.js';
import type { OrderRow } from './table.js';

/** Importes de una orden a un precio dado. */
export interface OrderAmounts {
  price: Decimal;
  gross: Decimal;
  commission: Decimal;
  /** Compra: bruto + comisión (lo que se debita). Venta: bruto − comisión (lo que se acredita). */
  total: Decimal;
}

export function toOrderResponse(row: OrderRow): OrderResponse {
  return {
    id: row.id,
    instrument_id: row.instrumentId,
    side: row.side,
    type: row.type,
    quantity: row.quantity,
    status: row.status,
    executed_price: row.executedPrice === null ? null : formatPrice(row.executedPrice),
    gross: formatAmount(row.gross, row.currency),
    commission: formatAmount(row.commission, row.currency),
    total: formatAmount(row.total, row.currency),
    currency: row.currency,
    reject_code: row.rejectCode,
    created_at: toIsoUtc(row.createdAt),
    filled_at: row.filledAt === null ? null : toIsoUtc(row.filledAt),
  };
}

export class OrdersService {
  public constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly idempotency: IdempotencyService,
    private readonly meta: MetaService,
    private readonly market: MarketService,
    private readonly ledger: Ledger,
    private readonly orders: OrdersRepository,
    private readonly accounts: AccountsRepository,
    private readonly positions: PositionsRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  // ---------- cálculo ----------

  /** Precio de ejecución (último ± spread), bruto, comisión y total, en este instante. */
  public amountsFor(instrument: InstrumentRow, side: OrderSide, quantity: number): OrderAmounts {
    const { lastPrice } = this.market.snapshot(instrument);
    const price = this.meta.executionPrice(lastPrice, side);
    const gross = quantizeAmount(price.times(quantity), instrument.currency);
    const commission = this.meta.commission(instrument.country, gross);
    const total = side === 'BUY' ? gross.plus(commission) : gross.minus(commission);
    return { price, gross, commission, total };
  }

  /** Motivo por el que la orden no puede ejecutarse con este saldo y posición, si lo hay. */
  private rejectionFor(
    side: OrderSide,
    quantity: number,
    amounts: OrderAmounts,
    available: Decimal,
    held: number,
  ): Exclude<RejectCode, 'MARKET_CLOSED'> | null {
    if (side === 'BUY') {
      return available.lessThan(amounts.total) ? 'INSUFFICIENT_FUNDS' : null;
    }
    if (held < quantity) return 'INSUFFICIENT_POSITION';
    // Una venta chica puede no cubrir la comisión mínima: el neto negativo sale del saldo.
    return available.plus(amounts.total).isNegative() ? 'INSUFFICIENT_FUNDS' : null;
  }

  private rejectionError(
    code: Exclude<RejectCode, 'MARKET_CLOSED'>,
    instrument: InstrumentRow,
    available: Decimal,
    held: number,
  ): AppError {
    return code === 'INSUFFICIENT_FUNDS'
      ? insufficientFunds(available, instrument.currency)
      : insufficientPosition(held, instrument.ticker);
  }

  private async requireAccount(
    executor: DbExecutor,
    userId: string,
    currency: UserCurrency,
    lock: boolean,
  ): Promise<AccountRow> {
    const account = lock
      ? await this.accounts.findUserAccountForUpdate(executor, userId, currency)
      : await this.accounts.findUserAccount(executor, userId, currency);
    if (account === undefined) {
      throw new AppError('INTERNAL_ERROR', { detail: `El usuario no tiene cuenta en ${currency}` });
    }
    return account;
  }

  // ---------- preview ----------

  /** Calcula lo mismo que la ejecución, sin escribir nada (§8.4). */
  public async preview(userId: string, body: CreateOrderBody): Promise<OrderPreviewResponse> {
    const instrument = await this.market.requireInstrument(this.db, body.instrument_id);
    if (!this.meta.isMarketOpen(instrument.country)) throw marketClosed(instrument.country);

    const amounts = this.amountsFor(instrument, body.side, body.quantity);
    const account = await this.requireAccount(this.db, userId, instrument.currency, false);
    const position = await this.positions.find(this.db, userId, instrument.id);
    const available = toDecimal(account.available);
    const held = position?.quantity ?? 0;

    const rejection = this.rejectionFor(body.side, body.quantity, amounts, available, held);
    if (rejection !== null) throw this.rejectionError(rejection, instrument, available, held);

    const warnings: OrderWarning[] = [];
    if (this.meta.isClosingSoon(instrument.country)) warnings.push('MARKET_CLOSING_SOON');
    warnings.push('PRICE_MAY_CHANGE');

    const availableAfter =
      body.side === 'BUY' ? available.minus(amounts.total) : available.plus(amounts.total);
    return {
      estimated_price: formatPrice(amounts.price),
      gross: formatAmount(amounts.gross, instrument.currency),
      commission: formatAmount(amounts.commission, instrument.currency),
      total: formatAmount(amounts.total, instrument.currency),
      currency: instrument.currency,
      available_after: formatAmount(availableAfter, instrument.currency),
      warnings,
    };
  }

  // ---------- ejecución ----------

  /**
   * Ejecuta una orden a mercado en **una sola transacción** (§8.4):
   *
   * 1. Registro de idempotencia (una repetición devuelve la respuesta guardada).
   * 2. Chequeos previos sin bloqueo: si el mercado está cerrado o no alcanza el
   *    saldo o la posición, responde el error y **no crea orden**.
   * 3. Bloqueo de la cuenta y después de la posición (`FOR UPDATE`, siempre en
   *    ese orden), y recálculo del precio en ese instante.
   * 4. Si con los datos bloqueados ya no alcanza (otra orden concurrente se
   *    adelantó), la orden queda `REJECTED` con su `reject_code` y se responde 201.
   * 5. Si alcanza: journal, posición, orden `FILLED` y transacciones.
   */
  public async create(
    userId: string,
    body: CreateOrderBody,
    idempotencyKey: string,
  ): Promise<IdempotentResult<OrderResponse>> {
    const requestHash = this.idempotency.hashRequest('POST /orders', {
      instrument_id: body.instrument_id,
      side: body.side,
      type: body.type,
      quantity: body.quantity,
    });

    return withTransaction(this.db, (tx) =>
      this.idempotency.run(tx, { userId, key: idempotencyKey, requestHash }, async () => {
        const order = await this.execute(tx, userId, body);
        return { statusCode: 201, body: toOrderResponse(order) };
      }),
    );
  }

  private async execute(tx: Tx, userId: string, body: CreateOrderBody): Promise<OrderRow> {
    const instrument = await this.market.requireInstrument(tx, body.instrument_id);
    const { side, quantity } = body;

    // Paso 2: rechazos detectables antes de crear la orden.
    if (!this.meta.isMarketOpen(instrument.country)) throw marketClosed(instrument.country);
    {
      const account = await this.requireAccount(tx, userId, instrument.currency, false);
      const position = await this.positions.find(tx, userId, instrument.id);
      const available = toDecimal(account.available);
      const held = position?.quantity ?? 0;
      const amounts = this.amountsFor(instrument, side, quantity);
      const rejection = this.rejectionFor(side, quantity, amounts, available, held);
      if (rejection !== null) throw this.rejectionError(rejection, instrument, available, held);
    }

    // Paso 3: bloqueos en orden fijo (cuenta, después posición) y recálculo.
    const account = await this.requireAccount(tx, userId, instrument.currency, true);
    const position = await this.positions.findForUpdate(tx, userId, instrument.id);
    const now = this.clock.now();
    const amounts = this.amountsFor(instrument, side, quantity);
    const available = toDecimal(account.available);
    const held = position?.quantity ?? 0;

    const rejectCode: RejectCode | null = this.meta.isMarketOpen(instrument.country)
      ? this.rejectionFor(side, quantity, amounts, available, held)
      : 'MARKET_CLOSED';

    const base = {
      id: this.ids.next('order'),
      userId,
      instrumentId: instrument.id,
      side,
      type: body.type,
      quantity,
      limitPrice: null,
      gross: formatAmount(amounts.gross, instrument.currency),
      commission: formatAmount(amounts.commission, instrument.currency),
      total: formatAmount(amounts.total, instrument.currency),
      currency: instrument.currency,
      createdAt: now,
    };

    // Paso 4: rechazo al momento de ejecutar.
    if (rejectCode !== null) {
      return this.orders.insert(tx, {
        ...base,
        status: 'REJECTED',
        executedPrice: null,
        rejectCode,
        realizedPnl: null,
        filledAt: null,
      });
    }

    // Paso 5: ejecución.
    const realizedPnl = await this.applyToPosition(tx, {
      userId,
      instrument,
      position,
      side,
      quantity,
      price: amounts.price,
      now,
    });

    const order = await this.orders.insert(tx, {
      ...base,
      status: 'FILLED',
      executedPrice: formatStoredPrice(amounts.price),
      rejectCode: null,
      realizedPnl: realizedPnl === null ? null : formatAmount(realizedPnl, instrument.currency),
      filledAt: now,
    });

    const journalId = await this.postJournal(tx, order.id, instrument, account, side, amounts);
    await this.recordTransactions(tx, order, instrument, journalId, amounts, now);
    return order;
  }

  /**
   * Compra: costo promedio ponderado. Venta: no cambia el costo promedio y
   * devuelve la ganancia realizada; si la cantidad llega a 0, borra la posición.
   */
  private async applyToPosition(
    tx: Tx,
    input: {
      userId: string;
      instrument: InstrumentRow;
      position: PositionRow | undefined;
      side: OrderSide;
      quantity: number;
      price: Decimal;
      now: Date;
    },
  ): Promise<Decimal | null> {
    const { position, instrument, quantity, price, now } = input;

    if (input.side === 'BUY') {
      if (position === undefined) {
        await this.positions.insert(tx, {
          id: this.ids.next('position'),
          userId: input.userId,
          instrumentId: instrument.id,
          quantity,
          avgCost: formatStoredPrice(price),
          currency: instrument.currency,
          createdAt: now,
          updatedAt: now,
        });
        return null;
      }
      const totalQuantity = position.quantity + quantity;
      const totalCost = toDecimal(position.avgCost)
        .times(position.quantity)
        .plus(price.times(quantity));
      await this.positions.update(tx, position.id, {
        quantity: totalQuantity,
        avgCost: formatStoredPrice(totalCost.dividedBy(totalQuantity)),
        updatedAt: now,
      });
      return null;
    }

    if (position === undefined) {
      throw new AppError('INTERNAL_ERROR', { detail: 'Venta sin posición bloqueada' });
    }
    const remaining = position.quantity - quantity;
    if (remaining === 0) {
      await this.positions.delete(tx, position.id);
    } else {
      await this.positions.update(tx, position.id, {
        quantity: remaining,
        avgCost: position.avgCost,
        updatedAt: now,
      });
    }
    return quantizeAmount(price.minus(position.avgCost).times(quantity), instrument.currency);
  }

  /**
   * Compra: débito al usuario por bruto + comisión; crédito a `system:market`
   * por el bruto y a `system:fees` por la comisión. Venta: al revés, con la
   * comisión descontada del neto.
   */
  private async postJournal(
    tx: Tx,
    orderId: string,
    instrument: InstrumentRow,
    account: AccountRow,
    side: OrderSide,
    amounts: OrderAmounts,
  ): Promise<string> {
    const currency = instrument.currency;
    const marketAccount = await this.accounts.findSystemAccount(tx, 'market', currency);
    const feesAccount = await this.accounts.findSystemAccount(tx, 'fees', currency);
    if (marketAccount === undefined || feesAccount === undefined) {
      throw new AppError('INTERNAL_ERROR', { detail: `Faltan las cuentas de sistema ${currency}` });
    }

    const signedGross = side === 'BUY' ? amounts.gross.negated() : amounts.gross;
    return this.ledger.post(tx, {
      kind: 'ORDER',
      description: `Orden ${orderId}`,
      entries: [
        { accountId: account.id, amount: signedGross, currency },
        { accountId: marketAccount.id, amount: signedGross.negated(), currency },
        { accountId: account.id, amount: amounts.commission.negated(), currency },
        { accountId: feesAccount.id, amount: amounts.commission, currency },
      ],
    });
  }

  /** Una transacción `BUY`/`SELL` por el bruto y otra `FEE` por la comisión, de la misma orden. */
  private async recordTransactions(
    tx: Tx,
    order: OrderRow,
    instrument: InstrumentRow,
    journalId: string,
    amounts: OrderAmounts,
    now: Date,
  ): Promise<void> {
    const buying = order.side === 'BUY';
    const label = `${String(order.quantity)} ${instrument.ticker}`;
    const common = {
      userId: order.userId,
      currency: instrument.currency,
      orderId: order.id,
      journalId,
      createdAt: now,
    };
    await this.transactions.insertMany(tx, [
      {
        ...common,
        id: this.ids.next('transaction'),
        type: buying ? 'BUY' : 'SELL',
        amount: formatAmount(buying ? amounts.gross.negated() : amounts.gross, instrument.currency),
        description: `${buying ? 'Compra' : 'Venta'} ${label}`,
      },
      {
        ...common,
        id: this.ids.next('transaction'),
        type: 'FEE',
        amount: formatAmount(amounts.commission.negated(), instrument.currency),
        description: `Comisión ${buying ? 'compra' : 'venta'} ${label}`,
      },
    ]);
  }

  // ---------- consultas ----------

  public async list(userId: string, query: ListOrdersQuery): Promise<Page<OrderResponse>> {
    const rows = await this.orders.listByUser(
      this.db,
      userId,
      {
        status: query.status,
        cursor: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
      },
      query.limit + 1,
    );
    return buildPage(rows, query.limit, toOrderResponse, (row) => ({
      createdAt: row.createdAt,
      id: row.id,
    }));
  }

  /** Solo órdenes del propio usuario; una ajena responde 404, no 403. */
  public async get(userId: string, orderId: string): Promise<OrderResponse> {
    const row = await this.orders.findByIdForUser(this.db, orderId, userId);
    if (row === undefined) throw orderNotFound(orderId);
    return toOrderResponse(row);
  }
}
