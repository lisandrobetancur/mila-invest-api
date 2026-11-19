/**
 * Motor de precios simulado (§8.5): determinístico y sin procesos en segundo
 * plano ni tablas de precios.
 *
 * El precio de un instrumento en un instante es una **función pura** de
 * `(PRICE_SEED, instrument_id, minuto)`:
 *
 * - Cada día hábil tiene un PRNG sembrado con `sha256(seed|id|día)`.
 * - Los cierres forman un random walk geométrico: `cierre(d) = cierre(d-1) ·
 *   exp(r_d)`, con `r_d` normal de desvío igual a la volatilidad diaria del
 *   instrumento. El ancla es `PRICE_ANCHOR_DAY`, cuyo cierre es el precio base
 *   del seed; hacia atrás el walk se recorre al revés.
 * - Dentro del día, el precio sigue un puente browniano minuto a minuto que
 *   arranca en el cierre anterior (más un gap de apertura) y termina
 *   exactamente en el cierre del día.
 * - Fuera del horario, el precio queda congelado en el cierre de la última
 *   sesión.
 *
 * Todos los cálculos del walk se hacen con `Decimal`. Las cachés LRU solo
 * evitan recalcular: el resultado no depende de ellas.
 */
import type { Country, PriceRange } from '../../core/domain.js';
import { Decimal, quantizePrice } from '../../core/money.js';
import {
  MINUTE_MS,
  addDays,
  formatLocalDate,
  isoWeekday,
  parseLocalDate,
  type MarketCalendar,
  type Session,
} from '../meta/calendar.js';
import { LruCache } from './lru.js';
import { UINT32_RANGE, mulberry32, seedFor } from './prng.js';

/** Día cuyo cierre es el precio base del seed. Es la víspera de la semilla por defecto. */
export const PRICE_ANCHOR_DAY = '2026-11-17';

export const MAX_SERIES_POINTS = 400;

const SQRT_3 = new Decimal('1.7320508075688772935274463415');
const HUNDRED = new Decimal(100);
/** Parte de la volatilidad diaria que se va en el gap de apertura. */
const GAP_FACTOR = new Decimal('0.2');
/** Amortigua el ruido intradía respecto del movimiento cierre a cierre. */
const INTRADAY_FACTOR = new Decimal('0.6');

export interface EngineInstrument {
  id: string;
  country: Country;
  basePrice: Decimal;
  /** Volatilidad diaria en porcentaje (`1.5` es 1,5 %). */
  dailyVolatilityPct: Decimal;
  baseVolume: number;
}

export interface Quote {
  price: Decimal;
  prevClose: Decimal;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  volume: number;
  /** Instante al que corresponde el precio: el minuto en curso o el cierre de la sesión. */
  asOf: Date;
  session: Session;
}

export interface PricePoint {
  t: Date;
  price: Decimal;
}

interface DayPlan {
  /** Offset logarítmico respecto del cierre anterior, para cada minuto `0..N`. */
  offsets: readonly Decimal[];
  /** Entre 0,7 y 1,3: escala el volumen de referencia del día. */
  volumeFactor: Decimal;
}

/** Normal aproximada (Irwin–Hall con 4 uniformes), con media 0 y desvío 1. */
function nextNormal(random: () => number): Decimal {
  const sum = random() + random() + random() + random();
  return new Decimal(sum).dividedBy(UINT32_RANGE).minus(2).times(SQRT_3);
}

export class PriceEngine {
  private readonly closes = new LruCache<string, Decimal>(20_000);
  private readonly plans = new LruCache<string, DayPlan>(600);
  private readonly series = new LruCache<string, readonly PricePoint[]>(300);
  private readonly frozen = new Map<string, Decimal>();

  public constructor(
    private readonly priceSeed: string,
    private readonly calendarOf: (country: Country) => MarketCalendar,
  ) {}

  // ---------- overrides del módulo `testing` ----------

  /** Congela el precio de un instrumento; `null` lo libera. */
  public setFrozenPrice(instrumentId: string, price: Decimal | null): void {
    if (price === null) this.frozen.delete(instrumentId);
    else this.frozen.set(instrumentId, quantizePrice(price));
  }

  public clearFrozenPrices(): void {
    this.frozen.clear();
  }

  public frozenPrice(instrumentId: string): Decimal | undefined {
    return this.frozen.get(instrumentId);
  }

  // ---------- precio en un instante ----------

  /** Precio en `instant`, cuantizado a 6 decimales. Respeta el override si existe. */
  public priceAt(instrument: EngineInstrument, instant: Date): Decimal {
    return this.frozen.get(instrument.id) ?? this.modelPriceAt(instrument, instant);
  }

  /** Precio del modelo, sin overrides: función pura de `(seed, id, minuto)`. */
  public modelPriceAt(instrument: EngineInstrument, instant: Date): Decimal {
    const session = this.calendarOf(instrument.country).latestSession(instant);
    return this.priceAtMinute(instrument, session, this.minuteOf(session, instant));
  }

  public quote(instrument: EngineInstrument, instant: Date): Quote {
    const calendar = this.calendarOf(instrument.country);
    const session = calendar.latestSession(instant);
    const minute = this.minuteOf(session, instant);
    const plan = this.planFor(instrument, session);
    const prevClose = this.closeOf(instrument, calendar.sessionBefore(session.day).day);

    let maxOffset = plan.offsets[0] ?? new Decimal(0);
    let minOffset = maxOffset;
    for (let index = 1; index <= minute; index += 1) {
      const offset = plan.offsets[index];
      if (offset === undefined) break;
      if (offset.greaterThan(maxOffset)) maxOffset = offset;
      if (offset.lessThan(minOffset)) minOffset = offset;
    }

    const modelPrice = this.priceAtMinute(instrument, session, minute);
    const price = this.frozen.get(instrument.id) ?? modelPrice;
    const high = quantizePrice(prevClose.times(maxOffset.exp()));
    const low = quantizePrice(prevClose.times(minOffset.exp()));

    return {
      price,
      prevClose: quantizePrice(prevClose),
      open: this.priceAtMinute(instrument, session, 0),
      high: Decimal.max(high, price),
      low: Decimal.min(low, price),
      // El volumen es un contador entero (no dinero): se trunca y se pasa a `number`.
      volume: Number.parseInt(
        plan.volumeFactor
          .times(instrument.baseVolume)
          .times(minute)
          .dividedBy(session.minutes)
          .toFixed(0, Decimal.ROUND_FLOOR),
        10,
      ),
      asOf:
        minute >= session.minutes
          ? session.close
          : new Date(session.open.getTime() + minute * MINUTE_MS),
      session,
    };
  }

  // ---------- series históricas ----------

  /**
   * Serie de precios hasta `instant`: `1D` cada 5 min de la sesión, `1W` cada
   * hora, `1M` y `3M` diario, `1Y` semanal. Máximo 400 puntos.
   */
  public priceSeries(
    instrument: EngineInstrument,
    range: PriceRange,
    instant: Date,
  ): readonly PricePoint[] {
    const calendar = this.calendarOf(instrument.country);
    const latest = calendar.latestSession(instant);
    const latestMinute = this.minuteOf(latest, instant);
    const frozen = this.frozen.get(instrument.id);

    const cacheKey = `${instrument.id}|${range}|${latest.day}|${String(latestMinute)}`;
    let points = this.series.get(cacheKey);
    if (points === undefined) {
      points = this.buildSeries(instrument, range, calendar, latest, latestMinute);
      this.series.set(cacheKey, points);
    }

    if (frozen === undefined) return points;
    const last = points.at(-1);
    return last === undefined ? points : [...points.slice(0, -1), { t: last.t, price: frozen }];
  }

  private buildSeries(
    instrument: EngineInstrument,
    range: PriceRange,
    calendar: MarketCalendar,
    latest: Session,
    latestMinute: number,
  ): PricePoint[] {
    const points: PricePoint[] = [];
    const intraday = (session: Session, lastMinute: number, stepMinutes: number): void => {
      const minutes = new Set<number>();
      for (let minute = 0; minute <= lastMinute; minute += stepMinutes) minutes.add(minute);
      minutes.add(lastMinute);
      for (const minute of [...minutes].sort((a, b) => a - b)) {
        points.push({
          t: new Date(session.open.getTime() + minute * MINUTE_MS),
          price: this.priceAtMinute(instrument, session, minute),
        });
      }
    };

    if (range === '1D') {
      intraday(latest, latestMinute, 5);
      return points.slice(-MAX_SERIES_POINTS);
    }

    if (range === '1W') {
      const sessions: Session[] = [latest];
      while (sessions.length < 5) {
        const first = sessions[0];
        if (first === undefined) break;
        sessions.unshift(calendar.sessionBefore(first.day));
      }
      for (const session of sessions) {
        intraday(session, session === latest ? latestMinute : session.minutes, 60);
      }
      return points.slice(-MAX_SERIES_POINTS);
    }

    const calendarDays = range === '1M' ? 30 : range === '3M' ? 90 : 365;
    const latestDate = parseLocalDate(latest.day);
    const firstDate = addDays(latestDate, -calendarDays);
    const weekly = range === '1Y';

    for (let date = firstDate; ; date = addDays(date, 1)) {
      const day = formatLocalDate(date);
      if (day > latest.day) break;
      if (!calendar.isBusinessDay(date)) continue;

      const isLatest = day === latest.day;
      // En la serie semanal se toma la última sesión de cada semana (y siempre la vigente).
      if (weekly && !isLatest && calendar.isBusinessDay(addDays(date, 1))) {
        if (isoWeekday(addDays(date, 1)) > isoWeekday(date)) continue;
      }

      const session = calendar.sessionOn(date);
      const minute = isLatest ? latestMinute : session.minutes;
      points.push({
        t:
          minute >= session.minutes
            ? session.close
            : new Date(session.open.getTime() + minute * MINUTE_MS),
        price: this.priceAtMinute(instrument, session, minute),
      });
    }
    return points.slice(-MAX_SERIES_POINTS);
  }

  // ---------- modelo ----------

  /** Minuto de la sesión que corresponde a `instant`: `0..N-1` en curso, `N` ya cerrada. */
  private minuteOf(session: Session, instant: Date): number {
    if (instant.getTime() >= session.close.getTime()) return session.minutes;
    const elapsed = Math.floor((instant.getTime() - session.open.getTime()) / MINUTE_MS);
    return Math.min(Math.max(elapsed, 0), session.minutes);
  }

  private priceAtMinute(instrument: EngineInstrument, session: Session, minute: number): Decimal {
    // El último minuto es el cierre del día: sale del walk diario, sin armar el camino intradía.
    if (minute >= session.minutes) return quantizePrice(this.closeOf(instrument, session.day));

    const calendar = this.calendarOf(instrument.country);
    const prevClose = this.closeOf(instrument, calendar.sessionBefore(session.day).day);
    const offset = this.planFor(instrument, session).offsets[minute];
    if (offset === undefined) {
      throw new RangeError(`Minuto ${String(minute)} fuera de la sesión ${session.day}`);
    }
    return quantizePrice(prevClose.times(offset.exp()));
  }

  private sigma(instrument: EngineInstrument): Decimal {
    return instrument.dailyVolatilityPct.dividedBy(HUNDRED);
  }

  /** Retorno logarítmico cierre a cierre del día: el primer valor del PRNG de ese día. */
  private dailyReturn(instrument: EngineInstrument, day: string): Decimal {
    const random = mulberry32(seedFor(this.priceSeed, instrument.id, day));
    return this.sigma(instrument).times(nextNormal(random));
  }

  /** Cierre de un día hábil, sin cuantizar (el walk conserva toda la precisión). */
  public closeOf(instrument: EngineInstrument, day: string): Decimal {
    const calendar = this.calendarOf(instrument.country);
    const anchorDate = parseLocalDate(PRICE_ANCHOR_DAY);
    const anchorDay = calendar.isBusinessDay(anchorDate)
      ? PRICE_ANCHOR_DAY
      : formatLocalDate(calendar.previousBusinessDay(anchorDate));
    if (day === anchorDay) return instrument.basePrice;

    const keyOf = (target: string): string => `${instrument.id}|${target}`;
    const cached = this.closes.get(keyOf(day));
    if (cached !== undefined) return cached;

    // Se camina desde `day` hacia el ancla hasta encontrar un cierre conocido,
    // y después se vuelve aplicando (o deshaciendo) el retorno de cada día.
    const forward = day > anchorDay;
    const pending: string[] = [];
    let cursor = day;
    let known: Decimal | undefined;
    while (known === undefined) {
      pending.push(cursor);
      const neighbour = formatLocalDate(
        forward
          ? calendar.previousBusinessDay(parseLocalDate(cursor))
          : calendar.nextBusinessDay(parseLocalDate(cursor)),
      );
      known = neighbour === anchorDay ? instrument.basePrice : this.closes.get(keyOf(neighbour));
      cursor = neighbour;
    }

    let value = known;
    let neighbour = cursor;
    for (const target of pending.reverse()) {
      value = forward
        ? value.times(this.dailyReturn(instrument, target).exp())
        : value.dividedBy(this.dailyReturn(instrument, neighbour).exp());
      this.closes.set(keyOf(target), value);
      neighbour = target;
    }
    return value;
  }

  private planFor(instrument: EngineInstrument, session: Session): DayPlan {
    const key = `${instrument.id}|${session.day}|${String(session.minutes)}`;
    const cached = this.plans.get(key);
    if (cached !== undefined) return cached;

    const random = mulberry32(seedFor(this.priceSeed, instrument.id, session.day));
    const sigma = this.sigma(instrument);
    const steps = session.minutes;

    // El orden de los sorteos es fijo: retorno del día, gap, volumen y después el camino.
    const dayReturn = sigma.times(nextNormal(random));
    const gap = sigma.times(GAP_FACTOR).times(nextNormal(random));
    const volumeFactor = new Decimal(random()).dividedBy(UINT32_RANGE).times('0.6').plus('0.7');

    const stepSigma = sigma.times(INTRADAY_FACTOR).dividedBy(new Decimal(steps).sqrt());
    const walk: Decimal[] = [new Decimal(0)];
    for (let minute = 1; minute <= steps; minute += 1) {
      const previous = walk[minute - 1] ?? new Decimal(0);
      walk.push(previous.plus(stepSigma.times(nextNormal(random))));
    }
    const walkEnd = walk[steps] ?? new Decimal(0);

    const offsets = walk.map((value, minute) => {
      const progress = new Decimal(minute).dividedBy(steps);
      const bridge = value.minus(progress.times(walkEnd));
      return gap.plus(progress.times(dayReturn.minus(gap))).plus(bridge);
    });

    const plan: DayPlan = { offsets, volumeFactor };
    this.plans.set(key, plan);
    return plan;
  }
}
