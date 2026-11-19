/**
 * Invariantes del ledger (§6), verificadas después de cada test de integración
 * que mueve dinero:
 *
 * - para toda cuenta, `available + reserved == SUM(ledger_entries.amount)`;
 * - las entradas de cada journal suman cero por moneda.
 */
import { expect } from 'vitest';
import { Decimal } from '../../src/core/money.js';
import type { Db } from '../../src/db/client.js';
import { AccountsRepository } from '../../src/modules/accounts/repository.js';

const repository = new AccountsRepository();

export async function expectLedgerBalanced(db: Db): Promise<void> {
  const checks = await repository.balanceChecks(db);
  const mismatched = checks.filter((check) => !new Decimal(check.cached).equals(check.ledger));
  expect(mismatched, 'cuentas cuyo saldo cacheado no coincide con el ledger').toEqual([]);

  const unbalanced = await repository.unbalancedJournals(db);
  expect(unbalanced, 'journals que no suman cero').toEqual([]);
}
