import type { Country, UserCurrency } from '../../core/domain.js';
import { AppError } from '../../core/errors.js';
import { formatAmount, type Decimal } from '../../core/money.js';

/** Códigos con los que una orden puede quedar `REJECTED` al momento de ejecutar. */
export const REJECT_CODES = [
  'INSUFFICIENT_FUNDS',
  'INSUFFICIENT_POSITION',
  'MARKET_CLOSED',
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export function insufficientFunds(available: Decimal, currency: UserCurrency): AppError {
  return new AppError('INSUFFICIENT_FUNDS', {
    detail: `Available ${formatAmount(available, currency)} ${currency}`,
    fieldErrors: [{ field: 'quantity', code: 'TOO_LARGE' }],
  });
}

export function insufficientPosition(held: number, ticker: string): AppError {
  return new AppError('INSUFFICIENT_POSITION', {
    detail: `Held ${String(held)} ${ticker}`,
    fieldErrors: [{ field: 'quantity', code: 'TOO_LARGE' }],
  });
}

export function marketClosed(country: Country): AppError {
  return new AppError('MARKET_CLOSED', {
    detail: `El mercado de ${country} está cerrado`,
  });
}

export function orderNotFound(orderId: string): AppError {
  return new AppError('ORDER_NOT_FOUND', { detail: `No existe la orden ${orderId}` });
}
