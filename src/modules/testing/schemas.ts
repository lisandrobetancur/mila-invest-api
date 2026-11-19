/**
 * Schemas de los endpoints de control para QA (§11). Solo existen en
 * `APP_ENV` = `dev` o `test`.
 */
import Joi from 'joi';
import type { Country, UserCurrency } from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';
import {
  country,
  decimalString,
  inputTimestamp,
  instrumentId,
  positiveDecimalString,
  timestamp,
} from '../../http/schemas/common.js';
import { registerResponse, type RegisterResponse } from '../auth/schemas.js';
import { marketStateResponse, type MarketStateResponse } from '../meta/schemas.js';
import { MAX_ORDER_QUANTITY } from '../orders/schemas.js';

// ---------- reloj ----------

export interface SetClockBody {
  /** Instante en el que se congela el reloj; `null` vuelve al reloj del sistema. */
  now: string | null;
}

export interface ClockResponse {
  now: string;
  frozen: boolean;
}

export const setClockBody: Joi.ObjectSchema<SetClockBody> = Joi.object<SetClockBody>({
  now: inputTimestamp().allow(null).required(),
});

export const clockResponse: Joi.ObjectSchema<ClockResponse> = Joi.object<ClockResponse>({
  now: timestamp().required(),
  frozen: Joi.boolean().required(),
});

// ---------- mercado ----------

export interface CountryParams {
  country: Country;
}

export interface SetMarketBody {
  /**
   * `true`: el mercado del país está siempre abierto. `false`: respeta el
   * horario simulado (queda cerrado fuera de él). `null`: vuelve a
   * `MARKET_ALWAYS_OPEN`.
   */
  always_open: boolean | null;
}

export interface MarketOverrideResponse {
  country: Country;
  always_open: boolean;
  market: MarketStateResponse;
}

export const countryParams: Joi.ObjectSchema<CountryParams> = Joi.object<CountryParams>({
  country: country().required(),
});

export const setMarketBody: Joi.ObjectSchema<SetMarketBody> = Joi.object<SetMarketBody>({
  always_open: Joi.boolean().allow(null).required(),
});

export const marketOverrideResponse: Joi.ObjectSchema<MarketOverrideResponse> =
  Joi.object<MarketOverrideResponse>({
    country: country().required(),
    always_open: Joi.boolean().required(),
    market: marketStateResponse.required(),
  });

// ---------- precios ----------

export interface InstrumentIdParams {
  instrument_id: string;
}

export interface SetPriceBody {
  /** Precio en el que se congela el instrumento; `null` lo libera. */
  price: DecimalString | null;
}

export interface PriceOverrideResponse {
  instrument_id: string;
  frozen: boolean;
  last_price: DecimalString;
}

export const instrumentIdParams: Joi.ObjectSchema<InstrumentIdParams> =
  Joi.object<InstrumentIdParams>({
    instrument_id: instrumentId().required(),
  });

export const setPriceBody: Joi.ObjectSchema<SetPriceBody> = Joi.object<SetPriceBody>({
  price: positiveDecimalString().allow(null).required().example('2500.00'),
});

export const priceOverrideResponse: Joi.ObjectSchema<PriceOverrideResponse> =
  Joi.object<PriceOverrideResponse>({
    instrument_id: instrumentId().required(),
    frozen: Joi.boolean().required(),
    last_price: decimalString().required(),
  });

// ---------- usuarios ----------

export interface TestPositionInput {
  instrument_id: string;
  quantity: number;
  /** Costo promedio de la posición; por defecto, el último precio del instrumento. */
  avg_cost?: DecimalString;
}

export interface CreateTestUserBody {
  email?: string;
  password: string;
  full_name: string;
  country: Country;
  /** Saldo disponible final de cada cuenta. */
  balances: Partial<Record<UserCurrency, DecimalString>>;
  positions: TestPositionInput[];
}

export const createTestUserBody: Joi.ObjectSchema<CreateTestUserBody> =
  Joi.object<CreateTestUserBody>({
    email: Joi.string().email().lowercase().max(254).prefs({ convert: true }),
    password: Joi.string().min(8).max(128).default('Test1234!'),
    full_name: Joi.string().trim().min(3).max(80).prefs({ convert: true }).default('Usuario QA'),
    country: country().default('CO'),
    balances: Joi.object({
      COP: decimalString(),
      MXN: decimalString(),
      PEN: decimalString(),
    }).default({}),
    positions: Joi.array()
      .items(
        Joi.object<TestPositionInput>({
          instrument_id: instrumentId().required(),
          quantity: Joi.number().integer().min(1).max(MAX_ORDER_QUANTITY).required(),
          avg_cost: positiveDecimalString(),
        }),
      )
      .unique('instrument_id')
      .max(20)
      .default([]),
  });

export const createTestUserResponse: Joi.ObjectSchema<RegisterResponse> = registerResponse;

// ---------- ledger ----------

export interface LedgerAccountCheck {
  account_id: string;
  /** `available + reserved`. */
  cached: DecimalString;
  /** `SUM(ledger_entries.amount)`. */
  ledger: DecimalString;
}

export interface LedgerCheckResponse {
  /** `true` si todas las cuentas cuadran y todos los journals suman cero. */
  balanced: boolean;
  accounts_checked: number;
  mismatched_accounts: LedgerAccountCheck[];
  unbalanced_journals: string[];
}

export const ledgerCheckResponse: Joi.ObjectSchema<LedgerCheckResponse> =
  Joi.object<LedgerCheckResponse>({
    balanced: Joi.boolean().required(),
    accounts_checked: Joi.number().integer().min(0).required(),
    mismatched_accounts: Joi.array()
      .items(
        Joi.object<LedgerAccountCheck>({
          account_id: Joi.string().required(),
          cached: decimalString().required(),
          ledger: decimalString().required(),
        }),
      )
      .required(),
    unbalanced_journals: Joi.array().items(Joi.string()).required(),
  });
