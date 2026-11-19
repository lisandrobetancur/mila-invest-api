import { defineConfig } from 'drizzle-kit';

// Este archivo es herramienta de build (drizzle-kit), no código de src/:
// es el único lugar fuera de src/core/config.ts que lee process.env.
const url = process.env.DATABASE_URL ?? 'postgres://mila:mila@localhost:5432/mila';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
