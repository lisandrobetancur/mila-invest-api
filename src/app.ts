/**
 * `buildApp(deps)`: raíz de composición de la aplicación.
 *
 * Recibe `{ config, clock, db, logger }`, construye los services y registra
 * plugins, validación con Joi, OpenAPI, rutas y manejo de errores. Los tests
 * la llaman con un `FrozenClock` y una base de test.
 */
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { isTestingEnabled, type Config } from './core/config.js';
import { AppError } from './core/errors.js';
import { readAccessToken } from './http/auth.js';
import { PROBLEM_SCHEMA_ID, toJsonSchema } from './http/define-route.js';
import { registerErrorHandling } from './http/error-handler.js';
import { healthRoutes } from './http/health-route.js';
import { problemSchema } from './http/schemas/common.js';
import { accountsRoutes } from './modules/accounts/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { marketRoutes } from './modules/market/routes.js';
import { metaRoutes } from './modules/meta/routes.js';
import { ordersRoutes } from './modules/orders/routes.js';
import { portfolioRoutes } from './modules/portfolio/routes.js';
import { testingRoutes } from './modules/testing/routes.js';
import { transactionsRoutes } from './modules/transactions/routes.js';
import { usersRoutes } from './modules/users/routes.js';
import { createServices, type AppDeps } from './services.js';

export const API_PREFIX = '/api/v1';
export const BODY_LIMIT_BYTES = 64 * 1024;
export const REQUEST_ID_HEADER = 'x-request-id';

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** En `dev` y `test` se acepta localhost en cualquier puerto (Flutter web elige uno al azar). */
export function isOriginAllowed(config: Config, origin: string): boolean {
  if (config.corsOrigins.includes(origin)) return true;
  return isTestingEnabled(config) && LOCALHOST_ORIGIN.test(origin);
}

function openApiTags(config: Config): { name: string; description: string }[] {
  const tags = [
    { name: 'health', description: 'Estado del servicio' },
    { name: 'auth', description: 'Registro, login, refresh con rotación y logout' },
    { name: 'users', description: 'Perfil del usuario' },
    { name: 'meta', description: 'Países, monedas, documentos y horarios de mercado' },
    { name: 'accounts', description: 'Cuentas por moneda y depósitos virtuales' },
    { name: 'market', description: 'Instrumentos y precios simulados' },
    { name: 'orders', description: 'Órdenes a mercado: preview, ejecución y consulta' },
    { name: 'portfolio', description: 'Posiciones y valorización' },
    { name: 'transactions', description: 'Historial de movimientos' },
    { name: 'dashboard', description: 'Resumen agregado' },
  ];
  if (isTestingEnabled(config)) {
    tags.push({ name: 'testing', description: 'Control de escenarios para QA (solo dev/test)' });
  }
  return tags;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;

  // Tipado como el logger base de Fastify, para que la instancia conserve su tipo por defecto.
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const app: FastifyInstance = Fastify({
    loggerInstance,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: config.trustProxy,
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Los services se construyen acá y en ningún otro lugar.
  app.decorate('services', createServices(deps));
  app.decorateRequest('user', null);
  app.decorateRequest('accessClaims', null);
  app.decorateRequest('authError', null);

  registerErrorHandling(app);
  app.addSchema({ $id: PROBLEM_SCHEMA_ID, ...toJsonSchema(problemSchema) });

  // Toda respuesta trae `X-Request-Id`: el del cliente o uno generado.
  app.addHook('onRequest', async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
  });

  await app.register(helmet, {
    global: true,
    // La API la consume una app web desde otro origen (Flutter web).
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      // Sin `upgrade-insecure-requests`: en local se sirve por HTTP plano.
      directives: { upgradeInsecureRequests: null },
    },
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, origin !== undefined && isOriginAllowed(config, origin));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'MILA Invest API',
        version: '1.0.0',
        description:
          'Simulador de inversiones (paper trading) para Colombia, México y Perú. No se mueve dinero real: precios, comisiones, horarios y tasas de cambio son simulados, y la API no es asesoría financiera.',
      },
      servers: [{ url: `http://localhost:${String(config.port)}`, description: 'Local' }],
      tags: openApiTags(config),
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, index) =>
        typeof json.$id === 'string' ? json.$id : `def-${String(index)}`,
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    transformStaticCSP: (header) => header.replace(/upgrade-insecure-requests;?/g, '').trim(),
  });

  // Antes del rate limit, para que pueda contar por usuario autenticado.
  app.addHook('onRequest', readAccessToken);

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitDefault,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) =>
      request.accessClaims === null ? `ip:${request.ip}` : `user:${request.accessClaims.sub}`,
    errorResponseBuilder: (_request, context) =>
      new AppError('RATE_LIMITED', {
        detail: `Se superó el límite de ${String(context.max)} peticiones por minuto`,
        headers: { 'retry-after': String(Math.max(1, Math.ceil(context.ttl / 1000))) },
      }),
  });

  app.get('/openapi.json', { schema: { hide: true }, config: { rateLimit: false } }, () =>
    app.swagger(),
  );
  await app.register(healthRoutes);

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(usersRoutes);
      await api.register(metaRoutes);
      await api.register(accountsRoutes);
      await api.register(marketRoutes);
      await api.register(ordersRoutes);
      await api.register(portfolioRoutes);
      await api.register(transactionsRoutes);
      await api.register(dashboardRoutes);
      // Regla 12 de §4: en `prod` estas rutas no existen.
      if (isTestingEnabled(config)) await api.register(testingRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
