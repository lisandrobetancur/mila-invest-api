import Joi from 'joi';
import {
  INSTRUMENT_TYPES,
  PRICE_RANGES,
  type Country,
  type InstrumentType,
  type PriceRange,
  type UserCurrency,
} from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';
import type { Page } from '../../core/pagination.js';
import {
  country,
  cursor,
  decimalString,
  instrumentId,
  limit,
  paginated,
  timestamp,
  userCurrency,
  type PaginationQuery,
} from '../../http/schemas/common.js';

export interface InstrumentResponse {
  id: string;
  ticker: string;
  name: string;
  country: Country;
  type: InstrumentType;
  currency: UserCurrency;
  last_price: DecimalString;
  /** Variación contra el cierre del día hábil anterior. */
  change: DecimalString;
  change_pct: DecimalString;
  updated_at: string;
}

export interface InstrumentDetailResponse extends InstrumentResponse {
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  prev_close: DecimalString;
  volume: number;
  description: string;
}

export interface PricePointResponse {
  t: string;
  price: DecimalString;
}

export interface PricesResponse {
  range: PriceRange;
  currency: UserCurrency;
  points: PricePointResponse[];
}

export interface ListInstrumentsQuery extends PaginationQuery {
  country?: Country;
  type?: InstrumentType;
  q?: string;
}

export interface InstrumentParams {
  id: string;
}

export interface PricesQuery {
  range: PriceRange;
}

export const INSTRUMENT_EXAMPLE: InstrumentResponse = {
  id: 'ECOPETROL-CO',
  ticker: 'ECOPETROL',
  name: 'Ecopetrol S.A.',
  country: 'CO',
  type: 'STOCK',
  currency: 'COP',
  last_price: '2385.00',
  change: '35.00',
  change_pct: '1.49',
  updated_at: '2026-11-18T14:42:00Z',
};

const instrumentFields = {
  id: instrumentId().required(),
  ticker: Joi.string()
    .pattern(/^[A-Z0-9]{1,12}$/)
    .required(),
  name: Joi.string().required(),
  country: country().required(),
  type: Joi.string()
    .valid(...INSTRUMENT_TYPES)
    .required(),
  currency: userCurrency().required(),
  last_price: decimalString().required(),
  change: decimalString().required(),
  change_pct: decimalString().required(),
  updated_at: timestamp().required(),
};

export const instrumentResponse: Joi.ObjectSchema<InstrumentResponse> =
  Joi.object<InstrumentResponse>(instrumentFields).example(INSTRUMENT_EXAMPLE);

export const instrumentsPage: Joi.ObjectSchema<Page<InstrumentResponse>> =
  paginated(instrumentResponse);

export const instrumentDetailResponse: Joi.ObjectSchema<InstrumentDetailResponse> =
  Joi.object<InstrumentDetailResponse>({
    ...instrumentFields,
    open: decimalString().required(),
    high: decimalString().required(),
    low: decimalString().required(),
    prev_close: decimalString().required(),
    volume: Joi.number().integer().min(0).required(),
    description: Joi.string().required(),
  }).example({
    ...INSTRUMENT_EXAMPLE,
    open: '2352.00',
    high: '2391.00',
    low: '2348.00',
    prev_close: '2350.00',
    volume: 4200000,
    description: 'Ecopetrol S.A. Precio simulado: no refleja cotizaciones reales.',
  });

export const pricesResponse: Joi.ObjectSchema<PricesResponse> = Joi.object<PricesResponse>({
  range: Joi.string()
    .valid(...PRICE_RANGES)
    .required(),
  currency: userCurrency().required(),
  points: Joi.array()
    .items(
      Joi.object<PricePointResponse>({
        t: timestamp().required(),
        price: decimalString().required(),
      }),
    )
    .max(400)
    .required(),
}).example({
  range: '1D',
  currency: 'COP',
  points: [
    { t: '2026-11-18T14:30:00Z', price: '2352.00' },
    { t: '2026-11-18T14:35:00Z', price: '2361.50' },
  ],
});

export const listInstrumentsQuery: Joi.ObjectSchema<ListInstrumentsQuery> =
  Joi.object<ListInstrumentsQuery>({
    country: country(),
    type: Joi.string().valid(...INSTRUMENT_TYPES),
    q: Joi.string().trim().min(1).max(50).description('Busca en el ticker y en el nombre'),
    cursor: cursor(),
    limit: limit(),
  });

export const instrumentParams: Joi.ObjectSchema<InstrumentParams> = Joi.object<InstrumentParams>({
  id: instrumentId().required(),
});

export const pricesQuery: Joi.ObjectSchema<PricesQuery> = Joi.object<PricesQuery>({
  range: Joi.string()
    .valid(...PRICE_RANGES)
    .default('1D'),
});
