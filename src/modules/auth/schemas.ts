/**
 * Schemas Joi de `auth` (§8.2) y sus interfaces TypeScript.
 *
 * El body se valida con `convert: false`, así que las normalizaciones de
 * strings (`lowercase()`, `trim()`, `uppercase()`) se habilitan campo por
 * campo con `prefs({ convert: true })`. Joi nunca convierte otros tipos a
 * string, por lo que un número sigue fallando con `string.base`.
 */
import Joi from 'joi';
import { DOCUMENT_TYPES, type Country, type DocumentType } from '../../core/domain.js';
import { country } from '../../http/schemas/common.js';
import { USER_EXAMPLE, userResponse, type UserResponse } from '../users/schemas.js';

export interface RegisterBody {
  email: string;
  password: string;
  full_name: string;
  country: Country;
  document_type: DocumentType;
  document_number: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface RefreshBody {
  refresh_token: string;
}

export type LogoutBody = RefreshBody;

export interface TokensResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  /** Segundos de vida del access token. */
  expires_in: number;
}

export interface RegisterResponse {
  user: UserResponse;
  tokens: TokensResponse;
}

const NORMALIZE = { convert: true } as const;

export const DOCUMENT_PATTERNS = {
  CC: /^\d{6,10}$/,
  CE_CO: /^[A-Za-z0-9]{6,12}$/,
  CE_PE: /^[A-Za-z0-9]{9,12}$/,
  CURP: /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/,
  DNI: /^\d{8}$/,
} as const;

function email(): Joi.StringSchema {
  return Joi.string().email().lowercase().max(254).prefs(NORMALIZE).example('ana@example.com');
}

const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[A-Za-z]/, 'letra')
  .pattern(/\d/, 'número')
  .description('8 a 128 caracteres, con al menos una letra y un número')
  .example('Demo1234!');

/** El tipo de documento tiene que ser uno de los permitidos para el país. */
const documentType = Joi.string()
  .required()
  .when('country', {
    switch: [
      { is: 'CO', then: Joi.valid('CC', 'CE') },
      { is: 'MX', then: Joi.valid('CURP') },
      { is: 'PE', then: Joi.valid('DNI', 'CE') },
    ],
    otherwise: Joi.valid(...DOCUMENT_TYPES),
  })
  .example('CC');

/** El formato del número depende del tipo y, para `CE`, también del país. */
const documentNumber = Joi.string()
  .required()
  .max(32)
  .when('document_type', {
    switch: [
      { is: 'CC', then: Joi.string().pattern(DOCUMENT_PATTERNS.CC) },
      { is: 'CURP', then: Joi.string().uppercase().pattern(DOCUMENT_PATTERNS.CURP) },
      { is: 'DNI', then: Joi.string().pattern(DOCUMENT_PATTERNS.DNI) },
      {
        is: 'CE',
        then: Joi.when('country', {
          is: 'PE',
          then: Joi.string().pattern(DOCUMENT_PATTERNS.CE_PE),
          otherwise: Joi.string().pattern(DOCUMENT_PATTERNS.CE_CO),
        }),
      },
    ],
  })
  .prefs(NORMALIZE)
  .example('1234567890');

export const registerBody: Joi.ObjectSchema<RegisterBody> = Joi.object<RegisterBody>({
  email: email().required(),
  password: password.required(),
  full_name: Joi.string().trim().min(3).max(80).prefs(NORMALIZE).required().example('Ana Gómez'),
  country: country().required(),
  document_type: documentType,
  document_number: documentNumber,
});

export const loginBody: Joi.ObjectSchema<LoginBody> = Joi.object<LoginBody>({
  email: email().required(),
  password: Joi.string().min(1).max(128).required().example('Demo1234!'),
});

const refreshToken = Joi.string()
  .pattern(/^[A-Za-z0-9_-]+$/)
  .min(16)
  .max(256)
  .required()
  .example('m2Yc0aXkW3tq8l1nV5bZ7pRj4sHd6fGu9eKoIxTyAwQ');

export const refreshBody: Joi.ObjectSchema<RefreshBody> = Joi.object<RefreshBody>({
  refresh_token: refreshToken,
});

export const logoutBody: Joi.ObjectSchema<LogoutBody> = Joi.object<LogoutBody>({
  refresh_token: refreshToken,
});

const TOKENS_EXAMPLE: TokensResponse = {
  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfMDFKQyJ9.c2lnbmF0dXJl',
  refresh_token: 'm2Yc0aXkW3tq8l1nV5bZ7pRj4sHd6fGu9eKoIxTyAwQ',
  token_type: 'bearer',
  expires_in: 900,
};

export const tokensResponse: Joi.ObjectSchema<TokensResponse> = Joi.object<TokensResponse>({
  access_token: Joi.string().required().example('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'),
  refresh_token: Joi.string().required().example('m2Yc0aXkW3tq8l1nV5bZ7pRj4sHd6fGu9eKoIxTyAwQ'),
  token_type: Joi.string().valid('bearer').required(),
  expires_in: Joi.number().integer().min(1).required().example(900),
}).example(TOKENS_EXAMPLE);

export const registerResponse: Joi.ObjectSchema<RegisterResponse> = Joi.object<RegisterResponse>({
  user: userResponse.required(),
  tokens: tokensResponse.required(),
}).example({ user: USER_EXAMPLE, tokens: TOKENS_EXAMPLE });
