/**
 * The `admin_api` SQL functions called by `admin-api` (DATABASE_AND_RLS_PLAN §6.10, API_CONTRACTS
 * §12.3), keyed by their SQL name. Every one runs its admin guard first (gateway header, `aal2`,
 * active admin, permission, live session) and is listed in `private.admin_function_permissions`;
 * `login_preflight`, `login_attempt_record`, `invite_redeem` and `health_record` are service-role only.
 * Generated from the migrations (`admin-api/tests/catalogue.test.ts` checks the set).
 */
import type { DbFunction } from './functions.ts';

function fn(name: string, signature: string): DbFunction {
  return { schema: 'admin_api', name, signature };
}

export const ADMIN_API_FN = {
  admin_disable: fn('admin_disable', '(p_user uuid, p_reason text) returns jsonb'),
  admin_enable: fn('admin_enable', '(p_user uuid, p_reason text) returns jsonb'),
  admin_invite_record: fn(
    'admin_invite_record',
    '(p_user uuid, p_email extensions.citext, p_role public.admin_role, p_display_name text, p_reason text, p_token_hash bytea) returns jsonb',
  ),
  admin_invite_rotate: fn(
    'admin_invite_rotate',
    '(p_user uuid, p_token_hash bytea, p_reason text) returns jsonb',
  ),
  admin_me: fn('admin_me', '(p_activity boolean default true) returns jsonb'),
  admin_mfa_reset: fn('admin_mfa_reset', '(p_user uuid, p_reason text) returns jsonb'),
  admin_preferences_get: fn('admin_preferences_get', '() returns jsonb'),
  admin_preferences_set: fn(
    'admin_preferences_set',
    '(p_theme text default null, p_locale text default null, p_table_prefs jsonb default null, p_dashboard_range text default null, p_timezone text default null, p_density text default null, p_recent_items jsonb default null, p_sidebar_collapsed boolean default null) returns jsonb',
  ),
  admin_session_end: fn(
    'admin_session_end',
    "(p_scope text default 'current', p_reason text default null) returns jsonb",
  ),
  admin_session_start: fn(
    'admin_session_start',
    '(p_ip_hash bytea default null, p_user_agent text default null) returns jsonb',
  ),
  admin_session_step_up: fn('admin_session_step_up', '() returns jsonb'),
  admin_sessions_revoke_all: fn(
    'admin_sessions_revoke_all',
    '(p_user uuid, p_reason text) returns jsonb',
  ),
  admin_unlock: fn(
    'admin_unlock',
    '(p_user uuid, p_reason text, p_email_hash text default null) returns jsonb',
  ),
  admin_update_role: fn(
    'admin_update_role',
    '(p_user uuid, p_role public.admin_role, p_reason text) returns jsonb',
  ),
  admins_list: fn('admins_list', '() returns jsonb'),
  ai_calibration_activate: fn(
    'ai_calibration_activate',
    '(p_id uuid, p_reason text) returns jsonb',
  ),
  ai_cost_series: fn(
    'ai_cost_series',
    "(p_range text, p_split text default 'feature') returns jsonb",
  ),
  ai_feedback_aggregate: fn(
    'ai_feedback_aggregate',
    "(p_range text, p_group text default 'feature') returns jsonb",
  ),
  ai_feedback_list: fn(
    'ai_feedback_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  ai_feedback_reveal_comment: fn(
    'ai_feedback_reveal_comment',
    '(p_id uuid, p_reason text) returns jsonb',
  ),
  ai_metrics: fn('ai_metrics', "(p_range text, p_group text default 'feature') returns jsonb"),
  ai_model_config_list: fn('ai_model_config_list', '() returns jsonb'),
  ai_model_config_update: fn(
    'ai_model_config_update',
    '(p_profile public.routing_profile, p_role text, p_feature public.ai_feature, p_provider text, p_model text, p_params jsonb, p_fallback_targets jsonb, p_escalation_target jsonb, p_enabled boolean, p_expected_version integer, p_reason text, p_batch_policy text default null, p_cache_ttl text default null, p_max_input_tokens integer default null, p_clear_escalation boolean default false, p_clear_cache_ttl boolean default false) returns jsonb',
  ),
  ai_model_prices_list: fn('ai_model_prices_list', '() returns jsonb'),
  ai_model_prices_upsert: fn(
    'ai_model_prices_upsert',
    '(p_provider text, p_model text, p_prices jsonb, p_effective_from timestamptz, p_reason text) returns jsonb',
  ),
  ai_requests_list: fn(
    'ai_requests_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  announcement_audience_estimate: fn(
    'announcement_audience_estimate',
    '(p_audience text, p_platforms public.platform[] default null, p_min_version text default null, p_max_version text default null) returns jsonb',
  ),
  announcement_cancel: fn('announcement_cancel', '(p_id uuid, p_reason text) returns jsonb'),
  announcement_get: fn('announcement_get', '(p_id uuid) returns jsonb'),
  announcement_publish: fn(
    'announcement_publish',
    '(p_id uuid, p_reason text, p_now_live boolean default false) returns jsonb',
  ),
  announcement_upsert: fn(
    'announcement_upsert',
    '(p_id uuid, p_fields jsonb, p_reason text) returns jsonb',
  ),
  announcements_list: fn(
    'announcements_list',
    "(p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  app_versions_breakdown: fn(
    'app_versions_breakdown',
    "(p_range text default '30d') returns jsonb",
  ),
  audit_denied: fn('audit_denied', '(p_route text, p_permission text) returns bigint'),
  audit_get: fn('audit_get', '(p_id bigint) returns jsonb'),
  audit_list: fn(
    'audit_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  audit_verify: fn(
    'audit_verify',
    '(p_from bigint default null, p_to bigint default null) returns jsonb',
  ),
  audit_write: fn(
    'audit_write',
    "(p_action text, p_target_type text, p_target_id text, p_target_user_id uuid, p_reason text, p_result text, p_details jsonb default '{}'::jsonb, p_idem text default null) returns bigint",
  ),
  auth_status: fn('auth_status', '() returns jsonb'),
  authorize: fn('authorize', '(p_permission text) returns jsonb'),
  billing_event_get: fn('billing_event_get', '(p_id bigint) returns jsonb'),
  billing_events_list: fn(
    'billing_events_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  briefing_regenerate: fn('briefing_regenerate', '(p_briefing uuid, p_reason text) returns jsonb'),
  briefings_list: fn(
    'briefings_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  briefings_metrics: fn(
    'briefings_metrics',
    '(p_range text, p_kind public.briefing_kind default null) returns jsonb',
  ),
  command_search: fn('command_search', '(p_q text) returns jsonb'),
  correlation_trace: fn('correlation_trace', '(p_correlation_id uuid) returns jsonb'),
  cron_status: fn('cron_status', '() returns jsonb'),
  dashboard_metrics: fn('dashboard_metrics', '(p_range text) returns jsonb'),
  dashboard_series: fn('dashboard_series', '(p_metric text, p_range text) returns jsonb'),
  data_request_cancel: fn(
    'data_request_cancel',
    '(p_kind text, p_id uuid, p_reason text) returns jsonb',
  ),
  data_request_get: fn('data_request_get', '(p_kind text, p_id uuid) returns jsonb'),
  data_request_retry: fn(
    'data_request_retry',
    '(p_kind text, p_id uuid, p_reason text) returns jsonb',
  ),
  data_requests_list: fn(
    'data_requests_list',
    "(p_kind text, p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  entitlement_grant: fn(
    'entitlement_grant',
    '(p_user uuid, p_days integer, p_source public.grant_source, p_reason text, p_idempotency_key text default null) returns jsonb',
  ),
  entitlement_grants_list: fn(
    'entitlement_grants_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  entitlement_revoke: fn('entitlement_revoke', '(p_grant uuid, p_reason text) returns jsonb'),
  export_regenerate: fn('export_regenerate', '(p_id uuid, p_reason text) returns jsonb'),
  feedback_list: fn(
    'feedback_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  feedback_reveal: fn('feedback_reveal', '(p_id uuid, p_reason text) returns jsonb'),
  feedback_summary: fn(
    'feedback_summary',
    "(p_range text, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  feedback_update: fn(
    'feedback_update',
    '(p_id uuid, p_status text default null, p_assignee uuid default null, p_reason text default null) returns jsonb',
  ),
  flag_archive: fn('flag_archive', '(p_key text, p_reason text) returns jsonb'),
  flag_evaluate_preview: fn(
    'flag_evaluate_preview',
    '(p_key text, p_user uuid, p_platform public.platform default null, p_app_version text default null) returns jsonb',
  ),
  flag_get: fn('flag_get', '(p_key text) returns jsonb'),
  flag_kill: fn(
    'flag_kill',
    '(p_key text, p_reason text, p_on boolean default true) returns jsonb',
  ),
  flag_override_delete: fn(
    'flag_override_delete',
    '(p_key text, p_user uuid, p_reason text) returns jsonb',
  ),
  flag_override_set: fn(
    'flag_override_set',
    '(p_key text, p_user uuid, p_value boolean, p_reason text, p_expires timestamptz default null) returns jsonb',
  ),
  flag_upsert: fn(
    'flag_upsert',
    '(p_key text, p_description text, p_enabled boolean, p_rollout integer, p_platforms public.platform[], p_plans text[], p_min_ver text, p_max_ver text, p_payload jsonb, p_reason text) returns jsonb',
  ),
  flags_list: fn('flags_list', "(p_filter jsonb default '{}'::jsonb) returns jsonb"),
  health_history: fn(
    'health_history',
    "(p_component text, p_range text default '24h') returns jsonb",
  ),
  health_latest: fn('health_latest', '() returns jsonb'),
  health_record: fn(
    'health_record',
    "(p_component text, p_status text, p_latency_ms integer default null, p_detail jsonb default '{}'::jsonb, p_checked_by text default 'cron') returns bigint",
  ),
  integration_detail: fn('integration_detail', '(p_account uuid) returns jsonb'),
  integration_disconnect: fn(
    'integration_disconnect',
    '(p_account uuid, p_reason text, p_purge_content boolean default false) returns jsonb',
  ),
  integration_renew_watch: fn(
    'integration_renew_watch',
    '(p_account uuid, p_reason text) returns jsonb',
  ),
  integrations_overview: fn(
    'integrations_overview',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  integrations_summary: fn('integrations_summary', "(p_range text default '7d') returns jsonb"),
  invite_redeem: fn('invite_redeem', '(p_token_hash bytea) returns jsonb'),
  job_cancel: fn('job_cancel', '(p_job uuid, p_reason text) returns jsonb'),
  job_detail: fn('job_detail', '(p_job uuid) returns jsonb'),
  job_retry: fn(
    'job_retry',
    '(p_job uuid, p_reason text, p_reset_attempts boolean default false) returns jsonb',
  ),
  job_retry_bulk: fn(
    'job_retry_bulk',
    '(p_type public.job_type, p_status public.job_status, p_reason text, p_max integer default 100, p_from timestamptz default null, p_to timestamptz default null) returns jsonb',
  ),
  jobs_list: fn(
    'jobs_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  jobs_summary: fn('jobs_summary', "(p_range text default '24h') returns jsonb"),
  login_attempt_record: fn(
    'login_attempt_record',
    '(p_email extensions.citext, p_email_hash text, p_ip_hash text, p_kind text, p_success boolean) returns jsonb',
  ),
  login_preflight: fn(
    'login_preflight',
    '(p_email extensions.citext, p_email_hash text, p_ip_hash text) returns jsonb',
  ),
  metrics_ops: fn('metrics_ops', '(p_range text) returns jsonb'),
  metrics_product: fn('metrics_product', '(p_range text) returns jsonb'),
  notification_send_test: fn(
    'notification_send_test',
    '(p_user uuid, p_reason text, p_installation uuid default null) returns jsonb',
  ),
  notifications_metrics: fn(
    'notifications_metrics',
    '(p_range text, p_category public.notification_category default null) returns jsonb',
  ),
  notifications_user_debug: fn(
    'notifications_user_debug',
    "(p_user uuid, p_page integer default 1, p_page_size integer default 25, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  plan_limits_list: fn('plan_limits_list', '() returns jsonb'),
  plan_limits_update: fn(
    'plan_limits_update',
    '(p_plan text, p_key text, p_value jsonb, p_reason text) returns jsonb',
  ),
  plan_routing_profile_set: fn(
    'plan_routing_profile_set',
    '(p_plan text, p_profile public.routing_profile, p_reason text) returns jsonb',
  ),
  prompt_activate: fn('prompt_activate', '(p_version uuid, p_reason text) returns jsonb'),
  prompt_archive: fn('prompt_archive', '(p_version uuid, p_reason text) returns jsonb'),
  prompt_create_draft: fn(
    'prompt_create_draft',
    '(p_key text, p_from_version integer default null, p_system_prompt text default null, p_user_template text default null, p_output_schema_ref text default null, p_notes text default null) returns jsonb',
  ),
  prompt_diff: fn('prompt_diff', '(p_a uuid, p_b uuid) returns jsonb'),
  prompt_rollback: fn(
    'prompt_rollback',
    '(p_key text, p_version integer, p_reason text) returns jsonb',
  ),
  prompt_update_draft: fn(
    'prompt_update_draft',
    '(p_key text, p_version integer, p_system_prompt text default null, p_user_template text default null, p_output_schema_ref text default null, p_notes text default null, p_changelog text default null) returns jsonb',
  ),
  prompt_version_get: fn('prompt_version_get', '(p_key text, p_version integer) returns jsonb'),
  prompt_versions_list: fn(
    'prompt_versions_list',
    "(p_key text, p_range text default '30d') returns jsonb",
  ),
  prompts_list: fn('prompts_list', '() returns jsonb'),
  recovery_code_consume: fn('recovery_code_consume', '(p_code_hash bytea) returns jsonb'),
  recovery_codes_store: fn('recovery_codes_store', '(p_code_hashes bytea[]) returns integer'),
  referral_review: fn(
    'referral_review',
    '(p_referral uuid, p_decision text, p_reason text) returns jsonb',
  ),
  referrals_list: fn(
    'referrals_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  referrals_metrics: fn('referrals_metrics', '(p_range text) returns jsonb'),
  security_events: fn('security_events', '(p_range text) returns jsonb'),
  session_expire: fn('session_expire', '() returns jsonb'),
  sessions_list_own: fn('sessions_list_own', '() returns jsonb'),
  settings_get: fn('settings_get', '() returns jsonb'),
  settings_update: fn(
    'settings_update',
    '(p_key text, p_value jsonb, p_reason text) returns jsonb',
  ),
  subscription_resync: fn('subscription_resync', '(p_user uuid, p_reason text) returns jsonb'),
  subscriptions_list: fn(
    'subscriptions_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  subscriptions_metrics: fn('subscriptions_metrics', '(p_range text) returns jsonb'),
  support_access_authorize: fn(
    'support_access_authorize',
    '(p_grant uuid, p_scope public.support_access_scope, p_resource_type text, p_resource_id uuid, p_reason text) returns jsonb',
  ),
  support_access_grant: fn(
    'support_access_grant',
    '(p_user uuid, p_scope public.support_access_scope[], p_reason text, p_minutes integer, p_ticket uuid default null) returns jsonb',
  ),
  support_access_revoke: fn('support_access_revoke', '(p_grant uuid, p_reason text) returns jsonb'),
  ticket_add_note: fn('ticket_add_note', '(p_id uuid, p_body text) returns jsonb'),
  ticket_detail: fn('ticket_detail', '(p_id uuid) returns jsonb'),
  ticket_patch: fn(
    'ticket_patch',
    '(p_id uuid, p_status public.ticket_status default null, p_category public.ticket_category default null, p_assignee uuid default null, p_unassign boolean default false) returns jsonb',
  ),
  ticket_reply: fn(
    'ticket_reply',
    "(p_id uuid, p_body text, p_locale text default 'tr') returns jsonb",
  ),
  ticket_update: fn(
    'ticket_update',
    '(p_id uuid, p_status public.ticket_status default null, p_assignee uuid default null, p_priority text default null, p_reason text default null) returns jsonb',
  ),
  tickets_list: fn(
    'tickets_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  trial_stream: fn(
    'trial_stream',
    "(p_range text, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  user_audit: fn(
    'user_audit',
    "(p_user uuid, p_page integer default 1, p_page_size integer default 25, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
  user_briefings: fn(
    'user_briefings',
    "(p_user uuid, p_filter jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 25) returns jsonb",
  ),
  user_devices: fn('user_devices', '(p_user uuid) returns jsonb'),
  user_disable: fn('user_disable', '(p_user uuid, p_reason text) returns jsonb'),
  user_force_sync: fn(
    'user_force_sync',
    '(p_user uuid, p_account uuid default null, p_reason text default null, p_resources text[] default null) returns jsonb',
  ),
  user_integrations: fn('user_integrations', '(p_user uuid) returns jsonb'),
  user_lookup_email: fn('user_lookup_email', '(p_email extensions.citext) returns jsonb'),
  user_mark_internal: fn(
    'user_mark_internal',
    '(p_user uuid, p_internal boolean, p_reason text) returns jsonb',
  ),
  user_overview: fn('user_overview', '(p_user uuid) returns jsonb'),
  user_referrals: fn('user_referrals', '(p_user uuid) returns jsonb'),
  user_restore: fn('user_restore', '(p_user uuid, p_reason text) returns jsonb'),
  user_reveal_email: fn(
    'user_reveal_email',
    "(p_user uuid, p_reason text, p_field text default 'email') returns jsonb",
  ),
  user_subscription: fn('user_subscription', '(p_user uuid) returns jsonb'),
  user_support: fn('user_support', '(p_user uuid) returns jsonb'),
  user_usage: fn('user_usage', "(p_user uuid, p_range text default '30d') returns jsonb"),
  users_list: fn(
    'users_list',
    "(p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb) returns jsonb",
  ),
} as const satisfies Record<string, DbFunction>;

export type AdminApiFunctionName = keyof typeof ADMIN_API_FN;
