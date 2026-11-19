/**
 * Catálogo de errores de negocio.
 *
 * Toda excepción que llega al cliente pasa por `AppError`: el error handler
 * global la convierte en `application/problem+json` (§7.3 del contrato).
 * Ninguna ruta arma respuestas de error a mano.
 */

export const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 422, title: 'Validation error' },
  AUTH_INVALID_CREDENTIALS: { status: 401, title: 'Invalid credentials' },
  AUTH_EMAIL_TAKEN: { status: 409, title: 'Email already registered' },
  AUTH_DOCUMENT_TAKEN: { status: 409, title: 'Document already registered' },
  AUTH_TOKEN_EXPIRED: { status: 401, title: 'Access token expired' },
  AUTH_TOKEN_INVALID: { status: 401, title: 'Access token invalid' },
  AUTH_REFRESH_INVALID: { status: 401, title: 'Refresh token invalid' },
  INSUFFICIENT_FUNDS: { status: 422, title: 'Insufficient funds' },
  INSUFFICIENT_POSITION: { status: 422, title: 'Insufficient position' },
  MARKET_CLOSED: { status: 422, title: 'Market closed' },
  INSTRUMENT_NOT_FOUND: { status: 404, title: 'Instrument not found' },
  ORDER_NOT_FOUND: { status: 404, title: 'Order not found' },
  IDEMPOTENCY_CONFLICT: { status: 409, title: 'Idempotency key conflict' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Payload too large' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Códigos por campo que viajan en `errors[]` (§5 y §7.3). */
export const FIELD_ERROR_CODES = [
  'REQUIRED',
  'INVALID_FORMAT',
  'TOO_SHORT',
  'TOO_LONG',
  'TOO_SMALL',
  'TOO_LARGE',
  'NOT_ALLOWED',
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

export interface FieldError {
  field: string;
  code: FieldErrorCode;
}

/** Cuerpo `application/problem+json` tal como lo ve el cliente. */
export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: FieldError[];
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly title: string;
  public readonly detail: string | undefined;
  public readonly fieldErrors: FieldError[] | undefined;
  /** Cabeceras extra que el error handler copia en la respuesta (p. ej. `Retry-After`). */
  public readonly headers: Readonly<Record<string, string>> | undefined;

  public constructor(
    code: ErrorCode,
    options: {
      detail?: string;
      fieldErrors?: FieldError[];
      headers?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    const entry = ERROR_CATALOG[code];
    super(
      options.detail ?? entry.title,
      options.cause === undefined ? {} : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.status = entry.status;
    this.title = entry.title;
    this.detail = options.detail;
    this.fieldErrors = options.fieldErrors;
    this.headers = options.headers;
  }

  public toProblem(): ProblemDocument {
    const problem: ProblemDocument = {
      type: 'about:blank',
      title: this.title,
      status: this.status,
      code: this.code,
    };
    if (this.detail !== undefined) problem.detail = this.detail;
    if (this.fieldErrors !== undefined && this.fieldErrors.length > 0) {
      problem.errors = this.fieldErrors;
    }
    return problem;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Atajo para las validaciones de negocio que responden como Joi (§5). */
export function validationError(fieldErrors: FieldError[], detail?: string): AppError {
  return new AppError('VALIDATION_ERROR', {
    fieldErrors,
    ...(detail === undefined ? {} : { detail }),
  });
}
