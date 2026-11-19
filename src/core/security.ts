/**
 * Primitivas de seguridad (§12): contraseñas con argon2id, access tokens JWT
 * (HS256, `jose`), refresh tokens opacos y HMAC de documentos.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import type { Clock } from './clock.js';
import type { Country, DocumentType } from './domain.js';
import { AppError } from './errors.js';

const JWT_ALGORITHM = 'HS256';
const REFRESH_TOKEN_BYTES = 32;

export interface AccessTokenClaims {
  /** Id del usuario. */
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface SecurityOptions {
  jwtSecret: string;
  jwtAccessTtlSeconds: number;
  documentPepper: string;
}

/** Compara dos secretos en tiempo constante, sin filtrar su longitud. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class Security {
  private readonly jwtKey: Uint8Array;
  private decoyHash: Promise<string> | undefined;

  public constructor(
    private readonly options: SecurityOptions,
    private readonly clock: Clock,
  ) {
    this.jwtKey = new TextEncoder().encode(options.jwtSecret);
  }

  // ---------- contraseñas ----------

  /** `salt` solo lo fija el seed, para que el hash del usuario demo sea determinístico. */
  public async hashPassword(password: string, salt?: Buffer): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      ...(salt === undefined ? {} : { salt }),
    });
  }

  public async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Un hash corrupto se trata como contraseña incorrecta.
      return false;
    }
  }

  /** `true` si el hash se generó con parámetros distintos de los actuales. */
  public needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash);
  }

  /**
   * Verifica contra un hash señuelo cuando el email no existe, para que el
   * login tarde lo mismo que con una contraseña incorrecta (§12).
   */
  public async verifyAgainstDecoy(password: string): Promise<void> {
    this.decoyHash ??= this.hashPassword(randomBytes(24).toString('base64url'));
    await this.verifyPassword(await this.decoyHash, password);
  }

  // ---------- access tokens ----------

  public async signAccessToken(userId: string, jti: string): Promise<string> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(userId)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.options.jwtAccessTtlSeconds)
      .sign(this.jwtKey);
  }

  public async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwtKey, {
        algorithms: [JWT_ALGORITHM],
        currentDate: this.clock.now(),
        requiredClaims: ['sub', 'jti', 'iat', 'exp'],
      });
      const { sub, jti, iat, exp } = payload;
      if (
        typeof sub !== 'string' ||
        typeof jti !== 'string' ||
        typeof iat !== 'number' ||
        typeof exp !== 'number'
      ) {
        throw new AppError('AUTH_TOKEN_INVALID');
      }
      return { sub, jti, iat, exp };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof joseErrors.JWTExpired) {
        throw new AppError('AUTH_TOKEN_EXPIRED', { detail: 'El access token venció' });
      }
      throw new AppError('AUTH_TOKEN_INVALID', { detail: 'El access token no es válido' });
    }
  }

  public get accessTtlSeconds(): number {
    return this.options.jwtAccessTtlSeconds;
  }

  // ---------- refresh tokens ----------

  /** Token opaco: 32 bytes aleatorios en base64url. Solo se guarda su hash. */
  public generateRefreshToken(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  public hashRefreshToken(token: string): string {
    return sha256Hex(token);
  }

  // ---------- documentos ----------

  /**
   * `HMAC-SHA256(DOCUMENT_PEPPER, país|tipo|número)`. Es lo único que se guarda
   * del documento, junto con sus últimos 4 caracteres (§8.2).
   */
  public documentHash(country: Country, type: DocumentType, number: string): string {
    return createHmac('sha256', this.options.documentPepper)
      .update(`${country}|${type}|${number}`, 'utf8')
      .digest('hex');
  }
}

export function documentLast4(number: string): string {
  return number.slice(-4);
}
