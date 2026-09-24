import 'server-only';
import { parseServerEnv, type ServerEnv } from './schema.ts';

/**
 * Server-side configuration. Read on every call (cheap) so route handlers and tests see the
 * current `process.env`; `next.config.ts` validates the same schema at build time so a broken
 * configuration fails the build rather than a request.
 */
export function serverEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
