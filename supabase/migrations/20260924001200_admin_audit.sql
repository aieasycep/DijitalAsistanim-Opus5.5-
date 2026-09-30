-- Migration 0012 · admin and audit
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.9 (admin_users, admin_sessions, admin_preferences,
-- admin_mfa_recovery_codes, audit_logs, support_tickets, support_notes, support_access_grants,
-- private.admin_role_permissions), §3.6 (append-only), §6.7 (audit chain), §6.8 (last super_admin),
-- §7 (trg_admin_users_identity), §10 row 0012; BACKOFFICE_PLAN §4.1–§4.4 and §16 #2–#4; R-08, R-09.
-- Also adds every deferred foreign key to admin_users from earlier migrations.

-- ─── admin_users (SYS + restrictive aal2 in 0014) ─────────────────────────────────────────────
create table public.admin_users (
  user_id uuid not null,
  role public.admin_role not null,
  status public.admin_status not null default 'invited',
  display_name text not null check (char_length(display_name) between 1 and 80),
  email extensions.citext not null,
  mfa_required boolean not null default true check (mfa_required),
  invited_by uuid,
  invited_at timestamptz not null default now(),
  invite_token_hash bytea check (octet_length(invite_token_hash) = 32),
  invite_expires_at timestamptz,
  invite_redeemed_at timestamptz,
  activated_at timestamptz,
  disabled_at timestamptz,
  disabled_by uuid,
  disabled_reason text,
  last_login_at timestamptz,
  locked_until timestamptz,                           -- sign-in lockout (BACKOFFICE_PLAN §3.9)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_pkey primary key (user_id),
  constraint admin_users_user_id_fkey foreign key (user_id) references auth.users (id) on delete restrict,
  constraint admin_users_invited_by_fkey foreign key (invited_by) references public.admin_users (user_id) on delete set null,
  constraint admin_users_disabled_by_fkey foreign key (disabled_by) references public.admin_users (user_id) on delete set null,
  constraint admin_users_email_key unique (email)
);
create index admin_users_role_status_idx on public.admin_users (role, status);
create index admin_users_invited_by_idx on public.admin_users (invited_by);
create index admin_users_disabled_by_idx on public.admin_users (disabled_by);
create trigger trg_admin_users_updated_at before update on public.admin_users
  for each row execute function private.set_updated_at();
alter table public.admin_users enable row level security;
alter table public.admin_users force row level security;
comment on table public.admin_users is
  'Dedicated admin identities (auth app_metadata.da_kind = admin; R-08) with role and status; disabled, never deleted. System table.';

-- R-08: an admin row needs a dedicated admin identity; an app user can never become an admin.
create function private.check_admin_identity() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if not exists (
       select 1 from auth.users u
       where u.id = new.user_id and coalesce(u.raw_app_meta_data ->> 'da_kind', '') = 'admin')
     or exists (select 1 from public.profiles p where p.user_id = new.user_id) then
    raise exception 'EMAIL_IN_USE_BY_APP_USER' using errcode = '23514',
      detail = 'admin_users requires a dedicated admin identity (raw_app_meta_data.da_kind = admin) without an app profile';
  end if;
  return new;
end
$$;
revoke execute on function private.check_admin_identity() from public;

create trigger trg_admin_users_identity before insert on public.admin_users
  for each row execute function private.check_admin_identity();

-- §6.8 + BACKOFFICE_PLAN §4.4: the last active super_admin cannot be demoted, disabled or deleted,
-- and admin rows are never deleted at all (audit references stay intact).
create function private.guard_last_super_admin() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if old.role = 'super_admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'super_admin' or new.status <> 'active') then
    perform 1 from public.admin_users a where a.role = 'super_admin' and a.status = 'active' for update;
    if not exists (
         select 1 from public.admin_users a
         where a.role = 'super_admin' and a.status = 'active' and a.user_id <> old.user_id) then
      raise exception 'LAST_SUPER_ADMIN' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'ADMINS_NEVER_DELETED' using errcode = '55000';
  end if;
  return new;
end
$$;
revoke execute on function private.guard_last_super_admin() from public;

create trigger trg_admin_users_last_super_admin before update or delete on public.admin_users
  for each row execute function private.guard_last_super_admin();

-- ─── admin_sessions (SYS + aal2) ──────────────────────────────────────────────────────────────
create table public.admin_sessions (
  id uuid not null default gen_random_uuid(),
  admin_user_id uuid not null,
  auth_session_id uuid not null,                      -- JWT session_id
  aal text not null check (aal = 'aal2'),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,               -- last activity + 30 min
  absolute_expires_at timestamptz not null,           -- created + 12 h
  step_up_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason in (
    'logout', 'idle_timeout', 'absolute_timeout', 'revoked_all', 'admin_disabled', 'logout_others',
    'revoked_by_admin', 'mfa_reset', 'recovery_used')),
  ip_hash bytea,
  user_agent text check (char_length(user_agent) <= 300),
  constraint admin_sessions_pkey primary key (id),
  constraint admin_sessions_admin_user_id_fkey foreign key (admin_user_id)
    references public.admin_users (user_id) on delete cascade,
  constraint admin_sessions_auth_session_id_key unique (auth_session_id)
);
create index admin_sessions_admin_user_id_p on public.admin_sessions (admin_user_id) where ended_at is null;
create index admin_sessions_admin_user_id_idx on public.admin_sessions (admin_user_id);
alter table public.admin_sessions enable row level security;
alter table public.admin_sessions force row level security;
comment on table public.admin_sessions is
  'Admin sessions with 30 min idle and 12 h absolute limits, validated and touched by private.require_admin (ADR-06). System table.';

-- ─── admin_preferences (SYS) ──────────────────────────────────────────────────────────────────
create table public.admin_preferences (
  admin_user_id uuid not null,
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  locale text not null default 'tr-TR',
  table_prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(table_prefs) = 'object'),
  dashboard_range text not null default '7d' check (dashboard_range in ('24h', '7d', '30d', '90d')),
  updated_at timestamptz not null default now(),
  constraint admin_preferences_pkey primary key (admin_user_id),
  constraint admin_preferences_admin_user_id_fkey foreign key (admin_user_id)
    references public.admin_users (user_id) on delete cascade
);
create trigger trg_admin_preferences_updated_at before update on public.admin_preferences
  for each row execute function private.set_updated_at();
alter table public.admin_preferences enable row level security;
alter table public.admin_preferences force row level security;
comment on table public.admin_preferences is 'Backoffice theme, locale, table and dashboard preferences per admin (M§72). System table.';

-- ─── admin_mfa_recovery_codes (SYS + aal2) ────────────────────────────────────────────────────
create table public.admin_mfa_recovery_codes (
  id uuid not null default gen_random_uuid(),
  admin_user_id uuid not null,
  code_hash bytea not null check (octet_length(code_hash) = 32),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  replaced_at timestamptz,
  constraint admin_mfa_recovery_codes_pkey primary key (id),
  constraint admin_mfa_recovery_codes_admin_user_id_fkey foreign key (admin_user_id)
    references public.admin_users (user_id) on delete cascade,
  constraint admin_mfa_recovery_codes_code_hash_key unique (code_hash)
);
create index admin_mfa_recovery_codes_admin_user_id_p on public.admin_mfa_recovery_codes (admin_user_id)
  where used_at is null and replaced_at is null;
create index admin_mfa_recovery_codes_admin_user_id_idx on public.admin_mfa_recovery_codes (admin_user_id);
alter table public.admin_mfa_recovery_codes enable row level security;
alter table public.admin_mfa_recovery_codes force row level security;
comment on table public.admin_mfa_recovery_codes is
  'One-time MFA recovery codes for admins, stored as HMAC hashes only (BACKOFFICE_PLAN §3.4). System table.';

-- ─── private.admin_role_permissions (SQL mirror of packages/domain/src/rbac.ts) ───────────────
create table private.admin_role_permissions (
  role public.admin_role not null,
  permission text not null check (permission ~ '^[a-z_]+(\.[a-z_]+){1,2}$'),
  constraint admin_role_permissions_pkey primary key (role, permission)
);
alter table private.admin_role_permissions enable row level security;
alter table private.admin_role_permissions force row level security;
comment on table private.admin_role_permissions is
  'Role × permission matrix (BACKOFFICE_PLAN §4.1 strings, §4.2 matrix); private.require_admin looks permissions up here.';

-- Seed = packages/domain/src/rbac.ts ROLE_PERMISSIONS (renderAdminRolePermissionSeed), which is
-- BACKOFFICE_PLAN §4.2 (R-20): push.test is super_admin and operations only. Keep this a plain
-- VALUES statement; the domain parity test parses it.

insert into private.admin_role_permissions (role, permission) values
  ('super_admin', 'dashboard.read'),
  ('super_admin', 'metrics.ops.read'),
  ('super_admin', 'metrics.ai.read'),
  ('super_admin', 'metrics.revenue.read'),
  ('super_admin', 'metrics.product.read'),
  ('super_admin', 'users.read'),
  ('super_admin', 'users.pii.reveal'),
  ('super_admin', 'users.force_sync'),
  ('super_admin', 'users.disable'),
  ('super_admin', 'users.mark_internal'),
  ('super_admin', 'integrations.read'),
  ('super_admin', 'integrations.disconnect'),
  ('super_admin', 'integrations.renew_watch'),
  ('super_admin', 'jobs.read'),
  ('super_admin', 'jobs.retry'),
  ('super_admin', 'jobs.cancel'),
  ('super_admin', 'briefings.read'),
  ('super_admin', 'briefings.regenerate'),
  ('super_admin', 'notifications.read'),
  ('super_admin', 'push.test'),
  ('super_admin', 'ai.read'),
  ('super_admin', 'ai.models.write'),
  ('super_admin', 'prompts.read'),
  ('super_admin', 'prompts.write'),
  ('super_admin', 'prompts.activate'),
  ('super_admin', 'ai_feedback.read'),
  ('super_admin', 'ai_feedback.reveal'),
  ('super_admin', 'subscriptions.read'),
  ('super_admin', 'billing_events.read'),
  ('super_admin', 'subscriptions.resync'),
  ('super_admin', 'entitlements.grant'),
  ('super_admin', 'entitlements.grant_limited'),
  ('super_admin', 'entitlements.revoke'),
  ('super_admin', 'referrals.read'),
  ('super_admin', 'referrals.review'),
  ('super_admin', 'support.read'),
  ('super_admin', 'support.write'),
  ('super_admin', 'support.access'),
  ('super_admin', 'feedback.read'),
  ('super_admin', 'feedback.write'),
  ('super_admin', 'flags.read'),
  ('super_admin', 'flags.write'),
  ('super_admin', 'flags.write_ai'),
  ('super_admin', 'announcements.read'),
  ('super_admin', 'announcements.write'),
  ('super_admin', 'data_requests.read'),
  ('super_admin', 'data_requests.manage'),
  ('super_admin', 'audit.read'),
  ('super_admin', 'health.read'),
  ('super_admin', 'health.run'),
  ('super_admin', 'admins.read'),
  ('super_admin', 'admins.manage'),
  ('super_admin', 'settings.system.write'),
  ('super_admin', 'search.global'),
  ('operations', 'dashboard.read'),
  ('operations', 'metrics.ops.read'),
  ('operations', 'metrics.ai.read'),
  ('operations', 'metrics.product.read'),
  ('operations', 'users.read'),
  ('operations', 'users.force_sync'),
  ('operations', 'users.disable'),
  ('operations', 'users.mark_internal'),
  ('operations', 'integrations.read'),
  ('operations', 'integrations.disconnect'),
  ('operations', 'integrations.renew_watch'),
  ('operations', 'jobs.read'),
  ('operations', 'jobs.retry'),
  ('operations', 'jobs.cancel'),
  ('operations', 'briefings.read'),
  ('operations', 'briefings.regenerate'),
  ('operations', 'notifications.read'),
  ('operations', 'push.test'),
  ('operations', 'ai.read'),
  ('operations', 'prompts.read'),
  ('operations', 'subscriptions.read'),
  ('operations', 'referrals.read'),
  ('operations', 'support.read'),
  ('operations', 'feedback.read'),
  ('operations', 'feedback.write'),
  ('operations', 'flags.read'),
  ('operations', 'flags.write'),
  ('operations', 'flags.write_ai'),
  ('operations', 'announcements.read'),
  ('operations', 'announcements.write'),
  ('operations', 'data_requests.read'),
  ('operations', 'data_requests.manage'),
  ('operations', 'audit.read'),
  ('operations', 'health.read'),
  ('operations', 'health.run'),
  ('operations', 'admins.read'),
  ('operations', 'search.global'),
  ('support', 'dashboard.read'),
  ('support', 'users.read'),
  ('support', 'users.pii.reveal'),
  ('support', 'users.force_sync'),
  ('support', 'integrations.read'),
  ('support', 'jobs.read'),
  ('support', 'briefings.read'),
  ('support', 'notifications.read'),
  ('support', 'subscriptions.read'),
  ('support', 'subscriptions.resync'),
  ('support', 'entitlements.grant_limited'),
  ('support', 'referrals.read'),
  ('support', 'support.read'),
  ('support', 'support.write'),
  ('support', 'support.access'),
  ('support', 'feedback.read'),
  ('support', 'feedback.write'),
  ('support', 'announcements.read'),
  ('support', 'data_requests.read'),
  ('support', 'data_requests.manage'),
  ('support', 'audit.read'),
  ('support', 'health.read'),
  ('support', 'search.global'),
  ('finance', 'dashboard.read'),
  ('finance', 'metrics.revenue.read'),
  ('finance', 'metrics.product.read'),
  ('finance', 'users.read'),
  ('finance', 'subscriptions.read'),
  ('finance', 'billing_events.read'),
  ('finance', 'subscriptions.resync'),
  ('finance', 'entitlements.grant'),
  ('finance', 'entitlements.revoke'),
  ('finance', 'referrals.read'),
  ('finance', 'referrals.review'),
  ('finance', 'health.read'),
  ('finance', 'search.global'),
  ('ai_ops', 'dashboard.read'),
  ('ai_ops', 'metrics.ops.read'),
  ('ai_ops', 'metrics.ai.read'),
  ('ai_ops', 'jobs.read'),
  ('ai_ops', 'briefings.read'),
  ('ai_ops', 'ai.read'),
  ('ai_ops', 'ai.models.write'),
  ('ai_ops', 'prompts.read'),
  ('ai_ops', 'prompts.write'),
  ('ai_ops', 'prompts.activate'),
  ('ai_ops', 'ai_feedback.read'),
  ('ai_ops', 'ai_feedback.reveal'),
  ('ai_ops', 'feedback.read'),
  ('ai_ops', 'flags.read'),
  ('ai_ops', 'flags.write_ai'),
  ('ai_ops', 'health.read'),
  ('ai_ops', 'search.global'),
  ('analyst', 'dashboard.read'),
  ('analyst', 'metrics.ops.read'),
  ('analyst', 'metrics.ai.read'),
  ('analyst', 'metrics.revenue.read'),
  ('analyst', 'metrics.product.read'),
  ('readonly', 'dashboard.read'),
  ('readonly', 'metrics.ops.read'),
  ('readonly', 'metrics.ai.read'),
  ('readonly', 'metrics.product.read'),
  ('readonly', 'users.read'),
  ('readonly', 'integrations.read'),
  ('readonly', 'jobs.read'),
  ('readonly', 'briefings.read'),
  ('readonly', 'notifications.read'),
  ('readonly', 'ai.read'),
  ('readonly', 'prompts.read'),
  ('readonly', 'ai_feedback.read'),
  ('readonly', 'subscriptions.read'),
  ('readonly', 'billing_events.read'),
  ('readonly', 'referrals.read'),
  ('readonly', 'support.read'),
  ('readonly', 'feedback.read'),
  ('readonly', 'flags.read'),
  ('readonly', 'announcements.read'),
  ('readonly', 'data_requests.read'),
  ('readonly', 'audit.read'),
  ('readonly', 'health.read'),
  ('readonly', 'admins.read'),
  ('readonly', 'search.global');

-- ─── audit_logs (append-only, hash-chained; SYS + restrictive aal2 in 0014) ───────────────────
create table public.audit_logs (
  id bigint generated always as identity,
  chain_seq bigint not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_type text not null check (actor_type in ('admin', 'user', 'system', 'worker')),
  actor_id uuid,
  actor_role text,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+){1,3}$'),
  target_type text,
  target_id text,
  target_user_id uuid,                                -- not an FK: survives account deletion
  reason text check (char_length(reason) <= 1000),
  result text not null check (result in ('success', 'failure', 'denied')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  correlation_id uuid,
  ip_hash bytea,
  prev_hash bytea,
  row_hash bytea not null,
  constraint audit_logs_pkey primary key (id),
  constraint audit_logs_chain_seq_key unique (chain_seq),
  constraint audit_logs_admin_reason_check check (actor_type <> 'admin' or action like '%.read%' or reason is not null)
);
create index audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index audit_logs_actor_id_occurred_at_idx on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_target_user_id_occurred_at_idx on public.audit_logs (target_user_id, occurred_at desc);
create index audit_logs_action_occurred_at_idx on public.audit_logs (action, occurred_at desc);
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
revoke update, delete, truncate on public.audit_logs from public, anon, authenticated, service_role;
comment on table public.audit_logs is
  'Immutable, hash-chained record of sensitive actions (M§66); rows are appended only through private.audit_log_append and never deleted.';

create trigger trg_audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.raise_append_only();
create trigger trg_audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.raise_append_only();

-- Canonical text of one chain link (§6.7). NULL fields keep their position as empty strings.
create function private.audit_canonical(
  p_seq bigint, p_occurred_at timestamptz, p_actor_type text, p_actor_id uuid, p_actor_role text, p_action text,
  p_target_type text, p_target_id text, p_target_user_id uuid, p_reason text, p_result text, p_details jsonb,
  p_correlation_id uuid
) returns text
  language sql stable parallel safe
  set search_path = ''
  as $$
    select concat_ws('|',
      p_seq::text,
      to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      coalesce(p_actor_type, ''), coalesce(p_actor_id::text, ''), coalesce(p_actor_role, ''), coalesce(p_action, ''),
      coalesce(p_target_type, ''), coalesce(p_target_id, ''), coalesce(p_target_user_id::text, ''),
      coalesce(p_reason, ''), coalesce(p_result, ''), coalesce(p_details, '{}'::jsonb)::text,
      coalesce(p_correlation_id::text, ''))
  $$;
revoke execute on function private.audit_canonical(bigint, timestamptz, text, uuid, text, text, text, text, uuid, text, text, jsonb, uuid)
  from public;

-- Appends one audit row under an advisory lock: row_hash = sha256(prev_hash ‖ canonical text).
create function private.audit_log_append(
  p_actor_type text, p_actor_id uuid, p_actor_role text, p_action text, p_target_type text, p_target_id text,
  p_target_user_id uuid, p_reason text, p_result text, p_details jsonb, p_correlation_id uuid,
  p_ip_hash bytea default null
) returns bigint
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_prev_seq bigint;
  v_prev_hash bytea;
  v_seq bigint;
  v_at timestamptz := clock_timestamp();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_hash bytea;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('da_audit_chain'));
  select a.chain_seq, a.row_hash into v_prev_seq, v_prev_hash
  from public.audit_logs a order by a.chain_seq desc limit 1;
  v_seq := coalesce(v_prev_seq, 0) + 1;
  v_hash := pg_catalog.sha256(coalesce(v_prev_hash, '\x00'::bytea) || convert_to(private.audit_canonical(
    v_seq, v_at, p_actor_type, p_actor_id, p_actor_role, p_action, p_target_type, p_target_id, p_target_user_id,
    p_reason, p_result, v_details, p_correlation_id), 'UTF8'));
  insert into public.audit_logs (
    chain_seq, occurred_at, actor_type, actor_id, actor_role, action, target_type, target_id, target_user_id,
    reason, result, details, correlation_id, ip_hash, prev_hash, row_hash)
  values (
    v_seq, v_at, p_actor_type, p_actor_id, p_actor_role, p_action, p_target_type, p_target_id, p_target_user_id,
    p_reason, p_result, v_details, p_correlation_id, p_ip_hash, v_prev_hash, v_hash)
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function private.audit_log_append(text, uuid, text, text, text, text, uuid, text, text, jsonb, uuid, bytea)
  from public;
grant execute on function private.audit_log_append(text, uuid, text, text, text, text, uuid, text, text, jsonb, uuid, bytea)
  to service_role;

-- Recomputes the chain from p_from (default: the start); reports the first broken link.
create function private.audit_verify_chain(p_from bigint default 1, p_to bigint default null)
  returns table (ok boolean, checked bigint, first_bad_seq bigint)
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  r public.audit_logs%rowtype;
  v_prev bytea;
  v_expected_seq bigint := greatest(coalesce(p_from, 1), 1);
  v_checked bigint := 0;
  v_bad bigint;
begin
  if v_expected_seq > 1 then
    select a.row_hash into v_prev from public.audit_logs a where a.chain_seq = v_expected_seq - 1;
  end if;
  for r in
    select * from public.audit_logs a
    where a.chain_seq >= v_expected_seq and (p_to is null or a.chain_seq <= p_to)
    order by a.chain_seq
  loop
    v_checked := v_checked + 1;
    if r.chain_seq <> v_expected_seq
       or r.prev_hash is distinct from v_prev
       or r.row_hash is distinct from pg_catalog.sha256(coalesce(v_prev, '\x00'::bytea) || convert_to(
            private.audit_canonical(r.chain_seq, r.occurred_at, r.actor_type, r.actor_id, r.actor_role, r.action,
                                    r.target_type, r.target_id, r.target_user_id, r.reason, r.result, r.details,
                                    r.correlation_id), 'UTF8')) then
      v_bad := least(r.chain_seq, v_expected_seq);
      exit;
    end if;
    v_prev := r.row_hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;
  return query select v_bad is null, v_checked, v_bad;
end
$$;
revoke execute on function private.audit_verify_chain(bigint, bigint) from public;
grant execute on function private.audit_verify_chain(bigint, bigint) to service_role;

-- Service-role wrapper for Edge Functions (§6.7).
create function public.audit_log_append(
  p_actor_type text, p_actor_id uuid, p_actor_role text, p_action text, p_target_type text, p_target_id text,
  p_target_user_id uuid, p_reason text, p_result text, p_details jsonb, p_correlation_id uuid,
  p_ip_hash bytea default null
) returns bigint
  language sql
  security definer
  set search_path = ''
  as $$
    select private.audit_log_append(p_actor_type, p_actor_id, p_actor_role, p_action, p_target_type, p_target_id,
                                    p_target_user_id, p_reason, p_result, p_details, p_correlation_id, p_ip_hash)
  $$;
revoke execute on function public.audit_log_append(text, uuid, text, text, text, text, uuid, text, text, jsonb, uuid, bytea)
  from public, anon, authenticated;
grant execute on function public.audit_log_append(text, uuid, text, text, text, text, uuid, text, text, jsonb, uuid, bytea)
  to service_role;

-- ─── support_tickets ──────────────────────────────────────────────────────────────────────────
create sequence public.support_tickets_ref_seq as bigint;
grant usage on sequence public.support_tickets_ref_seq to service_role;

create table public.support_tickets (
  id uuid not null default gen_random_uuid(),
  public_ref text not null default (
    'DA-' || to_char(now() at time zone 'UTC', 'YYYY') || '-'
    || lpad(nextval('public.support_tickets_ref_seq')::text, 6, '0')),
  user_id uuid,
  category public.ticket_category not null,
  status public.ticket_status not null default 'open',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 5000),
  contact_email extensions.citext,
  platform text check (platform in ('ios', 'android', 'web')),
  app_version text,
  origin text not null check (origin in ('app', 'web', 'email')),
  assigned_admin_id uuid,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_pkey primary key (id),
  constraint support_tickets_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null,
  constraint support_tickets_assigned_admin_id_fkey foreign key (assigned_admin_id)
    references public.admin_users (user_id) on delete set null,
  constraint support_tickets_public_ref_key unique (public_ref)
);
alter sequence public.support_tickets_ref_seq owned by public.support_tickets.public_ref;
create index support_tickets_status_category_created_at_idx on public.support_tickets (status, category, created_at desc);
create index support_tickets_user_id_idx on public.support_tickets (user_id);
create index support_tickets_assigned_admin_id_p on public.support_tickets (assigned_admin_id)
  where status in ('open', 'in_progress');
create index support_tickets_assigned_admin_id_idx on public.support_tickets (assigned_admin_id);
create trigger trg_support_tickets_updated_at before update on public.support_tickets
  for each row execute function private.set_updated_at();
alter table public.support_tickets enable row level security;
alter table public.support_tickets force row level security;
comment on table public.support_tickets is
  'Support tickets from app, web and email with display id DA-YYYY-###### (M§62, §69).';

-- ─── support_notes (SYS + aal2; append-only by grants) ────────────────────────────────────────
create table public.support_notes (
  id uuid not null default gen_random_uuid(),
  ticket_id uuid not null,
  user_id uuid,                                       -- the ticket's user (retention)
  author_admin_id uuid not null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  constraint support_notes_pkey primary key (id),
  constraint support_notes_ticket_id_fkey foreign key (ticket_id) references public.support_tickets (id) on delete cascade,
  constraint support_notes_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null,
  constraint support_notes_author_admin_id_fkey foreign key (author_admin_id)
    references public.admin_users (user_id) on delete restrict
);
create index support_notes_ticket_id_created_at_idx on public.support_notes (ticket_id, created_at);
create index support_notes_user_id_idx on public.support_notes (user_id);
create index support_notes_author_admin_id_idx on public.support_notes (author_admin_id);
alter table public.support_notes enable row level security;
alter table public.support_notes force row level security;
comment on table public.support_notes is 'Internal support notes, append-only (no update grant). System table.';

-- ─── support_access_grants (SYS + aal2; R-09) ─────────────────────────────────────────────────
create table public.support_access_grants (
  id uuid not null default gen_random_uuid(),
  admin_user_id uuid not null,
  user_id uuid not null,
  ticket_id uuid,
  scope public.support_access_scope[] not null check (cardinality(scope) >= 1),
  reason text not null check (char_length(reason) >= 15),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  expired_audited_at timestamptz,
  reveal_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint support_access_grants_pkey primary key (id),
  constraint support_access_grants_admin_user_id_fkey foreign key (admin_user_id)
    references public.admin_users (user_id) on delete restrict,
  constraint support_access_grants_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint support_access_grants_ticket_id_fkey foreign key (ticket_id)
    references public.support_tickets (id) on delete set null,
  -- R-09: 15, 30 or 60 minutes, never longer.
  constraint support_access_grants_duration_check check (
    expires_at - starts_at in (interval '15 minutes', interval '30 minutes', interval '60 minutes'))
);
create index support_access_grants_user_id_expires_at_p on public.support_access_grants (user_id, expires_at)
  where revoked_at is null;
create index support_access_grants_admin_user_id_idx on public.support_access_grants (admin_user_id);
create index support_access_grants_user_id_idx on public.support_access_grants (user_id);
create index support_access_grants_ticket_id_idx on public.support_access_grants (ticket_id);
alter table public.support_access_grants enable row level security;
alter table public.support_access_grants force row level security;
comment on table public.support_access_grants is
  'Time-boxed, reasoned access to sensitive user content (M§49, §71; R-09); every reveal is audited. No impersonation. System table.';

-- ─── Deferred foreign keys to admin_users ─────────────────────────────────────────────────────
alter table public.profiles
  add constraint profiles_disabled_by_fkey foreign key (disabled_by) references public.admin_users (user_id) on delete set null;
create index profiles_disabled_by_idx on public.profiles (disabled_by);

alter table public.prompt_versions
  add constraint prompt_versions_created_by_fkey foreign key (created_by)
    references public.admin_users (user_id) on delete set null,
  add constraint prompt_versions_activated_by_fkey foreign key (activated_by)
    references public.admin_users (user_id) on delete set null;
create index prompt_versions_created_by_idx on public.prompt_versions (created_by);
create index prompt_versions_activated_by_idx on public.prompt_versions (activated_by);

alter table public.ai_model_config
  add constraint ai_model_config_updated_by_fkey foreign key (updated_by)
    references public.admin_users (user_id) on delete set null;
create index ai_model_config_updated_by_idx on public.ai_model_config (updated_by);

alter table public.ai_model_prices
  add constraint ai_model_prices_updated_by_fkey foreign key (updated_by)
    references public.admin_users (user_id) on delete set null;
create index ai_model_prices_updated_by_idx on public.ai_model_prices (updated_by);

alter table public.ai_calibration_versions
  add constraint ai_calibration_versions_activated_by_fkey foreign key (activated_by)
    references public.admin_users (user_id) on delete set null;
create index ai_calibration_versions_activated_by_idx on public.ai_calibration_versions (activated_by);

alter table public.entitlement_grants
  add constraint entitlement_grants_granted_by_admin_id_fkey foreign key (granted_by_admin_id)
    references public.admin_users (user_id) on delete set null,
  add constraint entitlement_grants_revoked_by_admin_id_fkey foreign key (revoked_by_admin_id)
    references public.admin_users (user_id) on delete set null;
create index entitlement_grants_granted_by_admin_id_idx on public.entitlement_grants (granted_by_admin_id);
create index entitlement_grants_revoked_by_admin_id_idx on public.entitlement_grants (revoked_by_admin_id);

alter table public.plan_limits
  add constraint plan_limits_updated_by_fkey foreign key (updated_by)
    references public.admin_users (user_id) on delete set null;
create index plan_limits_updated_by_idx on public.plan_limits (updated_by);

alter table public.referrals
  add constraint referrals_reviewed_by_admin_id_fkey foreign key (reviewed_by_admin_id)
    references public.admin_users (user_id) on delete set null;
create index referrals_reviewed_by_admin_id_idx on public.referrals (reviewed_by_admin_id);

alter table public.feature_flags
  add constraint feature_flags_updated_by_fkey foreign key (updated_by)
    references public.admin_users (user_id) on delete set null;
create index feature_flags_updated_by_idx on public.feature_flags (updated_by);

alter table public.feature_flag_overrides
  add constraint feature_flag_overrides_created_by_admin_id_fkey foreign key (created_by_admin_id)
    references public.admin_users (user_id) on delete restrict;
create index feature_flag_overrides_created_by_admin_id_idx on public.feature_flag_overrides (created_by_admin_id);

alter table public.announcements
  add constraint announcements_created_by_fkey foreign key (created_by)
    references public.admin_users (user_id) on delete set null,
  add constraint announcements_updated_by_fkey foreign key (updated_by)
    references public.admin_users (user_id) on delete set null;
create index announcements_created_by_idx on public.announcements (created_by);
create index announcements_updated_by_idx on public.announcements (updated_by);

alter table public.user_feedback
  add constraint user_feedback_assigned_admin_id_fkey foreign key (assigned_admin_id)
    references public.admin_users (user_id) on delete set null;
create index user_feedback_assigned_admin_id_idx on public.user_feedback (assigned_admin_id);

alter table public.app_settings
  add constraint app_settings_updated_by_fkey foreign key (updated_by)
    references public.admin_users (user_id) on delete set null;
create index app_settings_updated_by_idx on public.app_settings (updated_by);
