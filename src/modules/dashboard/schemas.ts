import Joi from 'joi';
import {
  INSTRUMENT_EXAMPLE,
  instrumentResponse,
  type InstrumentResponse,
} from '../market/schemas.js';
import {
  PORTFOLIO_SUMMARY_EXAMPLE,
  portfolioSummaryResponse,
  type PortfolioSummaryResponse,
} from '../portfolio/schemas.js';
import {
  TRANSACTION_EXAMPLE,
  transactionResponse,
  type TransactionResponse,
} from '../transactions/schemas.js';

export const TOP_MOVERS_COUNT = 3;
export const RECENT_TRANSACTIONS_COUNT = 5;

export interface TopMoversResponse {
  /** Instrumentos que más suben hoy, de mayor a menor `change_pct`. */
  gainers: InstrumentResponse[];
  /** Instrumentos que más bajan hoy, de menor a mayor `change_pct`. */
  losers: InstrumentResponse[];
}

export interface DashboardSummaryResponse {
  portfolio_summary: PortfolioSummaryResponse;
  top_movers: TopMoversResponse;
  recent_transactions: TransactionResponse[];
}

export const dashboardSummaryResponse: Joi.ObjectSchema<DashboardSummaryResponse> =
  Joi.object<DashboardSummaryResponse>({
    portfolio_summary: portfolioSummaryResponse.required(),
    top_movers: Joi.object<TopMoversResponse>({
      gainers: Joi.array().items(instrumentResponse).max(TOP_MOVERS_COUNT).required(),
      losers: Joi.array().items(instrumentResponse).max(TOP_MOVERS_COUNT).required(),
    }).required(),
    recent_transactions: Joi.array()
      .items(transactionResponse)
      .max(RECENT_TRANSACTIONS_COUNT)
      .required(),
  }).example({
    portfolio_summary: PORTFOLIO_SUMMARY_EXAMPLE,
    top_movers: { gainers: [INSTRUMENT_EXAMPLE], losers: [] },
    recent_transactions: [TRANSACTION_EXAMPLE],
  });
