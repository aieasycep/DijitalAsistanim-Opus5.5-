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
  // Business: entitlement gates, RevenueCat mirror, referrals (T-7.01…T-7.03; migrations 2200/2210)
  checkPlanLimit: fn(
    'public',
    'check_plan_limit',
    '(p_key text, p_increment int, p_user_id uuid) returns jsonb {key, allowed, limit?, used?, plan, resets_at?}',
  ),
  planLimit: fn('public', 'plan_limit', '(p_user uuid, p_key text) returns jsonb'),
  recordBillingEvent: fn(
    'public',
    'record_billing_event',
    '(p_event_id text, p_event_type text, p_app_user_id text, p_environment text, p_store text, p_product_id text, p_event_timestamp timestamptz, p_transferred_from text[], p_transferred_to text[], p_payload jsonb, p_payload_digest bytea, p_sync_ids text[], p_correlation_id uuid) returns jsonb {inserted, billing_event_id?, user_id?, jobs}',
  ),
  billingSyncContext: fn(
    'public',
    'billing_sync_context',
    '(p_app_user_id text, p_event_id text) returns jsonb {user_id, sandbox_allowed, locale, event, mirror}',
  ),
  billingMarkEvent: fn(
    'public',
    'billing_mark_event',
    '(p_event_id text, p_status text) returns void',
  ),
  billingApplyMirror: fn(
    'public',
    'billing_apply_mirror',
    '(p_user uuid, p_rc_app_user_id text, p_snapshot jsonb, p_event_id text) returns jsonb {skipped, previous, current, event_type, effective_before, effective_after}',
  ),
  ensureReferralCode: fn(
    'public',
    'ensure_referral_code',
    '(p_user uuid, p_candidate text) returns text',
  ),
  referralOverview: fn(
    'public',
    'referral_overview',
    '(p_user uuid, p_now timestamptz) returns jsonb',
  ),
  referralApplyContext: fn(
    'public',
    'referral_apply_context',
    '(p_referee uuid, p_code text, p_installation uuid) returns jsonb {code_owner, referee, owner}',
  ),
  applyReferral: fn(
    'public',
    'apply_referral',
    '(p_referee uuid, p_referrer uuid, p_code text, p_source text, p_device_hash bytea, p_email_hash bytea, p_signals jsonb, p_run_after timestamptz, p_correlation_id uuid) returns jsonb {referral_id, status, applied_at}',
  ),
  referralEvaluationContext: fn(
    'public',
    'referral_evaluation_context',
    '(p_referral_id uuid, p_now timestamptz) returns jsonb',
  ),
  referralTombstoneMatch: fn(
    'public',
    'referral_tombstone_match',
    '(p_signals jsonb) returns boolean',
  ),
  referralDecide: fn(
    'public',
    'referral_decide',
    '(p_referral_id uuid, p_decision text, p_reject_reason text, p_risk_score int, p_assessment jsonb, p_qualification jsonb, p_correlation_id uuid) returns jsonb',
  ),
  // public-api (T-9.04/T-9.05 backend; migration 2220)
  publicSupportTicket: fn(
    'public',
    'public_support_ticket',
    '(p_email citext, p_name text, p_category ticket_category, p_subject text, p_message text) returns jsonb {id, reference, duplicate}',
  ),
  supportInboundNote: fn(
    'public',
    'support_inbound_note',
    '(p_message_id text, p_reference text, p_sender citext, p_body text, p_digest bytea) returns jsonb {stored, reason?}',
  ),
  publicDeletionSubject: fn(
    'public',
    'public_deletion_subject',
    '(p_email citext) returns jsonb {user_id, is_admin, state} | null',
  ),
  publicOtpLockSeconds: fn(
    'public',
    'public_otp_lock_seconds',
    '(p_subject text, p_lock_seconds int) returns int',
  ),
  publicOtpRecordFailure: fn(
    'public',
    'public_otp_record_failure',
    '(p_subject text, p_max int, p_window_seconds int, p_lock_seconds int) returns jsonb {locked, failures, retry_after}',
  ),
  createDeletionRequest: fn(
    'public',
    'create_deletion_request',
    '(p_user uuid, p_kind deletion_kind, p_origin text, p_confirmation text, p_status_token_hash bytea, p_subject_email_hash bytea, p_scope text, p_account uuid, p_source text, p_correlation_id uuid) returns jsonb {request_id, status, created, created_at, job_id}',
  ),
  publicSubscriptionActive: fn(
    'public',
    'public_subscription_active',
    '(p_user uuid) returns boolean',
  ),
  publicDeletionStatus: fn(
    'public',
    'public_deletion_status',
    '(p_request_id uuid) returns jsonb | null',
  ),
  publicPlans: fn('public', 'public_plans', '() returns jsonb {free, pricing, updated_at}'),
  publicReferralResolve: fn(
    'public',
    'public_referral_resolve',
    '(p_code text) returns jsonb {valid, reward_days, apply_window_days}',
  ),
  webAnalyticsIncrement: fn(
    'public',
    'web_analytics_increment',
    '(p_day date, p_event text, p_dims jsonb) returns void',
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
  // Integrations (migration 20260924002000; IMPLEMENTATION_PLAN T-4.01…T-4.13); accountCan is above.
  tryLockCredentialRefresh: fn(
    'public',
    'try_lock_credential_refresh',
    '(p_account uuid, p_owner text, p_seconds int) returns boolean',
  ),
  accountPausedByPlan: fn('public', 'account_paused_by_plan', '(p_account uuid) returns boolean'),
  acquireSyncLease: fn(
    'public',
    'acquire_sync_lease',
    '(p_sync_state uuid, p_owner text, p_seconds int) returns boolean',
  ),
  releaseSyncLease: fn(
    'public',
    'release_sync_lease',
    '(p_sync_state uuid, p_owner text) returns void',
  ),
  oauthCallbackStore: fn(
    'public',
    'oauth_callback_store',
    '(p_state_id uuid, p_state jsonb, p_account jsonb, p_credentials jsonb) returns jsonb',
  ),
  oauthCompleteBinding: fn(
    'public',
    'oauth_complete_binding',
    '(p_state_id uuid, p_user uuid, p_account_id uuid, p_account jsonb, p_credentials jsonb) returns jsonb',
  ),
  oauthCloseFlow: fn(
    'public',
    'oauth_close_flow',
    '(p_state_id uuid, p_result text, p_error_code text) returns jsonb',
  ),
  upsertMailMessages: fn(
    'public',
    'upsert_mail_messages',
    '(p_account uuid, p_messages jsonb) returns jsonb [{id, provider_message_id, thread_id, inserted}]',
  ),
  applyMailChanges: fn(
    'public',
    'apply_mail_changes',
    '(p_account uuid, p_label_changes jsonb, p_deleted text[]) returns jsonb',
  ),
  upsertCalendarEvents: fn(
    'public',
    'upsert_calendar_events',
    '(p_account uuid, p_calendar uuid, p_events jsonb, p_origin text) returns jsonb',
  ),
  markCalendarEventsDeleted: fn(
    'public',
    'mark_calendar_events_deleted',
    '(p_calendar uuid, p_provider_event_ids text[]) returns int',
  ),
  pruneCalendarEvents: fn(
    'public',
    'prune_calendar_events',
    '(p_calendar uuid, p_since timestamptz, p_window_start timestamptz, p_window_end timestamptz) returns int',
  ),
  upsertCalendars: fn(
    'public',
    'upsert_calendars',
    '(p_account uuid, p_calendars jsonb) returns jsonb {calendars, missing}',
  ),
  upsertTasks: fn('public', 'upsert_tasks', '(p_account uuid, p_tasks jsonb) returns jsonb'),
  upsertDeviceAccount: fn(
    'public',
    'upsert_device_account',
    '(p_user uuid, p_provider provider, p_installation uuid, p_capabilities capability[]) returns jsonb',
  ),
  stageDeviceSnapshot: fn(
    'public',
    'stage_device_snapshot',
    '(p_account uuid, p_snapshot jsonb) returns uuid',
  ),
  applyStagedDeviceSnapshot: fn(
    'public',
    'apply_staged_device_snapshot',
    '(p_account uuid, p_content_hash text) returns jsonb',
  ),
  disconnectIntegration: fn(
    'public',
    'disconnect_integration',
    '(p_account uuid, p_user uuid, p_revocation_mode text, p_purge_content boolean, p_correlation_id uuid) returns jsonb',
  ),
  integrationPurgeBatch: fn(
    'public',
    'integration_purge_batch',
    '(p_account uuid, p_disconnected_at timestamptz, p_purge_derived boolean, p_batch int, p_reason text) returns jsonb',
  ),
  demoStateGet: fn('public', 'demo_state_get', '(p_account uuid) returns jsonb'),
  demoStateRecordWrite: fn(
    'public',
    'demo_state_record_write',
    '(p_account uuid, p_resource text, p_key text, p_item jsonb) returns jsonb {created, item}',
  ),
  demoStateSetClock: fn(
    'public',
    'demo_state_set_clock',
    '(p_account uuid, p_resource text, p_clock timestamptz) returns void',
  ),
  // AI pipeline part 1 (T-5.01…T-5.08, T-5.17; migration 20260924002400)
  searchUserContent: fn(
    'public',
    'search_user_content',
    '(p_query text, p_query_embedding vector(1024), p_types text[], p_from timestamptz, p_to timestamptz, p_contact_id uuid, p_cursor text, p_limit int) returns table(result_type, entity_id, title, snippet, source_type, source_id, source_provider, source_timestamp, score)',
  ),
  upsertContactsFromPeople: fn(
    'public',
    'upsert_contacts_from_people',
    '(p_user uuid, p_people jsonb) returns jsonb {email: contact_id}',
  ),
  linkContactRefs: fn(
    'public',
    'link_contact_refs',
    '(p_user uuid, p_thread_ids uuid[], p_event_ids uuid[]) returns int',
  ),
  refreshContactStats: fn(
    'public',
    'refresh_contact_stats',
    '(p_user uuid, p_contact_ids uuid[], p_now timestamptz) returns int',
  ),
  briefingEveningReady: fn(
    'public',
    'briefing_evening_ready',
    '(p_user uuid, p_briefing_id uuid, p_item_ids uuid[], p_now timestamptz) returns jsonb {ok, reason?, carried, next_morning_at, closed_at, replayed}',
  ),
  briefingRetry: fn(
    'public',
    'briefing_retry',
    '(p_user uuid, p_briefing_id uuid, p_now timestamptz) returns jsonb {ok, reason?, briefing_id, status, job_id, job_status}',
  ),
  nextMorningBriefingAt: fn(
    'public',
    'next_morning_briefing_at',
    '(p_user uuid, p_after_date date) returns timestamptz',
  ),
  aiOrgBudgetEvaluate: fn(
    'public',
    'ai_org_budget_evaluate',
    '(p_now timestamptz) returns jsonb {status, spent_micros, ceiling_micros, pct, alerts, tripped}',
  ),
  aiCostByModel: fn(
    'public',
    'ai_cost_by_model',
    '(p_day date) returns jsonb [{provider, model, cost_usd_micros, requests}]',
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
