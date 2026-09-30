import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The catalog checks parse every tr/en message; under v8 coverage and a parallel turbo run
    // they exceed vitest's 5 s default.
    testTimeout: 20_000,
    // TEST_PLAN §16: `pnpm test` enforces 95% lines and functions, 90% branches.
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 95, branches: 90, functions: 95 },
    },
  },
});
