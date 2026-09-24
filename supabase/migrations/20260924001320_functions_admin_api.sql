-- Migration 0013c · admin_api functions (called only by the admin-api Edge Function)
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §6.10 (function names and permissions), §6.8 (guard);
-- docs/API_CONTRACTS.md §12 (ADM-00…ADM-21 routes and row shapes); docs/BACKOFFICE_PLAN.md §2.6,
-- §3, §4 (permission strings, R-20), §7 (metric definitions), §8, §9, §16 #41; IMPLEMENTATION_PLAN T-2.17.
--
-- Every function is SECURITY DEFINER with search_path = '' and starts with the admin guard
-- (private.require_admin / require_admin_any / require_admin_all, or private.admin_guard for the
-- context functions): gateway header + aal2 + dedicated active admin + permission + live session.
-- The permission of every function is listed in private.admin_function_permissions (pgTAP 120 is
-- table-driven from it). PII leaves the database masked (mask_email / mask_name / mask_push_token);
-- content, tokens, ciphertext, secrets and file paths are never returned. Every mutation requires a
-- reason (≥ 10 characters) and appends its audit row in the same transaction. Lists take
-- (p_page, p_page_size ≤ 100, p_sort, p_filter jsonb) and return {rows, total, page, page_size};
-- p_sort is a whitelisted column name, prefixed with '-' for descending order.
-- Audit action names follow the DATABASE_AND_RLS_PLAN §4 per-table "Audit" lines.
-- Functions without a JWT (the BFF-only sign-in routes and health_record) are service_role only.

-- Each migration runs in one transaction; never wait long on a lock held by live traffic.
set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Prompt guard: drafts can be discarded (BACKOFFICE_PLAN §6.11 "archive for drafts") ═══════
create or replace function private.guard_prompt_versions() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if old.status <> 'draft' and (
       new.prompt_key is distinct from old.prompt_key
       or new.version is distinct from old.version
       or new.system_prompt is distinct from old.system_prompt
       or new.user_template is distinct from old.user_template
       or new.output_schema_ref is distinct from old.output_schema_ref
       or new.schema_hash is distinct from old.schema_hash
       or new.model_role is distinct from old.model_role
       or new.model_constraints is distinct from old.model_constraints) then
    raise exception 'PROMPT_VERSION_IMMUTABLE' using errcode = '55000';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('active', 'archived'))
            or (old.status = 'active' and new.status = 'archived')
            or (old.status = 'archived' and new.status = 'active')) then
      raise exception 'ILLEGAL_TRANSITION:%->%', old.status, new.status using errcode = '55000';
    end if;
    if new.status = 'active' and not new.eval_passed then
      raise exception 'EVAL_REQUIRED' using errcode = '55000';
    end if;
  end if;
  return new;
end
$$;

-- ═══ Shared admin helpers (private) ═══════════════════════════════════════════════════════════

-- All of p_permissions (AND), e.g. users.read + integrations.read for a user tab.
create function private.require_admin_all(p_permissions text[]) returns public.admin_users
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(array[p_permissions[1]]);
  v_perm text;
begin
  foreach v_perm in array p_permissions loop
    if not private.admin_has_permission(v_admin.role, array[v_perm]) then
      raise exception 'ADMIN_FORBIDDEN' using errcode = '42501', detail = v_perm;
    end if;
  end loop;
  return v_admin;
end
$$;

create function private.admin_can(p_admin public.admin_users, p_permission text) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.admin_has_permission(p_admin.role, array[p_permission]) $$;

-- Mutations require a reason of 10–1000 characters (API_CONTRACTS §12.1).
create function private.admin_require_reason(p_reason text) returns text
  language plpgsql immutable
  set search_path = ''
  as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(p_reason) > 1000 then
    raise exception 'VALIDATION_FAILED:reason' using errcode = '22023';
  end if;
  return btrim(p_reason);
end
$$;

-- Audit row for an admin action (actor = the admin, role snapshot).
create function private.admin_audit(
  p_admin public.admin_users, p_action text, p_target_type text, p_target_id text, p_target_user uuid,
  p_reason text, p_details jsonb default '{}'::jsonb, p_result text default 'success'
) returns bigint
  language sql
  security definer
  set search_path = ''
  as $$
    select private.audit_log_append('admin', p_admin.user_id, p_admin.role::text, p_action, p_target_type, p_target_id,
                                    p_target_user, p_reason, p_result, coalesce(p_details, '{}'::jsonb), null)
  $$;

create function private.admin_page_size(p_page_size integer) returns integer
  language sql immutable parallel safe
  set search_path = ''
  as $$ select least(greatest(coalesce(p_page_size, 25), 1), 100) $$;

create function private.admin_offset(p_page integer, p_page_size integer) returns integer
  language sql immutable parallel safe
  set search_path = ''
  as $$ select (greatest(coalesce(p_page, 1), 1) - 1) * private.admin_page_size(p_page_size) $$;

-- ORDER BY expression for a whitelisted sort key ('-' prefix = descending); p_allowed maps the
-- public key to a SQL expression. Anything else falls back to p_default.
create function private.admin_order(p_sort text, p_allowed jsonb, p_default text) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p_sort is null or not (p_allowed ? ltrim(p_sort, '-')) then p_default
      else (p_allowed ->> ltrim(p_sort, '-')) || case when p_sort like '-%' then ' desc nulls last' else ' asc nulls last' end
    end
  $$;

-- Metric windows (BACKOFFICE_PLAN §7.1) in the reporting time zone.
create function private.metric_window(p_range text, p_now timestamptz default now())
  returns table (start_at timestamptz, end_at timestamptz, prev_start_at timestamptz, bucket text)
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  v_tz text := coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'metrics.reporting_timezone'),
                        'Europe/Istanbul');
  v_today date := (p_now at time zone coalesce((select s.value #>> '{}' from public.app_settings s
                                                where s.key = 'metrics.reporting_timezone'), 'Europe/Istanbul'))::date;
  v_start timestamptz;
begin
  case p_range
    when '24h' then
      return query select p_now - interval '24 hours', p_now, p_now - interval '48 hours', 'hour'::text;
    when '7d' then
      v_start := (v_today - 6)::timestamp at time zone v_tz;
      return query select v_start, p_now, v_start - (p_now - v_start), 'day'::text;
    when '30d' then
      v_start := (v_today - 29)::timestamp at time zone v_tz;
      return query select v_start, p_now, v_start - (p_now - v_start), 'day'::text;
    when '90d' then
      v_start := (v_today - 89)::timestamp at time zone v_tz;
      return query select v_start, p_now, v_start - (p_now - v_start), 'week'::text;
    else
      raise exception 'VALIDATION_FAILED:range' using errcode = '22023';
  end case;
end
$$;

-- Job payloads come back redacted to their id fields (API_CONTRACTS §12.1).
create function private.redact_payload(p_payload jsonb) returns jsonb
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end) as e (key, value)
    where e.key ~ '(^id$|_id$|^kind$|^mode$|^scope$|^reason$|^trigger$|^category$|^resource$)'
      and jsonb_typeof(e.value) in ('string', 'number', 'boolean', 'null')
  $$;

create function private.admin_user_label(p_user uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select case when u.id is null then jsonb_build_object('id', p_user, 'deleted', true,
                                                          'subject_hash_prefix', left(encode(private.hash_subject(p_user), 'hex'), 12))
                else jsonb_build_object('id', u.id, 'email_masked', private.mask_email(u.email::extensions.citext),
                                        'display_name_masked', private.mask_name(p.display_name)) end
    from (select p_user as id) as q
    left join auth.users u on u.id = q.id
    left join public.profiles p on p.user_id = q.id
  $$;

-- ═══ Function → permission map (pgTAP 120; BACKOFFICE_PLAN §4) ════════════════════════════════
-- guard: 'session' (aal2 + live session), 'no_session' (aal2 admin, session may be absent or
-- expired), 'aal1' (admin identity at aal1), 'gateway' (gateway header only; answers for any
-- identity during sign-in), 'service_role' (no JWT; secret key only).
-- permissions: any of them suffices; NULL = any active admin. all_permissions: every one needed.
create view private.admin_function_permissions as
  select v.function_name, v.permissions, v.all_permissions, v.guard
  from (values
    ('admin_me', null::text[], false, 'session'),
    ('admin_session_start', null, false, 'no_session'),
    ('admin_session_end', null, false, 'session'),
    ('admin_session_step_up', null, false, 'session'),
    ('session_expire', null, false, 'no_session'),
    ('sessions_list_own', null, false, 'session'),
    ('admin_preferences_get', null, false, 'session'),
    ('admin_preferences_set', null, false, 'session'),
    ('authorize', null, false, 'session'),
    ('audit_write', null, false, 'session'),
    ('audit_denied', null, false, 'session'),
    ('recovery_codes_store', null, false, 'session'),
    ('auth_status', null, false, 'gateway'),
    ('recovery_code_consume', null, false, 'aal1'),
    ('login_preflight', null, false, 'service_role'),
    ('login_attempt_record', null, false, 'service_role'),
    ('invite_redeem', null, false, 'service_role'),
    ('health_record', null, false, 'service_role'),
    ('dashboard_metrics', array['dashboard.read'], false, 'session'),
    ('dashboard_series', array['dashboard.read'], false, 'session'),
    ('metrics_ops', array['metrics.ops.read'], false, 'session'),
    ('metrics_product', array['metrics.product.read'], false, 'session'),
    ('security_events', array['admins.manage'], false, 'session'),
    ('users_list', array['users.read'], false, 'session'),
    ('user_lookup_email', array['users.read'], false, 'session'),
    ('user_overview', array['users.read'], false, 'session'),
    ('user_integrations', array['users.read', 'integrations.read'], true, 'session'),
    ('user_briefings', array['users.read', 'briefings.read'], true, 'session'),
    ('user_usage', array['users.read'], false, 'session'),
    ('user_subscription', array['users.read', 'subscriptions.read'], true, 'session'),
    ('user_referrals', array['users.read', 'referrals.read'], true, 'session'),
    ('user_support', array['users.read', 'support.read'], true, 'session'),
    ('user_audit', array['users.read', 'audit.read'], true, 'session'),
    ('user_devices', array['users.read', 'notifications.read'], true, 'session'),
    ('user_reveal_email', array['users.pii.reveal'], false, 'session'),
    ('user_force_sync', array['users.force_sync'], false, 'session'),
    ('user_disable', array['users.disable'], false, 'session'),
    ('user_restore', array['users.disable'], false, 'session'),
    ('user_mark_internal', array['users.mark_internal'], false, 'session'),
    ('tickets_list', array['support.read'], false, 'session'),
    ('ticket_detail', array['support.read'], false, 'session'),
    ('ticket_update', array['support.write'], false, 'session'),
    ('ticket_add_note', array['support.write'], false, 'session'),
    ('support_access_grant', array['support.access'], false, 'session'),
    ('support_access_revoke', array['support.access'], false, 'session'),
    ('support_access_authorize', array['support.access'], false, 'session'),
    ('integrations_overview', array['integrations.read'], false, 'session'),
    ('integrations_summary', array['integrations.read', 'metrics.ops.read'], false, 'session'),
    ('integration_detail', array['integrations.read'], false, 'session'),
    ('integration_disconnect', array['integrations.disconnect'], false, 'session'),
    ('integration_renew_watch', array['integrations.renew_watch'], false, 'session'),
    ('jobs_list', array['jobs.read'], false, 'session'),
    ('jobs_summary', array['jobs.read'], false, 'session'),
    ('job_detail', array['jobs.read'], false, 'session'),
    ('correlation_trace', array['jobs.read'], false, 'session'),
    ('job_retry', array['jobs.retry'], false, 'session'),
    ('job_retry_bulk', array['jobs.retry'], false, 'session'),
    ('job_cancel', array['jobs.cancel'], false, 'session'),
    ('briefings_metrics', array['briefings.read'], false, 'session'),
    ('briefings_list', array['briefings.read'], false, 'session'),
    ('briefing_regenerate', array['briefings.regenerate'], false, 'session'),
    ('notifications_metrics', array['notifications.read'], false, 'session'),
    ('notifications_user_debug', array['notifications.read'], false, 'session'),
    ('notification_send_test', array['push.test'], false, 'session'),
    ('ai_metrics', array['metrics.ai.read', 'ai.read'], false, 'session'),
    ('ai_cost_series', array['metrics.ai.read', 'ai.read'], false, 'session'),
    ('ai_requests_list', array['ai.read'], false, 'session'),
    ('ai_model_config_list', array['ai.read'], false, 'session'),
    ('ai_model_prices_list', array['ai.read'], false, 'session'),
    ('ai_model_config_update', array['ai.models.write'], false, 'session'),
    ('plan_routing_profile_set', array['ai.models.write'], false, 'session'),
    ('ai_model_prices_upsert', array['ai.models.write'], false, 'session'),
    ('ai_calibration_activate', array['ai.models.write'], false, 'session'),
    ('prompts_list', array['prompts.read'], false, 'session'),
    ('prompt_versions_list', array['prompts.read'], false, 'session'),
    ('prompt_version_get', array['prompts.read'], false, 'session'),
    ('prompt_diff', array['prompts.read'], false, 'session'),
    ('prompt_create_draft', array['prompts.write'], false, 'session'),
    ('prompt_update_draft', array['prompts.write'], false, 'session'),
    ('prompt_activate', array['prompts.activate'], false, 'session'),
    ('prompt_rollback', array['prompts.activate'], false, 'session'),
    ('prompt_archive', array['prompts.activate'], false, 'session'),
    ('ai_feedback_aggregate', array['ai_feedback.read'], false, 'session'),
    ('ai_feedback_list', array['ai_feedback.read'], false, 'session'),
    ('ai_feedback_reveal_comment', array['ai_feedback.reveal'], false, 'session'),
    ('subscriptions_metrics', array['subscriptions.read', 'metrics.revenue.read'], false, 'session'),
    ('subscriptions_list', array['subscriptions.read'], false, 'session'),
    ('billing_events_list', array['billing_events.read'], false, 'session'),
    ('billing_event_get', array['billing_events.read'], false, 'session'),
    ('trial_stream', array['subscriptions.read'], false, 'session'),
    ('entitlement_grants_list', array['subscriptions.read'], false, 'session'),
    ('subscription_resync', array['subscriptions.resync'], false, 'session'),
    ('entitlement_grant', array['entitlements.grant', 'entitlements.grant_limited'], false, 'session'),
    ('entitlement_revoke', array['entitlements.revoke'], false, 'session'),
    ('referrals_metrics', array['referrals.read'], false, 'session'),
    ('referrals_list', array['referrals.read'], false, 'session'),
    ('referral_review', array['referrals.review'], false, 'session'),
    ('feedback_list', array['feedback.read'], false, 'session'),
    ('feedback_summary', array['feedback.read'], false, 'session'),
    ('feedback_update', array['feedback.write'], false, 'session'),
    ('feedback_reveal', array['users.pii.reveal'], false, 'session'),
    ('flags_list', array['flags.read'], false, 'session'),
    ('flag_get', array['flags.read'], false, 'session'),
    ('flag_evaluate_preview', array['flags.read'], false, 'session'),
    ('flag_upsert', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_kill', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_archive', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_override_set', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_override_delete', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('announcements_list', array['announcements.read'], false, 'session'),
    ('announcement_get', array['announcements.read'], false, 'session'),
    ('announcement_audience_estimate', array['announcements.read'], false, 'session'),
    ('announcement_upsert', array['announcements.write'], false, 'session'),
    ('announcement_publish', array['announcements.write'], false, 'session'),
    ('announcement_cancel', array['announcements.write'], false, 'session'),
    ('data_requests_list', array['data_requests.read'], false, 'session'),
    ('data_request_get', array['data_requests.read'], false, 'session'),
    ('data_request_retry', array['data_requests.manage'], false, 'session'),
    ('data_request_cancel', array['data_requests.manage'], false, 'session'),
    ('export_regenerate', array['data_requests.manage'], false, 'session'),
    ('audit_list', array['audit.read'], false, 'session'),
    ('audit_get', array['audit.read'], false, 'session'),
    ('audit_verify', array['audit.read'], false, 'session'),
    ('health_latest', array['health.read'], false, 'session'),
    ('health_history', array['health.read'], false, 'session'),
    ('app_versions_breakdown', array['health.read'], false, 'session'),
    ('cron_status', array['health.read'], false, 'session'),
    ('admins_list', array['admins.read'], false, 'session'),
    ('admin_invite_record', array['admins.manage'], false, 'session'),
    ('admin_invite_rotate', array['admins.manage'], false, 'session'),
    ('admin_update_role', array['admins.manage'], false, 'session'),
    ('admin_disable', array['admins.manage'], false, 'session'),
    ('admin_enable', array['admins.manage'], false, 'session'),
    ('admin_sessions_revoke_all', array['admins.manage'], false, 'session'),
    ('admin_mfa_reset', array['admins.manage'], false, 'session'),
    ('admin_unlock', array['admins.manage'], false, 'session'),
    ('settings_get', null, false, 'session'),
    ('settings_update', array['settings.system.write'], false, 'session'),
    ('plan_limits_list', null, false, 'session'),
    ('plan_limits_update', array['settings.system.write'], false, 'session'),
    ('command_search', array['search.global'], false, 'session')
  ) as v (function_name, permissions, all_permissions, guard);
comment on view private.admin_function_permissions is
  'Static map of every admin_api function to its BACKOFFICE_PLAN §4.1 permission(s) and guard; pgTAP 120 is table-driven from it.';

-- ═══ ADM-00 · session, preferences and context ═══════════════════════════════════════════════

-- {admin, permissions[], session, preferences}; p_activity = false (background polling) never
-- extends the idle window. Read-class rate limit bo_r:{admin} 600/min.
create function admin_api.admin_me(p_activity boolean default true) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null, true, coalesce(p_activity, true));
  v_session public.admin_sessions;
begin
  if not public.rate_limit_hit('bo_r:' || v_admin.user_id, 600, 60) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  select * into v_session from public.admin_sessions s where s.auth_session_id = (auth.jwt() ->> 'session_id')::uuid;
  return jsonb_build_object(
    'admin', jsonb_build_object(
      'id', v_admin.user_id, 'email', v_admin.email, 'display_name', v_admin.display_name, 'role', v_admin.role,
      'status', v_admin.status,
      'mfa_factor_count', (select count(*) from auth.mfa_factors f where f.user_id = v_admin.user_id and f.status = 'verified'),
      'mfa_enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = v_admin.user_id and f.status = 'verified'),
      'recovery_codes_remaining', (select count(*) from public.admin_mfa_recovery_codes c
                                   where c.admin_user_id = v_admin.user_id and c.used_at is null and c.replaced_at is null)),
    'permissions', coalesce((select jsonb_agg(p.permission order by p.permission) from private.admin_role_permissions p
                             where p.role = v_admin.role), '[]'::jsonb),
    'session', jsonb_build_object('id', v_session.id, 'idle_expires_at', v_session.idle_expires_at,
                                  'absolute_expires_at', v_session.absolute_expires_at,
                                  'step_up_valid_until', case when v_session.step_up_at > now() - interval '10 minutes'
                                                              then v_session.step_up_at + interval '10 minutes' end),
    'preferences', coalesce((select to_jsonb(ap) - 'admin_user_id' from public.admin_preferences ap
                             where ap.admin_user_id = v_admin.user_id), '{}'::jsonb));
end
$$;

-- Creates (or refreshes) the admin_sessions row for the JWT session_id; the first start activates
-- an invited admin whose invite was redeemed. Audited as admin.login.
create function admin_api.admin_session_start(p_ip_hash bytea default null, p_user_agent text default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_claims jsonb := auth.jwt();
  v_uid uuid := auth.uid();
  v_admin public.admin_users;
  v_session public.admin_sessions;
  v_sid uuid;
  v_idle interval := make_interval(mins => private.app_setting_int('session.idle_minutes', 30));
  v_abs interval := make_interval(hours => private.app_setting_int('session.absolute_hours', 12));
begin
  perform private.assert_admin_gateway();
  if (v_claims ->> 'aal') is distinct from 'aal2' then
    raise exception 'ADMIN_AAL2_REQUIRED' using errcode = '42501';
  end if;
  if v_uid is null or (v_claims -> 'app_metadata' ->> 'da_kind') is distinct from 'admin' then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select * into v_admin from public.admin_users a
  where a.user_id = v_uid and (a.status = 'active' or (a.status = 'invited' and a.invite_redeemed_at is not null))
  for update;
  if not found then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if v_admin.locked_until is not null and v_admin.locked_until > now() then
    raise exception 'ADMIN_LOCKED' using errcode = '42501';
  end if;
  begin
    v_sid := (v_claims ->> 'session_id')::uuid;
  exception when others then
    v_sid := null;
  end;
  if v_sid is null then
    raise exception 'ADMIN_SESSION_EXPIRED' using errcode = '42501';
  end if;
  if v_admin.status = 'invited' then
    update public.admin_users a set status = 'active', activated_at = now() where a.user_id = v_uid returning * into v_admin;
    perform private.admin_audit(v_admin, 'admin.invite_accepted', 'admin_user', v_uid::text, null, 'first aal2 session start');
  end if;
  update public.admin_users a set last_login_at = now() where a.user_id = v_uid;

  select * into v_session from public.admin_sessions s where s.auth_session_id = v_sid;
  if found then
    if v_session.admin_user_id <> v_uid or v_session.ended_at is not null or v_session.absolute_expires_at <= now() then
      raise exception 'ADMIN_SESSION_EXPIRED' using errcode = '42501';
    end if;
    update public.admin_sessions s set last_activity_at = now(), idle_expires_at = now() + v_idle
    where s.id = v_session.id returning * into v_session;
  else
    insert into public.admin_sessions (admin_user_id, auth_session_id, aal, idle_expires_at, absolute_expires_at, ip_hash,
                                       user_agent)
    values (v_uid, v_sid, 'aal2', now() + v_idle, now() + v_abs, p_ip_hash, left(p_user_agent, 300))
    returning * into v_session;
    perform private.admin_audit(v_admin, 'admin.login', 'admin_session', v_session.id::text, null, 'aal2 session started');
  end if;
  insert into public.admin_preferences (admin_user_id) values (v_uid) on conflict (admin_user_id) do nothing;
  return jsonb_build_object(
    'admin', jsonb_build_object('id', v_admin.user_id, 'email', v_admin.email, 'role', v_admin.role,
                                'mfa_enrolled', exists (select 1 from auth.mfa_factors f
                                                        where f.user_id = v_uid and f.status = 'verified')),
    'permissions', coalesce((select jsonb_agg(p.permission order by p.permission) from private.admin_role_permissions p
                             where p.role = v_admin.role), '[]'::jsonb),
    'session_id', v_session.id, 'idle_expires_at', v_session.idle_expires_at,
    'absolute_expires_at', v_session.absolute_expires_at);
end
$$;

-- Ends the current session (logout), every session of the caller (all) or every other one (others).
create function admin_api.admin_session_end(p_scope text default 'current', p_reason text default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
  v_sid uuid := (auth.jwt() ->> 'session_id')::uuid;
  v_n integer;
begin
  if coalesce(p_scope, 'current') not in ('current', 'all', 'others') then
    raise exception 'VALIDATION_FAILED:scope' using errcode = '22023';
  end if;
  update public.admin_sessions s
    set ended_at = now(),
        end_reason = case coalesce(p_scope, 'current') when 'current' then 'logout' when 'all' then 'revoked_all'
                                                       else 'logout_others' end
  where s.admin_user_id = v_admin.user_id and s.ended_at is null
    and case coalesce(p_scope, 'current') when 'current' then s.auth_session_id = v_sid
                                          when 'others' then s.auth_session_id <> v_sid else true end;
  get diagnostics v_n = row_count;
  perform private.admin_audit(v_admin, case when coalesce(p_scope, 'current') = 'current' then 'admin.logout'
                                            else 'admin.sessions_revoked' end,
                              'admin_user', v_admin.user_id::text, null, coalesce(p_reason, 'admin signed out'),
                              jsonb_build_object('scope', coalesce(p_scope, 'current'), 'sessions', v_n));
  return jsonb_build_object('ended', v_n, 'scope', coalesce(p_scope, 'current'));
end
$$;

-- Records a successful TOTP re-check (verified by the backoffice) for SU routes (10 minutes).
create function admin_api.admin_session_step_up() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
  v_at timestamptz;
begin
  update public.admin_sessions s set step_up_at = now()
  where s.auth_session_id = (auth.jwt() ->> 'session_id')::uuid and s.admin_user_id = v_admin.user_id
  returning s.step_up_at into v_at;
  perform private.admin_audit(v_admin, 'admin.session.step_up', 'admin_user', v_admin.user_id::text, null,
                              'totp step-up verified');
  return jsonb_build_object('step_up_valid_until', v_at + interval '10 minutes');
end
$$;

-- Persists the end of an expired session after the guard rejected it (the rejection itself rolls back).
create function admin_api.session_expire() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null, false, false);
  v_idle interval := make_interval(mins => private.app_setting_int('session.idle_minutes', 30));
  v_abs interval := make_interval(hours => private.app_setting_int('session.absolute_hours', 12));
  v_reason text;
begin
  update public.admin_sessions s
    set ended_at = now(),
        end_reason = case when s.absolute_expires_at <= now() or s.created_at + v_abs <= now() then 'absolute_timeout'
                          else 'idle_timeout' end
  where s.auth_session_id = (auth.jwt() ->> 'session_id')::uuid and s.admin_user_id = v_admin.user_id
    and s.ended_at is null
    and (s.idle_expires_at <= now() or s.absolute_expires_at <= now() or s.last_activity_at + v_idle <= now()
         or s.created_at + v_abs <= now())
  returning s.end_reason into v_reason;
  if v_reason is not null then
    perform private.admin_audit(v_admin, 'admin.session_expired', 'admin_user', v_admin.user_id::text, null,
                                'session limit reached', jsonb_build_object('end_reason', v_reason));
  end if;
  return jsonb_build_object('ended', v_reason is not null, 'end_reason', v_reason);
end
$$;

-- The caller's own sessions, newest first (≤ 20); never ip_hash or the raw user agent.
create function admin_api.sessions_list_own() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
  v_sid uuid := (auth.jwt() ->> 'session_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'current', s.auth_session_id = v_sid, 'aal', s.aal, 'created_at', s.created_at,
             'last_activity_at', s.last_activity_at, 'idle_expires_at', s.idle_expires_at,
             'absolute_expires_at', s.absolute_expires_at, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
             'browser_family', case
               when s.user_agent ~* 'edg/' then 'Edge' when s.user_agent ~* 'chrome/' then 'Chrome'
               when s.user_agent ~* 'firefox/' then 'Firefox' when s.user_agent ~* 'safari/' then 'Safari'
               else 'Other' end
               || case when s.user_agent ~* 'mac os' then ' · macOS' when s.user_agent ~* 'windows' then ' · Windows'
                       when s.user_agent ~* 'linux' then ' · Linux' else '' end)
           order by s.created_at desc)
    from (select * from public.admin_sessions s where s.admin_user_id = v_admin.user_id
          order by s.created_at desc limit 20) as s), '[]'::jsonb);
end
$$;

create function admin_api.admin_preferences_get() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
begin
  insert into public.admin_preferences (admin_user_id) values (v_admin.user_id) on conflict (admin_user_id) do nothing;
  return (select to_jsonb(ap) - 'admin_user_id' from public.admin_preferences ap where ap.admin_user_id = v_admin.user_id);
end
$$;

create function admin_api.admin_preferences_set(
  p_theme text default null, p_locale text default null, p_table_prefs jsonb default null, p_dashboard_range text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
begin
  if p_locale is not null and p_locale not in ('tr-TR', 'en-US', 'tr', 'en') then
    raise exception 'VALIDATION_FAILED:locale' using errcode = '22023';
  end if;
  if p_table_prefs is not null and jsonb_typeof(p_table_prefs) <> 'object' then
    raise exception 'VALIDATION_FAILED:table_prefs' using errcode = '22023';
  end if;
  insert into public.admin_preferences (admin_user_id) values (v_admin.user_id) on conflict (admin_user_id) do nothing;
  update public.admin_preferences ap
    set theme = coalesce(p_theme, ap.theme),
        locale = coalesce(case p_locale when 'tr' then 'tr-TR' when 'en' then 'en-US' else p_locale end, ap.locale),
        table_prefs = coalesce(p_table_prefs, ap.table_prefs),
        dashboard_range = coalesce(p_dashboard_range, ap.dashboard_range)
  where ap.admin_user_id = v_admin.user_id;
  return (select to_jsonb(ap) - 'admin_user_id' from public.admin_preferences ap where ap.admin_user_id = v_admin.user_id);
end
$$;

-- SQL gate for Edge-side privileged operations (Auth admin, email, health run, worker poke):
-- permission check plus the mutation-class rate limit bo_m:{admin} 60/min.
create function admin_api.authorize(p_permission text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
begin
  if p_permission is null then
    raise exception 'VALIDATION_FAILED:permission' using errcode = '22023';
  end if;
  v_admin := private.require_admin(p_permission);
  if not public.rate_limit_hit('bo_m:' || v_admin.user_id, 60, 60) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('admin_id', v_admin.user_id, 'role', v_admin.role, 'permission', p_permission, 'authorized', true);
end
$$;

-- Audit row for an Edge-side operation (result success | failure | denied); replay-safe on p_idem.
create function admin_api.audit_write(
  p_action text, p_target_type text, p_target_id text, p_target_user_id uuid, p_reason text, p_result text,
  p_details jsonb default '{}'::jsonb, p_idem text default null
) returns bigint
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
  v_id bigint;
begin
  if p_result is null or p_result not in ('success', 'failure', 'denied') then
    raise exception 'VALIDATION_FAILED:result' using errcode = '22023';
  end if;
  if p_action is null or p_action !~ '^[a-z_]+(\.[a-z_]+){1,3}$' then
    raise exception 'VALIDATION_FAILED:action' using errcode = '22023';
  end if;
  if p_idem is not null then
    select a.id into v_id from public.audit_logs a
    where a.actor_id = v_admin.user_id and a.details ->> 'idempotency_key' = p_idem
    order by a.id limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  return private.admin_audit(v_admin, p_action, p_target_type, p_target_id, p_target_user_id,
                             case when p_action like '%.read%' then p_reason else private.admin_require_reason(p_reason) end,
                             coalesce(p_details, '{}'::jsonb)
                             || case when p_idem is null then '{}'::jsonb else jsonb_build_object('idempotency_key', p_idem) end,
                             p_result);
end
$$;

-- The denial audit row for a route the admin lacks permission for (BACKOFFICE_PLAN §2.5 step 6).
create function admin_api.audit_denied(p_route text, p_permission text) returns bigint
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
begin
  return private.admin_audit(v_admin, 'admin.permission_denied', 'route', left(p_route, 200), null,
                             'permission ' || coalesce(p_permission, '-') || ' denied',
                             jsonb_build_object('route', left(p_route, 200), 'permission', p_permission), 'denied');
end
$$;

-- aal1 status for the sign-in flow (never raises for a known admin identity).
create function admin_api.auth_status() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_admin public.admin_users;
begin
  perform private.assert_admin_gateway();
  if v_uid is null or (auth.jwt() -> 'app_metadata' ->> 'da_kind') is distinct from 'admin' then
    return jsonb_build_object('is_admin', false, 'status', null, 'mfa_verified_factors', 0);
  end if;
  select * into v_admin from public.admin_users a where a.user_id = v_uid;
  return jsonb_build_object(
    'is_admin', v_admin.user_id is not null,
    'status', v_admin.status,
    'locked', v_admin.locked_until is not null and v_admin.locked_until > now(),
    'mfa_verified_factors', (select count(*) from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified'));
end
$$;

-- Stores freshly generated recovery-code hashes (10 codes, shown once) and invalidates the
-- unused earlier ones. Regeneration needs a step-up within 10 minutes once codes exist.
create function admin_api.recovery_codes_store(p_code_hashes bytea[]) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
  v_step_up timestamptz;
  v_n integer;
begin
  if p_code_hashes is null or cardinality(p_code_hashes) not between 1 and 20 then
    raise exception 'VALIDATION_FAILED:codes' using errcode = '22023';
  end if;
  if exists (select 1 from public.admin_mfa_recovery_codes c
             where c.admin_user_id = v_admin.user_id and c.used_at is null and c.replaced_at is null) then
    select s.step_up_at into v_step_up from public.admin_sessions s
    where s.auth_session_id = (auth.jwt() ->> 'session_id')::uuid;
    if v_step_up is null or v_step_up <= now() - interval '10 minutes' then
      raise exception 'STEP_UP_REQUIRED' using errcode = '42501';
    end if;
  end if;
  update public.admin_mfa_recovery_codes c set replaced_at = now()
  where c.admin_user_id = v_admin.user_id and c.used_at is null and c.replaced_at is null;
  insert into public.admin_mfa_recovery_codes (admin_user_id, code_hash)
  select v_admin.user_id, h from unnest(p_code_hashes) as t (h);
  get diagnostics v_n = row_count;
  perform private.admin_audit(v_admin, 'admin.recovery_codes_regenerated', 'admin_user', v_admin.user_id::text, null,
                              'recovery codes regenerated', jsonb_build_object('count', v_n));
  return v_n;
end
$$;

-- Redeems one recovery code with the aal1 admin JWT: marks it used and ends every other session
-- (the Edge function then deletes the TOTP factors and alerts the super admins).
create function admin_api.recovery_code_consume(p_code_hash bytea) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null, false, false, true);
  v_id uuid;
begin
  if not public.rate_limit_hit('bo_recovery:' || v_admin.user_id, 5, 3600) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  update public.admin_mfa_recovery_codes c set used_at = now()
  where c.admin_user_id = v_admin.user_id and c.code_hash = p_code_hash and c.used_at is null and c.replaced_at is null
  returning c.id into v_id;
  if v_id is null then
    raise exception 'RECOVERY_CODE_INVALID' using errcode = '22023';
  end if;
  update public.admin_sessions s set ended_at = now(), end_reason = 'recovery_used'
  where s.admin_user_id = v_admin.user_id and s.ended_at is null
    and s.auth_session_id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid;
  perform private.admin_audit(v_admin, 'admin.mfa_recovery_used', 'admin_user', v_admin.user_id::text, null,
                              'mfa recovery code redeemed');
  return jsonb_build_object('ok', true, 'remaining', (select count(*) from public.admin_mfa_recovery_codes c
                                                      where c.admin_user_id = v_admin.user_id and c.used_at is null
                                                        and c.replaced_at is null));
end
$$;

-- ── BFF-only sign-in routes (service_role; the raw email is used only for the match) ─────────

-- {allowed, send, locked, retry_after}: IP and email rate limits; send only for an active admin
-- (or an invited admin whose invite was redeemed), same response otherwise (no enumeration).
create function admin_api.login_preflight(p_email extensions.citext, p_email_hash text, p_ip_hash text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users;
begin
  if not public.rate_limit_hit('bo_otp_ip:' || coalesce(p_ip_hash, '-'), 5, 900) then
    return jsonb_build_object('allowed', false, 'send', false, 'locked', false, 'retry_after', 900);
  end if;
  if not public.rate_limit_hit('bo_otp_send:' || coalesce(p_email_hash, '-'), 5, 3600) then
    return jsonb_build_object('allowed', false, 'send', false, 'locked', false, 'retry_after', 3600);
  end if;
  select * into v_admin from public.admin_users a
  where a.email = p_email and (a.status = 'active' or (a.status = 'invited' and a.invite_redeemed_at is not null));
  if found and v_admin.locked_until is not null and v_admin.locked_until > now() then
    return jsonb_build_object('allowed', false, 'send', false, 'locked', true, 'retry_after', null);
  end if;
  return jsonb_build_object('allowed', true, 'send', found, 'locked', false, 'retry_after', null);
end
$$;

-- Records a sign-in attempt; 5 failures / 5 min lock 15 min, 20 failures / 24 h lock until a
-- super admin unlocks (locked_until = infinity). Failures are audited as admin.login_failed.
create function admin_api.login_attempt_record(
  p_email extensions.citext, p_email_hash text, p_ip_hash text, p_kind text, p_success boolean
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users;
  v_lock timestamptz;
begin
  if p_kind is null or p_kind not in ('email_otp', 'otp', 'mfa') then
    raise exception 'VALIDATION_FAILED:kind' using errcode = '22023';
  end if;
  select * into v_admin from public.admin_users a where a.email = p_email;
  if coalesce(p_success, false) then
    return jsonb_build_object('locked', false, 'locked_until', null);
  end if;
  if not public.rate_limit_hit('bo_login_email_day:' || coalesce(p_email_hash, '-'), 20, 86400) then
    v_lock := 'infinity';
  elsif not public.rate_limit_hit('bo_login_email:' || coalesce(p_email_hash, '-'), 5, 300) then
    v_lock := now() + interval '15 minutes';
  end if;
  if v_admin.user_id is not null then
    if v_lock is not null then
      update public.admin_users a set locked_until = greatest(coalesce(a.locked_until, v_lock), v_lock)
      where a.user_id = v_admin.user_id;
    end if;
    perform private.audit_log_append('system', null, null,
                                     case when v_lock is null then 'admin.login_failed' else 'admin.locked' end,
                                     'admin_user', v_admin.user_id::text, null, null, 'failure',
                                     jsonb_build_object('kind', p_kind, 'locked_until', v_lock), null);
  end if;
  return jsonb_build_object('locked', v_lock is not null, 'locked_until', v_lock);
end
$$;

-- Single-use invite redemption: verifies the token hash, the 72 h expiry and status = invited.
create function admin_api.invite_redeem(p_token_hash bytea) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users;
begin
  update public.admin_users a set invite_redeemed_at = now()
  where a.invite_token_hash = p_token_hash and a.status = 'invited' and a.invite_redeemed_at is null
    and a.invite_expires_at > now()
  returning * into v_admin;
  if v_admin.user_id is null then
    raise exception 'INVITE_INVALID' using errcode = '22023';
  end if;
  perform private.audit_log_append('system', null, null, 'admin.invite_redeemed', 'admin_user', v_admin.user_id::text, null,
                                   null, 'success', '{}'::jsonb, null);
  return jsonb_build_object('admin_user_id', v_admin.user_id, 'email', v_admin.email);
end
$$;

-- Probe result written by the `health` Edge function (never a fake green status, M§67).
create function admin_api.health_record(
  p_component text, p_status text, p_latency_ms integer default null, p_detail jsonb default '{}'::jsonb,
  p_checked_by text default 'cron'
) returns bigint
  language sql
  security definer
  set search_path = ''
  as $$
    insert into public.system_health_checks (component, status, latency_ms, detail, checked_by)
    values (p_component, p_status, p_latency_ms, coalesce(p_detail, '{}'::jsonb), coalesce(p_checked_by, 'cron'))
    returning id
  $$;

-- ═══ ADM-01 · dashboard and metrics (aggregates only; internal and demo users excluded) ══════

-- Metric population (BACKOFFICE_PLAN §7.1): app users that are neither internal nor demo.
create function private.metric_population() returns table (user_id uuid)
  language sql stable
  security definer
  set search_path = ''
  as $$ select p.user_id from public.profiles p where not p.is_internal and not p.is_demo $$;

create function private.dashboard_kpis(p_start timestamptz, p_end timestamptz) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    with pop as (select m.user_id from private.metric_population() as m),
    pro as (
      select s.user_id, 'store' as src from public.subscriptions s
      where s.is_active and s.environment is distinct from 'sandbox' and coalesce(s.expires_at, 'infinity') > p_end
        and s.status not in ('none', 'expired', 'refunded', 'paused')
      union
      select g.user_id, 'grant' from public.entitlement_grants g
      where g.revoked_at is null and g.starts_at <= p_end and g.ends_at > p_end)
    select jsonb_build_object(
      'total_users', (select count(*) from public.profiles p join pop using (user_id) where p.created_at < p_end),
      'new_users', (select count(*) from public.profiles p join pop using (user_id)
                    where p.created_at >= p_start and p.created_at < p_end),
      'active_users', (select count(distinct e.user_id) from public.analytics_events e join pop using (user_id)
                       where e.event_name = 'app_opened' and e.occurred_at >= p_start and e.occurred_at < p_end),
      'pro_users', (select count(distinct x.user_id) from pro x join pop using (user_id)),
      'pro_store', (select count(distinct x.user_id) from pro x join pop using (user_id) where x.src = 'store'),
      'pro_grant_only', (select count(distinct x.user_id) from pro x join pop using (user_id)
                         where x.src = 'grant' and x.user_id not in (select y.user_id from pro y where y.src = 'store')),
      'trials', (select count(*) from public.subscriptions s join pop using (user_id)
                 where s.is_active and s.environment is distinct from 'sandbox'
                   and (s.period_type = 'trial' or s.status = 'trial')),
      'connected_emails', (select count(*) from public.connected_accounts ca join pop using (user_id)
                           where ca.status <> 'disconnected' and 'mail_read' = any(ca.capabilities_granted)),
      'connected_calendars', (select count(*) from public.connected_accounts ca join pop using (user_id)
                              where ca.status <> 'disconnected' and 'calendar_read' = any(ca.capabilities_granted)),
      'ai_requests', (select count(*) from public.ai_requests r
                      where r.created_at >= p_start and r.created_at < p_end
                        and r.status not in ('budget_blocked', 'killed', 'cached')
                        and (r.user_id is null or r.user_id in (select pop.user_id from pop))),
      'ai_cost_usd', (select round(coalesce(sum(r.cost_usd_micros), 0) / 1000000.0, 4) from public.ai_requests r
                      where r.created_at >= p_start and r.created_at < p_end
                        and (r.user_id is null or r.user_id in (select pop.user_id from pop))),
      'briefings_generated', (select count(*) from public.briefings b join pop using (user_id)
                              where b.status in ('ready', 'delivered') and b.generated_at >= p_start and b.generated_at < p_end),
      'briefings_delivered', (select count(*) from public.briefings b join pop using (user_id)
                              where b.status = 'delivered' and b.generated_at >= p_start and b.generated_at < p_end),
      'push_sent', (select count(*) from public.notifications n join pop using (user_id)
                    where n.decision = 'sent' and n.sent_at >= p_start and n.sent_at < p_end and not n.is_test),
      'briefing_success_rate', (select case when count(*) = 0 then null
                                            else round(count(*) filter (where b.status in ('ready', 'delivered'))::numeric / count(*), 4) end
                                from public.briefings b join pop using (user_id)
                                where b.status in ('ready', 'delivered', 'failed')
                                  and b.scheduled_for >= p_start and b.scheduled_for < p_end),
      'suppression_rate', (select case when count(*) = 0 then null
                                       else round(count(*) filter (where n.decision in ('suppressed', 'deduplicated'))::numeric / count(*), 4) end
                           from public.notifications n join pop using (user_id)
                           where n.created_at >= p_start and n.created_at < p_end),
      'approval_conversion', (select case when count(*) = 0 then null
                                          else round(count(*) filter (where a.status in ('approved', 'executing', 'executed', 'failed'))::numeric / count(*), 4) end
                              from public.approval_actions a join pop using (user_id)
                              where a.status <> 'pending' and a.created_at >= p_start and a.created_at < p_end),
      'sync_success_rate', (select case when count(*) = 0 then null
                                        else round(count(*) filter (where ja.outcome = 'completed')::numeric / count(*), 4) end
                            from public.job_attempts ja join public.jobs j on j.id = ja.job_id
                            where j.type in ('initial_sync', 'gmail_sync', 'outlook_sync', 'calendar_sync', 'tasks_sync',
                                             'device_calendar_ingest', 'reconciliation', 'watch_renewal')
                              and ja.started_at >= p_start and ja.started_at < p_end and ja.finished_at is not null),
      'classification_rate', (select case when count(*) = 0 then null
                                          else round(count(*) filter (where m.ai_status <> 'pending_t0')::numeric / count(*), 4) end
                              from public.email_messages m join pop using (user_id)
                              where m.created_at >= p_start and m.created_at < p_end))
  $$;

create function admin_api.dashboard_metrics(p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('dashboard.read');
  w record;
  v_cur jsonb;
  v_prev jsonb;
begin
  select * into w from private.metric_window(p_range);
  v_cur := private.dashboard_kpis(w.start_at, w.end_at);
  v_prev := private.dashboard_kpis(w.prev_start_at, w.start_at);
  return jsonb_build_object('range', p_range, 'start_at', w.start_at, 'end_at', w.end_at, 'source', 'raw',
                            'computed_at', now(), 'value', v_cur, 'prev_value', v_prev,
                            'ai_cost_per_active_user', case when (v_cur ->> 'active_users')::numeric > 0
                              then round((v_cur ->> 'ai_cost_usd')::numeric / (v_cur ->> 'active_users')::numeric, 4) end);
end
$$;

-- Series per bucket: user_growth | active_usage | ai_costs | subscriptions | sync_failures.
create function admin_api.dashboard_series(p_metric text, p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('dashboard.read');
  w record;
  v_tz text := coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'metrics.reporting_timezone'),
                        'Europe/Istanbul');
begin
  if p_metric is null or p_metric not in ('user_growth', 'active_usage', 'ai_costs', 'subscriptions', 'sync_failures') then
    raise exception 'VALIDATION_FAILED:metric' using errcode = '22023';
  end if;
  select * into w from private.metric_window(p_range);
  return jsonb_build_object('metric', p_metric, 'range', p_range, 'bucket', w.bucket, 'points', coalesce((
    select jsonb_agg(jsonb_build_object('t', b.t, 'value', b.value, 'breakdown', b.breakdown) order by b.t)
    from (
      select date_trunc(w.bucket, x.at at time zone v_tz) as t, count(*)::numeric as value, null::jsonb as breakdown
      from (select p.created_at as at from public.profiles p join private.metric_population() as pop using (user_id)
            where p_metric = 'user_growth' and p.created_at >= w.start_at and p.created_at < w.end_at
            union all
            select ja.started_at from public.job_attempts ja join public.jobs j on j.id = ja.job_id
            where p_metric = 'sync_failures' and ja.outcome is distinct from 'completed' and ja.finished_at is not null
              and j.type in ('initial_sync', 'gmail_sync', 'outlook_sync', 'calendar_sync', 'tasks_sync',
                             'device_calendar_ingest', 'reconciliation', 'watch_renewal')
              and ja.started_at >= w.start_at and ja.started_at < w.end_at
            union all
            select be.received_at from public.billing_events be
            where p_metric = 'subscriptions' and be.event_type in ('INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION')
              and lower(coalesce(be.environment, 'production')) <> 'sandbox'
              and be.received_at >= w.start_at and be.received_at < w.end_at) as x
      where p_metric in ('user_growth', 'sync_failures', 'subscriptions')
      group by 1
      union all
      select date_trunc(w.bucket, e.occurred_at at time zone v_tz), count(distinct e.user_id), null
      from public.analytics_events e join private.metric_population() as pop using (user_id)
      where p_metric = 'active_usage' and e.event_name = 'app_opened' and e.occurred_at >= w.start_at and e.occurred_at < w.end_at
      group by 1
      union all
      select g.t, sum(g.cost), jsonb_object_agg(g.feature, g.cost)
      from (select date_trunc(w.bucket, r.created_at at time zone v_tz) as t, r.feature::text as feature,
                   round(sum(r.cost_usd_micros) / 1000000.0, 4) as cost
            from public.ai_requests r
            where p_metric = 'ai_costs' and r.created_at >= w.start_at and r.created_at < w.end_at
            group by 1, 2) as g
      group by g.t
    ) as b), '[]'::jsonb));
end
$$;

create function admin_api.metrics_ops(p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('metrics.ops.read');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return jsonb_build_object(
    'range', p_range, 'computed_at', now(),
    'kpis', private.dashboard_kpis(w.start_at, w.end_at) - 'total_users' - 'new_users' - 'pro_users' - 'pro_store'
            - 'pro_grant_only' - 'trials',
    'decision_tiers', coalesce((select jsonb_object_agg(coalesce(m.classification_tier::text, 'none'), m.n)
                                from (select em.classification_tier, count(*) as n from public.email_messages em
                                      where em.created_at >= w.start_at and em.created_at < w.end_at and em.ai_status <> 'pending_t0'
                                      group by 1) as m), '{}'::jsonb),
    'jobs', coalesce((select jsonb_object_agg(j.type || ':' || j.status, j.n)
                      from (select jb.type::text as type, jb.status::text as status, count(*) as n from public.jobs jb
                            where jb.updated_at >= w.start_at and jb.updated_at < w.end_at
                              and jb.status in ('completed', 'failed', 'dead_letter')
                            group by 1, 2) as j), '{}'::jsonb),
    'notifications', coalesce((select jsonb_object_agg(n.decision, n.c)
                               from (select nt.decision::text as decision, count(*) as c from public.notifications nt
                                     where nt.created_at >= w.start_at and nt.created_at < w.end_at group by 1) as n), '{}'::jsonb));
end
$$;

create function admin_api.metrics_product(p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('metrics.product.read');
  w record;
  v_active bigint;
begin
  select * into w from private.metric_window(p_range);
  select count(distinct e.user_id) into v_active
  from public.analytics_events e join private.metric_population() as pop using (user_id)
  where e.event_name = 'app_opened' and e.occurred_at >= w.start_at and e.occurred_at < w.end_at;
  return jsonb_build_object(
    'range', p_range, 'computed_at', now(), 'active_users', v_active,
    'feature_usage', coalesce((select jsonb_object_agg(f.event_name, jsonb_build_object('users', f.users,
                                 'share', case when v_active > 0 then round(f.users::numeric / v_active, 4) end))
                               from (select e.event_name, count(distinct e.user_id) as users
                                     from public.analytics_events e join private.metric_population() as pop using (user_id)
                                     where e.occurred_at >= w.start_at and e.occurred_at < w.end_at
                                       and e.event_name in ('briefing_opened', 'briefing_audio_played', 'meeting_prep_opened',
                                                            'assistant_query_sent', 'capture_created', 'follow_up_actioned',
                                                            'search_performed', 'approval_decided', 'voice_session_started')
                                     group by 1) as f), '{}'::jsonb),
    'approvals', coalesce((select jsonb_object_agg(a.action_type, jsonb_build_object('decided', a.decided, 'approved', a.approved,
                                    'executed', a.executed, 'failed', a.failed))
                           from (select aa.action_type::text as action_type, count(*) filter (where aa.status <> 'pending') as decided,
                                        count(*) filter (where aa.status in ('approved', 'executing', 'executed', 'failed')) as approved,
                                        count(*) filter (where aa.status = 'executed') as executed,
                                        count(*) filter (where aa.status = 'failed') as failed
                                 from public.approval_actions aa join private.metric_population() as pop using (user_id)
                                 where aa.created_at >= w.start_at and aa.created_at < w.end_at group by 1) as a), '{}'::jsonb),
    'referrals', (select jsonb_build_object('applied', count(*), 'rewarded', count(*) filter (where r.status = 'rewarded'),
                                            'flagged', count(*) filter (where r.status = 'flagged'))
                  from public.referrals r where r.applied_at >= w.start_at and r.applied_at < w.end_at));
end
$$;

create function admin_api.security_events(p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return jsonb_build_object('range', p_range, 'events', coalesce((
    select jsonb_agg(jsonb_build_object('action', x.action, 'count', x.n, 'admins', x.admins) order by x.n desc)
    from (select a.action, count(*) as n,
                 coalesce(jsonb_agg(distinct coalesce(a.actor_id::text, a.target_id))
                            filter (where coalesce(a.actor_id::text, a.target_id) is not null), '[]'::jsonb) as admins
          from public.audit_logs a
          where a.occurred_at >= w.start_at and a.occurred_at < w.end_at
            and a.action in ('admin.login_failed', 'admin.locked', 'admin.mfa_recovery_used', 'admin.mfa_reset',
                             'admin.role_changed', 'admin.disabled', 'admin.permission_denied', 'support_access.granted',
                             'security.webhook_rejected', 'security.oauth_state_replay', 'security.oauth_binding_mismatch')
          group by a.action) as x), '[]'::jsonb));
end
$$;

-- ═══ ADM-02 · users ══════════════════════════════════════════════════════════════════════════

create function private.admin_assert_user(p_user uuid) returns void
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end
$$;

-- Filters: plan (free | pro | trial), state (inactive | sync_error | connection_error | disabled |
-- internal), user_id (exact); sorts: created_at | last_active_at | last_sync_at. Emails masked.
create function admin_api.users_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('users.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"f.created_at","last_active_at":"f.last_active_at","last_sync_at":"f.last_sync_at"}',
                                      'f.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with base as (
      select p.user_id, p.created_at, p.last_active_at, p.state, p.is_internal, p.is_demo, u.email,
             e.is_active as pro, e.is_trial,
             (select max(ca.last_successful_sync_at) from public.connected_accounts ca where ca.user_id = p.user_id) as last_sync_at,
             (select count(*) from public.connected_accounts ca where ca.user_id = p.user_id and ca.status <> 'disconnected') as accounts,
             (select i.platform from public.app_installations i where i.user_id = p.user_id order by i.last_seen_at desc limit 1) as platform,
             exists (select 1 from public.sync_states s where s.user_id = p.user_id and s.status in ('error', 'resync_required')) as sync_error,
             exists (select 1 from public.connected_accounts ca where ca.user_id = p.user_id
                     and ca.status in ('needs_reauth', 'error', 'admin_consent_required')) as connection_error
      from public.profiles p
      join auth.users u on u.id = p.user_id
      cross join lateral private.effective_entitlement_at(p.user_id, now()) as e
      where ($1 ->> 'user_id' is null or p.user_id::text = $1 ->> 'user_id')
    ), filtered as (
      select b.* from base b
      where ($1 ->> 'plan' is null
             or ($1 ->> 'plan' = 'pro' and b.pro) or ($1 ->> 'plan' = 'free' and not b.pro)
             or ($1 ->> 'plan' = 'trial' and b.is_trial))
        and ($1 ->> 'state' is null
             or ($1 ->> 'state' = 'inactive' and coalesce(b.last_active_at, b.created_at) < now() - make_interval(days => $4))
             or ($1 ->> 'state' = 'sync_error' and b.sync_error)
             or ($1 ->> 'state' = 'connection_error' and b.connection_error)
             or ($1 ->> 'state' = 'disabled' and b.state = 'disabled')
             or ($1 ->> 'state' = 'internal' and b.is_internal))
    ), paged as (
      select f.*, count(*) over () as total from filtered f order by %1$s, f.user_id limit $2 offset $3
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object(
                'id', f.user_id, 'email_masked', private.mask_email(f.email::extensions.citext),
                'plan', case when f.pro then 'pro' else 'free' end, 'is_trial', f.is_trial, 'created_at', f.created_at,
                'last_active_at', f.last_active_at, 'platform', f.platform, 'connected_accounts', f.accounts,
                'last_sync_at', f.last_sync_at, 'status', f.state, 'is_internal', f.is_internal, 'is_demo', f.is_demo)
              order by %1$s, f.user_id), '[]'::jsonb),
      'total', coalesce(max(f.total), (select count(*) from filtered)))
    from paged f
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size),
        private.app_setting_int('metrics.inactive_after_days', 14);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- Exact email lookup (never a partial search; audited).
create function admin_api.user_lookup_email(p_email extensions.citext) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.read');
  v_user uuid;
begin
  select u.id into v_user from auth.users u
  join public.profiles p on p.user_id = u.id
  where lower(u.email) = lower(p_email::text);
  perform private.admin_audit(v_admin, 'user.lookup_by_email', 'user', v_user::text, v_user, 'exact email lookup',
                              jsonb_build_object('found', v_user is not null));
  if v_user is null then
    return jsonb_build_object('user_id', null);
  end if;
  return jsonb_build_object('user_id', v_user);
end
$$;

-- The privacy-safe support view (M§49): status, plan, integrations, last job errors, briefings,
-- push health and app version; never content.
create function admin_api.user_overview(p_user uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.read');
  p public.profiles;
  e record;
begin
  perform private.admin_assert_user(p_user);
  select * into p from public.profiles x where x.user_id = p_user;
  select * into e from private.effective_entitlement_at(p_user, now());
  return jsonb_build_object(
    'user_id', p_user,
    'email_masked', (select private.mask_email(u.email::extensions.citext) from auth.users u where u.id = p_user),
    'display_name_masked', private.mask_name(p.display_name),
    'account_status', p.state, 'disabled_at', p.disabled_at, 'is_internal', p.is_internal, 'is_demo', p.is_demo,
    'created_at', p.created_at, 'last_active_at', p.last_active_at, 'onboarding_completed_at', p.onboarding_completed_at,
    'plan', case when e.is_active then 'pro' else 'free' end, 'plan_source', e.source, 'plan_until', e.active_until,
    'time_zone', (select up.timezone from public.user_preferences up where up.user_id = p_user),
    'integrations', coalesce((select jsonb_agg(jsonb_build_object(
                                'account_id', ca.id, 'provider', ca.provider, 'status', ca.status,
                                'last_sync_at', ca.last_successful_sync_at, 'last_error_code', ca.last_error_code,
                                'watch_expires_at', (select min(s.watch_expires_at) from public.sync_states s
                                                     where s.connected_account_id = ca.id and s.watch_kind <> 'none'))
                                order by ca.created_at)
                              from public.connected_accounts ca where ca.user_id = p_user), '[]'::jsonb),
    'job_errors', coalesce((select jsonb_agg(jsonb_build_object('job_id', j.id, 'type', j.type, 'status', j.status,
                                                               'error_code', j.last_error_code, 'at', j.updated_at)
                                             order by j.updated_at desc)
                            from (select * from public.jobs jb where jb.user_id = p_user and jb.last_error_code is not null
                                  order by jb.updated_at desc limit 20) as j), '[]'::jsonb),
    'briefing_status', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'local_date', b.local_date,
                                                                     'status', b.status, 'skipped_reason', b.skipped_reason,
                                                                     'error_code', b.error_code)
                                                  order by b.local_date desc, b.kind)
                                 from (select * from public.briefings bx where bx.user_id = p_user
                                       order by bx.local_date desc limit 7) as b), '[]'::jsonb),
    'push_status', jsonb_build_object(
      'tokens_enabled', (select count(*) from public.push_tokens t where t.user_id = p_user and t.status = 'active'),
      'last_receipt_error', (select pt.error_code from public.push_tickets pt where pt.user_id = p_user and pt.error_code is not null
                             order by pt.sent_at desc limit 1)),
    'app_version', (select i.app_version from public.app_installations i where i.user_id = p_user order by i.last_seen_at desc limit 1),
    'platform', (select i.platform from public.app_installations i where i.user_id = p_user order by i.last_seen_at desc limit 1));
end
$$;

create function admin_api.user_integrations(p_user uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_all(array['users.read', 'integrations.read']);
begin
  perform private.admin_assert_user(p_user);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'account_id', ca.id, 'provider', ca.provider, 'email_masked', private.mask_email(ca.account_email),
             'capabilities_granted', ca.capabilities_granted, 'status', ca.status, 'status_reason', ca.status_reason,
             'error_class', case when ca.status in ('needs_reauth', 'admin_consent_required') then 'needs_reconnect'
                                 when ca.status = 'error' then 'provider_error' end,
             'data_sources', ca.data_source_toggles, 'connected_at', ca.connected_at, 'disconnected_at', ca.disconnected_at,
             'resources', coalesce((select jsonb_agg(jsonb_build_object(
                                      'resource', s.resource, 'status', s.status, 'last_success_at', s.last_success_at,
                                      'last_error_code', s.last_error_code, 'consecutive_failures', s.consecutive_failures,
                                      'watch_expires_at', s.watch_expires_at,
                                      'watch_status', case when s.watch_kind = 'none' then 'none'
                                                           when s.watch_expires_at < now() then 'expired'
                                                           when s.lifecycle_last_event is not null then 'issue' else 'active' end)
                                      order by s.resource)
                                    from public.sync_states s where s.connected_account_id = ca.id), '[]'::jsonb),
             'recent_jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'type', j.type, 'status', j.status,
                                                                         'last_error_code', j.last_error_code, 'created_at', j.created_at)
                                                       order by j.created_at desc)
                                      from (select * from public.jobs jb where jb.connected_account_id = ca.id
                                            order by jb.created_at desc limit 5) as j), '[]'::jsonb))
           order by ca.created_at)
    from (select * from public.connected_accounts cx where cx.user_id = p_user order by cx.created_at limit 10) as ca),
    '[]'::jsonb);
end
$$;

create function admin_api.user_briefings(
  p_user uuid, p_filter jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 25
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_all(array['users.read', 'briefings.read']);
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  perform private.admin_assert_user(p_user);
  return (
    with rows as (
      select b.*, count(*) over () as total, row_number() over (order by b.local_date desc, b.kind) as n
      from public.briefings b
      where b.user_id = p_user
        and (v_filter ->> 'kind' is null or b.kind::text = v_filter ->> 'kind')
        and (v_filter ->> 'status' is null or b.status::text = v_filter ->> 'status')
        and b.local_date >= coalesce((v_filter ->> 'from')::date, current_date - 30)
        and b.local_date <= coalesce((v_filter ->> 'to')::date, current_date + 1)
      order by b.local_date desc, b.kind
      limit private.admin_page_size(p_page_size) offset private.admin_offset(p_page, p_page_size))
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'kind', r.kind, 'local_date', r.local_date, 'status', r.status, 'scheduled_for', r.scheduled_for,
             'generated_at', r.generated_at, 'delivered_at', r.delivered_at, 'latency_ms', r.latency_ms,
             'item_count', (select count(*) from public.briefing_items i where i.briefing_id = r.id),
             'ai_cost_usd', round(r.ai_cost_usd_micros / 1000000.0, 4), 'skip_reason', r.skipped_reason,
             'error_code', r.error_code, 'origin', r.origin, 'version', r.version,
             'notification_decision', (select n.decision from public.notifications n
                                       where n.user_id = r.user_id and n.dedupe_key = 'briefing:' || r.id))
           order by r.n), '[]'::jsonb),
           'total', coalesce(max(r.total), 0), 'page', greatest(coalesce(p_page, 1), 1),
           'page_size', private.admin_page_size(p_page_size))
    from rows r);
end
$$;

create function admin_api.user_usage(p_user uuid, p_range text default '30d') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.read');
  v_days integer;
  v_from timestamptz;
  v_cap integer;
begin
  perform private.admin_assert_user(p_user);
  v_days := case coalesce(p_range, '30d') when '7d' then 7 when '30d' then 30 when '90d' then 90 end;
  if v_days is null then
    raise exception 'VALIDATION_FAILED:range' using errcode = '22023';
  end if;
  v_from := now() - make_interval(days => v_days);
  v_cap := private.plan_limit_int(p_user, 'ai_daily_budget_units');
  return jsonb_build_object(
    'range', coalesce(p_range, '30d'),
    'ai', jsonb_build_object(
      'days', coalesce((select jsonb_agg(jsonb_build_object('date', u.local_date, 'feature', u.feature, 'requests', u.requests,
                                                            'input_tokens', u.input_tokens, 'output_tokens', u.output_tokens,
                                                            'cost_usd', round(u.cost_usd_micros / 1000000.0, 4), 'units', u.units_used)
                                         order by u.local_date desc, u.feature)
                        from public.ai_usage_daily u where u.user_id = p_user and u.local_date >= v_from::date), '[]'::jsonb),
      'daily_budget_units', v_cap,
      'budget_hit_days', (select count(*) from (select u.local_date from public.ai_usage_daily u
                                                where u.user_id = p_user and u.local_date >= v_from::date
                                                group by u.local_date
                                                having v_cap is not null and sum(u.units_used) >= v_cap) as d)),
    'feature_usage', coalesce((select jsonb_object_agg(x.event_name, x.n)
                               from (select e.event_name, count(*) as n from public.analytics_events e
                                     where e.user_id = p_user and e.occurred_at >= v_from
                                       and e.event_name in ('briefing_opened', 'assistant_query_sent', 'capture_created',
                                                            'meeting_prep_opened', 'follow_up_actioned', 'search_performed',
                                                            'approval_decided')
                                     group by 1) as x), '{}'::jsonb),
    'approvals', (select jsonb_build_object('created', count(*),
                                            'approved', count(*) filter (where a.approved_at is not null),
                                            'executed', count(*) filter (where a.status = 'executed'))
                  from public.approval_actions a where a.user_id = p_user and a.created_at >= v_from),
    'reminders_created', (select count(*) from public.reminders r where r.user_id = p_user and r.created_at >= v_from),
    'captures', (select jsonb_build_object('count', count(*), 'bytes', coalesce(sum(c.size_bytes), 0))
                 from public.captures c where c.user_id = p_user and c.created_at >= v_from),
    'content_volumes', jsonb_build_object(
      'email_threads', (select count(*) from public.email_threads t where t.user_id = p_user),
      'calendar_events', (select count(*) from public.calendar_events e where e.user_id = p_user),
      'insights', (select count(*) from public.insights i where i.user_id = p_user),
      'memory_chunks', (select count(*) from public.memory_chunks m where m.user_id = p_user)),
    'notifications_by_decision', coalesce((select jsonb_object_agg(n.decision, n.c)
                                           from (select nt.decision::text as decision, count(*) as c from public.notifications nt
                                                 where nt.user_id = p_user and nt.created_at >= v_from group by 1) as n), '{}'::jsonb));
end
$$;

-- Store mirror, grants and effective entitlement as separate panels (M§60); the billing events
-- panel needs billing_events.read (the key is absent otherwise).
create function admin_api.user_subscription(p_user uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_all(array['users.read', 'subscriptions.read']);
  e record;
  v_result jsonb;
begin
  perform private.admin_assert_user(p_user);
  select * into e from private.effective_entitlement_at(p_user, now());
  v_result := jsonb_build_object(
    'store', (select jsonb_build_object('store', s.store, 'product_id', s.product_id, 'period_type', s.period_type,
                                        'status', s.status, 'is_active', s.is_active, 'will_renew', s.will_renew,
                                        'expires_at', s.expires_at, 'billing_issue_detected_at', s.billing_issue_at,
                                        'environment', s.environment, 'synced_at', s.synced_at, 'last_event_id', s.last_event_id)
              from public.subscriptions s where s.user_id = p_user and s.entitlement = 'pro'),
    'grants', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', g.id, 'source', g.source, 'duration_days', g.duration_days, 'starts_at', g.starts_at,
                           'ends_at', g.ends_at, 'reason', g.reason, 'revoked_at', g.revoked_at,
                           'granted_by', g.granted_by_admin_id,
                           'state', case when g.revoked_at is not null then 'revoked' when g.starts_at > now() then 'scheduled'
                                         when g.ends_at <= now() then 'ended' else 'active' end)
                         order by g.starts_at desc)
                        from (select * from public.entitlement_grants gx where gx.user_id = p_user
                              order by gx.starts_at desc limit 20) as g), '[]'::jsonb),
    'effective', jsonb_build_object('entitlement', e.entitlement, 'source', e.source, 'until', e.active_until,
                                    'is_trial', e.is_trial));
  if private.admin_can(v_admin, 'billing_events.read') then
    v_result := v_result || jsonb_build_object('billing_events', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', b.event_id, 'type', b.event_type, 'environment', b.environment,
                                          'product_id', b.product_id, 'event_at', b.event_timestamp,
                                          'received_at', b.received_at, 'processed', b.process_status = 'processed')
                       order by b.event_timestamp desc)
      from (select * from public.billing_events bx where bx.user_id = p_user order by bx.event_timestamp desc limit 20) as b),
      '[]'::jsonb));
  end if;
  return v_result;
end
$$;

create function admin_api.user_referrals(p_user uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_all(array['users.read', 'referrals.read']);
begin
  perform private.admin_assert_user(p_user);
  return jsonb_build_object(
    'code', (select rc.code from public.referral_codes rc where rc.user_id = p_user),
    'as_referrer', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', r.id, 'referee_masked', (select private.mask_email(u.email::extensions.citext)
                                                               from auth.users u where u.id = r.referee_id),
                                'status', r.status, 'risk_score', r.risk_score,
                                'signal_labels', (select coalesce(jsonb_agg(k.key), '[]'::jsonb)
                                                  from jsonb_object_keys(r.risk_signals) as k (key)),
                                'created_at', r.created_at, 'qualified_at', r.qualified_at, 'rewarded_at', r.rewarded_at)
                              order by r.created_at desc)
                             from public.referrals r where r.referrer_id = p_user), '[]'::jsonb),
    'as_referee', (select jsonb_build_object('id', r.id, 'status', r.status,
                                             'referrer_masked', (select private.mask_email(u.email::extensions.citext)
                                                                 from auth.users u where u.id = r.referrer_id))
                   from public.referrals r where r.referee_id = p_user),
    'credits', coalesce((select jsonb_agg(jsonb_build_object('referral_id', c.referral_id, 'side', c.side,
                                                             'grant_id', c.entitlement_grant_id, 'days', c.days)
                                          order by c.created_at desc)
                         from public.referral_credits c where c.user_id = p_user), '[]'::jsonb),
    'yearly_rewards', jsonb_build_object(
      'used', (select count(*) from public.referral_credits c
               where c.user_id = p_user and c.side = 'referrer' and c.created_at > now() - interval '365 days'),
      'max', private.plan_limit_int(p_user, 'referral_rewards_per_year')));
end
$$;

create function admin_api.user_support(p_user uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_all(array['users.read', 'support.read']);
begin
  perform private.admin_assert_user(p_user);
  return jsonb_build_object(
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'reference', t.public_ref, 'category', t.category,
                                                             'status', t.status, 'subject', t.subject,
                                                             'assignee', t.assigned_admin_id, 'created_at', t.created_at)
                                          order by t.created_at desc)
                         from public.support_tickets t where t.user_id = p_user), '[]'::jsonb),
    'access_grants', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', g.id, 'admin', jsonb_build_object('id', a.user_id, 'display_name', a.display_name),
                                  'scopes', g.scope, 'reason', g.reason, 'starts_at', g.starts_at, 'expires_at', g.expires_at,
                                  'revoked_at', g.revoked_at, 'reveal_count', g.reveal_count,
                                  'active', g.revoked_at is null and g.starts_at <= now() and g.expires_at > now())
                                order by g.created_at desc)
                               from public.support_access_grants g join public.admin_users a on a.user_id = g.admin_user_id
                               where g.user_id = p_user), '[]'::jsonb));
end
$$;

create function private.audit_row_json(a public.audit_logs) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'id', a.id, 'chain_seq', a.chain_seq, 'ts', a.occurred_at, 'actor_type', a.actor_type,
      'actor', case when a.actor_type = 'admin' then (select jsonb_build_object('id', x.user_id, 'display_name', x.display_name,
                                                                                'email_masked', private.mask_email(x.email))
                                                      from public.admin_users x where x.user_id = a.actor_id)
                    when a.actor_id is not null then private.admin_user_label(a.actor_id) end,
      'role', a.actor_role, 'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
      'target_user', case when a.target_user_id is not null then private.admin_user_label(a.target_user_id) end,
      'reason', a.reason, 'result', a.result, 'correlation_id', a.correlation_id, 'metadata', a.details - 'idempotency_key',
      'prev_hash', encode(a.prev_hash, 'hex'), 'hash', encode(a.row_hash, 'hex'))
  $$;

create function admin_api.user_audit(
  p_user uuid, p_page integer default 1, p_page_size integer default 25, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_all(array['users.read', 'audit.read']);
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  perform private.admin_assert_user(p_user);
  return (
    with rows as (
      select a as rec, a.id, a.occurred_at, count(*) over () as total
      from public.audit_logs a
      where a.target_user_id = p_user
        and (v_filter ->> 'action' is null or a.action = v_filter ->> 'action')
        and (v_filter ->> 'result' is null or a.result = v_filter ->> 'result')
        and (v_filter ->> 'actor_id' is null or a.actor_id::text = v_filter ->> 'actor_id')
        and (v_filter ->> 'from' is null or a.occurred_at >= (v_filter ->> 'from')::timestamptz)
        and (v_filter ->> 'to' is null or a.occurred_at < (v_filter ->> 'to')::timestamptz)
      order by a.occurred_at desc, a.id desc
      limit private.admin_page_size(p_page_size) offset private.admin_offset(p_page, p_page_size))
    select jsonb_build_object('rows', coalesce(jsonb_agg(private.audit_row_json(r.rec) order by r.occurred_at desc, r.id desc),
                                               '[]'::jsonb),
                              'total', coalesce(max(r.total), 0), 'page', greatest(coalesce(p_page, 1), 1),
                              'page_size', private.admin_page_size(p_page_size))
    from rows r);
end
$$;

create function admin_api.user_devices(p_user uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_all(array['users.read', 'notifications.read']);
begin
  perform private.admin_assert_user(p_user);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'installation_id', i.id, 'platform', i.platform, 'app_version', i.app_version, 'build_number', i.build_number,
             'os_version', i.os_version, 'push_enabled', i.push_enabled, 'last_seen_at', i.last_seen_at,
             'token_masked', (select private.mask_push_token(t.expo_push_token) from public.push_tokens t
                              where t.installation_id = i.id and t.status = 'active' order by t.last_registered_at desc limit 1),
             'last_receipt_status', (select pt.status from public.push_tickets pt join public.push_tokens t on t.id = pt.push_token_id
                                     where t.installation_id = i.id order by pt.sent_at desc limit 1),
             'last_receipt_error', (select pt.error_code from public.push_tickets pt join public.push_tokens t on t.id = pt.push_token_id
                                    where t.installation_id = i.id and pt.error_code is not null order by pt.sent_at desc limit 1))
           order by i.last_seen_at desc)
    from public.app_installations i where i.user_id = p_user and i.signed_out_at is null), '[]'::jsonb);
end
$$;

-- Audited reveal of the unmasked account email or display name (valid 60 s in the UI).
create function admin_api.user_reveal_email(p_user uuid, p_reason text, p_field text default 'email') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.pii.reveal');
  v_reason text := private.admin_require_reason(p_reason);
  v_value text;
begin
  perform private.admin_assert_user(p_user);
  if coalesce(p_field, 'email') = 'email' then
    select u.email into v_value from auth.users u where u.id = p_user;
  elsif p_field = 'display_name' then
    select p.display_name into v_value from public.profiles p where p.user_id = p_user;
  else
    raise exception 'VALIDATION_FAILED:field' using errcode = '22023';
  end if;
  perform private.admin_audit(v_admin, 'pii.reveal', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('field', coalesce(p_field, 'email'), 'resource_type', 'user'));
  return jsonb_build_object('value', v_value, 'expires_in_s', 60);
end
$$;

-- Enqueues a sync of every active account of the user (or one account),
-- key admin_force_sync:{account}:{job type}:{utc minute}.
create function admin_api.user_force_sync(p_user uuid, p_account uuid default null, p_reason text default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.force_sync');
  v_reason text := private.admin_require_reason(p_reason);
  a public.connected_accounts;
  v_jobs jsonb := '[]'::jsonb;
  v_type public.job_type;
  v_types public.job_type[];
  v_minute text := to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYYMMDDHH24MI');
begin
  perform private.admin_assert_user(p_user);
  for a in select * from public.connected_accounts ca
           where ca.user_id = p_user and ca.status <> 'disconnected' and (p_account is null or ca.id = p_account)
  loop
    v_types := array_remove(array[
      case when 'mail_read' = any(a.capabilities_granted) then
        case a.provider when 'google' then 'gmail_sync' when 'microsoft' then 'outlook_sync' when 'demo' then 'initial_sync' end
      end::public.job_type,
      case when 'calendar_read' = any(a.capabilities_granted) and a.provider in ('google', 'microsoft') then 'calendar_sync' end::public.job_type,
      case when 'tasks_read' = any(a.capabilities_granted) then 'tasks_sync' end::public.job_type], null);
    foreach v_type in array v_types loop
      v_jobs := v_jobs || jsonb_build_array(private.enqueue_job(v_type,
        'admin_force_sync:' || a.id || ':' || v_type || ':' || v_minute,
        jsonb_build_object('connected_account_id', a.id, 'trigger', 'admin'), p_user, a.id, now(), 20, 5, null));
    end loop;
  end loop;
  if p_account is not null and not exists (select 1 from public.connected_accounts ca
                                           where ca.id = p_account and ca.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.admin_audit(v_admin, 'user.force_sync', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('connected_account_id', p_account, 'jobs', v_jobs));
  return jsonb_build_object('job_ids', v_jobs);
end
$$;

create function admin_api.user_disable(p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.disable');
  v_reason text := private.admin_require_reason(p_reason);
begin
  perform private.admin_assert_user(p_user);
  update public.profiles p set state = 'disabled', disabled_at = now(), disabled_reason = left(v_reason, 500),
                               disabled_by = v_admin.user_id
  where p.user_id = p_user and p.state <> 'disabled';
  if not found then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  perform private.admin_audit(v_admin, 'user.disable', 'user', p_user::text, p_user, v_reason);
  return jsonb_build_object('user_id', p_user, 'state', 'disabled');
end
$$;

create function admin_api.user_restore(p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.disable');
  v_reason text := private.admin_require_reason(p_reason);
begin
  perform private.admin_assert_user(p_user);
  update public.profiles p set state = 'active', disabled_at = null, disabled_reason = null, disabled_by = null
  where p.user_id = p_user and p.state = 'disabled';
  if not found then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  perform private.admin_audit(v_admin, 'user.restore', 'user', p_user::text, p_user, v_reason);
  return jsonb_build_object('user_id', p_user, 'state', 'active');
end
$$;

create function admin_api.user_mark_internal(p_user uuid, p_internal boolean, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.mark_internal');
  v_reason text := private.admin_require_reason(p_reason);
begin
  perform private.admin_assert_user(p_user);
  if p_internal is null then
    raise exception 'VALIDATION_FAILED:internal' using errcode = '22023';
  end if;
  update public.profiles p set is_internal = p_internal where p.user_id = p_user;
  perform private.admin_audit(v_admin, 'user.internal_flag_changed', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('is_internal', p_internal));
  return jsonb_build_object('user_id', p_user, 'is_internal', p_internal);
end
$$;

-- ═══ ADM-03 · support tickets and Support Access (R-09) ══════════════════════════════════════

create function admin_api.tickets_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('support.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"t.created_at","updated_at":"t.updated_at","priority":"t.priority","status":"t.status"}',
                                      't.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select t.*, count(*) over () as total from public.support_tickets t
      where ($1 ->> 'status' is null or t.status::text = $1 ->> 'status')
        and ($1 ->> 'category' is null or t.category::text = $1 ->> 'category')
        and ($1 ->> 'assignee' is null or t.assigned_admin_id::text = $1 ->> 'assignee')
        and ($1 ->> 'source' is null or t.origin = $1 ->> 'source')
        and ($1 ->> 'q' is null or t.public_ref = $1 ->> 'q')
      order by %1$s, t.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'reference', t.public_ref, 'category', t.category, 'status', t.status, 'priority', t.priority,
             'subject', t.subject, 'platform', t.platform, 'app_version', t.app_version, 'origin', t.origin,
             'assignee', t.assigned_admin_id, 'created_at', t.created_at, 'updated_at', t.updated_at,
             'contact_email_masked', private.mask_email(t.contact_email), 'user_id', t.user_id)
           order by %1$s, t.id), '[]'::jsonb), 'total', coalesce(max(t.total), 0))
    from f as t
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

create function admin_api.ticket_detail(p_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.read');
  t public.support_tickets;
begin
  select * into t from public.support_tickets x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', t.id, 'reference', t.public_ref, 'user', case when t.user_id is not null then private.admin_user_label(t.user_id) end,
    'category', t.category, 'status', t.status, 'priority', t.priority, 'subject', t.subject, 'message', t.message,
    'contact_email_masked', private.mask_email(t.contact_email), 'platform', t.platform, 'app_version', t.app_version,
    'origin', t.origin, 'assignee', t.assigned_admin_id, 'first_response_at', t.first_response_at,
    'resolved_at', t.resolved_at, 'closed_at', t.closed_at, 'created_at', t.created_at, 'updated_at', t.updated_at,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'author_admin_id', n.author_admin_id,
                                                          'author', a.display_name, 'body', n.body, 'created_at', n.created_at)
                                        order by n.created_at)
                       from public.support_notes n join public.admin_users a on a.user_id = n.author_admin_id
                       where n.ticket_id = t.id), '[]'::jsonb));
end
$$;

create function admin_api.ticket_update(
  p_id uuid, p_status public.ticket_status default null, p_assignee uuid default null, p_priority text default null,
  p_reason text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.write');
  v_reason text := private.admin_require_reason(p_reason);
  t public.support_tickets;
  v_before jsonb;
begin
  select * into t from public.support_tickets x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'VALIDATION_FAILED:priority' using errcode = '22023';
  end if;
  if p_assignee is not null and not exists (select 1 from public.admin_users a where a.user_id = p_assignee and a.status = 'active') then
    raise exception 'VALIDATION_FAILED:assignee' using errcode = '22023';
  end if;
  v_before := jsonb_build_object('status', t.status, 'assignee', t.assigned_admin_id, 'priority', t.priority);
  update public.support_tickets x
    set status = coalesce(p_status, x.status),
        assigned_admin_id = coalesce(p_assignee, x.assigned_admin_id),
        priority = coalesce(p_priority, x.priority),
        first_response_at = case when coalesce(p_status, x.status) <> 'open' then coalesce(x.first_response_at, now())
                                 else x.first_response_at end,
        resolved_at = case when p_status = 'resolved' then coalesce(x.resolved_at, now()) else x.resolved_at end,
        closed_at = case when p_status = 'closed' then coalesce(x.closed_at, now()) else x.closed_at end
  where x.id = p_id
  returning * into t;
  perform private.admin_audit(v_admin, 'support.ticket_updated', 'support_ticket', t.id::text, t.user_id, v_reason,
                              jsonb_build_object('before', v_before,
                                                 'after', jsonb_build_object('status', t.status, 'assignee', t.assigned_admin_id,
                                                                             'priority', t.priority)));
  return jsonb_build_object('id', t.id, 'status', t.status, 'assignee', t.assigned_admin_id, 'priority', t.priority);
end
$$;

create function admin_api.ticket_add_note(p_id uuid, p_body text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.write');
  t public.support_tickets;
  v_note uuid;
begin
  select * into t from public.support_tickets x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 5000 then
    raise exception 'VALIDATION_FAILED:body' using errcode = '22023';
  end if;
  insert into public.support_notes (ticket_id, user_id, author_admin_id, body) values (t.id, t.user_id, v_admin.user_id, p_body)
  returning id into v_note;
  perform private.admin_audit(v_admin, 'support.note_added', 'support_ticket', t.id::text, t.user_id, 'internal support note',
                              jsonb_build_object('note_id', v_note));
  return jsonb_build_object('note_id', v_note);
end
$$;

-- A time-boxed, reasoned grant (15 / 30 / 60 min, R-09); never tokens, files or original mail.
create function admin_api.support_access_grant(
  p_user uuid, p_scope public.support_access_scope[], p_reason text, p_minutes integer, p_ticket uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.access');
  v_reason text := private.admin_require_reason(p_reason);
  g public.support_access_grants;
begin
  perform private.admin_assert_user(p_user);
  if p_minutes is null or p_minutes not in (15, 30, 60)
     or p_minutes > private.app_setting_int('support_access.max_minutes', 60) then
    raise exception 'VALIDATION_FAILED:minutes' using errcode = '22023';
  end if;
  if p_scope is null or cardinality(p_scope) = 0 then
    raise exception 'VALIDATION_FAILED:scope' using errcode = '22023';
  end if;
  if char_length(v_reason) < 15 then
    raise exception 'VALIDATION_FAILED:reason' using errcode = '22023';
  end if;
  insert into public.support_access_grants (admin_user_id, user_id, ticket_id, scope, reason, starts_at, expires_at)
  values (v_admin.user_id, p_user, p_ticket, (select array_agg(distinct s) from unnest(p_scope) as u (s)), v_reason,
          now(), now() + make_interval(mins => p_minutes))
  returning * into g;
  perform private.admin_audit(v_admin, 'support_access.granted', 'support_access_grant', g.id::text, p_user, v_reason,
                              jsonb_build_object('scope', g.scope, 'minutes', p_minutes, 'ticket_id', p_ticket));
  return jsonb_build_object('id', g.id, 'scope', g.scope, 'starts_at', g.starts_at, 'expires_at', g.expires_at);
end
$$;

create function admin_api.support_access_revoke(p_grant uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.access');
  v_reason text := private.admin_require_reason(p_reason);
  g public.support_access_grants;
begin
  select * into g from public.support_access_grants x where x.id = p_grant for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if g.admin_user_id <> v_admin.user_id and v_admin.role <> 'super_admin' then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501';
  end if;
  if g.revoked_at is not null then
    return jsonb_build_object('id', g.id, 'revoked_at', g.revoked_at);
  end if;
  update public.support_access_grants x set revoked_at = now(), revoked_by = v_admin.user_id where x.id = g.id returning * into g;
  perform private.admin_audit(v_admin, 'support_access.revoked', 'support_access_grant', g.id::text, g.user_id, v_reason);
  return jsonb_build_object('id', g.id, 'revoked_at', g.revoked_at);
end
$$;

-- Returns only the stored derived fields of one resource under an active grant that covers the
-- scope; increments reveal_count and writes pii.reveal. No provider call is ever made for staff.
create function admin_api.support_access_authorize(
  p_grant uuid, p_scope public.support_access_scope, p_resource_type text, p_resource_id uuid, p_reason text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.access');
  v_reason text := private.admin_require_reason(p_reason);
  g public.support_access_grants;
  v_value jsonb;
  v_owner uuid;
begin
  select * into g from public.support_access_grants x where x.id = p_grant for update;
  if not found or g.admin_user_id <> v_admin.user_id or g.revoked_at is not null
     or g.starts_at > now() or g.expires_at <= now() or not (p_scope = any(g.scope)) then
    raise exception 'SUPPORT_ACCESS_DENIED' using errcode = '42501';
  end if;
  case p_scope
    when 'pii' then
      case p_resource_type
        when 'user' then
          select u.id, jsonb_build_object('email', u.email, 'display_name', p.display_name) into v_owner, v_value
          from auth.users u left join public.profiles p on p.user_id = u.id where u.id = p_resource_id;
        when 'connected_account' then
          select a.user_id, jsonb_build_object('account_email', a.account_email) into v_owner, v_value
          from public.connected_accounts a where a.id = p_resource_id;
        when 'support_ticket' then
          select t.user_id, jsonb_build_object('contact_email', t.contact_email) into v_owner, v_value
          from public.support_tickets t where t.id = p_resource_id;
        else null;
      end case;
    when 'email_metadata' then
      case p_resource_type
        when 'email_thread' then
          select t.user_id, jsonb_build_object('subject', t.subject, 'participants', t.participants,
                                               'snippet', (select m.snippet from public.email_messages m where m.thread_id = t.id
                                                           order by m.received_at desc limit 1))
            into v_owner, v_value
          from public.email_threads t where t.id = p_resource_id;
        when 'email_message' then
          select m.user_id, jsonb_build_object('subject', m.subject, 'from_email', m.from_email, 'from_name', m.from_name,
                                               'to_emails', m.to_emails, 'cc_emails', m.cc_emails, 'snippet', m.snippet,
                                               'received_at', m.received_at)
            into v_owner, v_value
          from public.email_messages m where m.id = p_resource_id;
        else null;
      end case;
    when 'insights' then
      case p_resource_type
        when 'insight' then
          select i.user_id, jsonb_build_object('title', i.title, 'body', i.body, 'why_important', i.why_important)
            into v_owner, v_value from public.insights i where i.id = p_resource_id;
        when 'email_thread' then
          select t.user_id, jsonb_build_object('ai_summary', t.ai_summary, 'key_points', t.key_points)
            into v_owner, v_value from public.email_threads t where t.id = p_resource_id;
        when 'briefing' then
          select b.user_id, jsonb_build_object('headline', b.headline, 'hero_line', b.hero_line, 'narrative', b.narrative)
            into v_owner, v_value from public.briefings b where b.id = p_resource_id;
        else null;
      end case;
    when 'notifications' then
      if p_resource_type = 'notification' then
        select n.user_id, jsonb_build_object('title', n.title_rendered, 'body', n.body_rendered, 'detail_mode', n.detail_mode)
          into v_owner, v_value from public.notifications n where n.id = p_resource_id;
      end if;
    when 'captures' then
      if p_resource_type = 'capture' then
        select c.user_id, jsonb_build_object('kind', c.kind, 'extracted', c.extracted, 'extracted_types', c.extracted_types,
                                             'primary_type', c.primary_type)
          into v_owner, v_value from public.captures c where c.id = p_resource_id;
      end if;
    when 'assistant_transcript' then
      if p_resource_type = 'assistant_thread' then
        select t.user_id, jsonb_build_object('messages', coalesce((select jsonb_agg(jsonb_build_object(
                                               'role', m.role, 'content', m.content, 'created_at', m.created_at) order by m.created_at)
                                             from public.assistant_messages m where m.thread_id = t.id), '[]'::jsonb))
          into v_owner, v_value from public.assistant_threads t where t.id = p_resource_id;
      end if;
    when 'ai_feedback' then
      if p_resource_type = 'ai_feedback' then
        select f.user_id, jsonb_build_object('comment', f.comment) into v_owner, v_value
        from public.ai_feedback f where f.id = p_resource_id;
      end if;
  end case;
  if v_value is null or v_owner is distinct from g.user_id then
    raise exception 'SUPPORT_ACCESS_DENIED' using errcode = '42501';
  end if;
  update public.support_access_grants x set reveal_count = x.reveal_count + 1 where x.id = g.id;
  perform private.admin_audit(v_admin, 'pii.reveal', p_resource_type, p_resource_id::text, g.user_id, v_reason,
                              jsonb_build_object('grant_id', g.id, 'scope', p_scope, 'resource_type', p_resource_type,
                                                 'resource_id', p_resource_id));
  return jsonb_build_object('value', v_value, 'expires_in_s', 60);
end
$$;

-- ═══ ADM-04 · integrations (never tokens) ════════════════════════════════════════════════════

create function admin_api.integrations_overview(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('integrations.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"a.created_at","last_sync_at":"a.last_successful_sync_at","status":"a.status::text"}',
                                      'a.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select a.*, count(*) over () as total,
             (select min(s.watch_expires_at) from public.sync_states s where s.connected_account_id = a.id and s.watch_kind <> 'none') as watch_expires_at,
             (select max(c.key_version) from public.oauth_credentials c where c.connected_account_id = a.id) as key_version
      from public.connected_accounts a
      where ($1 ->> 'provider' is null or a.provider::text = $1 ->> 'provider')
        and ($1 ->> 'status' is null or a.status::text = $1 ->> 'status')
        and ($1 ->> 'user_id' is null or a.user_id::text = $1 ->> 'user_id')
        and ($1 ->> 'issue' is null
             or ($1 ->> 'issue' = 'needs_reconnect' and a.status in ('needs_reauth', 'admin_consent_required'))
             or ($1 ->> 'issue' = 'oauth_error' and a.status_reason in ('invalid_grant', 'scope_missing', 'revoked_by_user'))
             or ($1 ->> 'issue' = 'refresh_error' and a.status = 'error')
             or ($1 ->> 'issue' = 'watch_issue' and exists (
                   select 1 from public.sync_states s where s.connected_account_id = a.id and s.watch_kind <> 'none'
                     and (s.watch_expires_at < now() or s.lifecycle_last_event is not null))))
      order by %1$s, a.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'account_id', a.id, 'user_id', a.user_id, 'provider', a.provider,
             'email_masked', private.mask_email(a.account_email), 'status', a.status, 'status_reason', a.status_reason,
             'last_sync_at', a.last_successful_sync_at, 'last_error_code', a.last_error_code,
             'watch_expires_at', a.watch_expires_at, 'key_version', a.key_version)
           order by %1$s, a.id), '[]'::jsonb), 'total', coalesce(max(a.total), 0))
    from f as a
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

create function admin_api.integrations_summary(p_range text default '7d') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(array['integrations.read', 'metrics.ops.read']);
  w record;
begin
  select * into w from private.metric_window(p_range);
  return jsonb_build_object(
    'range', p_range,
    'by_provider_status', coalesce((select jsonb_agg(jsonb_build_object('provider', x.provider, 'status', x.status, 'count', x.n)
                                                     order by x.provider, x.status)
                                    from (select a.provider, a.status, count(*) as n from public.connected_accounts a
                                          join private.metric_population() as pop using (user_id)
                                          group by 1, 2) as x), '[]'::jsonb),
    'watches_expiring_24h', (select count(*) from public.sync_states s
                             where s.watch_kind <> 'none' and s.watch_expires_at between now() and now() + interval '24 hours'),
    'watch_renewals_failed_24h', (select count(*) from public.jobs j
                                  where j.type = 'watch_renewal' and j.status in ('failed', 'dead_letter', 'retrying')
                                    and j.updated_at > now() - interval '24 hours'),
    'oldest_healthy_last_sync_at', (select min(a.last_successful_sync_at) from public.connected_accounts a
                                    where a.status = 'healthy'),
    'reconnect_rate', (select case when count(*) = 0 then null
                                   else round(count(*) filter (where a.status = 'healthy')::numeric / count(*), 4) end
                       from public.connected_accounts a
                       where a.reauth_required_at >= w.start_at and a.reauth_required_at < w.end_at));
end
$$;

create function admin_api.integration_detail(p_account uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('integrations.read');
  a public.connected_accounts;
begin
  select * into a from public.connected_accounts x where x.id = p_account;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'account_id', a.id, 'user', private.admin_user_label(a.user_id), 'provider', a.provider,
    'email_masked', private.mask_email(a.account_email), 'status', a.status, 'status_reason', a.status_reason,
    'granted_scopes', a.granted_scopes, 'capabilities_granted', a.capabilities_granted, 'data_sources', a.data_source_toggles,
    'connected_at', a.connected_at, 'last_sync_at', a.last_sync_at, 'last_successful_sync_at', a.last_successful_sync_at,
    'last_error_at', a.last_error_at, 'last_error_code', a.last_error_code, 'reauth_required_at', a.reauth_required_at,
    'disconnected_at', a.disconnected_at, 'revocation_mode', a.revocation_mode, 'credential_expires_at', a.credential_expires_at,
    'pending_binding_until', a.pending_binding_until,
    'sync_states', coalesce((select jsonb_agg(jsonb_build_object(
                               'id', s.id, 'resource', s.resource, 'status', s.status, 'last_success_at', s.last_success_at,
                               'last_full_sync_at', s.last_full_sync_at, 'last_error_code', s.last_error_code,
                               'consecutive_failures', s.consecutive_failures, 'watch_kind', s.watch_kind,
                               'watch_expires_at', s.watch_expires_at, 'watch_renew_after', s.watch_renew_after,
                               'lifecycle_last_event', s.lifecycle_last_event)
                             order by s.resource)
                            from public.sync_states s where s.connected_account_id = a.id), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'type', j.type, 'status', j.status,
                                                         'last_error_code', j.last_error_code, 'created_at', j.created_at)
                                       order by j.created_at desc)
                      from (select * from public.jobs jb where jb.connected_account_id = a.id
                            order by jb.created_at desc limit 20) as j), '[]'::jsonb),
    'webhooks', (select jsonb_build_object('received_7d', count(*),
                                           'rejected_7d', count(*) filter (where w.status = 'rejected'),
                                           'last_received_at', max(w.received_at))
                 from public.webhook_events w where w.connected_account_id = a.id and w.received_at > now() - interval '7 days'));
end
$$;

-- Enqueues integration_purge (revoke, stop watches, delete credentials, purge per p_purge_content).
create function admin_api.integration_disconnect(p_account uuid, p_reason text, p_purge_content boolean default false)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('integrations.disconnect');
  v_reason text := private.admin_require_reason(p_reason);
  a public.connected_accounts;
  v_job uuid;
begin
  select * into a from public.connected_accounts x where x.id = p_account for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status = 'disconnected' then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  v_job := private.enqueue_job('integration_purge',
    'integration_purge:' || a.id || ':admin:' || floor(extract(epoch from now()))::bigint,
    jsonb_build_object('connected_account_id', a.id, 'mode', 'admin_disconnect', 'purge_content', coalesce(p_purge_content, false),
                       'admin_id', v_admin.user_id),
    a.user_id, a.id, now(), 20, 5, null);
  perform private.admin_audit(v_admin, 'integration.admin_disconnect', 'connected_account', a.id::text, a.user_id, v_reason,
                              jsonb_build_object('provider', a.provider, 'purge_content', coalesce(p_purge_content, false),
                                                 'job_id', v_job));
  return jsonb_build_object('job_id', v_job);
end
$$;

create function admin_api.integration_renew_watch(p_account uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('integrations.renew_watch');
  v_reason text := private.admin_require_reason(p_reason);
  a public.connected_accounts;
  s record;
  v_jobs jsonb := '[]'::jsonb;
begin
  select * into a from public.connected_accounts x where x.id = p_account;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  for s in select st.id from public.sync_states st where st.connected_account_id = a.id and st.watch_kind <> 'none' loop
    v_jobs := v_jobs || jsonb_build_array(private.enqueue_job('watch_renewal',
      'watch_renewal:' || s.id || ':admin:' || to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYYMMDDHH24MI'),
      jsonb_build_object('sync_state_id', s.id, 'mode', 'recreate', 'trigger', 'admin'), a.user_id, a.id, now(), 20, 5, null));
  end loop;
  perform private.admin_audit(v_admin, 'integration.watch_renew_requested', 'connected_account', a.id::text, a.user_id,
                              v_reason, jsonb_build_object('jobs', v_jobs));
  return jsonb_build_object('job_ids', v_jobs);
end
$$;

-- ═══ ADM-05 · sync and jobs ══════════════════════════════════════════════════════════════════

create function admin_api.jobs_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('jobs.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"j.created_at","updated_at":"j.updated_at","run_after":"j.run_after","attempts":"j.attempts","type":"j.type::text"}',
                                      'j.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select j.*, count(*) over () as total from public.jobs j
      where ($1 ->> 'type' is null or j.type::text = $1 ->> 'type')
        and ($1 ->> 'status' is null or j.status::text = $1 ->> 'status')
        and ($1 ->> 'user_id' is null or j.user_id::text = $1 ->> 'user_id')
        and ($1 ->> 'account_id' is null or j.connected_account_id::text = $1 ->> 'account_id')
        and ($1 ->> 'from' is null or j.created_at >= ($1 ->> 'from')::timestamptz)
        and ($1 ->> 'to' is null or j.created_at < ($1 ->> 'to')::timestamptz)
        and ($1 ->> 'q' is null or j.id::text = $1 ->> 'q' or j.correlation_id::text = $1 ->> 'q')
      order by %1$s, j.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', j.id, 'type', j.type, 'status', j.status, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
             'last_error_code', j.last_error_code, 'run_after', j.run_after, 'created_at', j.created_at,
             'updated_at', j.updated_at, 'correlation_id', j.correlation_id, 'user_id', j.user_id,
             'connected_account_id', j.connected_account_id)
           order by %1$s, j.id), '[]'::jsonb), 'total', coalesce(max(j.total), 0))
    from f as j
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

create function admin_api.jobs_summary(p_range text default '24h') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('jobs.read');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return jsonb_build_object(
    'range', p_range,
    'by_type_status', coalesce((select jsonb_agg(jsonb_build_object('type', x.type, 'status', x.status, 'count', x.n)
                                                 order by x.type, x.status)
                                from (select j.type, j.status, count(*) as n from public.jobs j
                                      where j.updated_at >= w.start_at and j.updated_at < w.end_at group by 1, 2) as x), '[]'::jsonb),
    'dead_letter', (select count(*) from public.jobs j where j.status = 'dead_letter'),
    'queued_due', (select count(*) from public.jobs j where j.status in ('queued', 'retrying') and j.run_after <= now()),
    'running', (select count(*) from public.jobs j where j.status = 'running'),
    'oldest_due_at', (select min(j.run_after) from public.jobs j where j.status in ('queued', 'retrying') and j.run_after <= now()));
end
$$;

create function admin_api.job_detail(p_job uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('jobs.read');
  j public.jobs;
begin
  select * into j from public.jobs x where x.id = p_job;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', j.id, 'type', j.type, 'status', j.status, 'priority', j.priority, 'user_id', j.user_id,
    'connected_account_id', j.connected_account_id, 'payload', private.redact_payload(j.payload),
    'idempotency_key', j.idempotency_key, 'run_after', j.run_after, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
    'lease_owner', j.lease_owner, 'lease_expires_at', j.lease_expires_at, 'last_error_code', j.last_error_code,
    'last_error_message', j.last_error_message, 'correlation_id', j.correlation_id, 'parent_job_id', j.parent_job_id,
    'progress', j.progress, 'started_at', j.started_at, 'completed_at', j.completed_at,
    'dead_lettered_at', j.dead_lettered_at, 'created_at', j.created_at, 'updated_at', j.updated_at,
    'policy', private.job_admin_policy(j.type),
    'attempts_history', coalesce((select jsonb_agg(jsonb_build_object('attempt', a.attempt, 'worker_id', a.worker_id,
                                                                      'started_at', a.started_at, 'finished_at', a.finished_at,
                                                                      'outcome', a.outcome, 'error_code', a.error_code,
                                                                      'duration_ms', a.duration_ms) order by a.attempt)
                                  from public.job_attempts a where a.job_id = j.id), '[]'::jsonb),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'status', c.status) order by c.created_at)
                          from public.jobs c where c.parent_job_id = j.id), '[]'::jsonb));
end
$$;

-- Timeline across the correlation chain (≤ 500 rows; ids, statuses and labels only).
create function admin_api.correlation_trace(p_correlation_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('jobs.read');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', t.kind, 'id', t.id, 'ts', t.ts, 'status', t.status, 'label_key', t.label)
                     order by t.ts, t.kind)
    from (
      select * from (
        select 'job' as kind, j.id::text as id, j.created_at as ts, j.status::text as status, j.type::text as label
        from public.jobs j where j.correlation_id = p_correlation_id
        union all
        select 'job_attempt', a.id::text, a.started_at, a.outcome, j.type::text
        from public.job_attempts a join public.jobs j on j.id = a.job_id where j.correlation_id = p_correlation_id
        union all
        select 'ai_request', r.id::text, r.created_at, r.status, r.feature::text || ':' || r.model
        from public.ai_requests r where r.correlation_id = p_correlation_id
        union all
        select 'notification', n.id::text, n.created_at, n.decision::text, n.category::text
        from public.notifications n where n.correlation_id = p_correlation_id
        union all
        select 'push_ticket', pt.id::text, pt.sent_at, pt.status, coalesce(pt.error_code, 'ok')
        from public.push_tickets pt join public.notifications n on n.id = pt.notification_id
        where n.correlation_id = p_correlation_id
        union all
        select 'approval_event', e.id::text, e.created_at, e.to_status::text, coalesce(e.from_status::text, '-') || '->' || e.to_status::text
        from public.approval_events e where e.correlation_id = p_correlation_id
        union all
        select 'audit', a.id::text, a.occurred_at, a.result, a.action
        from public.audit_logs a where a.correlation_id = p_correlation_id
        union all
        select 'briefing', b.id::text, b.created_at, b.status::text, b.kind::text
        from public.briefings b join public.jobs j on j.id = b.job_id where j.correlation_id = p_correlation_id
      ) as u order by u.ts limit 500
    ) as t), '[]'::jsonb);
end
$$;

-- failed / dead_letter → queued (same idempotency key; attempts kept unless reset; one more attempt).
create function admin_api.job_retry(p_job uuid, p_reason text, p_reset_attempts boolean default false) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('jobs.retry');
  v_reason text := private.admin_require_reason(p_reason);
  j public.jobs;
  v_policy jsonb;
  v_manual integer;
begin
  select * into j from public.jobs x where x.id = p_job for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if j.status not in ('failed', 'dead_letter') then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  v_policy := private.job_admin_policy(j.type);
  select count(*) into v_manual from public.audit_logs a where a.action = 'job.retried' and a.target_id = j.id::text;
  if not (v_policy ->> 'retryable_by_admin')::boolean or v_manual >= (v_policy ->> 'max_manual_retries')::integer then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'max_manual_retries';
  end if;
  update public.jobs x
    set status = 'queued', run_after = now(), dead_lettered_at = null, lease_owner = null, lease_expires_at = null,
        attempts = case when coalesce(p_reset_attempts, false) then 0 else x.attempts end,
        max_attempts = case when coalesce(p_reset_attempts, false) then x.max_attempts else least(x.max_attempts + 1, 20) end
  where x.id = j.id;
  perform private.admin_audit(v_admin, 'job.retried', 'job', j.id::text, j.user_id, v_reason,
                              jsonb_build_object('type', j.type, 'from_status', j.status, 'reset_attempts', coalesce(p_reset_attempts, false)));
  return jsonb_build_object('id', j.id, 'status', 'queued');
end
$$;

create function admin_api.job_retry_bulk(
  p_type public.job_type, p_status public.job_status, p_reason text, p_max integer default 100,
  p_from timestamptz default null, p_to timestamptz default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('jobs.retry');
  v_reason text := private.admin_require_reason(p_reason);
  v_n integer;
begin
  if p_status is null or p_status not in ('failed', 'dead_letter') or p_type is null then
    raise exception 'VALIDATION_FAILED:filter' using errcode = '22023';
  end if;
  if p_max is null or p_max not between 1 and 500 then
    raise exception 'VALIDATION_FAILED:max' using errcode = '22023';
  end if;
  with c as (
    select j.id from public.jobs j
    where j.type = p_type and j.status = p_status
      and (p_from is null or j.updated_at >= p_from) and (p_to is null or j.updated_at < p_to)
    order by j.updated_at limit p_max for update skip locked)
  update public.jobs x
    set status = 'queued', run_after = now(), dead_lettered_at = null, lease_owner = null, lease_expires_at = null,
        max_attempts = least(x.max_attempts + 1, 20)
  from c where x.id = c.id;
  get diagnostics v_n = row_count;
  perform private.admin_audit(v_admin, 'job.bulk_retried', 'job_type', p_type::text, null, v_reason,
                              jsonb_build_object('status', p_status, 'count', v_n, 'from', p_from, 'to', p_to));
  return jsonb_build_object('retried', v_n);
end
$$;

-- queued / retrying → failed (CANCELLED_ADMIN) for cancellable types.
create function admin_api.job_cancel(p_job uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('jobs.cancel');
  v_reason text := private.admin_require_reason(p_reason);
  j public.jobs;
begin
  select * into j from public.jobs x where x.id = p_job for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if j.status not in ('queued', 'retrying') or not (private.job_admin_policy(j.type) ->> 'cancellable')::boolean then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  update public.jobs x set status = 'failed', last_error_code = 'CANCELLED_ADMIN', last_error_message = 'cancelled by an admin'
  where x.id = j.id;
  perform private.admin_audit(v_admin, 'job.cancelled', 'job', j.id::text, j.user_id, v_reason, jsonb_build_object('type', j.type));
  return jsonb_build_object('id', j.id, 'status', 'failed');
end
$$;

-- ═══ ADM-06 · briefings (never narrative or sections) ════════════════════════════════════════

create function admin_api.briefings_metrics(p_range text, p_kind public.briefing_kind default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('briefings.read');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return (
    select jsonb_build_object(
      'range', p_range, 'kind', p_kind,
      'scheduled', count(*), 'generated', count(*) filter (where b.status in ('ready', 'delivered')),
      'delivered', count(*) filter (where b.status = 'delivered'), 'failed', count(*) filter (where b.status = 'failed'),
      'skipped', count(*) filter (where b.status = 'skipped'),
      'skipped_reasons', coalesce((select jsonb_object_agg(x.r, x.n) from (
                                     select b2.skipped_reason as r, count(*) as n from public.briefings b2
                                     where b2.status = 'skipped' and b2.scheduled_for >= w.start_at and b2.scheduled_for < w.end_at
                                       and (p_kind is null or b2.kind = p_kind) group by 1) as x), '{}'::jsonb),
      'p50_latency_ms', percentile_cont(0.5) within group (order by b.latency_ms) filter (where b.latency_ms is not null),
      'p95_latency_ms', percentile_cont(0.95) within group (order by b.latency_ms) filter (where b.latency_ms is not null),
      'ai_cost_usd', round(coalesce(sum(b.ai_cost_usd_micros), 0) / 1000000.0, 4))
    from public.briefings b
    where b.scheduled_for >= w.start_at and b.scheduled_for < w.end_at and (p_kind is null or b.kind = p_kind));
end
$$;

create function admin_api.briefings_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('briefings.read');
  v_order text := private.admin_order(p_sort, '{"local_date":"b.local_date","scheduled_for":"b.scheduled_for","latency_ms":"b.latency_ms"}',
                                      'b.scheduled_for desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select b.*, count(*) over () as total from public.briefings b
      where ($1 ->> 'user_id' is null or b.user_id::text = $1 ->> 'user_id')
        and ($1 ->> 'kind' is null or b.kind::text = $1 ->> 'kind')
        and ($1 ->> 'status' is null or b.status::text = $1 ->> 'status')
        and ($1 ->> 'local_date' is null or b.local_date = ($1 ->> 'local_date')::date)
      order by %1$s, b.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'user_id', b.user_id, 'kind', b.kind, 'local_date', b.local_date, 'status', b.status,
             'scheduled_for', b.scheduled_for, 'generated_at', b.generated_at, 'delivered_at', b.delivered_at,
             'latency_ms', b.latency_ms, 'skipped_reason', b.skipped_reason, 'error_code', b.error_code,
             'origin', b.origin, 'version', b.version, 'audio_status', b.audio_status)
           order by %1$s, b.id), '[]'::jsonb), 'total', coalesce(max(b.total), 0))
    from f as b
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- Same row, origin retry, version + 1, re-queued (key briefing_regen:{id}:v{version}).
create function admin_api.briefing_regenerate(p_briefing uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('briefings.regenerate');
  v_reason text := private.admin_require_reason(p_reason);
  b public.briefings;
  v_job uuid;
begin
  select * into b from public.briefings x where x.id = p_briefing for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if b.status in ('scheduled', 'generating') then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  update public.briefings x
    set status = 'scheduled', origin = 'retry', version = x.version + 1, error_code = null, failed_at = null,
        skipped_reason = null
  where x.id = b.id
  returning * into b;
  v_job := private.enqueue_job('briefing', 'briefing_regen:' || b.id || ':v' || b.version,
                               jsonb_build_object('briefing_id', b.id, 'trigger', 'admin_regenerate'), b.user_id, null, now(),
                               30, 5, null);
  perform private.admin_audit(v_admin, 'briefing.regenerated', 'briefing', b.id::text, b.user_id, v_reason,
                              jsonb_build_object('version', b.version, 'job_id', v_job));
  return jsonb_build_object('id', b.id, 'version', b.version, 'job_id', v_job);
end
$$;

-- ═══ ADM-07 · notifications (no rendered text) ═══════════════════════════════════════════════

create function admin_api.notifications_metrics(p_range text, p_category public.notification_category default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('notifications.read');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return (
    select jsonb_build_object(
      'range', p_range, 'category', p_category,
      'scheduled', count(*) filter (where n.decision = 'scheduled'), 'sent', count(*) filter (where n.decision = 'sent'),
      'failed', count(*) filter (where n.decision = 'failed'), 'suppressed', count(*) filter (where n.decision = 'suppressed'),
      'deduplicated', count(*) filter (where n.decision = 'deduplicated'),
      -- every suppression reason (incl. late_delivery) with its count
      'suppression_reasons', coalesce((select jsonb_object_agg(x.r, x.c) from (
                                         select n2.suppression_reason as r, count(*) as c from public.notifications n2
                                         where n2.suppression_reason is not null and n2.created_at >= w.start_at
                                           and n2.created_at < w.end_at and (p_category is null or n2.category = p_category)
                                         group by 1) as x), '{}'::jsonb),
      'receipt_errors', coalesce((select jsonb_object_agg(x.e, x.c) from (
                                    select pt.error_code as e, count(*) as c from public.push_tickets pt
                                    join public.notifications n3 on n3.id = pt.notification_id
                                    where pt.error_code is not null and pt.sent_at >= w.start_at and pt.sent_at < w.end_at
                                      and (p_category is null or n3.category = p_category)
                                    group by 1) as x), '{}'::jsonb),
      'pending_scheduled', (select count(*) from public.notifications n4
                            where n4.decision = 'scheduled' and n4.scheduled_for > now()
                              and (p_category is null or n4.category = p_category)))
    from public.notifications n
    where n.created_at >= w.start_at and n.created_at < w.end_at and (p_category is null or n.category = p_category));
end
$$;

create function admin_api.notifications_user_debug(
  p_user uuid, p_page integer default 1, p_page_size integer default 25, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('notifications.read');
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  perform private.admin_assert_user(p_user);
  return (
    with rows as (
      select n.*, count(*) over () as total
      from public.notifications n
      where n.user_id = p_user
        and (v_filter ->> 'category' is null or n.category::text = v_filter ->> 'category')
        and (v_filter ->> 'decision' is null or n.decision::text = v_filter ->> 'decision')
      order by n.created_at desc, n.id
      limit private.admin_page_size(p_page_size) offset private.admin_offset(p_page, p_page_size))
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'category', r.category, 'decision', r.decision, 'decision_reason', r.suppression_reason,
             'detail_mode', r.detail_mode, 'android_channel', r.android_channel, 'scheduled_for', r.scheduled_for,
             'sent_at', r.sent_at, 'opened_at', r.opened_at, 'is_test', r.is_test, 'correlation_id', r.correlation_id,
             'receipt_status', (select pt.status from public.push_tickets pt where pt.notification_id = r.id
                                order by pt.sent_at desc limit 1))
           order by r.created_at desc, r.id), '[]'::jsonb),
           'total', coalesce(max(r.total), 0), 'page', greatest(coalesce(p_page, 1), 1),
           'page_size', private.admin_page_size(p_page_size))
    from rows r);
end
$$;

-- Generic test push ("Dijital Asistan" / "Test bildirimi"); never bypasses quiet hours (R-13).
create function admin_api.notification_send_test(p_user uuid, p_reason text, p_installation uuid default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('push.test');
  v_reason text := private.admin_require_reason(p_reason);
  v_job uuid;
begin
  perform private.admin_assert_user(p_user);
  if p_installation is not null and not exists (select 1 from public.app_installations i
                                                where i.id = p_installation and i.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_job := private.enqueue_job('notification',
    'admin_test_push:' || p_user || ':' || to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYYMMDDHH24MI'),
    jsonb_build_object('kind', 'test', 'category', 'account', 'detail_mode', 'generic', 'installation_id', p_installation,
                       'bypass_caps', true, 'bypass_quiet_hours', false, 'admin_id', v_admin.user_id),
    p_user, null, now(), 10, 3, null);
  perform private.admin_audit(v_admin, 'notifications.test_sent', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('job_id', v_job, 'installation_id', p_installation));
  return jsonb_build_object('job_id', v_job);
end
$$;

-- ═══ ADM-08 · AI operations and model configuration ══════════════════════════════════════════

-- Latency histogram buckets in ms (BACKOFFICE_PLAN §7.6) plus one overflow bucket.
create function private.latency_bounds() returns integer[]
  language sql immutable parallel safe
  set search_path = ''
  as $$ select array[50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 60000, 120000] $$;

-- Histogram of latencies: element i counts values ≤ bounds[i] (and > bounds[i−1]); the last
-- element is the overflow bucket.
create function private.latency_hist(p_latencies integer[]) returns integer[]
  language plpgsql immutable parallel safe
  set search_path = ''
  as $$
declare
  v_bounds integer[] := private.latency_bounds();
  v_n integer := array_length(v_bounds, 1) + 1;
  v_hist integer[] := array_fill(0, array[v_n]);
  v_ms integer;
  i integer;
begin
  if p_latencies is null then
    return null;
  end if;
  foreach v_ms in array p_latencies loop
    continue when v_ms is null;
    i := 1;
    while i < v_n and v_ms > v_bounds[i] loop
      i := i + 1;
    end loop;
    v_hist[i] := v_hist[i] + 1;
  end loop;
  return v_hist;
end
$$;

-- Approximate percentile (upper bucket bound) of one histogram or of a 2-D array of histograms
-- (array_agg of latency_hist rows), which is summed bucket by bucket.
create function private.hist_percentile(p_hist integer[], p_fraction double precision) returns integer
  language plpgsql immutable parallel safe
  set search_path = ''
  as $$
declare
  v_bounds integer[] := private.latency_bounds();
  v_n integer := array_length(v_bounds, 1) + 1;
  v_sums bigint[] := array_fill(0::bigint, array[array_length(v_bounds, 1) + 1]);
  v_total bigint := 0;
  v_cum bigint := 0;
  v_val integer;
  i integer := 0;
begin
  if p_hist is null then
    return null;
  end if;
  foreach v_val in array p_hist loop
    i := i + 1;
    v_sums[((i - 1) % v_n) + 1] := v_sums[((i - 1) % v_n) + 1] + coalesce(v_val, 0);
    v_total := v_total + coalesce(v_val, 0);
  end loop;
  if v_total = 0 then
    return null;
  end if;
  for i in 1 .. v_n loop
    v_cum := v_cum + v_sums[i];
    if v_cum >= p_fraction * v_total then
      return v_bounds[least(i, v_n - 1)];
    end if;
  end loop;
  return v_bounds[v_n - 1];
end
$$;

-- AI error-rate classes (BACKOFFICE_PLAN §7.5): errors over calls that reached a provider.
create function private.ai_status_is_error(p_status text) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$ select p_status in ('error', 'timeout', 'refused', 'validation_failed', 'grounding_failed') $$;

create function private.ai_status_is_attempt(p_status text) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$ select p_status not in ('budget_blocked', 'killed', 'cached') $$;

-- The prompt key that serves an AI feature (AI_PIPELINE_PLAN §5.2); NULL for features without a
-- prompt (embeddings, speech, probes).
create function private.prompt_key_for_feature(p_feature public.ai_feature) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case p_feature
      when 'email_triage' then 'email_classification'
      when 'thread_summary' then 'thread_summary'
      when 'email_deep_extract' then 'email_deep_extract'
      when 'commitment_extract' then 'commitment'
      when 'life_intel_extract' then 'life_intel'
      when 'briefing_morning' then 'briefing_morning'
      when 'briefing_midday' then 'briefing_midday'
      when 'briefing_evening' then 'briefing_evening'
      when 'weekly_review' then 'weekly_review'
      when 'meeting_prep' then 'meeting_prep'
      when 'post_meeting_parse' then 'post_meeting'
      when 'capture_extract' then 'capture'
      when 'assistant_intent' then 'assistant_intent'
      when 'assistant_qa' then 'assistant'
      when 'reply_draft' then 'reply_draft'
      when 'follow_up_draft' then 'follow_up'
      else null
    end
  $$;

-- Eval evidence for a primary target (AI_PIPELINE_PLAN §3.4, §16): the ai-eval workflow writes
-- eval_report.targets = [{provider, model, passed}] on the active prompt version. Features without
-- a prompt accept a target that is already one of the row's evaluated fallbacks.
create function private.model_eval_passed(
  p_feature public.ai_feature, p_provider text, p_model text, p_fallbacks jsonb
) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select case
      when private.prompt_key_for_feature(p_feature) is null then
        coalesce(p_fallbacks @> jsonb_build_array(jsonb_build_object('provider', p_provider, 'model', p_model)), false)
      else exists (
        select 1 from public.prompt_versions v
        where v.prompt_key = private.prompt_key_for_feature(p_feature) and v.status = 'active' and v.eval_passed
          and jsonb_typeof(v.eval_report -> 'targets') = 'array'
          and v.eval_report -> 'targets' @> jsonb_build_array(jsonb_build_object('provider', p_provider, 'model', p_model,
                                                                                  'passed', true)))
    end
  $$;

-- {range, group, source, rows:[{key, requests, input/output/cache tokens, cost_usd, error_rate,
-- p50_ms, p95_ms, budget_blocked}], totals}. 24h/7d read raw ai_requests; 30d/90d the rollup.
create function admin_api.ai_metrics(p_range text, p_group text default 'feature') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(array['metrics.ai.read', 'ai.read']);
  w record;
  v_tz text := coalesce(private.app_setting('metrics.reporting_timezone') #>> '{}', 'Europe/Istanbul');
  v_rows jsonb;
begin
  if p_group is null or p_group not in ('feature', 'model', 'provider', 'prompt_version', 'profile', 'day') then
    raise exception 'VALIDATION_FAILED:group' using errcode = '22023';
  end if;
  select * into w from private.metric_window(p_range);
  if p_range in ('24h', '7d') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', x.key, 'requests', x.requests, 'input_tokens', x.input_tokens, 'output_tokens', x.output_tokens,
             'cache_read_tokens', x.cache_read_tokens, 'cache_write_tokens', x.cache_write_tokens,
             'cost_usd', round(x.cost_micros / 1e6, 6), 'error_rate', x.error_rate, 'p50_ms', x.p50, 'p95_ms', x.p95,
             'budget_blocked', x.budget_blocked) order by x.cost_micros desc, x.key), '[]'::jsonb)
    into v_rows
    from (
      select case p_group
               when 'feature' then r.feature::text
               when 'model' then r.model
               when 'provider' then r.provider
               when 'prompt_version' then coalesce(r.prompt_version_id::text, 'none')
               when 'profile' then coalesce(r.profile::text, 'none')
               else to_char((r.created_at at time zone v_tz)::date, 'YYYY-MM-DD')
             end as key,
             count(*) as requests, sum(r.input_tokens) as input_tokens, sum(r.output_tokens) as output_tokens,
             sum(r.cache_read_tokens) as cache_read_tokens, sum(r.cache_write_tokens + r.cache_write_1h_tokens) as cache_write_tokens,
             sum(r.cost_usd_micros) as cost_micros,
             round(count(*) filter (where private.ai_status_is_error(r.status))::numeric
                   / nullif(count(*) filter (where private.ai_status_is_attempt(r.status)), 0), 4) as error_rate,
             percentile_cont(0.5) within group (order by r.latency_ms)::integer as p50,
             percentile_cont(0.95) within group (order by r.latency_ms)::integer as p95,
             count(*) filter (where r.status = 'budget_blocked') as budget_blocked
      from public.ai_requests r
      where r.created_at >= w.start_at and r.created_at < w.end_at
      group by 1) as x;
    return jsonb_build_object('range', p_range, 'group', p_group, 'source', 'raw', 'rows', v_rows);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', x.key, 'requests', x.requests, 'input_tokens', x.input_tokens, 'output_tokens', x.output_tokens,
           'cache_read_tokens', x.cache_read_tokens, 'cache_write_tokens', x.cache_write_tokens,
           'cost_usd', round(x.cost_micros / 1e6, 6), 'error_rate', x.error_rate,
           'p50_ms', private.hist_percentile(x.hists, 0.5), 'p95_ms', private.hist_percentile(x.hists, 0.95),
           'budget_blocked', x.budget_blocked) order by x.cost_micros desc, x.key), '[]'::jsonb)
  into v_rows
  from (
    select case p_group
             when 'feature' then m.feature::text
             when 'model' then m.model
             when 'provider' then m.provider
             when 'prompt_version' then coalesce(m.prompt_version_id::text, 'none')
             when 'profile' then coalesce(m.profile::text, 'none')
             else to_char(m.day, 'YYYY-MM-DD')
           end as key,
           sum(m.requests) as requests, sum(m.input_tokens) as input_tokens, sum(m.output_tokens) as output_tokens,
           sum(m.cache_read_tokens) as cache_read_tokens, sum(m.cache_write_tokens) as cache_write_tokens,
           sum(m.cost_usd_micros) as cost_micros,
           round(sum(m.requests) filter (where private.ai_status_is_error(m.status))::numeric
                 / nullif(sum(m.requests) filter (where private.ai_status_is_attempt(m.status)), 0), 4) as error_rate,
           array_agg(m.latency_hist) filter (where m.latency_hist is not null) as hists,
           coalesce(sum(m.requests) filter (where m.status = 'budget_blocked'), 0) as budget_blocked
    from public.ai_metrics_daily m
    where m.day >= (w.start_at at time zone v_tz)::date and m.day <= (w.end_at at time zone v_tz)::date
    group by 1) as x;
  return jsonb_build_object('range', p_range, 'group', p_group, 'source', 'rollup', 'rows', v_rows);
end
$$;

-- Stacked cost series {points:[{t, key, requests, cost_usd}]}: per hour for 24h, per reporting
-- day otherwise; key = ai_feature or model. No user ids.
create function admin_api.ai_cost_series(p_range text, p_split text default 'feature') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(array['metrics.ai.read', 'ai.read']);
  w record;
  v_tz text := coalesce(private.app_setting('metrics.reporting_timezone') #>> '{}', 'Europe/Istanbul');
  v_points jsonb;
begin
  if p_split is null or p_split not in ('feature', 'model') then
    raise exception 'VALIDATION_FAILED:split' using errcode = '22023';
  end if;
  select * into w from private.metric_window(p_range);
  if p_range in ('24h', '7d') then
    select coalesce(jsonb_agg(jsonb_build_object('t', x.t, 'key', x.key, 'requests', x.requests,
                                                 'cost_usd', round(x.cost / 1e6, 6)) order by x.t, x.key), '[]'::jsonb)
    into v_points
    from (select case when p_range = '24h' then to_char(date_trunc('hour', r.created_at at time zone v_tz), 'YYYY-MM-DD"T"HH24:00')
                      else to_char((r.created_at at time zone v_tz)::date, 'YYYY-MM-DD') end as t,
                 case when p_split = 'feature' then r.feature::text else r.model end as key,
                 count(*) as requests, sum(r.cost_usd_micros) as cost
          from public.ai_requests r
          where r.created_at >= w.start_at and r.created_at < w.end_at
          group by 1, 2) as x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('t', x.t, 'key', x.key, 'requests', x.requests,
                                                 'cost_usd', round(x.cost / 1e6, 6)) order by x.t, x.key), '[]'::jsonb)
    into v_points
    from (select to_char(m.day, 'YYYY-MM-DD') as t,
                 case when p_split = 'feature' then m.feature::text else m.model end as key,
                 sum(m.requests) as requests, sum(m.cost_usd_micros) as cost
          from public.ai_metrics_daily m
          where m.day >= (w.start_at at time zone v_tz)::date and m.day <= (w.end_at at time zone v_tz)::date
          group by 1, 2) as x;
  end if;
  return jsonb_build_object('range', p_range, 'split', p_split, 'bucket', case when p_range = '24h' then 'hour' else 'day' end,
                            'points', v_points);
end
$$;

-- Telemetry rows only (ai_requests holds no content).
create function admin_api.ai_requests_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('ai.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"r.created_at","latency_ms":"r.latency_ms","cost":"r.cost_usd_micros","model":"r.model"}',
                                      'r.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select r.*, count(*) over () as total from public.ai_requests r
      where ($1 ->> 'feature' is null or r.feature::text = $1 ->> 'feature')
        and ($1 ->> 'model' is null or r.model = $1 ->> 'model')
        and ($1 ->> 'provider' is null or r.provider = $1 ->> 'provider')
        and ($1 ->> 'status' is null or r.status = $1 ->> 'status')
        and ($1 ->> 'user_id' is null or r.user_id::text = $1 ->> 'user_id')
        and ($1 ->> 'correlation_id' is null or r.correlation_id::text = $1 ->> 'correlation_id')
        and ($1 ->> 'from' is null or r.created_at >= ($1 ->> 'from')::timestamptz)
        and ($1 ->> 'to' is null or r.created_at < ($1 ->> 'to')::timestamptz)
      order by %1$s, r.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'created_at', r.created_at, 'user_id', r.user_id, 'plan', r.plan, 'profile', r.profile,
             'feature', r.feature, 'tier', r.tier, 'provider', r.provider, 'model', r.model,
             'prompt_version_id', r.prompt_version_id, 'operation', r.operation, 'batch', r.batch, 'status', r.status,
             'error_code', r.error_code, 'http_status', r.http_status, 'input_tokens', r.input_tokens,
             'output_tokens', r.output_tokens, 'cache_read_tokens', r.cache_read_tokens,
             'cache_write_tokens', r.cache_write_tokens + r.cache_write_1h_tokens, 'latency_ms', r.latency_ms,
             'ttft_ms', r.ttft_ms, 'retry_count', r.retry_count, 'fallback_used', r.fallback_used,
             'cost_usd', round(r.cost_usd_micros / 1e6, 6), 'citation_coverage', r.citation_coverage,
             'injection_suspected', r.injection_suspected, 'correlation_id', r.correlation_id, 'job_id', r.job_id)
           order by %1$s, r.id), '[]'::jsonb), 'total', coalesce(max(r.total), 0))
    from f as r
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- Every route row, the per-plan profile and the latest AI provider probe state (never secrets).
create function admin_api.ai_model_config_list() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai.read');
begin
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', c.id, 'profile', c.profile, 'role', c.role, 'feature', c.feature, 'tier', c.tier,
                        'enabled', c.enabled,
                        'primary_target', jsonb_build_object('provider', c.provider, 'model', c.model) || c.params,
                        'fallback_targets', c.fallback_targets, 'escalation_target', c.escalation_target,
                        'batch_policy', c.batch_policy, 'cache_ttl', c.cache_ttl, 'max_input_tokens', c.max_input_tokens,
                        'eval_status', c.eval_status, 'retires_not_before', c.retires_not_before, 'version', c.version,
                        'updated_by', c.updated_by, 'updated_at', c.updated_at)
                      order by c.profile, c.role, c.feature)
                      from public.ai_model_config c), '[]'::jsonb),
    'routing_profiles', coalesce((select jsonb_object_agg(l.plan, l.value #>> '{}')
                                  from public.plan_limits l where l.key = 'ai_routing_profile'), '{}'::jsonb),
    'provider_health', coalesce((select jsonb_object_agg(h.component, jsonb_build_object('status', h.status, 'checked_at', h.checked_at))
                                 from (select distinct on (s.component) s.component, s.status, s.checked_at
                                       from public.system_health_checks s
                                       where s.component in ('ai_anthropic', 'ai_openai', 'ai_voyage')
                                       order by s.component, s.checked_at desc) as h), '{}'::jsonb));
end
$$;

create function admin_api.ai_model_prices_list() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai.read');
begin
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'provider', p.provider, 'model', p.model, 'input_per_mtok_usd', p.input_per_mtok_usd,
             'output_per_mtok_usd', p.output_per_mtok_usd, 'cache_write_5m_per_mtok_usd', p.cache_write_5m_per_mtok_usd,
             'cache_write_1h_per_mtok_usd', p.cache_write_1h_per_mtok_usd, 'cache_read_per_mtok_usd', p.cache_read_per_mtok_usd,
             'batch_discount', p.batch_discount, 'audio_per_min_usd', p.audio_per_min_usd,
             'chars_per_million_usd', p.chars_per_million_usd, 'effective_from', p.effective_from,
             'current', p.effective_from = (select max(q.effective_from) from public.ai_model_prices q
                                            where q.provider = p.provider and q.model = p.model and q.effective_from <= now()),
             'updated_by', p.updated_by, 'created_at', p.created_at)
           order by p.provider, p.model, p.effective_from desc)
    from public.ai_model_prices p), '[]'::jsonb));
end
$$;

-- Route update with optimistic concurrency (p_expected_version), the Covered-Model check (table
-- constraint) and the eval gate for a new primary (private.model_eval_passed). The model
-- catalogue (capabilities, 1024-d embeddings, fixture outside production, configured provider)
-- is validated by admin-api before this call.
create function admin_api.ai_model_config_update(
  p_profile public.routing_profile, p_role text, p_feature public.ai_feature, p_provider text, p_model text,
  p_params jsonb, p_fallback_targets jsonb, p_escalation_target jsonb, p_enabled boolean, p_expected_version integer,
  p_reason text, p_batch_policy text default null, p_cache_ttl text default null, p_max_input_tokens integer default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai.models.write');
  v_reason text := private.admin_require_reason(p_reason);
  c public.ai_model_config;
  v_before jsonb;
  v_new_primary boolean;
  v_fallbacks jsonb;
begin
  select * into c from public.ai_model_config x
  where x.profile = p_profile and x.feature = p_feature and (p_role is null or x.role = p_role)
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_expected_version is null or c.version <> p_expected_version then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'version';
  end if;
  if (p_provider is null) <> (p_model is null) then
    raise exception 'VALIDATION_FAILED:primary_target' using errcode = '22023';
  end if;
  if p_params is not null and jsonb_typeof(p_params) <> 'object' then
    raise exception 'VALIDATION_FAILED:params' using errcode = '22023';
  end if;
  if p_model is not null and not private.model_routable(p_model) then
    raise exception 'VALIDATION_FAILED:covered_model' using errcode = '22023';
  end if;
  v_fallbacks := coalesce(p_fallback_targets, c.fallback_targets);
  v_new_primary := p_provider is not null and (p_provider, p_model) is distinct from (c.provider, c.model);
  if v_new_primary and not private.model_eval_passed(c.feature, p_provider, p_model, c.fallback_targets) then
    raise exception 'EVAL_REQUIRED' using errcode = '55000';
  end if;
  v_before := jsonb_build_object('provider', c.provider, 'model', c.model, 'params', c.params,
                                 'fallback_targets', c.fallback_targets, 'escalation_target', c.escalation_target,
                                 'enabled', c.enabled, 'batch_policy', c.batch_policy, 'cache_ttl', c.cache_ttl,
                                 'max_input_tokens', c.max_input_tokens, 'eval_status', c.eval_status, 'version', c.version);
  update public.ai_model_config x
    set provider = coalesce(p_provider, x.provider),
        model = coalesce(p_model, x.model),
        params = coalesce(p_params, x.params),
        fallback_targets = v_fallbacks,
        escalation_target = case when p_escalation_target is null then x.escalation_target
                                 when jsonb_typeof(p_escalation_target) = 'null' then null
                                 else p_escalation_target end,
        enabled = coalesce(p_enabled, x.enabled),
        batch_policy = coalesce(p_batch_policy, x.batch_policy),
        cache_ttl = coalesce(p_cache_ttl, x.cache_ttl),
        max_input_tokens = coalesce(p_max_input_tokens, x.max_input_tokens),
        eval_status = case when v_new_primary then 'passed' else x.eval_status end,
        updated_by = v_admin.user_id
  where x.id = c.id
  returning * into c;
  perform private.admin_audit(v_admin, 'ai.model_config_updated', 'ai_model_config', c.id::text, null, v_reason,
                              jsonb_build_object('profile', c.profile, 'feature', c.feature, 'before', v_before,
                                                 'after', jsonb_build_object(
                                                   'provider', c.provider, 'model', c.model, 'params', c.params,
                                                   'fallback_targets', c.fallback_targets,
                                                   'escalation_target', c.escalation_target, 'enabled', c.enabled,
                                                   'batch_policy', c.batch_policy, 'cache_ttl', c.cache_ttl,
                                                   'max_input_tokens', c.max_input_tokens, 'eval_status', c.eval_status,
                                                   'version', c.version)));
  return jsonb_build_object('id', c.id, 'profile', c.profile, 'feature', c.feature, 'version', c.version,
                            'primary_target', jsonb_build_object('provider', c.provider, 'model', c.model) || c.params,
                            'eval_status', c.eval_status, 'enabled', c.enabled);
end
$$;

-- Per-plan routing profile (plan_limits.ai_routing_profile); effective on the next route resolution.
create function admin_api.plan_routing_profile_set(p_plan text, p_profile public.routing_profile, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai.models.write');
  v_reason text := private.admin_require_reason(p_reason);
  v_before jsonb;
begin
  if p_plan is null or p_plan not in ('free', 'pro') or p_profile is null then
    raise exception 'VALIDATION_FAILED:plan' using errcode = '22023';
  end if;
  select l.value into v_before from public.plan_limits l where l.plan = p_plan and l.key = 'ai_routing_profile' for update;
  update public.plan_limits l set value = to_jsonb(p_profile::text), updated_by = v_admin.user_id
  where l.plan = p_plan and l.key = 'ai_routing_profile';
  perform private.admin_audit(v_admin, 'ai.routing_profile_changed', 'plan_limit', p_plan || ':ai_routing_profile', null, v_reason,
                              jsonb_build_object('plan', p_plan, 'before', v_before, 'after', to_jsonb(p_profile::text)));
  return jsonb_build_object('plan', p_plan, 'profile', p_profile);
end
$$;

-- Appends a price row (the book is versioned by effective_from; rows are never edited).
create function admin_api.ai_model_prices_upsert(
  p_provider text, p_model text, p_prices jsonb, p_effective_from timestamptz, p_reason text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai.models.write');
  v_reason text := private.admin_require_reason(p_reason);
  p public.ai_model_prices;
begin
  if p_provider is null or p_model is null or char_length(p_model) > 120 or p_prices is null or jsonb_typeof(p_prices) <> 'object'
     or jsonb_typeof(p_prices -> 'input_per_mtok_usd') <> 'number' or jsonb_typeof(p_prices -> 'output_per_mtok_usd') <> 'number'
     or not private.model_routable(p_model) then
    raise exception 'VALIDATION_FAILED:prices' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_prices) e where jsonb_typeof(e.value) = 'number' and (e.value)::text::numeric < 0) then
    raise exception 'VALIDATION_FAILED:prices' using errcode = '22023';
  end if;
  insert into public.ai_model_prices (provider, model, input_per_mtok_usd, output_per_mtok_usd, cache_write_5m_per_mtok_usd,
                                      cache_write_1h_per_mtok_usd, cache_read_per_mtok_usd, batch_discount,
                                      audio_per_min_usd, chars_per_million_usd, effective_from, updated_by)
  values (p_provider, p_model, (p_prices ->> 'input_per_mtok_usd')::numeric, (p_prices ->> 'output_per_mtok_usd')::numeric,
          (p_prices ->> 'cache_write_5m_per_mtok_usd')::numeric, (p_prices ->> 'cache_write_1h_per_mtok_usd')::numeric,
          (p_prices ->> 'cache_read_per_mtok_usd')::numeric, coalesce((p_prices ->> 'batch_discount')::numeric, 0.5),
          (p_prices ->> 'audio_per_min_usd')::numeric, (p_prices ->> 'chars_per_million_usd')::numeric,
          coalesce(p_effective_from, now()), v_admin.user_id)
  on conflict (provider, model, effective_from) do nothing
  returning * into p;
  if p.id is null then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'effective_from';
  end if;
  perform private.admin_audit(v_admin, 'ai.prices_updated', 'ai_model_price', p.id::text, null, v_reason,
                              jsonb_build_object('provider', p.provider, 'model', p.model, 'effective_from', p.effective_from,
                                                 'prices', p_prices));
  return jsonb_build_object('id', p.id, 'provider', p.provider, 'model', p.model, 'effective_from', p.effective_from);
end
$$;

-- Activates a calibration version (ece ≤ 0.05); the previous active one for the field is archived.
create function admin_api.ai_calibration_activate(p_id uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai.models.write');
  v_reason text := private.admin_require_reason(p_reason);
  c public.ai_calibration_versions;
  v_previous uuid;
begin
  select * into c from public.ai_calibration_versions x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if c.status = 'active' then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  if c.ece is null or c.ece > 0.05 then
    raise exception 'EVAL_REQUIRED' using errcode = '55000', detail = 'ece';
  end if;
  update public.ai_calibration_versions x set status = 'archived'
  where x.feature = c.feature and x.field = c.field and x.status = 'active'
  returning x.id into v_previous;
  update public.ai_calibration_versions x set status = 'active', activated_by = v_admin.user_id, activated_at = now()
  where x.id = c.id;
  perform private.admin_audit(v_admin, 'ai.calibration_activated', 'ai_calibration_version', c.id::text, null, v_reason,
                              jsonb_build_object('feature', c.feature, 'field', c.field, 'version', c.version,
                                                 'previous_id', v_previous));
  return jsonb_build_object('id', c.id, 'status', 'active', 'previous_id', v_previous);
end
$$;

-- ═══ ADM-09 · prompt management ═══════════════════════════════════════════════════════════════

create function admin_api.prompts_list() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.read');
begin
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'prompt_key', k.prompt_key,
             'active_version', (select v.version from public.prompt_versions v where v.prompt_key = k.prompt_key and v.status = 'active'),
             'active_version_id', (select v.id from public.prompt_versions v where v.prompt_key = k.prompt_key and v.status = 'active'),
             'versions', (select count(*) from public.prompt_versions v where v.prompt_key = k.prompt_key),
             'drafts', (select count(*) from public.prompt_versions v where v.prompt_key = k.prompt_key and v.status = 'draft'),
             'last_change_at', (select max(greatest(v.created_at, coalesce(v.activated_at, v.created_at), coalesce(v.archived_at, v.created_at)))
                                from public.prompt_versions v where v.prompt_key = k.prompt_key),
             'telemetry_7d', (select jsonb_build_object(
                                'requests', count(*),
                                'error_rate', round(count(*) filter (where private.ai_status_is_error(r.status))::numeric
                                                    / nullif(count(*) filter (where private.ai_status_is_attempt(r.status)), 0), 4),
                                'schema_invalid_rate', round(count(*) filter (where r.status = 'validation_failed')::numeric
                                                             / nullif(count(*) filter (where private.ai_status_is_attempt(r.status)), 0), 4))
                              from public.ai_requests r join public.prompt_versions v on v.id = r.prompt_version_id
                              where v.prompt_key = k.prompt_key and r.created_at > now() - interval '7 days'),
             'feedback_7d', (select jsonb_build_object('positive', count(*) filter (where f.rating = 1),
                                                       'negative', count(*) filter (where f.rating = -1))
                             from public.ai_feedback f join public.prompt_versions v on v.id = f.prompt_version_id
                             where v.prompt_key = k.prompt_key and f.created_at > now() - interval '7 days'))
           order by k.prompt_key)
    from unnest(array['email_classification', 'thread_summary', 'email_deep_extract', 'commitment', 'post_meeting', 'follow_up',
                      'life_intel', 'briefing_morning', 'briefing_midday', 'briefing_evening', 'weekly_review', 'meeting_prep',
                      'capture', 'capture_vision', 'capture_pdf', 'assistant_intent', 'assistant', 'reply_draft']) as k (prompt_key)),
    '[]'::jsonb));
end
$$;

-- Versions of one key with per-version telemetry over p_range (default 30d).
create function admin_api.prompt_versions_list(p_key text, p_range text default '30d') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.read');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return jsonb_build_object('prompt_key', p_key, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'version', v.version, 'status', v.status, 'created_by', v.created_by, 'created_at', v.created_at,
             'activated_by', v.activated_by, 'activated_at', v.activated_at, 'archived_at', v.archived_at,
             'eval_passed', v.eval_passed, 'eval_dataset_version', v.eval_dataset_version, 'notes', v.notes,
             'changelog', v.changelog,
             'telemetry', (select jsonb_build_object(
                                 'requests', count(*),
                                 'error_rate', round(count(*) filter (where private.ai_status_is_error(r.status))::numeric
                                                     / nullif(count(*) filter (where private.ai_status_is_attempt(r.status)), 0), 4),
                                 'schema_invalid_rate', round(count(*) filter (where r.status = 'validation_failed')::numeric
                                                              / nullif(count(*) filter (where private.ai_status_is_attempt(r.status)), 0), 4),
                                 'grounding_rejected_rate', round(count(*) filter (where r.status = 'grounding_failed')::numeric
                                                                  / nullif(count(*) filter (where private.ai_status_is_attempt(r.status)), 0), 4),
                                 'p95_ms', percentile_cont(0.95) within group (order by r.latency_ms)::integer,
                                 'cost_usd', round(coalesce(sum(r.cost_usd_micros), 0) / 1e6, 6))
                           from public.ai_requests r
                           where r.prompt_version_id = v.id and r.created_at >= w.start_at and r.created_at < w.end_at),
             'feedback', (select jsonb_build_object('positive', count(*) filter (where f.rating = 1),
                                                    'negative', count(*) filter (where f.rating = -1),
                                                    'positive_rate', round(count(*) filter (where f.rating = 1)::numeric / nullif(count(*), 0), 4))
                          from public.ai_feedback f
                          where f.prompt_version_id = v.id and f.created_at >= w.start_at and f.created_at < w.end_at))
           order by v.version desc)
    from public.prompt_versions v where v.prompt_key = p_key), '[]'::jsonb));
end
$$;

create function admin_api.prompt_version_get(p_key text, p_version integer) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.read');
  v public.prompt_versions;
begin
  select * into v from public.prompt_versions x where x.prompt_key = p_key and x.version = p_version;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v.id, 'prompt_key', v.prompt_key, 'version', v.version, 'status', v.status,
                            'system_prompt', v.system_prompt, 'user_template', v.user_template,
                            'output_schema_ref', v.output_schema_ref, 'schema_hash', v.schema_hash, 'model_role', v.model_role,
                            'model_constraints', v.model_constraints, 'eval_dataset_version', v.eval_dataset_version,
                            'eval_report', v.eval_report, 'eval_passed', v.eval_passed, 'notes', v.notes,
                            'changelog', v.changelog, 'created_by', v.created_by, 'created_at', v.created_at,
                            'activated_by', v.activated_by, 'activated_at', v.activated_at, 'archived_at', v.archived_at);
end
$$;

-- Both texts of two versions; the unified diff is rendered by the backoffice.
create function admin_api.prompt_diff(p_a uuid, p_b uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.read');
  a public.prompt_versions;
  b public.prompt_versions;
begin
  select * into a from public.prompt_versions x where x.id = p_a;
  select * into b from public.prompt_versions x where x.id = p_b;
  if a.id is null or b.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.prompt_key <> b.prompt_key then
    raise exception 'VALIDATION_FAILED:prompt_key' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'prompt_key', a.prompt_key,
    'from', jsonb_build_object('id', a.id, 'version', a.version, 'system_prompt', a.system_prompt,
                               'user_template', a.user_template, 'output_schema_ref', a.output_schema_ref),
    'to', jsonb_build_object('id', b.id, 'version', b.version, 'system_prompt', b.system_prompt,
                             'user_template', b.user_template, 'output_schema_ref', b.output_schema_ref));
end
$$;

-- New draft = copy of p_from_version (default: the active one) with overrides; version = max + 1.
create function admin_api.prompt_create_draft(
  p_key text, p_from_version integer default null, p_system_prompt text default null, p_user_template text default null,
  p_output_schema_ref text default null, p_notes text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.write');
  src public.prompt_versions;
  v public.prompt_versions;
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('prompt_versions:' || coalesce(p_key, '')));
  if p_from_version is not null then
    select * into src from public.prompt_versions x where x.prompt_key = p_key and x.version = p_from_version;
  else
    select * into src from public.prompt_versions x where x.prompt_key = p_key and x.status = 'active';
  end if;
  if src.id is null and (p_system_prompt is null or p_user_template is null or p_output_schema_ref is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(max(x.version), 0) + 1 into v_next from public.prompt_versions x where x.prompt_key = p_key;
  insert into public.prompt_versions (prompt_key, version, status, system_prompt, user_template, output_schema_ref,
                                      schema_hash, model_role, model_constraints, notes, created_by)
  values (p_key, v_next, 'draft', coalesce(p_system_prompt, src.system_prompt), coalesce(p_user_template, src.user_template),
          coalesce(p_output_schema_ref, src.output_schema_ref),
          case when p_output_schema_ref is null or p_output_schema_ref = src.output_schema_ref then src.schema_hash
               else encode(pg_catalog.sha256(convert_to(p_output_schema_ref, 'UTF8')), 'hex') end,
          coalesce(src.model_role, 'reasoning'), coalesce(src.model_constraints, '{}'::jsonb), p_notes, v_admin.user_id)
  returning * into v;
  perform private.admin_audit(v_admin, 'prompt.draft_created', 'prompt_version', v.id::text, null, 'prompt draft created',
                              jsonb_build_object('prompt_key', v.prompt_key, 'version', v.version,
                                                 'from_version', src.version));
  return jsonb_build_object('id', v.id, 'prompt_key', v.prompt_key, 'version', v.version, 'status', v.status);
end
$$;

-- Edits a draft (the guard trigger blocks every other status); p_expected_created_at is not
-- needed because drafts are single-author and the version row is locked.
create function admin_api.prompt_update_draft(
  p_key text, p_version integer, p_system_prompt text default null, p_user_template text default null,
  p_output_schema_ref text default null, p_notes text default null, p_changelog text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.write');
  v public.prompt_versions;
begin
  select * into v from public.prompt_versions x where x.prompt_key = p_key and x.version = p_version for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' then
    raise exception 'PROMPT_VERSION_IMMUTABLE' using errcode = '55000';
  end if;
  update public.prompt_versions x
    set system_prompt = coalesce(p_system_prompt, x.system_prompt),
        user_template = coalesce(p_user_template, x.user_template),
        output_schema_ref = coalesce(p_output_schema_ref, x.output_schema_ref),
        schema_hash = case when p_output_schema_ref is null or p_output_schema_ref = x.output_schema_ref then x.schema_hash
                           else encode(pg_catalog.sha256(convert_to(p_output_schema_ref, 'UTF8')), 'hex') end,
        notes = coalesce(p_notes, x.notes),
        changelog = coalesce(p_changelog, x.changelog),
        eval_passed = false,
        eval_report = null
  where x.id = v.id
  returning * into v;
  perform private.admin_audit(v_admin, 'prompt.draft_edited', 'prompt_version', v.id::text, null, 'prompt draft edited',
                              jsonb_build_object('prompt_key', v.prompt_key, 'version', v.version));
  return jsonb_build_object('id', v.id, 'prompt_key', v.prompt_key, 'version', v.version, 'status', v.status);
end
$$;

-- Activation in one transaction: the current active version is archived, the target activated
-- (eval gate in trg_prompt_versions_guard; one active per key by the partial unique index).
create function admin_api.prompt_activate(p_version uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.activate');
  v_reason text := private.admin_require_reason(p_reason);
  v public.prompt_versions;
  v_previous public.prompt_versions;
begin
  select * into v from public.prompt_versions x where x.id = p_version;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('prompt_versions:' || v.prompt_key));
  select * into v from public.prompt_versions x where x.id = p_version for update;
  if v.status <> 'draft' then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = v.status::text;
  end if;
  if not v.eval_passed then
    raise exception 'EVAL_REQUIRED' using errcode = '55000';
  end if;
  update public.prompt_versions x set status = 'archived', archived_at = now()
  where x.prompt_key = v.prompt_key and x.status = 'active'
  returning * into v_previous;
  update public.prompt_versions x set status = 'active', activated_by = v_admin.user_id, activated_at = now(), archived_at = null
  where x.id = v.id
  returning * into v;
  perform private.admin_audit(v_admin, 'prompt.activated', 'prompt_version', v.id::text, null, v_reason,
                              jsonb_build_object('prompt_key', v.prompt_key, 'version', v.version,
                                                 'previous_version', v_previous.version));
  return jsonb_build_object('id', v.id, 'prompt_key', v.prompt_key, 'version', v.version, 'status', v.status,
                            'previous_version', v_previous.version);
end
$$;

-- Re-activates an archived version of p_key.
create function admin_api.prompt_rollback(p_key text, p_version integer, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.activate');
  v_reason text := private.admin_require_reason(p_reason);
  v public.prompt_versions;
  v_previous public.prompt_versions;
begin
  perform pg_advisory_xact_lock(hashtext('prompt_versions:' || coalesce(p_key, '')));
  select * into v from public.prompt_versions x where x.prompt_key = p_key and x.version = p_version for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status <> 'archived' or v.activated_at is null then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = v.status::text;
  end if;
  update public.prompt_versions x set status = 'archived', archived_at = now()
  where x.prompt_key = p_key and x.status = 'active'
  returning * into v_previous;
  update public.prompt_versions x set status = 'active', activated_by = v_admin.user_id, activated_at = now(), archived_at = null
  where x.id = v.id
  returning * into v;
  perform private.admin_audit(v_admin, 'prompt.rolled_back', 'prompt_version', v.id::text, null, v_reason,
                              jsonb_build_object('prompt_key', v.prompt_key, 'version', v.version,
                                                 'rolled_back_from', v_previous.version));
  return jsonb_build_object('id', v.id, 'prompt_key', v.prompt_key, 'version', v.version, 'status', v.status,
                            'rolled_back_from', v_previous.version);
end
$$;

-- Archives a draft or a non-active version; the active version is never archived directly.
create function admin_api.prompt_archive(p_version uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.activate');
  v_reason text := private.admin_require_reason(p_reason);
  v public.prompt_versions;
begin
  select * into v from public.prompt_versions x where x.id = p_version for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = v.status::text;
  end if;
  update public.prompt_versions x set status = 'archived', archived_at = now() where x.id = v.id;
  perform private.admin_audit(v_admin, 'prompt.archived', 'prompt_version', v.id::text, null, v_reason,
                              jsonb_build_object('prompt_key', v.prompt_key, 'version', v.version));
  return jsonb_build_object('id', v.id, 'status', 'archived');
end
$$;

-- ═══ ADM-10 · AI feedback (comments hidden unless revealed) ═══════════════════════════════════

create function admin_api.ai_feedback_aggregate(p_range text, p_group text default 'feature') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai_feedback.read');
  w record;
begin
  if p_group is null or p_group not in ('feature', 'model', 'prompt_version') then
    raise exception 'VALIDATION_FAILED:group' using errcode = '22023';
  end if;
  select * into w from private.metric_window(p_range);
  return jsonb_build_object(
    'range', p_range, 'group', p_group,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('key', x.key, 'positive', x.pos, 'negative', x.neg,
                                                          'rate', round(x.pos::numeric / nullif(x.pos + x.neg, 0), 4))
                                       order by x.pos + x.neg desc, x.key)
                      from (select case p_group when 'feature' then f.feature::text
                                                when 'model' then coalesce(f.model, 'unknown')
                                                else coalesce(f.prompt_version_id::text, 'none') end as key,
                                   count(*) filter (where f.rating = 1) as pos, count(*) filter (where f.rating = -1) as neg
                            from public.ai_feedback f
                            where f.created_at >= w.start_at and f.created_at < w.end_at
                            group by 1) as x), '[]'::jsonb),
    'top_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason_code', x.reason_code, 'count', x.n) order by x.n desc, x.reason_code)
                             from (select f.reason_code, count(*) as n from public.ai_feedback f
                                   where f.created_at >= w.start_at and f.created_at < w.end_at and f.reason_code is not null
                                   group by 1 order by 2 desc limit 10) as x), '[]'::jsonb));
end
$$;

create function admin_api.ai_feedback_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('ai_feedback.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"f.created_at","rating":"f.rating","feature":"f.feature::text"}',
                                      'f.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with q as (
      select f.*, count(*) over () as total from public.ai_feedback f
      where ($1 ->> 'feature' is null or f.feature::text = $1 ->> 'feature')
        and ($1 ->> 'model' is null or f.model = $1 ->> 'model')
        and ($1 ->> 'prompt_version_id' is null or f.prompt_version_id::text = $1 ->> 'prompt_version_id')
        and ($1 ->> 'rating' is null or f.rating::text = $1 ->> 'rating')
        and ($1 ->> 'reason_code' is null or f.reason_code = $1 ->> 'reason_code')
        and ($1 ->> 'from' is null or f.created_at >= ($1 ->> 'from')::timestamptz)
        and ($1 ->> 'to' is null or f.created_at < ($1 ->> 'to')::timestamptz)
      order by %1$s, f.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', f.id, 'feature', f.feature, 'model', f.model, 'prompt_version_id', f.prompt_version_id,
             'prompt_version', (select v.version from public.prompt_versions v where v.id = f.prompt_version_id),
             'target_type', f.target_type, 'rating', f.rating, 'reason_code', f.reason_code,
             'has_comment', f.comment is not null, 'created_at', f.created_at)
           order by %1$s, f.id), '[]'::jsonb), 'total', coalesce(max(f.total), 0))
    from q as f
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

create function admin_api.ai_feedback_reveal_comment(p_id uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('ai_feedback.reveal');
  v_reason text := private.admin_require_reason(p_reason);
  f public.ai_feedback;
begin
  select * into f from public.ai_feedback x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.admin_audit(v_admin, 'pii.reveal', 'ai_feedback', f.id::text, f.user_id, v_reason,
                              jsonb_build_object('field', 'comment', 'resource_type', 'ai_feedback'));
  return jsonb_build_object('value', f.comment, 'expires_in_s', 60);
end
$$;

-- ═══ ADM-11 · subscriptions, billing events and grants (store and grants reported separately) ═

-- RevenueCat event fields from a stored payload (the event object, subscriber_attributes stripped).
create function private.billing_event_field(p_payload jsonb, p_field text) returns jsonb
  language sql immutable parallel safe
  set search_path = ''
  as $$ select coalesce(p_payload -> 'event', p_payload) -> p_field $$;

create function private.ms_to_timestamptz(p_value jsonb) returns timestamptz
  language sql immutable parallel safe
  set search_path = ''
  as $$ select case when jsonb_typeof(p_value) = 'number' then to_timestamp((p_value::text)::numeric / 1000.0) end $$;

-- {active_pro, store_pro, grant_pro, both, trials, cancelled, expired, refunded, billing_issue,
-- by_store, by_product, renewal_rate[, mrr_usd, arr_estimate_usd, renewing_mrr_usd]}. Revenue
-- fields need metrics.revenue.read and come from app_settings pricing.estimates
-- ({product_id: {price_usd, period_months}}); gross, production, non-internal, grants excluded.
create function admin_api.subscriptions_metrics(p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(array['subscriptions.read', 'metrics.revenue.read']);
  w record;
  v_prices jsonb := coalesce(private.app_setting('pricing.estimates'), '{}'::jsonb);
  v_result jsonb;
  v_mrr numeric;
  v_renewing numeric;
  v_renewals bigint;
  v_expirations bigint;
begin
  select * into w from private.metric_window(p_range);
  with pop as (select m.user_id from private.metric_population() m),
  store as (
    select s.* from public.subscriptions s
    where s.user_id in (select pop.user_id from pop) and s.is_active and coalesce(s.environment, 'production') = 'production'),
  grants as (
    select distinct g.user_id from public.entitlement_grants g
    where g.user_id in (select pop.user_id from pop) and g.revoked_at is null and g.starts_at <= now() and g.ends_at > now())
  select jsonb_build_object(
    'store_pro', (select count(*) from store),
    'grant_pro', (select count(*) from grants where grants.user_id not in (select store.user_id from store)),
    'both', (select count(*) from grants where grants.user_id in (select store.user_id from store)),
    'active_pro', (select count(*) from (select store.user_id from store union select grants.user_id from grants) as u),
    'trials', (select count(*) from store where store.period_type = 'trial'),
    'cancelled', (select count(*) from store where not store.will_renew and store.unsubscribe_detected_at is not null),
    'billing_issue', (select count(*) from store where store.billing_issue_at is not null),
    'by_store', coalesce((select jsonb_object_agg(x.store, x.n) from (select coalesce(store.store, 'unknown') as store, count(*) as n
                                                                      from store group by 1) as x), '{}'::jsonb),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'store', x.store, 'active', x.n,
                                                                'trial', x.trials, 'will_renew', x.renewing)
                                             order by x.n desc)
                            from (select store.product_id, store.store, count(*) as n,
                                         count(*) filter (where store.period_type = 'trial') as trials,
                                         count(*) filter (where store.will_renew) as renewing
                                  from store group by 1, 2) as x), '[]'::jsonb))
  into v_result;
  select count(distinct b.user_id) filter (where b.event_type = 'EXPIRATION'),
         count(*) filter (where b.event_type = 'RENEWAL')
  into v_expirations, v_renewals
  from public.billing_events b
  where b.event_timestamp >= w.start_at and b.event_timestamp < w.end_at and coalesce(b.environment, 'PRODUCTION') = 'PRODUCTION';
  v_result := v_result || jsonb_build_object(
    'range', p_range,
    'expired', v_expirations,
    'refunded', (select greatest(count(*) filter (where b.event_type = 'CANCELLATION'
                                                   and private.billing_event_field(b.payload, 'cancel_reason') #>> '{}' = 'CUSTOMER_SUPPORT')
                                 - count(*) filter (where b.event_type = 'REFUND_REVERSED'), 0)
                 from public.billing_events b
                 where b.event_timestamp >= w.start_at and b.event_timestamp < w.end_at
                   and coalesce(b.environment, 'PRODUCTION') = 'PRODUCTION'),
    'renewal_rate', round(v_renewals::numeric / nullif(v_renewals + v_expirations, 0), 4),
    'webhook_backlog', (select count(*) from public.billing_events b where b.process_status = 'received'),
    'webhook_lag_p95_s', (select round(extract(epoch from percentile_cont(0.95) within group (order by b.processed_at - b.received_at))::numeric, 1)
                          from public.billing_events b
                          where b.processed_at is not null and b.received_at >= w.start_at and b.received_at < w.end_at));
  if private.admin_can(v_admin, 'metrics.revenue.read') then
    select coalesce(sum((v_prices -> s.product_id ->> 'price_usd')::numeric
                        / greatest(coalesce((v_prices -> s.product_id ->> 'period_months')::numeric, 1), 1)), 0),
           coalesce(sum((v_prices -> s.product_id ->> 'price_usd')::numeric
                        / greatest(coalesce((v_prices -> s.product_id ->> 'period_months')::numeric, 1), 1))
                    filter (where s.will_renew), 0)
    into v_mrr, v_renewing
    from public.subscriptions s
    where s.user_id in (select m.user_id from private.metric_population() m)
      and s.is_active and coalesce(s.environment, 'production') = 'production' and s.period_type = 'normal'
      and jsonb_typeof(v_prices -> s.product_id -> 'price_usd') = 'number';
    v_result := v_result || jsonb_build_object('mrr_usd', round(v_mrr, 2), 'arr_estimate_usd', round(v_mrr * 12, 2),
                                               'renewing_mrr_usd', round(v_renewing, 2),
                                               'revenue_basis', 'gross_estimate_from_pricing_estimates');
  end if;
  return v_result;
end
$$;

create function admin_api.subscriptions_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('subscriptions.read');
  v_order text := private.admin_order(p_sort, '{"expires_at":"s.expires_at","updated_at":"s.updated_at","status":"s.status::text"}',
                                      's.updated_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select s.*, count(*) over () as total from public.subscriptions s
      where ($1 ->> 'status' is null or s.status::text = $1 ->> 'status')
        and ($1 ->> 'store' is null or s.store = $1 ->> 'store')
        and ($1 ->> 'product_id' is null or s.product_id = $1 ->> 'product_id')
        and ($1 ->> 'environment' is null or s.environment = lower($1 ->> 'environment'))
        and ($1 ->> 'user_id' is null or s.user_id::text = $1 ->> 'user_id')
      order by %1$s, s.user_id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'user_id', s.user_id, 'email_masked', private.admin_user_label(s.user_id) ->> 'email_masked',
             'status', s.status, 'is_active', s.is_active, 'store', s.store, 'product_id', s.product_id,
             'period_type', s.period_type, 'expires_at', s.expires_at, 'will_renew', s.will_renew,
             'environment', s.environment, 'synced_at', s.synced_at, 'source', 'store')
           order by %1$s, s.user_id), '[]'::jsonb), 'total', coalesce(max(s.total), 0))
    from f as s
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

create function admin_api.billing_events_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('billing_events.read');
  v_order text := private.admin_order(p_sort, '{"event_at":"b.event_timestamp","received_at":"b.received_at","type":"b.event_type"}',
                                      'b.event_timestamp desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select b.id, b.event_id, b.user_id, b.event_type, b.environment, b.store, b.product_id, b.event_timestamp,
             b.process_status, b.processed_at, b.received_at, count(*) over () as total
      from public.billing_events b
      where ($1 ->> 'type' is null or b.event_type = $1 ->> 'type')
        and ($1 ->> 'user_id' is null or b.user_id::text = $1 ->> 'user_id')
        and ($1 ->> 'environment' is null or b.environment = upper($1 ->> 'environment'))
        and ($1 ->> 'process_status' is null or b.process_status = $1 ->> 'process_status')
        and ($1 ->> 'from' is null or b.event_timestamp >= ($1 ->> 'from')::timestamptz)
        and ($1 ->> 'to' is null or b.event_timestamp < ($1 ->> 'to')::timestamptz)
      order by %1$s, b.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'event_id', b.event_id, 'type', b.event_type, 'environment', b.environment, 'store', b.store,
             'product_id', b.product_id, 'user_id', b.user_id, 'event_at', b.event_timestamp, 'received_at', b.received_at,
             'processed', b.process_status = 'processed', 'process_status', b.process_status)
           order by %1$s, b.id), '[]'::jsonb), 'total', coalesce(max(b.total), 0))
    from f as b
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- Sanitised projection of one event; never subscriber_attributes, aliases or the raw payload.
create function admin_api.billing_event_get(p_id bigint) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('billing_events.read');
  b public.billing_events;
begin
  select * into b from public.billing_events x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', b.id, 'event_id', b.event_id, 'type', b.event_type, 'store', b.store, 'environment', b.environment,
    'product_id', b.product_id, 'user_id', b.user_id,
    'period_type', private.billing_event_field(b.payload, 'period_type') #>> '{}',
    'purchased_at', private.ms_to_timestamptz(private.billing_event_field(b.payload, 'purchased_at_ms')),
    'expiration_at', private.ms_to_timestamptz(private.billing_event_field(b.payload, 'expiration_at_ms')),
    'event_at', b.event_timestamp,
    'price_usd', private.billing_event_field(b.payload, 'price'),
    'price_local', private.billing_event_field(b.payload, 'price_in_purchased_currency'),
    'currency', private.billing_event_field(b.payload, 'currency') #>> '{}',
    'cancel_reason', private.billing_event_field(b.payload, 'cancel_reason') #>> '{}',
    'expiration_reason', private.billing_event_field(b.payload, 'expiration_reason') #>> '{}',
    'is_trial_conversion', private.billing_event_field(b.payload, 'is_trial_conversion'),
    'received_at', b.received_at, 'processed_at', b.processed_at, 'process_status', b.process_status,
    'processing_error_code', case when b.process_status = 'failed' then 'PROCESSING_FAILED' end, 'job_id', b.job_id);
end
$$;

-- Trial funnel rows (no prices) and the conversion summary for trials ending in the range.
create function admin_api.trial_stream(p_range text, p_filter jsonb default '{}'::jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('subscriptions.read');
  w record;
  v_env text := upper(coalesce(p_filter ->> 'environment', 'PRODUCTION'));
  v_rows jsonb;
  v_conversions bigint;
  v_expirations bigint;
begin
  select * into w from private.metric_window(p_range);
  with ev as (
    select b.*, case
                  when b.event_type = 'INITIAL_PURCHASE' and upper(private.billing_event_field(b.payload, 'period_type') #>> '{}') = 'TRIAL'
                    then 'trial_started'
                  when b.event_type = 'RENEWAL' and coalesce((private.billing_event_field(b.payload, 'is_trial_conversion') #>> '{}')::boolean, false)
                    then 'trial_converted'
                  when b.event_type = 'CANCELLATION' and upper(private.billing_event_field(b.payload, 'period_type') #>> '{}') = 'TRIAL'
                    then 'trial_cancelled'
                  when b.event_type = 'EXPIRATION' and upper(private.billing_event_field(b.payload, 'period_type') #>> '{}') = 'TRIAL'
                    then 'trial_expired'
                end as kind
    from public.billing_events b
    where b.event_timestamp >= w.start_at and b.event_timestamp < w.end_at
      and coalesce(b.environment, 'PRODUCTION') = v_env
      and (p_filter ->> 'store' is null or b.store = p_filter ->> 'store')
      and (p_filter ->> 'product_id' is null or b.product_id = p_filter ->> 'product_id'))
  select coalesce((select jsonb_agg(jsonb_build_object('event_id', e.event_id, 'kind', e.kind,
                                                       'email_masked', private.admin_user_label(e.user_id) ->> 'email_masked',
                                                       'product_id', e.product_id, 'store', e.store, 'event_at', e.event_timestamp)
                                    order by e.event_timestamp desc)
                   from (select * from ev where ev.kind is not null order by ev.event_timestamp desc limit 200) as e), '[]'::jsonb),
         (select count(*) from ev where ev.kind = 'trial_converted'),
         (select count(*) from ev where ev.kind = 'trial_expired')
  into v_rows, v_conversions, v_expirations;
  return jsonb_build_object('range', p_range, 'rows', v_rows,
                            'summary', jsonb_build_object('conversions', v_conversions, 'trial_expirations', v_expirations,
                                                          'conversion_rate', round(v_conversions::numeric / nullif(v_conversions + v_expirations, 0), 4)));
end
$$;

create function admin_api.entitlement_grants_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('subscriptions.read');
  v_order text := private.admin_order(p_sort, '{"starts_at":"g.starts_at","ends_at":"g.ends_at","created_at":"g.created_at"}',
                                      'g.starts_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select g.*, case when g.revoked_at is not null then 'revoked' when g.starts_at > now() then 'scheduled'
                       when g.ends_at <= now() then 'ended' else 'active' end as state,
             count(*) over () as total
      from public.entitlement_grants g
      where ($1 ->> 'source' is null or g.source::text = $1 ->> 'source')
        and ($1 ->> 'granted_by_admin_id' is null or g.granted_by_admin_id::text = $1 ->> 'granted_by_admin_id')
        and ($1 ->> 'user_id' is null or g.user_id::text = $1 ->> 'user_id')
        and ($1 ->> 'state' is null or $1 ->> 'state' = case when g.revoked_at is not null then 'revoked'
                                                             when g.starts_at > now() then 'scheduled'
                                                             when g.ends_at <= now() then 'ended' else 'active' end)
      order by %1$s, g.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', g.id, 'user_id', g.user_id, 'email_masked', private.admin_user_label(g.user_id) ->> 'email_masked',
             'source', g.source, 'duration_days', g.duration_days, 'starts_at', g.starts_at, 'ends_at', g.ends_at,
             'state', g.state, 'granted_by', g.granted_by_admin_id, 'reason', g.reason, 'revoked_at', g.revoked_at,
             'revoked_by', g.revoked_by_admin_id)
           order by %1$s, g.id), '[]'::jsonb), 'total', coalesce(max(g.total), 0))
    from f as g
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- Enqueues billing_sync (JOB-24, reason admin), key admin_billing_sync:{user}:{5-minute bucket}.
create function admin_api.subscription_resync(p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('subscriptions.resync');
  v_reason text := private.admin_require_reason(p_reason);
  v_job uuid;
begin
  perform private.admin_assert_user(p_user);
  v_job := private.enqueue_job('billing_sync',
                               'admin_billing_sync:' || p_user || ':' || (extract(epoch from now())::bigint / 300)::text,
                               jsonb_build_object('user_id', p_user, 'reason', 'admin'), p_user, null, now(), 20, 5, null);
  perform private.admin_audit(v_admin, 'subscription.resync_requested', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('job_id', v_job));
  return jsonb_build_object('job_id', v_job);
end
$$;

-- Admin / support / compensation Pro grant (1, 7, 14 or 30 days, stacked after existing grants).
-- entitlements.grant_limited allows only source support with 1 or 7 days.
create function admin_api.entitlement_grant(
  p_user uuid, p_days integer, p_source public.grant_source, p_reason text, p_idempotency_key text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(array['entitlements.grant', 'entitlements.grant_limited']);
  v_reason text := private.admin_require_reason(p_reason);
  g public.entitlement_grants;
begin
  perform private.admin_assert_user(p_user);
  if p_days is null or p_days not in (1, 7, 14, 30) then
    raise exception 'VALIDATION_FAILED:duration_days' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('admin', 'support', 'compensation') then
    raise exception 'VALIDATION_FAILED:source' using errcode = '22023';
  end if;
  if not private.admin_can(v_admin, 'entitlements.grant') and not (p_source = 'support' and p_days in (1, 7)) then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501', detail = 'entitlements.grant';
  end if;
  g := private.grant_entitlement(p_user, p_source, p_days::smallint, v_reason, v_admin.user_id,
                                 'admin_grant:' || coalesce(nullif(p_idempotency_key, ''), gen_random_uuid()::text), null);
  return jsonb_build_object('id', g.id, 'user_id', g.user_id, 'source', g.source, 'duration_days', g.duration_days,
                            'starts_at', g.starts_at, 'ends_at', g.ends_at);
end
$$;

-- Revokes an admin, support or compensation grant (referral grants are read-only).
create function admin_api.entitlement_revoke(p_grant uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('entitlements.revoke');
  v_reason text := private.admin_require_reason(p_reason);
  g public.entitlement_grants;
begin
  select * into g from public.entitlement_grants x where x.id = p_grant for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if g.source not in ('admin', 'support', 'compensation') or g.revoked_at is not null or g.ends_at <= now() then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  update public.entitlement_grants x
    set revoked_at = now(), revoked_by_admin_id = v_admin.user_id, revoke_reason = v_reason
  where x.id = g.id;
  perform private.admin_audit(v_admin, 'entitlement.revoked', 'entitlement_grant', g.id::text, g.user_id, v_reason,
                              jsonb_build_object('source', g.source, 'days', g.duration_days));
  return jsonb_build_object('id', g.id, 'revoked', true);
end
$$;

-- ═══ ADM-12 · referrals (hashed signals shown as risk factors only) ═══════════════════════════

create function admin_api.referrals_metrics(p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('referrals.read');
  w record;
  v_applied bigint;
  v_rewarded bigint;
begin
  select * into w from private.metric_window(p_range);
  select count(*) into v_applied from public.referrals r where r.created_at >= w.start_at and r.created_at < w.end_at;
  select count(*) into v_rewarded from public.referrals r where r.rewarded_at >= w.start_at and r.rewarded_at < w.end_at;
  return jsonb_build_object(
    'range', p_range,
    'invites', (select count(*) from public.analytics_events e
                where e.event_name = 'referral_shared' and e.occurred_at >= w.start_at and e.occurred_at < w.end_at),
    'link_opens', (select count(*) from public.analytics_events e
                   where e.event_name = 'referral_link_opened' and e.occurred_at >= w.start_at and e.occurred_at < w.end_at),
    'applied', v_applied,
    'qualified', (select count(*) from public.referrals r where r.qualified_at >= w.start_at and r.qualified_at < w.end_at),
    'rewarded', v_rewarded,
    'conversion', round(v_rewarded::numeric / nullif(v_applied, 0), 4),
    'bonus_days_granted', (select coalesce(sum(g.duration_days), 0) from public.entitlement_grants g
                           where g.source in ('referral_referrer', 'referral_referee')
                             and g.created_at >= w.start_at and g.created_at < w.end_at),
    'flagged_new', (select count(*) from public.referrals r
                    where r.status = 'flagged' and r.created_at >= w.start_at and r.created_at < w.end_at),
    'flagged_open', (select count(*) from public.referrals r where r.status = 'flagged'),
    'top_referrers', coalesce((select jsonb_agg(jsonb_build_object('referrer', private.admin_user_label(x.referrer_id),
                                                                   'rewarded', x.n, 'cap_used', x.cap_used)
                                                order by x.n desc)
                               from (select r.referrer_id, count(*) as n,
                                            (select count(*) from public.referral_credits c
                                             where c.user_id = r.referrer_id and c.side = 'referrer'
                                               and c.created_at > now() - interval '365 days') as cap_used
                                     from public.referrals r
                                     where r.referrer_id is not null and r.rewarded_at >= w.start_at and r.rewarded_at < w.end_at
                                     group by r.referrer_id order by 2 desc limit 10) as x), '[]'::jsonb));
end
$$;

create function admin_api.referrals_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('referrals.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"r.created_at","risk_score":"r.risk_score","status":"r.status::text"}',
                                      'r.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with f as (
      select r.*, count(*) over () as total from public.referrals r
      where ($1 ->> 'status' is null or r.status::text = $1 ->> 'status')
        and ($1 ->> 'q' is null or r.code = upper($1 ->> 'q'))
        and ($1 ->> 'referrer_id' is null or r.referrer_id::text = $1 ->> 'referrer_id')
        and ($1 ->> 'referee_id' is null or r.referee_id::text = $1 ->> 'referee_id')
      order by %1$s, r.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'code', r.code, 'referrer_id', r.referrer_id, 'referee_id', r.referee_id, 'status', r.status,
             'risk_score', r.risk_score,
             'signals_summary', coalesce((select jsonb_agg(s.key order by s.key) from jsonb_each(r.risk_signals) s
                                          where s.value not in ('false'::jsonb, '0'::jsonb, 'null'::jsonb)), '[]'::jsonb),
             'reject_reason', r.reject_reason, 'created_at', r.created_at, 'qualified_at', r.qualified_at,
             'rewarded_at', r.rewarded_at, 'reviewed_at', r.reviewed_at)
           order by %1$s, r.id), '[]'::jsonb), 'total', coalesce(max(r.total), 0))
    from f as r
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- approve: flagged → qualified → reward (idempotent credits per (referral, side)); a second
-- approve of a rewarded referral replays. reject: pending|flagged → rejected (admin_rejected).
create function admin_api.referral_review(p_referral uuid, p_decision text, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('referrals.review');
  v_reason text := private.admin_require_reason(p_reason);
  r public.referrals;
  v_result jsonb;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'VALIDATION_FAILED:decision' using errcode = '22023';
  end if;
  select * into r from public.referrals x where x.id = p_referral for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_decision = 'approve' then
    if r.status = 'rewarded' then
      return jsonb_build_object('id', r.id, 'status', 'rewarded', 'replayed', true);
    end if;
    if r.status not in ('flagged', 'qualified') then
      raise exception 'STATE_CONFLICT' using errcode = '55000', detail = r.status::text;
    end if;
    update public.referrals x
      set status = 'qualified', qualified_at = coalesce(x.qualified_at, now()), reviewed_by_admin_id = v_admin.user_id,
          reviewed_at = now(), review_reason = v_reason
    where x.id = r.id;
    v_result := private.reward_referral(r.id);
  else
    if r.status not in ('pending', 'flagged') then
      raise exception 'STATE_CONFLICT' using errcode = '55000', detail = r.status::text;
    end if;
    update public.referrals x
      set status = 'rejected', rejected_at = now(), reject_reason = 'admin_rejected', reviewed_by_admin_id = v_admin.user_id,
          reviewed_at = now(), review_reason = v_reason
    where x.id = r.id;
    v_result := jsonb_build_object('status', 'rejected');
  end if;
  perform private.admin_audit(v_admin, 'referral.reviewed', 'referral', r.id::text, r.referrer_id, v_reason,
                              jsonb_build_object('decision', p_decision, 'from_status', r.status,
                                                 'to_status', v_result ->> 'status'));
  return jsonb_build_object('id', r.id) || v_result;
end
$$;

-- ═══ ADM-13 · product feedback ════════════════════════════════════════════════════════════════

-- Rows include the message (user-submitted feedback is shown by design); the contact email is
-- masked (feedback_reveal shows it).
create function admin_api.feedback_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_sql text;
  v_admin public.admin_users := private.require_admin('feedback.read');
  v_order text := private.admin_order(p_sort, '{"created_at":"f.created_at","rating":"f.rating","status":"f.status"}',
                                      'f.created_at desc');
  v_result jsonb;
begin
  v_sql := format($q$
    with q as (
      select f.*, count(*) over () as total from public.user_feedback f
      where ($1 ->> 'type' is null or f.type::text = $1 ->> 'type')
        and ($1 ->> 'status' is null or f.status = $1 ->> 'status')
        and ($1 ->> 'platform' is null or f.platform::text = $1 ->> 'platform')
        and ($1 ->> 'app_version' is null or f.app_version = $1 ->> 'app_version')
        and ($1 ->> 'assignee' is null or f.assigned_admin_id::text = $1 ->> 'assignee')
      order by %1$s, f.id limit $2 offset $3)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', f.id, 'user_id', f.user_id, 'type', f.type, 'rating', f.rating, 'message', f.message,
             'contact_email_masked', private.mask_email(f.contact_email), 'diagnostics_consent', f.diagnostics_consent,
             'platform', f.platform, 'app_version', f.app_version, 'status', f.status,
             'assigned_admin_id', f.assigned_admin_id, 'created_at', f.created_at, 'updated_at', f.updated_at)
           order by %1$s, f.id), '[]'::jsonb), 'total', coalesce(max(f.total), 0))
    from q as f
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- Counts only (no message or email field).
create function admin_api.feedback_summary(p_range text, p_filter jsonb default '{}'::jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('feedback.read');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return (
    with f as (
      select * from public.user_feedback x
      where x.created_at >= w.start_at and x.created_at < w.end_at
        and (p_filter ->> 'platform' is null or x.platform::text = p_filter ->> 'platform')
        and (p_filter ->> 'app_version' is null or x.app_version = p_filter ->> 'app_version'))
    select jsonb_build_object(
      'range', p_range,
      'by_type', jsonb_build_object('bug', count(*) filter (where f.type = 'bug'),
                                    'feature', count(*) filter (where f.type = 'feature'),
                                    'general', count(*) filter (where f.type = 'general'),
                                    'ai_quality', count(*) filter (where f.type = 'ai_quality')),
      'rating_distribution', jsonb_build_object('1', count(*) filter (where f.rating = 1), '2', count(*) filter (where f.rating = 2),
                                                '3', count(*) filter (where f.rating = 3), '4', count(*) filter (where f.rating = 4),
                                                '5', count(*) filter (where f.rating = 5),
                                                'unrated', count(*) filter (where f.rating is null)),
      'by_app_version', coalesce((select jsonb_agg(jsonb_build_object('app_version', x.app_version, 'count', x.n) order by x.n desc)
                                  from (select coalesce(f2.app_version, 'unknown') as app_version, count(*) as n
                                        from f as f2 group by 1) as x), '[]'::jsonb),
      'by_status', jsonb_build_object('new', count(*) filter (where f.status = 'new'),
                                      'triaged', count(*) filter (where f.status = 'triaged'),
                                      'planned', count(*) filter (where f.status = 'planned'),
                                      'closed', count(*) filter (where f.status = 'closed')))
    from f);
end
$$;

create function admin_api.feedback_update(
  p_id uuid, p_status text default null, p_assignee uuid default null, p_reason text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('feedback.write');
  v_reason text := private.admin_require_reason(coalesce(p_reason, 'feedback triage update'));
  f public.user_feedback;
  v_before jsonb;
begin
  if p_status is not null and p_status not in ('new', 'triaged', 'planned', 'closed') then
    raise exception 'VALIDATION_FAILED:status' using errcode = '22023';
  end if;
  if p_assignee is not null and not exists (select 1 from public.admin_users a where a.user_id = p_assignee and a.status = 'active') then
    raise exception 'VALIDATION_FAILED:assignee' using errcode = '22023';
  end if;
  select * into f from public.user_feedback x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_before := jsonb_build_object('status', f.status, 'assignee', f.assigned_admin_id);
  update public.user_feedback x
    set status = coalesce(p_status, x.status), assigned_admin_id = coalesce(p_assignee, x.assigned_admin_id)
  where x.id = f.id
  returning * into f;
  perform private.admin_audit(v_admin, 'feedback.updated', 'user_feedback', f.id::text, f.user_id, v_reason,
                              jsonb_build_object('before', v_before,
                                                 'after', jsonb_build_object('status', f.status, 'assignee', f.assigned_admin_id)));
  return jsonb_build_object('id', f.id, 'status', f.status, 'assigned_admin_id', f.assigned_admin_id, 'updated_at', f.updated_at);
end
$$;

-- The message with identifiers unmasked plus the contact email (users.pii.reveal, audited).
create function admin_api.feedback_reveal(p_id uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.pii.reveal');
  v_reason text := private.admin_require_reason(p_reason);
  f public.user_feedback;
begin
  select * into f from public.user_feedback x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.admin_audit(v_admin, 'pii.reveal', 'user_feedback', f.id::text, f.user_id, v_reason,
                              jsonb_build_object('field', 'feedback', 'resource_type', 'user_feedback'));
  return jsonb_build_object('value', jsonb_build_object('message', f.message, 'contact_email', f.contact_email::text),
                            'expires_in_s', 60);
end
$$;

-- ═══ ADM-14 · feature flags ═══════════════════════════════════════════════════════════════════

-- flags.write for every key; flags.write_ai only for ai.* / voice.* keys.
create function private.require_flag_writer(p_key text) returns public.admin_users
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(array['flags.write', 'flags.write_ai']);
begin
  if not private.admin_can(v_admin, 'flags.write') and not (p_key like 'ai.%' or p_key like 'voice.%') then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501', detail = 'flags.write';
  end if;
  return v_admin;
end
$$;

create function private.flag_json(f public.feature_flags) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object('key', f.key, 'description', f.description, 'enabled', f.enabled,
                              'is_kill_switch', f.is_kill_switch, 'rollout_percent', f.rollout_percentage,
                              'platforms', f.platforms, 'plans', f.plans, 'min_version', f.min_app_version,
                              'max_version', f.max_app_version, 'payload', f.payload, 'archived_at', f.archived_at,
                              'updated_by', f.updated_by, 'updated_at', f.updated_at)
  $$;

create function admin_api.flags_list(p_filter jsonb default '{}'::jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('flags.read');
begin
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(private.flag_json(f) || jsonb_build_object(
                       'override_count', (select count(*) from public.feature_flag_overrides o where o.flag_key = f.key))
                     order by f.key)
    from public.feature_flags f
    where (coalesce((p_filter ->> 'archived')::boolean, false) or f.archived_at is null)
      and (p_filter ->> 'q' is null or f.key like '%' || (p_filter ->> 'q') || '%')), '[]'::jsonb));
end
$$;

create function admin_api.flag_get(p_key text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('flags.read');
  f public.feature_flags;
begin
  select * into f from public.feature_flags x where x.key = p_key;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.flag_json(f) || jsonb_build_object(
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'user_id', o.user_id,
                                                               'email_masked', private.admin_user_label(o.user_id) ->> 'email_masked',
                                                               'enabled', o.value, 'expires_at', o.expires_at,
                                                               'created_at', o.created_at)
                                            order by o.created_at desc)
                           from public.feature_flag_overrides o where o.flag_key = f.key), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('ts', a.occurred_at, 'actor', private.admin_user_label(a.actor_id) ->> 'email_masked',
                                                             'action', a.action, 'reason', a.reason,
                                                             'before', a.details -> 'before', 'after', a.details -> 'after')
                                          order by a.chain_seq desc)
                         from (select * from public.audit_logs x
                               where x.action like 'flag.%' and x.target_type = 'feature_flag' and x.target_id = f.key
                               order by x.chain_seq desc limit 50) as a), '[]'::jsonb));
end
$$;

-- Read-only evaluation with the same evaluator as GET /me/bootstrap; platform and version
-- default to the user's latest installation.
create function admin_api.flag_evaluate_preview(
  p_key text, p_user uuid, p_platform public.platform default null, p_app_version text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('flags.read');
  i record;
begin
  perform private.admin_assert_user(p_user);
  select a.platform, a.app_version into i from public.app_installations a
  where a.user_id = p_user and a.signed_out_at is null order by a.last_seen_at desc limit 1;
  return private.evaluate_flag(p_key, p_user, coalesce(p_platform, i.platform), coalesce(p_app_version, i.app_version))
         || jsonb_build_object('user_id', p_user, 'platform', coalesce(p_platform, i.platform),
                               'app_version', coalesce(p_app_version, i.app_version));
end
$$;

-- Create or update targeting. New keys must match the key pattern; kill switches keep their
-- is_kill_switch flag. Audited as flag.created / flag.updated with before/after.
create function admin_api.flag_upsert(
  p_key text, p_description text, p_enabled boolean, p_rollout integer, p_platforms public.platform[], p_plans text[],
  p_min_ver text, p_max_ver text, p_payload jsonb, p_reason text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_flag_writer(p_key);
  v_reason text := private.admin_require_reason(p_reason);
  f public.feature_flags;
  v_before jsonb;
begin
  if p_key is null or p_key !~ '^[a-z][a-z0-9_.]{2,63}$' then
    raise exception 'VALIDATION_FAILED:key' using errcode = '22023';
  end if;
  if p_rollout is not null and (p_rollout < 0 or p_rollout > 100) then
    raise exception 'VALIDATION_FAILED:rollout' using errcode = '22023';
  end if;
  if (p_min_ver is not null and p_min_ver !~ '^\d+\.\d+\.\d+$') or (p_max_ver is not null and p_max_ver !~ '^\d+\.\d+\.\d+$') then
    raise exception 'VALIDATION_FAILED:version' using errcode = '22023';
  end if;
  if p_payload is not null and jsonb_typeof(p_payload) <> 'object' then
    raise exception 'VALIDATION_FAILED:payload' using errcode = '22023';
  end if;
  select * into f from public.feature_flags x where x.key = p_key for update;
  if found then
    if f.archived_at is not null then
      raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'archived';
    end if;
    v_before := private.flag_json(f);
    update public.feature_flags x
      set description = coalesce(p_description, x.description), enabled = coalesce(p_enabled, x.enabled),
          rollout_percentage = coalesce(p_rollout, x.rollout_percentage)::smallint, platforms = p_platforms, plans = p_plans,
          min_app_version = p_min_ver, max_app_version = p_max_ver, payload = coalesce(p_payload, x.payload),
          updated_by = v_admin.user_id
    where x.key = p_key
    returning * into f;
    perform private.admin_audit(v_admin, 'flag.updated', 'feature_flag', f.key, null, v_reason,
                                jsonb_build_object('before', v_before, 'after', private.flag_json(f)));
  else
    if p_description is null or char_length(btrim(p_description)) = 0 then
      raise exception 'VALIDATION_FAILED:description' using errcode = '22023';
    end if;
    insert into public.feature_flags (key, description, enabled, is_kill_switch, rollout_percentage, platforms, plans,
                                      min_app_version, max_app_version, payload, updated_by)
    values (p_key, p_description, coalesce(p_enabled, false), false, coalesce(p_rollout, 100)::smallint, p_platforms, p_plans,
            p_min_ver, p_max_ver, coalesce(p_payload, '{}'::jsonb), v_admin.user_id)
    returning * into f;
    perform private.admin_audit(v_admin, 'flag.created', 'feature_flag', f.key, null, v_reason,
                                jsonb_build_object('after', private.flag_json(f)));
  end if;
  return private.flag_json(f);
end
$$;

-- Kill switch: p_on = true sets enabled = false at once; p_on = false restores enabled = true.
-- Targeting is kept either way.
create function admin_api.flag_kill(p_key text, p_reason text, p_on boolean default true) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_flag_writer(p_key);
  v_reason text := private.admin_require_reason(p_reason);
  f public.feature_flags;
  v_before boolean;
begin
  select * into f from public.feature_flags x where x.key = p_key for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if f.archived_at is not null then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'archived';
  end if;
  v_before := f.enabled;
  update public.feature_flags x set enabled = not coalesce(p_on, true), updated_by = v_admin.user_id
  where x.key = p_key
  returning * into f;
  perform private.admin_audit(v_admin, 'flag.killed', 'feature_flag', f.key, null, v_reason,
                              jsonb_build_object('before', jsonb_build_object('enabled', v_before),
                                                 'after', jsonb_build_object('enabled', f.enabled), 'on', coalesce(p_on, true)));
  return private.flag_json(f);
end
$$;

-- Archive: only a disabled flag that is not an R-10 kill switch; nothing is deleted.
create function admin_api.flag_archive(p_key text, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_flag_writer(p_key);
  v_reason text := private.admin_require_reason(p_reason);
  f public.feature_flags;
begin
  select * into f from public.feature_flags x where x.key = p_key for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if f.enabled or f.is_kill_switch or f.archived_at is not null then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  update public.feature_flags x set archived_at = now(), updated_by = v_admin.user_id where x.key = p_key returning * into f;
  perform private.admin_audit(v_admin, 'flag.archived', 'feature_flag', f.key, null, v_reason, '{}'::jsonb);
  return private.flag_json(f);
end
$$;

create function admin_api.flag_override_set(
  p_key text, p_user uuid, p_value boolean, p_reason text, p_expires timestamptz default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_flag_writer(p_key);
  v_reason text := private.admin_require_reason(p_reason);
  o public.feature_flag_overrides;
begin
  perform private.admin_assert_user(p_user);
  if not exists (select 1 from public.feature_flags f where f.key = p_key and f.archived_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_value is null or (p_expires is not null and p_expires <= now()) then
    raise exception 'VALIDATION_FAILED:override' using errcode = '22023';
  end if;
  insert into public.feature_flag_overrides (flag_key, user_id, value, reason, expires_at, created_by_admin_id)
  values (p_key, p_user, p_value, v_reason, p_expires, v_admin.user_id)
  on conflict (flag_key, user_id) do update
    set value = excluded.value, reason = excluded.reason, expires_at = excluded.expires_at,
        created_by_admin_id = excluded.created_by_admin_id, created_at = now()
  returning * into o;
  perform private.admin_audit(v_admin, 'flag.override_set', 'feature_flag', p_key, p_user, v_reason,
                              jsonb_build_object('value', p_value, 'expires_at', p_expires, 'override_id', o.id));
  return jsonb_build_object('id', o.id, 'flag_key', o.flag_key, 'user_id', o.user_id, 'value', o.value, 'expires_at', o.expires_at);
end
$$;

-- p_user identifies the override (DELETE /flags/:key/overrides/:userId).
create function admin_api.flag_override_delete(p_key text, p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_flag_writer(p_key);
  v_reason text := private.admin_require_reason(p_reason);
  v_id uuid;
begin
  delete from public.feature_flag_overrides o where o.flag_key = p_key and o.user_id = p_user returning o.id into v_id;
  if v_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.admin_audit(v_admin, 'flag.override_removed', 'feature_flag', p_key, p_user, v_reason,
                              jsonb_build_object('override_id', v_id));
  return jsonb_build_object('deleted', true, 'override_id', v_id);
end
$$;

-- ═══ ADM-15 · announcements ═══════════════════════════════════════════════════════════════════

create function private.announcement_status(a public.announcements) returns text
  language sql stable
  set search_path = ''
  as $$
    select case
      when a.cancelled_at is not null then 'cancelled'
      when a.published_at is null then 'draft'
      when now() < a.starts_at then 'scheduled'
      when now() >= a.ends_at then 'ended'
      else 'live'
    end
  $$;

create function private.announcement_json(a public.announcements) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object('id', a.id, 'title_tr', a.title_tr, 'title_en', a.title_en, 'body_tr', a.body_tr,
                              'body_en', a.body_en, 'audience', a.audience, 'platforms', a.platforms,
                              'min_version', a.min_app_version, 'max_version', a.max_app_version, 'starts_at', a.starts_at,
                              'ends_at', a.ends_at, 'severity', a.severity, 'cta_deeplink', a.cta_deeplink,
                              'status', private.announcement_status(a), 'published_at', a.published_at,
                              'cancelled_at', a.cancelled_at, 'created_by', a.created_by, 'updated_by', a.updated_by,
                              'created_at', a.created_at, 'updated_at', a.updated_at)
  $$;

create function admin_api.announcements_list(p_filter jsonb default '{}'::jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('announcements.read');
begin
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(private.announcement_json(a) order by a.starts_at desc, a.id)
    from public.announcements a
    where p_filter ->> 'status' is null or private.announcement_status(a) = p_filter ->> 'status'), '[]'::jsonb));
end
$$;

create function admin_api.announcement_get(p_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('announcements.read');
  a public.announcements;
begin
  select * into a from public.announcements x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.announcement_json(a)
         || jsonb_build_object('dismissal_count', (select count(*) from public.announcement_dismissals d where d.announcement_id = a.id));
end
$$;

-- {estimated_users}: non-internal, non-demo users whose plan, latest installation platform and
-- version match (a count only).
create function admin_api.announcement_audience_estimate(
  p_audience text, p_platforms public.platform[] default null, p_min_version text default null, p_max_version text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('announcements.read');
  v_count bigint;
begin
  if p_audience is null or p_audience not in ('all', 'free', 'pro') then
    raise exception 'VALIDATION_FAILED:audience' using errcode = '22023';
  end if;
  select count(*) into v_count
  from private.metric_population() m
  left join lateral (select a.platform, a.app_version from public.app_installations a
                     where a.user_id = m.user_id and a.signed_out_at is null
                     order by a.last_seen_at desc limit 1) as i on true
  where (p_audience = 'all' or private.plan_of(m.user_id) = p_audience)
    and (p_platforms is null or i.platform = any(p_platforms))
    and (p_min_version is null or coalesce(private.compare_semver(i.app_version, p_min_version), -1) >= 0)
    and (p_max_version is null or coalesce(private.compare_semver(i.app_version, p_max_version), 1) <= 0);
  return jsonb_build_object('estimated_users', v_count);
end
$$;

-- Creates (p_id null) or updates a draft/scheduled announcement from p_fields
-- {title_tr, title_en, body_tr, body_en, audience, platforms, min_version, max_version,
-- starts_at, ends_at, severity, cta_deeplink}; ends_at ≤ starts_at + 30 days.
create function admin_api.announcement_upsert(p_id uuid, p_fields jsonb, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('announcements.write');
  v_reason text := private.admin_require_reason(p_reason);
  a public.announcements;
  v_starts timestamptz;
  v_ends timestamptz;
  v_platforms public.platform[];
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'VALIDATION_FAILED:fields' using errcode = '22023';
  end if;
  if p_fields ? 'platforms' and jsonb_typeof(p_fields -> 'platforms') = 'array' then
    select array_agg(x.value::public.platform) into v_platforms from jsonb_array_elements_text(p_fields -> 'platforms') as x (value);
  end if;
  if p_id is not null then
    select * into a from public.announcements x where x.id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if private.announcement_status(a) not in ('draft', 'scheduled') then
      raise exception 'STATE_CONFLICT' using errcode = '55000', detail = private.announcement_status(a);
    end if;
  end if;
  v_starts := coalesce((p_fields ->> 'starts_at')::timestamptz, a.starts_at, now());
  v_ends := coalesce((p_fields ->> 'ends_at')::timestamptz, a.ends_at, v_starts + interval '7 days');
  if v_ends <= v_starts or v_ends > v_starts + interval '30 days' then
    raise exception 'VALIDATION_FAILED:ends_at' using errcode = '22023';
  end if;
  if p_fields ->> 'cta_deeplink' is not null and (p_fields ->> 'cta_deeplink') !~ '^dijitalasistan://[a-z0-9/_-]+$' then
    raise exception 'VALIDATION_FAILED:cta_deeplink' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.announcements (title_tr, title_en, body_tr, body_en, audience, platforms, min_app_version,
                                      max_app_version, starts_at, ends_at, severity, cta_deeplink, created_by, updated_by)
    values (p_fields ->> 'title_tr', p_fields ->> 'title_en', p_fields ->> 'body_tr', p_fields ->> 'body_en',
            coalesce(p_fields ->> 'audience', 'all'), v_platforms, p_fields ->> 'min_version', p_fields ->> 'max_version',
            v_starts, v_ends, coalesce(p_fields ->> 'severity', 'info'), p_fields ->> 'cta_deeplink',
            v_admin.user_id, v_admin.user_id)
    returning * into a;
    perform private.admin_audit(v_admin, 'announcement.created', 'announcement', a.id::text, null, v_reason,
                                jsonb_build_object('after', private.announcement_json(a)));
  else
    update public.announcements x
      set title_tr = coalesce(p_fields ->> 'title_tr', x.title_tr), title_en = coalesce(p_fields ->> 'title_en', x.title_en),
          body_tr = coalesce(p_fields ->> 'body_tr', x.body_tr), body_en = coalesce(p_fields ->> 'body_en', x.body_en),
          audience = coalesce(p_fields ->> 'audience', x.audience),
          platforms = case when p_fields ? 'platforms' then v_platforms else x.platforms end,
          min_app_version = case when p_fields ? 'min_version' then p_fields ->> 'min_version' else x.min_app_version end,
          max_app_version = case when p_fields ? 'max_version' then p_fields ->> 'max_version' else x.max_app_version end,
          starts_at = v_starts, ends_at = v_ends, severity = coalesce(p_fields ->> 'severity', x.severity),
          cta_deeplink = case when p_fields ? 'cta_deeplink' then p_fields ->> 'cta_deeplink' else x.cta_deeplink end,
          updated_by = v_admin.user_id
    where x.id = a.id
    returning * into a;
    perform private.admin_audit(v_admin, 'announcement.updated', 'announcement', a.id::text, null, v_reason,
                                jsonb_build_object('after', private.announcement_json(a)));
  end if;
  return private.announcement_json(a);
end
$$;

-- Schedules a draft (published_at); p_now_live = true also moves starts_at to now().
create function admin_api.announcement_publish(p_id uuid, p_reason text, p_now_live boolean default false) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('announcements.write');
  v_reason text := private.admin_require_reason(p_reason);
  a public.announcements;
begin
  select * into a from public.announcements x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if private.announcement_status(a) <> 'draft' then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = private.announcement_status(a);
  end if;
  update public.announcements x
    set published_at = now(), starts_at = case when coalesce(p_now_live, false) then now() else x.starts_at end,
        updated_by = v_admin.user_id
  where x.id = a.id
  returning * into a;
  if a.ends_at <= a.starts_at then
    raise exception 'VALIDATION_FAILED:ends_at' using errcode = '22023';
  end if;
  perform private.admin_audit(v_admin, 'announcement.published', 'announcement', a.id::text, null, v_reason,
                              jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at));
  return private.announcement_json(a);
end
$$;

create function admin_api.announcement_cancel(p_id uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('announcements.write');
  v_reason text := private.admin_require_reason(p_reason);
  a public.announcements;
begin
  select * into a from public.announcements x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if private.announcement_status(a) in ('cancelled', 'ended') then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = private.announcement_status(a);
  end if;
  update public.announcements x set cancelled_at = now(), updated_by = v_admin.user_id where x.id = a.id returning * into a;
  perform private.admin_audit(v_admin, 'announcement.cancelled', 'announcement', a.id::text, null, v_reason, '{}'::jsonb);
  return private.announcement_json(a);
end
$$;

-- ═══ ADM-16 · data requests (honest statuses; the admin never receives files or URLs) ═════════

create function private.data_request_job_type(p_kind text) returns public.job_type
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case p_kind when 'export' then 'export'::public.job_type
                       when 'history' then 'history_deletion'::public.job_type
                       when 'account' then 'account_deletion'::public.job_type end
  $$;

create function private.assert_data_request_kind(p_kind text) returns void
  language plpgsql immutable
  set search_path = ''
  as $$
begin
  if p_kind is null or p_kind not in ('export', 'history', 'account') then
    raise exception 'VALIDATION_FAILED:kind' using errcode = '22023';
  end if;
end
$$;

create function admin_api.data_requests_list(
  p_kind text, p_page integer default 1, p_page_size integer default 25, p_sort text default null,
  p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('data_requests.read');
  v_size integer := private.admin_page_size(p_page_size);
  v_offset integer := private.admin_offset(p_page, p_page_size);
  v_desc boolean := coalesce(p_sort, '-created_at') like '-%';
  v_result jsonb;
begin
  perform private.assert_data_request_kind(p_kind);
  if p_kind = 'export' then
    with f as (
      select e.*, count(*) over () as total from public.data_export_requests e
      where (p_filter ->> 'status' is null or e.status::text = p_filter ->> 'status')
        and (p_filter ->> 'user_id' is null or e.user_id::text = p_filter ->> 'user_id')
      order by case when v_desc then e.created_at end desc, case when not v_desc then e.created_at end asc, e.id
      limit v_size offset v_offset)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', f.id, 'kind', 'export', 'status', f.status, 'origin', f.requested_via, 'requested_at', f.created_at,
             'completed_at', f.ready_at, 'expires_at', f.expires_at, 'error_code', f.error_code,
             'steps_summary', coalesce((select j.progress from public.jobs j where j.id = f.job_id), '{}'::jsonb),
             'user_ref', jsonb_build_object('id', f.user_id))
           order by case when v_desc then f.created_at end desc, case when not v_desc then f.created_at end asc, f.id), '[]'::jsonb),
           'total', coalesce(max(f.total), 0))
    into v_result from f;
  else
    with f as (
      select d.*, count(*) over () as total from public.data_deletion_requests d
      where d.kind::text = p_kind
        and (p_filter ->> 'status' is null or d.status::text = p_filter ->> 'status')
        and (p_filter ->> 'user_id' is null or d.user_id::text = p_filter ->> 'user_id')
      order by case when v_desc then d.created_at end desc, case when not v_desc then d.created_at end asc, d.id
      limit v_size offset v_offset)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', f.id, 'kind', f.kind, 'status', f.status, 'origin', f.origin, 'scope', f.scope,
             'requested_at', f.created_at, 'completed_at', f.completed_at, 'error_code', f.error_code,
             'steps_summary', coalesce((select jsonb_object_agg(s.key, coalesce(s.value ->> 'status', s.value #>> '{}'))
                                        from jsonb_each(f.steps) s), '{}'::jsonb),
             'user_ref', case when f.status = 'completed' or f.user_id is null
                              then jsonb_build_object('subject_hash_prefix', left(encode(f.subject_hash, 'hex'), 12))
                              else jsonb_build_object('id', f.user_id) end)
           order by case when v_desc then f.created_at end desc, case when not v_desc then f.created_at end asc, f.id), '[]'::jsonb),
           'total', coalesce(max(f.total), 0))
    into v_result from f;
  end if;
  return v_result || jsonb_build_object('kind', p_kind, 'page', greatest(coalesce(p_page, 1), 1), 'page_size', v_size);
end
$$;

create function admin_api.data_request_get(p_kind text, p_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('data_requests.read');
  e public.data_export_requests;
  d public.data_deletion_requests;
  v_job uuid;
  v_result jsonb;
begin
  perform private.assert_data_request_kind(p_kind);
  if p_kind = 'export' then
    select * into e from public.data_export_requests x where x.id = p_id;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_job := e.job_id;
    v_result := jsonb_build_object('id', e.id, 'kind', 'export', 'status', e.status, 'origin', e.requested_via,
                                   'user_ref', jsonb_build_object('id', e.user_id), 'requested_at', e.created_at,
                                   'ready_at', e.ready_at, 'expires_at', e.expires_at, 'downloaded_at', e.downloaded_at,
                                   'file_size_bytes', e.file_size_bytes, 'error_code', e.error_code);
  else
    select * into d from public.data_deletion_requests x where x.id = p_id and x.kind::text = p_kind;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_job := d.job_id;
    v_result := jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status, 'origin', d.origin,
                                   'confirmation_method', d.confirmation_method, 'scope', d.scope,
                                   'connected_account_id', d.connected_account_id, 'steps', d.steps,
                                   'user_ref', case when d.status = 'completed' or d.user_id is null
                                                    then jsonb_build_object('subject_hash_prefix', left(encode(d.subject_hash, 'hex'), 12))
                                                    else jsonb_build_object('id', d.user_id) end,
                                   'requested_at', d.created_at, 'completed_at', d.completed_at, 'failed_at', d.failed_at,
                                   'error_code', d.error_code);
  end if;
  return v_result || jsonb_build_object('job', (select jsonb_build_object('id', j.id, 'status', j.status, 'attempts', j.attempts,
                                                                           'max_attempts', j.max_attempts, 'progress', j.progress,
                                                                           'last_error_code', j.last_error_code, 'run_after', j.run_after,
                                                                           'updated_at', j.updated_at)
                                                from public.jobs j where j.id = v_job));
end
$$;

-- failed → queued (deletions) / requested (exports); the same job resumes from its first
-- incomplete step (same idempotency key). admin-api pokes the worker afterwards.
create function admin_api.data_request_retry(p_kind text, p_id uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('data_requests.manage');
  v_reason text := private.admin_require_reason(p_reason);
  v_status text;
  v_user uuid;
  v_job uuid;
begin
  perform private.assert_data_request_kind(p_kind);
  if p_kind = 'export' then
    select x.status::text, x.user_id, x.job_id into v_status, v_user, v_job from public.data_export_requests x where x.id = p_id for update;
  else
    select x.status::text, x.user_id, x.job_id into v_status, v_user, v_job
    from public.data_deletion_requests x where x.id = p_id and x.kind::text = p_kind for update;
  end if;
  if v_status is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'failed' then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = v_status;
  end if;
  begin
    if p_kind = 'export' then
      update public.data_export_requests x set status = 'requested', error_code = null where x.id = p_id;
    else
      update public.data_deletion_requests x set status = 'queued', error_code = null, failed_at = null where x.id = p_id;
    end if;
  exception when unique_violation then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'active_request';
  end;
  if v_job is not null and exists (select 1 from public.jobs j where j.id = v_job) then
    update public.jobs j
      set status = 'queued', run_after = now(), dead_lettered_at = null, lease_owner = null, lease_expires_at = null,
          max_attempts = least(j.max_attempts + 1, 20)
    where j.id = v_job and j.status in ('failed', 'dead_letter');
  else
    v_job := private.enqueue_job(private.data_request_job_type(p_kind), p_kind || ':' || p_id,
                                 jsonb_build_object('request_id', p_id), case when p_kind = 'account' then null else v_user end,
                                 null, now(), 50, 8, null);
    if p_kind = 'export' then
      update public.data_export_requests x set job_id = v_job where x.id = p_id;
    else
      update public.data_deletion_requests x set job_id = v_job where x.id = p_id;
    end if;
  end if;
  perform private.admin_audit(v_admin, 'data_request.retried', 'data_request', p_id::text, v_user, v_reason,
                              jsonb_build_object('kind', p_kind, 'job_id', v_job));
  return jsonb_build_object('id', p_id, 'kind', p_kind, 'status', case when p_kind = 'export' then 'requested' else 'queued' end,
                            'job_id', v_job);
end
$$;

-- Cancels a request that has not started processing; its queued job is cancelled too.
create function admin_api.data_request_cancel(p_kind text, p_id uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('data_requests.manage');
  v_reason text := private.admin_require_reason(p_reason);
  v_status text;
  v_user uuid;
  v_job uuid;
begin
  perform private.assert_data_request_kind(p_kind);
  if p_kind = 'export' then
    select x.status::text, x.user_id, x.job_id into v_status, v_user, v_job from public.data_export_requests x where x.id = p_id for update;
  else
    select x.status::text, x.user_id, x.job_id into v_status, v_user, v_job
    from public.data_deletion_requests x where x.id = p_id and x.kind::text = p_kind for update;
  end if;
  if v_status is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status not in ('requested', 'verified', 'queued') then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = v_status;
  end if;
  if p_kind = 'export' then
    update public.data_export_requests x set status = 'cancelled' where x.id = p_id;
  else
    update public.data_deletion_requests x set status = 'cancelled' where x.id = p_id;
    update public.profiles p set state = 'active'
    where p_kind = 'account' and p.user_id = v_user and p.state = 'deletion_pending';
  end if;
  update public.jobs j set status = 'failed', last_error_code = 'CANCELLED_ADMIN', last_error_message = 'cancelled by an admin'
  where j.id = v_job and j.status in ('queued', 'retrying');
  perform private.admin_audit(v_admin, 'data_request.cancelled', 'data_request', p_id::text, v_user, v_reason,
                              jsonb_build_object('kind', p_kind, 'from_status', v_status));
  return jsonb_build_object('id', p_id, 'kind', p_kind, 'status', 'cancelled');
end
$$;

-- A new export for an expired or failed one (requested_via = admin) plus its export job; never a
-- path or URL. STATE_CONFLICT when another export is in flight.
create function admin_api.export_regenerate(p_id uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('data_requests.manage');
  v_reason text := private.admin_require_reason(p_reason);
  e public.data_export_requests;
  v_active uuid;
  v_new uuid;
  v_job uuid;
begin
  select * into e from public.data_export_requests x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if e.status not in ('expired', 'failed') then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = e.status::text;
  end if;
  select x.id into v_active from public.data_export_requests x
  where x.user_id = e.user_id and x.status in ('requested', 'processing');
  if v_active is not null then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'active_request_id=' || v_active;
  end if;
  insert into public.data_export_requests (user_id, requested_via) values (e.user_id, 'admin') returning id into v_new;
  v_job := private.enqueue_job('export', 'export:' || v_new, jsonb_build_object('request_id', v_new, 'trigger', 'admin'),
                               e.user_id, null, now(), 50, 6, null);
  update public.data_export_requests x set job_id = v_job where x.id = v_new;
  perform private.admin_audit(v_admin, 'data_request.export_regenerated', 'data_request', v_new::text, e.user_id, v_reason,
                              jsonb_build_object('previous_id', e.id, 'job_id', v_job));
  return jsonb_build_object('export_request_id', v_new, 'job_id', v_job);
end
$$;

-- ═══ ADM-17 · audit logs (read-only; no update or delete path exists) ═════════════════════════

create function admin_api.audit_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('audit.read');
  v_result jsonb;
begin
  with f as (
    select a as rec, a.chain_seq, count(*) over () as total from public.audit_logs a
    where (p_filter ->> 'actor_id' is null or a.actor_id::text = p_filter ->> 'actor_id')
      and (p_filter ->> 'actor_role' is null or a.actor_role = p_filter ->> 'actor_role')
      and (p_filter ->> 'action' is null or a.action = p_filter ->> 'action' or a.action like (p_filter ->> 'action') || '.%')
      and (p_filter ->> 'target_type' is null or a.target_type = p_filter ->> 'target_type')
      and (p_filter ->> 'target_id' is null or a.target_id = p_filter ->> 'target_id')
      and (p_filter ->> 'result' is null or a.result = p_filter ->> 'result')
      and (p_filter ->> 'from' is null or a.occurred_at >= (p_filter ->> 'from')::timestamptz)
      and (p_filter ->> 'to' is null or a.occurred_at < (p_filter ->> 'to')::timestamptz)
    order by a.chain_seq desc
    limit private.admin_page_size(p_page_size) offset private.admin_offset(p_page, p_page_size))
  select jsonb_build_object('rows', coalesce(jsonb_agg(private.audit_row_json(f.rec) - 'prev_hash' - 'hash' - 'metadata'
                                                       order by f.chain_seq desc), '[]'::jsonb),
                            'total', coalesce(max(f.total), 0))
  into v_result from f;
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;

-- One row with chain fields; never ip_hash.
create function admin_api.audit_get(p_id bigint) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('audit.read');
  a public.audit_logs;
begin
  select * into a from public.audit_logs x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.audit_row_json(a);
end
$$;

-- Recomputes the chain (whole or [p_from, p_to]) and records audit.verified.
create function admin_api.audit_verify(p_from bigint default null, p_to bigint default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('audit.read');
  r record;
begin
  select * into r from private.audit_verify_chain(coalesce(p_from, 1), p_to);
  perform private.admin_audit(v_admin, 'audit.verified', 'audit_log', null, null, 'audit chain verification',
                              jsonb_build_object('from', coalesce(p_from, 1), 'to', p_to, 'verified', r.ok, 'checked', r.checked,
                                                 'first_broken_seq', r.first_bad_seq));
  return jsonb_build_object('verified', r.ok, 'checked', r.checked, 'first_broken_id',
                            (select x.id from public.audit_logs x where x.chain_seq = r.first_bad_seq),
                            'first_broken_seq', r.first_bad_seq);
end
$$;

-- ═══ ADM-18 · system health and observability ═════════════════════════════════════════════════

create function admin_api.health_latest() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('health.read');
begin
  return jsonb_build_object(
    'components', coalesce((select jsonb_agg(jsonb_build_object(
                              'component', h.component, 'status', h.status, 'latency_ms', h.latency_ms, 'checked_at', h.checked_at,
                              'checked_by', h.checked_by, 'detail_code', h.detail ->> 'code',
                              'stale', h.checked_at < now() - interval '15 minutes')
                            order by h.component)
                            from (select distinct on (s.component) s.* from public.system_health_checks s
                                  order by s.component, s.checked_at desc) as h), '[]'::jsonb),
    'credential_expiry', coalesce((select jsonb_agg(jsonb_build_object('component', h.component, 'not_after', h.detail ->> 'not_after',
                                                                       'rotation_due_at', h.detail ->> 'rotation_due_at'))
                                   from (select distinct on (s.component) s.* from public.system_health_checks s
                                         order by s.component, s.checked_at desc) as h
                                   where h.detail ? 'not_after' or h.detail ? 'rotation_due_at'), '[]'::jsonb));
end
$$;

create function admin_api.health_history(p_component text, p_range text default '24h') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('health.read');
  w record;
begin
  if p_component is null or p_component not in (
       'api', 'database', 'supabase_auth', 'storage', 'google_oauth', 'microsoft_oauth', 'gmail', 'microsoft_graph',
       'push', 'ai_anthropic', 'ai_openai', 'ai_voyage', 'revenuecat', 'cron', 'webhooks', 'worker',
       'email_delivery', 'audit_chain') then
    raise exception 'VALIDATION_FAILED:component' using errcode = '22023';
  end if;
  if p_range is null or p_range not in ('24h', '7d', '30d') then
    raise exception 'VALIDATION_FAILED:range' using errcode = '22023';
  end if;
  select * into w from private.metric_window(p_range);
  return jsonb_build_object('component', p_component, 'range', p_range, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('checked_at', h.checked_at, 'component', h.component, 'status', h.status,
                                        'latency_ms', h.latency_ms, 'detail_code', h.detail ->> 'code', 'checked_by', h.checked_by)
                     order by h.checked_at desc)
    from (select * from public.system_health_checks s
          where s.component = p_component and s.checked_at >= w.start_at and s.checked_at < w.end_at
          order by s.checked_at desc limit 2000) as h), '[]'::jsonb));
end
$$;

-- Platform × version distribution of installs active in the range, old-version usage (not among
-- the 3 newest observed versions per platform), OS versions, push-enabled share and the server
-- sync failure rate per provider.
create function admin_api.app_versions_breakdown(p_range text default '30d') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('health.read');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return (
    with active as (
      select a.* from public.app_installations a
      where a.signed_out_at is null and a.last_seen_at >= w.start_at and a.last_seen_at < w.end_at),
    versions as (
      select v.platform, v.app_version,
             rank() over (partition by v.platform order by string_to_array(v.app_version, '.')::integer[] desc) as rnk
      from (select distinct a.platform, a.app_version from public.app_installations a) as v)
    select jsonb_build_object(
      'range', p_range,
      'total_active', (select count(*) from active),
      'versions', coalesce((select jsonb_agg(jsonb_build_object(
                                 'platform', x.platform, 'app_version', x.app_version, 'build_number', x.build_number,
                                 'active_installs', x.n, 'share', round(x.n::numeric / nullif((select count(*) from active), 0), 4),
                                 'push_enabled_share', round(x.push_n::numeric / nullif(x.n, 0), 4),
                                 'old', coalesce((select v.rnk > 3 from versions v where v.platform = x.platform
                                                  and v.app_version = x.app_version), false))
                               order by x.platform, x.n desc)
                            from (select a.platform, a.app_version, a.build_number, count(*) as n,
                                         count(*) filter (where a.push_enabled) as push_n
                                  from active a group by 1, 2, 3) as x), '[]'::jsonb),
      'os_versions', coalesce((select jsonb_agg(jsonb_build_object('platform', x.platform, 'os_version', x.os_version, 'count', x.n)
                                                order by x.platform, x.n desc)
                               from (select a.platform, coalesce(a.os_version, 'unknown') as os_version, count(*) as n
                                     from active a group by 1, 2) as x), '[]'::jsonb),
      'old_version_share', round((select count(*) from active a join versions v on v.platform = a.platform
                                  and v.app_version = a.app_version where v.rnk > 3)::numeric
                                 / nullif((select count(*) from active), 0), 4),
      'sync_failure_by_provider', coalesce((select jsonb_agg(jsonb_build_object('provider', x.provider, 'finished', x.finished,
                                                                                'failure_rate', round(x.failed::numeric / nullif(x.finished, 0), 4))
                                                             order by x.provider)
                                            from (select c.provider, count(*) as finished,
                                                         count(*) filter (where j.status in ('failed', 'dead_letter')) as failed
                                                  from public.jobs j join public.connected_accounts c on c.id = j.connected_account_id
                                                  where j.type in ('initial_sync', 'gmail_sync', 'outlook_sync', 'calendar_sync', 'tasks_sync')
                                                    and j.status in ('completed', 'failed', 'dead_letter')
                                                    and j.updated_at >= w.start_at and j.updated_at < w.end_at
                                                  group by c.provider) as x), '[]'::jsonb)));
end
$$;

-- Last runs of the da_* cron jobs (pg_cron may be absent on a plain PostgreSQL), the worker lag
-- and the last metrics rollup.
create function admin_api.cron_status() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('health.read');
  v_jobs jsonb := '[]'::jsonb;
  v_available boolean := to_regclass('cron.job') is not null;
begin
  if v_available and to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'last_status', r.status, 'last_start', r.start_time, 'last_end', r.end_time,
               'last_duration_ms', round(extract(epoch from (r.end_time - r.start_time)) * 1000),
               'failures_24h', (select count(*) from cron.job_run_details f
                                where f.jobid = j.jobid and f.status = 'failed' and f.start_time > now() - interval '24 hours'))
             order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join lateral (select d.status, d.start_time, d.end_time from cron.job_run_details d
                         where d.jobid = j.jobid order by d.start_time desc limit 1) as r on true
      where j.jobname like 'da\_%'
    $q$ into v_jobs;
  elsif v_available then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active)
                                order by j.jobname), '[]'::jsonb)
      from cron.job j where j.jobname like 'da\_%'
    $q$ into v_jobs;
  end if;
  return jsonb_build_object(
    'available', v_available,
    'jobs', v_jobs,
    'worker_lag_s', (select round(extract(epoch from now() - min(j.run_after)))
                     from public.jobs j where j.status in ('queued', 'retrying') and j.run_after <= now()),
    'running_jobs', (select count(*) from public.jobs j where j.status = 'running'),
    'last_rollup_at', (select max(m.computed_at) from public.metrics_daily m));
end
$$;

-- ═══ ADM-19 · admin users (super admin; last-super-admin trigger applies) ═════════════════════

-- resend-invite, reset-mfa and unlock need a TOTP step-up within the last 10 minutes.
create function private.require_step_up(p_admin public.admin_users) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if not exists (
       select 1 from public.admin_sessions s
       where s.admin_user_id = p_admin.user_id and s.auth_session_id::text = auth.jwt() ->> 'session_id'
         and s.ended_at is null and s.step_up_at > now() - interval '10 minutes') then
    raise exception 'FORBIDDEN' using errcode = '42501', detail = 'step_up_required';
  end if;
end
$$;

create function private.admin_target(p_user uuid, p_self_allowed boolean) returns public.admin_users
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.admin_users;
begin
  select * into a from public.admin_users x where x.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not p_self_allowed and p_user = auth.uid() then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'self_action';
  end if;
  return a;
end
$$;

create function private.end_admin_sessions(p_user uuid, p_reason text) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_count integer;
begin
  update public.admin_sessions s set ended_at = now(), end_reason = p_reason
  where s.admin_user_id = p_user and s.ended_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create function admin_api.admins_list() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.read');
begin
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.user_id, 'email', a.email::text, 'display_name', a.display_name, 'role', a.role, 'status', a.status,
             'last_login_at', a.last_login_at, 'locked', coalesce(a.locked_until > now(), false), 'locked_until', a.locked_until,
             'mfa_enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status::text = 'verified'),
             'invited_at', a.invited_at, 'invite_expires_at', a.invite_expires_at, 'activated_at', a.activated_at,
             'disabled_at', a.disabled_at,
             'active_sessions', (select count(*) from public.admin_sessions s where s.admin_user_id = a.user_id and s.ended_at is null
                                 and s.idle_expires_at > now() and s.absolute_expires_at > now()))
           order by a.status, a.display_name)
    from public.admin_users a), '[]'::jsonb));
end
$$;

-- Records an invite for an auth user that admin-api created (app_metadata.da_kind = admin).
-- p_token_hash = sha256 of the invite token (72 h). An email owned by an app user is rejected.
create function admin_api.admin_invite_record(
  p_user uuid, p_email extensions.citext, p_role public.admin_role, p_display_name text, p_reason text, p_token_hash bytea
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 or p_role is null or p_email is null then
    raise exception 'VALIDATION_FAILED:invite' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u join public.profiles p on p.user_id = u.id where u.email = p_email::text) then
    raise exception 'EMAIL_IN_USE_BY_APP_USER' using errcode = '23514';
  end if;
  if exists (select 1 from public.admin_users x where x.email = p_email or x.user_id = p_user) then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'admin_exists';
  end if;
  insert into public.admin_users (user_id, role, status, display_name, email, invited_by, invite_token_hash, invite_expires_at)
  values (p_user, p_role, 'invited', coalesce(nullif(btrim(p_display_name), ''), split_part(p_email::text, '@', 1)), p_email,
          v_admin.user_id, p_token_hash, now() + interval '72 hours')
  returning * into a;
  perform private.admin_audit(v_admin, 'admin.invited', 'admin_user', a.user_id::text, null, v_reason,
                              jsonb_build_object('role', a.role, 'email_masked', private.mask_email(a.email)));
  return jsonb_build_object('id', a.user_id, 'status', a.status, 'role', a.role, 'invite_expires_at', a.invite_expires_at);
end
$$;

create function admin_api.admin_invite_rotate(p_user uuid, p_token_hash bytea, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
begin
  perform private.require_step_up(v_admin);
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'VALIDATION_FAILED:token' using errcode = '22023';
  end if;
  a := private.admin_target(p_user, false);
  if a.status <> 'invited' then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = a.status::text;
  end if;
  update public.admin_users x
    set invite_token_hash = p_token_hash, invite_expires_at = now() + interval '72 hours', invite_redeemed_at = null
  where x.user_id = a.user_id
  returning * into a;
  perform private.admin_audit(v_admin, 'admin.invite_resent', 'admin_user', a.user_id::text, null, v_reason, '{}'::jsonb);
  return jsonb_build_object('id', a.user_id, 'invite_expires_at', a.invite_expires_at);
end
$$;

create function admin_api.admin_update_role(p_user uuid, p_role public.admin_role, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
  v_before public.admin_role;
begin
  if p_role is null then
    raise exception 'VALIDATION_FAILED:role' using errcode = '22023';
  end if;
  a := private.admin_target(p_user, false);
  v_before := a.role;
  if v_before = p_role then
    return jsonb_build_object('id', a.user_id, 'role', a.role, 'changed', false);
  end if;
  update public.admin_users x set role = p_role where x.user_id = a.user_id returning * into a;
  perform private.admin_audit(v_admin, 'admin.role_changed', 'admin_user', a.user_id::text, null, v_reason,
                              jsonb_build_object('before', v_before, 'after', a.role));
  return jsonb_build_object('id', a.user_id, 'role', a.role, 'changed', true);
end
$$;

-- Status disabled and every session ended; admin-api then bans the auth user.
create function admin_api.admin_disable(p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
  v_sessions integer;
begin
  a := private.admin_target(p_user, false);
  if a.status = 'disabled' then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'disabled';
  end if;
  update public.admin_users x
    set status = 'disabled', disabled_at = now(), disabled_by = v_admin.user_id, disabled_reason = v_reason
  where x.user_id = a.user_id;
  v_sessions := private.end_admin_sessions(a.user_id, 'admin_disabled');
  perform private.admin_audit(v_admin, 'admin.disabled', 'admin_user', a.user_id::text, null, v_reason,
                              jsonb_build_object('from_status', a.status, 'sessions_ended', v_sessions));
  return jsonb_build_object('id', a.user_id, 'status', 'disabled', 'sessions_ended', v_sessions);
end
$$;

-- disabled → active (or back to invited when the invite was never completed); admin-api unbans.
create function admin_api.admin_enable(p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
begin
  a := private.admin_target(p_user, false);
  if a.status <> 'disabled' then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = a.status::text;
  end if;
  update public.admin_users x
    set status = case when x.activated_at is null then 'invited'::public.admin_status else 'active'::public.admin_status end,
        disabled_at = null, disabled_by = null, disabled_reason = null
  where x.user_id = a.user_id
  returning * into a;
  perform private.admin_audit(v_admin, 'admin.enabled', 'admin_user', a.user_id::text, null, v_reason,
                              jsonb_build_object('status', a.status));
  return jsonb_build_object('id', a.user_id, 'status', a.status);
end
$$;

create function admin_api.admin_sessions_revoke_all(p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
  v_sessions integer;
begin
  a := private.admin_target(p_user, true);
  v_sessions := private.end_admin_sessions(a.user_id, 'revoked_by_admin');
  perform private.admin_audit(v_admin, 'admin.sessions_revoked', 'admin_user', a.user_id::text, null, v_reason,
                              jsonb_build_object('sessions_ended', v_sessions));
  return jsonb_build_object('id', a.user_id, 'sessions_ended', v_sessions);
end
$$;

-- SQL half of an MFA reset (idempotent): unused recovery codes invalidated and sessions ended;
-- admin-api then deletes the TOTP factors. Never on the caller's own account.
create function admin_api.admin_mfa_reset(p_user uuid, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
  v_codes integer;
  v_sessions integer;
begin
  perform private.require_step_up(v_admin);
  a := private.admin_target(p_user, false);
  update public.admin_mfa_recovery_codes c set replaced_at = now()
  where c.admin_user_id = a.user_id and c.used_at is null and c.replaced_at is null;
  get diagnostics v_codes = row_count;
  v_sessions := private.end_admin_sessions(a.user_id, 'mfa_reset');
  perform private.admin_audit(v_admin, 'admin.mfa_reset', 'admin_user', a.user_id::text, null, v_reason,
                              jsonb_build_object('recovery_codes_invalidated', v_codes, 'sessions_ended', v_sessions));
  return jsonb_build_object('id', a.user_id, 'recovery_codes_invalidated', v_codes, 'sessions_ended', v_sessions);
end
$$;

-- Clears a sign-in lock and the failure counters of the admin's email hash (computed by admin-api
-- with PII_LOOKUP_PEPPER, the same value login_attempt_record receives).
create function admin_api.admin_unlock(p_user uuid, p_reason text, p_email_hash text default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  v_reason text := private.admin_require_reason(p_reason);
  a public.admin_users;
begin
  perform private.require_step_up(v_admin);
  a := private.admin_target(p_user, false);
  if a.locked_until is null or a.locked_until <= now() then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'not_locked';
  end if;
  update public.admin_users x set locked_until = null where x.user_id = a.user_id;
  if p_email_hash is not null then
    delete from public.rate_limits r
    where r.key in ('bo_login_email:' || p_email_hash, 'bo_login_email_day:' || p_email_hash, 'bo_otp_send:' || p_email_hash);
  end if;
  perform private.admin_audit(v_admin, 'admin.unlocked', 'admin_user', a.user_id::text, null, v_reason,
                              jsonb_build_object('counters_cleared', p_email_hash is not null));
  return jsonb_build_object('id', a.user_id, 'locked', false);
end
$$;

-- ═══ ADM-20 · settings and plan limits ════════════════════════════════════════════════════════

-- app_settings (never the gateway digest) and plan_limits; any active admin.
create function admin_api.settings_get() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(null);
begin
  return jsonb_build_object(
    'app_settings', coalesce((select jsonb_object_agg(s.key, jsonb_build_object('value', s.value, 'description', s.description,
                                                                                'updated_by', s.updated_by, 'updated_at', s.updated_at))
                              from public.app_settings s where s.key <> 'admin.gateway_secret_sha256'), '{}'::jsonb),
    'plan_limits', coalesce((select jsonb_object_agg(p.plan, p.limits)
                             from (select l.plan, jsonb_object_agg(l.key, l.value) as limits
                                   from public.plan_limits l group by l.plan) as p), '{}'::jsonb));
end
$$;

-- Whitelisted keys only (the existing rows minus the gateway digest); values are validated by
-- private.valid_app_setting, whose session bounds (idle ≤ 30 min, absolute ≤ 12 h) only allow
-- tightening the security baseline.
create function admin_api.settings_update(p_key text, p_value jsonb, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('settings.system.write');
  v_reason text := private.admin_require_reason(p_reason);
  s public.app_settings;
  v_before jsonb;
begin
  if p_key is null or p_key = 'admin.gateway_secret_sha256' then
    raise exception 'VALIDATION_FAILED:key' using errcode = '22023';
  end if;
  select * into s from public.app_settings x where x.key = p_key for update;
  if not found then
    raise exception 'VALIDATION_FAILED:key' using errcode = '22023';
  end if;
  if not private.valid_app_setting(p_key, p_value) then
    raise exception 'VALIDATION_FAILED:value' using errcode = '22023';
  end if;
  v_before := s.value;
  update public.app_settings x set value = p_value, updated_by = v_admin.user_id where x.key = p_key returning * into s;
  perform private.admin_audit(v_admin, 'settings.system_updated', 'app_setting', p_key, null, v_reason,
                              jsonb_build_object('before', v_before, 'after', s.value));
  return jsonb_build_object('key', s.key, 'value', s.value, 'updated_at', s.updated_at);
end
$$;

create function admin_api.plan_limits_list() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin_any(null);
begin
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('plan', l.plan, 'key', l.key, 'value', l.value, 'updated_by', l.updated_by,
                                        'updated_at', l.updated_at) order by l.key, l.plan)
    from public.plan_limits l), '[]'::jsonb));
end
$$;

create function admin_api.plan_limits_update(p_plan text, p_key text, p_value jsonb, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('settings.system.write');
  v_reason text := private.admin_require_reason(p_reason);
  l public.plan_limits;
  v_before jsonb;
begin
  select * into l from public.plan_limits x where x.plan = p_plan and x.key = p_key for update;
  if not found then
    raise exception 'VALIDATION_FAILED:key' using errcode = '22023';
  end if;
  if not private.valid_plan_limit(p_key, p_value) then
    raise exception 'VALIDATION_FAILED:value' using errcode = '22023';
  end if;
  v_before := l.value;
  update public.plan_limits x set value = p_value, updated_by = v_admin.user_id
  where x.plan = p_plan and x.key = p_key
  returning * into l;
  perform private.admin_audit(v_admin, case when p_key = 'ai_routing_profile' then 'ai.routing_profile_changed'
                                            else 'plan_limits.updated' end,
                              'plan_limit', p_plan || ':' || p_key, null, v_reason,
                              jsonb_build_object('plan', p_plan, 'key', p_key, 'before', v_before, 'after', l.value));
  return jsonb_build_object('plan', l.plan, 'key', l.key, 'value', l.value, 'updated_at', l.updated_at);
end
$$;

-- ═══ ADM-21 · command palette (exact matches only; never a content search) ════════════════════

create function admin_api.command_search(p_q text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('search.global');
  v_q text := btrim(coalesce(p_q, ''));
  v_results jsonb := '[]'::jsonb;
  v_uuid uuid;
begin
  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_q::uuid;
    if private.admin_can(v_admin, 'users.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object(
                                   'type', 'user', 'id', p.user_id, 'label', private.admin_user_label(p.user_id) ->> 'email_masked',
                                   'route', '/users/' || p.user_id))
                                 from public.profiles p where p.user_id = v_uuid), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'jobs.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'job', 'id', j.id,
                                                                               'label', j.type::text || ' · ' || j.status::text,
                                                                               'route', '/jobs/' || j.id))
                                          from public.jobs j where j.id = v_uuid or j.correlation_id = v_uuid), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'support.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'ticket', 'id', t.id, 'label', t.public_ref,
                                                                               'route', '/support/' || t.id))
                                          from public.support_tickets t where t.id = v_uuid), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'integrations.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'integration', 'id', c.id,
                                                                               'label', c.provider::text || ' · ' || private.mask_email(c.account_email),
                                                                               'route', '/integrations/' || c.id))
                                          from public.connected_accounts c where c.id = v_uuid), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'subscriptions.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'subscription', 'id', s.user_id,
                                                                               'label', coalesce(s.product_id, 'pro') || ' · ' || s.status::text,
                                                                               'route', '/users/' || s.user_id || '/subscription'))
                                          from public.subscriptions s where s.user_id = v_uuid), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'referrals.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'referral', 'id', r.id, 'label', r.code,
                                                                               'route', '/referrals?id=' || r.id))
                                          from public.referrals r where r.id = v_uuid), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'data_requests.read') then
      v_results := v_results
        || coalesce((select jsonb_agg(jsonb_build_object('type', 'data_request', 'id', e.id, 'label', 'export · ' || e.status::text,
                                                         'route', '/data-requests/export/' || e.id))
                     from public.data_export_requests e where e.id = v_uuid), '[]'::jsonb)
        || coalesce((select jsonb_agg(jsonb_build_object('type', 'data_request', 'id', d.id,
                                                         'label', d.kind::text || ' · ' || d.status::text,
                                                         'route', '/data-requests/' || d.kind::text || '/' || d.id))
                     from public.data_deletion_requests d where d.id = v_uuid), '[]'::jsonb);
    end if;
  elsif v_q ~* '^[0-9a-f]{8}[0-9a-f-]*$' and char_length(v_q) >= 8 then
    if private.admin_can(v_admin, 'users.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object(
                                   'type', 'user', 'id', x.user_id, 'label', private.admin_user_label(x.user_id) ->> 'email_masked',
                                   'route', '/users/' || x.user_id))
                                 from (select p.user_id from public.profiles p where p.user_id::text like lower(v_q) || '%'
                                       order by p.user_id limit 5) as x), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'support.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'ticket', 'id', x.id, 'label', x.public_ref,
                                                                               'route', '/support/' || x.id))
                                          from (select t.id, t.public_ref from public.support_tickets t
                                                where t.id::text like lower(v_q) || '%' order by t.id limit 5) as x), '[]'::jsonb);
    end if;
  elsif v_q ~* '^DA-\d{4}-\d{6}$' then
    if private.admin_can(v_admin, 'support.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'ticket', 'id', t.id, 'label', t.public_ref,
                                                                               'route', '/support/' || t.id))
                                          from public.support_tickets t where t.public_ref = upper(v_q)), '[]'::jsonb);
    end if;
  elsif v_q ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    if private.admin_can(v_admin, 'users.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object(
                                   'type', 'user', 'id', u.id, 'label', private.mask_email(u.email::extensions.citext),
                                   'route', '/users/' || u.id))
                                 from auth.users u join public.profiles p on p.user_id = u.id
                                 where lower(u.email) = lower(v_q)), '[]'::jsonb);
      perform private.admin_audit(v_admin, 'user.lookup_by_email', 'user', null, null, 'command palette exact email lookup',
                                  jsonb_build_object('matched', jsonb_array_length(v_results) > 0));
    end if;
    if private.admin_can(v_admin, 'integrations.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'integration', 'id', x.id,
                                                                               'label', x.provider::text || ' · ' || private.mask_email(x.account_email),
                                                                               'route', '/integrations/' || x.id))
                                          from (select c.id, c.provider, c.account_email from public.connected_accounts c
                                                where c.account_email = v_q::extensions.citext order by c.created_at limit 5) as x),
                                         '[]'::jsonb);
    end if;
  elsif upper(v_q) ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$' then
    if private.admin_can(v_admin, 'referrals.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'referral', 'id', x.id, 'label', x.code,
                                                                               'route', '/referrals?id=' || x.id))
                                          from (select r.id, r.code from public.referrals r where r.code = upper(v_q)
                                                order by r.created_at desc limit 5) as x), '[]'::jsonb);
    end if;
    if private.admin_can(v_admin, 'users.read') then
      v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object(
                                   'type', 'user', 'id', c.user_id, 'label', private.admin_user_label(c.user_id) ->> 'email_masked',
                                   'route', '/users/' || c.user_id))
                                 from public.referral_codes c where c.code = upper(v_q)), '[]'::jsonb);
    end if;
  elsif char_length(v_q) >= 3 and private.admin_can(v_admin, 'subscriptions.read') then
    v_results := v_results || coalesce((select jsonb_agg(jsonb_build_object('type', 'subscription', 'id', s.user_id,
                                                                             'label', coalesce(s.product_id, 'pro') || ' · ' || s.status::text,
                                                                             'route', '/users/' || s.user_id || '/subscription'))
                                        from public.subscriptions s where s.rc_app_user_id = v_q), '[]'::jsonb);
  end if;
  return jsonb_build_object('results', v_results);
end
$$;

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on all functions in schema admin_api from public, anon;
grant execute on all functions in schema admin_api to authenticated;
revoke execute on function
  admin_api.login_preflight(extensions.citext, text, text),
  admin_api.login_attempt_record(extensions.citext, text, text, text, boolean),
  admin_api.invite_redeem(bytea),
  admin_api.health_record(text, text, integer, jsonb, text)
  from authenticated;
grant execute on function
  admin_api.login_preflight(extensions.citext, text, text),
  admin_api.login_attempt_record(extensions.citext, text, text, text, boolean),
  admin_api.invite_redeem(bytea),
  admin_api.health_record(text, text, integer, jsonb, text)
  to service_role;
revoke execute on all functions in schema private from public;
revoke all on private.admin_function_permissions from public;
