/**
 * One client model for an approval, whichever contract delivered it (T-8.18, M§33): the API
 * `ApprovalView` (API-APR-01…05, the assistant `action_proposal` event, capture actions) or a
 * PostgREST row (RPC-10 `list_approvals`, `approval_actions?id=eq.`). Status → badge, retry
 * availability (`@da/domain` failure map) and the six card rows (Ne · Neden · Kaynak · Değişim ·
 * Hesap · Yan etki) are derived here once, so every surface renders the same card.
 */
import {
  APPROVAL_STATUS_VALUES,
  approvalFailurePolicy,
  type ApprovalActionType,
  type ApprovalStatus,
} from '@da/domain';
import type { ApprovalView } from '@da/validation/api/approvals';

export interface ApprovalSource {
  readonly type: string;
  readonly id: string | null;
  readonly provider: string | null;
  readonly timestamp: string | null;
  readonly label: string | null;
  readonly route: string | null;
}

export interface ApprovalChangeField {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface ApprovalModel {
  readonly id: string;
  readonly actionType: ApprovalActionType;
  readonly status: ApprovalStatus;
  readonly payloadVersion: number;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly summary: string;
  readonly why: string;
  readonly origin: string;
  readonly source: ApprovalSource | null;
  readonly changeKind: 'send' | 'create' | 'update';
  readonly changes: readonly ApprovalChangeField[];
  readonly destinationLabel: string | null;
  readonly destinationKind: 'provider' | 'device' | 'in_app' | null;
  readonly sideEffects: readonly { readonly code: string; readonly text: string }[];
  readonly executor: 'server' | 'device';
  readonly deviceInstallationId: string | null;
  readonly batchId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly approvedAt: string | null;
  readonly executedAt: string | null;
  readonly failedAt: string | null;
  readonly rejectedAt: string | null;
  readonly approvedVia: string | null;
  readonly failureCode: string | null;
  readonly retryable: boolean;
  /** The destination account needs a reconnect or an extra scope (API §7). */
  readonly scopeState: 'granted' | 'upgrade_required' | 'reauth_required' | 'not_applicable';
  readonly upgradeAccountId: string | null;
  readonly upgradeCapability: string | null;
  readonly resultWebLink: string | null;
}

const ACTION_TYPES: readonly ApprovalActionType[] = [
  'email_send',
  'calendar_create',
  'calendar_update',
  'task_create',
  'reminder_create',
  'commitment_create',
];

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function changeFields(value: unknown): ApprovalChangeField[] {
  const fields = obj(value).fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .map((f) => obj(f))
    .filter((f) => typeof f.field === 'string')
    .map((f) => ({ field: String(f.field), before: str(f.before), after: str(f.after) }))
    .slice(0, 20);
}

function sideEffectsOf(value: unknown): { code: string; text: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((e) => obj(e))
    .filter((e) => typeof e.text === 'string')
    .map((e) => ({ code: typeof e.code === 'string' ? e.code : '', text: String(e.text) }));
}

function changeKindOf(value: unknown): ApprovalModel['changeKind'] {
  const kind = obj(value).kind;
  return kind === 'send' || kind === 'update' ? kind : 'create';
}

function statusOf(value: unknown): ApprovalStatus {
  return (APPROVAL_STATUS_VALUES as readonly unknown[]).includes(value)
    ? (value as ApprovalStatus)
    : 'pending';
}

function destinationKindOf(value: unknown): ApprovalModel['destinationKind'] {
  return value === 'provider' || value === 'device' || value === 'in_app' ? value : null;
}

/** From the API `ApprovalView`. */
export function fromApprovalView(view: ApprovalView): ApprovalModel {
  return {
    id: view.id,
    actionType: view.action_type,
    status: view.status,
    payloadVersion: view.payload_version,
    idempotencyKey: view.idempotency_key,
    title: view.what.title,
    summary: view.what.summary,
    why: view.why.text,
    origin: view.origin,
    source:
      view.source === null
        ? null
        : {
            type: view.source.source_type,
            id: view.source.source_id,
            provider: view.source.source_provider,
            timestamp: view.source.source_timestamp,
            label: view.source.label ?? null,
            route: view.source.open_route ?? null,
          },
    changeKind: view.exact_change.kind,
    changes: view.exact_change.fields,
    destinationLabel:
      [view.destination.account_label, view.destination.container_label]
        .filter((p): p is string => p !== null && p !== '')
        .join(' · ') || null,
    destinationKind: view.destination.target_kind,
    sideEffects: view.side_effects,
    executor: view.executor,
    deviceInstallationId: view.device_installation_id,
    batchId: view.batch_id,
    createdAt: view.created_at,
    expiresAt: view.approval_expires_at,
    approvedAt: view.approved_at,
    executedAt: view.executed_at,
    failedAt: null,
    rejectedAt: view.rejected_at,
    approvedVia: view.approved_via,
    failureCode: view.failure?.code ?? null,
    retryable: view.failure?.retryable ?? false,
    scopeState: view.scope_status.state,
    upgradeAccountId: view.scope_status.upgrade?.account_id ?? null,
    upgradeCapability: view.scope_status.upgrade?.capability ?? null,
    resultWebLink: view.result?.web_link ?? null,
  };
}

/** From an RPC-10 `list_approvals` item or an `approval_actions` row (PostgREST). */
export function fromApprovalRow(raw: unknown): ApprovalModel | null {
  const row = obj(raw);
  const id = str(row.id);
  const actionType = row.action_type as ApprovalActionType;
  if (id === null || !ACTION_TYPES.includes(actionType)) return null;
  const exact = obj(row.exact_change);
  const card = obj(exact.card);
  const destination = obj(card.destination);
  const source = obj(row.source);
  const sourceType = str(source.source_type) ?? str(row.source_type);
  const lastError = str(row.last_error_code);
  const status = statusOf(row.status);
  const destinationLabel =
    [str(destination.account_label), str(destination.container_label)]
      .filter((p): p is string => p !== null)
      .join(' · ') || str(row.destination_label);
  const requiresScope = str(row.requires_scope);
  return {
    id,
    actionType,
    status,
    payloadVersion: typeof row.payload_version === 'number' ? row.payload_version : 1,
    idempotencyKey: str(row.idempotency_key) ?? '',
    title: str(row.what) ?? '',
    summary: str(row.change_summary) ?? '',
    why: str(row.why) ?? '',
    origin: str(row.origin) ?? 'manual',
    source:
      sourceType === null || sourceType === 'user_input'
        ? null
        : {
            type: sourceType,
            id: str(source.source_id) ?? str(row.source_id),
            provider: str(source.provider) ?? str(row.source_provider),
            timestamp: str(source.source_timestamp) ?? str(row.source_timestamp),
            label: str(card.source_label),
            route: str(card.source_route),
          },
    changeKind: changeKindOf(exact),
    changes: changeFields(exact),
    destinationLabel,
    destinationKind: destinationKindOf(destination.target_kind),
    sideEffects: sideEffectsOf(row.side_effects),
    executor: row.executor === 'device' ? 'device' : 'server',
    deviceInstallationId: str(row.device_installation_id),
    batchId: str(row.batch_id),
    createdAt: str(row.created_at) ?? '',
    expiresAt: str(row.approval_expires_at),
    approvedAt: str(row.approved_at),
    executedAt: str(row.executed_at),
    failedAt: str(row.failed_at),
    rejectedAt: str(row.rejected_at),
    approvedVia: str(row.approved_via),
    failureCode: status === 'failed' ? (lastError ?? 'INTERNAL_ERROR') : null,
    retryable: status === 'failed' && approvalFailurePolicy(lastError).retryable,
    scopeState: requiresScope === null ? 'not_applicable' : 'upgrade_required',
    upgradeAccountId: requiresScope === null ? null : str(row.destination_account_id),
    upgradeCapability: requiresScope,
    resultWebLink: str(obj(row.result).web_link),
  };
}

export const IN_FLIGHT: readonly ApprovalStatus[] = ['approved', 'executing'];
export const TERMINAL: readonly ApprovalStatus[] = ['executed', 'failed', 'rejected', 'expired'];

export function isInFlight(model: Pick<ApprovalModel, 'status'>): boolean {
  return IN_FLIGHT.includes(model.status);
}

export function isTerminal(model: Pick<ApprovalModel, 'status'>): boolean {
  return TERMINAL.includes(model.status);
}

/** The retry-with-the-same-key action is offered (R-06, `packages/domain` failure map). */
export function canRetry(model: ApprovalModel): boolean {
  return model.status === 'failed' && model.retryable;
}

/** i18n key of the `last_error_code` copy under `approvals.failure.*`. */
export function failureMessageKey(model: ApprovalModel): string {
  return approvalFailurePolicy(model.failureCode).messageKey;
}

/** Bucket used by `approval_center_view.pending_count_bucket`. */
export function countBucket(count: number): '0' | '1' | '2-5' | '6-20' | '20+' {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  return '20+';
}

/** Applies a status observed by polling or a mutation response. */
export function withStatus(model: ApprovalModel, next: Partial<ApprovalModel>): ApprovalModel {
  return { ...model, ...next };
}
