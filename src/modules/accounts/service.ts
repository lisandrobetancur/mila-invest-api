import type { Clock } from '../../core/clock.js';
import { USER_CURRENCIES, type UserCurrency } from '../../core/domain.js';
import { AppError, validationError } from '../../core/errors.js';
import type { IdGenerator } from '../../core/ids.js';
import type { IdempotencyService, IdempotentResult } from '../../core/idempotency.js';
import {
  AMOUNT_DECIMALS,
  formatAmount,
  toDecimal,
  type Decimal,
  type DecimalString,
} from '../../core/money.js';
import type { Db, DbExecutor } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import type { MetaService } from '../meta/service.js';
import type { TransactionsRepository } from '../transactions/repository.js';
import type { TransactionResponse } from '../transactions/schemas.js';
import { toTransactionResponse } from '../transactions/service.js';
import type { Ledger } from './ledger.js';
import type { AccountsRepository } from './repository.js';
import type { AccountResponse } from './schemas.js';
import type { AccountRow } from './table.js';

export function toAccountResponse(row: AccountRow): AccountResponse {
  // Las cuentas de usuario solo existen en COP, MXN y PEN (fase 1).
  const currency = row.currency as UserCurrency;
  return {
    id: row.id,
    currency,
    available: formatAmount(row.available, currency),
    reserved: formatAmount(row.reserved, currency),
  };
}

export interface DepositInput {
  userId: string;
  currency: UserCurrency;
  amount: DecimalString;
  idempotencyKey: string;
}

export class AccountsService {
  public constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly idempotency: IdempotencyService,
    private readonly meta: MetaService,
    private readonly ledger: Ledger,
    private readonly accounts: AccountsRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  public async list(userId: string): Promise<AccountResponse[]> {
    const rows = await this.accounts.listByUser(this.db, userId);
    return rows.map(toAccountResponse);
  }

  /** Crea las tres cuentas (COP, MXN, PEN) en cero de un usuario recién registrado. */
  public async createUserAccounts(executor: DbExecutor, userId: string): Promise<void> {
    const now = this.clock.now();
    await this.accounts.insertMany(
      executor,
      USER_CURRENCIES.map((currency) => ({
        id: this.ids.next('account'),
        userId,
        currency,
        available: '0',
        reserved: '0',
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  /**
   * Depósito virtual (§8.3): journal `system:deposits → usuario` + transacción
   * `DEPOSIT`, todo en una transacción junto con el registro de idempotencia.
   */
  public async deposit(input: DepositInput): Promise<IdempotentResult<TransactionResponse>> {
    const amount = this.validateDepositAmount(input.currency, input.amount);
    const requestHash = this.idempotency.hashRequest(`POST /accounts/${input.currency}/deposits`, {
      amount: formatAmount(amount, input.currency),
    });

    return withTransaction(this.db, (tx) =>
      this.idempotency.run(
        tx,
        { userId: input.userId, key: input.idempotencyKey, requestHash },
        async () => {
          const account = await this.accounts.findUserAccountForUpdate(
            tx,
            input.userId,
            input.currency,
          );
          const system = await this.accounts.findSystemAccount(tx, 'deposits', input.currency);
          if (account === undefined || system === undefined) {
            throw new AppError('INTERNAL_ERROR', {
              detail: `Falta la cuenta ${input.currency} del usuario o la de sistema`,
            });
          }

          const limits = this.meta.depositLimit(input.currency);
          const deposited = toDecimal(await this.accounts.totalDeposited(tx, account.id));
          if (deposited.plus(amount).greaterThan(limits.accumulated)) {
            throw validationError(
              [{ field: 'amount', code: 'TOO_LARGE' }],
              `El acumulado de depósitos supera el máximo de ${formatAmount(limits.accumulated, input.currency)} ${input.currency}`,
            );
          }

          const journalId = await this.ledger.post(tx, {
            kind: 'DEPOSIT',
            description: `Depósito virtual ${input.currency}`,
            entries: [
              { accountId: system.id, amount: amount.negated(), currency: input.currency },
              { accountId: account.id, amount, currency: input.currency },
            ],
          });

          const row = await this.transactions.insert(tx, {
            id: this.ids.next('transaction'),
            userId: input.userId,
            type: 'DEPOSIT',
            amount: formatAmount(amount, input.currency),
            currency: input.currency,
            description: 'Depósito virtual',
            orderId: null,
            journalId,
            createdAt: this.clock.now(),
          });
          return { statusCode: 201, body: toTransactionResponse(row) };
        },
      ),
    );
  }

  /**
   * Reglas que dependen de la moneda del path, por eso viven acá y no en el
   * schema: decimales de la moneda y máximo por depósito.
   */
  private validateDepositAmount(currency: UserCurrency, raw: DecimalString): Decimal {
    const amount = toDecimal(raw);
    if (amount.decimalPlaces() > AMOUNT_DECIMALS[currency]) {
      throw validationError(
        [{ field: 'amount', code: 'INVALID_FORMAT' }],
        `Los montos en ${currency} admiten hasta ${AMOUNT_DECIMALS[currency]} decimales`,
      );
    }
    const limits = this.meta.depositLimit(currency);
    if (amount.greaterThan(limits.perDeposit)) {
      throw validationError(
        [{ field: 'amount', code: 'TOO_LARGE' }],
        `El máximo por depósito es ${formatAmount(limits.perDeposit, currency)} ${currency}`,
      );
    }
    return amount;
  }
}
