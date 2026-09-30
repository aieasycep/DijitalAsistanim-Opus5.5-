-- Migration 0003 · integrations
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.2 (connected_accounts, oauth_credentials, oauth_states,
-- calendars, sync_states, connected_account_sync_health, provider_quota_usage, webhook_events),
-- §4.7 (private.demo_fixture_state), §7 (trg_user_preferences_validate_calendar), §10 row 0003.
-- The Free plan-limit triggers on connected_accounts / calendars need effective_entitlement and
-- arrive with the functions migration (0013).

-- ─── connected_accounts ───────────────────────────────────────────────────────────────────────
create table public.connected_accounts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  provider public.provider not null,
  provider_account_id text not null,
  account_email extensions.citext,
  display_label text,
  tenant_type text check (tenant_type in ('personal', 'work')),
  tenant_id text,
  status public.account_status not null default 'connecting',
  status_reason text check (status_reason in (
    'invalid_grant', 'scope_missing', 'admin_consent_required', 'provider_error', 'quota', 'revoked_by_user',
    'watch_failed', 'permission_denied', 'external_credential_required')),
  granted_scopes text[] not null default '{}',
  capabilities_granted public.capability[] not null default '{}',
  data_source_toggles jsonb not null
    default '{"mail_read":true,"attachments_analyze":true,"deadline_detect":true,"draft_replies":true,"calendar_read":true,"schedule_suggest":true,"calendar_write_with_approval":true,"tasks_read":true}'::jsonb
    check (private.valid_data_source_toggles(data_source_toggles)),
  analysis_window_days smallint not null default 3 check (analysis_window_days between 1 and 14),
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  reauth_required_at timestamptz,
  disconnected_at timestamptz,
  revocation_mode text check (revocation_mode in ('provider_revoked', 'local_only', 'device_local')),
  credential_expires_at timestamptz,
  pending_binding_until timestamptz,                  -- R-07: set until POST /integrations/oauth/complete
  demo_flavor text check (demo_flavor in ('google', 'microsoft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connected_accounts_pkey primary key (id),
  constraint connected_accounts_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint connected_accounts_user_id_provider_provider_account_id_key unique (user_id, provider, provider_account_id),
  constraint connected_accounts_demo_flavor_provider_check check ((provider = 'demo') = (demo_flavor is not null))
);
create index connected_accounts_user_id_status_idx on public.connected_accounts (user_id, status);
create index connected_accounts_status_p on public.connected_accounts (status)
  where status in ('needs_reauth', 'error', 'admin_consent_required', 'partial');
create index connected_accounts_provider_last_successful_sync_at_idx
  on public.connected_accounts (provider, last_successful_sync_at);
create trigger trg_connected_accounts_updated_at before update on public.connected_accounts
  for each row execute function private.set_updated_at();
alter table public.connected_accounts enable row level security;
alter table public.connected_accounts force row level security;
comment on table public.connected_accounts is
  'Provider accounts connected for integration (separate from login): granted capabilities, per-account data-source toggles and sync health (M§75–76, §88; ADR-07).';

-- ─── oauth_credentials (SYS) ──────────────────────────────────────────────────────────────────
create table public.oauth_credentials (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  connected_account_id uuid,
  provider public.provider not null,
  token_kind text not null check (token_kind in ('refresh', 'access', 'apple_siwa_refresh')),
  key_version smallint not null check (key_version >= 1),
  iv bytea not null check (octet_length(iv) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 16384),
  aad_hash bytea not null check (octet_length(aad_hash) = 32),
  access_expires_at timestamptz,
  scope_snapshot text,
  refresh_lock_until timestamptz,
  refresh_lock_owner text,
  client_id_hint text,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_credentials_pkey primary key (id),
  constraint oauth_credentials_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint oauth_credentials_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint oauth_credentials_connected_account_id_check
    check (connected_account_id is not null or token_kind = 'apple_siwa_refresh')
);
create unique index oauth_credentials_connected_account_id_token_kind_key
  on public.oauth_credentials (connected_account_id, token_kind) where connected_account_id is not null;
create unique index oauth_credentials_user_id_token_kind_key
  on public.oauth_credentials (user_id, token_kind) where connected_account_id is null;
create index oauth_credentials_key_version_idx on public.oauth_credentials (key_version);
create index oauth_credentials_access_expires_at_p on public.oauth_credentials (access_expires_at)
  where token_kind = 'access';
create index oauth_credentials_user_id_idx on public.oauth_credentials (user_id);
create trigger trg_oauth_credentials_updated_at before update on public.oauth_credentials
  for each row execute function private.set_updated_at();
alter table public.oauth_credentials enable row level security;
alter table public.oauth_credentials force row level security;
comment on table public.oauth_credentials is
  'AES-256-GCM encrypted provider tokens and the Apple SIWA refresh token (ADR-05). System table: invisible to clients, decrypted only in Edge Functions.';

-- ─── oauth_states (SYS) ───────────────────────────────────────────────────────────────────────
create table public.oauth_states (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  state_hash bytea not null check (octet_length(state_hash) = 32),
  provider public.provider not null check (provider in ('google', 'microsoft')),
  purpose text not null check (purpose in ('connect', 'upgrade', 'reauth')),
  connected_account_id uuid,
  requested_capabilities public.capability[] not null,
  requested_scopes text[] not null,
  code_verifier_iv bytea not null,
  code_verifier_ciphertext bytea not null,
  key_version smallint not null,
  nonce_hash bytea,
  return_to text not null check (return_to ~ '^(dijitalasistan://integrations/callback|https://[a-z0-9.-]+/oauth/done)'),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  device_nonce_hash bytea not null check (octet_length(device_nonce_hash) = 32),        -- R-07
  completion_code_hash bytea check (octet_length(completion_code_hash) = 32),          -- R-07
  approval_id uuid,                                   -- FK → approval_actions added in 0006
  token_ciphertext bytea,
  token_iv bytea check (token_iv is null or octet_length(token_iv) = 12),
  result text check (result in (
    'pending_confirmation', 'success', 'partial', 'denied', 'error', 'account_mismatch', 'already_linked',
    'plan_limit', 'admin_consent_required')),
  error_code text,
  completed_at timestamptz,                           -- R-07
  created_at timestamptz not null default now(),
  constraint oauth_states_pkey primary key (id),
  constraint oauth_states_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint oauth_states_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint oauth_states_state_hash_key unique (state_hash)
);
create unique index oauth_states_completion_code_hash_key on public.oauth_states (completion_code_hash)
  where completion_code_hash is not null;
create index oauth_states_expires_at_idx on public.oauth_states (expires_at);
create index oauth_states_user_id_idx on public.oauth_states (user_id);
create index oauth_states_connected_account_id_idx on public.oauth_states (connected_account_id);
alter table public.oauth_states enable row level security;
alter table public.oauth_states force row level security;
comment on table public.oauth_states is
  'Single-use PKCE state (10 min) plus the R-07 completion binding (device nonce + one-time completion code). System table.';

-- ─── calendars ────────────────────────────────────────────────────────────────────────────────
create table public.calendars (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  connected_account_id uuid not null,
  provider public.provider not null,
  provider_calendar_id text not null,
  name text not null check (char_length(name) <= 200),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  time_zone text,
  access_role text not null check (access_role in ('owner', 'writer', 'reader', 'free_busy_reader')),
  is_primary boolean not null default false,
  selected boolean not null default true,
  can_write boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendars_pkey primary key (id),
  constraint calendars_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint calendars_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint calendars_connected_account_id_provider_calendar_id_key unique (connected_account_id, provider_calendar_id)
);
create index calendars_user_id_selected_idx on public.calendars (user_id, selected);
create trigger trg_calendars_updated_at before update on public.calendars
  for each row execute function private.set_updated_at();
alter table public.calendars enable row level security;
alter table public.calendars force row level security;
comment on table public.calendars is
  'Provider and device calendars; the user selects which are analysed (Free: 1 selected calendar via plan_limits.max_calendars).';

-- user_preferences.default_write_calendar_id (0002) → calendars
alter table public.user_preferences
  add constraint user_preferences_default_write_calendar_id_fkey foreign key (default_write_calendar_id)
    references public.calendars (id) on delete set null;
create index user_preferences_default_write_calendar_id_idx on public.user_preferences (default_write_calendar_id);

-- The default write calendar must be the user's own, selected and writable (§7).
create function private.validate_default_write_calendar() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.default_write_calendar_id is not null and not exists (
       select 1 from public.calendars c
       where c.id = new.default_write_calendar_id and c.user_id = new.user_id and c.selected and c.can_write) then
    raise exception 'INVALID_DEFAULT_CALENDAR' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function private.validate_default_write_calendar() from public;

create trigger trg_user_preferences_validate_calendar
  before insert or update of default_write_calendar_id on public.user_preferences
  for each row execute function private.validate_default_write_calendar();

-- ─── sync_states ──────────────────────────────────────────────────────────────────────────────
create table public.sync_states (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  connected_account_id uuid not null,
  calendar_id uuid,
  resource text not null check (resource in (
    'gmail_mailbox', 'graph_mail_inbox', 'graph_mail_sentitems', 'google_calendar', 'graph_calendar_view',
    'google_tasks', 'todo_list', 'device_calendar', 'device_reminders')),
  resource_key text not null default '',
  cursor text,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'backfilling', 'resync_required', 'error', 'paused')),
  cursor_invalidated_at timestamptz,
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  consecutive_failures integer not null default 0,
  backfill_until timestamptz,
  backfill_cursor text,
  window_start timestamptz,
  window_end timestamptz,
  rebaseline_due_at timestamptz,
  watch_kind text not null default 'none' check (watch_kind in ('none', 'gmail_watch', 'gcal_channel', 'graph_subscription')),
  watch_id text,
  watch_resource_id text,
  watch_token_hash bytea,
  watch_history_id text,
  watch_expires_at timestamptz,
  watch_renew_after timestamptz,
  lifecycle_last_event text check (lifecycle_last_event in ('reauthorizationRequired', 'subscriptionRemoved', 'missed')),
  lifecycle_last_at timestamptz,
  page_token text,
  next_poll_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_states_pkey primary key (id),
  constraint sync_states_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint sync_states_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint sync_states_calendar_id_fkey foreign key (calendar_id) references public.calendars (id) on delete cascade,
  constraint sync_states_connected_account_id_resource_resource_key_key unique (connected_account_id, resource, resource_key)
);
create unique index sync_states_watch_kind_watch_id_key on public.sync_states (watch_kind, watch_id)
  where watch_id is not null;
create index sync_states_watch_renew_after_p on public.sync_states (watch_renew_after) where watch_kind <> 'none';
create index sync_states_rebaseline_due_at_p on public.sync_states (rebaseline_due_at)
  where resource = 'graph_calendar_view';
create index sync_states_status_p on public.sync_states (status) where status in ('error', 'resync_required');
create index sync_states_user_id_idx on public.sync_states (user_id);
create index sync_states_calendar_id_idx on public.sync_states (calendar_id);
create trigger trg_sync_states_updated_at before update on public.sync_states
  for each row execute function private.set_updated_at();
alter table public.sync_states enable row level security;
alter table public.sync_states force row level security;
comment on table public.sync_states is
  'Per (account, resource) cursor, health, backfill window and watch/subscription state (M§117, ADR-07). Owners read it only through connected_account_sync_health.';

-- Owner-visible sync freshness without cursors or watch secrets (security invoker).
create view public.connected_account_sync_health with (security_invoker = true) as
  select s.user_id,
         s.connected_account_id,
         s.resource,
         s.status,
         s.last_success_at,
         s.last_error_code,
         extract(epoch from (now() - s.last_success_at))::integer as lag_seconds
  from public.sync_states s;
comment on view public.connected_account_sync_health is
  'Sync freshness per account and resource (no cursors, tokens or watch data); RLS of sync_states applies (security invoker).';

-- ─── provider_quota_usage (SYS) ───────────────────────────────────────────────────────────────
create table public.provider_quota_usage (
  id bigint generated always as identity,
  bucket text not null check (bucket ~ '^[a-z][a-z0-9_]{2,48}$'),
  connected_account_id uuid,
  user_id uuid,
  provider public.provider not null,
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  units_used integer not null default 0 check (units_used >= 0),
  units_limit integer not null check (units_limit > 0),
  request_count integer not null default 0,
  throttled_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint provider_quota_usage_pkey primary key (id),
  constraint provider_quota_usage_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint provider_quota_usage_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint provider_quota_usage_scope_check check ((connected_account_id is null) = (user_id is null))
);
create unique index provider_quota_usage_bucket_account_window_key on public.provider_quota_usage
  (bucket, coalesce(connected_account_id, '00000000-0000-0000-0000-000000000000'::uuid), window_start);
create index provider_quota_usage_window_start_idx on public.provider_quota_usage (window_start);
create index provider_quota_usage_connected_account_id_idx on public.provider_quota_usage (connected_account_id);
create index provider_quota_usage_user_id_idx on public.provider_quota_usage (user_id);
create trigger trg_provider_quota_usage_updated_at before update on public.provider_quota_usage
  for each row execute function private.set_updated_at();
alter table public.provider_quota_usage enable row level security;
alter table public.provider_quota_usage force row level security;
comment on table public.provider_quota_usage is
  'Token buckets per account and project for provider quotas (Gmail units, Graph requests); consumed via private.consume_provider_quota. System table.';

-- ─── webhook_events (SYS) ─────────────────────────────────────────────────────────────────────
create table public.webhook_events (
  id bigint generated always as identity,
  source text not null
    check (source in ('google_gmail', 'google_calendar', 'microsoft_graph', 'microsoft_lifecycle', 'revenuecat')),
  external_id text not null check (char_length(external_id) <= 300),
  user_id uuid,
  connected_account_id uuid,
  signature_valid boolean not null,
  status text not null default 'received' check (status in ('received', 'enqueued', 'ignored', 'rejected', 'failed')),
  job_id uuid,
  payload_digest bytea not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint webhook_events_pkey primary key (id),
  constraint webhook_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null,
  constraint webhook_events_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete set null,
  constraint webhook_events_source_external_id_key unique (source, external_id)
);
create index webhook_events_received_at_idx on public.webhook_events (received_at);
create index webhook_events_status_p on public.webhook_events (status) where status in ('failed', 'rejected');
create index webhook_events_user_id_idx on public.webhook_events (user_id);
create index webhook_events_connected_account_id_idx on public.webhook_events (connected_account_id);
alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;
comment on table public.webhook_events is
  'Replay dedupe and ingest ledger for provider and RevenueCat webhooks; content-free payload. System table.';

-- ─── private.demo_fixture_state ───────────────────────────────────────────────────────────────
create table private.demo_fixture_state (
  connected_account_id uuid not null,
  user_id uuid not null,
  resource text not null check (resource in ('mail', 'calendar', 'tasks')),
  state jsonb not null default '{}'::jsonb,
  demo_clock timestamptz,
  updated_at timestamptz not null default now(),
  constraint demo_fixture_state_pkey primary key (connected_account_id, resource),
  constraint demo_fixture_state_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint demo_fixture_state_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create index demo_fixture_state_user_id_idx on private.demo_fixture_state (user_id);
create trigger trg_demo_fixture_state_updated_at before update on private.demo_fixture_state
  for each row execute function private.set_updated_at();
alter table private.demo_fixture_state enable row level security;
alter table private.demo_fixture_state force row level security;
comment on table private.demo_fixture_state is
  'Real state changes of the demo adapter (DEMO_MODE only): sent replies, created events and tasks, without provider calls or fake success.';
