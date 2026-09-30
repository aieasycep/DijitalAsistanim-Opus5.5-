-- Backoffice contract gaps (BACKOFFICE_PLAN §5.5, §6.1, §6.3, §6.6, §6.8, §6.10, §10; API_CONTRACTS
-- ADM-01, ADM-02, ADM-05, ADM-07, ADM-08):
--   · the audit action catalogue (private.audit_action_catalogue, §10) and one canonical name per
--     action: every row goes through private.audit_log_append, which now stores the catalogue name
--     for the legacy emitter spellings (e.g. 'pii.reveal' → 'user.pii_revealed');
--   · dashboard_metrics takes a platform filter (ios | android | all) for the user, active-user and
--     push KPIs, and reports the metrics_daily rollup freshness (stale after 30 min, §5.6);
--   · user_reveal_email reveals every PII field §5.5 allows through the user route: email, display
--     name, an integration mailbox email and a ticket contact email of that user;
--   · ai_model_config_list carries the per-profile monthly cost estimate of a typical Pro user;
--   · notification_test_preview (the push-test dialog's quiet-hours preview, R-13);
--   · job_retry_selected (bulk retry of selected jobs with the single-retry guards, per-job skips).

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Audit action catalogue (BACKOFFICE_PLAN §10) ═════════════════════════════════════════════

-- area: the §10 table row; actor: who emits it (admin actions come from admin_api / admin-api).
create view private.audit_action_catalogue as
  select v.action, v.area, v.actor
  from (values
    ('admin.bootstrap', 'admin_auth', 'admin'),
    ('admin.login', 'admin_auth', 'admin'),
    ('admin.login_failed', 'admin_auth', 'system'),
    ('admin.login_denied', 'admin_auth', 'system'),
    ('admin.locked', 'admin_auth', 'system'),
    ('admin.unlocked', 'admin_auth', 'admin'),
    ('admin.mfa_enrolled', 'admin_auth', 'admin'),
    ('admin.mfa_challenge_failed', 'admin_auth', 'admin'),
    ('admin.mfa_recovery_used', 'admin_auth', 'admin'),
    ('admin.mfa_factor_added', 'admin_auth', 'admin'),
    ('admin.mfa_factor_removed', 'admin_auth', 'admin'),
    ('admin.recovery_codes_regenerated', 'admin_auth', 'admin'),
    ('admin.logout', 'admin_auth', 'admin'),
    ('admin.logout_all', 'admin_auth', 'admin'),
    ('admin.session_expired', 'admin_auth', 'admin'),
    ('admin.permission_denied', 'admin_auth', 'admin'),
    ('admin.rate_limited', 'admin_auth', 'admin'),
    ('admin.step_up', 'admin_auth', 'admin'),
    ('admin.invite_redeemed', 'admin_auth', 'system'),
    ('admin.invited', 'admin_mgmt', 'admin'),
    ('admin.invite_resent', 'admin_mgmt', 'admin'),
    ('admin.invite_accepted', 'admin_mgmt', 'admin'),
    ('admin.role_changed', 'admin_mgmt', 'admin'),
    ('admin.disabled', 'admin_mgmt', 'admin'),
    ('admin.enabled', 'admin_mgmt', 'admin'),
    ('admin.mfa_reset', 'admin_mgmt', 'admin'),
    ('admin.sessions_revoked', 'admin_mgmt', 'admin'),
    ('user.lookup_by_email', 'users', 'admin'),
    ('user.pii_revealed', 'users', 'admin'),
    ('user.force_sync', 'users', 'admin'),
    ('user.disabled', 'users', 'admin'),
    ('user.restored', 'users', 'admin'),
    ('user.marked_internal', 'users', 'admin'),
    ('user.unmarked_internal', 'users', 'admin'),
    ('integration.disconnected', 'operations', 'admin'),
    ('integration.watch_renew_requested', 'operations', 'admin'),
    ('job.retried', 'operations', 'admin'),
    ('job.bulk_retried', 'operations', 'admin'),
    ('job.cancelled', 'operations', 'admin'),
    ('briefing.regenerated', 'operations', 'admin'),
    ('push.test_sent', 'operations', 'admin'),
    ('health.run_requested', 'operations', 'admin'),
    ('ai_model_config.updated', 'ai', 'admin'),
    ('ai_model_config.tested', 'ai', 'admin'),
    ('ai_routing_profile.changed', 'ai', 'admin'),
    ('ai_model_price.updated', 'ai', 'admin'),
    ('ai_calibration.activated', 'ai', 'admin'),
    ('prompt.draft_created', 'ai', 'admin'),
    ('prompt.draft_updated', 'ai', 'admin'),
    ('prompt.tested', 'ai', 'admin'),
    ('prompt.activated', 'ai', 'admin'),
    ('prompt.rolled_back', 'ai', 'admin'),
    ('prompt.archived', 'ai', 'admin'),
    ('ai_feedback.comment_revealed', 'ai', 'admin'),
    ('subscription.resync_requested', 'business', 'admin'),
    ('entitlement.granted', 'business', 'admin'),
    ('entitlement.revoked', 'business', 'admin'),
    ('referral.approved', 'business', 'admin'),
    ('referral.rejected', 'business', 'admin'),
    ('referral.rewarded', 'business', 'system'),
    ('ticket.updated', 'support_product', 'admin'),
    ('ticket.assigned', 'support_product', 'admin'),
    ('ticket.note_added', 'support_product', 'admin'),
    ('ticket.reply_sent', 'support_product', 'admin'),
    ('ticket.reply_failed', 'support_product', 'system'),
    ('support_access.granted', 'support_product', 'admin'),
    ('support_access.revoked', 'support_product', 'admin'),
    ('support_access.expired', 'support_product', 'system'),
    ('support_access.content_viewed', 'support_product', 'admin'),
    ('feedback.updated', 'support_product', 'admin'),
    ('feedback.revealed', 'support_product', 'admin'),
    ('flag.created', 'support_product', 'admin'),
    ('flag.updated', 'support_product', 'admin'),
    ('flag.kill_switch_on', 'support_product', 'admin'),
    ('flag.kill_switch_off', 'support_product', 'admin'),
    ('flag.override_added', 'support_product', 'admin'),
    ('flag.override_removed', 'support_product', 'admin'),
    ('flag.archived', 'support_product', 'admin'),
    ('announcement.created', 'support_product', 'admin'),
    ('announcement.updated', 'support_product', 'admin'),
    ('announcement.scheduled', 'support_product', 'admin'),
    ('announcement.cancelled', 'support_product', 'admin'),
    ('data_request.retried', 'privacy_system', 'admin'),
    ('data_request.export_regenerated', 'privacy_system', 'admin'),
    ('data_request.cancelled', 'privacy_system', 'admin'),
    ('settings.system_updated', 'privacy_system', 'admin'),
    ('plan_limits.updated', 'privacy_system', 'admin'),
    ('audit.verified', 'privacy_system', 'admin')
  ) as v (action, area, actor);
comment on view private.audit_action_catalogue is
  'BACKOFFICE_PLAN §10 audit action catalogue. App, worker and system rows outside the admin areas use the '
  'user.*, system.*, security.*, approval.* and privacy.* namespaces (private.audit_action_known).';
revoke all on private.audit_action_catalogue from public;

-- The catalogue name of an emitted action. Legacy spellings of admin_api / admin-api emitters are
-- mapped here (one place), some by their details: 'pii.reveal' by the revealed resource,
-- 'flag.killed' by `on`, 'referral.reviewed' by the decision, 'support.ticket_updated' to
-- 'ticket.assigned' when only the assignee changed. Unknown names pass through unchanged.
create function private.audit_action_canonical(p_action text, p_details jsonb default '{}'::jsonb) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case p_action
      when 'pii.reveal' then
        case when coalesce(p_details, '{}'::jsonb) ? 'grant_id' then 'support_access.content_viewed'
             when p_details ->> 'resource_type' = 'ai_feedback' then 'ai_feedback.comment_revealed'
             when p_details ->> 'resource_type' = 'user_feedback' then 'feedback.revealed'
             else 'user.pii_revealed' end
      when 'admin.pii.revealed' then 'user.pii_revealed'
      when 'user.disable' then 'user.disabled'
      when 'admin.user.disabled' then 'user.disabled'
      when 'user.restore' then 'user.restored'
      when 'admin.user.restored' then 'user.restored'
      when 'admin.user.force_sync' then 'user.force_sync'
      when 'user.internal_flag_changed' then
        case when (p_details ->> 'is_internal')::boolean then 'user.marked_internal' else 'user.unmarked_internal' end
      when 'integration.admin_disconnect' then 'integration.disconnected'
      when 'notifications.test_sent' then 'push.test_sent'
      when 'admin.health.run' then 'health.run_requested'
      when 'admin.job.retried' then 'job.retried'
      when 'ai.model_config_updated' then 'ai_model_config.updated'
      when 'admin.ai.model_probed' then 'ai_model_config.tested'
      when 'ai.routing_profile_changed' then 'ai_routing_profile.changed'
      when 'ai.prices_updated' then 'ai_model_price.updated'
      when 'ai.calibration_activated' then 'ai_calibration.activated'
      when 'prompt.draft_edited' then 'prompt.draft_updated'
      when 'support.note_added' then 'ticket.note_added'
      when 'support.ticket_replied' then 'ticket.reply_sent'
      when 'support.ticket_updated' then
        case when (p_details #>> '{before,assignee}') is distinct from (p_details #>> '{after,assignee}')
                  and (p_details #>> '{before,status}') is not distinct from (p_details #>> '{after,status}')
                  and (p_details #>> '{before,category}') is not distinct from (p_details #>> '{after,category}')
             then 'ticket.assigned' else 'ticket.updated' end
      when 'flag.killed' then
        case when coalesce((p_details ->> 'on')::boolean, true) then 'flag.kill_switch_on' else 'flag.kill_switch_off' end
      when 'flag.override_set' then 'flag.override_added'
      when 'referral.reviewed' then
        case when p_details ->> 'decision' = 'approve' then 'referral.approved' else 'referral.rejected' end
      when 'announcement.published' then 'announcement.scheduled'
      when 'admin.session.step_up' then 'admin.step_up'
      -- The own "sign out everywhere" (scope all | others) vs. a super admin revoking another admin.
      when 'admin.sessions_revoked' then
        case when p_details ->> 'scope' in ('all', 'others') then 'admin.logout_all' else 'admin.sessions_revoked' end
      when 'admin.admin.disabled' then 'admin.disabled'
      when 'admin.admin.enabled' then 'admin.enabled'
      when 'admin.admin.mfa_reset' then 'admin.mfa_reset'
      else p_action
    end
  $$;
revoke execute on function private.audit_action_canonical(text, jsonb) from public;

-- True for a catalogue action or an app / worker / system namespace action.
create function private.audit_action_known(p_action text) returns boolean
  language sql stable
  set search_path = ''
  as $$
    select exists (select 1 from private.audit_action_catalogue c where c.action = p_action)
        or p_action ~ '^(user|system|security|approval|privacy)\.[a-z_]+(\.[a-z_]+){0,2}$'
  $$;
revoke execute on function private.audit_action_known(text) from public;

-- The single audit writer, unchanged except that the stored action is the catalogue name.
create or replace function private.audit_log_append(
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
  v_action text := private.audit_action_canonical(p_action, coalesce(p_details, '{}'::jsonb));
  v_hash bytea;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('da_audit_chain'));
  select a.chain_seq, a.row_hash into v_prev_seq, v_prev_hash
  from public.audit_logs a order by a.chain_seq desc limit 1;
  v_seq := coalesce(v_prev_seq, 0) + 1;
  v_hash := pg_catalog.sha256(coalesce(v_prev_hash, '\x00'::bytea) || convert_to(private.audit_canonical(
    v_seq, v_at, p_actor_type, p_actor_id, p_actor_role, v_action, p_target_type, p_target_id, p_target_user_id,
    p_reason, p_result, v_details, p_correlation_id), 'UTF8'));
  insert into public.audit_logs (
    chain_seq, occurred_at, actor_type, actor_id, actor_role, action, target_type, target_id, target_user_id,
    reason, result, details, correlation_id, ip_hash, prev_hash, row_hash)
  values (
    v_seq, v_at, p_actor_type, p_actor_id, p_actor_role, v_action, p_target_type, p_target_id, p_target_user_id,
    p_reason, p_result, v_details, p_correlation_id, p_ip_hash, v_prev_hash, v_hash)
  returning id into v_id;
  return v_id;
end
$$;

-- ═══ ADM-01 · dashboard: platform filter and rollup freshness ════════════════════════════════

-- The platform-scoped KPIs (BACKOFFICE_PLAN §6.1: the platform applies to the user, active-user
-- and push KPIs). A user belongs to a platform when they have an installation on it; active users
-- are app_opened events from that platform; push counts notifications with a ticket to a device
-- of that platform. Every other KPI is the all-platform value.
create function private.dashboard_kpis(p_start timestamptz, p_end timestamptz, p_platform text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    with pop as (select m.user_id from private.metric_population() as m),
    plat as (select pop.user_id from pop
             where exists (select 1 from public.app_installations i
                           where i.user_id = pop.user_id and i.platform::text = p_platform))
    select case when coalesce(p_platform, 'all') = 'all' then private.dashboard_kpis(p_start, p_end)
    else private.dashboard_kpis(p_start, p_end) || jsonb_build_object(
      'total_users', (select count(*) from public.profiles p join plat using (user_id) where p.created_at < p_end),
      'new_users', (select count(*) from public.profiles p join plat using (user_id)
                    where p.created_at >= p_start and p.created_at < p_end),
      'active_users', (select count(distinct e.user_id) from public.analytics_events e join pop using (user_id)
                       where e.event_name = 'app_opened' and e.platform = p_platform
                         and e.occurred_at >= p_start and e.occurred_at < p_end),
      'push_sent', (select count(distinct n.id) from public.notifications n join pop using (user_id)
                    join public.push_tickets pt on pt.notification_id = n.id
                    join public.push_tokens tk on tk.id = pt.push_token_id
                    join public.app_installations i on i.id = tk.installation_id
                    where n.decision = 'sent' and n.sent_at >= p_start and n.sent_at < p_end and not n.is_test
                      and i.platform::text = p_platform))
    end
  $$;
revoke execute on function private.dashboard_kpis(timestamptz, timestamptz, text) from public;

-- metrics_daily freshness: the rollup runs every 15 min from scheduler_tick (§7.6); older than
-- 30 min (or never computed) is stale (§5.6 "Son güncelleme {relative}.").
create function private.metrics_rollup_state(p_now timestamptz default now()) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object('last_computed_at', r.at,
                              'stale', r.at is null or r.at < p_now - interval '30 minutes',
                              'expected_every_minutes', 15)
    from (select max(m.computed_at) as at from public.metrics_daily m) as r
  $$;
revoke execute on function private.metrics_rollup_state(timestamptz) from public;

drop function admin_api.dashboard_metrics(text);
create function admin_api.dashboard_metrics(p_range text, p_platform text default 'all') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('dashboard.read');
  v_platform text := coalesce(p_platform, 'all');
  w record;
  v_cur jsonb;
  v_prev jsonb;
begin
  if v_platform not in ('all', 'ios', 'android') then
    raise exception 'VALIDATION_FAILED:platform' using errcode = '22023';
  end if;
  select * into w from private.metric_window(p_range);
  v_cur := private.dashboard_kpis(w.start_at, w.end_at, v_platform);
  v_prev := private.dashboard_kpis(w.prev_start_at, w.start_at, v_platform);
  return jsonb_build_object('range', p_range, 'platform', v_platform, 'start_at', w.start_at, 'end_at', w.end_at,
                            'source', 'raw', 'computed_at', now(), 'value', v_cur, 'prev_value', v_prev,
                            'rollup', private.metrics_rollup_state(now()),
                            'ai_cost_per_active_user', case when (v_cur ->> 'active_users')::numeric > 0
                              then round((v_cur ->> 'ai_cost_usd')::numeric / (v_cur ->> 'active_users')::numeric, 4) end);
end
$$;

-- ═══ ADM-02 · reveal: every PII field §5.5 allows through the user route ═════════════════════

-- field ∈ email | display_name | integration_email:<account id> | ticket_contact_email:<ticket id>;
-- the account or ticket must belong to the user. Audited as user.pii_revealed with the field kind.
create or replace function admin_api.user_reveal_email(p_user uuid, p_reason text, p_field text default 'email')
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.pii.reveal');
  v_reason text := private.admin_require_reason(p_reason);
  v_field text := coalesce(p_field, 'email');
  v_kind text := split_part(v_field, ':', 1);
  v_ref text := nullif(split_part(v_field, ':', 2), '');
  v_value text;
begin
  perform private.admin_assert_user(p_user);
  if v_kind in ('email', 'display_name') and v_ref is not null
     or v_kind in ('integration_email', 'ticket_contact_email')
        and (v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'VALIDATION_FAILED:field' using errcode = '22023';
  end if;
  if v_kind = 'email' then
    select u.email into v_value from auth.users u where u.id = p_user;
  elsif v_kind = 'display_name' then
    select p.display_name into v_value from public.profiles p where p.user_id = p_user;
  elsif v_kind = 'integration_email' then
    select ca.account_email::text into v_value from public.connected_accounts ca
    where ca.id = v_ref::uuid and ca.user_id = p_user;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif v_kind = 'ticket_contact_email' then
    select t.contact_email::text into v_value from public.support_tickets t
    where t.id = v_ref::uuid and t.user_id = p_user;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    raise exception 'VALIDATION_FAILED:field' using errcode = '22023';
  end if;
  perform private.admin_audit(v_admin, 'user.pii_revealed', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('field', v_kind, 'resource_type', 'user', 'resource_id', v_ref));
  return jsonb_build_object('value', v_value, 'expires_in_s', 60);
end
$$;

-- ═══ ADM-08 · model config: the per-profile cost estimate of a typical Pro user ═════════════════

-- Monthly AI cost of a typical Pro user under each routing profile (BACKOFFICE_PLAN §6.10): the
-- average 30-day request mix per active Pro user (ai_metrics_daily requests / distinct Pro users in
-- ai_requests) priced with each profile's cost per request per feature over the same window.
-- `coverage` is the share of that mix whose feature has a price under the profile; no Pro traffic
-- or no priced feature → monthly_usd null (the UI shows "—", never a made-up figure).
create function private.ai_profile_cost_estimates(p_now timestamptz default now()) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    with w as (select p_now - interval '30 days' as start_at),
    users as (select count(distinct r.user_id)::numeric as n from public.ai_requests r cross join w
              where r.plan = 'pro' and r.user_id is not null and r.created_at >= w.start_at and r.created_at < p_now),
    mix as (select m.feature, sum(m.requests)::numeric as requests from public.ai_metrics_daily m cross join w
            where m.plan = 'pro' and m.day >= w.start_at::date and m.status not in ('budget_blocked', 'killed')
            group by m.feature),
    unit as (select m.profile, m.feature, sum(m.cost_usd_micros)::numeric / nullif(sum(m.requests), 0) as per_request
             from public.ai_metrics_daily m cross join w
             where m.profile is not null and m.day >= w.start_at::date and m.status not in ('budget_blocked', 'killed')
             group by m.profile, m.feature),
    est as (select p.profile, sum(x.requests * u.per_request) as micros,
                   sum(x.requests) filter (where u.per_request is not null) as covered, sum(x.requests) as total
            from unnest(enum_range(null::public.routing_profile)) as p (profile)
            cross join mix as x
            left join unit as u on u.profile = p.profile and u.feature = x.feature
            group by p.profile)
    select coalesce(jsonb_object_agg(p.profile::text, jsonb_build_object(
             'monthly_usd', case when (select n from users) > 0 and coalesce(e.covered, 0) > 0
                                 then round(e.micros / (select n from users) / 1000000.0, 4) end,
             'coverage', case when e.total > 0 then round(coalesce(e.covered, 0) / e.total, 4) end,
             'pro_users', (select n from users)::integer,
             'window_days', 30)), '{}'::jsonb)
    from unnest(enum_range(null::public.routing_profile)) as p (profile)
    left join est as e on e.profile = p.profile
  $$;
revoke execute on function private.ai_profile_cost_estimates(timestamptz) from public;

create or replace function admin_api.ai_model_config_list() returns jsonb
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
    'profile_costs', private.ai_profile_cost_estimates(now()),
    'provider_health', coalesce((select jsonb_object_agg(h.component, jsonb_build_object('status', h.status, 'checked_at', h.checked_at))
                                 from (select distinct on (s.component) s.component, s.status, s.checked_at
                                       from public.system_health_checks s
                                       where s.component in ('ai_anthropic', 'ai_openai', 'ai_voyage')
                                       order by s.component, s.checked_at desc) as h), '{}'::jsonb));
end
$$;

-- ═══ ADM-07 · push test: the quiet-hours preview (R-13) ═══════════════════════════════════════

-- What a test push would do right now: the user's local time, whether it falls in their quiet
-- hours (the test is then scheduled for the quiet-hours end, never sent at once) and how many
-- active devices would receive it. No token, no content.
create function admin_api.notification_test_preview(p_user uuid, p_installation uuid default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('push.test');
  v_now timestamptz := now();
  v_tz text;
  v_until timestamptz;
begin
  perform private.admin_assert_user(p_user);
  if p_installation is not null and not exists (select 1 from public.app_installations i
                                                where i.id = p_installation and i.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_tz := coalesce((select up.timezone from public.user_preferences up where up.user_id = p_user), 'Europe/Istanbul');
  v_until := private.quiet_hours_until(p_user, v_now);
  return jsonb_build_object(
    'timezone', v_tz,
    'local_time', to_char(v_now at time zone v_tz, 'HH24:MI'),
    'in_quiet_hours', v_until is not null,
    'quiet_hours_end_local', case when v_until is not null then to_char(v_until at time zone v_tz, 'HH24:MI') end,
    'deferred_until', v_until,
    'active_devices', (select count(*) from public.push_tokens t
                       join public.app_installations i on i.id = t.installation_id
                       where t.user_id = p_user and t.status = 'active' and i.signed_out_at is null
                         and (p_installation is null or i.id = p_installation)));
end
$$;

-- ═══ ADM-05 · bulk retry of selected jobs (§6.6 row selection) ════════════════════════════════

-- Each selected job goes through the single-retry guards (status failed | dead_letter, the type's
-- admin policy and manual-retry cap); the others are skipped with a reason key. One job.retried
-- row per retried job (the cap counts them) and one job.bulk_retried summary row.
create function admin_api.job_retry_selected(p_job_ids uuid[], p_reason text) returns jsonb
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
  v_retried jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if p_job_ids is null or cardinality(p_job_ids) not between 1 and 100 then
    raise exception 'VALIDATION_FAILED:job_ids' using errcode = '22023';
  end if;
  for j in select * from public.jobs x where x.id = any(p_job_ids) order by x.id for update loop
    if j.status not in ('failed', 'dead_letter') then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', j.id, 'reason_key', 'invalid_state'));
      continue;
    end if;
    v_policy := private.job_admin_policy(j.type);
    select count(*) into v_manual from public.audit_logs a where a.action = 'job.retried' and a.target_id = j.id::text;
    if not (v_policy ->> 'retryable_by_admin')::boolean or v_manual >= (v_policy ->> 'max_manual_retries')::integer then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', j.id, 'reason_key', 'max_manual_retries'));
      continue;
    end if;
    update public.jobs x
      set status = 'queued', run_after = now(), dead_lettered_at = null, lease_owner = null, lease_expires_at = null,
          max_attempts = least(x.max_attempts + 1, 20)
    where x.id = j.id;
    perform private.admin_audit(v_admin, 'job.retried', 'job', j.id::text, j.user_id, v_reason,
                                jsonb_build_object('type', j.type, 'from_status', j.status, 'reset_attempts', false,
                                                   'bulk', true));
    v_retried := v_retried || jsonb_build_array(j.id);
  end loop;
  v_skipped := v_skipped || coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'reason_key', 'not_found'))
                                      from (select distinct u.id from unnest(p_job_ids) as u (id)
                                            where not exists (select 1 from public.jobs x where x.id = u.id)) as q),
                                     '[]'::jsonb);
  perform private.admin_audit(v_admin, 'job.bulk_retried', 'job', null, null, v_reason,
                              jsonb_build_object('mode', 'selection', 'retried', jsonb_array_length(v_retried),
                                                 'skipped', jsonb_array_length(v_skipped), 'job_ids', v_retried));
  return jsonb_build_object('retried', v_retried, 'skipped', v_skipped);
end
$$;


-- ═══ Function → permission map: the two new admin_api functions (pgTAP 120 is table-driven) ════

create or replace view private.admin_function_permissions as
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
    ('command_search', array['search.global'], false, 'session'),
    ('ticket_patch', array['support.write'], false, 'session'),
    ('ticket_reply', array['support.write'], false, 'session'),
    ('notification_test_preview', array['push.test'], false, 'session'),
    ('job_retry_selected', array['jobs.retry'], false, 'session')
  ) as v (function_name, permissions, all_permissions, guard);

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on function
  admin_api.dashboard_metrics(text, text),
  admin_api.notification_test_preview(uuid, uuid),
  admin_api.job_retry_selected(uuid[], text)
  from public, anon;
grant execute on function
  admin_api.dashboard_metrics(text, text),
  admin_api.notification_test_preview(uuid, uuid),
  admin_api.job_retry_selected(uuid[], text)
  to authenticated;
revoke all on private.admin_function_permissions from public;
