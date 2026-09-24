/**
 * Microsoft identity platform and Graph endpoints (INTEGRATION_PLAN §5, §15). `MS_LOGIN_BASE_URL` /
 * `MS_GRAPH_BASE_URL` point at the tier-4 mock servers outside production (TEST_PLAN §21 row 3).
 */
import type { Capability } from '@da/domain';
import type { RawEnv } from '../../env.ts';

export interface MicrosoftEndpoints {
  /** `https://login.microsoftonline.com` */
  readonly login: string;
  /** `https://graph.microsoft.com/v1.0` */
  readonly graph: string;
}

export const MICROSOFT_ENDPOINTS: MicrosoftEndpoints = {
  login: 'https://login.microsoftonline.com',
  graph: 'https://graph.microsoft.com/v1.0',
};

/** The Microsoft-account (personal) tenant id (OAUTH-02 step 6). */
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

export function microsoftEndpoints(raw: RawEnv): MicrosoftEndpoints {
  const pick = (value: string | undefined) => {
    const v = raw.APP_ENV === 'production' ? '' : (value ?? '').trim().replace(/\/+$/, '');
    return v === '' ? null : v;
  };
  return {
    login: pick(raw.MS_LOGIN_BASE_URL) ?? MICROSOFT_ENDPOINTS.login,
    graph: pick(raw.MS_GRAPH_BASE_URL) ?? MICROSOFT_ENDPOINTS.graph,
  };
}

/** Identity scopes plus `offline_access` (always requested; INTEGRATION_PLAN §2.11). */
export const MICROSOFT_IDENTITY_SCOPES: readonly string[] = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
];

export const MICROSOFT_CAPABILITY_SCOPES: Readonly<Record<Capability, readonly string[]>> = {
  mail_read: ['Mail.Read'],
  mail_send: ['Mail.Send'],
  calendar_read: ['Calendars.Read'],
  calendar_write: ['Calendars.ReadWrite'],
  tasks_read: ['Tasks.Read'],
  tasks_write: ['Tasks.ReadWrite'],
};

/** Broader delegated permissions that also satisfy a capability. */
const ALTERNATIVES: Partial<Readonly<Record<Capability, readonly string[]>>> = {
  mail_read: ['Mail.ReadWrite'],
  calendar_read: ['Calendars.ReadWrite'],
  tasks_read: ['Tasks.ReadWrite'],
};

const ORDER: readonly Capability[] = [
  'mail_read',
  'mail_send',
  'calendar_read',
  'calendar_write',
  'tasks_read',
  'tasks_write',
];

export function microsoftScopesFor(
  capabilities: readonly Capability[],
  opts: { includeIdentity: boolean },
): string[] {
  // offline_access is needed for a refresh token on every request, identity or not.
  const out = new Set<string>(
    opts.includeIdentity ? MICROSOFT_IDENTITY_SCOPES : ['offline_access'],
  );
  for (const capability of ORDER) {
    if (capabilities.includes(capability))
      for (const scope of MICROSOFT_CAPABILITY_SCOPES[capability]) out.add(scope);
  }
  return [...out];
}

/** Scopes come back short (`Mail.Read`) or as resource URIs (`https://graph.microsoft.com/Mail.Read`). */
export function microsoftCapabilitiesFromScope(grantedScope: string): Capability[] {
  const granted = new Set(
    grantedScope
      .split(/\s+/)
      .filter((s) => s !== '')
      .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()),
  );
  return ORDER.filter((capability) => {
    const candidates = [
      ...MICROSOFT_CAPABILITY_SCOPES[capability],
      ...(ALTERNATIVES[capability] ?? []),
    ];
    return candidates.some((scope) => granted.has(scope.toLowerCase()));
  });
}

/** Where a user removes the app's consent (no per-app delegated revoke exists; §3.14 [verify URLs]). */
export function microsoftManualRevokeUrl(tenantType: 'personal' | 'work' | null): string {
  return tenantType === 'personal'
    ? 'https://account.live.com/consent/Manage'
    : 'https://myapps.microsoft.com';
}

/** Graph `$select` for message listings and delta (header subset; §5.4). */
export const GRAPH_MESSAGE_SELECT =
  'id,conversationId,internetMessageId,subject,from,sender,replyTo,toRecipients,ccRecipients,receivedDateTime,' +
  'sentDateTime,isRead,importance,flag,categories,hasAttachments,bodyPreview,parentFolderId,inferenceClassification,webLink';

/** The MAPI named property carrying the approval id (`String {GUID} Name da_approval_id`). */
export const DA_EXTENDED_PROPERTY_GUID = '6b0f3e2d-8c4a-4f1e-9d27-5a1c0e8b7f34';
export const DA_APPROVAL_PROPERTY_ID = `String {${DA_EXTENDED_PROPERTY_GUID}} Name da_approval_id`;
export const DA_LAST_APPROVAL_PROPERTY_ID = `String {${DA_EXTENDED_PROPERTY_GUID}} Name da_last_approval_id`;

/** Graph subscription lifetime: 10,070 of the 10,080 allowed minutes (§5.4). */
export const GRAPH_SUBSCRIPTION_MINUTES = 10_070;
