// @ts-check
/**
 * Jest resolver: React Native's preset resolver, except that react-native-worklets resolves its JS
 * (Jest) runtime instead of the `.native` sources (the rule of `react-native-worklets/jest/
 * resolver.js`, used by `@da/ui`), because the kit's Reanimated 4 components render in these tests.
 * The match is on the package directory itself: pnpm store paths of other packages also contain
 * `react-native-worklets@<version>` as a peer suffix, and those must keep their native sources.
 */
const rnResolver = require('@react-native/jest-preset/jest/resolver.js');

const WORKLETS_DIR = /[\\/]node_modules[\\/]react-native-worklets[\\/]/;

/** @type {(request: string, options: any) => string} */
module.exports = (request, options) => {
  const worklets =
    WORKLETS_DIR.test(options.basedir) ||
    request === 'react-native-worklets' ||
    request.startsWith('react-native-worklets/');
  if (worklets) {
    return rnResolver(request, {
      ...options,
      extensions: options.extensions?.filter(
        (/** @type {string} */ ext) => !ext.includes('native'),
      ),
    });
  }
  return rnResolver(request, options);
};
