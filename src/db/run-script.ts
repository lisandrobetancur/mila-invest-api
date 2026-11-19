import { fileURLToPath } from 'node:url';

/** `true` si el módulo se ejecutó directamente (`tsx src/db/seed.ts`), no si fue importado. */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(moduleUrl) === entry;
}
