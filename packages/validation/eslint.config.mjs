import { denoSafe } from '@da/config/eslint/deno-safe.mjs';

export default [...denoSafe({ tsconfigRootDir: import.meta.dirname })];
