import Joi from 'joi';
import type { InstrumentType, UserCurrency } from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';
import { decimalString, timestamp, userCurrency } from '../../http/schemas/common.js';
import {
  INSTRUMENT_EXAMPLE,
  instrumentResponse,
  type InstrumentResponse,
} from '../market/schemas.js';

export const ALLOCATION_TYPES = ['CASH', 'STOCK', 'ETF'] as const;
export type AllocationType = 'CASH' | InstrumentType;

export interface PositionResponse {
  instrument: InstrumentResponse;
  quantity: number;
  avg_cost: DecimalString;
  market_value: DecimalString;
  unrealized_pnl: DecimalString;
  unrealized_pnl_pct: DecimalString;
  /** Moneda del instrumento: en ella van `avg_cost`, `market_value` y `unrealized_pnl`. */
  currency: UserCurrency;
}

export interface AllocationResponse {
  type: AllocationType;
  /** En la moneda base del usuario. */
  value: DecimalString;
  pct: DecimalString;
}

export interface FxRateResponse {
  from: UserCurrency;
  to: UserCurrency;
  /** Unidades de `to` por 1 unidad de `from`. */
  rate: DecimalString;
  as_of: string;
}

/** Totales del portafolio, expresados en la moneda base del usuario. */
export interface PortfolioSummaryResponse {
  base_currency: UserCurrency;
  total_value: DecimalString;
  cash_value: DecimalString;
  invested_value: DecimalString;
  /** Valor actual − valor al cierre anterior de las posiciones actuales. */
  day_change: DecimalString;
  day_change_pct: DecimalString;
}

export interface PortfolioResponse extends PortfolioSummaryResponse {
  positions: PositionResponse[];
  allocation: AllocationResponse[];
  fx_rates_used: FxRateResponse[];
}

export const POSITION_EXAMPLE: PositionResponse = {
  instrument: INSTRUMENT_EXAMPLE,
  quantity: 120,
  avg_cost: '2210.50',
  market_value: '286200.00',
  unrealized_pnl: '20940.00',
  unrealized_pnl_pct: '7.89',
  currency: 'COP',
};

export const positionResponse: Joi.ObjectSchema<PositionResponse> = Joi.object<PositionResponse>({
  instrument: instrumentResponse.required(),
  quantity: Joi.number().integer().min(1).required(),
  avg_cost: decimalString().required(),
  market_value: decimalString().required(),
  unrealized_pnl: decimalString().required(),
  unrealized_pnl_pct: decimalString().required(),
  currency: userCurrency().required(),
}).example(POSITION_EXAMPLE);

const summaryFields = {
  base_currency: userCurrency().required(),
  total_value: decimalString().required(),
  cash_value: decimalString().required(),
  invested_value: decimalString().required(),
  day_change: decimalString().required(),
  day_change_pct: decimalString().required(),
};

export const PORTFOLIO_SUMMARY_EXAMPLE: PortfolioSummaryResponse = {
  base_currency: 'COP',
  total_value: '50286200.00',
  cash_value: '50000000.00',
  invested_value: '286200.00',
  day_change: '4200.00',
  day_change_pct: '1.49',
};

export const portfolioSummaryResponse: Joi.ObjectSchema<PortfolioSummaryResponse> =
  Joi.object<PortfolioSummaryResponse>(summaryFields).example(PORTFOLIO_SUMMARY_EXAMPLE);

export const portfolioResponse: Joi.ObjectSchema<PortfolioResponse> = Joi.object<PortfolioResponse>(
  {
    ...summaryFields,
    positions: Joi.array().items(positionResponse).required(),
    allocation: Joi.array()
      .items(
        Joi.object<AllocationResponse>({
          type: Joi.string()
            .valid(...ALLOCATION_TYPES)
            .required(),
          value: decimalString().required(),
          pct: decimalString().required(),
        }),
      )
      .required(),
    fx_rates_used: Joi.array()
      .items(
        Joi.object<FxRateResponse>({
          from: userCurrency().required(),
          to: userCurrency().required(),
          rate: decimalString().required(),
          as_of: timestamp().required(),
        }),
      )
      .required(),
  },
).example({
  ...PORTFOLIO_SUMMARY_EXAMPLE,
  positions: [POSITION_EXAMPLE],
  allocation: [
    { type: 'CASH', value: '50000000.00', pct: '99.43' },
    { type: 'STOCK', value: '286200.00', pct: '0.57' },
    { type: 'ETF', value: '0.00', pct: '0.00' },
  ],
  fx_rates_used: [
    { from: 'MXN', to: 'COP', rate: '216.216216', as_of: '2026-11-18T14:42:00Z' },
    { from: 'PEN', to: 'COP', rate: '1066.666667', as_of: '2026-11-18T14:42:00Z' },
  ],
});
