/**
 * Babel for Metro and Jest. `babel-preset-expo` resolves its optional plugins from the project
 * root, so under pnpm it still adds expo-router, the worklets plugin (react-native-worklets is a
 * direct dependency) and the React Compiler when `experiments.reactCompiler` is on.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
