import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Currency, UserCurrency } from '../../core/domain.js';
import type { DecimalString } from '../../core/money.js';
import type { DbExecutor } from '../../db/client.js';
import {
  accounts,
  ledgerEntries,
  ledgerJournals,
  type AccountRow,
  type JournalKind,
  type NewAccountRow,
  type NewLedgerEntryRow,
} from './table.js';

export const SYSTEM_ACCOUNT_KINDS = ['deposits', 'fees', 'market'] as const;
export type SystemAccountKind = (typeof SYSTEM_ACCOUNT_KINDS)[number];

/** `system:deposits:COP`, `system:fees:COP`, `system:market:COP`. */
export function systemAccountCode(kind: SystemAccountKind, currency: Currency): string {
  return `system:${kind}:${currency}`;
}

export interface AccountBalanceCheck {
  accountId: string;
  cached: DecimalString;
  ledger: DecimalString;
}

export class AccountsRepository {
  public async insertMany(executor: DbExecutor, rows: NewAccountRow[]): Promise<void> {
    if (rows.length === 0) return;
    await executor.insert(accounts).values(rows);
  }

  public async listByUser(executor: DbExecutor, userId: string): Promise<AccountRow[]> {
    return executor
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .orderBy(asc(accounts.currency));
  }

  /** Bloquea la fila de la cuenta (`FOR UPDATE`) hasta el fin de la transacción. */
  public async findUserAccountForUpdate(
    executor: DbExecutor,
    userId: string,
    currency: UserCurrency,
  ): Promise<AccountRow | undefined> {
    const [row] = await executor
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.currency, currency)))
      .limit(1)
      .for('update');
    return row;
  }

  public async findUserAccount(
    executor: DbExecutor,
    userId: string,
    currency: UserCurrency,
  ): Promise<AccountRow | undefined> {
    const [row] = await executor
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.currency, currency)))
      .limit(1);
    return row;
  }

  public async findSystemAccount(
    executor: DbExecutor,
    kind: SystemAccountKind,
    currency: Currency,
  ): Promise<AccountRow | undefined> {
    const [row] = await executor
      .select()
      .from(accounts)
      .where(eq(accounts.systemCode, systemAccountCode(kind, currency)))
      .limit(1);
    return row;
  }

  /** Suma `delta` (con signo) al saldo disponible cacheado. */
  public async addToAvailable(
    executor: DbExecutor,
    accountId: string,
    delta: DecimalString,
    now: Date,
  ): Promise<void> {
    await executor
      .update(accounts)
      .set({ available: sql`${accounts.available} + ${delta}::numeric`, updatedAt: now })
      .where(eq(accounts.id, accountId));
  }

  public async insertJournal(
    executor: DbExecutor,
    journal: { id: string; kind: JournalKind; description: string; createdAt: Date },
  ): Promise<void> {
    await executor.insert(ledgerJournals).values(journal);
  }

  public async insertEntries(executor: DbExecutor, entries: NewLedgerEntryRow[]): Promise<void> {
    await executor.insert(ledgerEntries).values(entries);
  }

  /** Total depositado en una cuenta: suma de sus entradas en journals `DEPOSIT`. */
  public async totalDeposited(executor: DbExecutor, accountId: string): Promise<DecimalString> {
    const [row] = await executor
      .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amount}), 0)::text` })
      .from(ledgerEntries)
      .innerJoin(ledgerJournals, eq(ledgerJournals.id, ledgerEntries.journalId))
      .where(and(eq(ledgerEntries.accountId, accountId), eq(ledgerJournals.kind, 'DEPOSIT')));
    return row?.total ?? '0';
  }

  // ---------- verificación de invariantes (tests y `_testing`) ----------

  /** Por cada cuenta: saldo cacheado (`available + reserved`) y suma de sus entradas. */
  public async balanceChecks(executor: DbExecutor): Promise<AccountBalanceCheck[]> {
    const rows = await executor
      .select({
        accountId: accounts.id,
        cached: sql<string>`(${accounts.available} + ${accounts.reserved})::text`,
        ledger: sql<string>`COALESCE(SUM(${ledgerEntries.amount}), 0)::text`,
      })
      .from(accounts)
      .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, accounts.id))
      .groupBy(accounts.id);
    return rows;
  }

  /** Journals cuyas entradas no suman cero en alguna moneda. Debe devolver vacío. */
  public async unbalancedJournals(
    executor: DbExecutor,
  ): Promise<{ journalId: string; currency: Currency; total: DecimalString }[]> {
    return executor
      .select({
        journalId: ledgerEntries.journalId,
        currency: ledgerEntries.currency,
        total: sql<string>`SUM(${ledgerEntries.amount})::text`,
      })
      .from(ledgerEntries)
      .groupBy(ledgerEntries.journalId, ledgerEntries.currency)
      .having(sql`SUM(${ledgerEntries.amount}) <> 0`);
  }

  public async listSystemAccounts(executor: DbExecutor): Promise<AccountRow[]> {
    return executor.select().from(accounts).where(isNotNull(accounts.systemCode));
  }

  public async findByIds(executor: DbExecutor, ids: string[]): Promise<AccountRow[]> {
    if (ids.length === 0) return [];
    return executor.select().from(accounts).where(inArray(accounts.id, ids));
  }
}
