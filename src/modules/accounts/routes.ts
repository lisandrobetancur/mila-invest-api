import type { FastifyPluginCallback } from 'fastify';
import { currentUser } from '../../http/auth.js';
import { defineRoute } from '../../http/define-route.js';
import { idempotencyKeyHeader, type IdempotencyHeaders } from '../../http/schemas/common.js';
import { transactionResponse, type TransactionResponse } from '../transactions/schemas.js';
import {
  accountsResponse,
  depositBody,
  depositParams,
  type AccountResponse,
  type DepositBody,
  type DepositParams,
} from './schemas.js';

export const accountsRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Reply: AccountResponse[] }>(app, {
    method: 'GET',
    url: '/accounts',
    auth: true,
    summary: 'Cuentas del usuario, una por moneda',
    tags: ['accounts'],
    schema: { response: { 200: accountsResponse } },
    handler: (request) => app.services.accounts.list(currentUser(request).id),
  });

  defineRoute<{
    Params: DepositParams;
    Body: DepositBody;
    Headers: IdempotencyHeaders;
    Reply: TransactionResponse;
  }>(app, {
    method: 'POST',
    url: '/accounts/:currency/deposits',
    auth: true,
    summary: 'Depósito de dinero virtual en la cuenta de una moneda',
    description:
      'Máximo por depósito: COP 100.000.000, MXN 500.000, PEN 100.000; el acumulado por cuenta es 10 veces ese valor. Requiere `Idempotency-Key`.',
    tags: ['accounts'],
    schema: {
      params: depositParams,
      body: depositBody,
      headers: idempotencyKeyHeader(),
      response: { 201: transactionResponse },
    },
    errors: ['IDEMPOTENCY_CONFLICT'],
    handler: async (request) => {
      const result = await app.services.accounts.deposit({
        userId: currentUser(request).id,
        currency: request.params.currency,
        amount: request.body.amount,
        idempotencyKey: request.headers['idempotency-key'],
      });
      return result.body;
    },
  });

  done();
};
