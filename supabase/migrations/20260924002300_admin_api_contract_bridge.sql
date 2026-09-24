-- Migration · admin-api contract bridge (IMPLEMENTATION_PLAN T-10.01, T-10.05…T-10.14)
-- Spec: docs/API_CONTRACTS.md §12.3 (ADM-00…ADM-21 output shapes, authoritative per R-20),
-- docs/BACKOFFICE_PLAN.md §2.5–§2.6, §3.7, §6, §7, §16 #4; packages/validation/src/admin/*.
--
-- The admin_api layer of 20260924001320 predates a few ADM contract fields. This migration closes
-- those gaps without changing any function name the admin-api Edge Function or the pgTAP suites
-- already use:
--   · admin_preferences gains timezone, density, recent_items and sidebar_collapsed (BACKOFFICE_PLAN
--     §16 #4); admin_preferences_set accepts them.
--   · ticket_detail returns every note with its kind (support_notes.kind from 0022 public_api;
--     author-less inbound notes included); ticket_patch (status, category, assignee incl.
--     unassign) and ticket_reply (outbound_reply note + transactional_email job, JOB-31) are new.
--   · dashboard KPIs gain reconnect_rate; chart and AI cost series return timestamptz buckets;
--     security_events returns the ADM-01 counters and per-admin counts.
--   · user_force_sync accepts the resources filter and returns the job types.
--   · briefings_list / briefings_metrics expose narrative_mode and template_fallback_rate (read
--     through to_jsonb, so they work before and after briefings.narrative_mode exists).
--   · notification_send_test reserves the notification id and predicts the quiet-hours deferral
--     (R-13: the test push never bypasses quiet hours).
--   · feedback_update returns the full feedback row; integration_detail returns the 24 h webhook
--     stats; app_versions_breakdown reports per-version sync error rates and the minimum version.
--   · app_settings accepts the ADM-20 keys app.min_supported_version and google.calendar_write_scope
--     (private.valid_app_setting keeps every earlier key).
-- Every replaced function keeps its guard as the first statement and its audit row in the same
-- transaction.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ ADM-00 · admin preferences (BACKOFFICE_PLAN §16 #4) ══════════════════════════════════════

alter table public.admin_preferences
  add column if not exists timezone text not null default 'Europe/Istanbul',
  add column if not exists density text not null default 'comfortable',
  add column if not exists recent_items jsonb not null default '[]'::jsonb,
  add column if not exists sidebar_collapsed boolean not null default false;
comment on column public.admin_preferences.timezone is 'IANA zone used to render backoffice timestamps (validated by admin_preferences_set).';
comment on column public.admin_preferences.density is 'Table density: comfortable | compact (validated by admin_preferences_set).';
comment on column public.admin_preferences.recent_items is 'Command-palette recents: at most 10 {type, id, label (masked)} entries.';
comment on column public.admin_preferences.sidebar_collapsed is 'Sidebar collapsed state.';

drop function admin_api.admin_preferences_set(text, text, jsonb, text);

create function admin_api.admin_preferences_set(
  p_theme text default null, p_locale text default null, p_table_prefs jsonb default null, p_dashboard_range text default null,
  p_timezone text default null, p_density text default null, p_recent_items jsonb default null,
  p_sidebar_collapsed boolean default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.admin_guard(null);
begin
  if p_theme is not null and p_theme not in ('light', 'dark', 'system') then
    raise exception 'VALIDATION_FAILED:theme' using errcode = '22023';
  end if;
  if p_locale is not null and p_locale not in ('tr-TR', 'en-US', 'tr', 'en') then
    raise exception 'VALIDATION_FAILED:locale' using errcode = '22023';
  end if;
  if p_table_prefs is not null and jsonb_typeof(p_table_prefs) <> 'object' then
    raise exception 'VALIDATION_FAILED:table_prefs' using errcode = '22023';
  end if;
  if p_dashboard_range is not null and p_dashboard_range not in ('24h', '7d', '30d', '90d') then
    raise exception 'VALIDATION_FAILED:dashboard_range' using errcode = '22023';
  end if;
  if p_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'VALIDATION_FAILED:timezone' using errcode = '22023';
  end if;
  if p_density is not null and p_density not in ('comfortable', 'compact') then
    raise exception 'VALIDATION_FAILED:density' using errcode = '22023';
  end if;
  if p_recent_items is not null
     and (jsonb_typeof(p_recent_items) <> 'array' or jsonb_array_length(p_recent_items) > 10) then
    raise exception 'VALIDATION_FAILED:recent_items' using errcode = '22023';
  end if;
  insert into public.admin_preferences (admin_user_id) values (v_admin.user_id) on conflict (admin_user_id) do nothing;
  update public.admin_preferences ap
    set theme = coalesce(p_theme, ap.theme),
        locale = coalesce(case p_locale when 'tr' then 'tr-TR' when 'en' then 'en-US' else p_locale end, ap.locale),
        table_prefs = coalesce(p_table_prefs, ap.table_prefs),
        dashboard_range = coalesce(p_dashboard_range, ap.dashboard_range),
        timezone = coalesce(p_timezone, ap.timezone),
        density = coalesce(p_density, ap.density),
        recent_items = coalesce(p_recent_items, ap.recent_items),
        sidebar_collapsed = coalesce(p_sidebar_collapsed, ap.sidebar_collapsed)
  where ap.admin_user_id = v_admin.user_id;
  return (select to_jsonb(ap) - 'admin_user_id' from public.admin_preferences ap where ap.admin_user_id = v_admin.user_id);
end
$$;

-- ═══ ADM-03 · ticket detail, patch, note and reply (API_CONTRACTS §12.3, §15) ═══════════════
-- `support_notes.kind` (internal | outbound_reply | inbound_reply | system) and the nullable
-- author come from 20260924002220_public_api.sql; admin notes are `internal`, e-mailed replies
-- `outbound_reply`.

-- One ticket as the ADM-03 list row (masked contact email, no message).
create function private.admin_ticket_row(t public.support_tickets) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'id', t.id, 'reference', t.public_ref, 'category', t.category, 'status', t.status, 'priority', t.priority,
      'subject', t.subject, 'platform', t.platform, 'app_version', t.app_version, 'origin', t.origin,
      'assignee', t.assigned_admin_id, 'created_at', t.created_at, 'updated_at', t.updated_at,
      'contact_email_masked', private.mask_email(t.contact_email), 'user_id', t.user_id)
  $$;

create or replace function admin_api.ticket_detail(p_id uuid) returns jsonb
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
  return private.admin_ticket_row(t) || jsonb_build_object(
    'user', case when t.user_id is not null then private.admin_user_label(t.user_id) end,
    'message', t.message, 'first_response_at', t.first_response_at, 'resolved_at', t.resolved_at, 'closed_at', t.closed_at,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'author_admin_id', n.author_admin_id,
                                                          'author', a.display_name, 'body', n.body, 'created_at', n.created_at)
                                        order by n.created_at, n.id)
                       from public.support_notes n left join public.admin_users a on a.user_id = n.author_admin_id
                       where n.ticket_id = t.id), '[]'::jsonb));
end
$$;

-- Internal note (kind internal); returns the id and the creation time.
create or replace function admin_api.ticket_add_note(p_id uuid, p_body text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.write');
  t public.support_tickets;
  v_note uuid;
  v_created timestamptz;
begin
  select * into t from public.support_tickets x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 5000 then
    raise exception 'VALIDATION_FAILED:body' using errcode = '22023';
  end if;
  insert into public.support_notes (ticket_id, user_id, author_admin_id, body, kind)
  values (t.id, t.user_id, v_admin.user_id, p_body, 'internal')
  returning id, created_at into v_note, v_created;
  perform private.admin_audit(v_admin, 'support.note_added', 'support_ticket', t.id::text, t.user_id, 'internal support note',
                              jsonb_build_object('note_id', v_note));
  return jsonb_build_object('note_id', v_note, 'created_at', v_created);
end
$$;

-- PATCH /support/tickets/:id: status, category and assignee (p_unassign clears it). Returns the
-- list row. The contract carries no reason, so the audit row states the edit itself.
create function admin_api.ticket_patch(
  p_id uuid, p_status public.ticket_status default null, p_category public.ticket_category default null,
  p_assignee uuid default null, p_unassign boolean default false
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.write');
  t public.support_tickets;
  v_before jsonb;
begin
  select * into t from public.support_tickets x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_status is null and p_category is null and p_assignee is null and not coalesce(p_unassign, false) then
    raise exception 'VALIDATION_FAILED:fields' using errcode = '22023';
  end if;
  if p_assignee is not null and not exists (select 1 from public.admin_users a where a.user_id = p_assignee and a.status = 'active') then
    raise exception 'VALIDATION_FAILED:assignee' using errcode = '22023';
  end if;
  v_before := jsonb_build_object('status', t.status, 'category', t.category, 'assignee', t.assigned_admin_id);
  update public.support_tickets x
    set status = coalesce(p_status, x.status),
        category = coalesce(p_category, x.category),
        assigned_admin_id = case when coalesce(p_unassign, false) then null else coalesce(p_assignee, x.assigned_admin_id) end,
        first_response_at = case when coalesce(p_status, x.status) <> 'open' then coalesce(x.first_response_at, now())
                                 else x.first_response_at end,
        resolved_at = case when p_status = 'resolved' then coalesce(x.resolved_at, now()) else x.resolved_at end,
        closed_at = case when p_status = 'closed' then coalesce(x.closed_at, now()) else x.closed_at end
  where x.id = p_id
  returning * into t;
  perform private.admin_audit(v_admin, 'support.ticket_updated', 'support_ticket', t.id::text, t.user_id,
                              'support ticket fields updated',
                              jsonb_build_object('before', v_before,
                                                 'after', jsonb_build_object('status', t.status, 'category', t.category,
                                                                             'assignee', t.assigned_admin_id)));
  return private.admin_ticket_row(t);
end
$$;

-- POST /support/tickets/:id/reply: a reply note plus the transactional_email job (JOB-31) that
-- resolves the contact address at send time (the payload never holds an address). The admin-api
-- checks the email credential before calling this function.
create function admin_api.ticket_reply(p_id uuid, p_body text, p_locale text default 'tr') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.write');
  t public.support_tickets;
  v_note uuid;
  v_created timestamptz;
  v_job uuid;
begin
  select * into t from public.support_tickets x where x.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 5000 then
    raise exception 'VALIDATION_FAILED:body' using errcode = '22023';
  end if;
  if coalesce(p_locale, 'tr') not in ('tr', 'en') then
    raise exception 'VALIDATION_FAILED:locale' using errcode = '22023';
  end if;
  if t.contact_email is null then
    raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'no_contact_email';
  end if;
  insert into public.support_notes (ticket_id, user_id, author_admin_id, body, kind)
  values (t.id, t.user_id, v_admin.user_id, p_body, 'outbound_reply')
  returning id, created_at into v_note, v_created;
  update public.support_tickets x
    set first_response_at = coalesce(x.first_response_at, now()),
        status = case when x.status in ('open', 'in_progress') then 'waiting_user'::public.ticket_status else x.status end
  where x.id = t.id;
  v_job := private.enqueue_job('transactional_email', 'transactional_email:support_reply:' || t.id || ':' || v_note,
                               jsonb_build_object('template_key', 'support_reply',
                                                  'recipient_ref', jsonb_build_object('type', 'support_ticket', 'id', t.id),
                                                  'locale', coalesce(p_locale, 'tr'),
                                                  'params', jsonb_build_object('reference', t.public_ref, 'note_id', v_note)),
                               t.user_id, null, now(), 20, 5, null);
  perform private.admin_audit(v_admin, 'support.ticket_replied', 'support_ticket', t.id::text, t.user_id,
                              'support reply sent to the ticket contact', jsonb_build_object('note_id', v_note, 'job_id', v_job));
  return jsonb_build_object('note_id', v_note, 'email_job_id', v_job, 'created_at', v_created);
end
$$;


-- ═══ ADM-01 · dashboard: reconnect rate and timestamptz chart buckets ═══════════════════════

create or replace function private.dashboard_kpis(p_start timestamptz, p_end timestamptz) returns jsonb
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
                              where m.created_at >= p_start and m.created_at < p_end),
      -- BACKOFFICE_PLAN §7.4: accounts that needed a reconnect in the window and are healthy again.
      'reconnect_rate', (select case when count(*) = 0 then null
                                     else round(count(*) filter (where ca.status = 'healthy')::numeric / count(*), 4) end
                         from public.connected_accounts ca join pop using (user_id)
                         where ca.reauth_required_at >= p_start and ca.reauth_required_at < p_end))
  $$;

create or replace function admin_api.dashboard_series(p_metric text, p_range text) returns jsonb
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
    select jsonb_agg(jsonb_build_object('t', b.t at time zone v_tz, 'value', b.value, 'breakdown', b.breakdown) order by b.t)
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


-- Stacked AI cost series with timestamptz buckets: the start of the reporting-timezone hour (24h)
-- or day; 24h/7d read raw ai_requests, 30d/90d ai_metrics_daily (BACKOFFICE_PLAN §7.6).
create or replace function admin_api.ai_cost_series(p_range text, p_split text default 'feature') returns jsonb
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
    select coalesce(jsonb_agg(jsonb_build_object('t', x.t at time zone v_tz, 'key', x.key, 'requests', x.requests,
                                                 'cost_usd', round(x.cost / 1e6, 6)) order by x.t, x.key), '[]'::jsonb)
    into v_points
    from (select case when p_range = '24h' then date_trunc('hour', r.created_at at time zone v_tz)
                      else date_trunc('day', r.created_at at time zone v_tz) end as t,
                 case when p_split = 'feature' then r.feature::text else r.model end as key,
                 count(*) as requests, sum(r.cost_usd_micros) as cost
          from public.ai_requests r
          where r.created_at >= w.start_at and r.created_at < w.end_at
          group by 1, 2) as x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('t', x.t at time zone v_tz, 'key', x.key, 'requests', x.requests,
                                                 'cost_usd', round(x.cost / 1e6, 6)) order by x.t, x.key), '[]'::jsonb)
    into v_points
    from (select m.day::timestamp as t,
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

-- ADM-01 security panel: the counters of the contract plus the per-admin counts (actor, or the
-- target admin for sign-in failures and lockouts); `events` keeps the per-action breakdown.
create or replace function admin_api.security_events(p_range text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('admins.manage');
  w record;
begin
  select * into w from private.metric_window(p_range);
  return (
    with ev as (
      select a.action, a.actor_id,
             case when a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then a.target_id::uuid end
               as target_uuid
      from public.audit_logs a
      where a.occurred_at >= w.start_at and a.occurred_at < w.end_at
        and a.action in ('admin.login_failed', 'admin.locked', 'admin.mfa_recovery_used', 'admin.mfa_reset',
                         'admin.role_changed', 'admin.disabled', 'admin.permission_denied', 'support_access.granted',
                         'security.webhook_rejected', 'security.oauth_state_replay', 'security.oauth_binding_mismatch'))
    select jsonb_build_object(
      'range', p_range,
      'login_failures', count(*) filter (where ev.action = 'admin.login_failed'),
      'lockouts', count(*) filter (where ev.action = 'admin.locked'),
      'recovery_codes_used', count(*) filter (where ev.action = 'admin.mfa_recovery_used'),
      'permission_denials', count(*) filter (where ev.action = 'admin.permission_denied'),
      'webhook_signature_failures', count(*) filter (where ev.action = 'security.webhook_rejected'),
      'by_admin', coalesce((select jsonb_agg(jsonb_build_object('admin_id', x.admin_id, 'count', x.n) order by x.n desc, x.admin_id)
                            from (select au.user_id as admin_id, count(*) as n
                                  from ev e2
                                  join public.admin_users au
                                    on au.user_id = case when e2.action in ('admin.login_failed', 'admin.locked') then e2.target_uuid
                                                         else coalesce(e2.actor_id, e2.target_uuid) end
                                  group by au.user_id) as x), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('action', y.action, 'count', y.n) order by y.n desc, y.action)
                          from (select e3.action, count(*) as n from ev e3 group by e3.action) as y), '[]'::jsonb))
    from ev);
end
$$;


-- ═══ ADM-02 · force sync with a resources filter (API_CONTRACTS §12.3 `resources?`) ═══════════

drop function admin_api.user_force_sync(uuid, uuid, text);

-- Enqueues a sync of every active account of the user (or one account), limited to the requested
-- resources (mail | calendar | tasks; all when NULL); key admin_force_sync:{account}:{job type}:{utc
-- minute}. Returns the job ids and their types.
create function admin_api.user_force_sync(
  p_user uuid, p_account uuid default null, p_reason text default null, p_resources text[] default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.force_sync');
  v_reason text := private.admin_require_reason(p_reason);
  a public.connected_accounts;
  v_job uuid;
  v_job_ids jsonb := '[]'::jsonb;
  v_jobs jsonb := '[]'::jsonb;
  v_type public.job_type;
  v_types public.job_type[];
  v_minute text := to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYYMMDDHH24MI');
begin
  perform private.admin_assert_user(p_user);
  if p_resources is not null
     and (cardinality(p_resources) = 0 or not (p_resources <@ array['mail', 'calendar', 'tasks'])) then
    raise exception 'VALIDATION_FAILED:resources' using errcode = '22023';
  end if;
  if p_account is not null and not exists (select 1 from public.connected_accounts ca
                                           where ca.id = p_account and ca.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  for a in select * from public.connected_accounts ca
           where ca.user_id = p_user and ca.status <> 'disconnected' and (p_account is null or ca.id = p_account)
           order by ca.created_at
  loop
    v_types := array_remove(array[
      case when 'mail_read' = any(a.capabilities_granted) and (p_resources is null or 'mail' = any(p_resources)) then
        case a.provider when 'google' then 'gmail_sync' when 'microsoft' then 'outlook_sync' when 'demo' then 'initial_sync' end
      end::public.job_type,
      case when 'calendar_read' = any(a.capabilities_granted) and a.provider in ('google', 'microsoft')
                and (p_resources is null or 'calendar' = any(p_resources)) then 'calendar_sync' end::public.job_type,
      case when 'tasks_read' = any(a.capabilities_granted) and (p_resources is null or 'tasks' = any(p_resources))
        then 'tasks_sync' end::public.job_type], null);
    foreach v_type in array v_types loop
      v_job := private.enqueue_job(v_type, 'admin_force_sync:' || a.id || ':' || v_type || ':' || v_minute,
                                   jsonb_build_object('connected_account_id', a.id, 'trigger', 'admin'), p_user, a.id, now(), 20, 5, null);
      v_job_ids := v_job_ids || jsonb_build_array(v_job);
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object('job_id', v_job, 'type', v_type));
    end loop;
  end loop;
  perform private.admin_audit(v_admin, 'user.force_sync', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('connected_account_id', p_account, 'resources', p_resources, 'jobs', v_job_ids));
  return jsonb_build_object('job_ids', v_job_ids, 'jobs', v_jobs);
end
$$;

-- ═══ ADM-04 · integration detail with the 24 h webhook stats ══════════════════════════════════

create or replace function admin_api.integration_detail(p_account uuid) returns jsonb
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
    'account_id', a.id, 'user', private.admin_user_label(a.user_id), 'user_id', a.user_id, 'provider', a.provider,
    'email_masked', private.mask_email(a.account_email), 'status', a.status, 'status_reason', a.status_reason,
    'granted_scopes', a.granted_scopes, 'capabilities_granted', a.capabilities_granted, 'data_sources', a.data_source_toggles,
    'connected_at', a.connected_at, 'last_sync_at', a.last_successful_sync_at, 'last_attempted_sync_at', a.last_sync_at,
    'last_successful_sync_at', a.last_successful_sync_at, 'last_error_at', a.last_error_at, 'last_error_code', a.last_error_code,
    'reauth_required_at', a.reauth_required_at, 'disconnected_at', a.disconnected_at, 'revocation_mode', a.revocation_mode,
    'credential_expires_at', a.credential_expires_at, 'pending_binding_until', a.pending_binding_until,
    'watch_expires_at', (select min(s.watch_expires_at) from public.sync_states s
                         where s.connected_account_id = a.id and s.watch_kind <> 'none'),
    'key_version', (select max(c.key_version) from public.oauth_credentials c where c.connected_account_id = a.id),
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
                 from public.webhook_events w where w.connected_account_id = a.id and w.received_at > now() - interval '7 days'),
    -- 24 h stats; `unmatched` = notifications that matched no live watch (status ignored).
    'webhook_stats', (select jsonb_build_object('received_24h', count(*),
                                                'unmatched_24h', count(*) filter (where w.status = 'ignored'),
                                                'last_received_at', (select max(w2.received_at) from public.webhook_events w2
                                                                     where w2.connected_account_id = a.id))
                      from public.webhook_events w
                      where w.connected_account_id = a.id and w.received_at > now() - interval '24 hours'));
end
$$;

-- ═══ ADM-06 · briefings: narrative mode and template fallback (API_CONTRACTS §12.3) ══════════
-- narrative_mode is read through to_jsonb(row) so these functions work whether or not the
-- briefings.narrative_mode column (API_CONTRACTS §15 addition, written by the briefing pipeline)
-- exists yet; without it the mode is NULL and the fallback rate 0.

create or replace function admin_api.briefings_metrics(p_range text, p_kind public.briefing_kind default null) returns jsonb
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
                                       and (p_kind is null or b2.kind = p_kind) and b2.skipped_reason is not null
                                     group by 1) as x), '{}'::jsonb),
      'p50_latency_ms', round(percentile_cont(0.5) within group (order by b.latency_ms)
                              filter (where b.latency_ms is not null))::integer,
      'p95_latency_ms', round(percentile_cont(0.95) within group (order by b.latency_ms)
                              filter (where b.latency_ms is not null))::integer,
      'ai_cost_usd', round(coalesce(sum(b.ai_cost_usd_micros), 0) / 1000000.0, 4),
      'template_fallback_rate', coalesce(round(
          count(*) filter (where b.status in ('ready', 'delivered') and to_jsonb(b) ->> 'narrative_mode' = 'template')::numeric
          / nullif(count(*) filter (where b.status in ('ready', 'delivered')), 0), 4), 0))
    from public.briefings b
    where b.scheduled_for >= w.start_at and b.scheduled_for < w.end_at and (p_kind is null or b.kind = p_kind));
end
$$;


create or replace function admin_api.briefings_list(
  p_page integer default 1, p_page_size integer default 25, p_sort text default null, p_filter jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('briefings.read');
  v_order text := private.admin_order(p_sort, '{"local_date":"b.local_date","scheduled_for":"b.scheduled_for","latency_ms":"b.latency_ms"}',
                                      'b.scheduled_for desc');
  v_sql text;
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
             'origin', b.origin, 'version', b.version, 'audio_status', b.audio_status,
             'narrative_mode', to_jsonb(b) ->> 'narrative_mode')
           order by %1$s, b.id), '[]'::jsonb), 'total', coalesce(max(b.total), 0))
    from f as b
  $q$, v_order);
  execute v_sql
  into v_result
  using coalesce(p_filter, '{}'::jsonb), private.admin_page_size(p_page_size), private.admin_offset(p_page, p_page_size);
  return v_result || jsonb_build_object('page', greatest(coalesce(p_page, 1), 1), 'page_size', private.admin_page_size(p_page_size));
end
$$;


-- ═══ ADM-08 · model config update: explicit clears (PATCH `escalation_target: null`, `cache_ttl: null`) ═
-- A JSON null argument reaches PostgREST functions as SQL NULL (= keep), so clearing needs a flag.

drop function admin_api.ai_model_config_update(public.routing_profile, text, public.ai_feature, text, text, jsonb, jsonb, jsonb,
                                               boolean, integer, text, text, text, integer);

create function admin_api.ai_model_config_update(
  p_profile public.routing_profile, p_role text, p_feature public.ai_feature, p_provider text, p_model text,
  p_params jsonb, p_fallback_targets jsonb, p_escalation_target jsonb, p_enabled boolean, p_expected_version integer,
  p_reason text, p_batch_policy text default null, p_cache_ttl text default null, p_max_input_tokens integer default null,
  p_clear_escalation boolean default false, p_clear_cache_ttl boolean default false
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
        escalation_target = case when coalesce(p_clear_escalation, false) then null
                                 when p_escalation_target is null then x.escalation_target
                                 when jsonb_typeof(p_escalation_target) = 'null' then null
                                 else p_escalation_target end,
        enabled = coalesce(p_enabled, x.enabled),
        batch_policy = coalesce(p_batch_policy, x.batch_policy),
        cache_ttl = case when coalesce(p_clear_cache_ttl, false) then null else coalesce(p_cache_ttl, x.cache_ttl) end,
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


-- ═══ ADM-07 · test push: reserved notification id and the quiet-hours prediction (R-13) ═══════

-- End of the user's quiet-hours window containing p_at (NULL when p_at is outside quiet hours,
-- quiet hours are off, or the window's start day is not a quiet day). Windows may cross midnight.
create function private.quiet_hours_until(p_user uuid, p_at timestamptz default now()) returns timestamptz
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  np public.notification_preferences;
  v_tz text;
  v_local timestamp;
  v_time time;
  v_date date;
  v_start_day date;
  v_end timestamp;
begin
  select * into np from public.notification_preferences x where x.user_id = p_user;
  if not found or not np.quiet_hours_enabled or np.quiet_start = np.quiet_end then
    return null;
  end if;
  v_tz := coalesce((select up.timezone from public.user_preferences up where up.user_id = p_user), 'Europe/Istanbul');
  v_local := p_at at time zone v_tz;
  v_time := v_local::time;
  v_date := v_local::date;
  if np.quiet_start < np.quiet_end then
    if v_time >= np.quiet_start and v_time < np.quiet_end then
      v_start_day := v_date;
      v_end := v_date + np.quiet_end;
    else
      return null;
    end if;
  elsif v_time >= np.quiet_start then
    v_start_day := v_date;
    v_end := (v_date + 1) + np.quiet_end;
  elsif v_time < np.quiet_end then
    v_start_day := v_date - 1;
    v_end := v_date + np.quiet_end;
  else
    return null;
  end if;
  if not (extract(isodow from v_start_day)::smallint = any(np.quiet_days)) then
    return null;
  end if;
  return v_end at time zone v_tz;
end
$$;

-- Generic test push ("Dijital Asistan" / "Test bildirimi"); never bypasses quiet hours (R-13).
-- The notification id is reserved here and carried in the job payload, so the response can name
-- the row the notification job writes; deferred_until predicts the quiet-hours delay.
create or replace function admin_api.notification_send_test(p_user uuid, p_reason text, p_installation uuid default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('push.test');
  v_reason text := private.admin_require_reason(p_reason);
  v_notification uuid := gen_random_uuid();
  v_deferred timestamptz;
  v_job uuid;
begin
  perform private.admin_assert_user(p_user);
  if p_installation is not null and not exists (select 1 from public.app_installations i
                                                where i.id = p_installation and i.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_deferred := private.quiet_hours_until(p_user, now());
  v_job := private.enqueue_job('notification',
    'admin_test_push:' || p_user || ':' || to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYYMMDDHH24MI'),
    jsonb_build_object('kind', 'test', 'category', 'account', 'detail_mode', 'generic', 'installation_id', p_installation,
                       'notification_id', v_notification, 'bypass_caps', true, 'bypass_quiet_hours', false,
                       'admin_id', v_admin.user_id),
    p_user, null, now(), 10, 3, null);
  -- A second request in the same minute reuses the queued job and its reserved id.
  select coalesce((j.payload ->> 'notification_id')::uuid, v_notification) into v_notification
  from public.jobs j where j.id = v_job;
  perform private.admin_audit(v_admin, 'notifications.test_sent', 'user', p_user::text, p_user, v_reason,
                              jsonb_build_object('job_id', v_job, 'installation_id', p_installation,
                                                 'notification_id', v_notification, 'deferred_until', v_deferred));
  return jsonb_build_object('job_id', v_job, 'notification_id', v_notification, 'deferred_until', v_deferred);
end
$$;

-- ═══ ADM-13 · feedback update returns the full row ═══════════════════════════════════════════

-- One feedback row as ADM-13 lists it (the contact email masked; the message by design).
create function private.admin_feedback_row(f public.user_feedback) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'id', f.id, 'user_id', f.user_id, 'type', f.type, 'rating', f.rating, 'message', f.message,
      'screen', f.diagnostics ->> 'screen', 'contact_email_masked', private.mask_email(f.contact_email),
      'diagnostics_consent', f.diagnostics_consent, 'platform', f.platform, 'app_version', f.app_version,
      'status', f.status, 'assigned_admin_id', f.assigned_admin_id, 'created_at', f.created_at, 'updated_at', f.updated_at)
  $$;

create or replace function admin_api.feedback_update(
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
  return private.admin_feedback_row(f);
end
$$;

-- ═══ ADM-18 · app versions per (platform, version) with sync error rate and the minimum ══════

create or replace function admin_api.app_versions_breakdown(p_range text default '30d') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('health.read');
  w record;
  v_min jsonb := coalesce(private.app_setting('app.min_supported_version'), '{}'::jsonb);
begin
  select * into w from private.metric_window(p_range);
  return (
    with active as (
      select a.* from public.app_installations a
      where a.signed_out_at is null and a.last_seen_at >= w.start_at and a.last_seen_at < w.end_at),
    versions as (
      select v.platform, v.app_version,
             rank() over (partition by v.platform order by string_to_array(v.app_version, '.')::integer[] desc) as rnk
      from (select distinct a.platform, a.app_version from public.app_installations a) as v),
    sync_jobs as (
      select j.user_id, j.status from public.jobs j
      where j.type in ('initial_sync', 'gmail_sync', 'outlook_sync', 'calendar_sync', 'tasks_sync')
        and j.status in ('completed', 'failed', 'dead_letter')
        and j.updated_at >= w.start_at and j.updated_at < w.end_at)
    select jsonb_build_object(
      'range', p_range,
      'total_active', (select count(*) from active),
      'min_supported_version', v_min,
      'versions', coalesce((select jsonb_agg(jsonb_build_object(
                                 'platform', x.platform, 'app_version', x.app_version, 'build_number', x.build_number,
                                 'active_installs', x.n, 'installations', x.n,
                                 'share', round(x.n::numeric / nullif((select count(*) from active), 0), 4),
                                 'push_enabled_share', round(x.push_n::numeric / nullif(x.n, 0), 4),
                                 'old', coalesce((select v.rnk > 3 from versions v where v.platform = x.platform
                                                  and v.app_version = x.app_version), false),
                                 'below_minimum', coalesce(private.compare_semver(x.app_version, v_min ->> x.platform::text) < 0, false),
                                 'sync_error_rate', coalesce((select round(count(*) filter (where s.status in ('failed', 'dead_letter'))::numeric
                                                                           / nullif(count(*), 0), 4)
                                                              from sync_jobs s
                                                              where s.user_id in (select a2.user_id from active a2
                                                                                  where a2.platform = x.platform
                                                                                    and a2.app_version = x.app_version)), 0))
                               order by x.platform, x.n desc, x.app_version)
                            from (select a.platform, a.app_version, max(a.build_number) as build_number, count(*) as n,
                                         count(*) filter (where a.push_enabled) as push_n
                                  from active a group by 1, 2) as x), '[]'::jsonb),
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


-- ═══ ADM-20 · settings keys of the contract (API_CONTRACTS §4.2, §12.3 ADM-20) ════════════════
-- private.valid_app_setting as 20260924002200_billing_sync.sql defines it (every key kept,
-- billing.sandbox_allowed_app_user_ids included) plus `app.min_supported_version` ({ios, android}
-- semver strings) and `google.calendar_write_scope`, so ADM-20 can store the values the api and the
-- integrations read (no row is seeded: readers fall back to their documented defaults).
create or replace function private.valid_app_setting(p_key text, p_value jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(case
      when p_value is null then false
      when p_key in ('session.idle_minutes', 'session.absolute_hours', 'metrics.inactive_after_days',
                     'referral.reward_days', 'referral.min_account_age_hours', 'referral.velocity_max_per_hour',
                     'referral.risk_threshold', 'referral.apply_window_days', 'support_access.max_minutes', 'notifications.cap.follow_up', 'notifications.cap.life_intel',
                     'notifications.cap.deadline', 'first_analysis.mail_window_hours',
                     'first_analysis.calendar_window_hours', 'first_analysis.slow_threshold_s',
                     'first_analysis.timeout_s', 'today.max_priorities', 'pro_gate.snooze_days') then
        private.jsonb_numeric(p_value) = trunc(private.jsonb_numeric(p_value))
        and case p_key
          when 'session.idle_minutes' then private.jsonb_numeric(p_value) between 10 and 30
          when 'session.absolute_hours' then private.jsonb_numeric(p_value) between 4 and 12
          when 'metrics.inactive_after_days' then private.jsonb_numeric(p_value) between 7 and 60
          when 'referral.reward_days' then private.jsonb_numeric(p_value) between 1 and 60
          when 'referral.min_account_age_hours' then private.jsonb_numeric(p_value) between 24 and 168
          when 'referral.velocity_max_per_hour' then private.jsonb_numeric(p_value) between 1 and 20
          when 'referral.risk_threshold' then private.jsonb_numeric(p_value) between 0 and 100
          when 'referral.apply_window_days' then private.jsonb_numeric(p_value) between 1 and 30
          when 'support_access.max_minutes' then private.jsonb_numeric(p_value) in (15, 30, 60)
          when 'first_analysis.mail_window_hours' then private.jsonb_numeric(p_value) between 1 and 336
          when 'first_analysis.calendar_window_hours' then private.jsonb_numeric(p_value) between 1 and 336
          when 'first_analysis.slow_threshold_s' then private.jsonb_numeric(p_value) between 5 and 600
          when 'first_analysis.timeout_s' then private.jsonb_numeric(p_value) between 60 and 3600
          when 'today.max_priorities' then private.jsonb_numeric(p_value) between 1 and 10
          when 'pro_gate.snooze_days' then private.jsonb_numeric(p_value) between 1 and 90
          else private.jsonb_numeric(p_value) between 0 and 50          -- notifications.cap.*
        end
      when p_key = 'metrics.reporting_timezone' then
        jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'
      when p_key = 'followup.wait_thresholds_days' then
        case when jsonb_typeof(p_value) <> 'array' then false
             when jsonb_array_length(p_value) <> 2 then false
             else private.jsonb_numeric(p_value -> 0) >= 1
                  and private.jsonb_numeric(p_value -> 0) = trunc(private.jsonb_numeric(p_value -> 0))
                  and private.jsonb_numeric(p_value -> 1) = trunc(private.jsonb_numeric(p_value -> 1))
                  and private.jsonb_numeric(p_value -> 0) < private.jsonb_numeric(p_value -> 1) end
      when p_key = 'web.pricing_display' then
        jsonb_typeof(p_value) = 'object' and jsonb_typeof(p_value -> 'verified') = 'boolean'
      when p_key = 'pricing.estimates' then
        jsonb_typeof(p_value) = 'object'
      when p_key = 'admin.gateway_secret_sha256' then
        jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[0-9a-f]{64}$'
      when p_key = 'billing.sandbox_allowed_app_user_ids' then
        case when jsonb_typeof(p_value) <> 'array' then false
             when jsonb_array_length(p_value) > 200 then false
             else not exists (select 1 from jsonb_array_elements(p_value) as e (item)
                              where jsonb_typeof(e.item) <> 'string'
                                 or char_length(e.item #>> '{}') not between 1 and 128) end
      -- ADM-20 keys of API_CONTRACTS §4.2 (read by the api bootstrap / account-state gate and the
      -- Google calendar write flow): minimum app versions per platform and the calendar write scope.
      when p_key = 'app.min_supported_version' then
        jsonb_typeof(p_value) = 'object'
        and (select count(*) from jsonb_object_keys(p_value)) = 2
        and coalesce(p_value ->> 'ios', '') ~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$'
        and coalesce(p_value ->> 'android', '') ~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$'
      when p_key = 'google.calendar_write_scope' then
        jsonb_typeof(p_value) = 'string'
        and (p_value #>> '{}') in ('https://www.googleapis.com/auth/calendar.events.owned',
                                   'https://www.googleapis.com/auth/calendar.events')
      else false
    end, false)
  $$;


-- ═══ Function → permission map: the two new support functions (pgTAP 120 is table-driven) ════

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
    ('ticket_reply', array['support.write'], false, 'session')
  ) as v (function_name, permissions, all_permissions, guard);

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on function
  admin_api.admin_preferences_set(text, text, jsonb, text, text, text, jsonb, boolean),
  admin_api.ticket_patch(uuid, public.ticket_status, public.ticket_category, uuid, boolean),
  admin_api.ticket_reply(uuid, text, text),
  admin_api.user_force_sync(uuid, uuid, text, text[]),
  admin_api.ai_model_config_update(public.routing_profile, text, public.ai_feature, text, text, jsonb, jsonb, jsonb,
                                   boolean, integer, text, text, text, integer, boolean, boolean)
  from public, anon;
grant execute on function
  admin_api.admin_preferences_set(text, text, jsonb, text, text, text, jsonb, boolean),
  admin_api.ticket_patch(uuid, public.ticket_status, public.ticket_category, uuid, boolean),
  admin_api.ticket_reply(uuid, text, text),
  admin_api.user_force_sync(uuid, uuid, text, text[]),
  admin_api.ai_model_config_update(public.routing_profile, text, public.ai_feature, text, text, jsonb, jsonb, jsonb,
                                   boolean, integer, text, text, text, integer, boolean, boolean)
  to authenticated;
revoke execute on function
  private.admin_ticket_row(public.support_tickets),
  private.admin_feedback_row(public.user_feedback),
  private.quiet_hours_until(uuid, timestamptz)
  from public;
revoke all on private.admin_function_permissions from public;
