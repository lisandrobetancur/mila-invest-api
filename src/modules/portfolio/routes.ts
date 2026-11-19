import type { FastifyPluginCallback } from 'fastify';
import { currentUser } from '../../http/auth.js';
import { defineRoute } from '../../http/define-route.js';
import { portfolioResponse, type PortfolioResponse } from './schemas.js';

export const portfolioRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Reply: PortfolioResponse }>(app, {
    method: 'GET',
    url: '/portfolio',
    auth: true,
    summary: 'Posiciones y valorización del portafolio',
    description:
      'Los totales van en la moneda base del usuario; las tasas de conversión usadas se informan en `fx_rates_used`.',
    tags: ['portfolio'],
    schema: { response: { 200: portfolioResponse } },
    handler: (request) => {
      const user = currentUser(request);
      return app.services.portfolio.get(user.id, user.baseCurrency);
    },
  });

  done();
};
