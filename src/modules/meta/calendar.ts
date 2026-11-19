/**
 * Calendario de mercado: funciones puras sobre un instante y un huso horario.
 *
 * Usa `Intl.DateTimeFormat` con `timeZone`, sin librerías de fechas (§8.1).
 * No lee el reloj: el instante siempre llega como argumento.
 */
import type { MarketHours } from './data.js';

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

/** Fecha de calendario local (sin hora). */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

export interface Session {
  /** Fecha local de la sesión, `YYYY-MM-DD`. */
  day: string;
  open: Date;
  close: Date;
  /** Duración de la sesión en minutos. */
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localDateTime(instant: Date, timeZone: string): LocalDateTime {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number.parseInt(part.value, 10);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  };
}

export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const { year, month, day } = localDateTime(instant, timeZone);
  return { year, month, day };
}

/** Instante UTC que corresponde a una hora de pared local. */
export function zonedTimeToUtc(
  date: LocalDate,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const local = localDateTime(new Date(guess), timeZone);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return new Date(guess - (localAsUtc - guess));
}

export function formatLocalDate(date: LocalDate): string {
  const pad = (part: number, length: number): string => String(part).padStart(length, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

export function parseLocalDate(value: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) throw new TypeError(`Fecha local inválida: ${value}`);
  return {
    year: Number.parseInt(match[1] ?? '0', 10),
    month: Number.parseInt(match[2] ?? '0', 10),
    day: Number.parseInt(match[3] ?? '0', 10),
  };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** 1 = lunes … 7 = domingo. */
export function isoWeekday(date: LocalDate): number {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) throw new TypeError(`Hora inválida: ${value}`);
  return {
    hour: Number.parseInt(match[1] ?? '0', 10),
    minute: Number.parseInt(match[2] ?? '0', 10),
  };
}

export class MarketCalendar {
  public constructor(
    public readonly timeZone: string,
    private readonly hours: MarketHours,
  ) {}

  public isBusinessDay(date: LocalDate): boolean {
    return (
      this.hours.weekdays.includes(isoWeekday(date)) &&
      !this.hours.holidays.includes(formatLocalDate(date))
    );
  }

  public sessionOn(date: LocalDate): Session {
    const open = parseClock(this.hours.open);
    const close = parseClock(this.hours.close);
    const openAt = zonedTimeToUtc(date, open.hour, open.minute, this.timeZone);
    const closeAt = zonedTimeToUtc(date, close.hour, close.minute, this.timeZone);
    return {
      day: formatLocalDate(date),
      open: openAt,
      close: closeAt,
      minutes: Math.round((closeAt.getTime() - openAt.getTime()) / MINUTE_MS),
    };
  }

  public previousBusinessDay(date: LocalDate): LocalDate {
    let candidate = addDays(date, -1);
    while (!this.isBusinessDay(candidate)) candidate = addDays(candidate, -1);
    return candidate;
  }

  public nextBusinessDay(date: LocalDate): LocalDate {
    let candidate = addDays(date, 1);
    while (!this.isBusinessDay(candidate)) candidate = addDays(candidate, 1);
    return candidate;
  }

  /** `true` si `instant` cae dentro de una sesión (`open <= t < close`). */
  public isOpenAt(instant: Date): boolean {
    return this.currentSession(instant) !== null;
  }

  /** La sesión en curso en `instant`, o `null` si el mercado está cerrado. */
  public currentSession(instant: Date): Session | null {
    const today = localDateOf(instant, this.timeZone);
    if (!this.isBusinessDay(today)) return null;
    const session = this.sessionOn(today);
    const time = instant.getTime();
    return time >= session.open.getTime() && time < session.close.getTime() ? session : null;
  }

  /** La próxima sesión que todavía no abrió en `instant`. */
  public nextSession(instant: Date): Session {
    const today = localDateOf(instant, this.timeZone);
    if (this.isBusinessDay(today)) {
      const session = this.sessionOn(today);
      if (instant.getTime() < session.open.getTime()) return session;
    }
    return this.sessionOn(this.nextBusinessDay(today));
  }

  /**
   * La sesión vigente para precios: la que está en curso, o la última que ya
   * abrió (fuera de horario el precio queda congelado en su cierre, §8.5).
   */
  public latestSession(instant: Date): Session {
    const today = localDateOf(instant, this.timeZone);
    if (this.isBusinessDay(today)) {
      const session = this.sessionOn(today);
      if (instant.getTime() >= session.open.getTime()) return session;
    }
    return this.sessionOn(this.previousBusinessDay(today));
  }

  /** La sesión hábil anterior a la de `day` (`YYYY-MM-DD`). */
  public sessionBefore(day: string): Session {
    return this.sessionOn(this.previousBusinessDay(parseLocalDate(day)));
  }

  /** La sesión hábil siguiente a la de `day` (`YYYY-MM-DD`). */
  public sessionAfter(day: string): Session {
    return this.sessionOn(this.nextBusinessDay(parseLocalDate(day)));
  }
}
