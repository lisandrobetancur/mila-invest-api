/**
 * Autenticación por `Authorization: Bearer <access_token>`.
 *
 * Se hace en dos pasos para que el rate limit pueda contar por usuario:
 *
 * 1. `readAccessToken` (hook `onRequest` global): verifica el JWT si viene y
 *    deja los claims —o el error— en la petición. No consulta la base.
 * 2. `requireAuth` (hook `preParsing` de las rutas con `auth: true`): exige un
 *    token válido y carga el usuario en `request.user`.
 */
import type { FastifyRequest } from 'fastify';
import type { Country, UserCurrency } from '../core/domain.js';
import { AppError, isAppError } from '../core/errors.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  country: Country;
  baseCurrency: UserCurrency;
}

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

export async function readAccessToken(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (header === undefined) return;

  const match = BEARER_PATTERN.exec(header);
  const token = match?.[1];
  if (token === undefined) {
    request.authError = new AppError('AUTH_TOKEN_INVALID', {
      detail: 'La cabecera Authorization debe ser "Bearer <token>"',
    });
    return;
  }

  try {
    request.accessClaims = await request.server.services.security.verifyAccessToken(token);
  } catch (error) {
    request.authError = isAppError(error) ? error : new AppError('AUTH_TOKEN_INVALID');
  }
}

export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (request.authError !== null) throw request.authError;
  if (request.accessClaims === null) {
    throw new AppError('AUTH_TOKEN_INVALID', { detail: 'Falta el access token' });
  }
  request.user = await request.server.services.users.getAuthenticatedUser(request.accessClaims.sub);
}

/** Usuario de una ruta con `auth: true`. */
export function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (request.user === null) {
    throw new AppError('AUTH_TOKEN_INVALID', { detail: 'Falta el access token' });
  }
  return request.user;
}
