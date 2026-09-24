/**
 * `api` Edge Function entrypoint (`/functions/v1/api`, `verify_jwt = true`). The demo guard and the
 * env schema run at module init: a misconfigured production deployment refuses to start.
 */
import { clientConfigFromEnv } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { createApiApp } from './app.ts';
import { createApiDeps } from './repos/system/index.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const log = createLogger({ fn: 'api' });
const sentry = createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV });
const app = createApiApp(
  createApiDeps({ env, raw, config: clientConfigFromEnv(raw), log, sentry }),
);

Deno.serve(app.fetch);
