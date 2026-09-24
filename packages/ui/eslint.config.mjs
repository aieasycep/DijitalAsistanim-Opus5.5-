import { reactNative } from '@da/config/eslint/react-native.mjs';

export default [...reactNative({ tsconfigRootDir: import.meta.dirname })];
