import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { base } from './base.mjs';

/**
 * React Native (apps/mobile, packages/ui). Adds hooks rules, i18n literal ban for product UI,
 * no-op handler ban, raw colour ban, and storage restrictions (tokens never in AsyncStorage).
 */
export function reactNative({
  tsconfigRootDir,
  persisterModule = 'src/lib/query/persister.ts',
} = {}) {
  return [
    ...base({ tsconfigRootDir }),
    {
      files: ['**/*.{ts,tsx}'],
      plugins: { react, 'react-hooks': reactHooks },
      languageOptions: { globals: { ...globals.es2022 } },
      settings: { react: { version: '19.2' } },
      rules: {
        ...reactHooks.configs.recommended.rules,
        'react/jsx-key': 'error',
        'react/no-array-index-key': 'warn',
        'react/jsx-no-useless-fragment': 'error',
        'react/jsx-no-literals': [
          'error',
          {
            noStrings: true,
            ignoreProps: true,
            allowedStrings: ['·', '•', '—', '–', '/', ':', '%', '+', '×'],
          },
        ],
        'da/no-empty-handler': 'error',
        'da/no-raw-color': 'error',
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@react-native-async-storage/async-storage',
                message: `AsyncStorage is allowed only inside ${persisterModule}; secrets go to expo-secure-store.`,
              },
            ],
          },
        ],
      },
    },
    {
      files: [persisterModule],
      rules: { 'no-restricted-imports': 'off' },
    },
    {
      files: ['**/*.test.{ts,tsx}', '**/__tests__/**', 'jest.setup.ts', 'scripts/**'],
      rules: { 'react/jsx-no-literals': 'off', 'da/no-raw-color': 'off' },
    },
  ];
}

export default reactNative;
