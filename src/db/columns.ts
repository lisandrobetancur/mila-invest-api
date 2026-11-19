/**
 * Columnas reutilizadas por las tablas de todos los módulos (§6).
 *
 * - montos `NUMERIC(20, 4)`, precios `NUMERIC(20, 6)`, porcentajes
 *   `NUMERIC(10, 4)`: drizzle los entrega como string, nunca como `number`;
 * - cantidades de acciones `BIGINT` en modo `number` (no superan 1.000.000);
 * - fechas `timestamptz(3)`: precisión de milisegundos, la misma del cursor.
 */
import { bigint, numeric, timestamp } from 'drizzle-orm/pg-core';

export const amount = (name: string) => numeric(name, { precision: 20, scale: 4 });
export const price = (name: string) => numeric(name, { precision: 20, scale: 6 });
export const percent = (name: string) => numeric(name, { precision: 10, scale: 4 });
export const shares = (name: string) => bigint(name, { mode: 'number' });
export const instant = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });
