import Joi from 'joi';
import { TRANSACTION_TYPES, type TransactionType, type UserCurrency } from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';
import type { Page } from '../../core/pagination.js';
import {
  cursor,
  decimalString,
  inputTimestamp,
  limit,
  paginated,
  prefixedId,
  timestamp,
  userCurrency,
  type PaginationQuery,
} from '../../http/schemas/common.js';

export interface TransactionResponse {
  id: string;
  type: TransactionType;
  /** Con signo desde el punto de vista del usuario: una compra es negativa. */
  amount: DecimalString;
  currency: UserCurrency;
  /** En español; el cliente puede reconstruirla con `type` si necesita otro idioma. */
  description: string;
  order_id: string | null;
  created_at: string;
}

export interface ListTransactionsQuery extends PaginationQuery {
  type?: TransactionType;
  /** Desde este instante, inclusive. */
  from?: string;
  /** Hasta este instante, inclusive. */
  to?: string;
}

export const TRANSACTION_EXAMPLE: TransactionResponse = {
  id: 'txn_01JC0000000000000000000011',
  type: 'BUY',
  amount: '-23860.00',
  currency: 'COP',
  description: 'Compra 10 ECOPETROL',
  order_id: 'ord_01JC0000000000000000000001',
  created_at: '2026-11-18T14:43:10Z',
};

export const transactionResponse: Joi.ObjectSchema<TransactionResponse> =
  Joi.object<TransactionResponse>({
    id: prefixedId('transaction').required(),
    type: Joi.string()
      .valid(...TRANSACTION_TYPES)
      .required(),
    amount: decimalString().required(),
    currency: userCurrency().required(),
    description: Joi.string().required(),
    order_id: prefixedId('order').allow(null).required(),
    created_at: timestamp().required(),
  }).example(TRANSACTION_EXAMPLE);

export const transactionsPage: Joi.ObjectSchema<Page<TransactionResponse>> =
  paginated(transactionResponse);

export const listTransactionsQuery: Joi.ObjectSchema<ListTransactionsQuery> =
  Joi.object<ListTransactionsQuery>({
    type: Joi.string().valid(...TRANSACTION_TYPES),
    from: inputTimestamp().description('Desde este instante, inclusive'),
    to: inputTimestamp().description('Hasta este instante, inclusive'),
    cursor: cursor(),
    limit: limit(),
  });
