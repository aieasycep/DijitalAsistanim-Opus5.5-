import { reactNative } from '@da/config/eslint/react-native.mjs';

export default [
  ...reactNative({ tsconfigRootDir: import.meta.dirname }),
  {
    // Test fixtures and helpers live beside the *.test.tsx files: the same exemptions apply
    // (sample copy and colours are test data, not product UI).
    files: ['test/**/*.{ts,tsx}'],
    rules: { 'react/jsx-no-literals': 'off', 'da/no-raw-color': 'off' },
  },
];
