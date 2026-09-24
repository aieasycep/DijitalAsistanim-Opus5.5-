import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import { next } from '@da/config/eslint/next.mjs';

/**
 * Backoffice lint: the shared Next preset (typescript-eslint strict, `da/*` rules, Supabase client
 * only in server-only modules) plus a JSX literal ban so every user-facing string comes from
 * `@da/i18n` (`backoffice.*`).
 */
const config = [
  { ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
  ...next({
    tsconfigRootDir: import.meta.dirname,
    nextConfigs: nextCoreWebVitals,
    serverOnlyDirs: ['src/server/**', 'scripts/**', 'e2e/**'],
  }),
  {
    files: ['src/**/*.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: ['·', '•', '—', '–', '/', ':', '%', '+', '×', '…', '≈'],
        },
      ],
    },
  },
  {
    files: ['src/**/__tests__/**', '**/*.test.{ts,tsx}', 'e2e/**', 'scripts/**'],
    rules: { 'react/jsx-no-literals': 'off', 'da/no-raw-color': 'off' },
  },
  {
    // Test doubles: async `vi.fn` stubs, `expect(mock.method)` and asymmetric matchers.
    files: ['src/**/__tests__/**', '**/*.test.{ts,tsx}', 'vitest.setup.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
];

export default config;
