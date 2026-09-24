/**
 * The database functions the Edge Functions call, in one place (DATABASE_AND_RLS_PLAN §6, API_CONTRACTS
 * §15). Repositories call `rpc(client, DB_FN.x, args)`; the catalogue is also the checklist of
 * SQL objects this code depends on. Arguments use the documented `p_*` names.
 *
 * PostgREST exposes only the schemas listed in `supabase/config.toml` (`public`, `admin_api`), so
 * every `private` helper the Edge Functions need is called through its `public` wrapper, which only
 * `service_role` may execute.
 */
import { AppError, mapDbError } from '../errors.ts';
import type { DbClient } from './clients.ts';

export interface DbFunction {
  readonly schema: 'public' | 'private' | 'admin_api';
  readonly name: string;
  /** Documented signature, for the dependency report and error messages. */
  readonly signature: string;
}

function fn(schema: DbFunction['schema'], name: string, signature: string): DbFunction {
  return { schema, name, signature };
}

export const DB_FN = {
  // Jobs (DB §6.2)
  enqueueJob: fn(
    'public',
    'enqueue_job',
    '(p_type job_type, p_idempotency_key text, p_payload jsonb, p_user_id uuid, p_account_id uuid, p_run_after timestamptz, p_priority smallint, p_max_attempts int, p_correlation_id uuid) returns uuid',
  ),
  claimJobs: fn(
    'public',
    'claim_jobs',
    '(p_worker_id text, p_types job_type[], p_limit int, p_lease_seconds int) returns setof jobs',
  ),
  extendJobLease: fn(
    'public',
    'extend_job_lease',
    '(p_job_id uuid, p_worker_id text, p_seconds int) returns boolean',
  ),
  completeJob: fn(
    'public',
    'complete_job',
    '(p_job_id uuid, p_worker_id text, p_result jsonb) returns void',
  ),
  failJob: fn(
    'public',
    'fail_job',
    '(p_job_id uuid, p_worker_id text, p_error_code text, p_error_message text, p_retryable boolean, p_retry_after_seconds int) returns job_status',
  ),
  updateJobProgress: fn(
    'public',
    'update_job_progress',
    '(p_job_id uuid, p_worker_id text, p_progress jsonb) returns void',
  ),
  // Limits, entitlements, budgets, rate limits (DB §6.5)
  rateLimitHit: fn(
    'public',
    'rate_limit_hit',
    '(p_key text, p_limit int, p_window_seconds int) returns boolean',
  ),
  effectiveEntitlement: fn(
    'public',
    'effective_entitlement',
    '(p_user_id uuid) returns table(entitlement text, is_active boolean, source text, is_trial boolean, will_renew boolean, store_expires_at timestamptz, grant_ends_at timestamptz, active_until timestamptz)',
  ),
  getUsageSummary: fn('public', 'get_usage_summary', '() returns jsonb'),
  aiBudgetReserve: fn(
    'public',
    'ai_budget_reserve',
    '(p_user uuid, p_feature ai_feature, p_est_cost_micros bigint, p_units int) returns jsonb {allow, level, reason, reservation_id}',
  ),
  aiBudgetSettle: fn(
    'public',
    'ai_budget_settle',
    '(p_reservation_id uuid, p_ai_request_id uuid, p_actual_cost_micros bigint, p_units int, p_tokens jsonb) returns void',
  ),
  evaluateFlags: fn(
    'public',
    'evaluate_flags',
    '(p_user uuid, p_platform platform, p_app_version text) returns jsonb',
  ),
  aiBreakerState: fn(
    'public',
    'ai_breaker_state',
    '(p_provider text, p_model text) returns jsonb {open, error_rate, since}',
  ),
  userAppleSub: fn('public', 'user_apple_sub', '(p_user uuid) returns text'),
  consumeProviderQuota: fn(
    'public',
    'consume_provider_quota',
    '(p_bucket text, p_account uuid, p_units int, p_limit int, p_window_seconds int, p_provider provider default null) returns int (wait_ms)',
  ),
  auditVerifyChain: fn(
    'public',
    'audit_verify_chain',
    '(p_from bigint, p_to bigint) returns table(ok boolean, checked bigint, first_bad_seq bigint)',
  ),
  auditLogAppend: fn(
    'public',
    'audit_log_append',
    '(p_actor_type text, p_actor_id uuid, p_actor_role text, p_action text, p_target_type text, p_target_id text, p_target_user_id uuid, p_reason text, p_result text, p_details jsonb, p_correlation_id uuid, p_ip_hash bytea) returns bigint',
  ),
  // Admin gateway (DB §6.10, BACKOFFICE_PLAN §2.6)
  adminAuthorize: fn('admin_api', 'authorize', '(p_permission text) returns jsonb'),
  // Approvals, reminders (DB §6.6; migration 20260924002100)
  createApproval: fn(
    'public',
    'create_approval',
    '(p_user uuid, p_row jsonb, p_actor text) returns approval_actions',
  ),
  transitionApproval: fn(
    'public',
    'transition_approval',
    '(p_id uuid, p_to approval_status, p_actor text, p_actor_id uuid, p_idempotency_key text, p_reason text, p_result jsonb, p_error_code text, p_error_message text, p_via approval_via, p_device_token_hash bytea) returns approval_actions',
  ),
  editApprovalPayload: fn(
    'public',
    'edit_approval_payload',
    '(p_id uuid, p_user uuid, p_payload jsonb, p_payload_hash bytea, p_change_summary text, p_exact_change jsonb) returns approval_actions',
  ),
  startDeviceExecution: fn(
    'public',
    'start_device_execution',
    '(p_id uuid, p_user uuid, p_installation uuid, p_token_hash bytea) returns approval_actions',
  ),
  scheduleReminder: fn(
    'public',
    'schedule_reminder',
    '(p_user uuid, p_row jsonb) returns jsonb {created, reminder}',
  ),
  cancelReminder: fn(
    'public',
    'cancel_reminder',
    '(p_user uuid, p_id uuid, p_reason text) returns reminders',
  ),
  accountCan: fn('public', 'account_can', '(p_account uuid, p_cap capability) returns boolean'),
  planLimitValue: fn('public', 'plan_limit', '(p_user uuid, p_key text) returns jsonb'),
  upsertLearnedPreference: fn(
    'public',
    'upsert_learned_preference',
    '(p_user uuid, p_target_type text, p_target_ref text, p_group_key text, p_effect jsonb, p_evidence_delta int, p_statement text) returns uuid',
  ),
  tryLockCredentialRefresh: fn(
    'public',
    'try_lock_credential_refresh',
    '(p_account uuid, p_owner text, p_seconds int) returns boolean',
  ),
} as const satisfies Record<string, DbFunction>;

export type DbFunctionName = keyof typeof DB_FN;

/**
 * Calls a database function through PostgREST and maps errors (`mapDbError`). `schema` selects the
 * PostgREST profile (`Accept-Profile` / `Content-Profile`).
 */
export async function rpc<T>(
  client: DbClient,
  target: DbFunction,
  args: Record<string, unknown> = {},
): Promise<T> {
  const scoped = target.schema === 'public' ? client : client.schema(target.schema);
  const { data, error } = await scoped.rpc(target.name, args);
  if (error !== null) throw mapDbError(error);
  return data as T;
}

/** Like `rpc` but keeps the raw database error for callers that branch on SQL messages. */
export async function rpcRaw<T>(
  client: DbClient,
  target: DbFunction,
  args: Record<string, unknown> = {},
): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  const scoped = target.schema === 'public' ? client : client.schema(target.schema);
  const { data, error } = await scoped.rpc(target.name, args);
  return { data: (data as T | null) ?? null, error };
}

/** Guards `select … single()` style lookups: an absent row is `NOT_FOUND`. */
export function requireRow<T>(row: T | null | undefined): T {
  if (row === null || row === undefined) throw new AppError('NOT_FOUND');
  return row;
}
