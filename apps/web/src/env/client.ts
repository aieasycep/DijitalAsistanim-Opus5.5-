import { parseClientEnv, type ClientEnv } from './client-schema.ts';

/**
 * Browser-safe configuration. Each `NEXT_PUBLIC_*` value is referenced literally so Next.js
 * inlines it at build time; nothing else from `process.env` reaches the client bundle.
 */
export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_ANALYTICS_ENABLED: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
});
