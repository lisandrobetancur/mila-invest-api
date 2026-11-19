/**
 * Ledger de doble partida (§6).
 *
 * Cada movimiento es un *journal* cuyas entradas **suman cero** por moneda. El
 * saldo cacheado de cada cuenta se actualiza en la misma transacción que las
 * entradas, así que siempre vale
 * `available + reserved == SUM(ledger_entries.amount)`.
 */
import type { Clock } from '../../core/clock.js';
import type { Currency } from '../../core/domain.js';
import { AppError } from '../../core/errors.js';
import type { IdGenerator } from '../../core/ids.js';
import { ZERO, formatAmount, quantizeAmount, type Decimal } from '../../core/money.js';
import type { Tx } from '../../db/client.js';
import type { AccountsRepository } from './repository.js';
import type { JournalKind } from './table.js';

export interface JournalEntryInput {
  accountId: string;
  /** Positivo = crédito a la cuenta; negativo = débito. */
  amount: Decimal;
  currency: Currency;
}

export interface JournalInput {
  kind: JournalKind;
  description: string;
  entries: readonly JournalEntryInput[];
}

/** Lanza `INTERNAL_ERROR` si las entradas no suman cero en alguna moneda. */
export function assertBalanced(entries: readonly JournalEntryInput[]): void {
  const totals = new Map<Currency, Decimal>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? ZERO).plus(entry.amount));
  }
  for (const [currency, total] of totals) {
    if (!total.isZero()) {
      throw new AppError('INTERNAL_ERROR', {
        detail: `El journal no cuadra: las entradas en ${currency} suman ${total.toFixed()}`,
      });
    }
  }
}

export class Ledger {
  public constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly accounts: AccountsRepository,
  ) {}

  /**
   * Registra un journal dentro de la transacción `tx` y actualiza los saldos
   * cacheados. Las cuentas se actualizan por `id` ascendente: es el orden fijo
   * de bloqueo que evita deadlocks entre movimientos concurrentes.
   */
  public async post(tx: Tx, journal: JournalInput): Promise<string> {
    // Se cuantiza antes de verificar: lo que tiene que sumar cero es lo que se persiste.
    const entries = journal.entries
      .map((entry) => ({ ...entry, amount: quantizeAmount(entry.amount, entry.currency) }))
      .filter((entry) => !entry.amount.isZero());
    if (entries.length < 2) {
      throw new AppError('INTERNAL_ERROR', {
        detail: 'Un journal necesita al menos dos entradas distintas de cero',
      });
    }
    assertBalanced(entries);

    const now = this.clock.now();
    const journalId = this.ids.next('journal');
    await this.accounts.insertJournal(tx, {
      id: journalId,
      kind: journal.kind,
      description: journal.description,
      createdAt: now,
    });
    await this.accounts.insertEntries(
      tx,
      entries.map((entry) => ({
        id: this.ids.next('entry'),
        journalId,
        accountId: entry.accountId,
        amount: formatAmount(entry.amount, entry.currency),
        currency: entry.currency,
        createdAt: now,
      })),
    );

    const deltas = new Map<string, { amount: Decimal; currency: Currency }>();
    for (const entry of entries) {
      const current = deltas.get(entry.accountId);
      deltas.set(entry.accountId, {
        amount: (current?.amount ?? ZERO).plus(entry.amount),
        currency: entry.currency,
      });
    }
    const ordered = [...deltas.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const [accountId, delta] of ordered) {
      await this.accounts.addToAvailable(
        tx,
        accountId,
        formatAmount(delta.amount, delta.currency),
        now,
      );
    }
    return journalId;
  }
}
