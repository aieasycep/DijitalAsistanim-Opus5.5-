-- Migration 20260924003410 · cross-source calendar merge (KNOWN_PLATFORM_LIMITATIONS KPL-15;
-- INTEGRATION_PLAN §3.11 "Cross-account dedupe"; DATABASE_AND_RLS_PLAN `contacts.merged_into_id`
-- store-level merge pattern), plan provenance and the Microsoft free/busy capability backfill.
--
-- 1. `calendar_events.merged_into_id` (the canonical row of a duplicate; FK set null, NOT VALID and
--    validated in 20260924003440) and `merge_sources` (on the canonical row: every source of the
--    group, canonical first — event id, provider, account, calendar; `[]` otherwise).
-- 2. `private.merge_calendar_events(user, from, to)` recomputes the groups whose start lies in
--    [from, to), over non-cancelled events of selected calendars, by the INTEGRATION_PLAN §3.11 rule:
--      · server events (Google, Microsoft, demo) by iCalUID + start; without an iCalUID by
--        normalised title + start + organizer address (never by title alone);
--      · device events (EventKit / CalendarContract snapshots carry no iCalUID and no attendee
--        identities) against server events by normalised (title, start, end, all-day), preferring
--        the server source; unmatched device events with each other the same way;
--      · two events of the same calendar are never merged;
--      · the canonical row is the organiser's copy, then the modifiable one, then the one with more
--        attendees, then the oldest row (stable).
--    Statement-level triggers on `calendar_events` (insert / update / delete, transition tables)
--    and a row trigger on `calendars.selected` keep the groups current; the merge's own updates are
--    skipped through the transaction-local flag `da.calendar_merge`, and they do not bump
--    `updated_at` (the resync prune compares `updated_at`).
-- 3. Merged duplicates are hidden from clients by a restrictive select policy (every RPC and
--    PostgREST read of `authenticated` shows one row per event); service-role readers filter
--    `merged_into_id is null` explicitly. `calendar_event_canonical_id(id)` resolves a link that
--    names a merged duplicate to its canonical event.
-- 4. RPC-09 `plan_range` event items carry `sources` (the provenance of every merged source).
-- 5. Microsoft accounts holding `calendar_read` get `calendar_freebusy` (Graph `getSchedule` is
--    covered by `Calendars.Read`; the enum value was added in 20260924003400).

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ─── 1 · columns ──────────────────────────────────────────────────────────────────────────────
alter table public.calendar_events add column merged_into_id uuid;
alter table public.calendar_events add column merge_sources jsonb not null default '[]'::jsonb;
alter table public.calendar_events
  add constraint calendar_events_merged_into_id_fkey foreign key (merged_into_id)
  references public.calendar_events (id) on delete set null not valid;
alter table public.calendar_events
  add constraint calendar_events_merged_into_id_check check (merged_into_id is distinct from id) not valid;
alter table public.calendar_events
  add constraint calendar_events_merge_sources_check
  check (jsonb_typeof(merge_sources) = 'array' and private.jsonb_array_len(merge_sources) <= 20) not valid;
-- Each migration runs in one transaction, where CONCURRENTLY is impossible; the partial index only
-- covers merged duplicates.
-- squawk-ignore require-concurrent-index-creation
create index calendar_events_merged_into_id_idx
  on public.calendar_events (merged_into_id) where merged_into_id is not null;
comment on column public.calendar_events.merged_into_id is
  'Canonical event of a cross-source duplicate (KPL-15); maintained by private.merge_calendar_events.';
comment on column public.calendar_events.merge_sources is
  'On a canonical event: every source of its merge group [{event_id, provider, connected_account_id, calendar_id}], canonical first.';

grant select (merged_into_id, merge_sources) on table public.calendar_events to authenticated;

-- The merge only rewrites merged_into_id / merge_sources: such updates keep updated_at (the
-- resync prune of 20260924002000 deletes rows whose updated_at predates the resync).
drop trigger trg_calendar_events_updated_at on public.calendar_events;
create trigger trg_calendar_events_updated_at before update on public.calendar_events
  for each row
  when (old.merged_into_id is not distinct from new.merged_into_id
        and old.merge_sources is not distinct from new.merge_sources)
  execute function private.set_updated_at();

-- ─── 2 · merge ────────────────────────────────────────────────────────────────────────────────
-- Case- and whitespace-insensitive title key (device and provider copies of one event carry the
-- same text; nothing fuzzier is ever merged).
create function private.calendar_title_key(p_title text) returns text
  language sql
  immutable
  parallel safe
  set search_path = ''
  as $$ select lower(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g')) $$;

create function private.merge_calendar_events(p_user uuid, p_from timestamptz, p_to timestamptz)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_changed integer;
begin
  if p_user is null or p_from is null or p_to is null or p_to <= p_from then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar_merge:' || p_user::text, 0));
  perform set_config('da.calendar_merge', 'on', true);
  with cand as (
    select e.id, e.calendar_id, e.start_at, e.end_at, e.all_day, e.created_at, e.organizer_self,
           e.can_modify, e.attendee_count, e.provider in ('apple_device', 'android_device') as is_device,
           private.calendar_title_key(e.title) as tkey, lower(nullif(btrim(e.ical_uid), '')) as uid,
           lower(nullif(btrim(e.organizer_email::text), '')) as org
    from public.calendar_events e
    join public.calendars c on c.id = e.calendar_id and c.selected
    where e.user_id = p_user and e.status <> 'cancelled' and e.provider_deleted_at is null
      and e.start_at >= p_from and e.start_at < p_to
  ),
  srv as (
    select x.*,
           case when x.uid is not null then 'u|' || x.uid || '|' || x.start_at::text
                when x.org is not null and x.tkey <> '' then 't|' || x.tkey || '|' || x.start_at::text || '|' || x.org
           end as gkey
    from cand x
    where not x.is_device
  ),
  srv_head as (
    select s.id, s.calendar_id, first_value(s.id) over w as head_id, first_value(s.calendar_id) over w as head_cal
    from srv s
    where s.gkey is not null
    window w as (partition by s.gkey
                 order by s.organizer_self desc, s.can_modify desc, s.attendee_count desc, s.created_at, s.id)
  ),
  -- Server row → canonical server row (itself when it heads its group or shares the head's calendar).
  srv_map as (
    select s.id, case when h.head_id is not null and h.calendar_id <> h.head_cal then h.head_id else s.id end as canon
    from srv s
    left join srv_head h on h.id = s.id
  ),
  -- Device row → the best canonical server event with the same title, start, end and all-day flag.
  dev_match as (
    select distinct on (d.id) d.id, m.canon
    from cand d
    join cand s on not s.is_device and s.tkey <> '' and s.tkey = d.tkey and s.start_at = d.start_at
                and s.end_at = d.end_at and s.all_day = d.all_day
    join srv_map m on m.id = s.id
    join cand h on h.id = m.canon
    where d.is_device
    order by d.id, h.organizer_self desc, h.can_modify desc, h.attendee_count desc, h.created_at, h.id
  ),
  dev_rest as (
    select d.id, d.calendar_id, first_value(d.id) over w as head_id, first_value(d.calendar_id) over w as head_cal
    from cand d
    where d.is_device and d.tkey <> '' and not exists (select 1 from dev_match m where m.id = d.id)
    window w as (partition by d.tkey, d.start_at, d.end_at, d.all_day order by d.created_at, d.id)
  ),
  target as (
    select m.id, nullif(m.canon, m.id) as merged_into from srv_map m
    union all
    select m.id, m.canon from dev_match m
    union all
    select r.id, case when r.calendar_id <> r.head_cal then r.head_id end from dev_rest r
  ),
  -- Every row of the window: cancelled, deleted and unselected rows (and untitled device rows)
  -- are never merged.
  final as (
    select e.id, t.merged_into
    from public.calendar_events e
    left join target t on t.id = e.id
    where e.user_id = p_user and e.start_at >= p_from and e.start_at < p_to
  ),
  members as (
    select coalesce(f.merged_into, f.id) as head, e.id, e.provider, e.connected_account_id, e.calendar_id,
           row_number() over (partition by coalesce(f.merged_into, f.id)
                              order by (e.id = coalesce(f.merged_into, f.id)) desc, e.created_at, e.id) as n
    from final f
    join public.calendar_events e on e.id = f.id
    where exists (select 1 from target t where t.id = f.id)
  ),
  groups as (
    select m.head, count(*) as size,
           jsonb_agg(jsonb_build_object('event_id', m.id, 'provider', m.provider,
                                        'connected_account_id', m.connected_account_id, 'calendar_id', m.calendar_id)
                     order by m.n) filter (where m.n <= 20) as sources
    from members m
    group by m.head
  ),
  want as (
    select f.id, f.merged_into,
           case when f.merged_into is null and g.size > 1 then g.sources else '[]'::jsonb end as sources
    from final f
    left join groups g on g.head = f.id
  )
  update public.calendar_events e
     set merged_into_id = w.merged_into, merge_sources = w.sources
    from want w
   where e.id = w.id
     and (e.merged_into_id is distinct from w.merged_into or e.merge_sources is distinct from w.sources);
  get diagnostics v_changed = row_count;
  perform set_config('da.calendar_merge', 'off', true);
  return v_changed;
end
$$;

create function private.trg_calendar_events_merge_insert() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r record;
begin
  if current_setting('da.calendar_merge', true) = 'on' then
    return null;
  end if;
  for r in select n.user_id, min(n.start_at) as f, max(n.start_at) as t from new_rows n group by n.user_id loop
    perform private.merge_calendar_events(r.user_id, r.f, r.t + interval '1 microsecond');
  end loop;
  return null;
end
$$;

create function private.trg_calendar_events_merge_update() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r record;
begin
  if current_setting('da.calendar_merge', true) = 'on' then
    return null;
  end if;
  for r in
    select x.user_id, min(x.start_at) as f, max(x.start_at) as t
    from (select n.user_id, n.start_at from new_rows n
          union all
          select o.user_id, o.start_at from old_rows o) as x
    group by x.user_id
  loop
    perform private.merge_calendar_events(r.user_id, r.f, r.t + interval '1 microsecond');
  end loop;
  return null;
end
$$;

create function private.trg_calendar_events_merge_delete() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r record;
begin
  if current_setting('da.calendar_merge', true) = 'on' then
    return null;
  end if;
  for r in select o.user_id, min(o.start_at) as f, max(o.start_at) as t from old_rows o group by o.user_id loop
    perform private.merge_calendar_events(r.user_id, r.f, r.t + interval '1 microsecond');
  end loop;
  return null;
end
$$;

create trigger trg_calendar_events_merge_insert after insert on public.calendar_events
  referencing new table as new_rows
  for each statement execute function private.trg_calendar_events_merge_insert();
create trigger trg_calendar_events_merge_update after update on public.calendar_events
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.trg_calendar_events_merge_update();
create trigger trg_calendar_events_merge_delete after delete on public.calendar_events
  referencing old table as old_rows
  for each statement execute function private.trg_calendar_events_merge_delete();

-- Selecting or deselecting a calendar changes which copies are visible: regroup the user.
create function private.trg_calendars_selected_merge() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  perform private.merge_calendar_events(new.user_id, '-infinity'::timestamptz, 'infinity'::timestamptz);
  return null;
end
$$;

create trigger trg_calendars_selected_merge after update of selected on public.calendars
  for each row when (old.selected is distinct from new.selected)
  execute function private.trg_calendars_selected_merge();

revoke execute on function
  private.calendar_title_key(text),
  private.merge_calendar_events(uuid, timestamptz, timestamptz),
  private.trg_calendar_events_merge_insert(),
  private.trg_calendar_events_merge_update(),
  private.trg_calendar_events_merge_delete(),
  private.trg_calendars_selected_merge()
  from public, anon, authenticated;

-- ─── 3 · visibility ───────────────────────────────────────────────────────────────────────────
create policy calendar_events_hide_merged on public.calendar_events
  as restrictive for select to authenticated
  using (merged_into_id is null);

-- A link (notification, older screen) may name a copy that was merged later: the canonical id of
-- the caller's own event (the event itself when it is canonical), or null.
create function public.calendar_event_canonical_id(p_event_id uuid) returns uuid
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select coalesce(e.merged_into_id, e.id) from public.calendar_events e
    where e.id = p_event_id and e.user_id = (select auth.uid())
  $$;

revoke execute on function public.calendar_event_canonical_id(uuid) from public, anon;
grant execute on function public.calendar_event_canonical_id(uuid) to authenticated;

-- ─── 4 · RPC-09 plan_range with event provenance ─────────────────────────────────────────────
create or replace function public.plan_range(p_from timestamptz, p_to timestamptz) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '35 days' then
    raise exception 'VALIDATION_FAILED:range' using errcode = '22023';
  end if;
  return jsonb_build_object('from', p_from, 'to', p_to, 'items', coalesce((
    select jsonb_agg(x.item order by x.start_at, x.item ->> 'item_type', x.item ->> 'id')
    from (
      select e.start_at, jsonb_build_object(
               'item_type', 'event', 'id', e.id, 'start_at', e.start_at, 'end_at', e.end_at, 'all_day', e.all_day,
               'title', e.title, 'calendar_id', e.calendar_id, 'status', e.status, 'is_online', e.is_online,
               'attendee_count', e.attendee_count, 'created_by_assistant', e.da_approval_id is not null,
               'source', jsonb_build_object('source_type',
                                            case when e.provider in ('apple_device', 'android_device') then 'device_calendar_event'
                                                 else 'calendar_event' end,
                                            'source_id', e.id, 'provider', e.provider,
                                            'source_timestamp', coalesce(e.provider_updated_at, e.updated_at)),
               'sources', case when jsonb_array_length(e.merge_sources) > 0 then e.merge_sources
                               else jsonb_build_array(jsonb_build_object(
                                      'event_id', e.id, 'provider', e.provider,
                                      'connected_account_id', e.connected_account_id, 'calendar_id', e.calendar_id)) end) as item
      from public.calendar_events e
      join public.calendars c on c.id = e.calendar_id and c.selected
      where e.start_at < p_to and e.end_at > p_from and e.status <> 'cancelled' and e.merged_into_id is null
      union all
      select t.due_at, jsonb_build_object(
               'item_type', 'task', 'id', t.id, 'start_at', t.due_at, 'end_at', t.due_at, 'all_day', false,
               'title', t.title, 'status', t.status,
               'source', jsonb_build_object('source_type', coalesce(t.source_type, 'task'), 'source_id', coalesce(t.source_id, t.id::text),
                                            'provider', coalesce(t.source_provider, t.provider),
                                            'source_timestamp', coalesce(t.source_timestamp, t.created_at)))
      from public.tasks t
      where t.due_at >= p_from and t.due_at < p_to and t.status = 'open'
      union all
      select m.due_at, jsonb_build_object(
               'item_type', 'commitment', 'id', m.id, 'start_at', m.due_at, 'end_at', m.due_at, 'all_day', m.due_is_date_only,
               'title', coalesce(m.user_overrides -> 'text' ->> 'value', m.text), 'status', m.status, 'direction', m.direction,
               'source', jsonb_build_object('source_type', m.source_type, 'source_id', m.source_id,
                                            'provider', m.source_provider, 'source_timestamp', m.source_timestamp))
      from public.commitments m
      where m.due_at >= p_from and m.due_at < p_to and m.status in ('open', 'snoozed')
      union all
      select coalesce(l.event_at, l.due_at), jsonb_build_object(
               'item_type', case when l.event_at is null then 'deadline' else 'life_event' end, 'id', l.id,
               'start_at', coalesce(l.event_at, l.due_at), 'end_at', coalesce(l.event_at, l.due_at), 'all_day', false,
               'title', coalesce(l.user_overrides -> 'title' ->> 'value', l.title), 'life_event_type', l.type,
               'source', jsonb_build_object('source_type', l.source_type, 'source_id', l.source_id,
                                            'provider', l.source_provider, 'source_timestamp', l.source_timestamp))
      from public.life_events l
      where coalesce(l.event_at, l.due_at) >= p_from and coalesce(l.event_at, l.due_at) < p_to
        and l.status in ('open', 'snoozed') and not l.suppressed
      union all
      select coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at), jsonb_build_object(
               'item_type', 'deadline', 'id', i.id,
               'start_at', coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at),
               'end_at', coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at), 'all_day', false,
               'title', coalesce(i.user_overrides -> 'title' ->> 'value', i.title), 'insight_id', i.id,
               'source', jsonb_build_object('source_type', i.source_type, 'source_id', i.source_id,
                                            'provider', i.source_provider, 'source_timestamp', i.source_timestamp))
      from public.insights i
      where i.kind = 'deadline' and i.status in ('open', 'snoozed') and i.entity_type <> 'life_event'
        and coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at) >= p_from
        and coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at) < p_to
      union all
      select (p.t ->> 'start')::timestamptz, jsonb_build_object(
               'item_type', 'proposal', 'id', a.id, 'start_at', (p.t ->> 'start')::timestamptz,
               'end_at', (p.t ->> 'end')::timestamptz, 'all_day', false, 'title', a.what, 'approval_status', a.status,
               'action_type', a.action_type,
               'source', jsonb_build_object('source_type', a.source_type, 'source_id', a.source_id,
                                            'provider', a.source_provider, 'source_timestamp', a.source_timestamp))
      from public.approval_actions a
      cross join lateral (select case a.action_type when 'calendar_create' then a.payload -> 'time'
                                                    else a.payload -> 'changes' -> 'time' end as t) as p
      where a.action_type in ('calendar_create', 'calendar_update') and a.status in ('pending', 'approved', 'executing')
        and p.t ->> 'kind' = 'timed'
        and (p.t ->> 'start')::timestamptz < p_to and (p.t ->> 'end')::timestamptz > p_from
    ) as x), '[]'::jsonb));
end
$$;

-- ─── 5 · backfills ────────────────────────────────────────────────────────────────────────────
update public.connected_accounts a
   set capabilities_granted = array_append(a.capabilities_granted, 'calendar_freebusy'::public.capability)
 where a.provider = 'microsoft' and 'calendar_read'::public.capability = any(a.capabilities_granted)
   and not ('calendar_freebusy'::public.capability = any(a.capabilities_granted));

do $$
declare
  r record;
begin
  for r in select distinct e.user_id from public.calendar_events e loop
    perform private.merge_calendar_events(r.user_id, '-infinity'::timestamptz, 'infinity'::timestamptz);
  end loop;
end
$$;
