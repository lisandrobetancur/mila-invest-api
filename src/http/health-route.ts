import type { FastifyPluginCallback } from 'fastify';
import Joi from 'joi';
import { AppError } from '../core/errors.js';
import { defineRoute } from './define-route.js';

export interface HealthResponse {
  status: 'ok';
  db: 'ok';
}

export const healthResponse: Joi.ObjectSchema<HealthResponse> = Joi.object<HealthResponse>({
  status: Joi.string().valid('ok').required(),
  db: Joi.string().valid('ok').required(),
}).example({ status: 'ok', db: 'ok' });

/** `GET /health`, fuera de `/api/v1`. Si la base no responde, falla con `INTERNAL_ERROR`. */
export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Reply: HealthResponse }>(app, {
    method: 'GET',
    url: '/health',
    auth: false,
    summary: 'Estado del servicio y de la base de datos',
    tags: ['health'],
    rateLimit: false,
    schema: { response: { 200: healthResponse } },
    handler: async () => {
      if (!(await app.services.health.databaseIsUp())) {
        throw new AppError('INTERNAL_ERROR', { detail: 'La base de datos no responde' });
      }
      return { status: 'ok', db: 'ok' };
    },
  });

  done();
};
