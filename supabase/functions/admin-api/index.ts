/** `admin-api` Edge Function entrypoint (`verify_jwt = false`; BFF key + admin JWT checked in code). */
import { createRemoteJWKSet } from 'jose';
import { supabaseAdminGate } from '../_shared/auth/admin.ts';
import { chainVerifiers, jwksVerifier, supabaseClaimsVerifier } from '../_shared/auth/user.ts';
import { clientConfigFromEnv, publicClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { createAdminApi } from './app.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const config = clientConfigFromEnv(raw);
const base = env.SUPABASE_URL.replace(/\/+$/, '');
const { app } = createAdminApi({
  auth: {
    verifier: chainVerifiers(
      supabaseClaimsVerifier(publicClient(config)),
      jwksVerifier({
        jwks: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), {
          timeoutDuration: 3_000,
        }),
        issuer: `${base}/auth/v1`,
      }),
    ),
    gate: supabaseAdminGate({ gatewaySecret: env.ADMIN_GATEWAY_SECRET, clientConfig: config }),
    bffSecret: env.ADMIN_BFF_SECRET,
  },
  log: createLogger({ fn: 'admin-api' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
