import { describe, expect, it } from 'vitest';
import {
  dashboardSummaryResponse,
  type DashboardSummaryResponse,
} from '../../src/modules/dashboard/schemas.js';
import { INSTRUMENT_EXAMPLE } from '../../src/modules/market/schemas.js';
import {
  countriesResponse,
  countryResponse,
  type CountryResponse,
} from '../../src/modules/meta/schemas.js';
import {
  PORTFOLIO_SUMMARY_EXAMPLE,
  POSITION_EXAMPLE,
  portfolioResponse,
  portfolioSummaryResponse,
  positionResponse,
  type PortfolioResponse,
} from '../../src/modules/portfolio/schemas.js';
import {
  clockResponse,
  countryParams,
  createTestUserBody,
  instrumentIdParams,
  ledgerCheckResponse,
  marketOverrideResponse,
  priceOverrideResponse,
  setClockBody,
  setMarketBody,
  setPriceBody,
  type CreateTestUserBody,
  type LedgerCheckResponse,
  type SetClockBody,
  type SetMarketBody,
  type SetPriceBody,
} from '../../src/modules/testing/schemas.js';
import { TRANSACTION_EXAMPLE } from '../../src/modules/transactions/schemas.js';
import { healthResponse } from '../../src/http/health-route.js';
import {
  expectInvalid,
  expectResponseValid,
  expectValid,
  responseErrors,
} from '../helpers/schema-assertions.js';

const portfolio: PortfolioResponse = {
  ...PORTFOLIO_SUMMARY_EXAMPLE,
  positions: [POSITION_EXAMPLE],
  allocation: [
    { type: 'CASH', value: '50000000.00', pct: '99.43' },
    { type: 'STOCK', value: '286200.00', pct: '0.57' },
    { type: 'ETF', value: '0.00', pct: '0.00' },
  ],
  fx_rates_used: [{ from: 'MXN', to: 'COP', rate: '216.216216', as_of: '2026-11-18T14:42:00Z' }],
};

describe('portfolio', () => {
  it('el JSON de ejemplo de position del contrato cumple su schema', () => {
    expectResponseValid(positionResponse, POSITION_EXAMPLE);
    expectResponseValid(portfolioSummaryResponse, PORTFOLIO_SUMMARY_EXAMPLE);
    expectResponseValid(portfolioResponse, portfolio);
    expectResponseValid(portfolioResponse, { ...portfolio, positions: [], fx_rates_used: [] });
  });

  it('la respuesta no admite valores numéricos ni tipos de asignación desconocidos', () => {
    expect(responseErrors(positionResponse, { ...POSITION_EXAMPLE, market_value: 286200 })).toEqual(
      ['market_value'],
    );
    expect(responseErrors(positionResponse, { ...POSITION_EXAMPLE, quantity: 0 })).toEqual([
      'quantity',
    ]);
    expect(responseErrors(positionResponse, { ...POSITION_EXAMPLE, quantity: '120' })).toEqual([
      'quantity',
    ]);
    expect(responseErrors(portfolioResponse, { ...portfolio, total_value: 1 })).toEqual([
      'total_value',
    ]);
    expect(
      responseErrors(portfolioResponse, {
        ...portfolio,
        allocation: [{ type: 'CRYPTO', value: '1.00', pct: '1.00' }],
      }),
    ).toEqual(['allocation.0.type']);
    expect(
      responseErrors(portfolioResponse, {
        ...portfolio,
        fx_rates_used: [
          { from: 'USD', to: 'COP', rate: '4000.000000', as_of: '2026-11-18T14:42:00Z' },
        ],
      }),
    ).toEqual(['fx_rates_used.0.from']);
    const { fx_rates_used: _rates, ...withoutRates } = portfolio;
    expect(responseErrors(portfolioResponse, withoutRates)).toEqual(['fx_rates_used']);
  });
});

describe('dashboard', () => {
  const summary: DashboardSummaryResponse = {
    portfolio_summary: PORTFOLIO_SUMMARY_EXAMPLE,
    top_movers: { gainers: [INSTRUMENT_EXAMPLE], losers: [] },
    recent_transactions: [TRANSACTION_EXAMPLE],
  };

  it('acepta un ejemplo válido tipado con su interfaz', () => {
    expectResponseValid(dashboardSummaryResponse, summary);
  });

  it('acota la cantidad de movers y de transacciones recientes', () => {
    const four = Array.from({ length: 4 }, () => INSTRUMENT_EXAMPLE);
    expect(
      responseErrors(dashboardSummaryResponse, {
        ...summary,
        top_movers: { gainers: four, losers: [] },
      }),
    ).toEqual(['top_movers.gainers']);
    expect(
      responseErrors(dashboardSummaryResponse, {
        ...summary,
        recent_transactions: Array.from({ length: 6 }, () => TRANSACTION_EXAMPLE),
      }),
    ).toEqual(['recent_transactions']);
    expect(
      responseErrors(dashboardSummaryResponse, { ...summary, top_movers: { gainers: [] } }),
    ).toEqual(['top_movers.losers']);
  });
});

describe('meta y health', () => {
  const co: CountryResponse = {
    code: 'CO',
    currency: 'COP',
    time_zone: 'America/Bogota',
    document_types: ['CC', 'CE'],
    market: { status: 'OPEN', opens_at: '2026-11-18T14:30:00Z', closes_at: '2026-11-18T21:00:00Z' },
  };

  it('acepta un ejemplo válido tipado con su interfaz', () => {
    expectResponseValid(countryResponse, co);
    expectResponseValid(countriesResponse, [co]);
    expectResponseValid(healthResponse, { status: 'ok', db: 'ok' });
  });

  it('rechaza estados, documentos y monedas fuera del contrato', () => {
    expect(
      responseErrors(countryResponse, { ...co, market: { ...co.market, status: 'HALTED' } }),
    ).toEqual(['market.status']);
    expect(responseErrors(countryResponse, { ...co, document_types: ['PASSPORT'] })).toEqual([
      'document_types.0',
    ]);
    expect(responseErrors(countryResponse, { ...co, currency: 'USD' })).toEqual(['currency']);
    expect(responseErrors(countriesResponse, [{ ...co, code: 'AR' }])).toEqual(['0.code']);
    expect(responseErrors(healthResponse, { status: 'ok', db: 'down' })).toEqual(['db']);
  });
});

describe('testing', () => {
  it('acepta ejemplos válidos tipados con sus interfaces', () => {
    const clock: SetClockBody = { now: '2026-11-18T15:55:00Z' };
    expect(expectValid(setClockBody, clock)).toEqual(clock);
    expect(expectValid(setClockBody, { now: null })).toEqual({ now: null });

    const market: SetMarketBody = { always_open: false };
    expect(expectValid(setMarketBody, market)).toEqual(market);
    expect(expectValid(setMarketBody, { always_open: null })).toEqual({ always_open: null });

    const price: SetPriceBody = { price: '2500.00' };
    expect(expectValid(setPriceBody, price)).toEqual(price);
    expect(expectValid(setPriceBody, { price: null })).toEqual({ price: null });

    expectValid(countryParams, { country: 'MX' }, 'params');
    expectValid(instrumentIdParams, { instrument_id: 'WALMEX-MX' }, 'params');

    const user: CreateTestUserBody = {
      email: 'qa@example.com',
      password: 'Secret123',
      full_name: 'Usuario QA',
      country: 'PE',
      balances: { COP: '1000.00', PEN: '50.00' },
      positions: [{ instrument_id: 'BAP-PE', quantity: 3, avg_cost: '640.00' }],
    };
    expect(expectValid(createTestUserBody, user)).toEqual(user);
  });

  it('createTestUserBody aplica defaults a un cuerpo vacío', () => {
    expect(expectValid(createTestUserBody, {})).toEqual({
      password: 'Test1234!',
      full_name: 'Usuario QA',
      country: 'CO',
      balances: {},
      positions: [],
    });
  });

  it('rechaza cada regla', () => {
    expectInvalid(setClockBody, {}, 'now', 'REQUIRED');
    expectInvalid(setClockBody, { now: 'mañana' }, 'now', 'INVALID_FORMAT');
    expectInvalid(setClockBody, { now: 1_800_000_000 }, 'now', 'INVALID_FORMAT');
    expectInvalid(setMarketBody, {}, 'always_open', 'REQUIRED');
    expectInvalid(setMarketBody, { always_open: 'false' }, 'always_open', 'INVALID_FORMAT');
    expectInvalid(setPriceBody, {}, 'price', 'REQUIRED');
    expectInvalid(setPriceBody, { price: 2500 }, 'price', 'INVALID_FORMAT');
    expectInvalid(setPriceBody, { price: '0' }, 'price', 'TOO_SMALL');
    expectInvalid(countryParams, { country: 'AR' }, 'country', 'NOT_ALLOWED', 'params');
    expectInvalid(
      instrumentIdParams,
      { instrument_id: 'x' },
      'instrument_id',
      'INVALID_FORMAT',
      'params',
    );

    expectInvalid(createTestUserBody, { country: 'AR' }, 'country', 'NOT_ALLOWED');
    expectInvalid(createTestUserBody, { email: 'nope' }, 'email', 'INVALID_FORMAT');
    expectInvalid(createTestUserBody, { password: 'corta' }, 'password', 'TOO_SHORT');
    expectInvalid(createTestUserBody, { balances: { USD: '1.00' } }, 'balances.USD', 'NOT_ALLOWED');
    expectInvalid(createTestUserBody, { balances: { COP: 100 } }, 'balances.COP', 'INVALID_FORMAT');
    expectInvalid(
      createTestUserBody,
      { positions: [{ instrument_id: 'BAP-PE', quantity: 0 }] },
      'positions.0.quantity',
      'TOO_SMALL',
    );
    expectInvalid(
      createTestUserBody,
      { positions: [{ instrument_id: 'BAP-PE', quantity: 1, avg_cost: '0' }] },
      'positions.0.avg_cost',
      'TOO_SMALL',
    );
    expectInvalid(
      createTestUserBody,
      {
        positions: [
          { instrument_id: 'BAP-PE', quantity: 1 },
          { instrument_id: 'BAP-PE', quantity: 2 },
        ],
      },
      'positions.1',
      'INVALID_FORMAT',
    );
  });

  it('las respuestas cumplen sus schemas', () => {
    expectResponseValid(clockResponse, { now: '2026-11-18T15:55:00Z', frozen: true });
    expectResponseValid(marketOverrideResponse, {
      country: 'CO',
      always_open: false,
      market: {
        status: 'CLOSED',
        opens_at: '2026-11-19T14:30:00Z',
        closes_at: '2026-11-19T21:00:00Z',
      },
    });
    expectResponseValid(priceOverrideResponse, {
      instrument_id: 'BAP-PE',
      frozen: true,
      last_price: '640.00',
    });
    const ledger: LedgerCheckResponse = {
      balanced: false,
      accounts_checked: 12,
      mismatched_accounts: [{ account_id: 'acc_1', cached: '10.00', ledger: '9.00' }],
      unbalanced_journals: ['jrn_1'],
    };
    expectResponseValid(ledgerCheckResponse, ledger);
    expect(responseErrors(clockResponse, { now: '2026-11-18T15:55:00Z' })).toEqual(['frozen']);
    expect(responseErrors(ledgerCheckResponse, { ...ledger, balanced: 'yes' })).toEqual([
      'balanced',
    ]);
  });
});
