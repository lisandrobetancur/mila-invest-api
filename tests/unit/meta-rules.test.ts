import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../../src/core/clock.js';
import { Decimal } from '../../src/core/money.js';
import { DEPOSIT_LIMITS } from '../../src/modules/meta/data.js';
import { commissionFor, executionPriceFor, fxRateBetween } from '../../src/modules/meta/rules.js';
import { MetaService } from '../../src/modules/meta/service.js';

const d = (value: string): Decimal => new Decimal(value);

describe('comisiones por país', () => {
  it('CO: 0,30 % del bruto con mínimo de COP 5.000', () => {
    expect(commissionFor('CO', d('23860')).toFixed(2)).toBe('5000.00');
    expect(commissionFor('CO', d('1666666.66')).toFixed(2)).toBe('5000.00');
    expect(commissionFor('CO', d('1666666.67')).toFixed(2)).toBe('5000.00');
    expect(commissionFor('CO', d('2000000')).toFixed(2)).toBe('6000.00');
    expect(commissionFor('CO', d('10000000')).toFixed(2)).toBe('30000.00');
  });

  it('MX: 0,25 % del bruto con mínimo de MXN 15, más IVA del 16 %', () => {
    // Mínimo: 15 + 16 % = 17,40.
    expect(commissionFor('MX', d('2920')).toFixed(2)).toBe('17.40');
    expect(commissionFor('MX', d('6000')).toFixed(2)).toBe('17.40');
    // 0,25 % de 100.000 = 250; con IVA 290.
    expect(commissionFor('MX', d('100000')).toFixed(2)).toBe('290.00');
    // 0,25 % de 12.345,67 = 30,864175; con IVA 35,802443 → 35,80.
    expect(commissionFor('MX', d('12345.67')).toFixed(2)).toBe('35.80');
  });

  it('PE: 0,35 % del bruto con mínimo de PEN 5', () => {
    expect(commissionFor('PE', d('100')).toFixed(2)).toBe('5.00');
    expect(commissionFor('PE', d('6400')).toFixed(2)).toBe('22.40');
    expect(commissionFor('PE', d('1428.57')).toFixed(2)).toBe('5.00');
    expect(commissionFor('PE', d('1500')).toFixed(2)).toBe('5.25');
  });
});

describe('precio de ejecución', () => {
  it('aplica el spread de 0,10 %: compra arriba, venta abajo, a 2 decimales', () => {
    expect(executionPriceFor(d('2500'), 'BUY').toFixed(2)).toBe('2502.50');
    expect(executionPriceFor(d('2500'), 'SELL').toFixed(2)).toBe('2497.50');
    expect(executionPriceFor(d('2.50'), 'BUY').toFixed(2)).toBe('2.50');
    expect(executionPriceFor(d('2385.00'), 'BUY').toFixed(2)).toBe('2387.38');
  });
});

describe('tasas de cambio simuladas', () => {
  it('deriva las tasas cruzadas vía USD', () => {
    expect(fxRateBetween('COP', 'COP').toFixed()).toBe('1');
    expect(fxRateBetween('MXN', 'COP').toFixed(6)).toBe('216.216216');
    expect(fxRateBetween('PEN', 'COP').toFixed(6)).toBe('1066.666667');
    expect(fxRateBetween('COP', 'MXN').toFixed(6)).toBe('0.004625');
    expect(fxRateBetween('PEN', 'MXN').toFixed(6)).toBe('4.933333');
  });

  it('una ida y vuelta devuelve el monto original', () => {
    const meta = new MetaService(new FrozenClock('2026-11-18T15:00:00Z'), {
      marketAlwaysOpen: true,
    });
    const there = meta.convert(d('1000'), 'MXN', 'PEN');
    expect(meta.convert(there, 'PEN', 'MXN').toFixed(6)).toBe('1000.000000');
    expect(meta.fxRate('PEN', 'PEN').toFixed()).toBe('1');
  });
});

describe('MetaService', () => {
  const meta = new MetaService(new FrozenClock('2026-11-18T15:00:00Z'), {
    marketAlwaysOpen: false,
  });

  it('expone la configuración y los límites por moneda', () => {
    expect(meta.countryConfig('MX').documentTypes).toEqual(['CURP']);
    expect(meta.countryOfCurrency('PEN')).toBe('PE');
    expect(meta.depositLimit('COP')).toEqual(DEPOSIT_LIMITS.COP);
    expect(meta.commission('CO', d('23860')).toFixed(2)).toBe('5000.00');
    expect(meta.executionPrice(d('100'), 'SELL').toFixed(2)).toBe('99.90');
  });

  it('el máximo acumulado es 10 veces el máximo por depósito', () => {
    for (const limit of Object.values(DEPOSIT_LIMITS)) {
      expect(d(limit.accumulated).equals(d(limit.perDeposit).times(10))).toBe(true);
    }
  });
});
