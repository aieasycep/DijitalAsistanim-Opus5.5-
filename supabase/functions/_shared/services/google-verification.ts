/**
 * Google OAuth verification status (KNOWN_PLATFORM_LIMITATIONS KPL-32; INTEGRATION_PLAN §16 G8).
 *
 * `gmail.readonly` is a restricted scope: until Google verifies the app (brand verification plus the
 * annual CASA assessment) users see Google's "unverified app" screen and at most 100 users can
 * connect Gmail. The owner records the outcome in `app_settings.google.oauth_verified` (default
 * false, audited in backoffice Settings); an expired CASA letter (`GOOGLE_CASA_LOA_NOT_AFTER` in the
 * past) turns the status back to unverified. `GET /me/bootstrap` reports it as
 * `config.google_oauth_verified` (the Gmail explainer notice) and the `google_oauth` health probe
 * counts Gmail users against the cap while unverified.
 */

export const GOOGLE_OAUTH_VERIFIED_SETTING = 'google.oauth_verified';

/** Google's cap for an unverified app with restricted scopes. */
export const GMAIL_UNVERIFIED_CAP = 100;
/** `google_oauth` probe thresholds while unverified: degraded at 80 users, down at 95. */
export const GMAIL_CAP_DEGRADED_AT = 80;
export const GMAIL_CAP_DOWN_AT = 95;

export function googleOauthVerified(
  setting: unknown,
  loaNotAfter: string | undefined,
  now: Date,
): boolean {
  if (setting !== true) return false;
  const value = loaNotAfter?.trim() ?? '';
  if (value === '') return true;
  // A date-only value is valid through the end of that day (UTC).
  const until = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value);
  return Number.isNaN(until) ? false : until > now.getTime();
}
