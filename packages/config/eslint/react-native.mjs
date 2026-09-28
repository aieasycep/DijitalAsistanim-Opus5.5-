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
        // KNOWN_PLATFORM_LIMITATIONS KPL-27: Hermes lacks these; date-fns and @da/i18n cover them.
        'no-restricted-properties': [
          'error',
          ...['RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter'].map((property) => ({
            object: 'Intl',
            property,
            message: `Intl.${property} is missing on Hermes (KPL-27); use the @da/i18n / date-fns helpers.`,
          })),
        ],
        // KPL-28: Turkish casing (i → İ) and currency come from @da/i18n, never the runtime.
        'no-restricted-syntax': [
          'error',
          {
            selector: "Property[key.name='textTransform'][value.value='uppercase']",
            message:
              "textTransform: 'uppercase' maps i to I, not İ (KPL-28); use toUpper(text, locale) from @da/i18n.",
          },
          {
            selector:
              "CallExpression[callee.property.name='toUpperCase'], CallExpression[callee.property.name='toLocaleUpperCase'][arguments.length=0]",
            message:
              'Runtime uppercasing ignores Turkish casing (KPL-28); use toUpper(text, locale) from @da/i18n (identifiers: disable with a reason).',
          },
          {
            selector: 'Literal[value=/\\bTL\\b/], TemplateElement[value.raw=/\\bTL\\b/]',
            message:
              "Amounts are formatted by formatCurrency (@da/i18n), never with a 'TL' literal.",
          },
        ],
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
    {
      // Test code compares hex values and fixture amounts; the KPL-27/28 bans guard product code.
      files: ['**/*.test.{ts,tsx}', '**/__tests__/**', 'test/**', 'jest.setup.ts', 'scripts/**'],
      rules: { 'no-restricted-syntax': 'off', 'no-restricted-properties': 'off' },
    },
  ];
}

export default reactNative;
