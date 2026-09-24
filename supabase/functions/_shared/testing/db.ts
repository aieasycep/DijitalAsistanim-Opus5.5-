/** A supabase-js client over a stubbed `fetch`, to assert the exact PostgREST requests. */
import { createClient } from '@supabase/supabase-js';
import type { DbClient } from '../db/clients.ts';
import { TEST_SUPABASE_URL } from './env.ts';

export function testDb(fetchImpl: typeof fetch, key = 'test-secret-key'): DbClient {
  return createClient(TEST_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
}
