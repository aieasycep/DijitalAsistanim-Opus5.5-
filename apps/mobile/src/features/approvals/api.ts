/**
 * Approval data and decisions (T-8.18, SCREEN_AND_FLOW_MAP Part 2 §0.4–0.5, Part 3 §0.4):
 * - reads: RPC-10 `list_approvals` for the Approval Center sections and history, PostgREST
 *   `approval_actions` / `approval_events` for one approval (RLS owner);
 * - decisions: API-APR-02…05 through `@da/api-client` factories — approve with the approval's own
 *   key and the tapped surface (`approved_via`, R-03), reject (`user_reject` learns, `user_cancel`
 *   does not), edit (a new payload version), and the device executor for device destinations;
 * - result tracking without Realtime (R-19): after an approve the row is polled every 1 s for 5 s,
 *   every 2 s until 20 s and every 5 s until 60 s, then "İşlem sürüyor. Bitince bildireceğim."
 * Approvals are never queued offline (M§94): the client refuses with `OFFLINE_BLOCKED`.
 */
import { isApiError, qk, type ApiClient } from '@da/api-client';
import {
  approvalApproveMutationOptions,
  approvalEditMutationOptions,
  approvalProposeMutationOptions,
  approvalRejectMutationOptions,
} from '@da/api-client/react';
import type { ApprovalStatus } from '@da/domain';
import type { ApiInput } from '@da/api-client';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { getApiClient } from '../../lib/bootstrap';
import { runMutation } from '../../lib/query/run-mutation';
import { now } from '../../lib/clock';
import { rpc, toDataError } from '../../lib/postgrest';
import { getSupabase } from '../../lib/auth/supabase';
import { getQueryClient } from '../../lib/query/client';
import { installationId } from '../../lib/auth/first-run-purge';
import { runDeviceApproval } from './device-executor';
import { fromApprovalRow, fromApprovalView, isInFlight, type ApprovalModel } from './model';

export const APPROVAL_COLUMNS =
  'id, action_type, status, what, why, change_summary, exact_change, side_effects, destination_label, ' +
  'destination_account_id, executor, device_installation_id, origin, payload_version, idempotency_key, ' +
  'requires_scope, batch_id, approved_via, created_at, approval_expires_at, approved_at, rejected_at, ' +
  'executing_at, executed_at, failed_at, last_error_code, attempt_count, source_type, source_id, ' +
  'source_provider, source_timestamp, result';

export interface ApprovalPage {
  readonly items: readonly ApprovalModel[];
  readonly nextCursor: string | null;
}

/** RPC-10 `list_approvals(p_status, p_cursor, p_limit)`. */
export async function listApprovals(
  statuses: readonly ApprovalStatus[],
  cursor: string | null = null,
  limit = 30,
): Promise<ApprovalPage> {
  const data = (await rpc('list_approvals', {
    p_status: [...statuses],
    ...(cursor === null ? {} : { p_cursor: cursor }),
    p_limit: limit,
  })) as { items?: unknown[]; next_cursor?: string | null } | null;
  const items = (data?.items ?? [])
    .map((row) => fromApprovalRow(row))
    .filter((m): m is ApprovalModel => m !== null);
  return { items, nextCursor: data?.next_cursor ?? null };
}

/** One approval (`approval_actions?id=eq.`); null when RLS returns nothing. */
export async function fetchApproval(id: string): Promise<ApprovalModel | null> {
  const { data, error } = (await getSupabase()
    .from('approval_actions')
    .select(APPROVAL_COLUMNS)
    .eq('id', id)
    .maybeSingle()) as { data: unknown; error: { message?: string; code?: string } | null };
  if (error !== null) throw toDataError(error);
  return data === null ? null : fromApprovalRow(data);
}

export interface ApprovalEvent {
  readonly from: string | null;
  readonly to: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly version: number;
  readonly at: string;
}

/** `approval_events?approval_action_id=eq.{id}&order=created_at.asc` (the timeline). */
export async function fetchApprovalEvents(id: string): Promise<readonly ApprovalEvent[]> {
  const { data, error } = (await getSupabase()
    .from('approval_events')
    .select('from_status, to_status, actor, reason, payload_version, created_at')
    .eq('approval_action_id', id)
    .order('created_at', { ascending: true })) as {
    data: Record<string, unknown>[] | null;
    error: { message?: string; code?: string } | null;
  };
  if (error !== null) throw toDataError(error);
  return (data ?? []).map((row) => ({
    from: typeof row.from_status === 'string' ? row.from_status : null,
    to: String(row.to_status),
    actor: typeof row.actor === 'string' ? row.actor : '',
    reason: typeof row.reason === 'string' ? row.reason : null,
    version: typeof row.payload_version === 'number' ? row.payload_version : 1,
    at: String(row.created_at),
  }));
}

// ── Polling (R-19) ───────────────────────────────────────────────────────────

/** Poll delay after `elapsed` ms in flight, or null once 60 s passed (Part 2 §0.5). */
export function pollDelay(elapsedMs: number): number | null {
  if (elapsedMs < 5_000) return 1_000;
  if (elapsedMs < 20_000) return 2_000;
  if (elapsedMs < 60_000) return 5_000;
  return null;
}

const inFlightSince = new Map<string, number>();

/** Marks the start of the in-flight window of an approval (after the approve response). */
export function markInFlight(id: string): void {
  if (!inFlightSince.has(id)) inFlightSince.set(id, now().getTime());
}

/** Whether polling has passed its 60 s window ("İşlem sürüyor. Bitince bildireceğim."). */
export function pollingExpired(id: string): boolean {
  const since = inFlightSince.get(id);
  return since !== undefined && pollDelay(now().getTime() - since) === null;
}

export function approvalQueryOptions(id: string) {
  return queryOptions({
    queryKey: qk.approvals.detail(id),
    queryFn: () => fetchApproval(id),
    staleTime: 0,
    meta: { persist: true },
    refetchInterval: (query) => {
      const model = query.state.data;
      if (model === null || model === undefined || !isInFlight(model)) {
        inFlightSince.delete(id);
        return false;
      }
      markInFlight(id);
      const since = inFlightSince.get(id) ?? now().getTime();
      return pollDelay(now().getTime() - since) ?? false;
    },
  });
}

/** Writes a fresh model into every cache that shows it. */
export function publishApproval(model: ApprovalModel, client: QueryClient = getQueryClient()) {
  client.setQueryData(qk.approvals.detail(model.id), model);
  if (isInFlight(model)) markInFlight(model.id);
}

export function invalidateApprovals(client: QueryClient = getQueryClient()): void {
  void client.invalidateQueries({ queryKey: qk.approvals.all });
  void client.invalidateQueries({ queryKey: qk.me.bootstrap() });
  void client.invalidateQueries({ queryKey: qk.today.all });
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type ApprovedVia =
  'approval_center' | 'inline_sheet' | 'capture_batch' | 'in_place' | 'voice_card';

export type DecisionError =
  | { readonly kind: 'offline' }
  | { readonly kind: 'conflict'; readonly expired: boolean }
  | {
      readonly kind: 'scope';
      readonly accountId: string | null;
      readonly capability: string | null;
      readonly provider: 'google' | 'microsoft' | null;
    }
  | { readonly kind: 'entitlement'; readonly feature: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'failed'; readonly correlationId: string | null };

export type DecisionResult =
  | { readonly ok: true; readonly model: ApprovalModel }
  | { readonly ok: false; readonly error: DecisionError };

function decisionError(error: unknown): DecisionError {
  if (!isApiError(error)) return { kind: 'failed', correlationId: null };
  if (error.kind === 'offline' || error.code === 'OFFLINE_BLOCKED') return { kind: 'offline' };
  if (error.code === 'APPROVAL_STATE_CONFLICT' || error.code === 'STATE_CONFLICT') {
    return { kind: 'conflict', expired: error.details.status === 'expired' };
  }
  if (error.code === 'PROVIDER_SCOPE_MISSING') {
    const upgrade = (error.details.upgrade ?? {}) as Record<string, unknown>;
    const provider = upgrade.provider;
    return {
      kind: 'scope',
      accountId: typeof upgrade.account_id === 'string' ? upgrade.account_id : null,
      capability: typeof upgrade.capability === 'string' ? upgrade.capability : null,
      provider: provider === 'google' || provider === 'microsoft' ? provider : null,
    };
  }
  if (error.code === 'ENTITLEMENT_REQUIRED') {
    const feature = error.details.feature;
    return { kind: 'entitlement', feature: typeof feature === 'string' ? feature : 'pro' };
  }
  if (error.code === 'NOT_FOUND') return { kind: 'not_found' };
  return { kind: 'failed', correlationId: error.correlationId };
}

/**
 * `POST /approvals/:id/approve` with the approval's key and version (R-03). A device destination
 * approved on this installation is written right away and reported (API-APR-05).
 */
export async function approve(
  model: ApprovalModel,
  via: ApprovedVia,
  api: ApiClient = getApiClient(),
): Promise<DecisionResult> {
  try {
    const data = await runMutation(approvalApproveMutationOptions(api), {
      params: { id: model.id },
      body: {
        idempotency_key: model.idempotencyKey,
        payload_version: model.payloadVersion,
        approved_via: via,
      },
    });
    let view = data.approval;
    const execution = data.execution;
    const mine =
      view.device_installation_id !== null && view.device_installation_id === installationId();
    if (execution.mode === 'device' && (execution.device_token !== null || mine)) {
      const reported = await runDeviceApproval(api, view.id, {
        token: execution.device_token,
        instructions: execution.instructions,
      });
      if (reported !== null) view = reported;
    }
    const next = fromApprovalView(view);
    publishApproval(next);
    invalidateApprovals();
    return { ok: true, model: next };
  } catch (error) {
    return { ok: false, error: decisionError(error) };
  }
}

/** Retry of a `failed` approval: approve again with the same key (`failed → executing`). */
export function retry(model: ApprovalModel, via: ApprovedVia): Promise<DecisionResult> {
  return approve(model, via);
}

export async function reject(
  model: ApprovalModel,
  reason: 'user_reject' | 'user_cancel',
  api: ApiClient = getApiClient(),
): Promise<DecisionResult> {
  try {
    const view = await runMutation(approvalRejectMutationOptions(api), {
      input: {
        params: { id: model.id },
        body: { reason, learn: reason === 'user_reject' },
      },
      idempotencyKey: Crypto.randomUUID(),
    });
    const next = fromApprovalView(view);
    publishApproval(next);
    invalidateApprovals();
    return { ok: true, model: next };
  } catch (error) {
    return { ok: false, error: decisionError(error) };
  }
}

/** API-APR-02: a structured patch → a new payload version and key; stays `pending`. */
export async function edit(
  model: ApprovalModel,
  patch: Readonly<Record<string, unknown>>,
  api: ApiClient = getApiClient(),
): Promise<DecisionResult> {
  try {
    const view = await runMutation(approvalEditMutationOptions(api), {
      input: {
        params: { id: model.id },
        body: { expected_payload_version: model.payloadVersion, payload_patch: { ...patch } },
      },
      idempotencyKey: Crypto.randomUUID(),
    });
    const next = fromApprovalView(view);
    publishApproval(next);
    invalidateApprovals();
    return { ok: true, model: next };
  } catch (error) {
    return { ok: false, error: decisionError(error) };
  }
}

export type ProposeBody = ApiInput<'POST /approvals'>['body'];

/** API-APR-01: a new pending approval (reminders to external lists, re-proposals). */
export async function propose(
  body: ProposeBody,
  api: ApiClient = getApiClient(),
): Promise<DecisionResult> {
  try {
    const view = await runMutation(approvalProposeMutationOptions(api), {
      input: { body },
      idempotencyKey: Crypto.randomUUID(),
    });
    const next = fromApprovalView(view);
    publishApproval(next);
    invalidateApprovals();
    return { ok: true, model: next };
  } catch (error) {
    return { ok: false, error: decisionError(error) };
  }
}
