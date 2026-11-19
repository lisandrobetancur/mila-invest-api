import { toIsoUtc, type Clock } from '../../core/clock.js';
import type { PriceRange } from '../../core/domain.js';
import {
  Decimal,
  formatPercent,
  formatPrice,
  percentChange,
  toDecimal,
  type DecimalString,
} from '../../core/money.js';
import { decodeKeyCursor, encodeKeyCursor, type Page } from '../../core/pagination.js';
import type { Db, DbExecutor } from '../../db/client.js';
import type { PriceEngine, EngineInstrument } from './engine.js';
import { instrumentNotFound } from './errors.js';
import type { InstrumentsRepository } from './repository.js';
import type {
  InstrumentDetailResponse,
  InstrumentResponse,
  ListInstrumentsQuery,
  PricesResponse,
} from './schemas.js';
import type { InstrumentRow } from './table.js';

/**
 * Precios de un instrumento en un instante, ya redondeados a los 2 decimales
 * con los que se responden. Las valorizaciones y el precio de ejecución parten
 * de `lastPrice`, así el cliente puede reproducir cualquier cálculo con lo que ve.
 */
export interface MarketSnapshot {
  lastPrice: Decimal;
  prevClose: Decimal;
  change: Decimal;
  changePct: Decimal;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  volume: number;
  asOf: Date;
}

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

export function toEngineInstrument(row: InstrumentRow): EngineInstrument {
  return {
    id: row.id,
    country: row.country,
    basePrice: toDecimal(row.basePrice),
    dailyVolatilityPct: toDecimal(row.dailyVolatilityPct),
    baseVolume: row.baseVolume,
  };
}

export function toInstrumentResponse(
  row: InstrumentRow,
  snapshot: MarketSnapshot,
): InstrumentResponse {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    country: row.country,
    type: row.type,
    currency: row.currency,
    last_price: formatPrice(snapshot.lastPrice),
    change: formatPrice(snapshot.change),
    change_pct: formatPercent(snapshot.changePct),
    updated_at: toIsoUtc(snapshot.asOf),
  };
}

export class MarketService {
  public constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly engine: PriceEngine,
    private readonly instruments: InstrumentsRepository,
  ) {}

  public snapshot(row: InstrumentRow): MarketSnapshot {
    const quote = this.engine.quote(toEngineInstrument(row), this.clock.now());
    const lastPrice = round2(quote.price);
    const prevClose = round2(quote.prevClose);
    return {
      lastPrice,
      prevClose,
      change: lastPrice.minus(prevClose),
      changePct: percentChange(lastPrice, prevClose),
      open: round2(quote.open),
      high: round2(quote.high),
      low: round2(quote.low),
      volume: quote.volume,
      asOf: quote.asOf,
    };
  }

  public async requireInstrument(executor: DbExecutor, id: string): Promise<InstrumentRow> {
    const row = await this.instruments.findById(executor, id);
    if (row === undefined) throw instrumentNotFound(id);
    return row;
  }

  public async findInstruments(
    executor: DbExecutor,
    ids: string[],
  ): Promise<Map<string, InstrumentRow>> {
    const rows = await this.instruments.findByIds(executor, [...new Set(ids)]);
    return new Map(rows.map((row) => [row.id, row]));
  }

  public async list(query: ListInstrumentsQuery): Promise<Page<InstrumentResponse>> {
    let after: { country: string; ticker: string } | undefined;
    if (query.cursor !== undefined) {
      const [country = '', ticker = ''] = decodeKeyCursor(query.cursor, 2);
      after = { country, ticker };
    }
    const rows = await this.instruments.list(
      this.db,
      { country: query.country, type: query.type, q: query.q, after },
      query.limit + 1,
    );

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);
    return {
      items: visible.map((row) => toInstrumentResponse(row, this.snapshot(row))),
      next_cursor:
        hasMore && last !== undefined ? encodeKeyCursor([last.country, last.ticker]) : null,
    };
  }

  public async get(id: string): Promise<InstrumentDetailResponse> {
    const row = await this.requireInstrument(this.db, id);
    const snapshot = this.snapshot(row);
    return {
      ...toInstrumentResponse(row, snapshot),
      open: formatPrice(snapshot.open),
      high: formatPrice(snapshot.high),
      low: formatPrice(snapshot.low),
      prev_close: formatPrice(snapshot.prevClose),
      volume: snapshot.volume,
      description: row.description,
    };
  }

  public async prices(id: string, range: PriceRange): Promise<PricesResponse> {
    const row = await this.requireInstrument(this.db, id);
    const points = this.engine.priceSeries(toEngineInstrument(row), range, this.clock.now());
    return {
      range,
      currency: row.currency,
      points: points.map((point) => ({ t: toIsoUtc(point.t), price: formatPrice(point.price) })),
    };
  }

  /** Todos los instrumentos con su snapshot, para los `top_movers` del dashboard. */
  public async allWithSnapshots(): Promise<{ row: InstrumentRow; snapshot: MarketSnapshot }[]> {
    const rows = await this.instruments.listAll(this.db);
    return rows.map((row) => ({ row, snapshot: this.snapshot(row) }));
  }

  // ---------- overrides del módulo `testing` ----------

  /** Congela el precio de un instrumento (`null` lo libera). */
  public async freezePrice(id: string, price: DecimalString | null): Promise<InstrumentRow> {
    const row = await this.requireInstrument(this.db, id);
    this.engine.setFrozenPrice(id, price === null ? null : toDecimal(price));
    return row;
  }

  public clearFrozenPrices(): void {
    this.engine.clearFrozenPrices();
  }
}
