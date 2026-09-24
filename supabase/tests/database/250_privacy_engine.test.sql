-- pgTAP · privacy engine (T-11.01…T-11.04): export requests, history deletion in both scopes,
-- account deletion steps with the schema-driven zero-rows check, tombstones, honest request status,
-- embeddings deleted with their source, retention storage sweep and system schedules
-- (TEST_PLAN DB-11 / TST-DB-11; API_CONTRACTS API-PRV-01…03, JOB-20…23).
begin;
select plan(49);

select tests.create_user('export@privacy.test');
select tests.create_user('hist@privacy.test');
select tests.create_user('scope@privacy.test');
select tests.create_user('other@privacy.test');
select tests.create_user('gone@privacy.test');

create temporary table fx (k text primary key, id uuid) on commit drop;
insert into fx values ('g_uid', tests.user_id('gone@privacy.test'));

-- ═══ API-PRV-01 · create_export_request ════════════════════════════════════════════════════════
create temporary table ex on commit drop as
  select public.create_export_request(tests.user_id('export@privacy.test'), array['profile', 'insights'], null) as r;
select is((select r ->> 'created' from ex), 'true', 'an export request is created');
select is((select status::text from public.data_export_requests where id = (select (r ->> 'request_id')::uuid from ex)),
          'requested', 'it starts requested');
select results_eq($$ select type::text, payload ->> 'data_export_request_id', user_id
                     from public.jobs where idempotency_key = 'export:' || (select r ->> 'request_id' from ex) $$,
                  $$ select 'export', (select r ->> 'request_id' from ex), tests.user_id('export@privacy.test') $$,
                  'JOB-21 is enqueued with key export:{id}');
select ok(exists (select 1 from public.audit_logs where action = 'user.privacy.export_requested'
                  and target_id = (select r ->> 'request_id' from ex)), 'the request is audited');
select is((public.create_export_request(tests.user_id('export@privacy.test'), null, null)) ->> 'request_id',
          (select r ->> 'request_id' from ex), 'a second request returns the export already in flight');
select is((select include from public.data_export_requests where id = (select (r ->> 'request_id')::uuid from ex)),
          array['profile', 'insights'], 'the included sections are stored');
select throws_ok($$ update public.data_export_requests set include = array['oauth_credentials'] where user_id = tests.user_id('export@privacy.test') $$,
                 '23514', null, 'an unknown export section is rejected');

-- ═══ JOB-22 · purge_history (all_analysis) ═════════════════════════════════════════════════════
insert into fx values ('h_acct', tests.make_account(tests.user_id('hist@privacy.test'), 'hist@gmail.com'));
insert into fx values
  ('h_thread', tests.make_thread(tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_acct'), 'Teklif')),
  ('h_cal', tests.make_calendar(tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_acct'))),
  ('h_contact', tests.make_contact(tests.user_id('hist@privacy.test'), 'Selin Kaya', 'selin@example.com')),
  ('h_insight', tests.make_insight(tests.user_id('hist@privacy.test'))),
  ('h_briefing', tests.make_briefing(tests.user_id('hist@privacy.test'))),
  ('h_open', tests.make_commitment(tests.user_id('hist@privacy.test'), 'Sunumu cumaya kadar göndereceğim.')),
  ('h_done', tests.make_commitment(tests.user_id('hist@privacy.test'), 'Faturayı ilettim.')),
  ('h_pending', tests.make_approval(tests.user_id('hist@privacy.test')));
insert into fx values
  ('h_message', tests.make_message(tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_acct'),
                                   (select id from fx where k = 'h_thread'), 'Teklif')),
  ('h_future', tests.make_event(tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_acct'), (select id from fx where k = 'h_cal'),
                                'Gelecek', now() + interval '3 days', now() + interval '3 days 1 hour')),
  ('h_past', tests.make_event(tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_acct'), (select id from fx where k = 'h_cal'),
                              'Geçmiş', now() - interval '3 days', now() - interval '3 days' + interval '1 hour')),
  ('h_noted', tests.make_event(tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_acct'), (select id from fx where k = 'h_cal'),
                               'Notlu', now() - interval '2 days', now() - interval '2 days' + interval '1 hour'));
update public.commitments set status = 'done', completed_at = now() where id = (select id from fx where k = 'h_done');
insert into public.meeting_notes (user_id, calendar_event_id, kind, body, input)
values (tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_noted'), 'post_meeting', 'Kendi notum', 'text');
insert into public.vip_people (user_id, contact_id, relationship, origin)
values (tests.user_id('hist@privacy.test'), (select id from fx where k = 'h_contact'), 'key_client', 'user');
insert into public.assistant_threads (user_id, title) values (tests.user_id('hist@privacy.test'), 'Sohbet');
insert into public.memory_chunks (user_id, source_type, source_id, source_provider, source_timestamp, confidence, chunk_kind, content,
                                  content_hash, occurred_at)
values (tests.user_id('hist@privacy.test'), 'email_message', (select id::text from fx where k = 'h_message'), 'google', now(), 0.9,
        'email_summary', 'Teklif özeti', sha256('hist-memory'::bytea), now());
insert into public.captures (user_id, kind, idempotency_key, status, storage_path)
values (tests.user_id('hist@privacy.test'), 'photo', 'cap-hist', 'extracted',
        tests.user_id('hist@privacy.test') || '/22222222-2222-4222-8222-222222222222/fis.jpg');

select results_eq($$ select (c ->> 'insights')::int, (c ->> 'briefings')::int, (c ->> 'memory_chunks')::int, (c ->> 'assistant_threads')::int
                     from (select public.history_deletion_counts(tests.user_id('hist@privacy.test'), null) as c) x $$,
                  $$ values (1, 1, 1, 1) $$, 'the counts shown before the deletion');
create temporary table hp on commit drop as select public.purge_history(tests.user_id('hist@privacy.test'), null) as r;
select ok((select r -> 'storage_paths' -> 'captures' ? (tests.user_id('hist@privacy.test') || '/22222222-2222-4222-8222-222222222222/fis.jpg') from hp),
          'the capture object path is returned for the Storage API');
select is((select count(*)::int from public.insights where user_id = tests.user_id('hist@privacy.test'))
          + (select count(*)::int from public.briefings where user_id = tests.user_id('hist@privacy.test'))
          + (select count(*)::int from public.memory_chunks where user_id = tests.user_id('hist@privacy.test'))
          + (select count(*)::int from public.assistant_threads where user_id = tests.user_id('hist@privacy.test'))
          + (select count(*)::int from public.captures where user_id = tests.user_id('hist@privacy.test'))
          + (select count(*)::int from public.email_messages where user_id = tests.user_id('hist@privacy.test')),
          0, 'zero derived rows remain');
select is((select count(*)::int from public.approval_actions where user_id = tests.user_id('hist@privacy.test') and status = 'pending'), 0,
          'pending approvals are cancelled');
select is((select count(*)::int from public.connected_accounts where user_id = tests.user_id('hist@privacy.test')), 1, 'connections are kept');
select is((select count(*)::int from public.vip_people where user_id = tests.user_id('hist@privacy.test')), 1, 'VIP is kept');
select results_eq($$ select id from public.commitments where user_id = tests.user_id('hist@privacy.test') $$,
                  $$ select id from fx where k = 'h_open' $$, 'open commitments are kept, finished ones deleted');
select results_eq($$ select id from public.calendar_events where user_id = tests.user_id('hist@privacy.test') order by start_at $$,
                  $$ select id from fx where k in ('h_noted', 'h_future') order by k desc $$,
                  'future events and events with the user''s own notes are kept; other past events go');
select is((select count(*)::int from public.meeting_notes where user_id = tests.user_id('hist@privacy.test')), 1, 'meeting notes are kept');
select is((select sum(value::int)::int from hp, jsonb_each_text(public.purge_history(tests.user_id('hist@privacy.test'), null) -> 'deleted')),
          0, 'a second run deletes nothing more');

-- ═══ JOB-22 · purge_history (connected_account) ════════════════════════════════════════════════
select tests.make_pro(tests.user_id('scope@privacy.test'));
insert into fx values
  ('s_a1', tests.make_account(tests.user_id('scope@privacy.test'), 'is@firma.com')),
  ('s_a2', tests.make_account(tests.user_id('scope@privacy.test'), 'kisisel@gmail.com'));
insert into fx values
  ('s_t1', tests.make_thread(tests.user_id('scope@privacy.test'), (select id from fx where k = 's_a1'), 'İş')),
  ('s_t2', tests.make_thread(tests.user_id('scope@privacy.test'), (select id from fx where k = 's_a2'), 'Kişisel'));
insert into fx values
  ('s_m1', tests.make_message(tests.user_id('scope@privacy.test'), (select id from fx where k = 's_a1'), (select id from fx where k = 's_t1'), 'İş')),
  ('s_m2', tests.make_message(tests.user_id('scope@privacy.test'), (select id from fx where k = 's_a2'), (select id from fx where k = 's_t2'), 'Kişisel'));
insert into public.insights (user_id, kind, title, decision_tier, reason_code, entity_type, entity_id, dedupe_key, source_type, source_id,
                             source_provider, source_timestamp, confidence, evidence)
select tests.user_id('scope@privacy.test'), 'reply_needed', 'Yanıt bekleniyor ' || k, 'deterministic_signal', 'test_reason', 'email_thread', gen_random_uuid(),
       'scope:' || k, 'email_message', id::text, 'google', now(), 0.9, '[{"quote": "Teklif", "field": "subject"}]'::jsonb
from fx where k in ('s_m1', 's_m2');
insert into public.memory_chunks (user_id, source_type, source_id, source_provider, source_timestamp, confidence, chunk_kind, content,
                                  content_hash, occurred_at)
select tests.user_id('scope@privacy.test'), 'email_message', id::text, 'google', now(), 0.9, 'email_summary', 'Özet ' || k,
       sha256(convert_to('scope' || k, 'UTF8')), now()
from fx where k in ('s_m1', 's_m2');
select is((public.history_deletion_counts(tests.user_id('scope@privacy.test'), (select id from fx where k = 's_a1')) ->> 'insights')::int, 1,
          'account-scoped counts cover that account only');
select lives_ok($$ select public.purge_history(tests.user_id('scope@privacy.test'), (select id from fx where k = 's_a1')) $$,
                'the account-scoped purge runs');
select results_eq($$ select connected_account_id from public.email_threads where user_id = tests.user_id('scope@privacy.test') $$,
                  $$ select id from fx where k = 's_a2' $$, 'only the chosen account''s mail is deleted');
select results_eq($$ select source_id from public.insights where user_id = tests.user_id('scope@privacy.test') $$,
                  $$ select id::text from fx where k = 's_m2' $$, 'rows derived from the account go, others stay');
select results_eq($$ select source_id from public.memory_chunks where user_id = tests.user_id('scope@privacy.test') $$,
                  $$ select id::text from fx where k = 's_m2' $$, 'memory chunks of the account go with it');
select is((select count(*)::int from public.connected_accounts where user_id = tests.user_id('scope@privacy.test')), 2,
          'both connections are kept');
select throws_ok($$ select public.purge_history(tests.user_id('scope@privacy.test'), (select id from fx where k = 'h_acct')) $$,
                 'P0002', null, 'another user''s account is NOT_FOUND');

-- ═══ Embeddings go with their source (retention trigger) ══════════════════════════════════════
delete from public.email_messages where id = (select id from fx where k = 's_m2');
select is((select count(*)::int from public.memory_chunks where user_id = tests.user_id('scope@privacy.test')), 0,
          'deleting a message deletes its memory chunks and embeddings');

-- ═══ JOB-23 · account deletion steps ══════════════════════════════════════════════════════════
insert into fx values ('g_inst', tests.make_installation(tests.user_id('gone@privacy.test')));
insert into fx values ('g_acct', tests.make_account(tests.user_id('gone@privacy.test'), 'gone@gmail.com'));
insert into fx values ('g_approval', tests.make_approval(tests.user_id('gone@privacy.test')));
insert into public.push_tokens (user_id, installation_id, expo_push_token)
values (tests.user_id('gone@privacy.test'), (select id from fx where k = 'g_inst'), 'ExponentPushToken[gone0001]');
select public.enqueue_job('insight_refresh', 'insight_refresh:gone', '{}'::jsonb, tests.user_id('gone@privacy.test'));
insert into public.analytics_events (user_id, event_name, occurred_at) values (tests.user_id('gone@privacy.test'), 'app_opened', now());
insert into public.billing_events (event_id, user_id, rc_app_user_id, event_type, event_timestamp, payload)
values ('evt-gone', tests.user_id('gone@privacy.test'), tests.user_id('gone@privacy.test')::text, 'RENEWAL', now(),
        jsonb_build_object('event', jsonb_build_object('type', 'RENEWAL', 'price', 4.99, 'app_user_id', tests.user_id('gone@privacy.test')::text)));
insert into public.support_tickets (user_id, category, subject, message, contact_email, origin)
values (tests.user_id('gone@privacy.test'), 'account', 'Soru', 'Hesabım hakkında', 'gone@example.com', 'app');
insert into fx
select 'g_request', (public.create_deletion_request(tests.user_id('gone@privacy.test'), 'account', 'app', 'reauth',
                                                    sha256('status-token'::bytea)) ->> 'request_id')::uuid;

select is((public.account_deletion_context(tests.user_id('gone@privacy.test')) ->> 'email'), 'gone@privacy.test',
          'the context carries the sign-in address for the tombstone and confirmation');
select is(jsonb_array_length(public.account_deletion_context(tests.user_id('gone@privacy.test')) -> 'installation_ids'), 1,
          'the context lists the installations');
select is((public.account_deletion_begin((select id from fx where k = 'g_request'), tests.user_id('gone@privacy.test'), null)) ->> 'state',
          'processing', 'the request moves to processing');
select is((select status from public.push_tokens where user_id = tests.user_id('gone@privacy.test')), 'disabled', 'push is disabled');
select is((select status::text from public.approval_actions where id = (select id from fx where k = 'g_approval')), 'expired',
          'pending approvals expire');
select is((select status::text from public.jobs where idempotency_key = 'insight_refresh:gone'), 'failed', 'other queued jobs are cancelled');
select throws_ok($$ select public.account_deletion_begin((select id from fx where k = 'g_request'), tests.user_id('other@privacy.test'), null) $$,
                 '42501', null, 'the request cannot be run for another user');

select lives_ok($$ select public.account_deletion_system_purge(tests.user_id('gone@privacy.test'), null) $$, 'the system purge runs');
select is((select count(*)::int from public.analytics_events where user_id = tests.user_id('gone@privacy.test')), 0, 'analytics events are deleted');
select results_eq($$ select rc_app_user_id, user_id is null, payload -> 'event' ? 'app_user_id', (payload -> 'event' ->> 'price')::numeric
                     from public.billing_events where event_id = 'evt-gone' $$,
                  $$ select encode(private.hash_subject(tests.user_id('gone@privacy.test')), 'hex'), true, false, 4.99::numeric $$,
                  'billing events keep finance fields under the subject hash only');
select results_eq($$ select user_id is null, contact_email is null from public.support_tickets where subject = 'Soru' $$,
                  $$ values (true, true) $$, 'support tickets are anonymised');

select is(public.privacy_tombstones_upsert(jsonb_build_array(
            jsonb_build_object('kind', 'email', 'hash', encode(sha256('email:gone'::bytea), 'hex')),
            jsonb_build_object('kind', 'installation', 'hash', encode(sha256('inst:gone'::bytea), 'hex')),
            jsonb_build_object('kind', 'phone', 'hash', encode(sha256('x'::bytea), 'hex')))), 2,
          'tombstones store only allowed hashed kinds');
select is(public.privacy_tombstones_upsert(jsonb_build_array(
            jsonb_build_object('kind', 'email', 'hash', encode(sha256('email:gone'::bytea), 'hex')))), 1,
          'a repeated tombstone is extended, not duplicated');

select ok(public.user_rows_remaining(tests.user_id('gone@privacy.test')) ? 'profiles.user_id', 'rows remain before the auth user is deleted');
delete from auth.users where id = tests.user_id('gone@privacy.test');
select is(public.user_rows_remaining((select id from fx where k = 'g_uid')), '{}'::jsonb,
          'no row of the deleted user remains in any public table (schema-driven check)');
select results_eq($$ select user_id is null, subject_hash = private.hash_subject((select id from fx where k = 'g_uid'))
                     from public.data_deletion_requests where id = (select id from fx where k = 'g_request') $$,
                  $$ values (true, true) $$, 'the request survives with the subject hash only');

-- ═══ Honest status ════════════════════════════════════════════════════════════════════════════
select is((public.deletion_request_update((select id from fx where k = 'g_request'), 'completed',
                                          '{"auth_user_deleted": "done"}'::jsonb)) ->> 'status',
          'completed', 'the request completes');
select throws_ok($$ select public.deletion_request_update((select id from fx where k = 'g_request'), 'processing') $$,
                 '55000', null, 'a completed request never moves back');
select is((public.deletion_request_update((select id from fx where k = 'g_request'), null, '{"confirmation_email": "queued"}'::jsonb))
            -> 'steps' ->> 'auth_user_deleted', 'done', 'steps can still be recorded and merge');

-- ═══ Grants ═══════════════════════════════════════════════════════════════════════════════════
select ok(not has_function_privilege('authenticated', 'public.purge_history(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.account_deletion_system_purge(uuid, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.user_rows_remaining(uuid)', 'execute'),
          'privacy engine functions are service-role only');

-- ═══ Retention storage sweep and system schedules ═════════════════════════════════════════════
insert into fx values ('r_briefing', tests.make_briefing(tests.user_id('other@privacy.test')));
update public.briefings set audio_status = 'ready' where id = (select id from fx where k = 'r_briefing');
insert into public.captures (id, user_id, kind, idempotency_key, status, storage_path)
values ('33333333-3333-4333-8333-333333333333', tests.user_id('other@privacy.test'), 'photo', 'cap-keep', 'extracted',
        tests.user_id('other@privacy.test') || '/33333333-3333-4333-8333-333333333333/keep.jpg');
insert into storage.objects (bucket_id, name, created_at) values
  ('captures', tests.user_id('other@privacy.test') || '/33333333-3333-4333-8333-333333333333/keep.jpg', now() - interval '2 days'),
  ('captures', tests.user_id('other@privacy.test') || '/44444444-4444-4444-8444-444444444444/orphan.jpg', now() - interval '2 days'),
  ('captures', tests.user_id('other@privacy.test') || '/tmp/44444444-4444-4444-8444-444444444444/pages.json', now() - interval '2 days'),
  ('captures', tests.user_id('other@privacy.test') || '/55555555-5555-4555-8555-555555555555/fresh.jpg', now() - interval '1 hour'),
  ('exports', tests.user_id('other@privacy.test') || '/66666666-6666-4666-8666-666666666666.zip', now() - interval '2 days'),
  ('briefing-audio', tests.user_id('other@privacy.test') || '/' || (select id from fx where k = 'r_briefing') || '/1.mp3', now() - interval '8 days');
create temporary table orphans on commit drop as select public.retention_orphan_objects(now(), 100) as r;
select results_eq($$ select jsonb_array_length(r -> 'captures'), jsonb_array_length(r -> 'exports'), jsonb_array_length(r -> 'briefing-audio')
                     from orphans $$,
                  $$ values (2, 1, 1) $$, 'orphans older than 24 h, stale exports and 7-day-old audio are returned');
select ok(not ((select r -> 'captures' from orphans) ? (tests.user_id('other@privacy.test') || '/33333333-3333-4333-8333-333333333333/keep.jpg')),
          'an object that still has its capture row is kept');
select is((select audio_status from public.briefings where id = (select id from fx where k = 'r_briefing')), 'none',
          'a briefing whose audio is swept asks for a fresh render');
insert into public.job_attempts (job_id, attempt, worker_id, started_at, finished_at, outcome)
select id, 1, 'w', now() - interval '40 days', now() - interval '40 days', 'completed' from public.jobs limit 1;
select is((public.retention_system_sweep(5000, now()) ->> 'job_attempts')::int, 1, 'job attempts older than 30 days are swept');

select * from finish();
rollback;
