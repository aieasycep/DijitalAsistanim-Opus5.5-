/**
 * Babel is used only by Jest here; the mobile app's Metro build applies babel-preset-expo, which
 * adds the worklets plugin and the React Compiler itself. The tests run the same two transforms so
 * the kit is verified as the app compiles it (React Compiler on, SDK 57 default; ADR-03). For the
 * kit's own sources any compiler diagnostic is fatal (`panicThreshold: 'all_errors'`), so a
 * component that the compiler would silently skip fails the test run instead.
 */
const path = require('node:path');

const KIT_SOURCES = `${path.join(__dirname, 'src')}${path.sep}`;

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'babel-plugin-react-compiler',
      {
        target: '19',
        panicThreshold: 'all_errors',
        sources: (filename) => filename.startsWith(KIT_SOURCES),
      },
    ],
    'react-native-worklets/plugin',
  ],
};
