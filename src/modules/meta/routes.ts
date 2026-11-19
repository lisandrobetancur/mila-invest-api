import type { FastifyPluginCallback } from 'fastify';
import { defineRoute } from '../../http/define-route.js';
import { countriesResponse, type CountryResponse } from './schemas.js';

export const metaRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Reply: CountryResponse[] }>(app, {
    method: 'GET',
    url: '/meta/countries',
    auth: false,
    summary: 'Países soportados, con su moneda, documentos y estado del mercado',
    tags: ['meta'],
    schema: { response: { 200: countriesResponse } },
    handler: () => app.services.meta.listCountries(),
  });

  done();
};
