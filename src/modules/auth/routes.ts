import type { FastifyPluginCallback } from 'fastify';
import { currentUser } from '../../http/auth.js';
import { defineRoute } from '../../http/define-route.js';
import {
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
  registerResponse,
  tokensResponse,
  type LoginBody,
  type LogoutBody,
  type RefreshBody,
  type RegisterBody,
  type RegisterResponse,
  type TokensResponse,
} from './schemas.js';

export const authRoutes: FastifyPluginCallback = (app, _options, done) => {
  const { config } = app.services;

  defineRoute<{ Body: RegisterBody; Reply: RegisterResponse }>(app, {
    method: 'POST',
    url: '/auth/register',
    auth: false,
    summary: 'Registro de un usuario en un país',
    description:
      'Crea el usuario con sus tres cuentas (COP, MXN, PEN) en cero. El número de documento no se guarda en claro.',
    tags: ['auth'],
    schema: { body: registerBody, response: { 201: registerResponse } },
    errors: ['AUTH_EMAIL_TAKEN', 'AUTH_DOCUMENT_TAKEN'],
    handler: (request) => app.services.auth.register(request.body),
  });

  defineRoute<{ Body: LoginBody; Reply: TokensResponse }>(app, {
    method: 'POST',
    url: '/auth/login',
    auth: false,
    summary: 'Login con email y contraseña',
    tags: ['auth'],
    schema: { body: loginBody, response: { 200: tokensResponse } },
    errors: ['AUTH_INVALID_CREDENTIALS'],
    // Límite propio, por IP + email. Corre en `preHandler` para leer el email ya validado.
    rateLimit: {
      max: config.rateLimitLogin,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => {
        const body = request.body as Partial<LoginBody> | undefined;
        return `login:${request.ip}:${body?.email ?? ''}`;
      },
    },
    handler: (request) => app.services.auth.login(request.body),
  });

  defineRoute<{ Body: RefreshBody; Reply: TokensResponse }>(app, {
    method: 'POST',
    url: '/auth/refresh',
    auth: false,
    summary: 'Rota el refresh token y devuelve un par nuevo',
    description:
      'El refresh token anterior queda invalidado. Reutilizar uno ya rotado revoca toda su familia.',
    tags: ['auth'],
    schema: { body: refreshBody, response: { 200: tokensResponse } },
    errors: ['AUTH_REFRESH_INVALID'],
    handler: (request) => app.services.auth.refresh(request.body.refresh_token),
  });

  defineRoute<{ Body: LogoutBody }>(app, {
    method: 'POST',
    url: '/auth/logout',
    auth: true,
    summary: 'Revoca el refresh token enviado',
    tags: ['auth'],
    schema: { body: logoutBody, response: { 204: null } },
    handler: async (request) => {
      await app.services.auth.logout(currentUser(request).id, request.body.refresh_token);
    },
  });

  done();
};
