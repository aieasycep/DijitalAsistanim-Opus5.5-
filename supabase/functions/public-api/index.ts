/** `public-api` Edge Function entrypoint (`verify_jwt = false`; rate limits and CORS in code). */
import { supabaseClaimsVerifier } from '../_shared/auth/user.ts';
import { clientConfigFromEnv, publicClient, serviceClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { pokeWorker } from '../_shared/jobs/client.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { supabaseRateLimitStore } from '../_shared/ratelimit.ts';
import { createPublicApiApp } from './app.ts';
import { turnstileVerifier } from './captcha.ts';
import { goTrueOtpGateway } from './otp.ts';
import { supabasePublicRepo } from './repo.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const config = clientConfigFromEnv(raw);
const system = serviceClient(config);
const log = createLogger({ fn: 'public-api' });
const app = createPublicApiApp({
  webOrigin: env.PUBLIC_WEB_URL,
  verifier: config.publishableKey === null ? null : supabaseClaimsVerifier(publicClient(config)),
  log,
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
  services: {
    repo: supabasePublicRepo(system),
    otp: goTrueOtpGateway({ supabaseUrl: env.SUPABASE_URL, apiKey: config.publishableKey }),
    captcha: turnstileVerifier(env.TURNSTILE_SECRET_KEY),
    rateLimits: supabaseRateLimitStore(system),
    pepper: env,
    inboundBasicAuth: env.EMAIL_INBOUND_BASIC_AUTH,
    publicWebUrl: env.PUBLIC_WEB_URL,
    iosAppStoreId: raw.IOS_APP_STORE_ID?.trim() || undefined,
    androidPackage: raw.ANDROID_PACKAGE?.trim() || 'com.dijitalasistan.app',
    poke: () =>
      pokeWorker({ baseUrl: env.SUPABASE_URL, secret: env.CRON_SECRET, reason: 'public_api', log }),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
});

Deno.serve(app.fetch);
