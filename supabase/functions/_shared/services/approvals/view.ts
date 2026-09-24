/**
 * `ApprovalView` (API_CONTRACTS §5.2): the card contract every approval route returns, rendered from
 * the stored row. Provider ids never leave the server: `result` carries only the web link and a
 * summary; `failure` maps `last_error_code` through the domain failure policy.
 */
import {
  approvalFailurePolicy,
  type ApprovalActionType,
  type Capability,
  isUuid,
  type Provider,
} from '@da/domain';
import { ApprovalFailureCode, type ApprovalView } from '@da/validation';
import type { z } from 'zod';
import { type ServerLocale, translate } from '../../i18n/catalog.ts';
import type { AccountInfo, ApprovalRow } from './model.ts';

/** Google / Microsoft scopes that grant each write capability (API_CONTRACTS §7). */
const WRITE_SCOPES: Readonly<
  Record<'google' | 'microsoft', Partial<Record<Capability, string[]>>>
> = {
  google: {
    mail_send: ['https://www.googleapis.com/auth/gmail.send'],
    calendar_write: ['https://www.googleapis.com/auth/calendar.events.owned'],
    tasks_write: ['https://www.googleapis.com/auth/tasks'],
  },
  microsoft: {
    mail_send: ['Mail.Send'],
    calendar_write: ['Calendars.ReadWrite'],
    tasks_write: ['Tasks.ReadWrite'],
  },
};

export interface ScopeUpgradeInfo {
  readonly account_id: string;
  readonly provider: 'google' | 'microsoft';
  readonly capability: Capability;
  readonly missing_scopes: string[];
  readonly explainer_key: string;
  readonly upgrade: {
    readonly method: 'POST';
    readonly path: string;
    readonly body: { capability: Capability; resume: { approval_id: string } };
  };
}

/** The `ScopeUpgrade` object of a 424 `PROVIDER_SCOPE_MISSING` and of `scope_status.upgrade`. */
export function scopeUpgrade(
  account: Pick<AccountInfo, 'id' | 'provider'>,
  capability: Capability,
  approvalId: string,
): ScopeUpgradeInfo | null {
  if (account.provider !== 'google' && account.provider !== 'microsoft') return null;
  return {
    account_id: account.id,
    provider: account.provider,
    capability,
    missing_scopes: [...(WRITE_SCOPES[account.provider][capability] ?? [])],
    explainer_key: 'approvals.scopeUpgrade.body',
    upgrade: {
      method: 'POST',
      path: `/integrations/${account.id}/upgrade`,
      body: { capability, resume: { approval_id: approvalId } },
    },
  };
}

const HEALTHY = new Set(['healthy', 'syncing', 'partial']);

export function accountUsable(account: AccountInfo): boolean {
  return HEALTHY.has(account.status);
}

type ScopeStatus = ApprovalView['scope_status'];

export function scopeStatusOf(
  row: ApprovalRow,
  account: AccountInfo | null,
  hasCapability: boolean | null,
): ScopeStatus {
  const capability = row.exact_change.card.capability;
  if (capability === null || row.destination_account_id === null)
    return { state: 'not_applicable' };
  if (
    account !== null &&
    (account.status === 'needs_reauth' || account.status === 'disconnected')
  ) {
    return { state: 'reauth_required' };
  }
  const missing = hasCapability === false || row.requires_scope !== null;
  if (missing && account !== null) {
    const upgrade = scopeUpgrade(account, capability, row.id);
    return upgrade === null
      ? { state: 'upgrade_required' }
      : { state: 'upgrade_required', upgrade };
  }
  return { state: 'granted' };
}

const TYPE_LABEL: Readonly<Record<ApprovalActionType, string>> = {
  email_send: 'approvals.types.email_send',
  calendar_create: 'approvals.types.calendar_create',
  calendar_update: 'approvals.types.calendar_update',
  task_create: 'approvals.types.task_create',
  reminder_create: 'approvals.types.reminder_create',
  commitment_create: 'approvals.types.commitment_create',
};

function iso(value: string | null): string | null {
  if (value === null) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function webLink(result: Record<string, unknown> | null): string | null {
  const link = result?.web_link;
  if (typeof link !== 'string') return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function sourceProviderOf(row: ApprovalRow): Provider | 'in_app' {
  return row.source_provider ?? 'in_app';
}

export function toApprovalView(
  row: ApprovalRow,
  input: { locale: ServerLocale; account?: AccountInfo | null; hasCapability?: boolean | null },
): ApprovalView {
  const card = row.exact_change.card;
  const parsedCode = ApprovalFailureCode.safeParse(row.last_error_code);
  const failureCode: z.infer<typeof ApprovalFailureCode> | null =
    row.status === 'failed' ? (parsedCode.success ? parsedCode.data : 'INTERNAL_ERROR') : null;
  const policy = approvalFailurePolicy(
    row.last_error_code === 'DEVICE_WRITE_FAILED' && row.last_error_message === 'cancelled_by_user'
      ? 'DEVICE_CANCELLED'
      : row.last_error_code,
  );
  const retryableFlag = row.result?.retryable;
  return {
    id: row.id,
    action_type: row.action_type,
    status: row.status,
    payload_version: row.payload_version,
    idempotency_key: row.idempotency_key,
    type_label_key: TYPE_LABEL[row.action_type],
    what: { title: row.what, summary: row.change_summary.slice(0, 400) },
    why: { text: row.why ?? '', reason_code: row.origin },
    source:
      row.source_type === 'user_input'
        ? null
        : {
            source_type: row.source_type,
            source_id: isUuid(row.source_id) ? row.source_id : null,
            source_provider: sourceProviderOf(row),
            source_timestamp: iso(row.source_timestamp) ?? row.created_at,
            ...(card.source_label === null ? {} : { label: card.source_label }),
            ...(card.source_route === null ? {} : { open_route: card.source_route }),
          },
    exact_change: {
      kind: row.exact_change.kind,
      fields: [...row.exact_change.fields].slice(0, 20),
    },
    destination: card.destination,
    side_effects: [...row.side_effects],
    scope_status: scopeStatusOf(row, input.account ?? null, input.hasCapability ?? null),
    requires_confirmation: card.requires_confirmation,
    pro_required: card.pro_required,
    origin: row.origin,
    origin_ref_id: row.origin_ref_id,
    executor: row.executor,
    device_installation_id: row.device_installation_id,
    batch_id: row.batch_id,
    created_at: iso(row.created_at) ?? row.created_at,
    approval_expires_at: iso(row.approval_expires_at) ?? row.approval_expires_at,
    approved_at: iso(row.approved_at),
    rejected_at: iso(row.rejected_at),
    approved_via: row.approved_via,
    executed_at: iso(row.executed_at),
    result:
      row.status === 'executed'
        ? {
            web_link: webLink(row.result),
            summary: translate(input.locale, `approvals.results.${row.action_type}`).slice(0, 200),
          }
        : null,
    failure:
      failureCode === null
        ? null
        : {
            code: failureCode,
            message: translate(input.locale, policy.messageKey),
            retryable: typeof retryableFlag === 'boolean' ? retryableFlag : policy.retryable,
          },
  };
}
