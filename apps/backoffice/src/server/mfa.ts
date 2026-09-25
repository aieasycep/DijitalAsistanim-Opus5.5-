import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * TOTP verification across the admin's verified factors (BACKOFFICE_PLAN §3.3): with a backup
 * device ("Yedek cihaz", at most two TOTP factors) a code from either authenticator must pass the
 * challenge and the step-up. The preferred factor is tried first, then the others.
 */

export type TotpVerification =
  | { readonly ok: true; readonly factorId: string; readonly accessToken: string }
  | { readonly ok: false; readonly status: number };

export async function verifyTotpCode(
  supabase: SupabaseClient,
  code: string,
  preferredFactorId?: string,
): Promise<TotpVerification> {
  const listed = await supabase.auth.mfa.listFactors();
  if (listed.error !== null) return { ok: false, status: listed.error.status ?? 503 };
  const ids = listed.data.totp.map((factor) => factor.id);
  const ordered =
    preferredFactorId !== undefined && ids.includes(preferredFactorId)
      ? [preferredFactorId, ...ids.filter((id) => id !== preferredFactorId)]
      : ids;
  let status = 400;
  for (const factorId of ordered) {
    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (verified.error === null) {
      return { ok: true, factorId, accessToken: verified.data.access_token };
    }
    status = (verified.error as { status?: number }).status ?? 400;
    if (status === 0 || status >= 500) break;
  }
  return { ok: false, status };
}
