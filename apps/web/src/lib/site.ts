/**
 * Fixed product facts the website states (SCREEN_AND_FLOW_MAP Part 5 §0.7, §0.9; M§108).
 * Deployment-specific values (store IDs, team IDs, legal entity) come from the environment
 * (`src/env/*`), never from here.
 */

/** Brand name; never translated (Part 5 §13). */
export const BRAND_NAME = 'Dijital Asistan';

/** The app's custom URL scheme (`dijitalasistan://…`). */
export const APP_SCHEME = 'dijitalasistan';

/** Default bundle identifier and Android package (`.env.example` defaults). */
export const DEFAULT_APP_ID = 'com.dijitalasistan.app';

/** Public mailboxes (Manual external step: create them; Part 5 §17). */
export const SUPPORT_EMAIL = 'destek@dijitalasistan.app';
export const DEFAULT_PRIVACY_EMAIL = 'gizlilik@dijitalasistan.app';
export const SECURITY_EMAIL = 'guvenlik@dijitalasistan.app';

/** Paths the mobile app claims as universal links / App Links (Part 5 §0.7, R-28). */
export const UNIVERSAL_LINK_COMPONENTS = ['/app/*', '/r/*', '/oauth/done'] as const;

/** Store subscription management and provider consent pages (Part 5 §6.1). */
export const EXTERNAL_LINKS = {
  appStoreSubscriptions: 'https://apps.apple.com/account/subscriptions',
  playSubscriptions: 'https://play.google.com/store/account/subscriptions',
  microsoftPersonalConsent: 'https://account.live.com/consent/Manage',
  microsoftWorkApps: 'https://myapps.microsoft.com',
  googleConnections: 'https://myaccount.google.com/connections',
  googleUserDataPolicy: 'https://developers.google.com/terms/api-services-user-data-policy',
  googleWorkspaceUserDataPolicy:
    'https://developers.google.com/workspace/workspace-api-user-data-developer-policy',
  appleReportProblem: 'https://reportaproblem.apple.com',
} as const;

/** Microsoft organisation-wide admin consent URL (INTEGRATION_PLAN M6; FAQ `admin_consent`). */
export function microsoftAdminConsentUrl(clientId: string): string {
  return `https://login.microsoftonline.com/organizations/adminconsent?client_id=${encodeURIComponent(clientId)}`;
}

/** The `public-api` Edge Function path under a Supabase (or custom API domain) base URL. */
export const PUBLIC_API_PATH = '/functions/v1/public-api';
