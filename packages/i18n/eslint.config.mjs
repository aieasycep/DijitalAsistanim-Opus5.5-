import { base } from '@da/config/eslint/base.mjs';

export default [...base({ tsconfigRootDir: import.meta.dirname })];
