/**
 * Jest (jest-expo preset, ADR-15). pnpm keeps packages under `node_modules/.pnpm/<id>/node_modules/`,
 * so the ignore pattern lets `.pnpm` through and then re-checks the real package name: React
 * Native, Expo and the ESM-only i18n runtime (use-intl and its formatjs dependencies) are
 * transformed, everything else is not. Workspace packages resolve to `packages/*` (outside
 * node_modules) and are always transformed.
 *
 * Expo inlines `EXPO_PUBLIC_*` reads at transform time, so the test run gets a fixed, valid
 * client environment (a `.test` project URL and a publishable-shaped key; never a real credential).
 */
const TEST_ENV = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.test',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_jest0000',
  EXPO_PUBLIC_APP_ENV: 'development',
};
for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;

const TRANSFORM = [
  '\\.pnpm',
  '(jest-)?react-native',
  '@react-native(-community)?',
  '@react-native-google-signin/.*',
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
  resolver: '<rootDir>/test/resolver.js',
  setupFiles: ['<rootDir>/test/setup/native-mocks.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup/after-env.ts'],
  transformIgnorePatterns: [`node_modules/(?!(${TRANSFORM.join('|')})/)`],
  // The app tests mount the real router and provider stack; a worker's first render (module
  // graph, fonts, i18n catalogs) can take several seconds when turbo runs lint and typecheck
  // alongside, well past Jest's 5 s default.
  testTimeout: 60_000,
};
