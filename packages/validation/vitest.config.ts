import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // TEST_PLAN §16 / T-12.04: `pnpm test` enforces the line and function targets (95%).
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 95, functions: 95 },
    },
  },
});
