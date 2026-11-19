/**
 * Metadatos por país: horarios y estado del mercado, comisiones, límites de
 * depósito y tasas de cambio simuladas (§8.1, §8.3, §8.4 y §8.6).
 */
import { toIsoUtc, type Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import {
  COUNTRIES,
  type Country,
  type MarketStatus,
  type OrderSide,
  type UserCurrency,
} from '../../core/domain.js';
import type { Decimal } from '../../core/money.js';
import { MINUTE_MS, MarketCalendar, type Session } from './calendar.js';
import {
  CLOSING_SOON_MINUTES,
  COUNTRY_CONFIG,
  CURRENCY_COUNTRY,
  DEPOSIT_LIMITS,
  type CountryConfig,
  type DepositLimit,
} from './data.js';
import { commissionFor, executionPriceFor, fxRateBetween } from './rules.js';
import type { CountryResponse } from './schemas.js';

export interface MarketState {
  status: MarketStatus;
  /** Sesión en curso, o la próxima si el mercado está fuera de horario. */
  session: Session;
  /** `true` si el estado sale de `MARKET_ALWAYS_OPEN` o de un override, no del horario. */
  forcedOpen: boolean;
}

export interface FxRate {
  from: UserCurrency;
  to: UserCurrency;
  rate: Decimal;
}

export class MetaService {
  private readonly calendars: Readonly<Record<Country, MarketCalendar>>;
  /** Overrides de `/_testing/market/{country}`: `true` siempre abierto, `false` respeta el horario. */
  private readonly alwaysOpenOverrides = new Map<Country, boolean>();

  public constructor(
    private readonly clock: Clock,
    private readonly config: Pick<Config, 'marketAlwaysOpen'>,
  ) {
    this.calendars = Object.freeze({
      CO: new MarketCalendar(COUNTRY_CONFIG.CO.timeZone, COUNTRY_CONFIG.CO.market),
      MX: new MarketCalendar(COUNTRY_CONFIG.MX.timeZone, COUNTRY_CONFIG.MX.market),
      PE: new MarketCalendar(COUNTRY_CONFIG.PE.timeZone, COUNTRY_CONFIG.PE.market),
    });
  }

  public countryConfig(country: Country): CountryConfig {
    return COUNTRY_CONFIG[country];
  }

  public countryOfCurrency(currency: UserCurrency): Country {
    return CURRENCY_COUNTRY[currency];
  }

  public calendar(country: Country): MarketCalendar {
    return this.calendars[country];
  }

  // ---------- estado del mercado ----------

  public isAlwaysOpen(country: Country): boolean {
    return this.alwaysOpenOverrides.get(country) ?? this.config.marketAlwaysOpen;
  }

  /** `null` quita el override y vuelve a valer `MARKET_ALWAYS_OPEN`. */
  public setAlwaysOpenOverride(country: Country, alwaysOpen: boolean | null): void {
    if (alwaysOpen === null) this.alwaysOpenOverrides.delete(country);
    else this.alwaysOpenOverrides.set(country, alwaysOpen);
  }

  public clearOverrides(): void {
    this.alwaysOpenOverrides.clear();
  }

  public marketState(country: Country): MarketState {
    const now = this.clock.now();
    const calendar = this.calendars[country];
    const current = calendar.currentSession(now);
    const session = current ?? calendar.nextSession(now);
    if (this.isAlwaysOpen(country)) return { status: 'OPEN', session, forcedOpen: true };
    return { status: current === null ? 'CLOSED' : 'OPEN', session, forcedOpen: false };
  }

  public isMarketOpen(country: Country): boolean {
    return this.marketState(country).status === 'OPEN';
  }

  /** `true` si hay una sesión en curso y faltan menos de 15 minutos para su cierre. */
  public isClosingSoon(country: Country): boolean {
    const now = this.clock.now();
    const session = this.calendars[country].currentSession(now);
    if (session === null) return false;
    return session.close.getTime() - now.getTime() < CLOSING_SOON_MINUTES * MINUTE_MS;
  }

  public listCountries(): CountryResponse[] {
    return COUNTRIES.map((code) => {
      const config = COUNTRY_CONFIG[code];
      const state = this.marketState(code);
      return {
        code,
        currency: config.currency,
        time_zone: config.timeZone,
        document_types: [...config.documentTypes],
        market: {
          status: state.status,
          opens_at: toIsoUtc(state.session.open),
          closes_at: toIsoUtc(state.session.close),
        },
      };
    });
  }

  // ---------- comisiones y precios de ejecución ----------

  public commission(country: Country, gross: Decimal): Decimal {
    return commissionFor(country, gross);
  }

  public executionPrice(lastPrice: Decimal, side: OrderSide): Decimal {
    return executionPriceFor(lastPrice, side);
  }

  // ---------- depósitos ----------

  public depositLimit(currency: UserCurrency): DepositLimit {
    return DEPOSIT_LIMITS[currency];
  }

  // ---------- tasas de cambio ----------

  public fxRate(from: UserCurrency, to: UserCurrency): Decimal {
    return fxRateBetween(from, to);
  }

  public convert(amount: Decimal, from: UserCurrency, to: UserCurrency): Decimal {
    return amount.times(this.fxRate(from, to));
  }
}
