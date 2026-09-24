/**
 * `admin-api` Edge Function entrypoint (`verify_jwt = false`; the BFF key and the admin JWT are
 * checked in code, BACKOFFICE_PLAN §2.5). Builds the runtime: the JWT verifier (supabase-js
 * `getClaims`, then the JWKS), the service client (Auth admin, rate limits, idempotency, jobs), the
 * AI provider set for synthetic probes and the token keyring for sealed email parameters.
 */
import { createRemoteJWKSet } from 'jose';
import { createAiProviders } from '../_shared/ai/providers/index.ts';
import { supabaseAdminGate } from '../_shared/auth/admin.ts';
import { chainVerifiers, jwksVerifier, supabaseClaimsVerifier } from '../_shared/auth/user.ts';
import { loadKeyring, type TokenKeyring } from '../_shared/crypto/token-cipher.ts';
import { clientConfigFromEnv, publicClient, serviceClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { supabaseIdempotencyRepo } from '../_shared/idempotency.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { supabaseRateLimitStore } from '../_shared/ratelimit.ts';
import { createAdminApi } from './app.ts';
import { adminEnvFrom } from './lib/runtime.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const config = clientConfigFromEnv(raw);
const system = serviceClient(config);
const base = env.SUPABASE_URL.replace(/\/+$/, '');
const verifier = chainVerifiers(
  supabaseClaimsVerifier(publicClient(config)),
  jwksVerifier({
    jwks: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), {
      timeoutDuration: 3_000,
    }),
    issuer: `${base}/auth/v1`,
  }),
);
let keyring: Promise<TokenKeyring> | null = null;

const { app } = createAdminApi({
  auth: {
    verifier,
    gate: supabaseAdminGate({ gatewaySecret: env.ADMIN_GATEWAY_SECRET, clientConfig: config }),
    bffSecret: env.ADMIN_BFF_SECRET,
  },
  log: createLogger({ fn: 'admin-api' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
  runtime: {
    env: adminEnvFrom(raw, env.APP_ENV),
    config,
    system,
    verifier,
    idempotency: supabaseIdempotencyRepo(system),
    rateLimits: supabaseRateLimitStore(system),
    fetch: (input, init) => fetch(input, init),
    ai: createAiProviders(raw),
    keyring: () => (keyring ??= loadKeyring(env)),
    now: () => Date.now(),
  },
});

Deno.serve(app.fetch);
