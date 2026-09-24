import { reactNative } from '@da/config/eslint/react-native.mjs';

export default [
  { ignores: ['ios/**', 'android/**', '.expo/**', '.expo-export/**', 'expo-env.d.ts'] },
  ...reactNative({ tsconfigRootDir: import.meta.dirname }),
  {
    // Official Google and Microsoft sign-in marks: vendor brand colours may not be re-themed.
    files: ['src/features/auth/ProviderLogos.tsx'],
    rules: { 'da/no-raw-color': 'off' },
  },
];
