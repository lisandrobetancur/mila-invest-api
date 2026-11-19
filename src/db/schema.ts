/** Re-exporta las tablas de cada módulo: es el schema que usan drizzle y drizzle-kit. */
export { users } from '../modules/users/table.js';
export { refreshTokens } from '../modules/auth/table.js';
export { accounts, ledgerEntries, ledgerJournals } from '../modules/accounts/table.js';
export { instruments } from '../modules/market/table.js';
export { orders } from '../modules/orders/table.js';
export { positions } from '../modules/portfolio/table.js';
export { transactions } from '../modules/transactions/table.js';
export { idempotencyRecords } from './idempotency-table.js';
