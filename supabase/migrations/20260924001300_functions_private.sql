-- Migration 0013a · private helper functions
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §6.1 (core helpers), §6.2 (jobs), §6.4 (retention), §6.5
-- (plan limits, entitlements, budgets, rate limits), §6.6 (approvals), §6.8 (admin guard), §7
-- (triggers); IMPLEMENTATION_PLAN T-2.15; BACKOFFICE_PLAN §2.6, §3.1; API_CONTRACTS §4, §6, §11.
--
-- Conventions: every function sets search_path = '' and uses fully qualified names; every private
-- function has EXECUTE revoked from PUBLIC and is granted explicitly (0014 adds nothing here).
-- Security-definer functions are owned by the migration role (postgres: superuser on tier C,
-- BYPASSRLS on hosted Supabase), so FORCE ROW LEVEL SECURITY never blocks them.
--
-- Error convention (mapped by the Edge Functions, API_CONTRACTS §2.6):
--   42501  ADMIN_* (admin guard), FORBIDDEN, NOT_OWNER
--   55000  state errors: ILLEGAL_TRANSITION:<from>-><to>, IDEMPOTENCY_MISMATCH, LEASE_LOST, STATE_CONFLICT
--   P0001  PLAN_LIMIT:<key>, ENTITLEMENT_REQUIRED:<feature>
--   P0002  NOT_FOUND
--   22023  invalid arguments (VALIDATION_FAILED:<field>)

-- Each migration runs in one transaction; never wait long on a lock held by live traffic.
set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Column additions required by the function contracts ════════════════════════════════════
-- feature_flags.archived_at: API_CONTRACTS ADM-14 `POST /flags/:key/archive` (admin_api.flag_archive,
-- BACKOFFICE_PLAN §16 #20). An archived flag evaluates to false and is hidden from flag lists.
alter table public.feature_flags add column archived_at timestamptz;

-- ═══ Shared helpers ═══════════════════════════════════════════════════════════════════════════

-- updated_at trigger, extended so that private.recompute_expires_at can rewrite expires_at
-- without moving the retention anchor of tables anchored on updated_at (reply_drafts).
create or replace function private.set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if coalesce(current_setting('da.retention_recompute', true), '') = 'on' then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- "Yunus Emre" → "Y*** E***" (M§71).
create function private.mask_name(p_name text) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p_name is null then null
      when btrim(p_name) = '' then '***'
      else (select string_agg(left(w, 1) || '***', ' ' order by ord)
            from regexp_split_to_table(btrim(p_name), '\s+') with ordinality as t (w, ord))
    end
  $$;

-- ExponentPushToken[abcdef…wxyz] → ExponentPushToken[…wxyz] (last 4 characters only).
create function private.mask_push_token(p_token text) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p_token is null then null
      when p_token ~ '^Expo(nent)?PushToken\[.+\]$' then
        substring(p_token from '^(Expo(?:nent)?PushToken)\[') || '[…'
        || right(substring(p_token from '\[(.+)\]$'), 4) || ']'
      else '…' || right(p_token, 4)
    end
  $$;

-- Semantic version comparison for x.y.z strings: -1, 0, 1 (NULL when either side is unparsable).
create function private.compare_semver(p_a text, p_b text) returns integer
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p_a !~ '^\d+(\.\d+){0,2}$' or p_b !~ '^\d+(\.\d+){0,2}$' then null
      else sign(
        (select coalesce(
           (select (x.a - x.b)
            from (select coalesce((string_to_array(p_a, '.'))[i]::bigint, 0) as a,
                         coalesce((string_to_array(p_b, '.'))[i]::bigint, 0) as b, i
                  from generate_series(1, 3) as g (i)) as x
            where x.a <> x.b order by x.i limit 1), 0)))::integer
    end
  $$;

-- Typed read of one app_settings value (NULL when missing).
create function private.app_setting(p_key text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select s.value from public.app_settings s where s.key = p_key $$;

create function private.app_setting_int(p_key text, p_default integer) returns integer
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce(
      (select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric::integer end
       from public.app_settings s where s.key = p_key),
      p_default)
  $$;

-- The user's IANA timezone (the only source of truth, §1.3); Europe/Istanbul when unknown.
create function private.user_timezone(p_user uuid) returns text
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce((select up.timezone from public.user_preferences up where up.user_id = p_user), 'Europe/Istanbul')
  $$;

-- The user's local calendar date at p_now.
create function private.user_local_date(p_user uuid, p_now timestamptz) returns date
  language sql stable
  security definer
  set search_path = ''
  as $$ select (p_now at time zone private.user_timezone(p_user))::date $$;

-- JSON number in USD → integer micro-USD without float arithmetic (AI_PIPELINE_PLAN §8.9).
create function private.usd_to_micros(p_value jsonb) returns bigint
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case when jsonb_typeof(p_value) = 'number' then ((p_value #>> '{}')::numeric * 1000000)::bigint end
  $$;

-- True when the current statement runs for an end-user API role (PostgREST sets ROLE).
create function private.caller_is_client() returns boolean
  language sql stable
  set search_path = ''
  as $$ select coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon') $$;

-- ═══ Entitlements and plan limits (§6.5; packages/domain/src/entitlements/effective.ts) ════════

-- Effective entitlement at an explicit instant. Mirrors effectiveEntitlement() in
-- packages/domain (shared vectors: packages/domain/test/vectors/entitlement.json):
-- store active = mirror is_active, status not in (none, expired, refunded, paused), end (expires_at,
-- extended to grace_expires_at while in grace/billing issue; NULL = non-expiring) after p_now;
-- grants stack without overlap; active_until = end of the contiguous coverage from p_now.
create function private.effective_entitlement_at(
  p_user uuid, p_now timestamptz, p_ignore_sandbox boolean default false
) returns table (
  entitlement text, is_active boolean, source text, is_trial boolean, will_renew boolean,
  store_expires_at timestamptz, grant_ends_at timestamptz, active_until timestamptz
)
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  v_sub public.subscriptions%rowtype;
  v_store_end timestamptz;          -- 'infinity' for a non-expiring store entitlement
  v_store_active boolean := false;
  v_grant_end timestamptz;
  v_until timestamptz;
  v_changed boolean;
  v_starts timestamptz[];
  v_ends timestamptz[];
  i integer;
begin
  select s.* into v_sub from public.subscriptions s where s.user_id = p_user and s.entitlement = 'pro';
  if found and v_sub.is_active and v_sub.status not in ('none', 'expired', 'refunded', 'paused')
     and not (p_ignore_sandbox and v_sub.environment = 'sandbox') then
    v_store_end := coalesce(v_sub.expires_at, 'infinity'::timestamptz);
    if v_sub.status in ('grace_period', 'billing_issue') and v_sub.grace_expires_at is not null then
      v_store_end := greatest(v_store_end, v_sub.grace_expires_at);
    end if;
    v_store_active := v_store_end > p_now;
  end if;

  select coalesce(array_agg(g.starts_at order by g.starts_at), '{}'), coalesce(array_agg(g.ends_at order by g.starts_at), '{}')
    into v_starts, v_ends
  from public.entitlement_grants g
  where g.user_id = p_user and g.entitlement = 'pro' and g.revoked_at is null and g.ends_at > g.starts_at;

  -- End of the grant coverage that contains p_now (then extended across touching grants).
  for i in 1 .. coalesce(array_length(v_starts, 1), 0) loop
    if v_starts[i] <= p_now and p_now < v_ends[i] then
      v_grant_end := greatest(coalesce(v_grant_end, v_ends[i]), v_ends[i]);
    end if;
  end loop;
  if v_grant_end is not null then
    loop
      v_changed := false;
      for i in 1 .. array_length(v_starts, 1) loop
        if v_starts[i] <= v_grant_end and v_ends[i] > v_grant_end then
          v_grant_end := v_ends[i];
          v_changed := true;
        end if;
      end loop;
      exit when not v_changed;
    end loop;
  end if;

  if not v_store_active and v_grant_end is null then
    return query select 'free'::text, false, 'none'::text, false, false,
                        null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- Contiguous coverage across the store window [-inf, store_end) and every grant.
  if v_store_active then
    v_until := v_store_end;
  else
    v_until := v_grant_end;
  end if;
  if v_until <> 'infinity'::timestamptz then
    loop
      v_changed := false;
      for i in 1 .. coalesce(array_length(v_starts, 1), 0) loop
        if v_starts[i] <= v_until and v_ends[i] > v_until then
          v_until := v_ends[i];
          v_changed := true;
        end if;
      end loop;
      exit when not v_changed;
    end loop;
  end if;

  return query select
    'pro'::text,
    true,
    case when v_store_active then 'store' else 'grant' end,
    v_store_active and (v_sub.status = 'trial' or v_sub.period_type = 'trial'),
    v_store_active and v_sub.will_renew,
    case when v_store_active and v_store_end <> 'infinity'::timestamptz then v_store_end end,
    v_grant_end,
    case when v_until = 'infinity'::timestamptz then null else v_until end;
end
$$;

create function private.is_pro(p_user uuid) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$ select coalesce((select e.is_active from private.effective_entitlement_at(p_user, now()) as e), false) $$;

create function private.plan_of(p_user uuid) returns text
  language sql stable
  security definer
  set search_path = ''
  as $$ select case when private.is_pro(p_user) then 'pro' else 'free' end $$;

-- plan_limits value of the user's effective plan (§6.5; R-22).
create function private.plan_limit(p_user uuid, p_key text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select pl.value from public.plan_limits pl where pl.plan = private.plan_of(p_user) and pl.key = p_key $$;

-- Integer limit (NULL when the key is missing or JSON null = no cap).
create function private.plan_limit_int(p_user uuid, p_key text) returns integer
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.jsonb_numeric(private.plan_limit(p_user, p_key))::integer $$;

-- ═══ Admin guard (§6.8; BACKOFFICE_PLAN §2.6) ═════════════════════════════════════════════════

-- Blocks direct PostgREST calls to admin_api: sha256 of the x-da-admin-gateway request header
-- must equal app_settings['admin.gateway_secret_sha256'] (hex). Fails closed when unset.
create function private.assert_admin_gateway() returns void
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  v_expected text := (select s.value #>> '{}' from public.app_settings s where s.key = 'admin.gateway_secret_sha256');
  v_header text;
begin
  begin
    v_header := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-da-admin-gateway';
  exception when others then
    v_header := null;
  end;
  if v_expected is null or v_header is null or v_header = ''
     or encode(pg_catalog.sha256(convert_to(v_header, 'UTF8')), 'hex') <> lower(v_expected) then
    raise exception 'ADMIN_GATEWAY_REQUIRED' using errcode = '42501';
  end if;
end
$$;

create function private.admin_has_permission(p_role public.admin_role, p_permissions text[]) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select exists (select 1 from private.admin_role_permissions p
                   where p.role = p_role and p.permission = any(p_permissions))
  $$;

-- The admin guard behind every admin_api function (§6.8 steps 0–5):
--   0 gateway header · 1 aal2 · 2 dedicated admin identity + active admin_users row (not locked) ·
--   3 permission (any of p_permissions; NULL/empty = any active admin) · 4 admin session: present,
--   not ended, idle and absolute limits (app_settings session.*), touched at most every 30 s.
-- Failures raise 42501 with ADMIN_GATEWAY_REQUIRED | ADMIN_AAL2_REQUIRED | ADMIN_REQUIRED |
-- ADMIN_LOCKED | ADMIN_FORBIDDEN | ADMIN_SESSION_EXPIRED. A raise rolls back the caller's
-- transaction, so the denial audit row and the session end are written by the follow-up calls
-- admin_api.audit_denied and admin_api.session_expire (BACKOFFICE_PLAN §2.5 step 6, §3.7).
create function private.admin_guard(
  p_permissions text[],
  p_require_session boolean default true,
  p_touch boolean default true,
  p_allow_aal1 boolean default false
) returns public.admin_users
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_claims jsonb := auth.jwt();
  v_uid uuid := auth.uid();
  v_admin public.admin_users;
  v_session public.admin_sessions;
  v_sid text := v_claims ->> 'session_id';
  v_idle interval := make_interval(mins => private.app_setting_int('session.idle_minutes', 30));
  v_abs interval := make_interval(hours => private.app_setting_int('session.absolute_hours', 12));
begin
  perform private.assert_admin_gateway();
  if not p_allow_aal1 and (v_claims ->> 'aal') is distinct from 'aal2' then
    raise exception 'ADMIN_AAL2_REQUIRED' using errcode = '42501';
  end if;
  if v_uid is null or (v_claims -> 'app_metadata' ->> 'da_kind') is distinct from 'admin' then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select a.* into v_admin from public.admin_users a where a.user_id = v_uid and a.status = 'active';
  if not found then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if v_admin.locked_until is not null and v_admin.locked_until > now() then
    raise exception 'ADMIN_LOCKED' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_permissions, '{}')) > 0
     and not private.admin_has_permission(v_admin.role, p_permissions) then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501', detail = array_to_string(p_permissions, '|');
  end if;
  if p_require_session then
    if v_sid is null or v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'ADMIN_SESSION_EXPIRED' using errcode = '42501';
    end if;
    select s.* into v_session from public.admin_sessions s
    where s.auth_session_id = v_sid::uuid and s.admin_user_id = v_uid;
    if not found or v_session.ended_at is not null
       or v_session.idle_expires_at <= now() or v_session.absolute_expires_at <= now()
       or v_session.last_activity_at + v_idle <= now() or v_session.created_at + v_abs <= now() then
      raise exception 'ADMIN_SESSION_EXPIRED' using errcode = '42501';
    end if;
    if p_touch and v_session.last_activity_at < now() - interval '30 seconds' then
      update public.admin_sessions s
        set last_activity_at = now(), idle_expires_at = now() + v_idle
        where s.id = v_session.id;
    end if;
  end if;
  return v_admin;
end
$$;

create function private.require_admin(p_permission text) returns public.admin_users
  language sql
  security definer
  set search_path = ''
  as $$ select private.admin_guard(case when p_permission is null then null else array[p_permission] end) $$;

create function private.require_admin_any(p_permissions text[]) returns public.admin_users
  language sql
  security definer
  set search_path = ''
  as $$ select private.admin_guard(p_permissions) $$;

-- Custom access token hook (ADR-06, R-08): adds admin_role only for an active, unlocked admin
-- with a dedicated admin identity; removes it otherwise.
create function private.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid;
  v_role public.admin_role;
begin
  begin
    v_user := (event ->> 'user_id')::uuid;
  exception when others then
    v_user := null;
  end;
  select a.role into v_role
  from public.admin_users a
  join auth.users u on u.id = a.user_id
  where a.user_id = v_user and a.status = 'active'
    and (a.locked_until is null or a.locked_until <= now())
    and coalesce(u.raw_app_meta_data ->> 'da_kind', '') = 'admin';
  if v_role is not null then
    v_claims := jsonb_set(v_claims, '{admin_role}', to_jsonb(v_role::text));
  else
    v_claims := v_claims - 'admin_role';
  end if;
  return jsonb_set(coalesce(event, '{}'::jsonb), '{claims}', v_claims);
end
$$;

-- ═══ Feature flags (§4.7; API_CONTRACTS §4.4) ═════════════════════════════════════════════════

-- One flag for one user: {key, value, matched_rule, bucket}. Order: missing/archived → false;
-- a killed kill switch → false for everyone; a live override wins; disabled → false; then
-- platform, plan, version and percentage targeting. Bucket = first 32 bits of md5(key ':' user_id)
-- mod 100 (BACKOFFICE_PLAN §6.13), reproducible outside the database.
create function private.evaluate_flag(p_key text, p_user uuid, p_platform public.platform, p_app_version text)
  returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  f public.feature_flags%rowtype;
  v_bucket integer := ((('x' || left(md5(p_key || ':' || coalesce(p_user::text, '')), 8))::bit(32)::bigint) % 100)::integer;
  v_override boolean;
  v_rule text;
  v_value boolean;
begin
  select * into f from public.feature_flags ff where ff.key = p_key;
  if not found then
    v_value := false; v_rule := 'disabled';
  elsif f.archived_at is not null then
    v_value := false; v_rule := 'archived';
  elsif f.is_kill_switch and not f.enabled then
    v_value := false; v_rule := 'disabled';
  else
    select o.value into v_override from public.feature_flag_overrides o
    where o.flag_key = p_key and o.user_id = p_user and (o.expires_at is null or o.expires_at > now());
    if found then
      v_value := v_override; v_rule := 'override';
    elsif not f.enabled then
      v_value := false; v_rule := 'disabled';
    elsif f.platforms is not null and (p_platform is null or not (p_platform = any(f.platforms))) then
      v_value := false; v_rule := 'platform';
    elsif f.plans is not null and not (private.plan_of(p_user) = any(f.plans)) then
      v_value := false; v_rule := 'plan';
    elsif (f.min_app_version is not null
           and coalesce(private.compare_semver(p_app_version, f.min_app_version), -1) < 0)
       or (f.max_app_version is not null
           and coalesce(private.compare_semver(p_app_version, f.max_app_version), 1) > 0) then
      v_value := false; v_rule := 'version';
    elsif v_bucket >= f.rollout_percentage then
      v_value := false; v_rule := 'percentage';
    else
      v_value := true; v_rule := 'default';
    end if;
  end if;
  return jsonb_build_object('key', p_key, 'value', v_value, 'matched_rule', v_rule, 'bucket', v_bucket);
end
$$;

-- Every non-archived flag for one user → {key: boolean} (GET /me/bootstrap, server gates).
create function private.evaluate_flags(p_user uuid, p_platform public.platform, p_app_version text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce(jsonb_object_agg(f.key, (private.evaluate_flag(f.key, p_user, p_platform, p_app_version) ->> 'value')::boolean
                                     order by f.key), '{}'::jsonb)
    from public.feature_flags f
    where f.archived_at is null
  $$;

-- ═══ Integrations (§4.2, INTEGRATION_PLAN §3.4, §3.6) ════════════════════════════════════════

-- Effective capability (§4.2): granted ∧ toggle on ∧ healthy/syncing/partial ∧ binding completed
-- ∧ within the plan's account allowance. After a Pro downgrade the extra accounts are paused, not
-- deleted (API_CONTRACTS §4.1): only the earliest max_mail_accounts / max_calendar_accounts
-- active accounts of the class keep that class of capability.
create function private.account_can(p_account uuid, p_cap public.capability) returns boolean
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_toggle text;
  v_class public.capability;
  v_limit integer;
  v_rank bigint;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found then
    return false;
  end if;
  if not (p_cap = any(a.capabilities_granted)) or a.status not in ('healthy', 'syncing', 'partial')
     or a.pending_binding_until is not null then
    return false;
  end if;
  v_toggle := case p_cap
    when 'mail_read' then 'mail_read'
    when 'calendar_read' then 'calendar_read'
    when 'calendar_write' then 'calendar_write_with_approval'
    when 'tasks_read' then 'tasks_read'
  end;
  if v_toggle is not null and not coalesce((a.data_source_toggles ->> v_toggle)::boolean, true) then
    return false;
  end if;
  v_class := case when p_cap in ('mail_read', 'mail_send') then 'mail_read'::public.capability
                  when p_cap in ('calendar_read', 'calendar_write') then 'calendar_read'::public.capability end;
  if v_class is not null then
    v_limit := private.plan_limit_int(a.user_id,
                 case v_class when 'mail_read' then 'max_mail_accounts' else 'max_calendar_accounts' end);
    if v_limit is not null then
      select r.rn into v_rank from (
        select ca.id, row_number() over (order by coalesce(ca.connected_at, ca.created_at), ca.id) as rn
        from public.connected_accounts ca
        where ca.user_id = a.user_id and ca.status <> 'disconnected' and v_class = any(ca.capabilities_granted)
      ) as r where r.id = a.id;
      if v_rank is null or v_rank > v_limit then
        return false;
      end if;
    end if;
  end if;
  return true;
end
$$;

-- Token bucket per (bucket, account, window): admits p_units when the window has room and
-- returns 0, otherwise counts a throttle and returns the milliseconds until the window ends.
create function private.consume_provider_quota(
  p_bucket text, p_account uuid, p_units integer, p_limit integer, p_window_seconds integer,
  p_provider public.provider default null
) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_user uuid;
  v_provider public.provider := p_provider;
  v_id bigint;
begin
  if p_units is null or p_units < 0 or p_limit is null or p_limit <= 0
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'VALIDATION_FAILED:quota' using errcode = '22023';
  end if;
  if p_account is not null then
    select ca.user_id, coalesce(v_provider, ca.provider) into v_user, v_provider
    from public.connected_accounts ca where ca.id = p_account;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  v_provider := coalesce(v_provider, case
    when p_bucket like 'gmail\_%' or p_bucket like 'gcal\_%' or p_bucket like 'gtasks\_%' then 'google'
    when p_bucket like 'graph\_%' then 'microsoft' end::public.provider);
  if v_provider is null then
    raise exception 'VALIDATION_FAILED:provider' using errcode = '22023';
  end if;

  insert into public.provider_quota_usage (bucket, connected_account_id, user_id, provider, window_start,
                                           window_seconds, units_used, units_limit)
  values (p_bucket, p_account, v_user, v_provider, v_window, p_window_seconds, 0, p_limit)
  on conflict (bucket, coalesce(connected_account_id, '00000000-0000-0000-0000-000000000000'::uuid), window_start)
  do nothing;

  update public.provider_quota_usage q
    set units_used = q.units_used + p_units, request_count = q.request_count + 1, units_limit = p_limit,
        updated_at = now()
  where q.bucket = p_bucket
    and coalesce(q.connected_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_account, '00000000-0000-0000-0000-000000000000'::uuid)
    and q.window_start = v_window
    and q.units_used + p_units <= p_limit
  returning q.id into v_id;
  if v_id is not null then
    return 0;
  end if;

  update public.provider_quota_usage q
    set throttled_count = q.throttled_count + 1, updated_at = now()
  where q.bucket = p_bucket
    and coalesce(q.connected_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_account, '00000000-0000-0000-0000-000000000000'::uuid)
    and q.window_start = v_window;
  return greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())) * 1000))::integer;
end
$$;

-- Single-flight token refresh (INTEGRATION_PLAN §3.4): atomically takes the refresh lock on the
-- account's access-token row (or its refresh-token row while no access token exists yet).
create function private.try_lock_credential_refresh(p_account uuid, p_owner text, p_seconds integer default 30)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_id uuid;
begin
  update public.oauth_credentials c
    set refresh_lock_until = now() + make_interval(secs => greatest(coalesce(p_seconds, 30), 1)),
        refresh_lock_owner = p_owner
  where c.id = (
      select c2.id from public.oauth_credentials c2
      where c2.connected_account_id = p_account and c2.token_kind in ('access', 'refresh')
      order by (c2.token_kind = 'access') desc
      limit 1)
    and (c.refresh_lock_until is null or c.refresh_lock_until < now() or c.refresh_lock_owner = p_owner)
  returning c.id into v_id;
  return v_id is not null;
end
$$;

-- Apple `sub` of a Sign in with Apple identity, for SIWA revocation at account deletion.
create function private.user_apple_sub(p_user uuid) returns text
  language sql stable
  security definer
  set search_path = ''
  as $$
    select i.provider_id from auth.identities i where i.user_id = p_user and i.provider = 'apple'
    order by i.created_at limit 1
  $$;

-- ═══ Jobs (§6.2; API_CONTRACTS §11) ═══════════════════════════════════════════════════════════

create function private.enqueue_job(
  p_type public.job_type, p_idempotency_key text, p_payload jsonb default '{}'::jsonb, p_user_id uuid default null,
  p_account_id uuid default null, p_run_after timestamptz default now(), p_priority integer default 100,
  p_max_attempts integer default 5, p_correlation_id uuid default null
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_id uuid;
begin
  insert into public.jobs (type, idempotency_key, payload, user_id, connected_account_id, run_after, priority,
                           max_attempts, correlation_id)
  values (p_type, p_idempotency_key, coalesce(p_payload, '{}'::jsonb), p_user_id, p_account_id,
          coalesce(p_run_after, now()), coalesce(p_priority, 100)::smallint, coalesce(p_max_attempts, 5),
          coalesce(p_correlation_id, gen_random_uuid()))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select j.id into v_id from public.jobs j where j.idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end
$$;

-- Exponential backoff with ±20 % jitter (§6.2): min(3600, 30·2^(attempt−1)) s × [0.8, 1.2].
create function private.job_backoff_seconds(p_attempts integer) returns double precision
  language sql volatile
  set search_path = ''
  as $$
    select least(3600, 30 * power(2, greatest(coalesce(p_attempts, 1), 1) - 1)) * (0.8 + random() * 0.4)
  $$;

-- Shared failure path of fail_job and reap_expired_leases.
create function private.fail_job_row(
  p_job public.jobs, p_error_code text, p_error_message text, p_retryable boolean,
  p_retry_after_seconds integer, p_outcome text
) returns public.job_status
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_status public.job_status;
  v_message text := left(p_error_message, 500);
begin
  if not coalesce(p_retryable, true) then
    v_status := 'failed';
  elsif p_job.attempts >= p_job.max_attempts then
    v_status := 'dead_letter';
  else
    v_status := 'retrying';
  end if;
  update public.jobs j
    set status = v_status,
        run_after = case when v_status = 'retrying'
                         then now() + make_interval(secs => coalesce(p_retry_after_seconds::double precision,
                                                                     private.job_backoff_seconds(p_job.attempts)))
                         else j.run_after end,
        lease_owner = null, lease_expires_at = null,
        last_error_code = left(p_error_code, 120), last_error_message = v_message,
        dead_lettered_at = case when v_status = 'dead_letter' then now() else j.dead_lettered_at end
  where j.id = p_job.id;
  update public.job_attempts a
    set finished_at = now(),
        outcome = coalesce(p_outcome, case v_status when 'retrying' then 'retrying' when 'dead_letter' then 'dead_letter'
                                                    else 'failed' end),
        error_code = left(p_error_code, 120), error_message = v_message,
        duration_ms = (extract(epoch from (now() - a.started_at)) * 1000)::integer
  where a.job_id = p_job.id and a.attempt = p_job.attempts and a.finished_at is null;
  return v_status;
end
$$;

-- Lease recovery (§6.3 step 1): running jobs whose lease expired fail as retryable LEASE_EXPIRED.
create function private.reap_expired_leases(p_now timestamptz default now()) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  j public.jobs;
  v_count integer := 0;
begin
  for j in
    select * from public.jobs x
    where x.status = 'running' and x.lease_expires_at < p_now
    order by x.lease_expires_at
    limit 500
    for update skip locked
  loop
    perform private.fail_job_row(j, 'LEASE_EXPIRED', 'lease expired before completion', true, 0, 'lease_lost');
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- pg_cron → pg_net → worker (ADR-04). Posts only when due jobs exist and both Vault secrets are
-- set; returns the pg_net request id, or NULL when nothing was sent. Tier C: the shim's
-- net.http_post records the call.
create function private.poke_worker(p_reason text default 'cron') returns bigint
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_url text;
  v_secret text;
  v_id bigint;
begin
  if not exists (select 1 from public.jobs j where j.status in ('queued', 'retrying') and j.run_after <= now()) then
    return null;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return null;
  end if;
  execute $q$select (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'da_project_url'),
                    (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'da_cron_secret')$q$
    into v_url, v_secret;
  if v_url is null or v_secret is null then
    return null;
  end if;
  execute 'select net.http_post(url := $1, body := $2, params := $3, headers := $4, timeout_milliseconds := $5)'
    into v_id
    using rtrim(v_url, '/') || '/functions/v1/worker/run', '{}'::jsonb, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'apikey', v_secret,
                             'x-da-reason', coalesce(p_reason, 'cron')),
          2000;
  return v_id;
end
$$;

-- ═══ Approvals (§6.6; API_CONTRACTS §6) ══════════════════════════════════════════════════════

-- The only way to move an approval between states: exactly the plan §5 machine (R-06).
--   pending → approved | rejected | expired · approved → executing · executing → executed | failed ·
--   failed → executing (retry with the same key; the approval_execute job row is re-queued).
-- Idempotent: the same target status with the same key returns the row without a new event.
-- approved needs the client-sent key (IDEMPOTENCY_MISMATCH otherwise), a tap surface p_via (R-03)
-- and an unexpired row (an expired row is moved to `expired` and returned; the api maps it to
-- APPROVAL_EXPIRED). Device rows need an installation of the owner and, for results, the hash of
-- the one-time execution token (R-18). approved (server executor) enqueues approval_execute.
create function private.transition_approval(
  p_id uuid, p_to public.approval_status, p_actor text, p_actor_id uuid, p_idempotency_key text,
  p_reason text default null, p_result jsonb default null, p_error_code text default null,
  p_error_message text default null, p_via public.approval_via default null,
  p_device_token_hash bytea default null
) returns public.approval_actions
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.approval_actions;
  v_from public.approval_status;
  v_to public.approval_status := p_to;
  v_job_key text;
begin
  if p_actor is null or p_actor not in ('user', 'system', 'worker', 'admin') then
    raise exception 'VALIDATION_FAILED:actor' using errcode = '22023';
  end if;
  select * into a from public.approval_actions x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_from := a.status;

  if v_from = p_to and (p_idempotency_key is null or p_idempotency_key = a.idempotency_key) then
    return a;
  end if;

  if not ((v_from = 'pending' and p_to in ('approved', 'rejected', 'expired'))
          or (v_from = 'approved' and p_to = 'executing')
          or (v_from = 'executing' and p_to in ('executed', 'failed'))
          or (v_from = 'failed' and p_to = 'executing')) then
    raise exception 'ILLEGAL_TRANSITION:%->%', v_from, p_to using errcode = '55000';
  end if;

  if p_to = 'approved' then
    if p_idempotency_key is distinct from a.idempotency_key then
      raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '55000';
    end if;
    if p_via is null then
      raise exception 'VALIDATION_FAILED:approved_via' using errcode = '22023';
    end if;
    if a.executor = 'device' and not exists (
         select 1 from public.app_installations i where i.id = a.device_installation_id and i.user_id = a.user_id) then
      raise exception 'DEVICE_INSTALLATION_MISMATCH' using errcode = '42501';
    end if;
    if a.approval_expires_at <= now() then
      v_to := 'expired';
    end if;
  elsif p_to = 'executing' and v_from = 'failed'
        and p_idempotency_key is not null and p_idempotency_key <> a.idempotency_key then
    raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '55000';
  elsif p_to in ('executed', 'failed') and a.executor = 'device' and p_actor <> 'system'
        and (p_device_token_hash is null or a.device_token_hash is null or p_device_token_hash <> a.device_token_hash) then
    raise exception 'DEVICE_TOKEN_MISMATCH' using errcode = '42501';
  end if;

  perform set_config('da.approval_tx', 'on', true);
  update public.approval_actions x
    set status = v_to,
        approved_at = case when v_to = 'approved' then now() else x.approved_at end,
        approved_via = case when v_to = 'approved' then p_via else x.approved_via end,
        rejected_at = case when v_to = 'rejected' then now() else x.rejected_at end,
        rejection_reason = case when v_to = 'rejected' and p_reason in ('user_reject', 'user_cancel') then p_reason
                                when v_to = 'rejected' then 'user_reject' else x.rejection_reason end,
        executing_at = case when v_to = 'executing' then now() else x.executing_at end,
        attempt_count = case when v_to = 'executing' then x.attempt_count + 1 else x.attempt_count end,
        executed_at = case when v_to = 'executed' then now() else x.executed_at end,
        failed_at = case when v_to = 'failed' then now() else x.failed_at end,
        result = case when v_to in ('executed', 'failed') and p_result is not null then p_result else x.result end,
        provider_idempotency_ref = case when v_to = 'executed' then coalesce(p_result ->> 'provider_idempotency_ref',
                                                                             x.provider_idempotency_ref)
                                        else x.provider_idempotency_ref end,
        last_error_code = case when v_to = 'failed' then left(coalesce(p_error_code, 'UNKNOWN'), 120)
                               when v_to = 'expired' and p_to = 'approved' then 'APPROVAL_EXPIRED'
                               else x.last_error_code end,
        last_error_message = case when v_to = 'failed' then left(p_error_message, 300) else x.last_error_message end
  where x.id = p_id
  returning * into a;
  perform set_config('da.approval_tx', 'off', true);

  insert into public.approval_events (user_id, approval_action_id, from_status, to_status, actor, actor_id,
                                      payload_version, idempotency_key, reason)
  values (a.user_id, a.id, v_from, v_to, case when v_to = 'expired' and p_to = 'approved' then 'system' else p_actor end,
          p_actor_id, a.payload_version, a.idempotency_key,
          left(coalesce(p_reason, case when v_to = 'expired' then 'expired' end), 300));

  v_job_key := 'approval_execute:' || a.id || ':v' || a.payload_version;
  if v_to = 'approved' and a.executor = 'server' then
    perform private.enqueue_job('approval_execute', v_job_key, jsonb_build_object('approval_id', a.id), a.user_id,
                                a.destination_account_id, now(), 10, 5, null);
  elsif v_to = 'executing' and v_from = 'failed' and a.executor = 'server' then
    update public.jobs j
      set status = 'queued', run_after = now(), max_attempts = greatest(j.max_attempts, j.attempts + 1),
          lease_owner = null, lease_expires_at = null, dead_lettered_at = null, completed_at = null
    where j.idempotency_key = v_job_key and j.status in ('completed', 'failed', 'dead_letter', 'retrying');
    if not found and not exists (select 1 from public.jobs j where j.idempotency_key = v_job_key) then
      perform private.enqueue_job('approval_execute', v_job_key, jsonb_build_object('approval_id', a.id), a.user_id,
                                  a.destination_account_id, now(), 10, 5, null);
    end if;
  end if;

  if v_to in ('executed', 'failed') then
    perform private.audit_log_append(p_actor, p_actor_id, null, 'approval.' || v_to::text, 'approval_action', a.id::text,
                                     a.user_id, null, case when v_to = 'executed' then 'success' else 'failure' end,
                                     jsonb_build_object('action_type', a.action_type, 'attempt', a.attempt_count,
                                                        'error_code', a.last_error_code),
                                     null);
  end if;
  return a;
end
$$;

-- Edit while pending (SREQ-44): new payload version and key, event pending→pending 'edited'.
create function private.edit_approval_payload(
  p_id uuid, p_user uuid, p_payload jsonb, p_payload_hash bytea, p_change_summary text,
  p_exact_change jsonb default null
) returns public.approval_actions
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.approval_actions;
begin
  select * into a from public.approval_actions x where x.id = p_id and x.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status <> 'pending' then
    raise exception 'ILLEGAL_TRANSITION:%->pending', a.status using errcode = '55000';
  end if;
  perform set_config('da.approval_tx', 'on', true);
  update public.approval_actions x
    set payload = p_payload, payload_hash = p_payload_hash,
        change_summary = coalesce(left(p_change_summary, 500), x.change_summary),
        exact_change = coalesce(p_exact_change, x.exact_change),
        payload_version = x.payload_version + 1,
        idempotency_key = 'approval:' || x.id || ':v' || (x.payload_version + 1)
  where x.id = p_id
  returning * into a;
  perform set_config('da.approval_tx', 'off', true);
  insert into public.approval_events (user_id, approval_action_id, from_status, to_status, actor, actor_id,
                                      payload_version, idempotency_key, reason)
  values (a.user_id, a.id, 'pending', 'pending', 'user', p_user, a.payload_version, a.idempotency_key, 'edited');
  return a;
end
$$;

-- Device-executed approvals with no result 10 minutes after executing_at → failed (§6.6).
create function private.fail_stale_device_approvals(p_now timestamptz default now()) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select a.id from public.approval_actions a
    where a.status = 'executing' and a.executor = 'device' and a.executing_at < p_now - interval '10 minutes'
    order by a.executing_at
    limit 500
  loop
    perform private.transition_approval(v_id, 'failed', 'system', null, null, 'device_result_missing', null,
                                        'DEVICE_RESULT_MISSING', 'no device result within 10 minutes');
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- ═══ Grants and referrals (§6.5; plan §16) ═══════════════════════════════════════════════════

-- Stacked Pro grant (ADR-11): starts at the latest end of the user's live grants (or now) and
-- lasts p_days × 24 h. Idempotent on p_idempotency_key; audited as entitlement.granted.
create function private.grant_entitlement(
  p_user uuid, p_source public.grant_source, p_days smallint, p_reason text, p_admin uuid,
  p_idempotency_key text, p_referral_credit uuid default null
) returns public.entitlement_grants
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  g public.entitlement_grants;
  v_start timestamptz;
begin
  select * into g from public.entitlement_grants x where x.idempotency_key = p_idempotency_key;
  if found then
    return g;
  end if;
  perform pg_advisory_xact_lock(hashtext('entitlement_grant:' || p_user::text));
  select greatest(now(), coalesce(max(x.ends_at), now())) into v_start
  from public.entitlement_grants x
  where x.user_id = p_user and x.revoked_at is null and x.ends_at > now();
  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, duration_days, reason,
                                         granted_by_admin_id, referral_credit_id, idempotency_key)
  values (p_user, p_source, v_start, v_start + make_interval(days => p_days), p_days, p_reason, p_admin,
          p_referral_credit, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning * into g;
  if g.id is null then
    select * into g from public.entitlement_grants x where x.idempotency_key = p_idempotency_key;
    return g;
  end if;
  perform private.audit_log_append(case when p_admin is null then 'system' else 'admin' end, p_admin, null,
                                   'entitlement.granted', 'entitlement_grant', g.id::text, p_user,
                                   case when p_admin is null then null else p_reason end, 'success',
                                   jsonb_build_object('source', p_source, 'days', p_days, 'starts_at', g.starts_at,
                                                      'ends_at', g.ends_at),
                                   null);
  return g;
end
$$;

-- Rewards a qualified referral for both sides (+referral.reward_days Pro each, stacked). Fully
-- idempotent: credits are unique per (referral, side) and grants per credit key. The referrer's
-- yearly cap (plan_limits.referral_rewards_per_year, rolling 365 d) turns the referral into
-- rejected/cap_reached instead of rewarding it.
create function private.reward_referral(p_referral_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.referrals;
  v_days smallint := private.app_setting_int('referral.reward_days', 14)::smallint;
  v_cap integer;
  v_used integer;
  v_side public.referral_side;
  v_user uuid;
  v_credit uuid;
  v_grant public.entitlement_grants;
  v_result jsonb := '{}'::jsonb;
begin
  select * into r from public.referrals x where x.id = p_referral_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.status = 'rewarded' then
    return jsonb_build_object('status', 'rewarded', 'replayed', true);
  end if;
  if r.status <> 'qualified' then
    raise exception 'ILLEGAL_TRANSITION:%->rewarded', r.status using errcode = '55000';
  end if;

  if r.referrer_id is not null then
    v_cap := coalesce(private.plan_limit_int(r.referrer_id, 'referral_rewards_per_year'), 6);
    select count(*) into v_used from public.referral_credits c
    where c.user_id = r.referrer_id and c.side = 'referrer' and c.created_at > now() - interval '365 days';
    if v_used >= v_cap then
      update public.referrals x set status = 'rejected', rejected_at = now(), reject_reason = 'cap_reached'
      where x.id = r.id;
      perform private.audit_log_append('system', null, null, 'referral.rejected', 'referral', r.id::text, r.referrer_id,
                                       null, 'success', jsonb_build_object('reason', 'cap_reached'), null);
      return jsonb_build_object('status', 'rejected', 'reason', 'cap_reached');
    end if;
  end if;

  foreach v_side in array array['referrer', 'referee']::public.referral_side[] loop
    v_user := case v_side when 'referrer' then r.referrer_id else r.referee_id end;
    continue when v_user is null;
    insert into public.referral_credits (referral_id, user_id, side, days, idempotency_key)
    values (r.id, v_user, v_side, v_days, 'referral:' || r.id || ':' || v_side)
    on conflict (referral_id, side) do nothing
    returning id into v_credit;
    if v_credit is null then
      select c.id into v_credit from public.referral_credits c where c.referral_id = r.id and c.side = v_side;
    end if;
    v_grant := private.grant_entitlement(v_user,
                 case v_side when 'referrer' then 'referral_referrer' else 'referral_referee' end::public.grant_source,
                 v_days, null, null, 'referral:' || r.id || ':' || v_side, v_credit);
    update public.referral_credits c set entitlement_grant_id = v_grant.id
    where c.id = v_credit and c.entitlement_grant_id is null;
    v_result := v_result || jsonb_build_object(v_side::text, jsonb_build_object('credit_id', v_credit, 'grant_id', v_grant.id));
  end loop;

  update public.referrals x set status = 'rewarded', rewarded_at = now() where x.id = r.id;
  perform private.audit_log_append('system', null, null, 'referral.rewarded', 'referral', r.id::text, r.referrer_id,
                                   null, 'success', jsonb_build_object('days', v_days), null);
  return v_result || jsonb_build_object('status', 'rewarded');
end
$$;

-- ═══ AI budgets (§6.5; AI_PIPELINE_PLAN §8.9–§8.10) ═════════════════════════════════════════

create function private.ai_feature_is_briefing(p_feature public.ai_feature) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$ select p_feature in ('briefing_morning', 'briefing_midday', 'briefing_evening', 'weekly_review') $$;

-- Reserve before every model call: {allow, level, reason, reservation_id}. Serialised per user
-- and local day; compares actuals + open holds with the plan's units and USD caps (non-briefing
-- features may use only (1 − ai_briefing_reserve_ratio) of the daily hard cap; briefings never
-- consume units).
create function private.ai_budget_reserve(
  p_user uuid, p_feature public.ai_feature, p_est_cost_micros bigint, p_units integer default 0
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_date date := private.user_local_date(p_user, now());
  v_month date := date_trunc('month', private.user_local_date(p_user, now()))::date;
  v_briefing boolean := private.ai_feature_is_briefing(p_feature);
  v_units integer := case when private.ai_feature_is_briefing(p_feature) then 0 else greatest(coalesce(p_units, 0), 0) end;
  v_est bigint := greatest(coalesce(p_est_cost_micros, 0), 0);
  v_units_cap integer := private.plan_limit_int(p_user, 'ai_daily_budget_units');
  v_soft bigint := private.usd_to_micros(private.plan_limit(p_user, 'ai_soft_cap_usd_day'));
  v_hard_day bigint := private.usd_to_micros(private.plan_limit(p_user, 'ai_hard_cap_usd_day'));
  v_hard_month bigint := private.usd_to_micros(private.plan_limit(p_user, 'ai_hard_cap_usd_month'));
  v_ratio numeric := coalesce(private.jsonb_numeric(private.plan_limit(p_user, 'ai_briefing_reserve_ratio')), 0);
  v_day_cost bigint;
  v_day_units integer;
  v_month_cost bigint;
  v_level text := 'l0';
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || v_date::text, 0));
  select coalesce(sum(u.cost_usd_micros + u.reserved_usd_micros), 0), coalesce(sum(u.units_used + u.reserved_units), 0)
    into v_day_cost, v_day_units
  from public.ai_usage_daily u where u.user_id = p_user and u.local_date = v_date;
  select coalesce(sum(u.cost_usd_micros + u.reserved_usd_micros), 0) into v_month_cost
  from public.ai_usage_daily u where u.user_id = p_user and u.local_date >= v_month and u.local_date <= v_date;

  if v_units > 0 and v_units_cap is not null and v_day_units + v_units > v_units_cap then
    return jsonb_build_object('allow', false, 'level', 'l2', 'reason', 'units_exhausted', 'reservation_id', null);
  end if;
  if v_hard_day is not null
     and v_day_cost + v_est > (case when v_briefing then v_hard_day else floor(v_hard_day * (1 - v_ratio))::bigint end) then
    return jsonb_build_object('allow', false, 'level', 'l2', 'reason', 'hard_cap_day', 'reservation_id', null);
  end if;
  if v_hard_month is not null and v_month_cost + v_est > v_hard_month then
    return jsonb_build_object('allow', false, 'level', 'l2', 'reason', 'hard_cap_month', 'reservation_id', null);
  end if;
  if v_soft is not null and v_day_cost + v_est > v_soft then
    v_level := 'l1';
  end if;

  insert into public.ai_budget_reservations (user_id, local_date, feature, est_cost_usd_micros, units, level)
  values (p_user, v_date, p_feature, v_est, v_units, v_level)
  returning id into v_id;
  insert into public.ai_usage_daily (user_id, local_date, feature, reserved_usd_micros, reserved_units)
  values (p_user, v_date, p_feature, v_est, v_units)
  on conflict (user_id, local_date, feature) do update
    set reserved_usd_micros = public.ai_usage_daily.reserved_usd_micros + excluded.reserved_usd_micros,
        reserved_units = public.ai_usage_daily.reserved_units + excluded.reserved_units;
  return jsonb_build_object('allow', true, 'level', v_level, 'reason', null, 'reservation_id', v_id);
end
$$;

-- Settle after the call (idempotent): release the hold and add actual cost, units and tokens
-- ({input, output, cache_read, cache_write}) to the reservation's local date and feature.
create function private.ai_budget_settle(
  p_reservation_id uuid, p_ai_request_id uuid, p_actual_cost_micros bigint, p_units integer,
  p_tokens jsonb default '{}'::jsonb
) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.ai_budget_reservations;
  v_units integer;
begin
  select * into r from public.ai_budget_reservations x where x.id = p_reservation_id for update;
  if not found or r.settled_at is not null then
    return;
  end if;
  v_units := case when private.ai_feature_is_briefing(r.feature) then 0 else greatest(coalesce(p_units, 0), 0) end;
  insert into public.ai_usage_daily (user_id, local_date, feature) values (r.user_id, r.local_date, r.feature)
  on conflict (user_id, local_date, feature) do nothing;
  update public.ai_usage_daily u
    set reserved_usd_micros = greatest(u.reserved_usd_micros - r.est_cost_usd_micros, 0),
        reserved_units = greatest(u.reserved_units - r.units, 0),
        requests = u.requests + 1,
        cost_usd_micros = u.cost_usd_micros + greatest(coalesce(p_actual_cost_micros, 0), 0),
        units_used = u.units_used + v_units,
        input_tokens = u.input_tokens + coalesce((p_tokens ->> 'input')::bigint, 0),
        output_tokens = u.output_tokens + coalesce((p_tokens ->> 'output')::bigint, 0),
        cache_read_tokens = u.cache_read_tokens + coalesce((p_tokens ->> 'cache_read')::bigint, 0),
        cache_write_tokens = u.cache_write_tokens + coalesce((p_tokens ->> 'cache_write')::bigint, 0)
  where u.user_id = r.user_id and u.local_date = r.local_date and u.feature = r.feature;
  update public.ai_budget_reservations x set settled_at = now(), ai_request_id = p_ai_request_id where x.id = r.id;
end
$$;

-- Releases unsettled holds past hold_until (scheduler step 14); returns the number released.
create function private.release_expired_budget_holds(p_now timestamptz default now(), p_limit integer default 1000)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.ai_budget_reservations;
  v_count integer := 0;
begin
  for r in
    select * from public.ai_budget_reservations x
    where x.settled_at is null and x.hold_until < p_now
    order by x.hold_until limit p_limit
    for update skip locked
  loop
    update public.ai_usage_daily u
      set reserved_usd_micros = greatest(u.reserved_usd_micros - r.est_cost_usd_micros, 0),
          reserved_units = greatest(u.reserved_units - r.units, 0)
    where u.user_id = r.user_id and u.local_date = r.local_date and u.feature = r.feature;
    delete from public.ai_budget_reservations x where x.id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- ═══ Other helpers (§6.1) ═════════════════════════════════════════════════════════════════════

-- Circuit breaker from the last 60 s of ai_requests: open when ≥ 5 calls and ≥ 50 % errors.
create function private.ai_breaker_state(p_provider text, p_model text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'open', count(*) >= 5 and count(*) filter (where r.status in ('error', 'timeout')) * 2 >= count(*),
      'error_rate', case when count(*) = 0 then 0
                         else round(count(*) filter (where r.status in ('error', 'timeout'))::numeric / count(*), 3) end,
      'since', min(r.created_at) filter (where r.status in ('error', 'timeout')))
    from public.ai_requests r
    where r.provider = p_provider and r.model = p_model and r.created_at > now() - interval '60 seconds'
      and r.status not in ('cached', 'budget_blocked', 'killed')
  $$;

create function private.memory_stats(p_user uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'chunks', (select count(*) from public.memory_chunks m where m.user_id = p_user),
      'embedded', (select count(*) from public.memory_chunks m where m.user_id = p_user and m.embedding is not null),
      'pending_embedding', (select count(*) from public.memory_chunks m where m.user_id = p_user and m.embedding is null),
      'by_kind', coalesce((select jsonb_object_agg(k.chunk_kind, k.n)
                           from (select m.chunk_kind, count(*) as n from public.memory_chunks m
                                 where m.user_id = p_user group by m.chunk_kind) as k), '{}'::jsonb))
  $$;

-- Admin retry/cancel eligibility per job type (admin_api.job_retry / job_cancel).
create function private.job_admin_policy(p_type public.job_type) returns jsonb
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select jsonb_build_object(
      'retryable_by_admin', true,
      'cancellable', p_type not in ('approval_execute', 'account_deletion', 'history_deletion', 'export'),
      'max_manual_retries', case when p_type in ('approval_execute', 'account_deletion', 'history_deletion') then 3 else 5 end)
  $$;

-- Learned preference upsert (§4.4): no-op while learn_from_interactions is off or when a
-- tombstone exists for the target (a deleted preference is never re-learned).
create function private.upsert_learned_preference(
  p_user uuid, p_target_type text, p_target_ref text, p_group_key text, p_effect jsonb, p_evidence_delta integer,
  p_statement text default null
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_id uuid;
  v_deleted timestamptz;
begin
  if not coalesce((select up.learn_from_interactions from public.user_preferences up where up.user_id = p_user), false) then
    return null;
  end if;
  select lp.id, lp.deleted_at into v_id, v_deleted from public.learned_preferences lp
  where lp.user_id = p_user and lp.target_type = p_target_type and lp.target_ref = p_target_ref
    and lp.group_key = p_group_key
  for update;
  if v_id is not null and v_deleted is not null then
    return null;
  end if;
  if v_id is not null then
    update public.learned_preferences lp
      set effect = coalesce(p_effect, lp.effect),
          evidence_count = greatest(lp.evidence_count + coalesce(p_evidence_delta, 0), 0),
          source_timestamp = now()
    where lp.id = v_id;
    return v_id;
  end if;
  if coalesce(p_evidence_delta, 0) <= 0 then
    return null;
  end if;
  insert into public.learned_preferences (user_id, group_key, statement, target_type, target_ref, effect,
                                          evidence_count, origin, source_type, source_id, source_timestamp, confidence)
  values (p_user, p_group_key, left(coalesce(nullif(btrim(p_statement), ''), p_target_ref), 200), p_target_type,
          p_target_ref, coalesce(p_effect, '{}'::jsonb), p_evidence_delta, 'learned', 'ai_feedback',
          left(p_group_key || ':' || p_target_type || ':' || p_target_ref, 200), now(), 0.6)
  returning id into v_id;
  return v_id;
end
$$;

-- After an account deletion the audit rows keep a target_user_id that links to nothing; this
-- appends (never edits) a pseudonymisation event carrying the subject hash and the row count, so
-- the backoffice shows "Silinmiş kullanıcı · #prefix" (BACKOFFICE_PLAN §10; API_CONTRACTS JOB-23).
create function private.pseudonymize_audit_subject(p_user uuid) returns bigint
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_rows bigint;
begin
  select count(*) into v_rows from public.audit_logs a where a.target_user_id = p_user or a.actor_id = p_user;
  return private.audit_log_append('system', null, null, 'privacy.subject_pseudonymized', 'subject',
                                  encode(private.hash_subject(p_user), 'hex'), p_user, null, 'success',
                                  jsonb_build_object('rows', v_rows), null);
end
$$;

-- ═══ Plan-limit triggers (§6.5, §7; M§44) ═════════════════════════════════════════════════════

-- trg_connected_accounts_plan_limit (max_mail_accounts / max_calendar_accounts),
-- trg_vip_people_plan_limit (vip_max) and trg_priority_rules_plan_limit (priority_rules_max).
create function private.enforce_plan_limit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_limit integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('plan_limit:' || tg_table_name || ':' || new.user_id::text));
  if tg_table_name = 'connected_accounts' then
    if new.status = 'disconnected' then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status <> 'disconnected'
       and new.capabilities_granted is not distinct from old.capabilities_granted then
      return new;
    end if;
    if 'mail_read' = any(new.capabilities_granted)
       and (tg_op = 'INSERT' or old.status = 'disconnected' or not ('mail_read' = any(old.capabilities_granted))) then
      v_limit := private.plan_limit_int(new.user_id, 'max_mail_accounts');
      select count(*) into v_count from public.connected_accounts ca
      where ca.user_id = new.user_id and ca.id <> new.id and ca.status <> 'disconnected'
        and 'mail_read' = any(ca.capabilities_granted);
      if v_limit is not null and v_count >= v_limit then
        raise exception 'PLAN_LIMIT:max_mail_accounts' using errcode = 'P0001';
      end if;
    end if;
    if 'calendar_read' = any(new.capabilities_granted)
       and (tg_op = 'INSERT' or old.status = 'disconnected' or not ('calendar_read' = any(old.capabilities_granted))) then
      v_limit := private.plan_limit_int(new.user_id, 'max_calendar_accounts');
      select count(*) into v_count from public.connected_accounts ca
      where ca.user_id = new.user_id and ca.id <> new.id and ca.status <> 'disconnected'
        and 'calendar_read' = any(ca.capabilities_granted);
      if v_limit is not null and v_count >= v_limit then
        raise exception 'PLAN_LIMIT:max_calendar_accounts' using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'vip_people' then
    v_limit := private.plan_limit_int(new.user_id, 'vip_max');
    select count(*) into v_count from public.vip_people v where v.user_id = new.user_id and v.id <> new.id;
    if v_limit is not null and v_count >= v_limit then
      raise exception 'PLAN_LIMIT:vip_max' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'priority_rules' then
    if new.deleted_at is not null or (tg_op = 'UPDATE' and old.deleted_at is null) then
      return new;
    end if;
    v_limit := private.plan_limit_int(new.user_id, 'priority_rules_max');
    select count(*) into v_count from public.priority_rules r
    where r.user_id = new.user_id and r.id <> new.id and r.deleted_at is null;
    if v_limit is not null and v_count >= v_limit then
      raise exception 'PLAN_LIMIT:priority_rules_max' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

create trigger trg_connected_accounts_plan_limit
  before insert or update of status, capabilities_granted on public.connected_accounts
  for each row execute function private.enforce_plan_limit();
create trigger trg_vip_people_plan_limit before insert on public.vip_people
  for each row execute function private.enforce_plan_limit();
create trigger trg_priority_rules_plan_limit before insert or update of deleted_at on public.priority_rules
  for each row execute function private.enforce_plan_limit();

-- trg_calendars_plan_limit (T-2.05 acceptance, M§44 "1 calendar"): the number of selected
-- calendars across all sources stays ≤ max_calendars. A user selecting one more raises
-- PLAN_LIMIT:max_calendars; a calendar inserted by sync beyond the allowance is stored unselected
-- (the user then chooses which calendar to keep), so a Free user's sync never fails.
create function private.enforce_calendar_selection_limit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_limit integer;
  v_count integer;
begin
  if not new.selected or (tg_op = 'UPDATE' and old.selected) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('plan_limit:calendars:' || new.user_id::text));
  v_limit := private.plan_limit_int(new.user_id, 'max_calendars');
  select count(*) into v_count from public.calendars c
  where c.user_id = new.user_id and c.id <> new.id and c.selected;
  if v_limit is not null and v_count >= v_limit then
    if tg_op = 'INSERT' then
      new.selected := false;
    else
      raise exception 'PLAN_LIMIT:max_calendars' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

create trigger trg_calendars_plan_limit before insert or update of selected on public.calendars
  for each row execute function private.enforce_calendar_selection_limit();

-- ═══ Status-edge triggers (§7) ════════════════════════════════════════════════════════════════

-- Commitments: open↔snoozed, open/snoozed→done/cancelled, done→open (undo); timestamps follow.
create function private.commitments_status_ts() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not ((old.status = 'open' and new.status in ('snoozed', 'done', 'cancelled'))
          or (old.status = 'snoozed' and new.status in ('open', 'done', 'cancelled'))
          or (old.status = 'done' and new.status = 'open')) then
    raise exception 'ILLEGAL_TRANSITION:%->%', old.status, new.status using errcode = '55000';
  end if;
  if new.status = 'snoozed' then
    if new.snoozed_until is null or new.snoozed_until <= now() then
      raise exception 'VALIDATION_FAILED:snoozed_until' using errcode = '22023';
    end if;
  elsif new.status = 'open' then
    new.snoozed_until := null;
    new.completed_at := null;
  elsif new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
    new.snoozed_until := null;
  elsif new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.snoozed_until := null;
  end if;
  return new;
end
$$;

create trigger trg_commitments_status_ts before update of status on public.commitments
  for each row execute function private.commitments_status_ts();

-- Insights: open→done/dismissed/snoozed; snoozed→open/done/dismissed; done/dismissed→open
-- (undo); any open state → expired (insight_refresh). done on a follow-up insight resolves the
-- thread's follow-up; done on a commitment insight completes the commitment (RPC-01).
create function private.insights_status_ts() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not ((old.status = 'open' and new.status in ('done', 'dismissed', 'snoozed', 'expired'))
          or (old.status = 'snoozed' and new.status in ('open', 'done', 'dismissed', 'expired'))
          or (old.status in ('done', 'dismissed') and new.status = 'open')) then
    raise exception 'ILLEGAL_TRANSITION:%->%', old.status, new.status using errcode = '55000';
  end if;
  if new.status = 'snoozed' then
    if new.snoozed_until is null or new.snoozed_until <= now() then
      raise exception 'VALIDATION_FAILED:snoozed_until' using errcode = '22023';
    end if;
  elsif new.status = 'open' then
    new.snoozed_until := null;
    new.done_at := null;
    new.dismissed_at := null;
  elsif new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
    new.snoozed_until := null;
  elsif new.status = 'dismissed' then
    new.dismissed_at := coalesce(new.dismissed_at, now());
    new.snoozed_until := null;
  end if;

  if new.status = 'done' then
    if new.kind = 'follow_up' and new.entity_type = 'email_thread' then
      update public.email_threads t set follow_up_state = 'resolved'
      where t.id = new.entity_id and t.user_id = new.user_id and t.follow_up_state <> 'resolved';
    elsif new.kind = 'commitment' and new.entity_type = 'commitment' then
      update public.commitments c set status = 'done'
      where c.id = new.entity_id and c.user_id = new.user_id and c.status in ('open', 'snoozed');
    end if;
  end if;
  return new;
end
$$;

create trigger trg_insights_status_ts before update of status on public.insights
  for each row execute function private.insights_status_ts();

-- ═══ Side-effect triggers (§7) ════════════════════════════════════════════════════════════════

-- trg_user_preferences_retention_changed: a retention change enqueues the recompute job and is
-- audited; AI data access and analytics opt-out changes are audited too (§4.1).
create function private.user_preferences_changed() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.retention_policy is distinct from old.retention_policy then
    perform private.enqueue_job('retention',
      'retention_recompute:' || new.user_id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      jsonb_build_object('mode', 'recompute', 'user_id', new.user_id, 'from', old.retention_policy,
                         'to', new.retention_policy),
      new.user_id, null, now(), 50, 5, null);
    perform private.audit_log_append('user', new.user_id, null, 'privacy.retention_changed', 'user_preferences',
                                     new.user_id::text, new.user_id, null, 'success',
                                     jsonb_build_object('from', old.retention_policy, 'to', new.retention_policy), null);
  end if;
  if new.ai_data_access is distinct from old.ai_data_access then
    perform private.audit_log_append('user', new.user_id, null, 'privacy.ai_access_changed', 'user_preferences',
                                     new.user_id::text, new.user_id, null, 'success',
                                     jsonb_build_object('from', old.ai_data_access, 'to', new.ai_data_access), null);
  end if;
  if new.analytics_opt_out is distinct from old.analytics_opt_out then
    perform private.audit_log_append('user', new.user_id, null, 'privacy.analytics_opt_out_changed',
                                     'user_preferences', new.user_id::text, new.user_id, null, 'success',
                                     jsonb_build_object('analytics_opt_out', new.analytics_opt_out), null);
  end if;
  return null;
end
$$;

create trigger trg_user_preferences_retention_changed
  after update of retention_policy, ai_data_access, analytics_opt_out on public.user_preferences
  for each row execute function private.user_preferences_changed();

-- trg_connected_accounts_status_notify: an `account` notification job on needs_reauth /
-- admin_consent_required (key account_reauth:{id}:{utc_date}).
create function private.connected_accounts_status_notify() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.status is distinct from old.status and new.status in ('needs_reauth', 'admin_consent_required') then
    perform private.enqueue_job('notification',
      'account_reauth:' || new.id || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('category', 'account', 'kind', 'account_reauth', 'connected_account_id', new.id,
                         'status', new.status),
      new.user_id, new.id, now(), 50, 5, null);
  end if;
  return null;
end
$$;

create trigger trg_connected_accounts_status_notify after update of status on public.connected_accounts
  for each row execute function private.connected_accounts_status_notify();

-- trg_briefings_delivered_referral: the referee's first delivered briefing re-evaluates a
-- pending referral (qualification step "receives first briefing", plan §16).
create function private.briefings_delivered_referral() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_referral uuid;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered'
     and not exists (select 1 from public.briefings b
                     where b.user_id = new.user_id and b.id <> new.id and b.status = 'delivered') then
    select r.id into v_referral from public.referrals r where r.referee_id = new.user_id and r.status = 'pending';
    if v_referral is not null then
      perform private.enqueue_job('referral_evaluate',
        'referral_evaluate:' || v_referral || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
        jsonb_build_object('referral_id', v_referral), new.user_id, null, now(), 100, 5, null);
    end if;
  end if;
  return null;
end
$$;

create trigger trg_briefings_delivered_referral after update of status on public.briefings
  for each row execute function private.briefings_delivered_referral();

-- trg_profiles_state_disabled: disabling an account disables its push tokens and cancels its
-- scheduled reminders.
create function private.profiles_state_disabled() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.state = 'disabled' and old.state is distinct from 'disabled' then
    update public.push_tokens t set status = 'disabled', disabled_reason = 'user_disabled'
    where t.user_id = new.user_id and t.status = 'active';
    update public.reminders r set status = 'cancelled', cancelled_at = now()
    where r.user_id = new.user_id and r.status = 'scheduled';
  end if;
  return null;
end
$$;

create trigger trg_profiles_state_disabled after update of state on public.profiles
  for each row execute function private.profiles_state_disabled();

-- ═══ Retention and history deletion (§6.4) ═══════════════════════════════════════════════════

-- Recomputes expires_at of every ⟨EXP⟩ table of one user after a retention change, at most
-- p_batch rows per table per call; returns the rows changed (call until 0). The retention anchor
-- of updated_at-anchored rows is preserved (private.set_updated_at honours da.retention_recompute).
create function private.recompute_expires_at(p_user uuid, p_batch integer default 5000) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_total integer := 0;
  v_n integer;
  v_batch integer := greatest(coalesce(p_batch, 5000), 1);
begin
  perform set_config('da.retention_recompute', 'on', true);

  with c as (select t.id, private.compute_expires_at(t.user_id, t.last_message_at) as e from public.email_threads t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.email_threads t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.email_threads t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.received_at) as e from public.email_messages t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.email_messages t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.email_messages t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.end_at) as e from public.calendar_events t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.calendar_events t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.calendar_events t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, case when t.status = 'open' then null
                               else private.compute_expires_at(t.user_id, coalesce(t.completed_at, t.due_at, t.created_at)) end as e
             from public.tasks t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.tasks t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.tasks t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, case when t.status in ('open', 'snoozed') then null
                               else private.compute_expires_at(t.user_id, coalesce(t.completed_at, t.cancelled_at, t.due_at, t.created_at)) end as e
             from public.commitments t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.commitments t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.commitments t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, case when t.status = 'scheduled' then null
                               else private.compute_expires_at(t.user_id, t.remind_at) end as e
             from public.reminders t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.reminders t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.reminders t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.created_at) as e from public.meeting_notes t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.meeting_notes t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.meeting_notes t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, coalesce(ev.end_at, t.created_at)) as e
             from public.meeting_preps t left join public.calendar_events ev on ev.id = t.calendar_event_id
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.meeting_preps t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.meeting_preps t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, coalesce(t.event_at, t.due_at, t.created_at)) as e
             from public.life_events t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.life_events t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.life_events t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.created_at) as e from public.captures t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.captures t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.captures t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, least(private.compute_expires_at(t.user_id, t.posted_at), t.posted_at + interval '30 days') as e
             from public.android_notification_signals t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.android_notification_signals t using (id)
             where t.expires_at is distinct from c.e limit v_batch)
  update public.android_notification_signals t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, coalesce(t.event_at, t.due_at, t.created_at)) as e
             from public.insights t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.insights t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.insights t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.scheduled_for) as e from public.briefings t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.briefings t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.briefings t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with d as (select i.id, b.expires_at as e from public.briefing_items i join public.briefings b on b.id = i.briefing_id
             where i.user_id = p_user and i.expires_at is distinct from b.expires_at limit v_batch)
  update public.briefing_items t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, case when t.status in ('draft', 'discarded')
                               then least(private.compute_expires_at(t.user_id, t.updated_at), t.updated_at + interval '30 days')
                               else private.compute_expires_at(t.user_id, t.updated_at) end as e
             from public.reply_drafts t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.reply_drafts t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.reply_drafts t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, case when t.status in ('pending', 'approved', 'executing') then null
                               else private.compute_expires_at(t.user_id, coalesce(t.executed_at, t.rejected_at, t.created_at)) end as e
             from public.approval_actions t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.approval_actions t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.approval_actions t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, coalesce(t.last_message_at, t.created_at)) as e
             from public.assistant_threads t where t.user_id = p_user),
       d as (select c.id, c.e from c join public.assistant_threads t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.assistant_threads t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.created_at) as e from public.assistant_messages t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.assistant_messages t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.assistant_messages t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.occurred_at) as e from public.memory_chunks t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.memory_chunks t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.memory_chunks t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  with c as (select t.id, private.compute_expires_at(t.user_id, t.created_at) as e from public.ai_result_cache t
             where t.user_id = p_user),
       d as (select c.id, c.e from c join public.ai_result_cache t using (id) where t.expires_at is distinct from c.e limit v_batch)
  update public.ai_result_cache t set expires_at = d.e from d where t.id = d.id;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  perform set_config('da.retention_recompute', 'off', true);
  return v_total;
end
$$;

-- Storage paths of a briefing's audio: one object per version ({user}/{briefing}/{version}.mp3).
create function private.briefing_audio_paths(p_user uuid, p_briefing uuid, p_version integer) returns text[]
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(array_agg(p_user::text || '/' || p_briefing::text || '/' || v || '.mp3' order by v), '{}')
    from generate_series(1, greatest(coalesce(p_version, 1), 1)) as g (v)
  $$;

-- Storage paths of reply-draft attachments (captures bucket).
create function private.reply_attachment_paths(p_attachments jsonb) returns text[]
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(array_agg(a ->> 'storage_path') filter (where a ->> 'storage_path' is not null), '{}')
    from jsonb_array_elements(case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end) as t (a)
  $$;

-- Retention sweep (§6.4): deletes rows past expires_at (≤ p_batch per table per call) and the
-- system TTLs; returns {deleted:{table:n}, storage_paths:{bucket:[…]}} so the worker deletes the
-- objects through the Storage API. The retention job calls it until every count is 0.
create function private.retention_cleanup(p_batch integer default 5000, p_now timestamptz default now()) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_batch integer := greatest(coalesce(p_batch, 5000), 1);
  v_deleted jsonb := '{}'::jsonb;
  v_captures text[] := '{}';
  v_audio text[] := '{}';
  v_exports text[] := '{}';
  v_paths text[];
  v_n integer;
begin
  -- ── ⟨EXP⟩ content ──
  with d as (delete from public.email_messages t where t.id in (
               select x.id from public.email_messages x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('email_messages', v_n);

  with d as (delete from public.email_threads t where t.id in (
               select x.id from public.email_threads x
               where x.expires_at < p_now
                 and not exists (select 1 from public.email_messages m where m.thread_id = x.id)
               limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('email_threads', v_n);

  with d as (delete from public.calendar_events t where t.id in (
               select x.id from public.calendar_events x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('calendar_events', v_n);

  with d as (delete from public.tasks t where t.id in (
               select x.id from public.tasks x where x.expires_at < p_now and x.status <> 'open' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('tasks', v_n);

  with d as (delete from public.commitments t where t.id in (
               select x.id from public.commitments x
               where x.expires_at < p_now and x.status not in ('open', 'snoozed') limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('commitments', v_n);

  with d as (delete from public.reminders t where t.id in (
               select x.id from public.reminders x where x.expires_at < p_now and x.status <> 'scheduled' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('reminders', v_n);

  with d as (delete from public.meeting_notes t where t.id in (
               select x.id from public.meeting_notes x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('meeting_notes', v_n);

  with d as (delete from public.meeting_preps t where t.id in (
               select x.id from public.meeting_preps x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('meeting_preps', v_n);

  with d as (delete from public.life_events t where t.id in (
               select x.id from public.life_events x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('life_events', v_n);

  with d as (delete from public.captures t where t.id in (
               select x.id from public.captures x
               where x.expires_at < p_now or (x.status = 'pending_upload' and x.created_at < p_now - interval '1 hour')
               limit v_batch)
             returning t.storage_path, t.file_deleted_at)
  select count(*), coalesce(array_agg(d.storage_path) filter (where d.storage_path is not null and d.file_deleted_at is null), '{}')
    into v_n, v_paths from d;
  v_deleted := v_deleted || jsonb_build_object('captures', v_n);
  v_captures := v_captures || v_paths;

  with d as (delete from public.android_notification_signals t where t.id in (
               select x.id from public.android_notification_signals x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('android_notification_signals', v_n);

  with d as (delete from public.insights t where t.id in (
               select x.id from public.insights x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('insights', v_n);

  with d as (delete from public.briefing_items t where t.id in (
               select x.id from public.briefing_items x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('briefing_items', v_n);

  with d as (delete from public.briefings t where t.id in (
               select x.id from public.briefings x where x.expires_at < p_now limit v_batch)
             returning t.user_id, t.id, t.version, t.audio_status, t.audio_storage_path)
  select count(*), coalesce((select array_agg(p) from d d2
                             cross join lateral unnest(private.briefing_audio_paths(d2.user_id, d2.id, d2.version)) as u (p)
                             where d2.audio_status <> 'none' or d2.audio_storage_path is not null), '{}')
    into v_n, v_paths from d;
  v_deleted := v_deleted || jsonb_build_object('briefings', v_n);
  v_audio := v_audio || v_paths;

  with d as (delete from public.reply_drafts t where t.id in (
               select x.id from public.reply_drafts x where x.expires_at < p_now limit v_batch)
             returning t.attachments)
  select count(*), coalesce((select array_agg(p) from d d2 cross join lateral unnest(private.reply_attachment_paths(d2.attachments)) as u (p)), '{}')
    into v_n, v_paths from d;
  v_deleted := v_deleted || jsonb_build_object('reply_drafts', v_n);
  v_captures := v_captures || v_paths;

  with d as (delete from public.approval_actions t where t.id in (
               select x.id from public.approval_actions x
               where x.expires_at < p_now and x.status not in ('pending', 'approved', 'executing') limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('approval_actions', v_n);

  with d as (delete from public.assistant_threads t where t.id in (
               select x.id from public.assistant_threads x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('assistant_threads', v_n);

  with d as (delete from public.assistant_messages t where t.id in (
               select x.id from public.assistant_messages x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('assistant_messages', v_n);

  with d as (delete from public.memory_chunks t where t.id in (
               select x.id from public.memory_chunks x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('memory_chunks', v_n);

  with d as (delete from public.notifications t where t.id in (
               select x.id from public.notifications x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('notifications', v_n);

  with d as (delete from public.ai_result_cache t where t.id in (
               select x.id from public.ai_result_cache x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_result_cache', v_n);

  -- Contacts (§4.3): no VIP row, no open commitment, not manual, last contact before the owner's
  -- retention cutoff (until_deleted keeps them).
  with d as (delete from public.contacts t where t.id in (
               select x.id from public.contacts x
               where x.origin <> 'manual'
                 and private.compute_expires_at(x.user_id, coalesce(x.last_contact_at, x.created_at)) < p_now
                 and not exists (select 1 from public.vip_people v where v.contact_id = x.id)
                 and not exists (select 1 from public.commitments c
                                 where c.contact_id = x.id and c.status in ('open', 'snoozed'))
               limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('contacts', v_n);

  -- ── System TTLs ──
  with d as (delete from public.oauth_states t where t.id in (
               select x.id from public.oauth_states x where x.expires_at < p_now - interval '1 day' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('oauth_states', v_n);

  with d as (delete from public.webhook_events t where t.id in (
               select x.id from public.webhook_events x where x.received_at < p_now - interval '30 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('webhook_events', v_n);

  with d as (delete from public.provider_quota_usage t where t.id in (
               select x.id from public.provider_quota_usage x where x.window_start < p_now - interval '7 days' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('provider_quota_usage', v_n);

  with d as (delete from public.push_tickets t where t.id in (
               select x.id from public.push_tickets x where x.sent_at < p_now - interval '7 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('push_tickets', v_n);

  with d as (delete from public.rate_limits t where (t.key, t.window_start) in (
               select x.key, x.window_start from public.rate_limits x where x.window_start < p_now - interval '1 day' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('rate_limits', v_n);

  with d as (delete from public.system_health_checks t where t.id in (
               select x.id from public.system_health_checks x where x.checked_at < p_now - interval '30 days' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('system_health_checks', v_n);

  with d as (delete from public.ai_requests t where t.id in (
               select x.id from public.ai_requests x where x.created_at < p_now - interval '180 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_requests', v_n);

  with d as (delete from public.ai_usage_daily t where (t.user_id, t.local_date, t.feature) in (
               select x.user_id, x.local_date, x.feature from public.ai_usage_daily x
               where x.local_date < (p_now - interval '400 days')::date limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_usage_daily', v_n);

  with d as (delete from public.analytics_events t where t.id in (
               select x.id from public.analytics_events x where x.occurred_at < p_now - interval '400 days' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('analytics_events', v_n);

  with d as (delete from public.jobs t where t.id in (
               select x.id from public.jobs x
               where (x.status = 'completed' and x.updated_at < p_now - interval '14 days')
                  or (x.status in ('failed', 'dead_letter') and x.updated_at < p_now - interval '90 days')
               limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('jobs', v_n);

  with d as (delete from public.app_installations t where t.id in (
               select x.id from public.app_installations x where x.last_seen_at < p_now - interval '180 days' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('app_installations', v_n);

  with d as (delete from public.push_tokens t where t.id in (
               select x.id from public.push_tokens x
               where x.status = 'disabled' and x.updated_at < p_now - interval '30 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('push_tokens', v_n);

  with d as (delete from public.priority_rules t where t.id in (
               select x.id from public.priority_rules x
               where x.deleted_at is not null and x.deleted_at < p_now - interval '30 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('priority_rules', v_n);

  with d as (delete from public.feature_flag_overrides t where t.id in (
               select x.id from public.feature_flag_overrides x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('feature_flag_overrides', v_n);

  with d as (update public.data_export_requests t set status = 'expired'
             where t.id in (select x.id from public.data_export_requests x
                            where x.status = 'ready' and x.expires_at < p_now limit v_batch)
             returning t.storage_path)
  select count(*), coalesce(array_agg(d.storage_path) filter (where d.storage_path is not null), '{}') into v_n, v_paths from d;
  v_deleted := v_deleted || jsonb_build_object('data_export_requests_expired', v_n);
  v_exports := v_exports || v_paths;

  with d as (delete from public.data_export_requests t where t.id in (
               select x.id from public.data_export_requests x
               where x.created_at < p_now - interval '90 days' and x.status not in ('requested', 'processing')
               limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('data_export_requests', v_n);

  -- Referrals (§4.6): terminal for 365 days, or both users gone; rows that carry reward credits
  -- stay (referral_credits restricts), their credits live as long as the beneficiary's account.
  with d as (delete from public.referrals t where t.id in (
               select x.id from public.referrals x
               where ((x.status in ('rewarded', 'rejected') and x.updated_at < p_now - interval '365 days')
                      or (x.referrer_id is null and x.referee_id is null))
                 and not exists (select 1 from public.referral_credits c where c.referral_id = x.id)
               limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('referrals', v_n);

  with d as (delete from public.ai_feedback t where t.id in (
               select x.id from public.ai_feedback x where x.created_at < p_now - interval '365 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_feedback', v_n);

  with d as (delete from public.admin_sessions t where t.id in (
               select x.id from public.admin_sessions x where x.created_at < p_now - interval '180 days' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('admin_sessions', v_n);

  with d as (delete from public.api_idempotency_keys t where (t.user_id, t.key) in (
               select x.user_id, x.key from public.api_idempotency_keys x where x.expires_at < p_now limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('api_idempotency_keys', v_n);

  with d as (delete from public.ai_budget_reservations t where t.id in (
               select x.id from public.ai_budget_reservations x
               where x.settled_at is not null and x.settled_at < p_now - interval '1 day' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_budget_reservations', v_n);

  with d as (delete from public.ai_batches t where t.id in (
               select x.id from public.ai_batches x where x.purged_at < p_now - interval '90 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_batches', v_n);

  with d as (delete from public.privacy_tombstones t where t.id in (
               select x.id from public.privacy_tombstones x where x.expires_at < p_now limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('privacy_tombstones', v_n);

  with d as (delete from public.admin_mfa_recovery_codes t where t.id in (
               select x.id from public.admin_mfa_recovery_codes x
               where coalesce(x.used_at, x.replaced_at) < p_now - interval '90 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('admin_mfa_recovery_codes', v_n);

  with d as (delete from public.metrics_daily t where (t.day, t.metric_key, t.dim1, t.dim2, t.dim3) in (
               select x.day, x.metric_key, x.dim1, x.dim2, x.dim3 from public.metrics_daily x
               where x.day < (p_now - interval '25 months')::date limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('metrics_daily', v_n);

  with d as (delete from public.ai_metrics_daily t where t.id in (
               select x.id from public.ai_metrics_daily x where x.day < (p_now - interval '25 months')::date limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_metrics_daily', v_n);

  with d as (delete from public.web_analytics_daily t where (t.day, t.event, t.dims_hash) in (
               select x.day, x.event, x.dims_hash from public.web_analytics_daily x
               where x.day < (p_now - interval '25 months')::date limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('web_analytics_daily', v_n);

  -- Documented per-table retentions (§4.6–§4.9).
  with d as (delete from public.billing_events t where t.id in (
               select x.id from public.billing_events x where x.received_at < p_now - interval '3 years' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('billing_events', v_n);

  with d as (delete from public.user_feedback t where t.id in (
               select x.id from public.user_feedback x where x.created_at < p_now - interval '2 years' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('user_feedback', v_n);

  with d as (delete from public.support_tickets t where t.id in (
               select x.id from public.support_tickets x
               where x.status = 'closed' and coalesce(x.closed_at, x.updated_at) < p_now - interval '2 years' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('support_tickets', v_n);

  with d as (delete from public.support_access_grants t where t.id in (
               select x.id from public.support_access_grants x where x.created_at < p_now - interval '2 years' limit v_batch)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('support_access_grants', v_n);

  with d as (delete from public.data_deletion_requests t where t.id in (
               select x.id from public.data_deletion_requests x
               where x.status in ('completed', 'failed', 'cancelled') and x.updated_at < p_now - interval '3 years'
               limit v_batch) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('data_deletion_requests', v_n);

  return jsonb_build_object(
    'deleted', v_deleted,
    'storage_paths', jsonb_build_object('captures', to_jsonb(v_captures), 'briefing-audio', to_jsonb(v_audio),
                                        'exports', to_jsonb(v_exports)));
end
$$;

-- History deletion (§6.4, R-16; PRIMARY 7.4): removes the analysis history of one user and keeps
-- connections, credentials, settings, VIP, priority rules, future events, provider tasks,
-- subscriptions and referrals. In-flight approvals (pending, approved, executing) and the drafts
-- they reference stay until they finish.
create function private.purge_user_history(p_user uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_deleted jsonb := '{}'::jsonb;
  v_captures text[];
  v_drafts text[];
  v_audio text[];
  v_n integer;
begin
  with d as (delete from public.insights t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('insights', v_n);

  with d as (delete from public.briefings t where t.user_id = p_user
             returning t.user_id, t.id, t.version, t.audio_status, t.audio_storage_path)
  select count(*), coalesce((select array_agg(p) from d d2
                             cross join lateral unnest(private.briefing_audio_paths(d2.user_id, d2.id, d2.version)) as u (p)
                             where d2.audio_status <> 'none' or d2.audio_storage_path is not null), '{}')
    into v_n, v_audio from d;
  v_deleted := v_deleted || jsonb_build_object('briefings', v_n);

  with d as (delete from public.memory_chunks t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('memory_chunks', v_n);

  with d as (delete from public.assistant_threads t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('assistant_threads', v_n);

  with d as (delete from public.learned_preferences t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('learned_preferences', v_n);

  with d as (delete from public.ai_feedback t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_feedback', v_n);

  with d as (delete from public.reply_drafts t
             where t.user_id = p_user
               and not exists (select 1 from public.approval_actions a
                               where a.id = t.approval_action_id and a.status in ('pending', 'approved', 'executing'))
             returning t.attachments)
  select count(*), coalesce((select array_agg(p) from d d2 cross join lateral unnest(private.reply_attachment_paths(d2.attachments)) as u (p)), '{}')
    into v_n, v_drafts from d;
  v_deleted := v_deleted || jsonb_build_object('reply_drafts', v_n);

  with d as (delete from public.email_messages t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('email_messages', v_n);

  with d as (delete from public.email_threads t
             where t.user_id = p_user
               and not exists (select 1 from public.reply_drafts r where r.thread_id = t.id)
             returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('email_threads', v_n);

  with d as (delete from public.meeting_notes t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('meeting_notes', v_n);

  with d as (delete from public.meeting_preps t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('meeting_preps', v_n);

  with d as (delete from public.calendar_events t where t.user_id = p_user and t.end_at < now() returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('calendar_events', v_n);

  with d as (delete from public.life_events t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('life_events', v_n);

  with d as (delete from public.captures t where t.user_id = p_user returning t.storage_path, t.file_deleted_at)
  select count(*), coalesce(array_agg(d.storage_path) filter (where d.storage_path is not null and d.file_deleted_at is null), '{}')
    into v_n, v_captures from d;
  v_deleted := v_deleted || jsonb_build_object('captures', v_n);

  with d as (delete from public.commitments t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('commitments', v_n);

  with d as (delete from public.reminders t where t.user_id = p_user and t.status <> 'scheduled' returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('reminders', v_n);

  with d as (delete from public.approval_actions t
             where t.user_id = p_user and t.status in ('rejected', 'executed', 'failed', 'expired') returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('approval_actions', v_n);

  with d as (delete from public.notifications t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('notifications', v_n);

  with d as (delete from public.android_notification_signals t where t.user_id = p_user returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('android_notification_signals', v_n);

  with d as (delete from public.ai_result_cache t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('ai_result_cache', v_n);

  update public.sync_states s set backfill_until = now() where s.user_id = p_user;

  return jsonb_build_object(
    'deleted', v_deleted,
    'storage_paths', jsonb_build_object('captures', to_jsonb(v_captures || v_drafts), 'briefing-audio', to_jsonb(v_audio)));
end
$$;

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on all functions in schema private from public;

-- Check-constraint helpers reachable from generated columns and constraints.
grant execute on function private.compare_semver(text, text), private.ai_feature_is_briefing(public.ai_feature)
  to authenticated, service_role;

-- Custom access token hook: only GoTrue's role may call it (ADR-06).
revoke execute on function private.custom_access_token_hook(jsonb) from anon, authenticated, service_role;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Service-role (Edge Functions with the secret key) may call the worker-side helpers directly.
grant execute on function
  private.mask_name(text),
  private.mask_push_token(text),
  private.effective_entitlement_at(uuid, timestamptz, boolean),
  private.is_pro(uuid),
  private.plan_of(uuid),
  private.plan_limit(uuid, text),
  private.plan_limit_int(uuid, text),
  private.evaluate_flag(text, uuid, public.platform, text),
  private.evaluate_flags(uuid, public.platform, text),
  private.account_can(uuid, public.capability),
  private.consume_provider_quota(text, uuid, integer, integer, integer, public.provider),
  private.try_lock_credential_refresh(uuid, text, integer),
  private.user_apple_sub(uuid),
  private.enqueue_job(public.job_type, text, jsonb, uuid, uuid, timestamptz, integer, integer, uuid),
  private.reap_expired_leases(timestamptz),
  private.poke_worker(text),
  private.transition_approval(uuid, public.approval_status, text, uuid, text, text, jsonb, text, text, public.approval_via, bytea),
  private.edit_approval_payload(uuid, uuid, jsonb, bytea, text, jsonb),
  private.fail_stale_device_approvals(timestamptz),
  private.grant_entitlement(uuid, public.grant_source, smallint, text, uuid, text, uuid),
  private.reward_referral(uuid),
  private.ai_budget_reserve(uuid, public.ai_feature, bigint, integer),
  private.ai_budget_settle(uuid, uuid, bigint, integer, jsonb),
  private.ai_breaker_state(text, text),
  private.memory_stats(uuid),
  private.job_admin_policy(public.job_type),
  private.upsert_learned_preference(uuid, text, text, text, jsonb, integer, text),
  private.pseudonymize_audit_subject(uuid),
  private.recompute_expires_at(uuid, integer),
  private.retention_cleanup(integer, timestamptz),
  private.purge_user_history(uuid)
  to service_role;
