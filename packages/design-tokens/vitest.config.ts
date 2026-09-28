import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // TEST_PLAN §16 / T-12.04: `pnpm test` enforces 100% lines and functions, 95% branches.
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 100, branches: 95, functions: 100 },
    },
  },
});
