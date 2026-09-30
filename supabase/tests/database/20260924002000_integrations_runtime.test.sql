-- pgTAP · integrations runtime (migration 20260924002000; IMPLEMENTATION_PLAN T-4.01…T-4.13):
-- R-07 callback hand-off and completion binding, content upserts without bodies, the device
-- snapshot diff, disconnect, the bounded purge, demo writes, sync leases and privileges
-- (TEST_PLAN DB-26, EF-OAUTH-02/03 database half, IT-OAUTH-13, IT-SYNC-17).
begin;
select plan(68);

select tests.create_user('ali@integrations.test');
select tests.create_user('bora@integrations.test');
select tests.create_user('ceyda@integrations.test');
select tests.make_pro(tests.user_id('ceyda@integrations.test'));

create temporary table fx (k text primary key, id uuid) on commit drop;

-- A consumed state row (the callback has set used_at) for the given user and purpose.
create function pg_temp.make_state(p_user uuid, p_purpose text, p_account uuid default null, p_provider text default 'google',
                                   p_used_at timestamptz default now())
  returns uuid
  language sql
  as $$
    insert into public.oauth_states (user_id, state_hash, provider, purpose, connected_account_id, requested_capabilities,
                                     requested_scopes, code_verifier_iv, code_verifier_ciphertext, key_version, return_to,
                                     device_nonce_hash, used_at)
    values (p_user, sha256(convert_to(gen_random_uuid()::text, 'UTF8')), p_provider::public.provider, p_purpose, p_account, '{mail_read}',
            '{https://www.googleapis.com/auth/gmail.readonly}', '\x000102030405060708090a0b'::bytea,
            '\x00112233445566778899aabbccddeeff00'::bytea, 1, 'dijitalasistan://integrations/callback',
            sha256('nonce'::bytea), p_used_at)
    returning id
  $$;

-- A credential element as the Edge Function sends it (hex bytea fields).
create function pg_temp.cred(p_kind text) returns jsonb
  language sql
  as $$
    select jsonb_build_object('token_kind', p_kind, 'key_version', 1, 'iv', '0102030405060708090a0b0c',
                              'ciphertext', encode(sha256(convert_to(p_kind, 'UTF8')), 'hex') || 'ff',
                              'aad_hash', encode(sha256(convert_to('aad:' || p_kind, 'UTF8')), 'hex'),
                              'access_expires_at', case when p_kind = 'access' then now() + interval '1 hour' end,
                              'scope_snapshot', 'openid email')
  $$;

-- ─── oauth_states checks ─────────────────────────────────────────────────────────────────────
select lives_ok($$ select pg_temp.make_state(tests.user_id('ali@integrations.test'), 'connect', null, 'demo') $$,
                'oauth_states admits the demo provider (OAUTH-03/04)');
select lives_ok($$ update public.oauth_states set return_to = 'dijitalasistan-dev://integrations/callback'
                   where provider = 'demo' $$, 'a variant app scheme is an allowed return_to');
select throws_ok($$ update public.oauth_states set return_to = 'https://evil.example/cb' where provider = 'demo' $$,
                 '23514', null, 'a foreign return_to is rejected');

-- ─── Callback hand-off for a new identity ───────────────────────────────────────────────────
insert into fx values ('state_new', pg_temp.make_state(tests.user_id('ali@integrations.test'), 'connect'));
insert into fx values ('acct_new', gen_random_uuid());
select lives_ok(
  $$ select private.oauth_callback_store(
       (select id from fx where k = 'state_new'),
       jsonb_build_object('result', 'success', 'completion_code_hash', encode(sha256('code-1'::bytea), 'hex')),
       jsonb_build_object('id', (select id from fx where k = 'acct_new'), 'provider_account_id', 'google-sub-ali',
                          'account_email', 'ali@gmail.com', 'display_label', 'Gmail',
                          'granted_scopes', '["openid","https://www.googleapis.com/auth/gmail.readonly"]'::jsonb,
                          'capabilities_granted', '["mail_read"]'::jsonb),
       jsonb_build_array(pg_temp.cred('refresh'), pg_temp.cred('access'))) $$,
  'the callback stores the connecting account and its ciphertext');
select is((select status::text from public.connected_accounts where id = (select id from fx where k = 'acct_new')), 'connecting',
          'the new account stays connecting');
select ok((select pending_binding_until > now() from public.connected_accounts where id = (select id from fx where k = 'acct_new')),
          'pending_binding_until is set until the completion');
select ok(not private.account_can((select id from fx where k = 'acct_new'), 'mail_read'),
          'an unbound account cannot be used by any job');
select is((select count(*)::integer from public.oauth_credentials where connected_account_id = (select id from fx where k = 'acct_new')),
          2, 'refresh and access ciphertext rows exist');
select is((select count(*)::integer from public.jobs where connected_account_id = (select id from fx where k = 'acct_new')), 0,
          'no sync job exists before the completion (EF-OAUTH-02)');
select ok((select completion_code_hash = sha256('code-1'::bytea) and result = 'success'
           from public.oauth_states where id = (select id from fx where k = 'state_new')),
          'only the completion code hash and the pre-result are stored on the state');
select throws_ok($$ select private.oauth_callback_store((select id from fx where k = 'state_new'), '{"result": "success"}') $$,
                 '55000', 'STATE_CONFLICT', 'a replayed callback cannot overwrite the state');

-- ─── R-07 completion ─────────────────────────────────────────────────────────────────────────
select throws_ok($$ select private.oauth_complete_binding((select id from fx where k = 'state_new'),
                          tests.user_id('bora@integrations.test'), (select id from fx where k = 'acct_new'),
                          '{"status": "syncing", "capabilities_granted": ["mail_read"]}') $$,
                 'P0002', 'NOT_FOUND', 'a completion by another user is refused');
select lives_ok($$ select private.oauth_complete_binding((select id from fx where k = 'state_new'),
                          tests.user_id('ali@integrations.test'), (select id from fx where k = 'acct_new'),
                          '{"status": "syncing", "capabilities_granted": ["mail_read"]}') $$,
                'the initiating user completes the binding');
select ok((select status = 'syncing' and pending_binding_until is null and connected_at is not null
           from public.connected_accounts where id = (select id from fx where k = 'acct_new')),
          'the completed account is syncing and bound');
select ok(private.account_can((select id from fx where k = 'acct_new'), 'mail_read'), 'the bound account can read mail');
select ok((select completed_at is not null and token_ciphertext is null from public.oauth_states
           where id = (select id from fx where k = 'state_new')), 'completed_at set, no token set left on the state');
select throws_ok($$ select private.oauth_complete_binding((select id from fx where k = 'state_new'),
                          tests.user_id('ali@integrations.test'), (select id from fx where k = 'acct_new'),
                          '{"status": "syncing", "capabilities_granted": ["mail_read"]}') $$,
                 '55000', 'STATE_CONFLICT', 'a second completion is refused');

-- Expired binding (callback more than 10 minutes ago).
insert into fx values ('state_old', pg_temp.make_state(tests.user_id('ali@integrations.test'), 'reauth',
                                                        (select id from fx where k = 'acct_new'), 'google',
                                                        now() - interval '11 minutes'));
select throws_ok($$ select private.oauth_complete_binding((select id from fx where k = 'state_old'),
                          tests.user_id('ali@integrations.test'), (select id from fx where k = 'acct_new'),
                          '{"status": "healthy", "capabilities_granted": ["mail_read"]}') $$,
                 '55000', 'STATE_CONFLICT', 'a completion more than 10 minutes after the callback is refused');

-- Reconnect: the held token set is swapped in atomically.
update public.connected_accounts set status = 'needs_reauth', reauth_required_at = now()
where id = (select id from fx where k = 'acct_new');
insert into fx values ('state_re', pg_temp.make_state(tests.user_id('ali@integrations.test'), 'reauth',
                                                       (select id from fx where k = 'acct_new')));
select lives_ok($$ select private.oauth_complete_binding((select id from fx where k = 'state_re'),
                          tests.user_id('ali@integrations.test'), (select id from fx where k = 'acct_new'),
                          '{"status": "healthy", "capabilities_granted": ["mail_read", "mail_send"]}',
                          jsonb_build_array(pg_temp.cred('refresh'))) $$,
                'a reconnect swaps the credentials in');
select ok((select status = 'healthy' and reauth_required_at is null and 'mail_send' = any(capabilities_granted)
           from public.connected_accounts where id = (select id from fx where k = 'acct_new')),
          'the reconnected account is healthy with the new capability');
select is((select count(*)::integer from public.oauth_credentials where connected_account_id = (select id from fx where k = 'acct_new')),
          2, 'the refresh row was replaced, not duplicated');

-- Upgrade resume: the approval's scope block is cleared.
insert into fx values ('approval', tests.make_approval(tests.user_id('ali@integrations.test'), 'email_send'));
update public.approval_actions set requires_scope = 'mail_send' where id = (select id from fx where k = 'approval');
insert into fx values ('state_up', pg_temp.make_state(tests.user_id('ali@integrations.test'), 'upgrade',
                                                       (select id from fx where k = 'acct_new')));
update public.oauth_states set approval_id = (select id from fx where k = 'approval') where id = (select id from fx where k = 'state_up');
select lives_ok($$ select private.oauth_complete_binding((select id from fx where k = 'state_up'),
                          tests.user_id('ali@integrations.test'), (select id from fx where k = 'acct_new'),
                          '{"status": "healthy", "capabilities_granted": ["mail_read", "mail_send"]}') $$,
                'an upgrade completes');
select is((select requires_scope from public.approval_actions where id = (select id from fx where k = 'approval')), null,
          'the upgraded approval no longer requires a scope');

-- A rejected flow deletes the connecting row it created (and its ciphertext).
insert into fx values ('state_bad', pg_temp.make_state(tests.user_id('bora@integrations.test'), 'connect'));
insert into fx values ('acct_bad', gen_random_uuid());
select private.oauth_callback_store(
  (select id from fx where k = 'state_bad'),
  jsonb_build_object('result', 'success', 'completion_code_hash', encode(sha256('code-2'::bytea), 'hex')),
  jsonb_build_object('id', (select id from fx where k = 'acct_bad'), 'provider_account_id', 'google-sub-bora',
                     'capabilities_granted', '["mail_read"]'::jsonb),
  jsonb_build_array(pg_temp.cred('refresh')));
select lives_ok($$ select private.oauth_close_flow((select id from fx where k = 'state_bad'), 'error', 'completion_rejected') $$,
                'a rejected completion closes the flow');
select is((select count(*)::integer from public.connected_accounts where id = (select id from fx where k = 'acct_bad')), 0,
          'the unbound account row is gone');
select is((select count(*)::integer from public.oauth_credentials where connected_account_id = (select id from fx where k = 'acct_bad')),
          0, 'no credentials remain for the rejected flow');

-- ─── Mail upsert: dedupe, aggregates, snippet cap ────────────────────────────────────────────
create function pg_temp.mail(p_id text, p_thread text, p_dir text, p_from text, p_at timestamptz, p_unread boolean) returns jsonb
  language sql
  as $$
    select jsonb_build_object('provider_message_id', p_id, 'provider_thread_id', p_thread, 'direction', p_dir,
                              'from_email', p_from, 'from_name', 'Ahmet Yılmaz', 'to_emails', '["ali@gmail.com"]'::jsonb,
                              'subject', 'Revize teklif', 'snippet', repeat('x', 250), 'received_at', p_at,
                              'is_read', not p_unread, 'labels', '["INBOX"]'::jsonb, 'references_ids', '[]'::jsonb,
                              'content_hash', encode(sha256(convert_to(p_id, 'UTF8')), 'hex'))
  $$;
select is(jsonb_array_length(private.upsert_mail_messages((select id from fx where k = 'acct_new'), jsonb_build_array(
            pg_temp.mail('m1', 't1', 'inbound', 'ahmet@kuzeylojistik.com', now() - interval '2 hours', true),
            pg_temp.mail('m2', 't1', 'outbound', 'ali@gmail.com', now() - interval '1 hour', false)))), 2,
          'two messages upserted');
select is(jsonb_array_length(private.upsert_mail_messages((select id from fx where k = 'acct_new'), jsonb_build_array(
            pg_temp.mail('m1', 't1', 'inbound', 'ahmet@kuzeylojistik.com', now() - interval '2 hours', false)))), 1,
          'a re-sync of the same message is accepted');
select is((select count(*)::integer from public.email_messages where connected_account_id = (select id from fx where k = 'acct_new')),
          2, 'dedupe on (connected_account_id, provider_message_id)');
select is((select char_length(snippet) from public.email_messages where provider_message_id = 'm1'), 200,
          'the stored snippet is capped at 200 characters');
select ok((select message_count = 2 and not has_unread and last_outbound_at is not null
                  and jsonb_array_length(participants) = 2
           from public.email_threads where provider_thread_id = 't1'), 'thread aggregates follow the messages');
select is((select private.apply_mail_changes((select id from fx where k = 'acct_new'),
                   '[{"provider_message_id": "m2", "labels": ["SENT", "STARRED"], "is_read": true}]', array['m1']) ->> 'deleted'),
          '1', 'a provider deletion marks the message');
select ok((select provider_deleted_at is not null from public.email_messages where provider_message_id = 'm1'),
          'provider_deleted_at is set');
select is((select message_count from public.email_threads where provider_thread_id = 't1'), 1,
          'the thread count excludes deleted messages');
select is_empty($$ select column_name from information_schema.columns
                   where table_schema = 'public' and table_name in ('email_messages', 'email_threads')
                     and column_name ~ '(^|_)(body|html|raw)($|_)' $$,
                'no mail table has a body, html or raw column (ADR-05)');

-- ─── Calendars and events ────────────────────────────────────────────────────────────────────
insert into fx values ('acct_cal', tests.make_account(tests.user_id('bora@integrations.test'), 'bora@gmail.com', '{calendar_read}'));
select is(jsonb_array_length(private.upsert_calendars((select id from fx where k = 'acct_cal'), '[
    {"provider_calendar_id": "bora@gmail.com", "name": "Bora", "access_role": "owner", "is_primary": true, "can_write": true, "kind": "default"},
    {"provider_calendar_id": "tr.turkish#holiday@group.v.calendar.google.com", "name": "Tatiller", "access_role": "reader", "kind": "holidays"},
    {"provider_calendar_id": "is-takvimi", "name": "İş", "access_role": "owner", "can_write": true, "kind": "other"}]'::jsonb) -> 'calendars'),
          3, 'the calendar list is stored');
select results_eq($$ select provider_calendar_id from public.calendars
                     where connected_account_id = (select id from fx where k = 'acct_cal') and selected $$,
                  array['bora@gmail.com'], 'Free: only the primary calendar is selected; holidays never');
insert into fx values ('cal_primary', (select id from public.calendars where provider_calendar_id = 'bora@gmail.com'));
select is((private.upsert_calendar_events((select id from fx where k = 'acct_cal'), (select id from fx where k = 'cal_primary'), jsonb_build_array(
            jsonb_build_object('provider_event_id', 'e1', 'title', 'Mehmet ile müşteri toplantısı', 'start_at', now() + interval '1 day',
                               'end_at', now() + interval '1 day 1 hour', 'status', 'confirmed',
                               'conference_url', 'https://meet.google.com/abc-defg-hij',
                               'da_approval_id', gen_random_uuid()),
            jsonb_build_object('provider_event_id', 'e2', 'title', 'Kötü bağlantı', 'start_at', now() + interval '2 days',
                               'end_at', now() + interval '2 days 1 hour', 'conference_url', 'https://evil.example/join'),
            jsonb_build_object('provider_event_id', 'e3', 'title', 'İptal', 'start_at', now(), 'end_at', now(),
                               'status', 'cancelled')), 'provider_sync') ->> 'upserted'), '2', 'events upserted');
select ok((select conference_url is not null and is_online and da_approval_id is null
           from public.calendar_events where provider_event_id = 'e1'),
          'an allow-listed join URL is kept; an unknown approval id is dropped');
select is((select conference_url from public.calendar_events where provider_event_id = 'e2'), null,
          'a non-allow-listed conference URL is stripped');
select ok((select provider_deleted_at is not null and status = 'cancelled' from public.calendar_events where provider_event_id = 'e3'),
          'a cancelled event keeps its row with provider_deleted_at');
-- One transaction has one now(): age the row directly (the updated_at trigger would reset it).
alter table public.calendar_events disable trigger trg_calendar_events_updated_at;
update public.calendar_events set updated_at = now() - interval '1 hour' where provider_event_id = 'e2';
alter table public.calendar_events enable trigger trg_calendar_events_updated_at;
select is(private.prune_calendar_events((select id from fx where k = 'cal_primary'), now() - interval '1 minute'), 1,
          'a full resync prunes events the provider no longer returned');

-- ─── Device snapshot (JOB-06) ────────────────────────────────────────────────────────────────
insert into fx values ('inst', gen_random_uuid());
select is((private.upsert_device_account(tests.user_id('ceyda@integrations.test'), 'apple_device', (select id from fx where k = 'inst'),
                                          '{calendar_read,tasks_read}') ->> 'created'), 'true', 'the first snapshot creates the device account');
insert into fx values ('acct_dev', (select id from public.connected_accounts where provider = 'apple_device'
                                     and user_id = tests.user_id('ceyda@integrations.test')));
create function pg_temp.snapshot(p_at timestamptz, p_events jsonb, p_reminders jsonb default null) returns jsonb
  language sql
  as $$
    select jsonb_build_object('provider', 'apple_device', 'installation_id', (select id from fx where k = 'inst'),
      'window', jsonb_build_object('start', now() - interval '7 days', 'end', now() + interval '30 days'), 'snapshot_at', p_at,
      'calendars', jsonb_build_array(
        jsonb_build_object('device_calendar_hash', repeat('a', 64), 'title', 'iCloud', 'source_title', 'iCloud',
                           'color', '#3F7D5BFF', 'allows_modifications', true, 'selected', true),
        jsonb_build_object('device_calendar_hash', repeat('b', 64), 'title', 'Aile', 'source_title', 'iCloud',
                           'color', null, 'allows_modifications', false, 'selected', false)),
      'events', p_events) || case when p_reminders is null then '{}'::jsonb else jsonb_build_object('reminders', p_reminders) end
  $$;
create function pg_temp.dev_event(p_key text, p_cal text, p_offset interval) returns jsonb
  language sql
  as $$
    select jsonb_build_object('event_key_hash', p_key, 'device_calendar_hash', p_cal, 'title', 'Doktor randevusu',
                              'start_at', now() + p_offset, 'end_at', now() + p_offset + interval '1 hour', 'all_day', false,
                              'location', null, 'attendee_count', 2, 'organizer_is_self', true,
                              'meeting_url', 'https://zoom.us/j/1', 'status', 'confirmed', 'last_modified_at', null)
  $$;
insert into fx values ('upload', private.stage_device_snapshot((select id from fx where k = 'acct_dev'),
  pg_temp.snapshot(now() - interval '5 minutes',
    jsonb_build_array(pg_temp.dev_event(repeat('1', 64), repeat('a', 64), interval '1 day'),
                      pg_temp.dev_event(repeat('2', 64), repeat('a', 64), interval '2 days'),
                      pg_temp.dev_event(repeat('3', 64), repeat('b', 64), interval '3 days')),
    '[{"reminder_key_hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
       "list_hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
       "title": "Faturayı öde", "due_at": null, "completed": false}]') || jsonb_build_object('content_hash', repeat('e', 64))));
select is(private.stage_device_snapshot((select id from fx where k = 'acct_dev'),
            pg_temp.snapshot(now(), '[]'::jsonb) || jsonb_build_object('content_hash', repeat('e', 64))),
          (select id from fx where k = 'upload'), 'an identical upload (same content_hash) is staged once');
select is((private.apply_staged_device_snapshot((select id from fx where k = 'acct_dev'), repeat('e', 64)) ->> 'events'), '2',
          'events of the selected calendar are ingested');
select is((private.apply_staged_device_snapshot((select id from fx where k = 'acct_dev'), repeat('e', 64)) ->> 'skipped'),
          'already_applied', 'a re-run of the ingest job is a no-op');
select is((select count(*)::integer from public.calendar_events where connected_account_id = (select id from fx where k = 'acct_dev')),
          2, 'events of an unselected calendar are dropped');
select ok((select color = '#3F7D5B' from public.calendars where provider_calendar_id = repeat('a', 64)),
          'an 8-digit device colour is normalised');
select is((select attendees from public.calendar_events where provider_event_id = repeat('1', 64)), '[]'::jsonb,
          'attendee identities never arrive from a device (count only)');
select is((private.apply_device_snapshot((select id from fx where k = 'acct_dev'), pg_temp.snapshot(now() - interval '5 minutes',
            '[]'::jsonb)) ->> 'skipped'), 'stale_snapshot', 'a repeated or older snapshot is a no-op');
select is((private.apply_device_snapshot((select id from fx where k = 'acct_dev'), pg_temp.snapshot(now() - interval '1 minute',
            jsonb_build_array(pg_temp.dev_event(repeat('1', 64), repeat('a', 64), interval '1 day')), '[]')) ->> 'deleted'), '1',
          'a window event missing from the next snapshot is deleted');
select is((select count(*)::integer from public.tasks where connected_account_id = (select id from fx where k = 'acct_dev')), 0,
          'a reminder missing from the snapshot is removed');
select ok((select last_success_at is not null from public.sync_states
           where connected_account_id = (select id from fx where k = 'acct_dev') and resource = 'device_calendar'),
          'sync_states records the applied snapshot time (provenance)');

-- ─── Disconnect and purge ────────────────────────────────────────────────────────────────────
select is((private.disconnect_integration((select id from fx where k = 'acct_new'), tests.user_id('ali@integrations.test'),
                                          'provider_revoked', false) ->> 'already'), 'false', 'disconnect succeeds');
select ok((select status = 'disconnected' and disconnected_at is not null and revocation_mode = 'provider_revoked'
           from public.connected_accounts where id = (select id from fx where k = 'acct_new')), 'the account is disconnected');
select is((select count(*)::integer from public.oauth_credentials where connected_account_id = (select id from fx where k = 'acct_new')),
          0, 'no credentials remain after disconnect');
select ok((select run_after > now() + interval '29 days' from public.jobs
           where type = 'integration_purge' and connected_account_id = (select id from fx where k = 'acct_new')),
          'without purge_content the purge runs after 30 days');
select is((private.disconnect_integration((select id from fx where k = 'acct_new'), tests.user_id('ali@integrations.test'),
                                          'provider_revoked', true) ->> 'already'), 'true', 'a second disconnect is a no-op');
select is((private.integration_purge_batch((select id from fx where k = 'acct_new'),
                                           (select disconnected_at from public.connected_accounts where id = (select id from fx where k = 'acct_new')),
                                           true) ->> 'done'), 'true', 'the purge completes');
select is((select count(*)::integer from public.email_messages where connected_account_id = (select id from fx where k = 'acct_new'))
          + (select count(*)::integer from public.connected_accounts where id = (select id from fx where k = 'acct_new')), 0,
          'no content and no account row remain after the purge');
select is((private.integration_purge_batch((select id from fx where k = 'acct_cal'), now() - interval '1 day', false) ->> 'skipped'),
          'reconnected', 'an account that is not disconnected is never purged');

-- ─── Demo writes and leases ──────────────────────────────────────────────────────────────────
insert into fx values ('acct_demo', tests.make_account(tests.user_id('ceyda@integrations.test'), 'ceyda@gmail.com', '{mail_read}', 'demo'));
select is((private.demo_state_record_write((select id from fx where k = 'acct_demo'), 'mail', 'appr-1', '{"id": "demo:reply:1"}') ->> 'created'),
          'true', 'a demo write is recorded');
select is((private.demo_state_record_write((select id from fx where k = 'acct_demo'), 'mail', 'appr-1', '{"id": "other"}') #>> '{item,id}'),
          'demo:reply:1', 'a retried demo write returns the stored item');
select throws_ok($$ select private.demo_state_record_write((select id from fx where k = 'acct_cal'), 'mail', 'k', '{}') $$,
                 'P0002', 'NOT_FOUND', 'only demo accounts have demo state');
insert into public.sync_states (user_id, connected_account_id, resource) values
  (tests.user_id('bora@integrations.test'), (select id from fx where k = 'acct_cal'), 'google_tasks');
insert into fx values ('sync', (select id from public.sync_states where connected_account_id = (select id from fx where k = 'acct_cal')
                                 and resource = 'google_tasks'));
select ok(private.acquire_sync_lease((select id from fx where k = 'sync'), 'job-a'), 'the first job takes the lease');
select ok(not private.acquire_sync_lease((select id from fx where k = 'sync'), 'job-b'), 'a second job cannot take a held lease');

-- ─── Privileges ──────────────────────────────────────────────────────────────────────────────
select tests.authenticate_as(tests.user_id('ali@integrations.test'));
select throws_ok($$ select public.upsert_mail_messages(gen_random_uuid(), '[]') $$, '42501', null,
                 'authenticated users cannot call the integration wrappers');
select tests.clear_authentication();
select is_empty($$ select p.oid::regprocedure::text from pg_proc p
                   where p.pronamespace = 'public'::regnamespace
                     and p.proname in ('oauth_callback_store', 'oauth_complete_binding', 'oauth_close_flow', 'upsert_mail_messages',
                                       'apply_device_snapshot', 'disconnect_integration', 'integration_purge_batch',
                                       'demo_state_record_write')
                     and (has_function_privilege('authenticated', p.oid, 'execute')
                          or not has_function_privilege('service_role', p.oid, 'execute')) $$,
                'the wrappers are service_role only');

select * from finish();
rollback;
