import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import { AppError, validationError } from '../../core/errors.js';
import type { IdGenerator } from '../../core/ids.js';
import { documentLast4, safeEqual, type Security } from '../../core/security.js';
import type { Db, DbExecutor } from '../../db/client.js';
import { isUniqueViolation, pgConstraintName, withTransaction } from '../../db/transaction.js';
import type { AccountsService } from '../accounts/service.js';
import type { MetaService } from '../meta/service.js';
import type { UsersRepository } from '../users/repository.js';
import { toUserResponse } from '../users/service.js';
import type { RefreshTokensRepository } from './repository.js';
import type { LoginBody, RegisterBody, RegisterResponse, TokensResponse } from './schemas.js';

const DAY_MS = 86_400_000;

type RefreshOutcome =
  | { kind: 'rotated'; tokens: TokensResponse }
  | { kind: 'invalid' }
  /** El token ya había sido rotado: se revocó toda la familia. */
  | { kind: 'reused' };

export class AuthService {
  public constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly security: Security,
    private readonly config: Pick<Config, 'refreshTtlDays'>,
    private readonly meta: MetaService,
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly accounts: AccountsService,
  ) {}

  public async register(body: RegisterBody): Promise<RegisterResponse> {
    const countryConfig = this.meta.countryConfig(body.country);
    if (!countryConfig.documentTypes.includes(body.document_type)) {
      // Joi ya lo valida con `when`; esto protege a quien llame al service sin pasar por HTTP.
      throw validationError([{ field: 'document_type', code: 'NOT_ALLOWED' }]);
    }

    const documentNumber = body.document_number.toUpperCase();
    const documentHash = this.security.documentHash(
      body.country,
      body.document_type,
      documentNumber,
    );

    if ((await this.users.findByEmail(this.db, body.email)) !== undefined) {
      throw new AppError('AUTH_EMAIL_TAKEN', { detail: 'Ya existe una cuenta con ese email' });
    }
    if ((await this.users.findByDocumentHash(this.db, documentHash)) !== undefined) {
      throw new AppError('AUTH_DOCUMENT_TAKEN', {
        detail: 'Ya existe una cuenta con ese documento en el país',
      });
    }

    const passwordHash = await this.security.hashPassword(body.password);

    try {
      return await withTransaction(this.db, async (tx) => {
        const now = this.clock.now();
        const user = await this.users.insert(tx, {
          id: this.ids.next('user'),
          email: body.email,
          passwordHash,
          fullName: body.full_name,
          country: body.country,
          baseCurrency: countryConfig.currency,
          documentType: body.document_type,
          documentHash,
          documentLast4: documentLast4(documentNumber),
          createdAt: now,
          updatedAt: now,
        });
        await this.accounts.createUserAccounts(tx, user.id);
        const tokens = await this.issueTokens(tx, user.id, this.ids.next('refreshFamily'));
        return { user: toUserResponse(user), tokens: tokens.response };
      });
    } catch (error) {
      // Dos registros simultáneos pasan los chequeos previos; decide la restricción única.
      if (isUniqueViolation(error)) {
        const constraint = pgConstraintName(error);
        if (constraint === 'uq_users_email') {
          throw new AppError('AUTH_EMAIL_TAKEN', { detail: 'Ya existe una cuenta con ese email' });
        }
        if (constraint === 'uq_users_document_hash') {
          throw new AppError('AUTH_DOCUMENT_TAKEN', {
            detail: 'Ya existe una cuenta con ese documento en el país',
          });
        }
      }
      throw error;
    }
  }

  public async login(body: LoginBody): Promise<TokensResponse> {
    const invalid = (): AppError =>
      new AppError('AUTH_INVALID_CREDENTIALS', { detail: 'Email o contraseña incorrectos' });

    const user = await this.users.findByEmail(this.db, body.email);
    if (user === undefined) {
      // Mismo trabajo que con una contraseña errónea: no se filtra si el email existe.
      await this.security.verifyAgainstDecoy(body.password);
      throw invalid();
    }
    if (!(await this.security.verifyPassword(user.passwordHash, body.password))) throw invalid();

    if (this.security.needsRehash(user.passwordHash)) {
      const rehashed = await this.security.hashPassword(body.password);
      await this.users.updatePasswordHash(this.db, user.id, rehashed, this.clock.now());
    }

    const tokens = await this.issueTokens(this.db, user.id, this.ids.next('refreshFamily'));
    return tokens.response;
  }

  /**
   * Rotación: cada refresh devuelve un par nuevo e invalida el anterior. Si
   * llega un token que ya fue rotado, se revoca la familia completa.
   */
  public async refresh(refreshToken: string): Promise<TokensResponse> {
    const tokenHash = this.security.hashRefreshToken(refreshToken);

    // La revocación de la familia tiene que confirmarse aunque la respuesta sea
    // un error, por eso el resultado sale de la transacción y se lanza después.
    const outcome = await withTransaction<RefreshOutcome>(this.db, async (tx) => {
      const now = this.clock.now();
      const stored = await this.refreshTokens.findByHashForUpdate(tx, tokenHash);
      if (stored === undefined || !safeEqual(stored.tokenHash, tokenHash)) {
        return { kind: 'invalid' };
      }

      if (stored.replacedBy !== null) {
        await this.refreshTokens.revokeFamily(tx, stored.familyId, now);
        return { kind: 'reused' };
      }
      if (stored.revokedAt !== null || stored.expiresAt.getTime() <= now.getTime()) {
        return { kind: 'invalid' };
      }

      const tokens = await this.issueTokens(tx, stored.userId, stored.familyId);
      await this.refreshTokens.markRotated(tx, stored.id, tokens.refreshTokenId, now);
      return { kind: 'rotated', tokens: tokens.response };
    });

    if (outcome.kind === 'rotated') return outcome.tokens;
    throw new AppError('AUTH_REFRESH_INVALID', {
      detail:
        outcome.kind === 'reused'
          ? 'El refresh token ya fue usado; se cerraron todas las sesiones de esa cadena'
          : 'El refresh token no existe, venció o fue revocado',
    });
  }

  /** Revoca el refresh enviado, si es del usuario. Siempre responde igual (204). */
  public async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = this.security.hashRefreshToken(refreshToken);
    await withTransaction(this.db, async (tx) => {
      const stored = await this.refreshTokens.findByHashForUpdate(tx, tokenHash);
      if (stored?.userId !== userId) return;
      await this.refreshTokens.revoke(tx, stored.id, this.clock.now());
    });
  }

  /** Emite un access token y guarda un refresh token nuevo de la familia dada. */
  public async issueTokens(
    executor: DbExecutor,
    userId: string,
    familyId: string,
  ): Promise<{ response: TokensResponse; refreshTokenId: string }> {
    const now = this.clock.now();
    const refreshToken = this.security.generateRefreshToken();
    const refreshTokenId = this.ids.next('refreshToken');

    await this.refreshTokens.insert(executor, {
      id: refreshTokenId,
      userId,
      familyId,
      tokenHash: this.security.hashRefreshToken(refreshToken),
      expiresAt: new Date(now.getTime() + this.config.refreshTtlDays * DAY_MS),
      revokedAt: null,
      replacedBy: null,
      createdAt: now,
    });

    const accessToken = await this.security.signAccessToken(userId, this.ids.ulid());
    return {
      refreshTokenId,
      response: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'bearer',
        expires_in: this.security.accessTtlSeconds,
      },
    };
  }
}
