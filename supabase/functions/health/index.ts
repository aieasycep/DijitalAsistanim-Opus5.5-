/**
 * `health` Edge Function entrypoint (`verify_jwt = false`; secret or admin checked in code).
 * Unlike the other functions it does not refuse to start on a demo-mode or env misconfiguration:
 * it is the component that reports them (`api` probe: `demo_mode_forbidden`, `env_invalid`).
 */
import { createRemoteJWKSet } from 'jose';
import { supabaseAdminGate } from '../_shared/auth/admin.ts';
import { chainVerifiers, jwksVerifier, supabaseClaimsVerifier } from '../_shared/auth/user.ts';
import { clientConfigFromEnv, publicClient, serviceClient } from '../_shared/db/clients.ts';
import { processEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { createHealthApp } from './app.ts';
import { supabaseHealthData, supabaseHealthWriter } from './data.ts';

const raw = processEnv();
const config = clientConfigFromEnv(raw);
const system = serviceClient(config);
const base = config.url.replace(/\/+$/, '');
const admin =
  config.publishableKey === null
    ? null
    : {
        verifier: chainVerifiers(
          supabaseClaimsVerifier(publicClient(config)),
          jwksVerifier({
            jwks: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), {
              timeoutDuration: 3_000,
            }),
            issuer: `${base}/auth/v1`,
          }),
        ),
        gate: supabaseAdminGate({ gatewaySecret: raw.ADMIN_GATEWAY_SECRET, clientConfig: config }),
        bffSecret: raw.ADMIN_BFF_SECRET,
      };

const app = createHealthApp({
  raw,
  data: supabaseHealthData(system),
  writer: supabaseHealthWriter(system),
  admin,
  log: createLogger({ fn: 'health' }),
  sentry: createSentry({ dsn: raw.SENTRY_DSN, environment: raw.APP_ENV ?? 'development' }),
});

Deno.serve(app.fetch);
