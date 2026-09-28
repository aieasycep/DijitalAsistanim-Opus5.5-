-- pgTAP · cross-source calendar merge (migrations 20260924003400–20260924003440; KNOWN_PLATFORM_LIMITATIONS
-- KPL-15, INTEGRATION_PLAN §3.11): iCalUID + start across providers, title + start + organizer
-- without an iCalUID, device copies by (title, start, end) preferring the server copy, never two
-- rows of one calendar, provenance on the canonical row, regrouping on cancel / delete / deselect,
-- client visibility (restrictive policy, plan_range sources, canonical-id resolution) and the
-- `calendar_freebusy` capability value (KPL-46).
begin;
select plan(35);

select tests.create_user('merve@merge.test');
select tests.create_user('okan@merge.test');
select tests.make_pro(tests.user_id('merve@merge.test'));

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select on fx to authenticated, service_role;

-- An event of any provider (the shared helper writes Google rows without iCalUID or organizer);
-- created_at follows the insert order (now() is constant inside the test transaction).
create function pg_temp.ev(
  p_user uuid, p_account uuid, p_calendar uuid, p_provider public.provider, p_key text, p_title text,
  p_start timestamptz, p_end timestamptz, p_uid text default null, p_org text default null,
  p_org_self boolean default false, p_attendees integer default 0
) returns uuid
  language sql
  as $$
    insert into public.calendar_events (user_id, connected_account_id, calendar_id, provider, provider_event_id, ical_uid, title,
                                        start_at, end_at, organizer_email, organizer_self, attendee_count, origin, created_at)
    values (p_user, p_account, p_calendar, p_provider, p_key, p_uid, p_title, p_start, p_end, p_org::extensions.citext,
            p_org_self, p_attendees,
            case when p_provider in ('apple_device', 'android_device') then 'device_snapshot' else 'provider_sync' end,
            clock_timestamp())
    returning id
  $$;

create function pg_temp.id(p_key text) returns uuid
  language sql
  as $$ select id from fx where k = p_key $$;

-- Accounts: Google, Microsoft and the iPhone calendar of Merve; Google of Okan.
insert into fx values ('g_acct', tests.make_account(tests.user_id('merve@merge.test'), 'merve@gmail.com'));
insert into fx values ('m_acct', tests.make_account(tests.user_id('merve@merge.test'), 'merve@outlook.com',
                                                    '{mail_read,calendar_read}', 'microsoft'));
insert into fx values ('d_acct', tests.make_account(tests.user_id('merve@merge.test'), 'iphone', '{calendar_read}', 'apple_device'));
insert into fx values ('o_acct', tests.make_account(tests.user_id('okan@merge.test'), 'okan@gmail.com'));
insert into fx values ('g_cal', tests.make_calendar(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), 'Merve'));
insert into fx values ('g_cal2', tests.make_calendar(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), 'Ekip'));
insert into fx values ('m_cal', tests.make_calendar(tests.user_id('merve@merge.test'), pg_temp.id('m_acct'), 'Outlook'));
insert into fx values ('d_cal', tests.make_calendar(tests.user_id('merve@merge.test'), pg_temp.id('d_acct'), 'iCloud'));
insert into fx values ('o_cal', tests.make_calendar(tests.user_id('okan@merge.test'), pg_temp.id('o_acct'), 'Okan'));

-- ─── iCalUID + start across providers, device copy by title/start/end ──────────────────────
insert into fx values ('g1', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), pg_temp.id('g_cal'), 'google',
  'g-1', 'Müşteri toplantısı', '2026-10-05 11:00+00', '2026-10-05 12:00+00', 'UID-42@acme.com', 'ayse@acme.com', false, 3));
insert into fx values ('m1', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('m_acct'), pg_temp.id('m_cal'), 'microsoft',
  'm-1', 'Müşteri toplantısı', '2026-10-05 11:00+00', '2026-10-05 12:00+00', 'uid-42@ACME.com', 'ayse@acme.com', false, 3));
insert into fx values ('d1', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('d_acct'), pg_temp.id('d_cal'), 'apple_device',
  'd-1', '  müşteri   toplantısı ', '2026-10-05 11:00+00', '2026-10-05 12:00+00'));

select is((select merged_into_id from public.calendar_events where id = pg_temp.id('m1')), pg_temp.id('g1'),
          'the Microsoft copy with the same iCalUID (case-insensitive) and start merges into the older Google copy');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d1')), pg_temp.id('g1'),
          'the device copy with the same title (case and spacing folded), start and end merges into the server copy');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('g1')), null::uuid,
          'the canonical row is not merged');
select is((select jsonb_agg(s ->> 'provider') from public.calendar_events e, jsonb_array_elements(e.merge_sources) as s
           where e.id = pg_temp.id('g1')),
          '["google", "microsoft", "apple_device"]'::jsonb, 'provenance lists every source, canonical first');
select is((select merge_sources ->> 0 from public.calendar_events where id = pg_temp.id('m1')), null,
          'a merged duplicate carries no provenance of its own');

-- ─── canonical choice: the organiser's copy wins ─────────────────────────────────────────────
insert into fx values ('g2', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), pg_temp.id('g_cal'), 'google',
  'g-2', 'Bütçe', '2026-10-06 08:00+00', '2026-10-06 09:00+00', 'budget-7', 'cem@firma.com', false, 2));
insert into fx values ('m2', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('m_acct'), pg_temp.id('m_cal'), 'microsoft',
  'm-2', 'Bütçe', '2026-10-06 08:00+00', '2026-10-06 09:00+00', 'budget-7', 'merve@outlook.com', true, 2));
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('g2')), pg_temp.id('m2'),
          'the organiser copy becomes canonical even when it arrives later');

-- ─── fallback without an iCalUID: title + start + organizer ──────────────────────────────────
insert into fx values ('g3', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), pg_temp.id('g_cal'), 'google',
  'g-3', 'Weekly Sync', '2026-10-07 07:00+00', '2026-10-07 07:30+00', null, 'lead@firma.com'));
insert into fx values ('m3', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('m_acct'), pg_temp.id('m_cal'), 'microsoft',
  'm-3', 'weekly  SYNC', '2026-10-07 07:00+00', '2026-10-07 07:30+00', null, 'Lead@Firma.com'));
insert into fx values ('g4', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), pg_temp.id('g_cal'), 'google',
  'g-4', 'Spor', '2026-10-07 17:00+00', '2026-10-07 18:00+00'));
insert into fx values ('m4', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('m_acct'), pg_temp.id('m_cal'), 'microsoft',
  'm-4', 'Spor', '2026-10-07 17:00+00', '2026-10-07 18:00+00'));
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('m3')), pg_temp.id('g3'),
          'without an iCalUID, title + start + organizer merges');
select is((select count(*)::integer from public.calendar_events where id in (pg_temp.id('g4'), pg_temp.id('m4'))
           and merged_into_id is not null), 0, 'server events are never merged by title alone');

-- ─── never inside one calendar, never another title, never another user ────────────────────
insert into fx values ('g5', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), pg_temp.id('g_cal2'), 'google',
  'g-5', 'Ekip kahvesi', '2026-10-08 09:00+00', '2026-10-08 09:30+00', 'coffee-1'));
insert into fx values ('g6', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), pg_temp.id('g_cal2'), 'google',
  'g-6', 'Ekip kahvesi', '2026-10-08 09:00+00', '2026-10-08 09:30+00', 'coffee-1'));
select is((select count(*)::integer from public.calendar_events where id in (pg_temp.id('g5'), pg_temp.id('g6'))
           and merged_into_id is not null), 0, 'two rows of the same calendar are never merged');
insert into fx values ('g7', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('g_acct'), pg_temp.id('g_cal'), 'google',
  'g-7', 'Ekip kahvesi', '2026-10-08 09:00+00', '2026-10-08 09:30+00', 'coffee-1'));
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('g7')), pg_temp.id('g5'),
          'the same event in a second calendar of the same account merges');
insert into fx values ('d2', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('d_acct'), pg_temp.id('d_cal'), 'apple_device',
  'd-2', 'Diş hekimi', '2026-10-05 11:00+00', '2026-10-05 12:00+00'));
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d2')), null::uuid,
          'a device event with another title stays apart');
insert into fx values ('d3', pg_temp.ev(tests.user_id('merve@merge.test'), pg_temp.id('d_acct'), pg_temp.id('d_cal'), 'apple_device',
  'd-3', 'Müşteri toplantısı', '2026-10-05 11:00+00', '2026-10-05 12:30+00'));
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d3')), null::uuid,
          'a device event with another end stays apart');
insert into fx values ('o1', pg_temp.ev(tests.user_id('okan@merge.test'), pg_temp.id('o_acct'), pg_temp.id('o_cal'), 'google',
  'o-1', 'Müşteri toplantısı', '2026-10-05 11:00+00', '2026-10-05 12:00+00', 'UID-42@acme.com', 'ayse@acme.com'));
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('o1')), null::uuid,
          'another user''s copy of the same meeting is never merged');

-- ─── regrouping ──────────────────────────────────────────────────────────────────────────────
alter table public.calendar_events disable trigger trg_calendar_events_updated_at;
update public.calendar_events set updated_at = '2026-01-01 00:00+00' where id = pg_temp.id('m1');
alter table public.calendar_events enable trigger trg_calendar_events_updated_at;
update public.calendar_events set status = 'cancelled', provider_deleted_at = now() where id = pg_temp.id('g1');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('g1')), null::uuid,
          'a cancelled canonical row leaves its group');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d1')), pg_temp.id('m1'),
          'the remaining server copy becomes canonical for the device copy');
select is((select jsonb_array_length(merge_sources) from public.calendar_events where id = pg_temp.id('m1')), 2,
          'the new canonical row lists its two sources');
select is((select updated_at from public.calendar_events where id = pg_temp.id('m1')), '2026-01-01 00:00+00'::timestamptz,
          'merge bookkeeping does not bump updated_at (the resync prune compares it)');
select is((select jsonb_array_length(merge_sources) from public.calendar_events where id = pg_temp.id('g1')), 0,
          'the cancelled row drops its provenance');

delete from public.calendar_events where id = pg_temp.id('m1');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d1')), null::uuid,
          'deleting the canonical row leaves the device copy on its own');

update public.calendar_events set status = 'confirmed', provider_deleted_at = null where id = pg_temp.id('g1');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d1')), pg_temp.id('g1'),
          'a restored server copy becomes canonical again');

update public.calendars set selected = false where id = pg_temp.id('g_cal');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d1')), null::uuid,
          'deselecting the calendar of the canonical row un-merges its copies');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('g7')), null::uuid,
          'a copy in a hidden calendar is not merged');
update public.calendars set selected = true where id = pg_temp.id('g_cal');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d1')), pg_temp.id('g1'),
          'reselecting regroups');

-- A device upsert of the same row keeps it merged (ON CONFLICT update path).
update public.calendar_events set title = 'Müşteri Toplantısı' where id = pg_temp.id('d1');
select is((select merged_into_id from public.calendar_events where id = pg_temp.id('d1')), pg_temp.id('g1'),
          'an edit that keeps the key keeps the merge');

-- ─── client visibility ───────────────────────────────────────────────────────────────────────
select tests.authenticate_as(tests.user_id('merve@merge.test'));
select is((select count(*)::integer from public.calendar_events
           where start_at = '2026-10-05 11:00+00' and end_at = '2026-10-05 12:00+00' and title <> 'Diş hekimi'), 1,
          'the client sees one row of the merged meeting (restrictive policy)');
select is((select count(*)::integer from public.calendar_events where id = (select id from fx where k = 'd1')), 0,
          'a merged duplicate is not readable by id');
select is(public.calendar_event_canonical_id((select id from fx where k = 'd1')), (select id from fx where k = 'g1'),
          'calendar_event_canonical_id resolves a duplicate to its canonical event');
select is(public.calendar_event_canonical_id((select id from fx where k = 'g1')), (select id from fx where k = 'g1'),
          'a canonical id resolves to itself');
select is(public.calendar_event_canonical_id((select id from fx where k = 'o1')), null::uuid,
          'another user''s event resolves to nothing');
select is((select jsonb_agg(i -> 'sources') from jsonb_array_elements(
             public.plan_range('2026-10-05 00:00+00', '2026-10-06 00:00+00') -> 'items') as i
           where i ->> 'title' = 'Müşteri toplantısı' and i ->> 'end_at' like '%12:00:00%'),
          (select jsonb_build_array(e.merge_sources) from public.calendar_events e where e.id = (select id from fx where k = 'g1')),
          'plan_range shows the meeting once with every source');
select is((select count(*)::integer from jsonb_array_elements(
             public.plan_range('2026-10-05 00:00+00', '2026-10-06 00:00+00') -> 'items') as i
           where i ->> 'item_type' = 'event' and i ->> 'title' = 'Diş hekimi'
             and jsonb_array_length(i -> 'sources') = 1), 1,
          'a single-source event carries itself as its only source');
select throws_ok($$ select private.merge_calendar_events(tests.user_id('merve@merge.test'), '-infinity', 'infinity') $$,
                 '42501', null, 'clients cannot call the merge');
select tests.clear_authentication();

select tests.as_service_role();
select is((select count(*)::integer from public.calendar_events where id = (select id from fx where k = 'd1')), 1,
          'the service role still reads merged duplicates (export, reconciliation)');
select tests.clear_authentication();

select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_events'
                  and policyname = 'calendar_events_hide_merged' and permissive = 'RESTRICTIVE'),
          'the merged-row policy is restrictive');
select ok('calendar_freebusy' = any(enum_range(null::public.capability)::text[]),
          'the calendar_freebusy capability exists (KPL-46)');

select * from finish();
rollback;
