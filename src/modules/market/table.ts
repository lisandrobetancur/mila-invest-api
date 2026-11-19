import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import type { Country, InstrumentType, UserCurrency } from '../../core/domain.js';
import { instant, percent, price, shares } from '../../db/columns.js';

/**
 * Catálogo de instrumentos. No hay tabla de precios: el precio es una función
 * pura de `(PRICE_SEED, id, minuto)` (§8.5) que parte de `base_price` y
 * `daily_volatility_pct`.
 */
export const instruments = pgTable(
  'instruments',
  {
    /** `<TICKER>-<PAÍS>`, p. ej. `ECOPETROL-CO`. */
    id: text('id').notNull(),
    ticker: text('ticker').notNull(),
    name: text('name').notNull(),
    country: text('country').$type<Country>().notNull(),
    type: text('type').$type<InstrumentType>().notNull(),
    currency: text('currency').$type<UserCurrency>().notNull(),
    basePrice: price('base_price').notNull(),
    /** Volatilidad diaria en porcentaje (`1.5000` es 1,5 %). */
    dailyVolatilityPct: percent('daily_volatility_pct').notNull(),
    /** Volumen diario de referencia para la simulación. */
    baseVolume: shares('base_volume').notNull(),
    description: text('description').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_instruments', columns: [table.id] }),
    // También es el índice de la consulta paginada (orden: country, ticker).
    unique('uq_instruments_country_ticker').on(table.country, table.ticker),
    check('ck_instruments_country', sql`${table.country} IN ('CO', 'MX', 'PE')`),
    check('ck_instruments_type', sql`${table.type} IN ('STOCK', 'ETF')`),
    check('ck_instruments_currency', sql`${table.currency} IN ('COP', 'MXN', 'PEN')`),
    check('ck_instruments_base_price_positive', sql`${table.basePrice} > 0`),
    check(
      'ck_instruments_volatility_range',
      sql`${table.dailyVolatilityPct} > 0 AND ${table.dailyVolatilityPct} <= 10`,
    ),
  ],
);

export type InstrumentRow = typeof instruments.$inferSelect;
export type NewInstrumentRow = typeof instruments.$inferInsert;
