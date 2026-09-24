/**
 * Recent-sign-in check for R-16 (history and account deletion need a sign-in within 10 minutes).
 * The server is authoritative (`401 REAUTH_REQUIRED`); this only avoids a round trip when the local
 * session already shows an older sign-in.
 */
import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';

export const REAUTH_WINDOW_MS = 10 * 60_000;

export async function needsReauth(): Promise<boolean> {
  try {
    const session = (await getSupabase().auth.getSession()).data.session;
    const last = session?.user.last_sign_in_at;
    if (typeof last !== 'string') return false;
    const at = Date.parse(last);
    return Number.isFinite(at) && now().getTime() - at > REAUTH_WINDOW_MS;
  } catch {
    return false;
  }
}
