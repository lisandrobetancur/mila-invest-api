/**
 * Endpoints de control para QA, bajo `/api/v1/_testing`. Sin auth, pero solo se
 * registran si `APP_ENV` es `dev` o `test`: en `prod` no existen (404).
 */
import type { FastifyPluginCallback } from 'fastify';
import { AppError } from '../../core/errors.js';
import { defineRoute } from '../../http/define-route.js';
import type { RegisterResponse } from '../auth/schemas.js';
import {
  clockResponse,
  countryParams,
  createTestUserBody,
  createTestUserResponse,
  instrumentIdParams,
  ledgerCheckResponse,
  marketOverrideResponse,
  priceOverrideResponse,
  setClockBody,
  setMarketBody,
  setPriceBody,
  type ClockResponse,
  type CountryParams,
  type CreateTestUserBody,
  type InstrumentIdParams,
  type LedgerCheckResponse,
  type MarketOverrideResponse,
  type PriceOverrideResponse,
  type SetClockBody,
  type SetMarketBody,
  type SetPriceBody,
} from './schemas.js';
import type { TestingService } from './service.js';

const TAGS = ['testing'] as const;

export const testingRoutes: FastifyPluginCallback = (app, _options, done) => {
  const testing = (): TestingService => {
    const service = app.services.testing;
    if (service === null) throw new AppError('NOT_FOUND');
    return service;
  };

  defineRoute(app, {
    method: 'POST',
    url: '/_testing/reset',
    auth: false,
    summary: 'Trunca los datos y vuelve a correr el seed',
    description: 'También quita los overrides de reloj, mercado y precios.',
    tags: TAGS,
    rateLimit: false,
    schema: { response: { 204: null } },
    handler: async () => {
      await testing().reset();
    },
  });

  defineRoute<{ Body: SetClockBody; Reply: ClockResponse }>(app, {
    method: 'POST',
    url: '/_testing/clock',
    auth: false,
    summary: 'Fija el reloj del servidor, o lo libera con `now: null`',
    tags: TAGS,
    rateLimit: false,
    schema: { body: setClockBody, response: { 200: clockResponse } },
    handler: (request) => testing().setClock(request.body.now),
  });

  defineRoute<{ Params: CountryParams; Body: SetMarketBody; Reply: MarketOverrideResponse }>(app, {
    method: 'POST',
    url: '/_testing/market/:country',
    auth: false,
    summary: 'Fuerza el mercado de un país a estar siempre abierto o a respetar su horario',
    description:
      '`always_open: true` lo deja siempre abierto; `false` hace valer el horario simulado (cerrado fuera de él); `null` vuelve a `MARKET_ALWAYS_OPEN`.',
    tags: TAGS,
    rateLimit: false,
    schema: {
      params: countryParams,
      body: setMarketBody,
      response: { 200: marketOverrideResponse },
    },
    handler: (request) => testing().setMarket(request.params.country, request.body.always_open),
  });

  defineRoute<{ Params: InstrumentIdParams; Body: SetPriceBody; Reply: PriceOverrideResponse }>(
    app,
    {
      method: 'POST',
      url: '/_testing/prices/:instrument_id',
      auth: false,
      summary: 'Congela el precio de un instrumento, o lo libera con `price: null`',
      tags: TAGS,
      rateLimit: false,
      schema: {
        params: instrumentIdParams,
        body: setPriceBody,
        response: { 200: priceOverrideResponse },
      },
      errors: ['INSTRUMENT_NOT_FOUND'],
      handler: (request) => testing().setPrice(request.params.instrument_id, request.body.price),
    },
  );

  defineRoute<{ Body: CreateTestUserBody; Reply: RegisterResponse }>(app, {
    method: 'POST',
    url: '/_testing/users',
    auth: false,
    summary: 'Crea un usuario con saldos y posiciones dados y devuelve sus tokens',
    description:
      'Los saldos entran como depósitos y las posiciones como compras sin comisión, así el ledger sigue cuadrando.',
    tags: TAGS,
    rateLimit: false,
    schema: { body: createTestUserBody, response: { 201: createTestUserResponse } },
    errors: ['AUTH_EMAIL_TAKEN', 'INSTRUMENT_NOT_FOUND'],
    handler: (request) => testing().createUser(request.body),
  });

  defineRoute<{ Reply: LedgerCheckResponse }>(app, {
    method: 'GET',
    url: '/_testing/ledger',
    auth: false,
    summary: 'Verifica las invariantes del ledger sobre toda la base',
    description:
      'Para cada cuenta, `available + reserved == SUM(ledger_entries.amount)`; y cada journal suma cero por moneda.',
    tags: TAGS,
    rateLimit: false,
    schema: { response: { 200: ledgerCheckResponse } },
    handler: () => testing().checkLedger(),
  });

  done();
};
