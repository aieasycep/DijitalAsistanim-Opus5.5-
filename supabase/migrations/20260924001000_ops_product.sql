-- Migration 0010 · ops and product
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.7 (jobs … web_analytics_daily), §10 row 0010;
-- ADR-04 (first-party jobs queue), R-10 (feature-flag keys), R-05 (briefing polish flag).
-- Reference data: feature_flags (exactly the R-10 key set) and app_settings.

-- ─── jobs (SYS + restrictive aal2 in 0014) ────────────────────────────────────────────────────
create table public.jobs (
  id uuid not null default gen_random_uuid(),
  type public.job_type not null,
  status public.job_status not null default 'queued',
  priority smallint not null default 100 check (priority between 0 and 1000),   -- lower runs first
  user_id uuid,                                       -- NULL for account_deletion (subject in payload)
  connected_account_id uuid,
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 8192),   -- ids only
  idempotency_key text not null check (char_length(idempotency_key) <= 200),
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text check (char_length(last_error_message) <= 500),
  correlation_id uuid not null default gen_random_uuid(),
  parent_job_id uuid,
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_pkey primary key (id),
  constraint jobs_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint jobs_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint jobs_parent_job_id_fkey foreign key (parent_job_id) references public.jobs (id) on delete set null,
  constraint jobs_idempotency_key_key unique (idempotency_key)
);
create index jobs_claim_idx on public.jobs (priority, run_after) where status in ('queued', 'retrying');
create index jobs_type_status_run_after_idx on public.jobs (type, status, run_after);
create index jobs_lease_expires_at_p on public.jobs (lease_expires_at) where status = 'running';
create index jobs_user_id_created_at_idx on public.jobs (user_id, created_at desc);
create index jobs_correlation_id_idx on public.jobs (correlation_id);
create index jobs_status_updated_at_p on public.jobs (status, updated_at) where status in ('failed', 'dead_letter');
create index jobs_connected_account_id_idx on public.jobs (connected_account_id);
create index jobs_parent_job_id_idx on public.jobs (parent_job_id);
create trigger trg_jobs_updated_at before update on public.jobs
  for each row execute function private.set_updated_at();
alter table public.jobs enable row level security;
alter table public.jobs force row level security;
comment on table public.jobs is
  'First-party job queue: idempotent keys, leases, backoff with jitter, dead letter (ADR-04, M§53, §127). System table.';

-- ─── job_attempts (SYS) ───────────────────────────────────────────────────────────────────────
create table public.job_attempts (
  id bigint generated always as identity,
  job_id uuid not null,
  attempt integer not null,
  user_id uuid,
  worker_id text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text check (outcome in ('completed', 'failed', 'retrying', 'timeout', 'lease_lost', 'dead_letter')),
  error_code text,
  error_message text check (char_length(error_message) <= 500),
  duration_ms integer,
  constraint job_attempts_pkey primary key (id),
  constraint job_attempts_job_id_fkey foreign key (job_id) references public.jobs (id) on delete cascade,
  constraint job_attempts_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null,
  constraint job_attempts_job_id_attempt_key unique (job_id, attempt)
);
create index job_attempts_user_id_idx on public.job_attempts (user_id);
alter table public.job_attempts enable row level security;
alter table public.job_attempts force row level security;
comment on table public.job_attempts is 'Per-attempt job history with sanitized errors (M§53). System table.';

-- ─── analytics_events (SYS) ───────────────────────────────────────────────────────────────────
create table public.analytics_events (
  id bigint generated always as identity,
  user_id uuid,
  installation_id uuid,
  session_id uuid,
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_]{2,63}$'),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 2048),
  platform text check (platform in ('ios', 'android', 'web', 'backoffice')),
  app_version text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint analytics_events_pkey primary key (id),
  constraint analytics_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null
);
create index analytics_events_occurred_at_idx on public.analytics_events (occurred_at);
create index analytics_events_event_name_occurred_at_idx on public.analytics_events (event_name, occurred_at);
create index analytics_events_user_id_occurred_at_p on public.analytics_events (user_id, occurred_at)
  where user_id is not null;
alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;
comment on table public.analytics_events is
  'First-party, allow-listed, content-free product analytics (M§42, §119; ADR-13). System table.';

-- ─── feature_flags (SYS) ──────────────────────────────────────────────────────────────────────
create table public.feature_flags (
  key text not null check (key ~ '^[a-z][a-z0-9_.]{2,63}$'),
  description text not null,
  enabled boolean not null default false,
  is_kill_switch boolean not null default false,
  rollout_percentage smallint not null default 100 check (rollout_percentage between 0 and 100),
  platforms public.platform[],
  plans text[] check (plans <@ '{free,pro}'::text[]),
  min_app_version text,
  max_app_version text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_by uuid,                                    -- FK → admin_users (0012)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_flags_pkey primary key (key)
);
create trigger trg_feature_flags_updated_at before update on public.feature_flags
  for each row execute function private.set_updated_at();
alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
comment on table public.feature_flags is
  'Flags and kill switches with targeting (M§63); evaluated by private.evaluate_flags and returned by /me/bootstrap. System table.';

-- Seed: exactly the R-10 keys (ai.feature.<name> once per ai_feature value, plus briefing_polish).
insert into public.feature_flags (key, description, enabled, is_kill_switch, payload) values
  ('ai.global.enabled', 'Global AI kill switch; off routes every AI feature to its T0 path.', true, true, '{}'),
  ('ai.provider.anthropic.enabled', 'Anthropic provider kill switch; off skips Anthropic targets in every route.', true, true, '{}'),
  ('ai.provider.openai.enabled', 'OpenAI provider kill switch; off skips OpenAI targets in every route.', true, true, '{}'),
  ('ai.provider.voyage.enabled', 'Voyage provider kill switch; off degrades search to FTS only.', true, true, '{}'),
  ('ai.feature.briefing_polish', 'Optional single-sentence T1 polish of midday and evening briefings (R-05).', false, false, '{}'),
  ('ai.model.large.enabled', 'Large-model (T2) switch; off rewrites T2 primaries to the first T1 fallback.', true, true, '{}'),
  ('ai.model.opus_escalation', 'T3 escalation for verification failures, dense vision and low citation coverage.', false, false, '{}'),
  ('ai.batch.enabled', 'Message Batches for non-urgent AI work.', true, true, '{}'),
  ('ai.backfill.enabled', 'AI analysis of backfilled (older) mail.', true, true, '{}'),
  ('ai.budget.org_daily_usd', 'Organisation daily AI ceiling in USD; at 100% health_check trips ai.model.large.enabled and ai.model.opus_escalation.', true, false, '{"usd": 50}'),
  ('voice.stt_server', 'Server speech-to-text fallback when on-device recognition is unavailable.', true, false, '{}'),
  ('voice.tts_premium', 'Premium text-to-speech adapters for audio briefings (requires a premium TTS credential).', false, false, '{}'),
  ('feature.midday', 'Midday briefing (Pro).', true, false, '{}'),
  ('feature.evening', 'Evening briefing (Pro).', true, false, '{}'),
  ('feature.voice', 'Voice assistant and audio briefing.', true, false, '{}'),
  ('feature.meeting_prep', 'Meeting prep and post-meeting flows (Pro).', true, false, '{}'),
  ('feature.capture', 'Universal Capture (Pro).', true, false, '{}'),
  ('feature.android_ni', 'Android Notification Intelligence (Pro, Android only); payload holds the locked denylist and default-off packages.', true, false,
   '{"denylist": ["com.google.android.apps.authenticator2", "com.azure.authenticator", "com.authy.authy",
                  "com.duosecurity.duomobile", "com.okta.android.auth", "com.twofasapp", "com.beemdevelopment.aegis",
                  "org.fedorahosted.freeotp", "com.lastpass.authenticator", "com.x8bit.bitwarden",
                  "com.agilebits.onepassword", "com.lastpass.lpandroid", "proton.android.pass", "com.proton.pass",
                  "tr.gov.turkiye.edevlet.kapisi", "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger",
                  "com.turkcell.bip", "org.thoughtcrime.securesms", "com.facebook.orca",
                  "com.google.android.apps.messaging", "com.samsung.android.messaging", "android",
                  "com.android.systemui", "com.google.android.gms", "com.google.android.dialer",
                  "com.samsung.android.dialer", "com.dijitalasistan.app"],
     "default_off": ["com.vakifbank.mobile", "com.tmobtech.halkbank", "com.denizbank.mobildeniz",
                     "com.garanti.cepsubesi", "com.pozitron.iscep", "com.ykb.android",
                     "com.akbank.android.apps.akbank_direkt", "com.ziraat.ziraatmobil",
                     "com.finansbank.mobile.cepsube", "com.ingbanktr.ingmobil"]}'),
  ('feature.weekly_review', 'Weekly review briefing.', true, false, '{}'),
  ('feature.new_ai_model', 'Staged rollout of a new AI model configuration.', false, false, '{}')
on conflict (key) do nothing;

insert into public.feature_flags (key, description, enabled, is_kill_switch)
select 'ai.feature.' || f.feature,
       'Kill switch for AI feature ' || f.feature || '; off routes it to its T0 path.',
       true,
       true
from unnest(enum_range(null::public.ai_feature)) as f (feature)
on conflict (key) do nothing;

-- ─── feature_flag_overrides (SYS) ─────────────────────────────────────────────────────────────
create table public.feature_flag_overrides (
  id uuid not null default gen_random_uuid(),
  flag_key text not null,
  user_id uuid not null,
  value boolean not null,
  reason text not null check (char_length(reason) >= 10),
  expires_at timestamptz,
  created_by_admin_id uuid not null,                  -- FK → admin_users (0012)
  created_at timestamptz not null default now(),
  constraint feature_flag_overrides_pkey primary key (id),
  constraint feature_flag_overrides_flag_key_fkey foreign key (flag_key)
    references public.feature_flags (key) on delete cascade,
  constraint feature_flag_overrides_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint feature_flag_overrides_flag_key_user_id_key unique (flag_key, user_id)
);
create index feature_flag_overrides_user_id_idx on public.feature_flag_overrides (user_id);
alter table public.feature_flag_overrides enable row level security;
alter table public.feature_flag_overrides force row level security;
comment on table public.feature_flag_overrides is 'Per-user flag overrides for support and QA (reason required). System table.';

-- ─── announcements (SYS) ──────────────────────────────────────────────────────────────────────
create table public.announcements (
  id uuid not null default gen_random_uuid(),
  title_tr text not null check (char_length(title_tr) <= 80),
  title_en text not null check (char_length(title_en) <= 80),
  body_tr text not null check (char_length(body_tr) <= 500),
  body_en text not null check (char_length(body_en) <= 500),
  audience text not null default 'all' check (audience in ('all', 'free', 'pro')),
  platforms public.platform[],
  min_app_version text,
  max_app_version text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  severity text not null default 'info' check (severity in ('info', 'warning')),
  cta_deeplink text check (cta_deeplink ~ '^dijitalasistan://'),
  published_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,                                    -- FK → admin_users (0012)
  updated_by uuid,                                    -- FK → admin_users (0012)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_pkey primary key (id),
  constraint announcements_ends_at_check check (ends_at > starts_at)
);
create index announcements_starts_at_ends_at_p on public.announcements (starts_at, ends_at)
  where cancelled_at is null and published_at is not null;
create trigger trg_announcements_updated_at before update on public.announcements
  for each row execute function private.set_updated_at();
alter table public.announcements enable row level security;
alter table public.announcements force row level security;
comment on table public.announcements is
  'In-app announcements (M§64, R-25), delivered through /me/bootstrap with server-side targeting. System table.';

-- ─── announcement_dismissals ──────────────────────────────────────────────────────────────────
create table public.announcement_dismissals (
  user_id uuid not null,
  announcement_id uuid not null,
  dismissed_at timestamptz not null default now(),
  constraint announcement_dismissals_pkey primary key (user_id, announcement_id),
  constraint announcement_dismissals_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint announcement_dismissals_announcement_id_fkey foreign key (announcement_id)
    references public.announcements (id) on delete cascade
);
create index announcement_dismissals_announcement_id_idx on public.announcement_dismissals (announcement_id);
alter table public.announcement_dismissals enable row level security;
alter table public.announcement_dismissals force row level security;
comment on table public.announcement_dismissals is 'Per-user dismissals of announcement banner cards.';

-- ─── user_feedback (SYS) ──────────────────────────────────────────────────────────────────────
create table public.user_feedback (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  type public.feedback_type not null,
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(message) between 1 and 4000),
  contact_email extensions.citext,
  diagnostics_consent boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics) = 'object'),
  platform public.platform,
  app_version text,
  status text not null default 'new' check (status in ('new', 'triaged', 'planned', 'closed')),
  assigned_admin_id uuid,                             -- FK → admin_users (0012)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_feedback_pkey primary key (id),
  constraint user_feedback_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create index user_feedback_status_created_at_idx on public.user_feedback (status, created_at desc);
create index user_feedback_type_idx on public.user_feedback (type);
create index user_feedback_user_id_idx on public.user_feedback (user_id);
create trigger trg_user_feedback_updated_at before update on public.user_feedback
  for each row execute function private.set_updated_at();
alter table public.user_feedback enable row level security;
alter table public.user_feedback force row level security;
comment on table public.user_feedback is 'In-app product feedback (M§62). System table.';

-- ─── system_health_checks (SYS + restrictive aal2 in 0014) ────────────────────────────────────
create table public.system_health_checks (
  id bigint generated always as identity,
  component text not null check (component in (
    'api', 'database', 'supabase_auth', 'storage', 'google_oauth', 'microsoft_oauth', 'gmail', 'microsoft_graph',
    'push', 'ai_anthropic', 'ai_openai', 'ai_voyage', 'revenuecat', 'cron', 'webhooks', 'worker',
    'email_delivery', 'audit_chain')),
  status text not null check (status in ('healthy', 'degraded', 'down', 'external_credential_required', 'unknown')),
  latency_ms integer,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  checked_by text not null check (checked_by in ('cron', 'admin')),
  checked_at timestamptz not null default now(),
  constraint system_health_checks_pkey primary key (id)
);
create index system_health_checks_component_checked_at_idx on public.system_health_checks (component, checked_at desc);
alter table public.system_health_checks enable row level security;
alter table public.system_health_checks force row level security;
comment on table public.system_health_checks is 'Real probe results; never a fake green status (M§67). System table.';

-- ─── rate_limits (SYS) ────────────────────────────────────────────────────────────────────────
create table public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  count integer not null default 0,
  constraint rate_limits_pkey primary key (key, window_start)
);
create index rate_limits_window_start_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
comment on table public.rate_limits is 'Fixed-window counters for api, public-api and admin-api (public.rate_limit_hit). System table.';

-- ─── api_idempotency_keys (SYS) ───────────────────────────────────────────────────────────────
create table public.api_idempotency_keys (
  user_id uuid not null,
  key uuid not null,
  route text not null check (char_length(route) <= 120),
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  state text not null default 'in_progress' check (state in ('in_progress', 'completed')),
  response_status smallint,
  resource_ref jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  constraint api_idempotency_keys_pkey primary key (user_id, key),
  constraint api_idempotency_keys_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create index api_idempotency_keys_expires_at_idx on public.api_idempotency_keys (expires_at);
alter table public.api_idempotency_keys enable row level security;
alter table public.api_idempotency_keys force row level security;
comment on table public.api_idempotency_keys is
  'HTTP Idempotency-Key store for api routes incl. offline-queue replays (API_CONTRACTS §2.11); no bodies. System table.';

-- ─── app_settings (SYS + restrictive aal2 in 0014) ────────────────────────────────────────────
create table public.app_settings (
  key text not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  value jsonb not null,
  description text not null check (char_length(description) <= 300),
  updated_by uuid,                                    -- FK → admin_users (0012)
  updated_at timestamptz not null default now(),
  constraint app_settings_pkey primary key (key),
  constraint app_settings_value_check check (private.valid_app_setting(key, value))
);
create trigger trg_app_settings_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();
alter table public.app_settings enable row level security;
alter table public.app_settings force row level security;
comment on table public.app_settings is
  'System configuration edited in backoffice Settings (session policy, metrics, referral, Support Access bounds, caps, pricing display). System table.';

insert into public.app_settings (key, value, description) values
  ('session.idle_minutes', '30', 'Admin idle session limit in minutes (10–30), enforced by private.require_admin.'),
  ('session.absolute_hours', '12', 'Absolute admin session limit in hours (4–12).'),
  ('metrics.inactive_after_days', '14', 'Days without activity before a user counts as inactive (7–60).'),
  ('metrics.reporting_timezone', '"Europe/Istanbul"', 'IANA time zone of backoffice rollup days.'),
  ('referral.reward_days', '14', 'Pro days granted to each side of a rewarded referral (1–60).'),
  ('referral.min_account_age_hours', '48', 'Minimum referee account age before qualification (24–168).'),
  ('referral.velocity_max_per_hour', '3', 'Codes applied per referrer per hour before a referral is flagged (1–20).'),
  ('referral.risk_threshold', '50', 'Referral risk score (0–100) at or above which a referral is flagged for review.'),
  ('referral.apply_window_days', '7', 'Days after sign-up during which a referral code can still be applied (1–30).'),
  ('support_access.max_minutes', '60', 'Maximum Support Access grant length in minutes (15, 30 or 60; R-09).'),
  ('notifications.cap.follow_up', '2', 'Follow-up pushes per rolling 24 h.'),
  ('notifications.cap.life_intel', '3', 'Life-intelligence pushes per rolling 24 h.'),
  ('notifications.cap.deadline', '3', 'Deadline pushes per rolling 24 h.'),
  ('followup.wait_thresholds_days', '[3, 7]', 'Days-waiting badge thresholds (amber, coral).'),
  ('first_analysis.mail_window_hours', '72', 'First Analysis mail window in hours.'),
  ('first_analysis.calendar_window_hours', '48', 'First Analysis calendar window in hours.'),
  ('first_analysis.slow_threshold_s', '60', 'Seconds before the First Analysis slow-state copy is shown.'),
  ('first_analysis.timeout_s', '600', 'First Analysis job timeout in seconds.'),
  ('today.max_priorities', '5', 'Maximum priority cards on Today.'),
  ('pro_gate.snooze_days', '7', 'Days the contextual Pro gate stays hidden after "Sonra".'),
  ('web.pricing_display', '{"verified": false}', 'Store price ranges for /pricing; shown only when verified and at most 90 days old.'),
  ('pricing.estimates', '{}', 'MRR/ARR estimate inputs for subscriptions_metrics.')
on conflict (key) do nothing;

-- ─── metrics_daily (SYS + restrictive aal2 in 0014) ───────────────────────────────────────────
create table public.metrics_daily (
  day date not null,
  metric_key text not null,
  dim1 text not null default '',
  dim2 text not null default '',
  dim3 text not null default '',
  value bigint not null default 0,
  value_sum numeric,
  latency_hist integer[],
  computed_at timestamptz not null default now(),
  constraint metrics_daily_pkey primary key (day, metric_key, dim1, dim2, dim3)
);
create index metrics_daily_metric_key_day_idx on public.metrics_daily (metric_key, day);
alter table public.metrics_daily enable row level security;
alter table public.metrics_daily force row level security;
comment on table public.metrics_daily is
  'Anonymous daily rollups for backoffice 30d/90d views that survive retention purges (M§50, §119). System table.';

-- ─── ai_metrics_daily (SYS + restrictive aal2 in 0014) ────────────────────────────────────────
create table public.ai_metrics_daily (
  id bigint generated always as identity,
  day date not null,
  feature public.ai_feature not null,
  provider text not null,
  model text not null,
  prompt_version_id uuid,
  plan text not null check (plan in ('free', 'pro')),
  profile public.routing_profile,
  status text not null,
  requests bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  units_charged bigint not null default 0,
  cost_usd_micros bigint not null default 0,
  grounding_proposed bigint not null default 0,
  grounding_dropped bigint not null default 0,
  latency_hist integer[],
  computed_at timestamptz not null default now(),
  constraint ai_metrics_daily_pkey primary key (id)
);
-- One row per dimension tuple; NULL prompt_version_id / profile compare equal (§4.7 coalesce key).
create unique index ai_metrics_daily_dimensions_key on public.ai_metrics_daily
  (day, feature, provider, model, prompt_version_id, plan, profile, status) nulls not distinct;
create index ai_metrics_daily_day_idx on public.ai_metrics_daily (day);
create index ai_metrics_daily_feature_day_idx on public.ai_metrics_daily (feature, day);
alter table public.ai_metrics_daily enable row level security;
alter table public.ai_metrics_daily force row level security;
comment on table public.ai_metrics_daily is 'Daily AI aggregates for /ai views and AI COGS review (AI_PIPELINE_PLAN §8.14). System table.';

-- ─── web_analytics_daily (SYS) ────────────────────────────────────────────────────────────────
create table public.web_analytics_daily (
  day date not null,
  event text not null check (event ~ '^web_[a-z0-9_]{2,60}$'),
  dims_hash bytea not null,
  dims jsonb not null check (jsonb_typeof(dims) = 'object'),
  count bigint not null default 0,
  constraint web_analytics_daily_pkey primary key (day, event, dims_hash)
);
create index web_analytics_daily_event_day_idx on public.web_analytics_daily (event, day);
alter table public.web_analytics_daily enable row level security;
alter table public.web_analytics_daily force row level security;
comment on table public.web_analytics_daily is
  'Counter-only analytics of the marketing site: no row per visit, no user id, no IP. System table.';
