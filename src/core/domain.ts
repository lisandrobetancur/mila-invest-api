/**
 * Enums del dominio, compartidos por todos los módulos.
 *
 * Cada enum se declara como tupla `as const` y su tipo se deriva de ella, para
 * que el mismo arreglo sirva en los schemas Joi (`Joi.valid(...CURRENCIES)`) y
 * en los tipos de TypeScript.
 */

export const COUNTRIES = ['CO', 'MX', 'PE'] as const;
export type Country = (typeof COUNTRIES)[number];

/** `USD` existe para la fase 2 (cambio de divisas); no hay cuentas USD en fase 1. */
export const CURRENCIES = ['COP', 'MXN', 'PEN', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Monedas en las que un usuario tiene cuenta al registrarse. */
export const USER_CURRENCIES = ['COP', 'MXN', 'PEN'] as const;
export type UserCurrency = (typeof USER_CURRENCIES)[number];

export const DOCUMENT_TYPES = ['CC', 'CE', 'CURP', 'DNI'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const INSTRUMENT_TYPES = ['STOCK', 'ETF'] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

/** `LIMIT` está previsto para la fase 2; la fase 1 solo acepta `MARKET`. */
export const ORDER_TYPES = ['MARKET', 'LIMIT'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** `PENDING` y `CANCELLED` están previstos para la fase 2 (órdenes límite). */
export const ORDER_STATUSES = ['PENDING', 'FILLED', 'REJECTED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TRANSACTION_TYPES = ['DEPOSIT', 'BUY', 'SELL', 'FEE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PRICE_RANGES = ['1D', '1W', '1M', '3M', '1Y'] as const;
export type PriceRange = (typeof PRICE_RANGES)[number];

export const ORDER_WARNINGS = ['MARKET_CLOSING_SOON', 'PRICE_MAY_CHANGE'] as const;
export type OrderWarning = (typeof ORDER_WARNINGS)[number];

export const MARKET_STATUSES = ['OPEN', 'CLOSED'] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];

export const APP_ENVS = ['dev', 'test', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];
