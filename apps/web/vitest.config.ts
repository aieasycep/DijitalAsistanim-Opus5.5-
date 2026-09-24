import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit and component tests (TEST_PLAN §11): pure modules run in Node, components in happy-dom
 * (`// @vitest-environment happy-dom` per file). `server-only` resolves to an empty module so
 * server helpers can be tested directly; nothing here talks to the network.
 */
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL('./src/$1', import.meta.url)) },
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
  },
});
