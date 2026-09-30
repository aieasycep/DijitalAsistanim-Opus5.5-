-- pgTAP · retention cleanup, retention recompute, history purge, account deletion cascade, export
-- and deletion requests (DATABASE_AND_RLS_PLAN §6.4, §13.2 110; R-16; M§128–129).
begin;
select plan(23);

select tests.create_user('d90@privacy.test');
select tests.create_user('keep@privacy.test');
update public.user_preferences set retention_policy = 'until_deleted' where user_id = tests.user_id('keep@privacy.test');

create temporary table px (k text primary key, id uuid) on commit drop;
insert into px values
  ('acct', tests.make_account(tests.user_id('d90@privacy.test'), 'd90@gmail.com')),
  ('insight', tests.make_insight(tests.user_id('d90@privacy.test'))),
  ('memory', tests.make_memory(tests.user_id('d90@privacy.test'), 'Kuzey Lojistik teklif özeti')),
  ('briefing', tests.make_briefing(tests.user_id('d90@privacy.test'))),
  ('keep_insight', tests.make_insight(tests.user_id('keep@privacy.test'))),
  ('keep_memory', tests.make_memory(tests.user_id('keep@privacy.test'), 'Sonsuza kadar sakla'));
insert into px values
  ('cal', tests.make_calendar(tests.user_id('d90@privacy.test'), (select id from px where k = 'acct'))),
  ('contact', tests.make_contact(tests.user_id('d90@privacy.test'), 'Mehmet Yılmaz', 'mehmet@yilmazendustri.com'));
insert into px values
  ('future_event', tests.make_event(tests.user_id('d90@privacy.test'), (select id from px where k = 'acct'), (select id from px where k = 'cal'),
                                    'Gelecek toplantı', now() + interval '10 days', now() + interval '10 days 1 hour'));
insert into public.vip_people (user_id, contact_id, relationship, origin)
values (tests.user_id('d90@privacy.test'), (select id from px where k = 'contact'), 'key_client', 'user');
insert into public.tasks (user_id, title, origin, status) values (tests.user_id('d90@privacy.test'), 'Açık görev', 'user', 'open');
insert into public.captures (user_id, kind, idempotency_key, status, storage_path)
values (tests.user_id('d90@privacy.test'), 'photo', 'cap-ret', 'extracted',
        tests.user_id('d90@privacy.test') || '/' || '11111111-1111-4111-8111-111111111111' || '/fis.jpg');

-- ─── retention_cleanup (d90 content gone 100 days later, until_deleted kept) ─────────────────
select ok((select expires_at from public.insights where id = (select id from px where k = 'insight'))
          between now() + interval '89 days' and now() + interval '91 days', 'd90 content expires 90 days out');
select is((select expires_at from public.insights where id = (select id from px where k = 'keep_insight')), null,
          'until_deleted content never expires');
create temporary table cleanup on commit drop as select private.retention_cleanup(5000, now() + interval '100 days') as r;
select ok(((select r from cleanup) -> 'deleted' ->> 'insights')::integer >= 1, 'expired insights deleted');
select ok(((select r from cleanup) -> 'deleted' ->> 'memory_chunks')::integer >= 1, 'expired memory chunks deleted');
select ok(((select r from cleanup) -> 'deleted' ->> 'briefings')::integer >= 1, 'expired briefings deleted');
select ok((select r from cleanup) -> 'storage_paths' -> 'captures' ? (tests.user_id('d90@privacy.test') || '/11111111-1111-4111-8111-111111111111/fis.jpg'),
          'capture storage paths are returned for the worker');
select is((select count(*)::integer from public.insights where user_id = tests.user_id('keep@privacy.test')), 1,
          'until_deleted rows are kept');
select is((select count(*)::integer from public.tasks where user_id = tests.user_id('d90@privacy.test') and status = 'open'), 1,
          'open tasks are kept');

-- ─── recompute_expires_at after a shorter policy ─────────────────────────────────────────────
select tests.make_insight(tests.user_id('keep@privacy.test'), 'Kısalacak');
update public.user_preferences set retention_policy = 'd30' where user_id = tests.user_id('keep@privacy.test');
select ok(exists (select 1 from public.jobs where type = 'retention' and user_id = tests.user_id('keep@privacy.test')),
          'a retention change enqueues the recompute job');
select ok(private.recompute_expires_at(tests.user_id('keep@privacy.test'), 5000) >= 2, 'recompute_expires_at updates the rows');
select ok((select max(expires_at) from public.insights where user_id = tests.user_id('keep@privacy.test')) < now() + interval '31 days',
          'd90/until_deleted → d30 shortens expires_at');
select ok(exists (select 1 from public.audit_logs where action = 'privacy.retention_changed' and target_user_id = tests.user_id('keep@privacy.test')),
          'the change is audited');

-- ─── purge_user_history keeps connections, VIP, rules and future events ──────────────────────
select tests.make_insight(tests.user_id('d90@privacy.test'), 'Silinecek');
select tests.make_memory(tests.user_id('d90@privacy.test'), 'Silinecek hafıza');
select lives_ok($$ select private.purge_user_history(tests.user_id('d90@privacy.test')) $$, 'purge_user_history runs');
select is((select count(*)::integer from public.insights where user_id = tests.user_id('d90@privacy.test')), 0, 'insights purged');
select is((select count(*)::integer from public.memory_chunks where user_id = tests.user_id('d90@privacy.test')), 0, 'memory purged');
select is((select count(*)::integer from public.vip_people where user_id = tests.user_id('d90@privacy.test')), 1, 'VIP kept');
select is((select count(*)::integer from public.connected_accounts where user_id = tests.user_id('d90@privacy.test')), 1, 'connections kept');
select is((select count(*)::integer from public.calendar_events where id = (select id from px where k = 'future_event')), 1,
          'future events kept');

-- ─── Export and deletion requests ────────────────────────────────────────────────────────────
insert into public.data_export_requests (user_id) values (tests.user_id('d90@privacy.test'));
select throws_ok($$ insert into public.data_export_requests (user_id) values (tests.user_id('d90@privacy.test')) $$, '23505', null,
                 'a second in-flight export is rejected');
select throws_ok($$ insert into public.data_deletion_requests (user_id, subject_hash, kind, origin, confirmation_method)
                    values (tests.user_id('d90@privacy.test'), private.hash_subject(tests.user_id('d90@privacy.test')), 'history', 'app', 'email_otp') $$,
                 '23514', null, 'history deletion without re-auth is rejected (R-16)');
insert into public.data_deletion_requests (user_id, subject_hash, kind, origin, confirmation_method)
values (tests.user_id('d90@privacy.test'), private.hash_subject(tests.user_id('d90@privacy.test')), 'account', 'app', 'reauth');
select private.audit_log_append('user', tests.user_id('d90@privacy.test'), null, 'account.deletion.requested', 'user',
                                tests.user_id('d90@privacy.test')::text, tests.user_id('d90@privacy.test'), null, 'success', '{}', null);

-- ─── Account deletion cascade ────────────────────────────────────────────────────────────────
delete from auth.users where id = tests.user_id('d90@privacy.test');
select is((select count(*)::integer from public.profiles where user_id = tests.user_id('d90@privacy.test'))
          + (select count(*)::integer from public.connected_accounts where user_id = tests.user_id('d90@privacy.test'))
          + (select count(*)::integer from public.vip_people where user_id = tests.user_id('d90@privacy.test'))
          + (select count(*)::integer from public.data_export_requests where user_id = tests.user_id('d90@privacy.test')),
          0, 'deleting the auth user cascades every owner table');
select results_eq($$ select user_id is null, subject_hash = private.hash_subject(tests.user_id('d90@privacy.test'))
                     from public.data_deletion_requests where kind = 'account' $$,
                  $$ values (true, true) $$, 'the deletion request survives with user_id null and its subject hash');
select ok(exists (select 1 from public.audit_logs where target_user_id = tests.user_id('d90@privacy.test')), 'audit rows remain');

select * from finish();
rollback;
