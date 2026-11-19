/**
 * Configuración **simulada** de países, horarios, comisiones, límites y tasas
 * de cambio (§8). Es un archivo de datos: los services no tienen estos valores
 * hardcodeados.
 *
 * Nada de esto refleja tarifas ni horarios reales de la BVC, la BMV ni la BVL.
 */
import type { Country, DocumentType, UserCurrency } from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';

export interface MarketHours {
  /** Hora local de apertura, `HH:MM`. */
  open: string;
  /** Hora local de cierre, `HH:MM`. */
  close: string;
  /** Días hábiles: 1 = lunes … 7 = domingo. */
  weekdays: readonly number[];
  /** Feriados en fecha local `YYYY-MM-DD`. Sin feriados en la fase 1. */
  holidays: readonly string[];
}

export interface CommissionRule {
  /** Porcentaje del bruto (`"0.30"` es 0,30 %). */
  ratePct: DecimalString;
  /** Comisión mínima en la moneda del país. */
  minimum: DecimalString;
  /** Impuesto sobre la comisión, en porcentaje (IVA de México). */
  taxPct: DecimalString;
}

export interface CountryConfig {
  code: Country;
  currency: UserCurrency;
  timeZone: string;
  documentTypes: readonly DocumentType[];
  market: MarketHours;
  commission: CommissionRule;
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

export const COUNTRY_CONFIG: Readonly<Record<Country, CountryConfig>> = Object.freeze({
  CO: {
    code: 'CO',
    currency: 'COP',
    timeZone: 'America/Bogota',
    documentTypes: ['CC', 'CE'],
    market: { open: '09:30', close: '16:00', weekdays: WEEKDAYS, holidays: [] },
    commission: { ratePct: '0.30', minimum: '5000', taxPct: '0' },
  },
  MX: {
    code: 'MX',
    currency: 'MXN',
    timeZone: 'America/Mexico_City',
    documentTypes: ['CURP'],
    market: { open: '08:30', close: '15:00', weekdays: WEEKDAYS, holidays: [] },
    commission: { ratePct: '0.25', minimum: '15', taxPct: '16' },
  },
  PE: {
    code: 'PE',
    currency: 'PEN',
    timeZone: 'America/Lima',
    documentTypes: ['DNI', 'CE'],
    market: { open: '09:00', close: '16:00', weekdays: WEEKDAYS, holidays: [] },
    commission: { ratePct: '0.35', minimum: '5', taxPct: '0' },
  },
});

export const CURRENCY_COUNTRY: Readonly<Record<UserCurrency, Country>> = Object.freeze({
  COP: 'CO',
  MXN: 'MX',
  PEN: 'PE',
});

/** Unidades de cada moneda por 1 USD. Las tasas cruzadas se derivan vía USD (§8.6). */
export const USD_RATES: Readonly<Record<UserCurrency, DecimalString>> = Object.freeze({
  COP: '4000',
  MXN: '18.5',
  PEN: '3.75',
});

export interface DepositLimit {
  /** Máximo por depósito. */
  perDeposit: DecimalString;
  /** Máximo acumulado por cuenta. */
  accumulated: DecimalString;
}

/** §8.3: el acumulado por cuenta es 10 veces el máximo por depósito. */
export const DEPOSIT_LIMITS: Readonly<Record<UserCurrency, DepositLimit>> = Object.freeze({
  COP: { perDeposit: '100000000', accumulated: '1000000000' },
  MXN: { perDeposit: '500000', accumulated: '5000000' },
  PEN: { perDeposit: '100000', accumulated: '1000000' },
});

/** Spread simulado sobre el último precio: compra arriba, venta abajo (§8.4). */
export const SPREAD_PCT: DecimalString = '0.10';

/** `MARKET_CLOSING_SOON` si faltan menos de estos minutos para el cierre. */
export const CLOSING_SOON_MINUTES = 15;
