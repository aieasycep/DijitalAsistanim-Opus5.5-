import { base } from '@da/config/eslint/base.mjs';

/** Root config: lints repository scripts only; every workspace has its own eslint.config.mjs. */
export default [
  {
    ignores: [
      'apps/**',
      'packages/**',
      'supabase/**',
      'docs/**',
      'design/**',
      '.claude/**',
      // Deliberately bad snippets, one finding each (`run.ts --self-test`).
      'scripts/quality-gate/fixtures/**',
    ],
  },
  ...base({ tsconfigRootDir: import.meta.dirname }),
];
