import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: ['tests/helpers/global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/db/migrate.ts', 'src/main.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 85,
        branches: 85,
      },
    },
  },
});
