/**
 * Account status bookkeeping (INTEGRATION_PLAN §3.9, §3.12; API_CONTRACTS §2.7):
 * - `accountSummary`: the `AccountSummary` of the API (no provider ids, cursors or scopes);
 * - `recordProviderFailure`: the `connected_accounts.status` change a provider error implies
 *   (`needs_reauth`, `admin_consent_required`, `partial`, `error`); the DB trigger enqueues the
 *   `account` notification; `system.integration.reauth_required` is audited on the transition;
 * - `recordSyncSuccess`: `last_sync_at` / `last_successful_sync_at`, and `error` / `syncing` back to
 *   `healthy` once a sync succeeds.
 */
import type { AccountStatus } from '@da/domain';
import type { ProviderError } from '@da/domain';
import type { AccountSummary, DataSourceToggles } from '@da/validation';
import { accountStatusChange } from '../../providers/errors.ts';
import { microsoftManualRevokeUrl } from '../../providers/microsoft/config.ts';
import type { IntegrationRuntime } from './runtime.ts';
import type { AccountRecord } from './types.ts';

export const DEFAULT_TOGGLES: DataSourceToggles = {
  mail_read: true,
  attachments_analyze: true,
  deadline_detect: true,
  draft_replies: true,
  calendar_read: true,
  schedule_suggest: true,
  calendar_write_with_approval: true,
  tasks_read: true,
};

export function togglesOf(account: Pick<AccountRecord, 'data_source_toggles'>): DataSourceToggles {
  const out: Record<string, boolean> = { ...DEFAULT_TOGGLES };
  for (const key of Object.keys(DEFAULT_TOGGLES)) {
    const value = account.data_source_toggles[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  return out as DataSourceToggles;
}

/** Microsoft has no per-app revoke: its disconnect returns the manual revoke page (API-INT-03). */
export function manualRevokeUrl(
  account: Pick<AccountRecord, 'provider' | 'tenant_type' | 'revocation_mode'>,
): string | null {
  return account.provider === 'microsoft' && account.revocation_mode === 'local_only'
    ? microsoftManualRevokeUrl(account.tenant_type)
    : null;
}

export function accountSummary(account: AccountRecord, pausedByPlan: boolean): AccountSummary {
  return {
    id: account.id,
    provider: account.provider,
    account_email: account.account_email,
    display_name: account.display_label,
    status: account.status,
    capabilities_granted: [...account.capabilities_granted],
    data_sources: togglesOf(account),
    paused_by_plan: pausedByPlan,
    last_sync_at: account.last_sync_at,
    last_error_code: account.last_error_code,
    manual_revoke_url: manualRevokeUrl(account),
  };
}

export async function summaryOf(
  rt: IntegrationRuntime,
  account: AccountRecord,
): Promise<AccountSummary> {
  return accountSummary(account, await rt.store.pausedByPlan(account.id));
}

const TERMINAL: ReadonlySet<AccountStatus> = new Set(['disconnected', 'connecting']);

/** Persists the status a provider failure implies; returns the updated row (null = unchanged). */
export async function recordProviderFailure(
  rt: IntegrationRuntime,
  account: AccountRecord,
  error: ProviderError,
  correlationId: string | null,
): Promise<AccountRecord | null> {
  if (TERMINAL.has(account.status)) return null;
  const change = accountStatusChange(error);
  const at = rt.now().toISOString();
  if (change === null) {
    if (
      error.code === 'rate_limited' ||
      error.code === 'cursor_invalid' ||
      error.code === 'not_found'
    )
      return null;
    return await rt.store.updateAccount(account.id, {
      last_error_code: error.code,
      last_error_at: at,
    });
  }
  if (change.status === 'partial' && account.status === 'partial') {
    return await rt.store.updateAccount(account.id, {
      last_error_code: error.code,
      last_error_at: at,
    });
  }
  const wasReauth = account.status === 'needs_reauth';
  const updated = await rt.store.updateAccount(account.id, {
    status: change.status,
    status_reason: change.statusReason,
    last_error_code: error.code,
    last_error_at: at,
    ...(change.status === 'needs_reauth' ? { reauth_required_at: at } : {}),
  });
  if (change.status === 'needs_reauth' && !wasReauth) {
    await rt.audit.append({
      actorType: 'system',
      actorId: null,
      action: 'system.integration.reauth_required',
      targetType: 'connected_account',
      targetId: account.id,
      targetUserId: account.user_id,
      result: 'success',
      details: { provider: account.provider, reason: change.statusReason },
      correlationId,
    });
  }
  return updated;
}

/** Records a successful sync round; `error` / `syncing` accounts become healthy (or partial). */
export async function recordSyncSuccess(
  rt: IntegrationRuntime,
  account: AccountRecord,
  opts: { finishedFirstPass?: boolean } = {},
): Promise<AccountRecord> {
  const at = rt.now().toISOString();
  const recovering =
    account.status === 'error' || (account.status === 'syncing' && opts.finishedFirstPass === true);
  const nextStatus: AccountStatus | null = recovering ? 'healthy' : null;
  return await rt.store.updateAccount(account.id, {
    last_sync_at: at,
    last_successful_sync_at: at,
    ...(nextStatus === null
      ? {}
      : { status: nextStatus, status_reason: null, last_error_code: null, last_error_at: null }),
  });
}
