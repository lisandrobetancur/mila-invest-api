/**
 * Reglas de cálculo simuladas, como funciones puras sobre los datos de
 * `data.ts`: comisión, precio de ejecución y tasas de cambio (§8.4 y §8.6).
 */
import type { Country, OrderSide, UserCurrency } from '../../core/domain.js';
import { Decimal, maxDecimal, quantizeAmount, toDecimal } from '../../core/money.js';
import { COUNTRY_CONFIG, SPREAD_PCT, USD_RATES } from './data.js';

const ONE = new Decimal(1);
const HUNDRED = new Decimal(100);

/** Comisión sobre el bruto, con mínimo e impuesto, cuantizada a la moneda del país. */
export function commissionFor(country: Country, gross: Decimal): Decimal {
  const { commission, currency } = COUNTRY_CONFIG[country];
  const base = maxDecimal(gross.times(commission.ratePct).dividedBy(HUNDRED), commission.minimum);
  const withTax = base.times(HUNDRED.plus(commission.taxPct)).dividedBy(HUNDRED);
  return quantizeAmount(withTax, currency);
}

/** Último precio ± spread (compra arriba, venta abajo), cuantizado a 2 decimales. */
export function executionPriceFor(lastPrice: Decimal, side: OrderSide): Decimal {
  const spread = toDecimal(SPREAD_PCT).dividedBy(HUNDRED);
  const factor = side === 'BUY' ? ONE.plus(spread) : ONE.minus(spread);
  return lastPrice.times(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

/** Unidades de `to` por 1 unidad de `from`, derivada vía USD. */
export function fxRateBetween(from: UserCurrency, to: UserCurrency): Decimal {
  if (from === to) return ONE;
  return toDecimal(USD_RATES[to]).dividedBy(USD_RATES[from]);
}
