import type { FastifyPluginCallback } from 'fastify';
import type { Page } from '../../core/pagination.js';
import { currentUser } from '../../http/auth.js';
import { defineRoute } from '../../http/define-route.js';
import { idempotencyKeyHeader, type IdempotencyHeaders } from '../../http/schemas/common.js';
import {
  createOrderBody,
  listOrdersQuery,
  orderParams,
  orderPreviewResponse,
  orderResponse,
  ordersPage,
  type CreateOrderBody,
  type ListOrdersQuery,
  type OrderParams,
  type OrderPreviewResponse,
  type OrderResponse,
} from './schemas.js';

export const ordersRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Body: CreateOrderBody; Reply: OrderPreviewResponse }>(app, {
    method: 'POST',
    url: '/orders/preview',
    auth: true,
    summary: 'Simula una orden a mercado sin ejecutarla',
    description:
      'Calcula precio estimado, bruto, comisión y total. No escribe nada. `warnings` siempre incluye `PRICE_MAY_CHANGE`.',
    tags: ['orders'],
    schema: { body: createOrderBody, response: { 200: orderPreviewResponse } },
    errors: [
      'INSTRUMENT_NOT_FOUND',
      'MARKET_CLOSED',
      'INSUFFICIENT_FUNDS',
      'INSUFFICIENT_POSITION',
    ],
    handler: (request) => app.services.orders.preview(currentUser(request).id, request.body),
  });

  defineRoute<{ Body: CreateOrderBody; Headers: IdempotencyHeaders; Reply: OrderResponse }>(app, {
    method: 'POST',
    url: '/orders',
    auth: true,
    summary: 'Ejecuta una orden a mercado',
    description:
      'Requiere `Idempotency-Key`. Si la orden pasa la validación pero se rechaza al ejecutar (p. ej. por una orden concurrente), responde 201 con `status: "REJECTED"` y su `reject_code`.',
    tags: ['orders'],
    schema: {
      body: createOrderBody,
      headers: idempotencyKeyHeader(),
      response: { 201: orderResponse },
    },
    errors: [
      'INSTRUMENT_NOT_FOUND',
      'MARKET_CLOSED',
      'INSUFFICIENT_FUNDS',
      'INSUFFICIENT_POSITION',
      'IDEMPOTENCY_CONFLICT',
    ],
    handler: async (request) => {
      const result = await app.services.orders.create(
        currentUser(request).id,
        request.body,
        request.headers['idempotency-key'],
      );
      return result.body;
    },
  });

  defineRoute<{ Querystring: ListOrdersQuery; Reply: Page<OrderResponse> }>(app, {
    method: 'GET',
    url: '/orders',
    auth: true,
    summary: 'Órdenes del usuario',
    description: 'Orden estable: `created_at DESC, id DESC`.',
    tags: ['orders'],
    schema: { querystring: listOrdersQuery, response: { 200: ordersPage } },
    handler: (request) => app.services.orders.list(currentUser(request).id, request.query),
  });

  defineRoute<{ Params: OrderParams; Reply: OrderResponse }>(app, {
    method: 'GET',
    url: '/orders/:id',
    auth: true,
    summary: 'Detalle de una orden propia',
    tags: ['orders'],
    schema: { params: orderParams, response: { 200: orderResponse } },
    errors: ['ORDER_NOT_FOUND'],
    handler: (request) => app.services.orders.get(currentUser(request).id, request.params.id),
  });

  done();
};
