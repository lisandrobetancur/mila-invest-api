/**
 * Datos del seed (§8.7 y §10): instrumentos y usuario demo. Ids literales y
 * fechas fijas, para que dos bases recién sembradas sean idénticas.
 *
 * Los instrumentos son nombres reales con **precios simulados**.
 */
import type { Country, DocumentType, InstrumentType, UserCurrency } from '../core/domain.js';
import { ID_PREFIXES, type IdKind } from '../core/ids.js';
import type { DecimalString } from '../core/money.js';

/** Id literal con forma de ULID: `usr_01JC0000000000000000000001`. */
export function seedId(kind: IdKind, sequence: number): string {
  return `${ID_PREFIXES[kind]}_01JC${String(sequence).padStart(22, '0')}`;
}

export const SEED_CREATED_AT = new Date('2026-11-02T15:00:00.000Z');
export const SEED_DEPOSITS_AT = new Date('2026-11-03T15:00:00.000Z');
export const SEED_ORDERS_AT = new Date('2026-11-03T15:30:00.000Z');

export interface SeedInstrument {
  ticker: string;
  name: string;
  country: Country;
  type: InstrumentType;
  currency: UserCurrency;
  basePrice: DecimalString;
  /** Volatilidad diaria en porcentaje, entre 1 % y 3 %. */
  dailyVolatilityPct: DecimalString;
  baseVolume: number;
}

export const SEED_INSTRUMENTS: readonly SeedInstrument[] = [
  {
    ticker: 'ECOPETROL',
    name: 'Ecopetrol S.A.',
    country: 'CO',
    type: 'STOCK',
    currency: 'COP',
    basePrice: '2400',
    dailyVolatilityPct: '1.8',
    baseVolume: 12_000_000,
  },
  {
    ticker: 'PFBCOLOM',
    name: 'Bancolombia S.A. (preferencial)',
    country: 'CO',
    type: 'STOCK',
    currency: 'COP',
    basePrice: '34000',
    dailyVolatilityPct: '1.5',
    baseVolume: 900_000,
  },
  {
    ticker: 'ISA',
    name: 'Interconexión Eléctrica S.A. E.S.P.',
    country: 'CO',
    type: 'STOCK',
    currency: 'COP',
    basePrice: '18000',
    dailyVolatilityPct: '1.4',
    baseVolume: 450_000,
  },
  {
    ticker: 'GEB',
    name: 'Grupo Energía Bogotá S.A. E.S.P.',
    country: 'CO',
    type: 'STOCK',
    currency: 'COP',
    basePrice: '2700',
    dailyVolatilityPct: '1.2',
    baseVolume: 1_800_000,
  },
  {
    ticker: 'ICOLCAP',
    name: 'Fondo Bursátil iShares MSCI COLCAP',
    country: 'CO',
    type: 'ETF',
    currency: 'COP',
    basePrice: '15000',
    dailyVolatilityPct: '1.0',
    baseVolume: 600_000,
  },
  {
    ticker: 'WALMEX',
    name: 'Wal-Mart de México S.A.B. de C.V.',
    country: 'MX',
    type: 'STOCK',
    currency: 'MXN',
    basePrice: '60',
    dailyVolatilityPct: '1.6',
    baseVolume: 14_000_000,
  },
  {
    ticker: 'AMXB',
    name: 'América Móvil S.A.B. de C.V. (serie B)',
    country: 'MX',
    type: 'STOCK',
    currency: 'MXN',
    basePrice: '17',
    dailyVolatilityPct: '1.9',
    baseVolume: 38_000_000,
  },
  {
    ticker: 'GFNORTEO',
    name: 'Grupo Financiero Banorte S.A.B. de C.V.',
    country: 'MX',
    type: 'STOCK',
    currency: 'MXN',
    basePrice: '160',
    dailyVolatilityPct: '2.0',
    baseVolume: 6_500_000,
  },
  {
    ticker: 'CEMEXCPO',
    name: 'CEMEX S.A.B. de C.V. (CPO)',
    country: 'MX',
    type: 'STOCK',
    currency: 'MXN',
    basePrice: '12',
    dailyVolatilityPct: '2.6',
    baseVolume: 30_000_000,
  },
  {
    ticker: 'BAP',
    name: 'Credicorp Ltd.',
    country: 'PE',
    type: 'STOCK',
    currency: 'PEN',
    basePrice: '650',
    dailyVolatilityPct: '1.7',
    baseVolume: 180_000,
  },
  {
    ticker: 'SCCO',
    name: 'Southern Copper Corporation',
    country: 'PE',
    type: 'STOCK',
    currency: 'PEN',
    basePrice: '380',
    dailyVolatilityPct: '2.4',
    baseVolume: 120_000,
  },
  {
    ticker: 'BVN',
    name: 'Compañía de Minas Buenaventura S.A.A.',
    country: 'PE',
    type: 'STOCK',
    currency: 'PEN',
    basePrice: '55',
    dailyVolatilityPct: '3.0',
    baseVolume: 350_000,
  },
  {
    ticker: 'FERREYC1',
    name: 'Ferreycorp S.A.A.',
    country: 'PE',
    type: 'STOCK',
    currency: 'PEN',
    basePrice: '2.50',
    dailyVolatilityPct: '1.3',
    baseVolume: 2_400_000,
  },
];

export function instrumentDescription(instrument: SeedInstrument): string {
  const kind = instrument.type === 'ETF' ? 'ETF' : 'Acción';
  return `${kind} de ${instrument.name}. Es un instrumento real con precio simulado: no refleja cotizaciones del mercado ni es una recomendación de inversión.`;
}

export interface DemoHolding {
  instrumentId: string;
  ticker: string;
  country: Country;
  currency: UserCurrency;
  quantity: number;
  /** Precio de la compra del seed; queda como costo promedio de la posición. */
  price: DecimalString;
  /** Saldo disponible que queda en la cuenta después de la compra. */
  balanceAfter: DecimalString;
}

export const DEMO_USER = {
  id: seedId('user', 1),
  email: 'demo@milainvest.app',
  password: 'Demo1234!',
  /** Sal fija: el hash argon2 del usuario demo es el mismo en cualquier máquina. */
  passwordSalt: Buffer.from('mila-invest-demo-salt-0001', 'utf8'),
  fullName: 'Usuario Demo',
  country: 'CO' as Country,
  baseCurrency: 'COP' as UserCurrency,
  documentType: 'CC' as DocumentType,
  documentNumber: '1020304050',
  refreshFamilyId: seedId('refreshFamily', 1),
} as const;

/** Saldos del usuario demo: COP 50.000.000, MXN 200.000 y PEN 40.000, más tres posiciones. */
export const DEMO_HOLDINGS: readonly DemoHolding[] = [
  {
    instrumentId: 'ECOPETROL-CO',
    ticker: 'ECOPETROL',
    country: 'CO',
    currency: 'COP',
    quantity: 120,
    price: '2210.50',
    balanceAfter: '50000000',
  },
  {
    instrumentId: 'WALMEX-MX',
    ticker: 'WALMEX',
    country: 'MX',
    currency: 'MXN',
    quantity: 50,
    price: '58.40',
    balanceAfter: '200000',
  },
  {
    instrumentId: 'BAP-PE',
    ticker: 'BAP',
    country: 'PE',
    currency: 'PEN',
    quantity: 10,
    price: '640.00',
    balanceAfter: '40000',
  },
];
