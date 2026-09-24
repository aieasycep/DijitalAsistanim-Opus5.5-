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
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|react-native-(svg|reanimated|worklets|gesture-handler|safe-area-context)|@formatjs|@date-fns|date-fns)/)',
  ],
};
