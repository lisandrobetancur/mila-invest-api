import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../../src/core/clock.js';
import {
  MarketCalendar,
  addDays,
  formatLocalDate,
  isoWeekday,
  localDateOf,
  parseLocalDate,
  zonedTimeToUtc,
} from '../../src/modules/meta/calendar.js';
import { COUNTRY_CONFIG } from '../../src/modules/meta/data.js';
import { MetaService } from '../../src/modules/meta/service.js';

const calendarOf = (country: 'CO' | 'MX' | 'PE'): MarketCalendar =>
  new MarketCalendar(COUNTRY_CONFIG[country].timeZone, COUNTRY_CONFIG[country].market);

const at = (iso: string): Date => new Date(iso);

describe('fechas locales', () => {
  it('convierte horas de pared a UTC en cada zona', () => {
    const day = parseLocalDate('2026-11-18');
    expect(zonedTimeToUtc(day, 9, 30, 'America/Bogota').toISOString()).toBe(
      '2026-11-18T14:30:00.000Z',
    );
    expect(zonedTimeToUtc(day, 8, 30, 'America/Mexico_City').toISOString()).toBe(
      '2026-11-18T14:30:00.000Z',
    );
    expect(zonedTimeToUtc(day, 9, 0, 'America/Lima').toISOString()).toBe(
      '2026-11-18T14:00:00.000Z',
    );
  });

  it('calcula la fecha local, incluso cuando en UTC ya es el día siguiente', () => {
    expect(formatLocalDate(localDateOf(at('2026-11-19T03:00:00Z'), 'America/Bogota'))).toBe(
      '2026-11-18',
    );
    expect(formatLocalDate(localDateOf(at('2026-11-19T05:30:00Z'), 'America/Bogota'))).toBe(
      '2026-11-19',
    );
    expect(formatLocalDate(localDateOf(at('2026-11-19T05:30:00Z'), 'America/Mexico_City'))).toBe(
      '2026-11-18',
    );
  });

  it('suma días cruzando meses y años, y conoce el día de la semana', () => {
    expect(formatLocalDate(addDays(parseLocalDate('2026-12-31'), 1))).toBe('2027-01-01');
    expect(formatLocalDate(addDays(parseLocalDate('2026-03-01'), -1))).toBe('2026-02-28');
    expect(isoWeekday(parseLocalDate('2026-11-18'))).toBe(3);
    expect(isoWeekday(parseLocalDate('2026-11-22'))).toBe(7);
    expect(() => parseLocalDate('18/11/2026')).toThrow(TypeError);
  });
});

describe('sesiones de mercado', () => {
  it.each([
    ['CO', '2026-11-18T14:30:00.000Z', '2026-11-18T21:00:00.000Z', 390],
    ['MX', '2026-11-18T14:30:00.000Z', '2026-11-18T21:00:00.000Z', 390],
    ['PE', '2026-11-18T14:00:00.000Z', '2026-11-18T21:00:00.000Z', 420],
  ] as const)('%s abre y cierra en su hora local', (country, open, close, minutes) => {
    const session = calendarOf(country).sessionOn(parseLocalDate('2026-11-18'));
    expect(session.day).toBe('2026-11-18');
    expect(session.open.toISOString()).toBe(open);
    expect(session.close.toISOString()).toBe(close);
    expect(session.minutes).toBe(minutes);
  });

  it('el mercado abre en el minuto de apertura y cierra en el de cierre', () => {
    const co = calendarOf('CO');
    expect(co.isOpenAt(at('2026-11-18T14:29:59Z'))).toBe(false);
    expect(co.isOpenAt(at('2026-11-18T14:30:00Z'))).toBe(true);
    expect(co.isOpenAt(at('2026-11-18T20:59:59Z'))).toBe(true);
    expect(co.isOpenAt(at('2026-11-18T21:00:00Z'))).toBe(false);
  });

  it('a la misma hora UTC, Lima ya abrió y Bogotá todavía no', () => {
    const instant = at('2026-11-18T14:10:00Z');
    expect(calendarOf('PE').isOpenAt(instant)).toBe(true);
    expect(calendarOf('CO').isOpenAt(instant)).toBe(false);
    expect(calendarOf('MX').isOpenAt(instant)).toBe(false);
  });

  it('cierra los fines de semana y respeta los feriados configurados', () => {
    const co = calendarOf('CO');
    expect(co.isOpenAt(at('2026-11-21T16:00:00Z'))).toBe(false);
    expect(co.isOpenAt(at('2026-11-22T16:00:00Z'))).toBe(false);

    const withHoliday = new MarketCalendar('America/Bogota', {
      ...COUNTRY_CONFIG.CO.market,
      holidays: ['2026-11-18'],
    });
    expect(withHoliday.isOpenAt(at('2026-11-18T16:00:00Z'))).toBe(false);
    expect(withHoliday.nextSession(at('2026-11-18T16:00:00Z')).day).toBe('2026-11-19');
    expect(withHoliday.latestSession(at('2026-11-18T16:00:00Z')).day).toBe('2026-11-17');
  });

  it('encuentra la sesión siguiente y la vigente para precios', () => {
    const co = calendarOf('CO');
    // Antes de abrir: la próxima es la de hoy; la vigente para precios, la de ayer.
    expect(co.nextSession(at('2026-11-18T12:00:00Z')).day).toBe('2026-11-18');
    expect(co.latestSession(at('2026-11-18T12:00:00Z')).day).toBe('2026-11-17');
    // Durante la sesión.
    expect(co.currentSession(at('2026-11-18T15:00:00Z'))?.day).toBe('2026-11-18');
    expect(co.latestSession(at('2026-11-18T15:00:00Z')).day).toBe('2026-11-18');
    expect(co.nextSession(at('2026-11-18T15:00:00Z')).day).toBe('2026-11-19');
    // Viernes después del cierre y fin de semana: la próxima es el lunes.
    expect(co.nextSession(at('2026-11-20T22:00:00Z')).day).toBe('2026-11-23');
    expect(co.nextSession(at('2026-11-21T15:00:00Z')).day).toBe('2026-11-23');
    expect(co.latestSession(at('2026-11-22T15:00:00Z')).day).toBe('2026-11-20');
    expect(co.sessionBefore('2026-11-23').day).toBe('2026-11-20');
    expect(co.sessionAfter('2026-11-20').day).toBe('2026-11-23');
  });
});

describe('estado del mercado (MetaService)', () => {
  it('con MARKET_ALWAYS_OPEN=false sigue el horario de cada país', () => {
    const clock = new FrozenClock('2026-11-18T14:10:00Z');
    const meta = new MetaService(clock, { marketAlwaysOpen: false });
    expect(meta.isMarketOpen('PE')).toBe(true);
    expect(meta.isMarketOpen('CO')).toBe(false);

    const countries = meta.listCountries();
    expect(countries.map((country) => country.code)).toEqual(['CO', 'MX', 'PE']);
    expect(countries[0]).toEqual({
      code: 'CO',
      currency: 'COP',
      time_zone: 'America/Bogota',
      document_types: ['CC', 'CE'],
      market: {
        status: 'CLOSED',
        opens_at: '2026-11-18T14:30:00Z',
        closes_at: '2026-11-18T21:00:00Z',
      },
    });
    expect(countries[2]?.market).toEqual({
      status: 'OPEN',
      opens_at: '2026-11-18T14:00:00Z',
      closes_at: '2026-11-18T21:00:00Z',
    });

    clock.set('2026-11-20T22:00:00Z');
    expect(meta.marketState('CO')).toMatchObject({ status: 'CLOSED', forcedOpen: false });
    expect(meta.marketState('CO').session.day).toBe('2026-11-23');
  });

  it('MARKET_ALWAYS_OPEN=true ignora el horario', () => {
    const meta = new MetaService(new FrozenClock('2026-11-22T03:00:00Z'), {
      marketAlwaysOpen: true,
    });
    expect(meta.marketState('MX')).toMatchObject({ status: 'OPEN', forcedOpen: true });
    expect(meta.isAlwaysOpen('MX')).toBe(true);
  });

  it('el override por país pisa la configuración y se puede quitar', () => {
    const meta = new MetaService(new FrozenClock('2026-11-22T03:00:00Z'), {
      marketAlwaysOpen: true,
    });
    meta.setAlwaysOpenOverride('CO', false);
    expect(meta.isMarketOpen('CO')).toBe(false);
    expect(meta.isMarketOpen('PE')).toBe(true);

    meta.setAlwaysOpenOverride('CO', null);
    expect(meta.isMarketOpen('CO')).toBe(true);

    meta.setAlwaysOpenOverride('PE', false);
    meta.clearOverrides();
    expect(meta.isMarketOpen('PE')).toBe(true);
  });

  it('avisa cuando faltan menos de 15 minutos para el cierre', () => {
    const clock = new FrozenClock('2026-11-18T20:44:59Z');
    const meta = new MetaService(clock, { marketAlwaysOpen: false });
    expect(meta.isClosingSoon('CO')).toBe(false);
    clock.set('2026-11-18T20:45:01Z');
    expect(meta.isClosingSoon('CO')).toBe(true);
    clock.set('2026-11-18T21:30:00Z');
    expect(meta.isClosingSoon('CO')).toBe(false);
  });
});
