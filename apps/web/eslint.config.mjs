import { next } from '@da/config/eslint/next.mjs';
import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      '.next/**',
      'next-env.d.ts',
      'src/components/icons/generated/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...next({
    tsconfigRootDir: import.meta.dirname,
    nextConfigs: nextVitals,
    // apps/web holds no Supabase client and no server secret. `src/server/**` (the preset's
    // exemption) does not exist here, so the Supabase import ban covers every file.
    serverOnlyDirs: ['src/server/**'],
  }),
  {
    // QG-15: every user-facing string comes from `@da/i18n` (`web.*`) or `src/content/**`.
    files: ['src/**/*.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: ['·', '•', '—', '–', '/', ':', '%', '+', '×', '…', '→', '↗', '©'],
        },
      ],
    },
  },
];

export default config;
