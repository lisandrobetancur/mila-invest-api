/**
 * Schemas Joi reutilizables por todos los módulos (§5).
 *
 * Son funciones (no constantes) para que cada uso pueda encadenar
 * `.required()`, `.description()` o `.example()` sin afectar a los demás.
 */
import Joi from 'joi';
import {
  COUNTRIES,
  CURRENCIES,
  USER_CURRENCIES,
  type Country,
  type Currency,
} from '../../core/domain.js';
import {
  ERROR_CATALOG,
  FIELD_ERROR_CODES,
  type ErrorCode,
  type ProblemDocument,
} from '../../core/errors.js';
import { idPattern, type IdKind } from '../../core/ids.js';
import { DECIMAL_STRING_PATTERN, Decimal } from '../../core/money.js';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, type Page } from '../../core/pagination.js';

/**
 * Dinero, precios y porcentajes: siempre string decimal. Un número JSON
 * **falla** con `string.base`, porque el body se valida con `convert: false`.
 */
export function decimalString(): Joi.StringSchema {
  return Joi.string().pattern(DECIMAL_STRING_PATTERN).example('1234.56');
}

/** Igual que `decimalString()`, pero además mayor que 0 (comparado con `Decimal`). */
export function positiveDecimalString(): Joi.StringSchema {
  return decimalString()
    .custom((value: string, helpers) => {
      if (new Decimal(value).greaterThan(0)) return value;
      return helpers.error('number.positive');
    }, 'mayor que cero')
    .messages({ 'number.positive': '{{#label}} must be greater than 0' });
}

export function currency(): Joi.StringSchema<Currency> {
  return Joi.string<Currency>()
    .valid(...CURRENCIES)
    .example('COP');
}

/** Monedas en las que existen cuentas de usuario en la fase 1. */
export function userCurrency(): Joi.StringSchema {
  return Joi.string()
    .valid(...USER_CURRENCIES)
    .example('COP');
}

export function country(): Joi.StringSchema<Country> {
  return Joi.string<Country>()
    .valid(...COUNTRIES)
    .example('CO');
}

export const INSTRUMENT_ID_PATTERN = /^[A-Z0-9]{1,12}-(CO|MX|PE)$/;

export function instrumentId(): Joi.StringSchema {
  return Joi.string().pattern(INSTRUMENT_ID_PATTERN).example('ECOPETROL-CO');
}

/** Id opaco con prefijo (`usr_…`, `ord_…`). */
export function prefixedId(kind: IdKind): Joi.StringSchema {
  return Joi.string().pattern(idPattern(kind));
}

/** Timestamp de salida: ISO 8601 UTC con `Z` y sin milisegundos. */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function timestamp(): Joi.StringSchema {
  return Joi.string().pattern(TIMESTAMP_PATTERN).example('2026-11-18T14:42:00Z');
}

/** Timestamp de entrada: cualquier ISO 8601 con zona (`Z` u offset). */
export const INPUT_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function inputTimestamp(): Joi.StringSchema {
  return Joi.string().pattern(INPUT_TIMESTAMP_PATTERN).example('2026-11-18T14:42:00Z');
}

export function cursor(): Joi.StringSchema {
  return Joi.string()
    .pattern(/^[A-Za-z0-9_-]+$/)
    .max(512)
    .description('Cursor opaco devuelto en `next_cursor`');
}

export function limit(): Joi.NumberSchema {
  return Joi.number().integer().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT);
}

export interface PaginationQuery {
  cursor?: string;
  limit: number;
}

export function paginated<T>(itemSchema: Joi.Schema<T>): Joi.ObjectSchema<Page<T>> {
  const schema = Joi.object<Page<T>>({
    items: Joi.array().items(itemSchema).required(),
    next_cursor: Joi.string().allow(null).required(),
  });
  // El ejemplo de la página se arma con el del ítem, para que el OpenAPI lo muestre.
  const [itemExample] = (itemSchema.describe() as { examples?: unknown[] }).examples ?? [];
  if (itemExample === undefined) return schema;
  return schema.example({
    items: [itemExample],
    next_cursor: 'MjAyNi0xMS0xOFQxNDo0MzoxMC4wMDBafG9yZF8wMUpD',
  });
}

export interface IdempotencyHeaders {
  'idempotency-key': string;
}

/** Header `Idempotency-Key` obligatorio (UUID v4). */
export function idempotencyKeyHeader(): Joi.ObjectSchema<IdempotencyHeaders> {
  return Joi.object<IdempotencyHeaders>({
    'idempotency-key': Joi.string()
      .guid({ version: 'uuidv4' })
      .required()
      .description('UUID v4 que identifica la operación; repetirlo no la ejecuta dos veces')
      .example('7c9e6679-7425-40de-944b-e07fc1f90ae7'),
  });
}

/** Cuerpo `application/problem+json` (§7.3), para documentar errores en el OpenAPI. */
export const problemSchema: Joi.ObjectSchema<ProblemDocument> = Joi.object<ProblemDocument>({
  type: Joi.string().required().example('about:blank'),
  title: Joi.string().required().example('Insufficient funds'),
  status: Joi.number().integer().min(400).max(599).required().example(422),
  code: Joi.string()
    .valid(...(Object.keys(ERROR_CATALOG) as ErrorCode[]))
    .required()
    .example('INSUFFICIENT_FUNDS'),
  detail: Joi.string().example('Available 12000.00 COP'),
  errors: Joi.array().items(
    Joi.object({
      field: Joi.string().required().example('quantity'),
      code: Joi.string()
        .valid(...FIELD_ERROR_CODES)
        .required()
        .example('TOO_LARGE'),
    }),
  ),
});
