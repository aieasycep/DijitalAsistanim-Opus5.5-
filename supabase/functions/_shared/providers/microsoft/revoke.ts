/**
 * Microsoft "revoke" (INTEGRATION_PLAN §3.14, §5.7; API-INT-03): no per-app delegated revoke exists
 * and `revokeSignInSessions` would sign the user out everywhere, so it is never used. The tokens are
 * deleted locally and the user is sent to the consent-management page of their account type.
 */
import type { RevokeResult } from '@da/domain';
import { microsoftManualRevokeUrl } from './config.ts';

export function microsoftLocalRevoke(tenantType: 'personal' | 'work' | null): RevokeResult {
  return { mode: 'local_only', userActionUrl: microsoftManualRevokeUrl(tenantType) };
}
