import { toIsoUtc } from '../../core/clock.js';
import { formatAmount } from '../../core/money.js';
import { buildPage, decodeCursor, type Page } from '../../core/pagination.js';
import type { Db } from '../../db/client.js';
import type { TransactionsRepository } from './repository.js';
import type { ListTransactionsQuery, TransactionResponse } from './schemas.js';
import type { TransactionRow } from './table.js';

export function toTransactionResponse(row: TransactionRow): TransactionResponse {
  return {
    id: row.id,
    type: row.type,
    amount: formatAmount(row.amount, row.currency),
    currency: row.currency,
    description: row.description,
    order_id: row.orderId,
    created_at: toIsoUtc(row.createdAt),
  };
}

export class TransactionsService {
  public constructor(
    private readonly db: Db,
    private readonly transactions: TransactionsRepository,
  ) {}

  public async list(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<Page<TransactionResponse>> {
    const rows = await this.transactions.listByUser(
      this.db,
      userId,
      {
        type: query.type,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
        cursor: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
      },
      query.limit + 1,
    );
    return buildPage(rows, query.limit, toTransactionResponse, (row) => ({
      createdAt: row.createdAt,
      id: row.id,
    }));
  }

  /** Últimos movimientos, para el resumen del dashboard. */
  public async recent(userId: string, count: number): Promise<TransactionResponse[]> {
    const rows = await this.transactions.listByUser(this.db, userId, {}, count);
    return rows.map(toTransactionResponse);
  }
}
