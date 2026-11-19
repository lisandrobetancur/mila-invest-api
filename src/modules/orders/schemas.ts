import Joi from 'joi';
import {
  ORDER_SIDES,
  ORDER_STATUSES,
  ORDER_TYPES,
  ORDER_WARNINGS,
  type OrderSide,
  type OrderStatus,
  type OrderType,
  type OrderWarning,
  type UserCurrency,
} from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';
import type { Page } from '../../core/pagination.js';
import {
  cursor,
  decimalString,
  instrumentId,
  limit,
  paginated,
  prefixedId,
  timestamp,
  userCurrency,
  type PaginationQuery,
} from '../../http/schemas/common.js';
import { REJECT_CODES, type RejectCode } from './errors.js';

export const MAX_ORDER_QUANTITY = 1_000_000;

export interface CreateOrderBody {
  instrument_id: string;
  side: OrderSide;
  /** Fase 1: solo `MARKET`. `LIMIT` (con `limit_price`) llega en la fase 2. */
  type: 'MARKET';
  quantity: number;
}

export interface OrderPreviewResponse {
  estimated_price: DecimalString;
  gross: DecimalString;
  commission: DecimalString;
  /** Compra: bruto + comisión. Venta: bruto − comisión (lo que se acredita). */
  total: DecimalString;
  currency: UserCurrency;
  available_after: DecimalString;
  warnings: OrderWarning[];
}

export interface OrderResponse {
  id: string;
  instrument_id: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  status: OrderStatus;
  /** `null` si la orden quedó `REJECTED`: no hubo ejecución. */
  executed_price: DecimalString | null;
  gross: DecimalString;
  commission: DecimalString;
  total: DecimalString;
  currency: UserCurrency;
  reject_code: RejectCode | null;
  created_at: string;
  filled_at: string | null;
}

export interface ListOrdersQuery extends PaginationQuery {
  status?: OrderStatus;
}

export interface OrderParams {
  id: string;
}

export const ORDER_EXAMPLE: OrderResponse = {
  id: 'ord_01JC0000000000000000000001',
  instrument_id: 'ECOPETROL-CO',
  side: 'BUY',
  type: 'MARKET',
  quantity: 10,
  status: 'FILLED',
  executed_price: '2386.00',
  gross: '23860.00',
  commission: '5000.00',
  total: '28860.00',
  currency: 'COP',
  reject_code: null,
  created_at: '2026-11-18T14:43:10Z',
  filled_at: '2026-11-18T14:43:10Z',
};

export const createOrderBody: Joi.ObjectSchema<CreateOrderBody> = Joi.object<CreateOrderBody>({
  instrument_id: instrumentId().required(),
  side: Joi.string()
    .valid(...ORDER_SIDES)
    .required()
    .example('BUY'),
  type: Joi.string()
    .valid('MARKET')
    .required()
    .description('Fase 1: solo órdenes a mercado')
    .example('MARKET'),
  quantity: Joi.number().integer().min(1).max(MAX_ORDER_QUANTITY).required().example(10),
});

export const orderPreviewResponse: Joi.ObjectSchema<OrderPreviewResponse> =
  Joi.object<OrderPreviewResponse>({
    estimated_price: decimalString().required(),
    gross: decimalString().required(),
    commission: decimalString().required(),
    total: decimalString().required(),
    currency: userCurrency().required(),
    available_after: decimalString().required(),
    warnings: Joi.array()
      .items(Joi.string().valid(...ORDER_WARNINGS))
      .required(),
  }).example({
    estimated_price: '2386.00',
    gross: '23860.00',
    commission: '5000.00',
    total: '28860.00',
    currency: 'COP',
    available_after: '49971140.00',
    warnings: ['PRICE_MAY_CHANGE'],
  });

export const orderResponse: Joi.ObjectSchema<OrderResponse> = Joi.object<OrderResponse>({
  id: prefixedId('order').required(),
  instrument_id: instrumentId().required(),
  side: Joi.string()
    .valid(...ORDER_SIDES)
    .required(),
  type: Joi.string()
    .valid(...ORDER_TYPES)
    .required(),
  quantity: Joi.number().integer().min(1).max(MAX_ORDER_QUANTITY).required(),
  status: Joi.string()
    .valid(...ORDER_STATUSES)
    .required(),
  executed_price: decimalString().allow(null).required(),
  gross: decimalString().required(),
  commission: decimalString().required(),
  total: decimalString().required(),
  currency: userCurrency().required(),
  reject_code: Joi.string()
    .valid(...REJECT_CODES)
    .allow(null)
    .required(),
  created_at: timestamp().required(),
  filled_at: timestamp().allow(null).required(),
}).example(ORDER_EXAMPLE);

export const ordersPage: Joi.ObjectSchema<Page<OrderResponse>> = paginated(orderResponse);

export const listOrdersQuery: Joi.ObjectSchema<ListOrdersQuery> = Joi.object<ListOrdersQuery>({
  status: Joi.string().valid(...ORDER_STATUSES),
  cursor: cursor(),
  limit: limit(),
});

export const orderParams: Joi.ObjectSchema<OrderParams> = Joi.object<OrderParams>({
  id: prefixedId('order').required(),
});
