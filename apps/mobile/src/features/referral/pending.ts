/**
 * Pending referral codes (plan §16, M-REF-02): a code from `/r/{code}` (saved by the deep-link
 * router before sign-in) or from the Android Play Install Referrer (`code={CODE}` in the referrer
 * string, read once) is applied after sign-in with `POST /referrals/apply` (API-BIZ-01). A code that
 * could not be sent (offline, network) is kept for the next attempt; a business rejection (invalid,
 * own code, window closed, already applied) is final.
 */
import { isApiError, qk } from '@da/api-client';
import { REFERRAL_CODE_PATTERN } from '@da/validation/api/business';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { installationId } from '../../lib/auth/first-run-purge';
import { registerPostSignInHook } from '../../lib/auth/post-sign-in';
import { getApiClient } from '../../lib/bootstrap';
import { savePendingReferralCode, takePendingReferralCode } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { getQueryClient } from '../../lib/query/client';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';

export type ReferralSource = 'manual' | 'deep_link' | 'install_referrer';
export type ApplyResult =
  'applied' | 'invalid' | 'self' | 'already_applied' | 'window_closed' | 'rate_limited' | 'error';

const SOURCE_KEY = 'referral.pending_source';
const REFERRER_CHECKED_KEY = 'referral.install_referrer_checked';

/** The code of a Play Install Referrer string (`utm_source=…&code=K7M2P9Q`), or null. */
export function codeFromReferrer(referrer: string | null | undefined): string | null {
  if (referrer === null || referrer === undefined) return null;
  const match = /(?:^|[&?])code=([^&]+)/i.exec(decodeURIComponent(referrer));
  const code = match?.[1]?.trim().toUpperCase() ?? null;
  return code !== null && REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

function prefs() {
  return isEncryptedStorageOpen() ? encryptedStorage().prefs : null;
}

/** Android only, once per install: saves the Play Install Referrer code as pending. */
export async function captureInstallReferrer(): Promise<void> {
  const store = prefs();
  if (Platform.OS !== 'android' || store === null) return;
  if (store.getBoolean(REFERRER_CHECKED_KEY) === true) return;
  store.set(REFERRER_CHECKED_KEY, true);
  try {
    const code = codeFromReferrer(await Application.getInstallReferrerAsync());
    if (code !== null) {
      savePendingReferralCode(code);
      store.set(SOURCE_KEY, 'install_referrer');
    }
  } catch {
    // No referrer (sideloaded or not from Play).
  }
}

export function resultOf(error: unknown): ApplyResult {
  if (!isApiError(error)) return 'error';
  switch (error.code) {
    case 'REFERRAL_CODE_INVALID':
      return 'invalid';
    case 'REFERRAL_SELF':
      return 'self';
    case 'REFERRAL_ALREADY_APPLIED':
      return 'already_applied';
    case 'REFERRAL_WINDOW_CLOSED':
      return 'window_closed';
    case 'RATE_LIMITED':
      return 'rate_limited';
    default:
      return 'error';
  }
}

/** `POST /referrals/apply`; returns the outcome (analytics-safe, no code in the event). */
export async function applyReferralCode(
  code: string,
  source: ReferralSource,
  idempotencyKey: string = Crypto.randomUUID(),
): Promise<ApplyResult> {
  const install = installationId();
  if (install === null) return 'error';
  try {
    await getApiClient().call(
      'POST /referrals/apply',
      { body: { code: code.trim().toUpperCase(), installation_id: install, source } },
      { idempotencyKey },
    );
    track('referral_code_applied', { result: 'applied' });
    void getQueryClient().invalidateQueries({ queryKey: qk.referrals.me() });
    return 'applied';
  } catch (error) {
    const result = resultOf(error);
    track('referral_code_applied', { result: result === 'rate_limited' ? 'error' : result });
    return result;
  }
}

/** Takes the pending code (and its source) for the code-entry sheet or an automatic apply. */
export function takePendingReferral(): {
  readonly code: string;
  readonly source: ReferralSource;
} | null {
  const code = takePendingReferralCode();
  if (code === null) return null;
  const store = prefs();
  const stored = store?.getString(SOURCE_KEY);
  store?.remove(SOURCE_KEY);
  return { code, source: stored === 'install_referrer' ? 'install_referrer' : 'deep_link' };
}

/** After sign-in: applies a pending code; a transient failure keeps it for later. */
export async function applyPendingReferral(): Promise<ApplyResult | null> {
  await captureInstallReferrer();
  const pending = takePendingReferral();
  if (pending === null) return null;
  const result = await applyReferralCode(pending.code, pending.source);
  if (result === 'error' || result === 'rate_limited') {
    savePendingReferralCode(pending.code);
    if (pending.source === 'install_referrer') prefs()?.set(SOURCE_KEY, 'install_referrer');
  }
  return result;
}

registerPostSignInHook('referral.apply_pending', async () => {
  await applyPendingReferral();
});
