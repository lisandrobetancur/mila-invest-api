import type { FastifyPluginCallback } from 'fastify';
import type { Page } from '../../core/pagination.js';
import { currentUser } from '../../http/auth.js';
import { defineRoute } from '../../http/define-route.js';
import {
  listTransactionsQuery,
  transactionsPage,
  type ListTransactionsQuery,
  type TransactionResponse,
} from './schemas.js';

export const transactionsRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Querystring: ListTransactionsQuery; Reply: Page<TransactionResponse> }>(app, {
    method: 'GET',
    url: '/transactions',
    auth: true,
    summary: 'Historial de movimientos del usuario',
    description: 'Orden estable: `created_at DESC, id DESC`. `from` y `to` son inclusivos.',
    tags: ['transactions'],
    schema: { querystring: listTransactionsQuery, response: { 200: transactionsPage } },
    handler: (request) => app.services.transactions.list(currentUser(request).id, request.query),
  });

  done();
};
