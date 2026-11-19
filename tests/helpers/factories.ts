/** Atajos para armar escenarios por HTTP con `app.inject()`. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { RegisterBody, RegisterResponse } from '../../src/modules/auth/schemas.js';
import type { CreateOrderBody } from '../../src/modules/orders/schemas.js';
import type { CreateTestUserBody } from '../../src/modules/testing/schemas.js';

export const API = '/api/v1';

export function idempotencyKey(): string {
  return randomUUID();
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

let sequence = 0;

/** Sufijo único por proceso, para emails y documentos que no choquen entre tests. */
export function unique(): string {
  sequence += 1;
  return `${String(Date.now())}${String(sequence).padStart(4, '0')}`;
}

export function registerPayload(overrides: Partial<RegisterBody> = {}): RegisterBody {
  const id = unique();
  return {
    email: `user${id}@example.com`,
    password: 'Secret123',
    full_name: 'Ana Gómez',
    country: 'CO',
    document_type: 'CC',
    document_number: id.slice(-10),
    ...overrides,
  };
}

export interface Session {
  user: RegisterResponse['user'];
  accessToken: string;
  refreshToken: string;
  headers: Record<string, string>;
}

function toSession(body: RegisterResponse): Session {
  return {
    user: body.user,
    accessToken: body.tokens.access_token,
    refreshToken: body.tokens.refresh_token,
    headers: bearer(body.tokens.access_token),
  };
}

export async function registerUser(
  app: FastifyInstance,
  overrides: Partial<RegisterBody> = {},
): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: `${API}/auth/register`,
    payload: registerPayload(overrides),
  });
  if (response.statusCode !== 201) {
    throw new Error(`register falló: ${String(response.statusCode)} ${response.body}`);
  }
  return toSession(response.json<RegisterResponse>());
}

/** Crea un usuario con saldos y posiciones a medida (`POST /_testing/users`). */
export async function createFundedUser(
  app: FastifyInstance,
  body: Partial<CreateTestUserBody> = {},
): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: `${API}/_testing/users`,
    payload: body,
  });
  if (response.statusCode !== 201) {
    throw new Error(`_testing/users falló: ${String(response.statusCode)} ${response.body}`);
  }
  return toSession(response.json<RegisterResponse>());
}

export function get(
  app: FastifyInstance,
  url: string,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url: `${API}${url}`, headers });
}

export function post(
  app: FastifyInstance,
  url: string,
  payload: InjectOptions['payload'],
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `${API}${url}`,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

export function deposit(
  app: FastifyInstance,
  session: Session,
  currency: string,
  amount: unknown,
  key: string = idempotencyKey(),
): Promise<LightMyRequestResponse> {
  return post(
    app,
    `/accounts/${currency}/deposits`,
    { amount },
    { ...session.headers, 'idempotency-key': key },
  );
}

export function orderBody(overrides: Partial<Record<keyof CreateOrderBody, unknown>> = {}): object {
  return { instrument_id: 'ECOPETROL-CO', side: 'BUY', type: 'MARKET', quantity: 10, ...overrides };
}

export function placeOrder(
  app: FastifyInstance,
  session: Session,
  overrides: Partial<Record<keyof CreateOrderBody, unknown>> = {},
  key: string = idempotencyKey(),
): Promise<LightMyRequestResponse> {
  return post(app, '/orders', orderBody(overrides), {
    ...session.headers,
    'idempotency-key': key,
  });
}

export function previewOrder(
  app: FastifyInstance,
  session: Session,
  overrides: Partial<Record<keyof CreateOrderBody, unknown>> = {},
): Promise<LightMyRequestResponse> {
  return post(app, '/orders/preview', orderBody(overrides), session.headers);
}

/** Congela el precio de un instrumento (`POST /_testing/prices/{id}`). */
export async function freezePrice(
  app: FastifyInstance,
  instrumentId: string,
  price: string | null,
): Promise<void> {
  const response = await post(app, `/_testing/prices/${instrumentId}`, { price });
  if (response.statusCode !== 200) {
    throw new Error(`_testing/prices falló: ${String(response.statusCode)} ${response.body}`);
  }
}
