import type { UserCurrency } from '../../core/domain.js';
import { toInstrumentResponse, type MarketService } from '../market/service.js';
import type { PortfolioService } from '../portfolio/service.js';
import type { TransactionsService } from '../transactions/service.js';
import {
  RECENT_TRANSACTIONS_COUNT,
  TOP_MOVERS_COUNT,
  type DashboardSummaryResponse,
  type TopMoversResponse,
} from './schemas.js';

export class DashboardService {
  public constructor(
    private readonly portfolio: PortfolioService,
    private readonly market: MarketService,
    private readonly transactions: TransactionsService,
  ) {}

  public async summary(
    userId: string,
    baseCurrency: UserCurrency,
  ): Promise<DashboardSummaryResponse> {
    const [portfolioSummary, topMovers, recentTransactions] = await Promise.all([
      this.portfolio.summary(userId, baseCurrency),
      this.topMovers(),
      this.transactions.recent(userId, RECENT_TRANSACTIONS_COUNT),
    ]);
    return {
      portfolio_summary: portfolioSummary,
      top_movers: topMovers,
      recent_transactions: recentTransactions,
    };
  }

  /** Los que más suben y los que más bajan contra el cierre anterior; el id desempata. */
  public async topMovers(): Promise<TopMoversResponse> {
    const all = await this.market.allWithSnapshots();
    const byChange = [...all].sort((left, right) => {
      const diff = right.snapshot.changePct.comparedTo(left.snapshot.changePct);
      if (diff !== 0) return diff;
      return left.row.id < right.row.id ? -1 : 1;
    });

    const gainers = byChange
      .filter(
        (entry) => entry.snapshot.changePct.isPositive() && !entry.snapshot.changePct.isZero(),
      )
      .slice(0, TOP_MOVERS_COUNT);
    const losers = byChange
      .filter(
        (entry) => entry.snapshot.changePct.isNegative() && !entry.snapshot.changePct.isZero(),
      )
      .reverse()
      .slice(0, TOP_MOVERS_COUNT);

    return {
      gainers: gainers.map((entry) => toInstrumentResponse(entry.row, entry.snapshot)),
      losers: losers.map((entry) => toInstrumentResponse(entry.row, entry.snapshot)),
    };
  }
}
