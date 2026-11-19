import { describe, expect, it } from 'vitest';
import {
  Decimal,
  ZERO,
  formatAmount,
  formatPercent,
  formatPrice,
  formatStoredPrice,
  isDecimalString,
  maxDecimal,
  parseDecimalString,
  percentChange,
  quantizeAmount,
  quantizePrice,
  sumDecimals,
  toDecimal,
} from '../../src/core/money.js';

describe('money', () => {
  it('suma 0.1 + 0.2 y da exactamente 0.3', () => {
    expect(toDecimal('0.1').plus('0.2').equals('0.3')).toBe(true);
    expect(toDecimal('0.1').plus('0.2').toFixed()).toBe('0.3');
    expect(sumDecimals(['0.1', '0.2']).toFixed()).toBe('0.3');
  });

  it('usa precisión 28 y redondeo bancario (half-even)', () => {
    expect(Decimal.precision).toBe(28);
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_EVEN);
  });

  it.each(['COP', 'MXN', 'PEN', 'USD'] as const)(
    'cuantiza montos en %s a 2 decimales',
    (currency) => {
      expect(formatAmount('1234.5', currency)).toBe('1234.50');
      expect(formatAmount('0', currency)).toBe('0.00');
      expect(formatAmount('-23860', currency)).toBe('-23860.00');
      expect(quantizeAmount('10.004', currency).toFixed()).toBe('10');
    },
  );

  it('redondea los empates al par más cercano', () => {
    expect(formatAmount('0.125', 'COP')).toBe('0.12');
    expect(formatAmount('0.135', 'COP')).toBe('0.14');
    expect(formatAmount('2.5', 'COP')).toBe('2.50');
    expect(formatAmount('1.005', 'MXN')).toBe('1.00');
    expect(formatAmount('1.015', 'MXN')).toBe('1.02');
    expect(formatAmount('-0.125', 'PEN')).toBe('-0.12');
  });

  it('guarda precios con 6 decimales y los responde con 2', () => {
    expect(quantizePrice(new Decimal('2385.1234567')).toFixed()).toBe('2385.123457');
    expect(formatStoredPrice('2385')).toBe('2385.000000');
    expect(formatPrice('2385')).toBe('2385.00');
    expect(formatPrice('2385.125')).toBe('2385.12');
    expect(formatPrice(new Decimal('2.5'))).toBe('2.50');
  });

  it('formatea porcentajes con 2 decimales', () => {
    expect(formatPercent('1.489')).toBe('1.49');
    expect(formatPercent('7.894')).toBe('7.89');
  });

  it('calcula la variación porcentual y devuelve 0 si no hay base', () => {
    expect(formatPercent(percentChange('2385', '2350'))).toBe('1.49');
    expect(percentChange('100', '0').equals(ZERO)).toBe(true);
    expect(formatPercent(percentChange('90', '100'))).toBe('-10.00');
  });

  it('rechaza strings que no son decimales del contrato', () => {
    for (const invalid of [
      '',
      'abc',
      '1e5',
      '1,5',
      '1.',
      '.5',
      '1.1234567',
      ' 1',
      'NaN',
      'Infinity',
    ]) {
      expect(() => parseDecimalString(invalid), invalid).toThrow(TypeError);
      expect(isDecimalString(invalid), invalid).toBe(false);
    }
    expect(isDecimalString(1000)).toBe(false);
    expect(isDecimalString('1000.50')).toBe(true);
    expect(isDecimalString('-0.000001')).toBe(true);
  });

  it('acepta un Decimal tal cual y compara máximos', () => {
    const value = new Decimal('5');
    expect(toDecimal(value)).toBe(value);
    expect(maxDecimal('5', '7').toFixed()).toBe('7');
    expect(maxDecimal('7', '5').toFixed()).toBe('7');
    expect(sumDecimals([]).isZero()).toBe(true);
  });
});
