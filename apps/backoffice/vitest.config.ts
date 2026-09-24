import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * Unit and component tests (BACKOFFICE_PLAN §13.1). Server utilities run in Node; component tests
 * opt into jsdom with a `@vitest-environment jsdom` docblock and are checked with axe-core.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/server-only.ts', import.meta.url)),
    },
  },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
    // jsdom + Radix component tests render slowly while turbo runs lint, typecheck and other test
    // suites in parallel; 5 s (the default) is too tight for a full dialog flow on a loaded runner.
    testTimeout: 20_000,
    coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'] },
  },
});
