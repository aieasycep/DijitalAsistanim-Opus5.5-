/**
 * Jest (jest-expo preset, ADR-15). pnpm keeps packages under `node_modules/.pnpm/<id>/node_modules/`,
 * so the ignore pattern lets `.pnpm` through and then re-checks the real package name: React
 * Native, Expo and the ESM-only i18n runtime (use-intl and its formatjs dependencies) are
 * transformed, everything else is not. Workspace packages resolve to `packages/*` (outside
 * node_modules) and are always transformed.
 */
const TRANSFORM = [
  '\\.pnpm',
  '(jest-)?react-native',
  '@react-native(-community)?',
  'expo(nent)?',
  '@expo(nent)?/.*',
  '@expo-google-fonts/.*',
  'expo-.*',
  'react-native-.*',
  '@react-navigation/.*',
  'standard-navigation',
  '@sentry/react-native',
  'use-intl',
  'intl-messageformat',
  'icu-minify',
  '@formatjs/.*',
  '@schummar/.*',
];

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [`node_modules/(?!(${TRANSFORM.join('|')})/)`],
};
