import Joi from 'joi';
import {
  DOCUMENT_TYPES,
  type Country,
  type DocumentType,
  type UserCurrency,
} from '../../core/domain.js';
import { country, prefixedId, userCurrency } from '../../http/schemas/common.js';

export interface UserResponse {
  id: string;
  email: string;
  full_name: string;
  country: Country;
  base_currency: UserCurrency;
  document_type: DocumentType;
  /** Últimos 4 caracteres del documento; el número completo nunca se guarda. */
  document_last4: string;
}

export const USER_EXAMPLE: UserResponse = {
  id: 'usr_01JC0000000000000000000001',
  email: 'demo@milainvest.app',
  full_name: 'Usuario Demo',
  country: 'CO',
  base_currency: 'COP',
  document_type: 'CC',
  document_last4: '4050',
};

export const userResponse: Joi.ObjectSchema<UserResponse> = Joi.object<UserResponse>({
  id: prefixedId('user').required().example('usr_01JC0000000000000000000001'),
  email: Joi.string().email().required().example('demo@milainvest.app'),
  full_name: Joi.string().required().example('Usuario Demo'),
  country: country().required(),
  base_currency: userCurrency().required(),
  document_type: Joi.string()
    .valid(...DOCUMENT_TYPES)
    .required()
    .example('CC'),
  document_last4: Joi.string().min(1).max(4).required().example('4050'),
}).example(USER_EXAMPLE);
