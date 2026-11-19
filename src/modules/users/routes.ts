import type { FastifyPluginCallback } from 'fastify';
import { currentUser } from '../../http/auth.js';
import { defineRoute } from '../../http/define-route.js';
import { userResponse, type UserResponse } from './schemas.js';

export const usersRoutes: FastifyPluginCallback = (app, _options, done) => {
  defineRoute<{ Reply: UserResponse }>(app, {
    method: 'GET',
    url: '/me',
    auth: true,
    summary: 'Perfil del usuario autenticado',
    tags: ['users'],
    schema: { response: { 200: userResponse } },
    handler: (request) => app.services.users.getProfile(currentUser(request).id),
  });

  done();
};
