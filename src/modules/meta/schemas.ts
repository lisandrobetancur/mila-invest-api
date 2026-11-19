import Joi from 'joi';
import {
  DOCUMENT_TYPES,
  MARKET_STATUSES,
  type Country,
  type DocumentType,
  type MarketStatus,
  type UserCurrency,
} from '../../core/domain.js';
import { country, timestamp, userCurrency } from '../../http/schemas/common.js';

export interface MarketStateResponse {
  status: MarketStatus;
  /** Apertura de la sesión en curso, o de la próxima si el mercado está cerrado. */
  opens_at: string;
  /** Cierre de la sesión en curso, o de la próxima si el mercado está cerrado. */
  closes_at: string;
}

export interface CountryResponse {
  code: Country;
  currency: UserCurrency;
  time_zone: string;
  document_types: DocumentType[];
  market: MarketStateResponse;
}

export const marketStateResponse: Joi.ObjectSchema<MarketStateResponse> =
  Joi.object<MarketStateResponse>({
    status: Joi.string()
      .valid(...MARKET_STATUSES)
      .required(),
    opens_at: timestamp().required(),
    closes_at: timestamp().required(),
  });

export const countryResponse: Joi.ObjectSchema<CountryResponse> = Joi.object<CountryResponse>({
  code: country().required(),
  currency: userCurrency().required(),
  time_zone: Joi.string().required().example('America/Bogota'),
  document_types: Joi.array()
    .items(Joi.string().valid(...DOCUMENT_TYPES))
    .required(),
  market: marketStateResponse.required(),
});

export const countriesResponse: Joi.ArraySchema<CountryResponse[]> = Joi.array<CountryResponse[]>()
  .items(countryResponse)
  .example([
    {
      code: 'CO',
      currency: 'COP',
      time_zone: 'America/Bogota',
      document_types: ['CC', 'CE'],
      market: {
        status: 'OPEN',
        opens_at: '2026-11-18T14:30:00Z',
        closes_at: '2026-11-18T21:00:00Z',
      },
    },
  ]);
