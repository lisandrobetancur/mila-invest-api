import { AppError } from '../../core/errors.js';
import type { Db } from '../../db/client.js';
import type { AuthenticatedUser } from '../../http/auth.js';
import type { UsersRepository } from './repository.js';
import type { UserResponse } from './schemas.js';
import type { UserRow } from './table.js';

/** Mapea la fila al contrato: nunca sale el hash de la contraseña ni el del documento. */
export function toUserResponse(row: UserRow): UserResponse {
  return {
    id: row.id,
    email: row.email,
    full_name: row.fullName,
    country: row.country,
    base_currency: row.baseCurrency,
    document_type: row.documentType,
    document_last4: row.documentLast4,
  };
}

export class UsersService {
  public constructor(
    private readonly db: Db,
    private readonly users: UsersRepository,
  ) {}

  /** Usuario dueño de un access token válido; si ya no existe, el token no sirve. */
  public async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const row = await this.users.findById(this.db, userId);
    if (row === undefined) {
      throw new AppError('AUTH_TOKEN_INVALID', { detail: 'El usuario del token no existe' });
    }
    return { id: row.id, email: row.email, country: row.country, baseCurrency: row.baseCurrency };
  }

  public async getProfile(userId: string): Promise<UserResponse> {
    const row = await this.users.findById(this.db, userId);
    if (row === undefined) {
      throw new AppError('AUTH_TOKEN_INVALID', { detail: 'El usuario del token no existe' });
    }
    return toUserResponse(row);
  }
}
