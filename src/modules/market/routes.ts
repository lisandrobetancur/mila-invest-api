import type { FastifyPluginCallback } from 'fastify';
import type { Page } from '../../core/pagination.js';
import { defineRoute } from '../../http/define-route.js';
import {
  instrumentDetailResponse,
  instrumentParams,
  instrumentsPage,
  listInstrumentsQuery,
  pricesQuery,
  pricesResponse,
  type InstrumentDetailResponse,
  type InstrumentParams,
  type InstrumentResponse,
  type ListInstrumentsQuery,
  type PricesQuery,
  type PricesResponse,
} from './schemas.js';

export const marketRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Querystring: ListInstrumentsQuery; Reply: Page<InstrumentResponse> }>(app, {
    method: 'GET',
    url: '/instruments',
    auth: true,
    summary: 'Catálogo de instrumentos con su último precio',
    description: 'Orden estable: `country, ticker`. Los precios son simulados.',
    tags: ['market'],
    schema: { querystring: listInstrumentsQuery, response: { 200: instrumentsPage } },
    handler: (request) => app.services.market.list(request.query),
  });

  defineRoute<{ Params: InstrumentParams; Reply: InstrumentDetailResponse }>(app, {
    method: 'GET',
    url: '/instruments/:id',
    auth: true,
    summary: 'Detalle de un instrumento',
    tags: ['market'],
    schema: { params: instrumentParams, response: { 200: instrumentDetailResponse } },
    errors: ['INSTRUMENT_NOT_FOUND'],
    handler: (request) => app.services.market.get(request.params.id),
  });

  defineRoute<{ Params: InstrumentParams; Querystring: PricesQuery; Reply: PricesResponse }>(app, {
    method: 'GET',
    url: '/instruments/:id/prices',
    auth: true,
    summary: 'Historial de precios de un instrumento',
    description:
      '`1D` cada 5 minutos de la sesión, `1W` cada hora, `1M` y `3M` diario, `1Y` semanal. Máximo 400 puntos.',
    tags: ['market'],
    schema: {
      params: instrumentParams,
      querystring: pricesQuery,
      response: { 200: pricesResponse },
    },
    errors: ['INSTRUMENT_NOT_FOUND'],
    handler: (request) => app.services.market.prices(request.params.id, request.query.range),
  });

  done();
};
