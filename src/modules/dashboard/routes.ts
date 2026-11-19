import type { FastifyPluginCallback } from 'fastify';
import { currentUser } from '../../http/auth.js';
import { defineRoute } from '../../http/define-route.js';
import { dashboardSummaryResponse, type DashboardSummaryResponse } from './schemas.js';

export const dashboardRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Reply: DashboardSummaryResponse }>(app, {
    method: 'GET',
    url: '/dashboard/summary',
    auth: true,
    summary:
      'Resumen para el dashboard: portafolio, movimientos del mercado y últimas transacciones',
    tags: ['dashboard'],
    schema: { response: { 200: dashboardSummaryResponse } },
    handler: (request) => {
      const user = currentUser(request);
      return app.services.dashboard.summary(user.id, user.baseCurrency);
    },
  });

  done();
};
