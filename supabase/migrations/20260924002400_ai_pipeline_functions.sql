-- Migration 20260924002400 · AI pipeline part 1 (IMPLEMENTATION_PLAN T-5.01…T-5.08, T-5.17)
-- Spec: docs/AI_PIPELINE_PLAN.md §7, §8.9–§8.12, §10, §12; docs/API_CONTRACTS.md API-BRF-02,
-- API-BRF-04, JOB-08 (`payload.scope='ai_cost'`), JOB-12; docs/DATABASE_AND_RLS_PLAN.md §4.3 contacts.
--
-- - Contacts and person intelligence (T-5.06): contacts are upserted from mail headers and event
--   attendees (normalised e-mail, never a no-reply address or one of the user's own addresses),
--   participants/attendees are linked to their contact, and the 30-day stats feed the existing
--   `person_intelligence` / `vip_suggestions` RPCs.
-- - Briefings (T-5.08): "Yarına Hazırım" carry-over (API-BRF-02) and "Tekrar Dene" (API-BRF-04),
--   atomic and idempotent. Business-state refusals are returned as `{ok:false, reason}` so the api
--   maps them to `STATE_CONFLICT` (55000 has no API mapping).
-- - AI cost control (T-5.17): the organisation daily ceiling `ai.budget.org_daily_usd` is evaluated
--   every 5 minutes (alerts at 50 % and 80 %, auto-trip of `ai.model.large.enabled` and
--   `ai.model.opus_escalation` at 100 %), and the nightly cost reconciliation is enqueued as a
--   `reconciliation` job with `payload.scope='ai_cost'` from 03:30 UTC. Both run from
--   `private.release_expired_budget_holds` (scheduler_tick step 14, the AI budget housekeeping
--   hook), so the eight pg_cron jobs stay unchanged (DATABASE_AND_RLS_PLAN §9).
-- Every private helper the Edge Functions call gets a service-role-only `public` wrapper.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Contacts (T-5.06) ════════════════════════════════════════════════════════════════════════

-- A person address worth a contact: a syntactically valid address that is not an automated
-- sender (no-reply, notifications, mailer-daemon, bounces).
create function private.contact_email_ok(p_email text) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(
      p_email ~ '^[^@\s<>]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$'
      and split_part(p_email, '@', 1) !~ '^(no-?reply|do-?not-?reply|noreply|notifications?|bildirim|mailer-daemon|postmaster|bounces?|info|destek-noreply)([+._-].*)?$',
      false)
  $$;

-- Upserts contacts for the people of messages and events.
-- p_people: [{email, name?, organization?, at?, role: 'from'|'to'|'cc'|'attendee'}]; returns
-- {email: contact_id}. `organization` is the company derived from a non-webmail domain.
create function private.upsert_contacts_from_people(p_user uuid, p_people jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_person jsonb;
  v_email text;
  v_name text;
  v_org text;
  v_at timestamptz;
  v_origin text;
  v_id uuid;
  v_own text[];
  v_result jsonb := '{}'::jsonb;
begin
  if p_user is null or p_people is null or jsonb_typeof(p_people) <> 'array' then
    raise exception 'VALIDATION_FAILED:people' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(c.account_email::text)), '{}') into v_own
  from public.connected_accounts c where c.user_id = p_user and c.account_email is not null;

  for v_person in select value from jsonb_array_elements(p_people) limit 500 loop
    v_email := lower(btrim(coalesce(v_person ->> 'email', '')));
    continue when not private.contact_email_ok(v_email) or v_email = any(v_own);
    continue when v_result ? v_email;
    v_name := nullif(left(btrim(regexp_replace(coalesce(v_person ->> 'name', ''), '[<>"]', '', 'g')), 120), '');
    if v_name is not null and position('@' in v_name) > 0 then
      v_name := null;
    end if;
    v_org := nullif(left(btrim(regexp_replace(coalesce(v_person ->> 'organization', ''), '[<>"]', '', 'g')), 120), '');
    v_at := coalesce((v_person ->> 'at')::timestamptz, now());
    v_origin := case when v_person ->> 'role' = 'attendee' then 'calendar' else 'mail' end;

    select c.id into v_id from public.contacts c
    where c.user_id = p_user and c.merged_into_id is null
      and (c.primary_email = v_email::extensions.citext or v_email::extensions.citext = any(c.emails))
    order by c.created_at
    limit 1;

    if v_id is null then
      insert into public.contacts (user_id, display_name, primary_email, emails, organization, avatar_seed, origin,
                                   first_seen_at)
      values (p_user, coalesce(v_name, split_part(v_email, '@', 1)), v_email, array[v_email]::extensions.citext[],
              v_org, abs(hashtext(v_email)) % 1000000, v_origin, v_at)
      on conflict (user_id, primary_email) where primary_email is not null do nothing
      returning id into v_id;
      if v_id is null then
        select c.id into v_id from public.contacts c where c.user_id = p_user and c.primary_email = v_email::extensions.citext;
      end if;
    else
      update public.contacts c
        set display_name = case
              when v_name is not null and (c.display_name = split_part(v_email, '@', 1) or c.display_name = v_email)
                then v_name else c.display_name end,
            emails = case when v_email::extensions.citext = any(c.emails) then c.emails
                          else (c.emails || v_email::extensions.citext) end,
            organization = coalesce(c.organization, v_org),
            first_seen_at = least(coalesce(c.first_seen_at, v_at), v_at)
      where c.id = v_id;
    end if;
    v_result := v_result || jsonb_build_object(v_email, v_id);
    v_id := null;
  end loop;
  return v_result;
end
$$;

-- Writes `contact_id` into thread participants and event attendees whose address belongs to a
-- contact (search and person intelligence match on it). Returns the number of rows changed.
create function private.link_contact_refs(p_user uuid, p_thread_ids uuid[], p_event_ids uuid[])
  returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_n integer := 0;
  v_m integer := 0;
begin
  with linked as (
    select t.id,
           jsonb_agg(case when c.id is null then p.x else p.x || jsonb_build_object('contact_id', c.id) end
                     order by p.ord) as participants
    from public.email_threads t
    cross join lateral jsonb_array_elements(t.participants) with ordinality as p (x, ord)
    left join lateral (
      select c.id from public.contacts c
      where c.user_id = p_user and c.merged_into_id is null and nullif(p.x ->> 'email', '') is not null
        and (c.primary_email = lower(p.x ->> 'email')::extensions.citext
             or lower(p.x ->> 'email')::extensions.citext = any(c.emails))
      order by c.created_at limit 1) as c on true
    where t.user_id = p_user and t.id = any(coalesce(p_thread_ids, '{}'))
    group by t.id)
  update public.email_threads t set participants = l.participants
  from linked l where t.id = l.id and t.participants is distinct from l.participants;
  get diagnostics v_n = row_count;

  with linked as (
    select e.id,
           jsonb_agg(case when c.id is null then a.x else a.x || jsonb_build_object('contact_id', c.id) end
                     order by a.ord) as attendees
    from public.calendar_events e
    cross join lateral jsonb_array_elements(e.attendees) with ordinality as a (x, ord)
    left join lateral (
      select c.id from public.contacts c
      where c.user_id = p_user and c.merged_into_id is null and nullif(a.x ->> 'email', '') is not null
        and (c.primary_email = lower(a.x ->> 'email')::extensions.citext
             or lower(a.x ->> 'email')::extensions.citext = any(c.emails))
      order by c.created_at limit 1) as c on true
    where e.user_id = p_user and e.id = any(coalesce(p_event_ids, '{}'))
    group by e.id)
  update public.calendar_events e set attendees = l.attendees
  from linked l where e.id = l.id and e.attendees is distinct from l.attendees;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end
$$;

-- Person stats (last contact, 30-day message and meeting counts). NULL p_contact_ids = all of the
-- user's contacts. Returns the number of contacts updated.
create function private.refresh_contact_stats(
  p_user uuid, p_contact_ids uuid[] default null, p_now timestamptz default now()
) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_n integer;
begin
  with target as (
    select c.id, array(select distinct lower(e) from unnest(c.emails::text[] || array[c.primary_email::text]) as e
                       where e is not null) as emails
    from public.contacts c
    where c.user_id = p_user and c.merged_into_id is null
      and (p_contact_ids is null or c.id = any(p_contact_ids))),
  mail as (
    select t.id,
           max(m.received_at) filter (where m.direction = 'inbound' and lower(m.from_email::text) = any(t.emails)) as last_in,
           max(m.received_at) filter (where m.direction = 'outbound') as last_out,
           count(*) filter (where m.received_at >= p_now - interval '30 days') as n30
    from target t
    join public.email_messages m on m.user_id = p_user
      and (lower(m.from_email::text) = any(t.emails)
           or exists (select 1 from unnest(m.to_emails::text[] || m.cc_emails::text[]) as r (e) where lower(r.e) = any(t.emails)))
    group by t.id),
  meet as (
    select t.id,
           max(e.start_at) filter (where e.start_at <= p_now) as last_meet,
           count(*) filter (where e.start_at >= p_now - interval '30 days' and e.start_at <= p_now) as n30
    from target t
    join public.calendar_events e on e.user_id = p_user and e.status <> 'cancelled'
      and exists (select 1 from jsonb_array_elements(e.attendees) as a (x) where lower(a.x ->> 'email') = any(t.emails))
    group by t.id)
  update public.contacts c
    set last_inbound_at = mail.last_in,
        last_outbound_at = mail.last_out,
        last_contact_at = nullif(greatest(coalesce(mail.last_in, '-infinity'), coalesce(mail.last_out, '-infinity'),
                                          coalesce(meet.last_meet, '-infinity')), '-infinity'::timestamptz),
        message_count_30d = coalesce(mail.n30, 0),
        meeting_count_30d = coalesce(meet.n30, 0)
  from target
  left join mail on mail.id = target.id
  left join meet on meet.id = target.id
  where c.id = target.id;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ═══ Briefings (T-5.08) ═══════════════════════════════════════════════════════════════════════

-- The next morning briefing instant for the user (weekend slot on Saturday/Sunday).
create function private.next_morning_briefing_at(p_user uuid, p_after_date date) returns timestamptz
  language sql stable
  security definer
  set search_path = ''
  as $$
    select ((p_after_date + 1)
            + case when extract(isodow from (p_after_date + 1))::integer in (6, 7)
                   then coalesce(up.weekend_morning_time, time '10:00') else coalesce(up.morning_time, time '08:00') end)
           at time zone coalesce(up.timezone, 'Europe/Istanbul')
    from (select 1) as one
    left join public.user_preferences up on up.user_id = p_user
  $$;

-- API-BRF-02 "Yarına Hazırım": carries the evening's "Yarına Kalanlar" rows (all, or the given
-- ids) to tomorrow. Linked insights snooze until the next morning briefing; in-app tasks and
-- commitments due today move to the same time tomorrow; provider tasks are never touched.
-- Idempotent: a second call returns the first result with `replayed=true`.
create function private.briefing_evening_ready(
  p_user uuid, p_briefing_id uuid, p_item_ids uuid[] default null, p_now timestamptz default now()
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  b public.briefings;
  v_today date := private.user_local_date(p_user, p_now);
  v_tz text := private.user_timezone(p_user);
  v_next timestamptz;
  v_items uuid[];
  v_count integer;
  r record;
begin
  select * into b from public.briefings x where x.id = p_briefing_id and x.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if b.kind <> 'evening' or b.local_date <> v_today then
    return jsonb_build_object('ok', false, 'reason', 'state_conflict', 'kind', b.kind, 'local_date', b.local_date);
  end if;
  v_next := private.next_morning_briefing_at(p_user, v_today);
  if b.evening_ready_at is not null then
    return jsonb_build_object('ok', true, 'replayed', true, 'carried', coalesce((b.counts ->> 'carried')::integer, 0),
                              'next_morning_at', v_next, 'closed_at', b.evening_ready_at);
  end if;
  if b.status not in ('ready', 'delivered') then
    return jsonb_build_object('ok', false, 'reason', 'state_conflict', 'status', b.status);
  end if;

  select coalesce(array_agg(i.id), '{}') into v_items
  from public.briefing_items i
  where i.briefing_id = b.id and i.section = 'carry_over' and (p_item_ids is null or i.id = any(p_item_ids));
  if p_item_ids is not null and cardinality(v_items) <> (select count(distinct x) from unnest(p_item_ids) as u (x)) then
    raise exception 'VALIDATION_FAILED:carry_over_item_ids' using errcode = '22023';
  end if;

  update public.briefing_items i set carried_over_to = v_today + 1 where i.id = any(v_items);
  get diagnostics v_count = row_count;

  for r in select i.insight_id, i.entity_type, i.entity_id from public.briefing_items i where i.id = any(v_items) loop
    if r.insight_id is not null then
      update public.insights x set status = 'snoozed', snoozed_until = v_next
      where x.id = r.insight_id and x.user_id = p_user and x.status in ('open', 'snoozed') and v_next > now();
    end if;
    if r.entity_type = 'commitment' then
      update public.commitments c set due_at = c.due_at + interval '1 day'
      where c.id = r.entity_id and c.user_id = p_user and c.status = 'open' and c.due_at is not null
        and (c.due_at at time zone v_tz)::date <= v_today;
    elsif r.entity_type = 'task' then
      update public.tasks t
        set due_at = case when t.due_at is null then null else t.due_at + interval '1 day' end,
            due_date = case when t.due_date is null then null else t.due_date + 1 end
      where t.id = r.entity_id and t.user_id = p_user and t.connected_account_id is null and t.status = 'open'
        and coalesce((t.due_at at time zone v_tz)::date, t.due_date) <= v_today;
    end if;
  end loop;

  update public.briefings x
    set evening_ready_at = p_now, counts = x.counts || jsonb_build_object('carried', v_count)
  where x.id = b.id;
  return jsonb_build_object('ok', true, 'replayed', false, 'carried', v_count, 'next_morning_at', v_next,
                            'closed_at', p_now);
end
$$;

-- API-BRF-04 "Tekrar Dene": a failed briefing of the user's current local date goes back to
-- `scheduled` (same row, version + 1) with a new `briefing` job. A second call while the retry is
-- scheduled or generating returns the running job; any other state is a conflict.
create function private.briefing_retry(p_user uuid, p_briefing_id uuid, p_now timestamptz default now())
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  b public.briefings;
  v_job uuid;
  v_key text;
begin
  select * into b from public.briefings x where x.id = p_briefing_id and x.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if b.local_date <> private.user_local_date(p_user, p_now) then
    return jsonb_build_object('ok', false, 'reason', 'state_conflict', 'status', b.status);
  end if;
  if b.status in ('scheduled', 'generating') and b.origin = 'retry' and b.job_id is not null then
    return jsonb_build_object('ok', true, 'replayed', true, 'briefing_id', b.id, 'status', b.status, 'job_id', b.job_id,
                              'job_status', (select j.status from public.jobs j where j.id = b.job_id));
  end if;
  if b.status <> 'failed' then
    return jsonb_build_object('ok', false, 'reason', 'state_conflict', 'status', b.status);
  end if;
  v_key := b.idempotency_key || ':retry:' || (b.version + 1);
  v_job := private.enqueue_job('briefing', v_key, jsonb_build_object('briefing_id', b.id), p_user, null, p_now, 20, 4, null);
  update public.briefings x
    set status = 'scheduled', version = x.version + 1, origin = 'retry', failed_at = null, error_code = null,
        job_id = v_job
  where x.id = b.id
  returning * into b;
  return jsonb_build_object('ok', true, 'replayed', false, 'briefing_id', b.id, 'status', b.status, 'job_id', v_job,
                            'job_status', (select j.status from public.jobs j where j.id = v_job));
end
$$;

-- ═══ AI cost control (T-5.17) ═════════════════════════════════════════════════════════════════

-- Organisation daily ceiling (AI_PIPELINE_PLAN §8.10 L3): today's UTC spend against the
-- `ai.budget.org_daily_usd` payload. 50 / 80 / 100 % are audited once per day; at 100 % the large
-- model and the T3 escalation are switched off (audited, reversible in the backoffice).
create function private.ai_org_budget_evaluate(p_now timestamptz default now()) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_day_start timestamptz := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';
  v_flag public.feature_flags;
  v_ceiling bigint;
  v_spent bigint;
  v_pct numeric;
  v_threshold integer;
  v_alerts integer[] := '{}';
  v_tripped integer := 0;
begin
  select * into v_flag from public.feature_flags f where f.key = 'ai.budget.org_daily_usd';
  if not found or not v_flag.enabled then
    return jsonb_build_object('status', 'disabled');
  end if;
  v_ceiling := private.usd_to_micros(v_flag.payload -> 'usd');
  if v_ceiling is null or v_ceiling <= 0 then
    return jsonb_build_object('status', 'not_configured');
  end if;
  select coalesce(sum(r.cost_usd_micros), 0) into v_spent
  from public.ai_requests r
  where r.created_at >= v_day_start and r.created_at < v_day_start + interval '1 day';
  v_pct := round(v_spent * 100.0 / v_ceiling, 2);

  foreach v_threshold in array array[50, 80, 100] loop
    continue when v_pct < v_threshold;
    continue when exists (
      select 1 from public.audit_logs a
      where a.action = 'system.ai_budget.org_threshold' and a.occurred_at >= v_day_start
        and a.details ->> 'threshold' = v_threshold::text);
    perform private.audit_log_append('system', null, null, 'system.ai_budget.org_threshold', 'feature_flag',
                                     'ai.budget.org_daily_usd', null, null, 'success',
                                     jsonb_build_object('threshold', v_threshold, 'pct', v_pct, 'spent_micros', v_spent,
                                                        'ceiling_micros', v_ceiling), null);
    v_alerts := v_alerts || v_threshold;
  end loop;

  if v_pct >= 100 then
    update public.feature_flags f set enabled = false
    where f.key in ('ai.model.large.enabled', 'ai.model.opus_escalation') and f.enabled;
    get diagnostics v_tripped = row_count;
    if v_tripped > 0 then
      perform private.audit_log_append('system', null, null, 'system.ai_budget.org_tripped', 'feature_flag',
                                       'ai.model.large.enabled', null, null, 'success',
                                       jsonb_build_object('pct', v_pct, 'spent_micros', v_spent, 'ceiling_micros', v_ceiling,
                                                          'flags_off', v_tripped), null);
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'spent_micros', v_spent, 'ceiling_micros', v_ceiling, 'pct', v_pct,
                            'alerts', to_jsonb(v_alerts), 'tripped', v_tripped > 0);
end
$$;

-- Our recorded spend per (provider, model) for one UTC day (nightly reconciliation input).
create function private.ai_cost_by_model(p_day date) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce(jsonb_agg(jsonb_build_object('provider', x.provider, 'model', x.model,
                                                 'cost_usd_micros', x.cost, 'requests', x.n)
                              order by x.provider, x.model), '[]'::jsonb)
    from (select r.provider, r.model, sum(r.cost_usd_micros)::bigint as cost, count(*) as n
          from public.ai_requests r
          where r.created_at >= p_day::timestamp at time zone 'UTC'
            and r.created_at < (p_day + 1)::timestamp at time zone 'UTC'
            and r.provider not in ('fixture', 'native')
          group by r.provider, r.model) as x
  $$;

-- Scheduler step 14, extended (T-5.17): releases unsettled holds past hold_until (unchanged), then
-- runs the AI cost housekeeping: the org ceiling every 5 minutes, and from 03:30 UTC one
-- `reconciliation {scope:'ai_cost'}` job for the previous UTC day (the key makes it once per day).
create or replace function private.release_expired_budget_holds(p_now timestamptz default now(), p_limit integer default 1000)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.ai_budget_reservations;
  v_count integer := 0;
  v_day date := (p_now at time zone 'UTC')::date - 1;
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

  if extract(minute from p_now at time zone 'UTC')::integer % 5 = 0 then
    perform private.ai_org_budget_evaluate(p_now);
  end if;
  if (p_now at time zone 'UTC')::time >= time '03:30' then
    perform private.enqueue_job('reconciliation', 'reconciliation:ai_cost:' || to_char(v_day, 'YYYY-MM-DD'),
                                jsonb_build_object('scope', 'ai_cost', 'utc_date', to_char(v_day, 'YYYY-MM-DD')),
                                null, null, p_now, 250, 5, null);
  end if;
  return v_count;
end
$$;

-- ═══ Service-role wrappers (PostgREST exposes only public) ════════════════════════════════════

create function public.upsert_contacts_from_people(p_user uuid, p_people jsonb) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.upsert_contacts_from_people(p_user, p_people) $$;

create function public.link_contact_refs(p_user uuid, p_thread_ids uuid[], p_event_ids uuid[]) returns integer
  language sql
  security definer
  set search_path = ''
  as $$ select private.link_contact_refs(p_user, p_thread_ids, p_event_ids) $$;

create function public.refresh_contact_stats(p_user uuid, p_contact_ids uuid[] default null,
                                             p_now timestamptz default now()) returns integer
  language sql
  security definer
  set search_path = ''
  as $$ select private.refresh_contact_stats(p_user, p_contact_ids, p_now) $$;

create function public.briefing_evening_ready(p_user uuid, p_briefing_id uuid, p_item_ids uuid[] default null,
                                              p_now timestamptz default now()) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.briefing_evening_ready(p_user, p_briefing_id, p_item_ids, p_now) $$;

create function public.briefing_retry(p_user uuid, p_briefing_id uuid, p_now timestamptz default now()) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.briefing_retry(p_user, p_briefing_id, p_now) $$;

create function public.next_morning_briefing_at(p_user uuid, p_after_date date) returns timestamptz
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.next_morning_briefing_at(p_user, p_after_date) $$;

create function public.ai_org_budget_evaluate(p_now timestamptz default now()) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.ai_org_budget_evaluate(p_now) $$;

create function public.ai_cost_by_model(p_day date) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.ai_cost_by_model(p_day) $$;

comment on function public.upsert_contacts_from_people(uuid, jsonb) is
  'Service-role wrapper: contacts from mail headers / event attendees (T-5.06).';
comment on function public.link_contact_refs(uuid, uuid[], uuid[]) is
  'Service-role wrapper: links thread participants and event attendees to contacts (T-5.06).';
comment on function public.refresh_contact_stats(uuid, uuid[], timestamptz) is
  'Service-role wrapper: last contact and 30-day counts for person intelligence (T-5.06).';
comment on function public.briefing_evening_ready(uuid, uuid, uuid[], timestamptz) is
  'Service-role wrapper for API-BRF-02 (carry-over; idempotent).';
comment on function public.briefing_retry(uuid, uuid, timestamptz) is
  'Service-role wrapper for API-BRF-04 (failed → scheduled with a new briefing job).';
comment on function public.next_morning_briefing_at(uuid, date) is
  'Service-role wrapper: the next morning briefing instant after a local date.';
comment on function public.ai_org_budget_evaluate(timestamptz) is
  'Service-role wrapper: organisation daily AI ceiling evaluation and auto-trip (T-5.17).';
comment on function public.ai_cost_by_model(date) is
  'Service-role wrapper: recorded AI spend per provider/model for one UTC day (reconciliation).';

revoke execute on function
  private.contact_email_ok(text),
  private.upsert_contacts_from_people(uuid, jsonb),
  private.link_contact_refs(uuid, uuid[], uuid[]),
  private.refresh_contact_stats(uuid, uuid[], timestamptz),
  private.next_morning_briefing_at(uuid, date),
  private.briefing_evening_ready(uuid, uuid, uuid[], timestamptz),
  private.briefing_retry(uuid, uuid, timestamptz),
  private.ai_org_budget_evaluate(timestamptz),
  private.ai_cost_by_model(date),
  private.release_expired_budget_holds(timestamptz, integer)
from public, anon, authenticated;

revoke execute on function
  public.upsert_contacts_from_people(uuid, jsonb),
  public.link_contact_refs(uuid, uuid[], uuid[]),
  public.refresh_contact_stats(uuid, uuid[], timestamptz),
  public.briefing_evening_ready(uuid, uuid, uuid[], timestamptz),
  public.briefing_retry(uuid, uuid, timestamptz),
  public.next_morning_briefing_at(uuid, date),
  public.ai_org_budget_evaluate(timestamptz),
  public.ai_cost_by_model(date)
from public, anon, authenticated;

grant execute on function
  public.upsert_contacts_from_people(uuid, jsonb),
  public.link_contact_refs(uuid, uuid[], uuid[]),
  public.refresh_contact_stats(uuid, uuid[], timestamptz),
  public.briefing_evening_ready(uuid, uuid, uuid[], timestamptz),
  public.briefing_retry(uuid, uuid, timestamptz),
  public.next_morning_briefing_at(uuid, date),
  public.ai_org_budget_evaluate(timestamptz),
  public.ai_cost_by_model(date)
to service_role;
