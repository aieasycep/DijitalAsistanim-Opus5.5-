/**
 * Jest for the React Native UI kit: the React Native preset, with transforms extended to the
 * pnpm virtual store (`node_modules/.pnpm/…`) and react-native-svg, which ship untranspiled
 * sources.
 */
module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|react-native-svg)/)',
  ],
};
