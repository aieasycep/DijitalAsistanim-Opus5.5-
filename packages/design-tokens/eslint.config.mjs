import { base } from '@da/config/eslint/base.mjs';

// Raw colour literals are allowed here only: this package is their single source (da/no-raw-color).
export default [...base({ tsconfigRootDir: import.meta.dirname })];
