import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshTokens, users } from '../../src/db/schema.js';
import type { RegisterResponse, TokensResponse } from '../../src/modules/auth/schemas.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { bearer, get, post, registerPayload, registerUser } from '../helpers/factories.js';
import { expectLedgerBalanced } from '../helpers/ledger.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await buildTestApp();
});

afterAll(async () => {
  await ctx.close();
});

const refresh = (token: string) => post(ctx.app, '/auth/refresh', { refresh_token: token });

describe('POST /auth/register', () => {
  it('crea el usuario con sus tres cuentas en cero y devuelve tokens', async () => {
    const payload = registerPayload({ email: 'Nueva.Persona@Example.com', country: 'CO' });
    const response = await post(ctx.app, '/auth/register', payload);
    expect(response.statusCode).toBe(201);

    const body = response.json<RegisterResponse>();
    expect(body.user).toEqual({
      id: expect.stringMatching(/^usr_/) as string,
      email: 'nueva.persona@example.com',
      full_name: 'Ana Gómez',
      country: 'CO',
      base_currency: 'COP',
      document_type: 'CC',
      document_last4: payload.document_number.slice(-4),
    });
    expect(body.tokens).toMatchObject({ token_type: 'bearer', expires_in: 900 });

    const accounts = await get(ctx.app, '/accounts', bearer(body.tokens.access_token));
    expect(accounts.json()).toEqual([
      {
        id: expect.stringMatching(/^acc_/) as string,
        currency: 'COP',
        available: '0.00',
        reserved: '0.00',
      },
      {
        id: expect.stringMatching(/^acc_/) as string,
        currency: 'MXN',
        available: '0.00',
        reserved: '0.00',
      },
      {
        id: expect.stringMatching(/^acc_/) as string,
        currency: 'PEN',
        available: '0.00',
        reserved: '0.00',
      },
    ]);
    await expectLedgerBalanced(ctx.db);
  });

  it.each([
    ['MX', 'CURP', 'GOMA900101HDFRRN09', 'MXN'],
    ['PE', 'DNI', '87654321', 'PEN'],
  ] as const)(
    'en %s la moneda base es la del país',
    async (country, document_type, document_number, currency) => {
      const session = await registerUser(ctx.app, { country, document_type, document_number });
      expect(session.user).toMatchObject({ country, base_currency: currency, document_type });
    },
  );

  it('no guarda el número de documento ni la contraseña en claro', async () => {
    const payload = registerPayload({ document_number: '1234509876' });
    const response = await post(ctx.app, '/auth/register', payload);
    const { user } = response.json<RegisterResponse>();
    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));

    expect(row?.documentLast4).toBe('9876');
    expect(row?.documentHash).toBe(ctx.security.documentHash('CO', 'CC', '1234509876'));
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(JSON.stringify(row)).not.toContain('1234509876');
    expect(JSON.stringify(row)).not.toContain(payload.password);
    expect(response.body).not.toContain('1234509876');
  });

  it('email repetido → AUTH_EMAIL_TAKEN, sin importar mayúsculas', async () => {
    const first = registerPayload();
    expect((await post(ctx.app, '/auth/register', first)).statusCode).toBe(201);
    const response = await post(
      ctx.app,
      '/auth/register',
      registerPayload({ email: first.email.toUpperCase() }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'AUTH_EMAIL_TAKEN' });
  });

  it('documento repetido en el mismo país → AUTH_DOCUMENT_TAKEN', async () => {
    const first = registerPayload({ document_type: 'CE', document_number: 'ab123456' });
    expect((await post(ctx.app, '/auth/register', first)).statusCode).toBe(201);
    // Mismo documento con otra capitalización: sigue siendo el mismo.
    const response = await post(
      ctx.app,
      '/auth/register',
      registerPayload({ document_type: 'CE', document_number: 'AB123456' }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'AUTH_DOCUMENT_TAKEN' });
  });

  it('el mismo número en otro país o con otro tipo no choca', async () => {
    const number = '123456789';
    expect(
      (
        await post(
          ctx.app,
          '/auth/register',
          registerPayload({ document_type: 'CE', document_number: number }),
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await post(
          ctx.app,
          '/auth/register',
          registerPayload({ document_type: 'CC', document_number: number }),
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await post(
          ctx.app,
          '/auth/register',
          registerPayload({ country: 'PE', document_type: 'CE', document_number: number }),
        )
      ).statusCode,
    ).toBe(201);
  });

  it('dos registros simultáneos con el mismo email: uno solo gana', async () => {
    const email = registerPayload().email;
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => post(ctx.app, '/auth/register', registerPayload({ email }))),
    );
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.statusCode === 409)) {
      expect(response.json()).toMatchObject({ code: 'AUTH_EMAIL_TAKEN' });
    }
  });

  it('dos registros simultáneos con el mismo documento: uno solo gana', async () => {
    const document_number = '5556667778';
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        post(ctx.app, '/auth/register', registerPayload({ document_number })),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.statusCode === 409)) {
      expect(response.json()).toMatchObject({ code: 'AUTH_DOCUMENT_TAKEN' });
    }
  });

  it('documento no permitido para el país → VALIDATION_ERROR en document_type', async () => {
    const response = await post(
      ctx.app,
      '/auth/register',
      registerPayload({ country: 'MX', document_type: 'CC', document_number: '1020304050' }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'document_type', code: 'NOT_ALLOWED' }],
    });
  });

  it('el service valida el documento aunque no se pase por HTTP', async () => {
    await expect(
      ctx.app.services.auth.register(registerPayload({ country: 'PE', document_type: 'CURP' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: [{ field: 'document_type', code: 'NOT_ALLOWED' }],
    });
  });
});

describe('POST /auth/login', () => {
  it('devuelve un par de tokens y el access token sirve para /me', async () => {
    const payload = registerPayload();
    await post(ctx.app, '/auth/register', payload);

    const response = await post(ctx.app, '/auth/login', {
      email: payload.email.toUpperCase(),
      password: payload.password,
    });
    expect(response.statusCode).toBe(200);
    const tokens = response.json<TokensResponse>();
    expect(tokens).toEqual({
      access_token: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/) as string,
      refresh_token: expect.stringMatching(/^[\w-]{43}$/) as string,
      token_type: 'bearer',
      expires_in: 900,
    });

    const me = await get(ctx.app, '/me', bearer(tokens.access_token));
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: payload.email });
  });

  it('responde lo mismo para email inexistente y contraseña errónea', async () => {
    const payload = registerPayload();
    await post(ctx.app, '/auth/register', payload);

    const wrongPassword = await post(ctx.app, '/auth/login', {
      email: payload.email,
      password: 'Incorrecta1',
    });
    const unknownEmail = await post(ctx.app, '/auth/login', {
      email: 'nadie@example.com',
      password: payload.password,
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.json()).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  it('rehashea la contraseña si el hash usa parámetros viejos', async () => {
    const payload = registerPayload();
    const registered = (await post(ctx.app, '/auth/register', payload)).json<RegisterResponse>();
    // Un hash argon2id válido de la misma contraseña, pero con costo menor al actual.
    const argon2 = await import('argon2');
    const weak = await argon2.hash(payload.password, {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 8192,
    });
    await ctx.db.update(users).set({ passwordHash: weak }).where(eq(users.id, registered.user.id));

    const credentials = { email: payload.email, password: payload.password };
    expect((await post(ctx.app, '/auth/login', credentials)).statusCode).toBe(200);
    const [row] = await ctx.db.select().from(users).where(eq(users.id, registered.user.id));
    expect(row?.passwordHash).not.toBe(weak);
    expect(ctx.security.needsRehash(row?.passwordHash ?? '')).toBe(false);
    expect((await post(ctx.app, '/auth/login', credentials)).statusCode).toBe(200);
  });
});

describe('access token', () => {
  it('vence a los 15 minutos → AUTH_TOKEN_EXPIRED', async () => {
    const session = await registerUser(ctx.app);
    ctx.clock.advance(14 * 60_000 + 59_000);
    expect((await get(ctx.app, '/me', session.headers)).statusCode).toBe(200);

    ctx.clock.advance(2_000);
    const response = await get(ctx.app, '/me', session.headers);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
  });

  it('con firma inválida → AUTH_TOKEN_INVALID', async () => {
    const session = await registerUser(ctx.app);
    const tampered = `${session.accessToken.slice(0, -3)}abc`;
    const response = await get(ctx.app, '/me', bearer(tampered));
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
  });
});

describe('POST /auth/refresh', () => {
  it('rota: devuelve un par nuevo e invalida el anterior', async () => {
    const session = await registerUser(ctx.app);
    const rotated = await refresh(session.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const tokens = rotated.json<TokensResponse>();
    expect(tokens.refresh_token).not.toBe(session.refreshToken);
    expect(tokens.access_token).not.toBe(session.accessToken);
    expect((await get(ctx.app, '/me', bearer(tokens.access_token))).statusCode).toBe(200);

    // El nuevo sirve para seguir rotando.
    expect((await refresh(tokens.refresh_token)).statusCode).toBe(200);
  });

  it('reutilizar un refresh ya rotado revoca toda la familia', async () => {
    const session = await registerUser(ctx.app);
    const second = (await refresh(session.refreshToken)).json<TokensResponse>();
    const third = (await refresh(second.refresh_token)).json<TokensResponse>();

    // Alguien presenta de nuevo el primer token (robado).
    const reuse = await refresh(session.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });

    // El token vigente de la familia también quedó revocado.
    const afterReuse = await refresh(third.refresh_token);
    expect(afterReuse.statusCode).toBe(401);
    expect(afterReuse.json()).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });

    const family = await ctx.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, session.user.id));
    expect(family).toHaveLength(3);
    expect(new Set(family.map((row) => row.familyId)).size).toBe(1);
    expect(family.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('la reutilización no afecta a otras sesiones del mismo usuario', async () => {
    const payload = registerPayload();
    const first = (await post(ctx.app, '/auth/register', payload)).json<RegisterResponse>();
    const other = (
      await post(ctx.app, '/auth/login', { email: payload.email, password: payload.password })
    ).json<TokensResponse>();

    await refresh(first.tokens.refresh_token);
    expect((await refresh(first.tokens.refresh_token)).statusCode).toBe(401);
    // La otra sesión es otra familia y sigue viva.
    expect((await refresh(other.refresh_token)).statusCode).toBe(200);
  });

  it('dos rotaciones simultáneas del mismo token: una sola gana', async () => {
    const session = await registerUser(ctx.app);
    const responses = await Promise.all([
      refresh(session.refreshToken),
      refresh(session.refreshToken),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
  });

  it('un refresh inexistente o vencido → AUTH_REFRESH_INVALID', async () => {
    const unknown = await refresh('a'.repeat(43));
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });

    const session = await registerUser(ctx.app);
    ctx.clock.advance(7 * 86_400_000 + 1_000);
    const expired = await refresh(session.refreshToken);
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('el refresh token vive 7 días', async () => {
    const session = await registerUser(ctx.app);
    ctx.clock.advance(7 * 86_400_000 - 60_000);
    expect((await refresh(session.refreshToken)).statusCode).toBe(200);
  });
});

describe('POST /auth/logout', () => {
  it('revoca el refresh enviado y responde 204', async () => {
    const session = await registerUser(ctx.app);
    const response = await post(
      ctx.app,
      '/auth/logout',
      { refresh_token: session.refreshToken },
      session.headers,
    );
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const afterLogout = await refresh(session.refreshToken);
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json()).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('requiere access token', async () => {
    const session = await registerUser(ctx.app);
    const response = await post(ctx.app, '/auth/logout', { refresh_token: session.refreshToken });
    expect(response.statusCode).toBe(401);
    expect((await refresh(session.refreshToken)).statusCode).toBe(200);
  });

  it('no revoca el refresh de otro usuario ni revela si existe', async () => {
    const victim = await registerUser(ctx.app);
    const attacker = await registerUser(ctx.app);
    const response = await post(
      ctx.app,
      '/auth/logout',
      { refresh_token: victim.refreshToken },
      attacker.headers,
    );
    expect(response.statusCode).toBe(204);
    expect(
      (await post(ctx.app, '/auth/logout', { refresh_token: 'b'.repeat(43) }, attacker.headers))
        .statusCode,
    ).toBe(204);
    expect((await refresh(victim.refreshToken)).statusCode).toBe(200);
  });
});
