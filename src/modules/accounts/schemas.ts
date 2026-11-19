import Joi from 'joi';
import type { UserCurrency } from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';
import {
  decimalString,
  positiveDecimalString,
  prefixedId,
  userCurrency,
} from '../../http/schemas/common.js';

export interface AccountResponse {
  id: string;
  currency: UserCurrency;
  available: DecimalString;
  /** Fondos retenidos por órdenes pendientes (fase 2); en la fase 1 siempre `"0.00"`. */
  reserved: DecimalString;
}

export interface DepositParams {
  currency: UserCurrency;
}

export interface DepositBody {
  amount: DecimalString;
}

export const accountResponse: Joi.ObjectSchema<AccountResponse> = Joi.object<AccountResponse>({
  id: prefixedId('account').required().example('acc_01JC0000000000000000000101'),
  currency: userCurrency().required(),
  available: decimalString().required().example('50000000.00'),
  reserved: decimalString().required().example('0.00'),
});

export const accountsResponse: Joi.ArraySchema<AccountResponse[]> = Joi.array<AccountResponse[]>()
  .items(accountResponse)
  .example([
    {
      id: 'acc_01JC0000000000000000000101',
      currency: 'COP',
      available: '50000000.00',
      reserved: '0.00',
    },
  ]);

export const depositParams: Joi.ObjectSchema<DepositParams> = Joi.object<DepositParams>({
  currency: userCurrency().required(),
});

export const depositBody: Joi.ObjectSchema<DepositBody> = Joi.object<DepositBody>({
  amount: positiveDecimalString()
    .required()
    .description('Monto a depositar, como string decimal mayor que 0')
    .example('1000000.00'),
});
