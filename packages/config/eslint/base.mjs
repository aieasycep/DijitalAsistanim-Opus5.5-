import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { daPlugin } from './plugin.mjs';

export const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.expo/**',
  '**/coverage/**',
  '**/generated/**',
  '**/*.d.ts',
];

/**
 * Base flat config: typescript-eslint strict type-checked rules for TS files, JS recommended for
 * config files. `tsconfigRootDir` must be the consuming package directory.
 */
export function base({ tsconfigRootDir } = {}) {
  return tseslint.config(
    { ignores: IGNORES },
    js.configs.recommended,
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      plugins: { da: daPlugin },
      rules: {
        '@typescript-eslint/no-floating-promises': [
          'error',
          {
            allowForKnownSafeCalls: [
              { from: 'package', name: ['test', 'it', 'describe', 'suite'], package: 'node:test' },
            ],
          },
        ],
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-unnecessary-condition': [
          'error',
          { allowConstantLoopConditions: true },
        ],
        'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
        eqeqeq: ['error', 'always'],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: { globals: { ...globals.node } },
    },
  );
}

export default base;
