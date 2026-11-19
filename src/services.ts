/**
 * Contenedor de servicios. `createServices` construye una sola vez los
 * repositorios y services y los conecta entre sí; **solo lo llama `buildApp`**,
 * que es la raíz de composición (regla 5 de §4). El resto del código los usa
 * desde `app.services`.
 */
import type { Clock } from './core/clock.js';
import { isTestingEnabled, type Config } from './core/config.js';
import { IdGenerator } from './core/ids.js';
import { IdempotencyService } from './core/idempotency.js';
import type { AppLogger } from './core/logger.js';
import { Security } from './core/security.js';
import type { Db } from './db/client.js';
import { HealthService } from './db/health.js';
import { Ledger } from './modules/accounts/ledger.js';
import { AccountsRepository } from './modules/accounts/repository.js';
import { AccountsService } from './modules/accounts/service.js';
import { RefreshTokensRepository } from './modules/auth/repository.js';
import { AuthService } from './modules/auth/service.js';
import { DashboardService } from './modules/dashboard/service.js';
import { PriceEngine } from './modules/market/engine.js';
import { InstrumentsRepository } from './modules/market/repository.js';
import { MarketService } from './modules/market/service.js';
import { MetaService } from './modules/meta/service.js';
import { OrdersRepository } from './modules/orders/repository.js';
import { OrdersService } from './modules/orders/service.js';
import { PositionsRepository } from './modules/portfolio/repository.js';
import { PortfolioService } from './modules/portfolio/service.js';
import { TestingService } from './modules/testing/service.js';
import { TransactionsRepository } from './modules/transactions/repository.js';
import { TransactionsService } from './modules/transactions/service.js';
import { UsersRepository } from './modules/users/repository.js';
import { UsersService } from './modules/users/service.js';

export interface AppDeps {
  config: Config;
  clock: Clock;
  db: Db;
  logger: AppLogger;
}

export interface Services {
  config: Config;
  clock: Clock;
  ids: IdGenerator;
  security: Security;
  health: HealthService;
  meta: MetaService;
  users: UsersService;
  auth: AuthService;
  accounts: AccountsService;
  market: MarketService;
  orders: OrdersService;
  portfolio: PortfolioService;
  transactions: TransactionsService;
  dashboard: DashboardService;
  /** `null` fuera de `dev` y `test`: en `prod` los endpoints `_testing` no existen. */
  testing: TestingService | null;
}

export function createServices({ config, clock, db }: AppDeps): Services {
  const ids = new IdGenerator(clock);
  const security = new Security(config, clock);
  const idempotency = new IdempotencyService(clock, ids);

  const usersRepository = new UsersRepository();
  const refreshTokensRepository = new RefreshTokensRepository();
  const accountsRepository = new AccountsRepository();
  const instrumentsRepository = new InstrumentsRepository();
  const ordersRepository = new OrdersRepository();
  const positionsRepository = new PositionsRepository();
  const transactionsRepository = new TransactionsRepository();

  const meta = new MetaService(clock, config);
  const ledger = new Ledger(clock, ids, accountsRepository);
  const engine = new PriceEngine(config.priceSeed, (country) => meta.calendar(country));

  const users = new UsersService(db, usersRepository);
  const accounts = new AccountsService(
    db,
    clock,
    ids,
    idempotency,
    meta,
    ledger,
    accountsRepository,
    transactionsRepository,
  );
  const auth = new AuthService(
    db,
    clock,
    ids,
    security,
    config,
    meta,
    usersRepository,
    refreshTokensRepository,
    accounts,
  );
  const market = new MarketService(db, clock, engine, instrumentsRepository);
  const orders = new OrdersService(
    db,
    clock,
    ids,
    idempotency,
    meta,
    market,
    ledger,
    ordersRepository,
    accountsRepository,
    positionsRepository,
    transactionsRepository,
  );
  const portfolio = new PortfolioService(
    db,
    clock,
    meta,
    market,
    accountsRepository,
    positionsRepository,
  );
  const transactions = new TransactionsService(db, transactionsRepository);
  const dashboard = new DashboardService(portfolio, market, transactions);

  const testing = isTestingEnabled(config)
    ? new TestingService({
        db,
        clock,
        ids,
        security,
        meta,
        market,
        auth,
        ledger,
        accounts: accountsRepository,
        orders: ordersRepository,
        positions: positionsRepository,
        transactions: transactionsRepository,
      })
    : null;

  return {
    config,
    clock,
    ids,
    security,
    health: new HealthService(db),
    meta,
    users,
    auth,
    accounts,
    market,
    orders,
    portfolio,
    transactions,
    dashboard,
    testing,
  };
}
