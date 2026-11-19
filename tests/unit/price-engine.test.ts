import { describe, expect, it } from 'vitest';
import { PRICE_RANGES } from '../../src/core/domain.js';
import { Decimal } from '../../src/core/money.js';
import { MarketCalendar } from '../../src/modules/meta/calendar.js';
import { COUNTRY_CONFIG } from '../../src/modules/meta/data.js';
import {
  MAX_SERIES_POINTS,
  PRICE_ANCHOR_DAY,
  PriceEngine,
  type EngineInstrument,
} from '../../src/modules/market/engine.js';
import { LruCache } from '../../src/modules/market/lru.js';
import { mulberry32, seedFor } from '../../src/modules/market/prng.js';

const calendars = {
  CO: new MarketCalendar(COUNTRY_CONFIG.CO.timeZone, COUNTRY_CONFIG.CO.market),
  MX: new MarketCalendar(COUNTRY_CONFIG.MX.timeZone, COUNTRY_CONFIG.MX.market),
  PE: new MarketCalendar(COUNTRY_CONFIG.PE.timeZone, COUNTRY_CONFIG.PE.market),
};
const engineWith = (seed = '20261118'): PriceEngine =>
  new PriceEngine(seed, (country) => calendars[country]);

const ECOPETROL: EngineInstrument = {
  id: 'ECOPETROL-CO',
  country: 'CO',
  basePrice: new Decimal('2400'),
  dailyVolatilityPct: new Decimal('1.8'),
  baseVolume: 12_000_000,
};
const WALMEX: EngineInstrument = {
  id: 'WALMEX-MX',
  country: 'MX',
  basePrice: new Decimal('60'),
  dailyVolatilityPct: new Decimal('1.6'),
  baseVolume: 14_000_000,
};

const at = (iso: string): Date => new Date(iso);

describe('PRNG', () => {
  it('mulberry32 produce la misma secuencia para la misma semilla', () => {
    const first = mulberry32(123_456);
    const second = mulberry32(123_456);
    const sequence = Array.from({ length: 5 }, () => first());
    expect(Array.from({ length: 5 }, () => second())).toEqual(sequence);
    // Valores fijos: la secuencia no puede cambiar entre máquinas ni versiones.
    expect(sequence).toEqual([1642107918, 3424218114, 4280064779, 687244953, 895809828]);
    expect(
      sequence.every((value) => Number.isInteger(value) && value >= 0 && value < 2 ** 32),
    ).toBe(true);
  });

  it('la semilla depende del seed, del instrumento y del día', () => {
    const base = seedFor('20261118', 'ECOPETROL-CO', '2026-11-18');
    expect(seedFor('20261118', 'ECOPETROL-CO', '2026-11-18')).toBe(base);
    expect(seedFor('20261119', 'ECOPETROL-CO', '2026-11-18')).not.toBe(base);
    expect(seedFor('20261118', 'ISA-CO', '2026-11-18')).not.toBe(base);
    expect(seedFor('20261118', 'ECOPETROL-CO', '2026-11-19')).not.toBe(base);
  });
});

describe('LruCache', () => {
  it('descarta la entrada menos usada al pasar el tope', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
    cache.set('c', 30);
    expect(cache.get('c')).toBe(30);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(() => new LruCache(0)).toThrow(RangeError);
  });
});

describe('motor de precios', () => {
  it('mismo seed y mismo instante dan el mismo precio en motores distintos', () => {
    const instant = at('2026-11-18T15:42:00Z');
    const price = engineWith().priceAt(ECOPETROL, instant);
    expect(engineWith().priceAt(ECOPETROL, instant).equals(price)).toBe(true);
    expect(price.decimalPlaces()).toBeLessThanOrEqual(6);
    // Valor fijo: detecta cualquier cambio accidental en el modelo.
    expect(engineWith().priceAt(ECOPETROL, at('2026-11-18T14:42:00Z')).toFixed(2)).toBe('2414.20');
  });

  it('el resultado no depende de la caché ni del orden de las consultas', () => {
    const cold = engineWith();
    const warm = engineWith();
    warm.priceSeries(ECOPETROL, '1Y', at('2026-11-18T15:42:00Z'));
    warm.priceAt(ECOPETROL, at('2025-03-04T16:00:00Z'));
    for (const iso of ['2026-11-18T15:42:00Z', '2026-06-10T18:07:00Z', '2027-02-03T15:00:00Z']) {
      expect(warm.priceAt(ECOPETROL, at(iso)).equals(cold.priceAt(ECOPETROL, at(iso))), iso).toBe(
        true,
      );
    }
  });

  it('otro seed u otro instrumento dan otro precio', () => {
    const instant = at('2026-11-18T15:42:00Z');
    const price = engineWith().priceAt(ECOPETROL, instant);
    expect(engineWith('otra-semilla').priceAt(ECOPETROL, instant).equals(price)).toBe(false);
    expect(
      engineWith()
        .priceAt({ ...ECOPETROL, id: 'OTRO-CO' }, instant)
        .equals(price),
    ).toBe(false);
  });

  it('es función del minuto: no cambia dentro del mismo minuto y sí al siguiente', () => {
    const engine = engineWith();
    const start = engine.priceAt(ECOPETROL, at('2026-11-18T15:42:00Z'));
    expect(engine.priceAt(ECOPETROL, at('2026-11-18T15:42:59.999Z')).equals(start)).toBe(true);
    expect(engine.priceAt(ECOPETROL, at('2026-11-18T15:43:00Z')).equals(start)).toBe(false);
  });

  it('el cierre del día ancla es el precio base', () => {
    const engine = engineWith();
    expect(engine.closeOf(ECOPETROL, PRICE_ANCHOR_DAY).toFixed(2)).toBe('2400.00');
    // Antes de la apertura del día siguiente el precio es ese cierre.
    expect(engine.priceAt(ECOPETROL, at('2026-11-18T12:00:00Z')).toFixed(2)).toBe('2400.00');
  });

  it('fuera de horario queda congelado en el cierre de la última sesión', () => {
    const engine = engineWith();
    const close = engine.priceAt(ECOPETROL, at('2026-11-20T21:00:00Z'));
    expect(close.equals(engine.closeOf(ECOPETROL, '2026-11-20').toDecimalPlaces(6))).toBe(true);
    for (const iso of [
      '2026-11-20T23:30:00Z',
      '2026-11-21T15:00:00Z',
      '2026-11-22T20:00:00Z',
      '2026-11-23T14:29:00Z',
    ]) {
      expect(engine.priceAt(ECOPETROL, at(iso)).equals(close), iso).toBe(true);
    }
    expect(engine.priceAt(ECOPETROL, at('2026-11-23T14:31:00Z')).equals(close)).toBe(false);
  });

  it('el walk hacia atrás es consistente con el walk hacia adelante', () => {
    const engine = engineWith();
    const earlier = engine.closeOf(ECOPETROL, '2026-10-01');
    const fresh = engineWith();
    // Pedir primero un día más lejano no cambia el valor de uno intermedio.
    fresh.closeOf(ECOPETROL, '2026-08-03');
    expect(fresh.closeOf(ECOPETROL, '2026-10-01').equals(earlier)).toBe(true);
    expect(earlier.isPositive()).toBe(true);
  });

  it('los precios se mantienen positivos y en un rango razonable', () => {
    const engine = engineWith();
    for (const day of ['2025-11-18', '2026-05-15', '2026-11-18', '2027-11-18']) {
      const close = engine.closeOf(WALMEX, day);
      expect(close.greaterThan(5), day).toBe(true);
      expect(close.lessThan(600), day).toBe(true);
    }
  });

  it('la cotización trae apertura, máximo, mínimo, cierre anterior y volumen coherentes', () => {
    const engine = engineWith();
    const quote = engine.quote(ECOPETROL, at('2026-11-18T18:00:00Z'));
    expect(quote.prevClose.toFixed(2)).toBe('2400.00');
    expect(quote.high.greaterThanOrEqualTo(quote.price)).toBe(true);
    expect(quote.low.lessThanOrEqualTo(quote.price)).toBe(true);
    expect(quote.high.greaterThanOrEqualTo(quote.open)).toBe(true);
    expect(quote.low.lessThanOrEqualTo(quote.open)).toBe(true);
    expect(quote.asOf.toISOString()).toBe('2026-11-18T18:00:00.000Z');
    expect(quote.session.day).toBe('2026-11-18');
    expect(quote.volume).toBeGreaterThan(0);

    const closed = engine.quote(ECOPETROL, at('2026-11-18T23:00:00Z'));
    expect(closed.asOf.toISOString()).toBe('2026-11-18T21:00:00.000Z');
    expect(closed.volume).toBeGreaterThan(quote.volume);
    expect(engine.quote(ECOPETROL, at('2026-11-18T14:30:00Z')).volume).toBe(0);
  });

  it('un precio congelado pisa al modelo y se puede liberar', () => {
    const engine = engineWith();
    const instant = at('2026-11-18T18:00:00Z');
    const model = engine.priceAt(ECOPETROL, instant);

    engine.setFrozenPrice(ECOPETROL.id, new Decimal('9999.5'));
    expect(engine.frozenPrice(ECOPETROL.id)?.toFixed(2)).toBe('9999.50');
    expect(engine.priceAt(ECOPETROL, instant).toFixed(2)).toBe('9999.50');
    expect(engine.modelPriceAt(ECOPETROL, instant).equals(model)).toBe(true);
    const quote = engine.quote(ECOPETROL, instant);
    expect(quote.price.toFixed(2)).toBe('9999.50');
    expect(quote.high.toFixed(2)).toBe('9999.50');
    expect(engine.priceSeries(ECOPETROL, '1D', instant).at(-1)?.price.toFixed(2)).toBe('9999.50');
    expect(engine.priceAt(WALMEX, instant).toFixed(2)).not.toBe('9999.50');

    engine.setFrozenPrice(ECOPETROL.id, new Decimal('1'));
    expect(engine.quote(ECOPETROL, instant).low.toFixed(2)).toBe('1.00');

    engine.setFrozenPrice(ECOPETROL.id, null);
    expect(engine.priceAt(ECOPETROL, instant).equals(model)).toBe(true);
    engine.setFrozenPrice(ECOPETROL.id, new Decimal('5'));
    engine.clearFrozenPrices();
    expect(engine.frozenPrice(ECOPETROL.id)).toBeUndefined();
  });

  describe('series históricas', () => {
    const instant = at('2026-11-18T18:00:00Z');

    it.each(PRICE_RANGES)(
      '%s respeta el máximo de puntos y termina en el precio actual',
      (range) => {
        const engine = engineWith();
        const points = engine.priceSeries(ECOPETROL, range, instant);
        expect(points.length).toBeGreaterThan(1);
        expect(points.length).toBeLessThanOrEqual(MAX_SERIES_POINTS);
        expect(points.at(-1)?.price.equals(engine.priceAt(ECOPETROL, instant))).toBe(true);
        expect(points.at(-1)?.t.toISOString()).toBe('2026-11-18T18:00:00.000Z');
        const times = points.map((point) => point.t.getTime());
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(new Set(times).size).toBe(times.length);
      },
    );

    it('1D va cada 5 minutos desde la apertura', () => {
      const points = engineWith().priceSeries(ECOPETROL, '1D', instant);
      expect(points[0]?.t.toISOString()).toBe('2026-11-18T14:30:00.000Z');
      expect(points[1]?.t.toISOString()).toBe('2026-11-18T14:35:00.000Z');
      expect(points).toHaveLength(43);
      // Sesión completa: 390 minutos cada 5 → 79 puntos.
      expect(engineWith().priceSeries(ECOPETROL, '1D', at('2026-11-18T23:00:00Z'))).toHaveLength(
        79,
      );
    });

    it('1W va cada hora sobre las últimas 5 sesiones', () => {
      const points = engineWith().priceSeries(ECOPETROL, '1W', at('2026-11-18T23:00:00Z'));
      expect(points[0]?.t.toISOString()).toBe('2026-11-12T14:30:00.000Z');
      // Cada sesión: minutos 0, 60, …, 360 y el cierre (390) → 8 puntos.
      expect(points).toHaveLength(40);
    });

    it('1M y 3M son diarias, y 1Y semanal', () => {
      const engine = engineWith();
      const month = engine.priceSeries(ECOPETROL, '1M', instant);
      expect(month).toHaveLength(23);
      expect(month[0]?.t.toISOString()).toBe('2026-10-19T21:00:00.000Z');
      expect(engine.priceSeries(ECOPETROL, '3M', instant)).toHaveLength(65);

      const year = engine.priceSeries(ECOPETROL, '1Y', instant);
      expect(year.length).toBeGreaterThanOrEqual(52);
      expect(year.length).toBeLessThanOrEqual(54);
      // Todos los puntos anteriores al último son cierres de viernes.
      for (const point of year.slice(0, -1)) expect(point.t.getUTCDay()).toBe(5);
    });

    it('devuelve la misma serie al repetir la consulta', () => {
      const engine = engineWith();
      const first = engine.priceSeries(ECOPETROL, '1M', instant);
      expect(engine.priceSeries(ECOPETROL, '1M', instant)).toBe(first);
      const other = engineWith().priceSeries(ECOPETROL, '1M', instant);
      expect(other.map((point) => point.price.toFixed(6))).toEqual(
        first.map((point) => point.price.toFixed(6)),
      );
    });
  });
});
