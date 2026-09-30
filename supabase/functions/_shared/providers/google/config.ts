/**
 * Google endpoints and adapter configuration (INTEGRATION_PLAN §4, §15). The `GOOGLE_OAUTH_BASE_URL`
 * / `GOOGLE_API_BASE_URL` overrides point the adapters at the tier-4 mock provider servers; the env
 * schema refuses them outside development, e2e and ci (TEST_PLAN §21 row 3).
 */
import type { RawEnv } from '../../env.ts';

export interface GoogleEndpoints {
  /** `https://accounts.google.com` (authorization page). */
  readonly accounts: string;
  /** `https://oauth2.googleapis.com` (token, revoke, tokeninfo). */
  readonly oauth2: string;
  readonly gmail: string;
  readonly calendar: string;
  readonly tasks: string;
  /** Google's OIDC JWKS (id_token and Pub/Sub push JWT verification). */
  readonly certs: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  accounts: 'https://accounts.google.com',
  oauth2: 'https://oauth2.googleapis.com',
  gmail: 'https://gmail.googleapis.com',
  calendar: 'https://www.googleapis.com',
  tasks: 'https://tasks.googleapis.com',
  certs: 'https://www.googleapis.com/oauth2/v3/certs',
};

function trimmed(value: string | undefined): string | null {
  const v = value?.trim().replace(/\/+$/, '');
  return v === undefined || v === '' ? null : v;
}

export function googleEndpoints(raw: RawEnv): GoogleEndpoints {
  const oauthBase = raw.APP_ENV === 'production' ? null : trimmed(raw.GOOGLE_OAUTH_BASE_URL);
  const apiBase = raw.APP_ENV === 'production' ? null : trimmed(raw.GOOGLE_API_BASE_URL);
  return {
    accounts: oauthBase ?? GOOGLE_ENDPOINTS.accounts,
    oauth2: oauthBase ?? GOOGLE_ENDPOINTS.oauth2,
    gmail: apiBase ?? GOOGLE_ENDPOINTS.gmail,
    calendar: apiBase ?? GOOGLE_ENDPOINTS.calendar,
    tasks: apiBase ?? GOOGLE_ENDPOINTS.tasks,
    certs: oauthBase === null ? GOOGLE_ENDPOINTS.certs : `${oauthBase}/oauth2/v3/certs`,
  };
}

/** Quota cost per Gmail method (INTEGRATION_PLAN §3.6 cost table; [verify] values kept as written). */
export const GMAIL_COST = {
  profile: 1,
  messagesList: 5,
  historyList: 2,
  messagesGet: 20,
  attachmentsGet: 5,
  messagesSend: 100,
  watch: 100,
  stop: 5,
} as const;

/** Headers fetched with `format=metadata` (triage allow-list; §4.4). */
export const GMAIL_METADATA_HEADERS = [
  'From',
  'To',
  'Cc',
  'Reply-To',
  'Subject',
  'Date',
  'Message-ID',
  'In-Reply-To',
  'References',
  'List-Unsubscribe',
  'List-Id',
  'Precedence',
  'Auto-Submitted',
  'Authentication-Results',
  'X-Priority',
  'Importance',
] as const;
