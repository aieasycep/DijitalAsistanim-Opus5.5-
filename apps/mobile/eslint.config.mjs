import { reactNative } from '@da/config/eslint/react-native.mjs';

export default [
  { ignores: ['ios/**', 'android/**', '.expo/**', '.expo-export/**', 'expo-env.d.ts'] },
  ...reactNative({ tsconfigRootDir: import.meta.dirname }),
];
