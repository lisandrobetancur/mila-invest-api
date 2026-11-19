import type { AppError } from '../core/errors.js';
import type { AccessTokenClaims } from '../core/security.js';
import type { AuthenticatedUser } from '../http/auth.js';
import type { RouteRateLimit } from '../http/define-route.js';
import type { Services } from '../services.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Contenedor de servicios, construido una sola vez en `buildApp`. */
    services: Services;
  }

  interface FastifyRequest {
    /** Usuario autenticado; solo existe en rutas con `auth: true`. */
    user: AuthenticatedUser | null;
    /** Claims del access token, si vino uno válido. */
    accessClaims: AccessTokenClaims | null;
    /** Motivo por el que el access token no sirve, si vino uno inválido. */
    authError: AppError | null;
  }

  interface FastifyContextConfig {
    rateLimit?: RouteRateLimit | false;
  }
}
