/** Test environment: valid core keys generated at runtime (never real secrets). */
import { toBase64 } from '../crypto/encoding.ts';
import type { RawEnv } from '../env.ts';

function randomBase64(bytes: number): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes)));
}

export const TEST_SUPABASE_URL = 'https://project-ref.supabase.co';

/** A minimal valid server env; `overrides` with `undefined` remove a key. */
export function testEnv(overrides: Record<string, string | undefined> = {}): RawEnv {
  const base: Record<string, string | undefined> = {
    APP_ENV: 'development',
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_testkey' }),
    HASH_PEPPER: randomBase64(32),
    AI_HASH_PEPPER: randomBase64(32),
    TOKEN_ENC_KEY_V1: randomBase64(32),
    TOKEN_ENC_ACTIVE_VERSION: '1',
    CRON_SECRET: randomBase64(24),
  };
  const out: Record<string, string | undefined> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

export { randomBase64 };
