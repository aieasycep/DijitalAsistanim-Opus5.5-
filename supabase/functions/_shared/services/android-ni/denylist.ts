/**
 * The locked Android Notification Intelligence package denylist, server side (API-ANI-01,
 * AI_PIPELINE_PLAN §13.8, SCREEN_AND_FLOW_MAP §9 "Locked exclusions", C-11). This module is the one
 * server copy of the list: `POST /android-notifications/signals` rejects (and counts) every signal
 * whose package it matches, whatever the device sent.
 *
 * It is a superset of what the device bundles, kept equal by `denylist.test.ts`:
 * - `PackageRules.LOCKED` and its security-token rule in
 *   `apps/mobile/modules/notification-intelligence/android/.../PackageRules.kt`;
 * - `LOCKED_PACKAGES` in `apps/mobile/src/features/android-ni/presets.ts` (M-ANI-04 groups);
 * - the `denylist` payload of the `feature.android_ni` flag seeded in
 *   `supabase/migrations/20260924001000_ops_product.sql`.
 * The flag payload is also read at request time, so operators can extend the list without a
 * deploy; it can never shrink the bundled baseline.
 */

export type LockedGroup =
  | 'authenticator'
  | 'password_manager'
  | 'e_devlet'
  | 'messaging'
  | 'google_play_services'
  | 'system'
  | 'own_app'
  /** Listed only in the runtime `feature.android_ni` payload. */
  | 'flag_payload';

/** Package → locked group. Authenticators, password managers, e-Devlet, messaging, GMS, system UI. */
export const LOCKED_PACKAGES: Readonly<Record<string, LockedGroup>> = {
  // Authenticators
  'com.google.android.apps.authenticator2': 'authenticator',
  'com.azure.authenticator': 'authenticator',
  'com.authy.authy': 'authenticator',
  'com.duosecurity.duomobile': 'authenticator',
  'com.okta.android.auth': 'authenticator',
  'com.twofasapp': 'authenticator',
  'com.beemdevelopment.aegis': 'authenticator',
  'org.fedorahosted.freeotp': 'authenticator',
  'com.lastpass.authenticator': 'authenticator',
  // Password managers
  'com.x8bit.bitwarden': 'password_manager',
  'com.agilebits.onepassword': 'password_manager',
  'com.lastpass.lpandroid': 'password_manager',
  'com.proton.pass': 'password_manager',
  'proton.android.pass': 'password_manager',
  // e-Devlet
  'tr.gov.turkiye.edevlet.kapisi': 'e_devlet',
  // Messaging and SMS (locked "Her zaman hariç" on M-ANI-01)
  'com.whatsapp': 'messaging',
  'com.whatsapp.w4b': 'messaging',
  'org.telegram.messenger': 'messaging',
  'com.turkcell.bip': 'messaging',
  'com.google.android.apps.messaging': 'messaging',
  'com.samsung.android.messaging': 'messaging',
  'com.android.mms': 'messaging',
  'org.thoughtcrime.securesms': 'messaging',
  'com.facebook.orca': 'messaging',
  // Google Play services
  'com.google.android.gms': 'google_play_services',
  // System UI and dialers
  android: 'system',
  'com.android.systemui': 'system',
  'com.google.android.dialer': 'system',
  'com.samsung.android.dialer': 'system',
};

/**
 * This app's Android package (`ANDROID_PACKAGE` default in `apps/mobile/app.config.ts`); the
 * `.dev`, `.preview` and `.e2e` variants are covered by the prefix rule.
 */
export const OWN_PACKAGE = 'com.dijitalasistan.app';

/**
 * Package-name segments that mark an authenticator or a password manager: the same expression as
 * `PackageRules.SECURITY_SEGMENT` on the device (fail closed for apps missing from the list).
 */
export const SECURITY_SEGMENT =
  /^(authenticator.*|.*authenticator|authy|otp|totp|twofa|2fa|keepass.*|passwords?|passwordmanager|bitwarden|onepassword|lastpass.*|dashlane|keeper|enpass)$/;

/** The locked group of a package, or null when the user may choose it. */
export function lockedGroup(
  packageName: string,
  extra: ReadonlySet<string> = new Set(),
): LockedGroup | null {
  if (packageName === OWN_PACKAGE || packageName.startsWith(`${OWN_PACKAGE}.`)) return 'own_app';
  const listed = LOCKED_PACKAGES[packageName];
  if (listed !== undefined) return listed;
  if (
    packageName
      .toLowerCase()
      .split('.')
      .some((s) => SECURITY_SEGMENT.test(s))
  ) {
    return 'authenticator';
  }
  return extra.has(packageName) ? 'flag_payload' : null;
}

export function isLockedPackage(packageName: string, extra?: ReadonlySet<string>): boolean {
  return lockedGroup(packageName, extra) !== null;
}

const PACKAGE_RE = /^[a-zA-Z0-9_.]{1,200}$/;

/** The `denylist` array of the `feature.android_ni` flag payload (invalid entries are ignored). */
export function flagPayloadDenylist(payload: unknown): ReadonlySet<string> {
  const list =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as { denylist?: unknown }).denylist
      : undefined;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter((p): p is string => typeof p === 'string' && PACKAGE_RE.test(p)));
}
