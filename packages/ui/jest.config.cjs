/**
 * Jest for the React Native UI kit: the React Native preset, with transforms extended to the
 * pnpm virtual store (`node_modules/.pnpm/…`) and the untranspiled React Native libraries
 * (react-native-svg, -reanimated, -worklets, -gesture-handler, -safe-area-context).
 * gesture-handler's own mocks replace its native module; `test/setup.ts` installs Reanimated's
 * Jest matchers (`toHaveAnimatedStyle`).
 */
module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
  // Worklets' resolver skips its `.native` sources so the JS (Jest) runtime is used.
  resolver: require.resolve('react-native-worklets/jest/resolver.js'),
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  // Sheet / BottomSheet tests run Reanimated layout and focus timers; under a parallel
  // `turbo run test` (mobile, web and backoffice suites with coverage) they exceed Jest's 5 s default.
  testTimeout: 30_000,
  // TEST_PLAN §16 / T-12.04: `pnpm test` runs with coverage and enforces 85% lines and functions,
  // 75% branches. The icon glyphs under `src/icons/generated/` are emitted by
  // `scripts/gen-icons.ts` (Material Symbols paths) and excluded.
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx}', '!<rootDir>/src/icons/generated/**'],
  coverageReporters: ['text-summary'],
  coverageThreshold: { global: { lines: 85, branches: 75, functions: 85 } },
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|react-native-(svg|reanimated|worklets|gesture-handler|safe-area-context)|@formatjs|@date-fns|date-fns)/)',
  ],
};
