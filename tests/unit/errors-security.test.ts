import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../../src/core/clock.js';
import {
  AppError,
  ERROR_CATALOG,
  FIELD_ERROR_CODES,
  isAppError,
  validationError,
} from '../../src/core/errors.js';
import { stableStringify } from '../../src/core/idempotency.js';
import { REDACT_PATHS, createLogger, loggerOptions } from '../../src/core/logger.js';
import { Security, documentLast4, safeEqual, sha256Hex } from '../../src/core/security.js';

describe('AppError', () => {
  it('toma status y título del catálogo', () => {
    const error = new AppError('INSUFFICIENT_FUNDS', {
      detail: 'Available 12000.00 COP',
      fieldErrors: [{ field: 'quantity', code: 'TOO_LARGE' }],
    });
    expect(isAppError(error)).toBe(true);
    expect(error.status).toBe(422);
    expect(error.message).toBe('Available 12000.00 COP');
    expect(error.toProblem()).toEqual({
      type: 'about:blank',
      title: 'Insufficient funds',
      status: 422,
      code: 'INSUFFICIENT_FUNDS',
      detail: 'Available 12000.00 COP',
      errors: [{ field: 'quantity', code: 'TOO_LARGE' }],
    });
  });

  it('omite detail y errors cuando no hay', () => {
    const cause = new Error('boom');
    const error = new AppError('INTERNAL_ERROR', { cause });
    expect(error.cause).toBe(cause);
    expect(error.toProblem()).toEqual({
      type: 'about:blank',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(new AppError('NOT_FOUND', { fieldErrors: [] }).toProblem()).not.toHaveProperty('errors');
    expect(isAppError(new Error('x'))).toBe(false);
  });

  it('validationError arma un VALIDATION_ERROR con sus campos', () => {
    const plain = validationError([{ field: 'amount', code: 'TOO_LARGE' }]);
    expect(plain.toProblem()).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
    expect(plain.detail).toBeUndefined();
    expect(validationError([{ field: 'amount', code: 'TOO_LARGE' }], 'detalle').detail).toBe(
      'detalle',
    );
  });

  it('el catálogo tiene los 17 códigos del contrato con su status', () => {
    expect(
      Object.fromEntries(
        Object.entries(ERROR_CATALOG).map(([code, entry]) => [code, entry.status]),
      ),
    ).toEqual({
      VALIDATION_ERROR: 422,
      AUTH_INVALID_CREDENTIALS: 401,
      AUTH_EMAIL_TAKEN: 409,
      AUTH_DOCUMENT_TAKEN: 409,
      AUTH_TOKEN_EXPIRED: 401,
      AUTH_TOKEN_INVALID: 401,
      AUTH_REFRESH_INVALID: 401,
      INSUFFICIENT_FUNDS: 422,
      INSUFFICIENT_POSITION: 422,
      MARKET_CLOSED: 422,
      INSTRUMENT_NOT_FOUND: 404,
      ORDER_NOT_FOUND: 404,
      IDEMPOTENCY_CONFLICT: 409,
      RATE_LIMITED: 429,
      NOT_FOUND: 404,
      PAYLOAD_TOO_LARGE: 413,
      INTERNAL_ERROR: 500,
    });
    expect(FIELD_ERROR_CODES).toEqual([
      'REQUIRED',
      'INVALID_FORMAT',
      'TOO_SHORT',
      'TOO_LONG',
      'TOO_SMALL',
      'TOO_LARGE',
      'NOT_ALLOWED',
    ]);
  });
});

describe('Security', () => {
  const clock = new FrozenClock('2026-11-18T15:00:00Z');
  const options = {
    jwtSecret: 'unit-test-secret-0123456789abcdef0123',
    jwtAccessTtlSeconds: 900,
    documentPepper: 'unit-test-pepper-0123',
  };
  const security = new Security(options, clock);

  it('hashea contraseñas con argon2id y las verifica', async () => {
    const hash = await security.hashPassword('Demo1234!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await security.verifyPassword(hash, 'Demo1234!')).toBe(true);
    expect(await security.verifyPassword(hash, 'demo1234!')).toBe(false);
    expect(await security.verifyPassword('no-es-un-hash', 'Demo1234!')).toBe(false);
    expect(security.needsRehash(hash)).toBe(false);
    await expect(security.verifyAgainstDecoy('cualquiera')).resolves.toBeUndefined();
  });

  it('con sal fija el hash es determinístico', async () => {
    const salt = Buffer.from('una-sal-fija-de-prueba');
    expect(await security.hashPassword('Demo1234!', salt)).toBe(
      await security.hashPassword('Demo1234!', salt),
    );
  });

  it('firma access tokens HS256 con sub, jti, iat y exp', async () => {
    const token = await security.signAccessToken('usr_1', 'jti_1');
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map(
        (part) => JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>,
      );
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    const issuedAt = Math.floor(clock.now().getTime() / 1000);
    expect(payload).toEqual({ sub: 'usr_1', jti: 'jti_1', iat: issuedAt, exp: issuedAt + 900 });
    expect(await security.verifyAccessToken(token)).toEqual(payload);
    expect(security.accessTtlSeconds).toBe(900);
  });

  it('distingue un token vencido de uno inválido', async () => {
    const local = new FrozenClock('2026-11-18T15:00:00Z');
    const localSecurity = new Security(options, local);
    const token = await localSecurity.signAccessToken('usr_1', 'jti_1');

    local.advance(899_000);
    await expect(localSecurity.verifyAccessToken(token)).resolves.toMatchObject({ sub: 'usr_1' });
    local.advance(2_000);
    await expect(localSecurity.verifyAccessToken(token)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_EXPIRED',
    });

    await expect(security.verifyAccessToken('no.es.jwt')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    await expect(security.verifyAccessToken(`${token.slice(0, -2)}xx`)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });

    const otherKey = new Security(
      { ...options, jwtSecret: 'another-secret-0123456789abcdef0123456' },
      clock,
    );
    await expect(
      security.verifyAccessToken(await otherKey.signAccessToken('usr_1', 'jti_1')),
    ).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('rechaza algoritmos distintos de HS256 y tokens sin los claims obligatorios', async () => {
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"usr_1"}').toString('base64url')}.`;
    await expect(security.verifyAccessToken(unsigned)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('genera refresh tokens opacos de 32 bytes y guarda solo su sha256', () => {
    const token = security.generateRefreshToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(security.generateRefreshToken()).not.toBe(token);
    expect(security.hashRefreshToken(token)).toBe(sha256Hex(token));
    expect(security.hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el HMAC del documento depende del país, el tipo, el número y el pepper', () => {
    const hash = security.documentHash('CO', 'CC', '1020304050');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(security.documentHash('CO', 'CC', '1020304050')).toBe(hash);
    expect(security.documentHash('PE', 'CC', '1020304050')).not.toBe(hash);
    expect(security.documentHash('CO', 'CE', '1020304050')).not.toBe(hash);
    expect(security.documentHash('CO', 'CC', '1020304051')).not.toBe(hash);
    const otherPepper = new Security(
      { ...options, documentPepper: 'otro-pepper-0123456789' },
      clock,
    );
    expect(otherPepper.documentHash('CO', 'CC', '1020304050')).not.toBe(hash);
    expect(documentLast4('1020304050')).toBe('4050');
    expect(documentLast4('123')).toBe('123');
  });

  it('compara secretos en tiempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('idempotencia: JSON canónico', () => {
  it('no depende del orden de las claves', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      stableStringify({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify([3, 'a'])).toBe('[3,"a"]');
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: '1' }));
  });
});

describe('logger', () => {
  it('redacta contraseñas, tokens, authorization y documentos', () => {
    const options = loggerOptions({ logLevel: 'info' });
    expect(options.level).toBe('info');
    expect(options.redact).toMatchObject({ censor: '[REDACTED]' });
    for (const path of [
      'req.headers.authorization',
      'password',
      'refresh_token',
      'document_number',
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
    expect(createLogger({ logLevel: 'silent' }).level).toBe('silent');
  });
});
