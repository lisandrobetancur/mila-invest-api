/**
 * Aritmética de dinero.
 *
 * Reglas (§6):
 * - en la lógica, `Decimal` de decimal.js, configurado una sola vez acá;
 * - en PostgreSQL, `NUMERIC` (drizzle en modo string);
 * - en JSON, siempre string decimal (`"1234.56"`), nunca `number`.
 *
 * `number` solo se usa para cantidades de acciones (enteras), `limit` y
 * contadores.
 */
import { Decimal } from 'decimal.js';
import type { Currency } from './domain.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -18, toExpPos: 24 });

export { Decimal };

/**
 * String con formato decimal, como viaja en el JSON de la API y como lo
 * devuelve drizzle para una columna `NUMERIC`. Es un alias de `string`: Joi
 * valida el formato en tiempo de ejecución (`decimalString()` en §5).
 */
export type DecimalString = string;

/** Decimales de los montos al persistir y al responder, por moneda. */
export const AMOUNT_DECIMALS: Readonly<Record<Currency, number>> = Object.freeze({
  COP: 2,
  MXN: 2,
  PEN: 2,
  USD: 2,
});

/** Los precios se guardan con hasta 6 decimales... */
export const PRICE_STORAGE_DECIMALS = 6;
/** ...y se responden con 2, igual que los montos. */
export const PRICE_RESPONSE_DECIMALS = 2;
export const PERCENT_DECIMALS = 2;

export const DECIMAL_STRING_PATTERN = /^-?\d{1,16}(\.\d{1,6})?$/;

export const ZERO = new Decimal(0);

/** Construye un `Decimal` desde un string decimal o desde otro `Decimal`. */
export function toDecimal(value: DecimalString | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return parseDecimalString(value);
}

/**
 * Parsea un string decimal. Lanza si el formato no es el del contrato: así un
 * valor que no pasó por Joi (p. ej. una fila inesperada de la base) no se
 * convierte en `NaN` silencioso.
 */
export function parseDecimalString(value: string): Decimal {
  if (!DECIMAL_STRING_PATTERN.test(value)) {
    throw new TypeError(`Valor decimal con formato inválido: ${JSON.stringify(value)}`);
  }
  return new Decimal(value);
}

export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === 'string' && DECIMAL_STRING_PATTERN.test(value);
}

/** Cuantiza un monto a los decimales de su moneda (ROUND_HALF_EVEN). */
export function quantizeAmount(value: DecimalString | Decimal, currency: Currency): Decimal {
  return toDecimal(value).toDecimalPlaces(AMOUNT_DECIMALS[currency], Decimal.ROUND_HALF_EVEN);
}

/** Cuantiza un precio a los 6 decimales con los que se persiste. */
export function quantizePrice(value: DecimalString | Decimal): Decimal {
  return toDecimal(value).toDecimalPlaces(PRICE_STORAGE_DECIMALS, Decimal.ROUND_HALF_EVEN);
}

/** Monto listo para el JSON o para `NUMERIC`: string con los decimales de la moneda. */
export function formatAmount(value: DecimalString | Decimal, currency: Currency): DecimalString {
  return quantizeAmount(value, currency).toFixed(AMOUNT_DECIMALS[currency]);
}

/** Precio tal como se responde: siempre 2 decimales. */
export function formatPrice(value: DecimalString | Decimal): DecimalString {
  return toDecimal(value).toFixed(PRICE_RESPONSE_DECIMALS, Decimal.ROUND_HALF_EVEN);
}

/** Precio tal como se persiste: 6 decimales. */
export function formatStoredPrice(value: DecimalString | Decimal): DecimalString {
  return quantizePrice(value).toFixed(PRICE_STORAGE_DECIMALS);
}

/** Porcentaje tal como se responde: `"2.35"` es 2,35 %. */
export function formatPercent(value: DecimalString | Decimal): DecimalString {
  return toDecimal(value).toFixed(PERCENT_DECIMALS, Decimal.ROUND_HALF_EVEN);
}

/** Variación porcentual de `current` respecto de `previous`; 0 si no hay base. */
export function percentChange(
  current: DecimalString | Decimal,
  previous: DecimalString | Decimal,
): Decimal {
  const base = toDecimal(previous);
  if (base.isZero()) return ZERO;
  return toDecimal(current).minus(base).dividedBy(base).times(100);
}

export function sumDecimals(values: readonly (DecimalString | Decimal)[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.plus(toDecimal(value)), ZERO);
}

export function maxDecimal(a: DecimalString | Decimal, b: DecimalString | Decimal): Decimal {
  const left = toDecimal(a);
  const right = toDecimal(b);
  return left.greaterThanOrEqualTo(right) ? left : right;
}
