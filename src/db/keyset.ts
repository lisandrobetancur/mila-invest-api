import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { CursorPayload } from '../core/pagination.js';

/**
 * Condición de paginación por cursor para el orden `created_at DESC, id DESC`:
 * devuelve las filas estrictamente posteriores al cursor en ese orden.
 */
export function keysetAfter(createdAt: AnyColumn, id: AnyColumn, cursor: CursorPayload): SQL {
  return sql`(${createdAt}, ${id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`;
}
