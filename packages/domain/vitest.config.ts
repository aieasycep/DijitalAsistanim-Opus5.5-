import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // TEST_PLAN §16 / T-12.04: `pnpm test` enforces 95% lines and functions, 90% branches.
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 95, branches: 90, functions: 95 },
    },
  },
});
