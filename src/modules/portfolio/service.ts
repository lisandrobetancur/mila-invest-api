import { toIsoUtc, type Clock } from '../../core/clock.js';
import { USER_CURRENCIES, type UserCurrency } from '../../core/domain.js';
import {
  Decimal,
  ZERO,
  formatAmount,
  formatPercent,
  formatPrice,
  percentChange,
  quantizeAmount,
  toDecimal,
} from '../../core/money.js';
import type { Db } from '../../db/client.js';
import type { AccountsRepository } from '../accounts/repository.js';
import { toInstrumentResponse, type MarketService } from '../market/service.js';
import type { MetaService } from '../meta/service.js';
import type { PositionsRepository } from './repository.js';
import {
  ALLOCATION_TYPES,
  type AllocationType,
  type FxRateResponse,
  type PortfolioResponse,
  type PortfolioSummaryResponse,
  type PositionResponse,
} from './schemas.js';

/** Las tasas se informan con 6 decimales, el máximo del formato decimal del contrato. */
const FX_RATE_DECIMALS = 6;

export class PortfolioService {
  public constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly meta: MetaService,
    private readonly market: MarketService,
    private readonly accounts: AccountsRepository,
    private readonly positions: PositionsRepository,
  ) {}

  /**
   * Valoriza el portafolio en la moneda base del usuario. Las posiciones y el
   * efectivo de otras monedas se convierten con las tasas simuladas de §8.6,
   * que se informan en `fx_rates_used`.
   */
  public async get(userId: string, baseCurrency: UserCurrency): Promise<PortfolioResponse> {
    const now = this.clock.now();
    const [accountRows, positionRows] = await Promise.all([
      this.accounts.listByUser(this.db, userId),
      this.positions.listByUser(this.db, userId),
    ]);
    const instruments = await this.market.findInstruments(
      this.db,
      positionRows.map((row) => row.instrumentId),
    );

    const toBase = (amount: Decimal, currency: UserCurrency): Decimal =>
      this.meta.convert(amount, currency, baseCurrency);

    let cashValue = ZERO;
    for (const account of accountRows) {
      const balance = toDecimal(account.available).plus(account.reserved);
      cashValue = cashValue.plus(toBase(balance, account.currency as UserCurrency));
    }

    const allocation = new Map<AllocationType, Decimal>(
      ALLOCATION_TYPES.map((type) => [type, ZERO]),
    );
    let investedValue = ZERO;
    let dayChange = ZERO;
    const positions: PositionResponse[] = [];

    for (const row of positionRows) {
      const instrument = instruments.get(row.instrumentId);
      if (instrument === undefined) continue;

      const snapshot = this.market.snapshot(instrument);
      const marketValue = quantizeAmount(snapshot.lastPrice.times(row.quantity), row.currency);
      const cost = quantizeAmount(toDecimal(row.avgCost).times(row.quantity), row.currency);
      const unrealized = marketValue.minus(cost);

      investedValue = investedValue.plus(toBase(marketValue, row.currency));
      dayChange = dayChange.plus(toBase(snapshot.change.times(row.quantity), row.currency));
      allocation.set(
        instrument.type,
        (allocation.get(instrument.type) ?? ZERO).plus(toBase(marketValue, row.currency)),
      );

      positions.push({
        instrument: toInstrumentResponse(instrument, snapshot),
        quantity: row.quantity,
        avg_cost: formatPrice(row.avgCost),
        market_value: formatAmount(marketValue, row.currency),
        unrealized_pnl: formatAmount(unrealized, row.currency),
        unrealized_pnl_pct: formatPercent(percentChange(marketValue, cost)),
        currency: row.currency,
      });
    }

    allocation.set('CASH', cashValue);
    const totalValue = cashValue.plus(investedValue);
    const previousInvested = investedValue.minus(dayChange);

    const fxRatesUsed: FxRateResponse[] = USER_CURRENCIES.filter(
      (currency) => currency !== baseCurrency,
    ).map((currency) => ({
      from: currency,
      to: baseCurrency,
      rate: this.meta
        .fxRate(currency, baseCurrency)
        .toFixed(FX_RATE_DECIMALS, Decimal.ROUND_HALF_EVEN),
      as_of: toIsoUtc(now),
    }));

    return {
      base_currency: baseCurrency,
      total_value: formatAmount(totalValue, baseCurrency),
      cash_value: formatAmount(cashValue, baseCurrency),
      invested_value: formatAmount(investedValue, baseCurrency),
      day_change: formatAmount(dayChange, baseCurrency),
      day_change_pct: formatPercent(percentChange(investedValue, previousInvested)),
      positions,
      allocation: ALLOCATION_TYPES.map((type) => {
        const value = allocation.get(type) ?? ZERO;
        return {
          type,
          value: formatAmount(value, baseCurrency),
          pct: formatPercent(totalValue.isZero() ? ZERO : value.dividedBy(totalValue).times(100)),
        };
      }),
      fx_rates_used: fxRatesUsed,
    };
  }

  public async summary(
    userId: string,
    baseCurrency: UserCurrency,
  ): Promise<PortfolioSummaryResponse> {
    const portfolio = await this.get(userId, baseCurrency);
    return {
      base_currency: portfolio.base_currency,
      total_value: portfolio.total_value,
      cash_value: portfolio.cash_value,
      invested_value: portfolio.invested_value,
      day_change: portfolio.day_change,
      day_change_pct: portfolio.day_change_pct,
    };
  }
}
