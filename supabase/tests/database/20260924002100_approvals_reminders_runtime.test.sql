-- pgTAP · approvals, device execution and reminders runtime (T-6.01, T-6.05, T-6.06; migration
-- 20260924002100): create_approval, pending-origin uniqueness, start_device_execution,
-- schedule_reminder / cancel_reminder and the service-role-only wrappers.
begin;
select plan(36);

select tests.create_user('selin@runtime.test');
select tests.create_user('mert@runtime.test');

create temporary table rt (k text primary key, id uuid) on commit drop;
insert into rt values
  ('inst', tests.make_installation(tests.user_id('selin@runtime.test'))),
  ('other_inst', tests.make_installation(tests.user_id('mert@runtime.test'), 'android'));

create or replace function pg_temp.proposal(p_origin_ref uuid, p_extra jsonb default '{}'::jsonb) returns jsonb
  language sql as $$
    select jsonb_build_object(
      'action_type', 'task_create', 'payload', '{"action_type":"task_create","target":{"kind":"in_app"},"title":"Teklifi gönder"}'::jsonb,
      'payload_hash_hex', encode(sha256('task'::bytea), 'hex'), 'what', 'Görev oluştur', 'why', 'Mailde istendi.',
      'change_summary', 'Yeni görev: Teklifi gönder', 'side_effects', '[{"code":"internal_record","text":"Uygulamada görev"}]'::jsonb,
      'exact_change', '{"kind":"create","fields":[]}'::jsonb, 'origin', 'email_detail', 'origin_ref_id', p_origin_ref,
      'approval_expires_at', now() + interval '7 days', 'source_type', 'user_input', 'source_id', 'test',
      'source_timestamp', now(), 'confidence', 1) || p_extra
  $$;

-- ─── create_approval ─────────────────────────────────────────────────────────────────────────
insert into rt values ('ref', gen_random_uuid());
insert into rt values ('a1', (public.create_approval(tests.user_id('selin@runtime.test'), pg_temp.proposal((select id from rt where k = 'ref')))).id);
select is((select idempotency_key from public.approval_actions where id = (select id from rt where k = 'a1')),
          'approval:' || (select id from rt where k = 'a1') || ':v1', 'the key is approval:{id}:v1');
select is((select status::text from public.approval_actions where id = (select id from rt where k = 'a1')), 'pending', 'created pending');
select is((select count(*)::integer from public.approval_events
           where approval_action_id = (select id from rt where k = 'a1') and from_status is null and to_status = 'pending'),
          1, 'a pending event is written with the proposal');
select throws_ok(format($$ select public.create_approval(%L, pg_temp.proposal(%L)) $$,
                        tests.user_id('selin@runtime.test'), (select id from rt where k = 'ref')),
                 '23505', 'APPROVAL_PENDING_DUPLICATE:' || (select id from rt where k = 'a1'),
                 'a second pending proposal for the same origin names the existing one');
select lives_ok(format($$ select public.create_approval(%L, pg_temp.proposal(%L, jsonb_build_object('batch_id', gen_random_uuid()))) $$,
                       tests.user_id('selin@runtime.test'), (select id from rt where k = 'ref')),
                'batch rows may share an origin');
select lives_ok(format($$ select public.create_approval(%L, pg_temp.proposal(%L, '{"action_type":"reminder_create"}'::jsonb)) $$,
                       tests.user_id('selin@runtime.test'), (select id from rt where k = 'ref')),
                'another action type for the same origin is allowed');
select lives_ok(format($$ select public.create_approval(%L, pg_temp.proposal(%L, '{"origin":"insight"}'::jsonb)) $$,
                       tests.user_id('selin@runtime.test'), gen_random_uuid()),
                'origin insight is accepted');
select lives_ok(format($$ select public.create_approval(%L, pg_temp.proposal(null, '{"origin":"manual"}'::jsonb)) $$,
                       tests.user_id('selin@runtime.test')),
                'origin manual is accepted');
select throws_ok(format($$ select public.create_approval(%L, pg_temp.proposal(null, '{"origin":"voice_command"}'::jsonb)) $$,
                        tests.user_id('selin@runtime.test')),
                 '23514', null, 'an unknown origin is rejected');
select throws_ok(format($$ select public.create_approval(%L, pg_temp.proposal(null, jsonb_build_object('executor', 'device',
                                                          'device_installation_id', %L::uuid))) $$,
                        tests.user_id('selin@runtime.test'), (select id from rt where k = 'other_inst')),
                 '42501', 'DEVICE_INSTALLATION_MISMATCH', 'a device target must be one of the owner''s installations');
select throws_ok(format($$ select public.create_approval(%L, pg_temp.proposal(null, '{"payload_hash_hex":"zz"}'::jsonb)) $$,
                        tests.user_id('selin@runtime.test')),
                 '22023', 'VALIDATION_FAILED:payload_hash', 'the payload hash is required');

-- rejecting the first one frees the origin
select is((public.transition_approval((select id from rt where k = 'a1'), 'rejected', 'user', null, null, 'user_reject')).status::text,
          'rejected', 'reject the pending proposal');
select lives_ok(format($$ select public.create_approval(%L, pg_temp.proposal(%L)) $$,
                       tests.user_id('selin@runtime.test'), (select id from rt where k = 'ref')),
                'a new proposal for the same origin after the previous one left pending');

-- ─── start_device_execution ──────────────────────────────────────────────────────────────────
insert into rt values ('dev', (public.create_approval(tests.user_id('selin@runtime.test'),
  pg_temp.proposal(null, jsonb_build_object('action_type', 'calendar_create', 'executor', 'device',
                                            'device_installation_id', (select id from rt where k = 'inst'))))).id);
select throws_ok(format($$ select public.start_device_execution(%L, %L, %L, sha256('t1'::bytea)) $$,
                        (select id from rt where k = 'dev'), tests.user_id('selin@runtime.test'), (select id from rt where k = 'inst')),
                 '55000', 'ILLEGAL_TRANSITION:pending->executing', 'a pending device approval cannot start');
select is((public.transition_approval((select id from rt where k = 'dev'), 'approved', 'user', null,
                                      'approval:' || (select id from rt where k = 'dev') || ':v1', null, null, null, null,
                                      'inline_sheet')).status::text, 'approved', 'approve the device approval');
select ok(not exists (select 1 from public.jobs where idempotency_key like 'approval_execute:' || (select id from rt where k = 'dev') || '%'),
          'no worker job for a device target');
select throws_ok(format($$ select public.start_device_execution(%L, %L, %L, sha256('t1'::bytea)) $$,
                        (select id from rt where k = 'dev'), tests.user_id('selin@runtime.test'), (select id from rt where k = 'other_inst')),
                 '42501', 'DEVICE_INSTALLATION_MISMATCH', 'another installation cannot claim');
select throws_ok(format($$ select public.start_device_execution(%L, %L, %L, sha256('t1'::bytea)) $$,
                        (select id from rt where k = 'dev'), tests.user_id('mert@runtime.test'), (select id from rt where k = 'inst')),
                 'P0002', 'NOT_FOUND', 'another user cannot claim');
select is((public.start_device_execution((select id from rt where k = 'dev'), tests.user_id('selin@runtime.test'),
                                         (select id from rt where k = 'inst'), sha256('t1'::bytea))).status::text,
          'executing', 'the destination claims: approved → executing');
select is((select device_token_hash from public.approval_actions where id = (select id from rt where k = 'dev')), sha256('t1'::bytea),
          'only the token hash is stored');
select is((public.start_device_execution((select id from rt where k = 'dev'), tests.user_id('selin@runtime.test'),
                                         (select id from rt where k = 'inst'), sha256('t2'::bytea))).device_token_hash,
          sha256('t2'::bytea), 're-claiming while executing rotates the token');
select is((select count(*)::integer from public.approval_events where approval_action_id = (select id from rt where k = 'dev')
           and to_status = 'executing'), 1, 'the rotation writes no second executing event');
select throws_ok(format($$ select public.transition_approval(%L, 'executed', 'user', null, null, null, null, null, null, null,
                                                            sha256('t1'::bytea)) $$, (select id from rt where k = 'dev')),
                 '42501', 'DEVICE_TOKEN_MISMATCH', 'the old token no longer reports a result');
select is((public.transition_approval((select id from rt where k = 'dev'), 'executed', 'user', null, null, null,
                                      '{"provider_idempotency_ref":"abc"}'::jsonb, null, null, null, sha256('t2'::bytea))).status::text,
          'executed', 'the current token reports executed');

-- ─── schedule_reminder / cancel_reminder ─────────────────────────────────────────────────────
create or replace function pg_temp.reminder(p_key text, p_channel text default 'push') returns jsonb
  language sql as $$
    select jsonb_build_object('title', 'Teklifi gönder', 'remind_at', now() + interval '2 hours', 'preset', 'custom',
                              'channel', p_channel, 'idempotency_key', p_key, 'origin', 'today', 'category', 'deadline')
  $$;
insert into rt values ('r1', ((public.schedule_reminder(tests.user_id('selin@runtime.test'), pg_temp.reminder('key-1'))) -> 'reminder' ->> 'id')::uuid);
select is((select count(*)::integer from public.notifications where dedupe_key = 'reminder:' || (select id from rt where k = 'r1')
           and decision = 'scheduled' and android_channel = 'reminders'), 1, 'a push reminder has its scheduled ledger row');
select is((select run_after from public.jobs where idempotency_key = 'reminder:' || (select id from rt where k = 'r1')),
          (select remind_at from public.reminders where id = (select id from rt where k = 'r1')),
          'the notification job runs at the fire time');
select is((public.schedule_reminder(tests.user_id('selin@runtime.test'), pg_temp.reminder('key-1')) ->> 'created')::boolean, false,
          'a replay with the same key creates nothing');
select is((select count(*)::integer from public.reminders where user_id = tests.user_id('selin@runtime.test')), 1,
          'still one reminder row');
select is((select count(*)::integer from public.jobs where idempotency_key = 'reminder:' || (select id from rt where k = 'r1')), 1,
          'still one job');
insert into rt values ('r2', ((public.schedule_reminder(tests.user_id('selin@runtime.test'), pg_temp.reminder('key-2', 'local'))) -> 'reminder' ->> 'id')::uuid);
select ok(not exists (select 1 from public.notifications where dedupe_key = 'reminder:' || (select id from rt where k = 'r2')),
          'a local reminder gets no server push');
select throws_ok(format($$ select public.cancel_reminder(%L, %L) $$, tests.user_id('mert@runtime.test'), (select id from rt where k = 'r1')),
                 'P0002', 'NOT_FOUND', 'another user cannot cancel');
select is((public.cancel_reminder(tests.user_id('selin@runtime.test'), (select id from rt where k = 'r1'))).status::text, 'cancelled',
          'cancel moves scheduled → cancelled');
select is((select status::text || ':' || last_error_code from public.jobs where idempotency_key = 'reminder:' || (select id from rt where k = 'r1')),
          'failed:CANCELLED', 'the pending push job fails with CANCELLED');
select is((select decision::text || ':' || suppression_reason from public.notifications
           where dedupe_key = 'reminder:' || (select id from rt where k = 'r1')),
          'suppressed:low_relevance', 'the ledger row is suppressed');

-- ─── wrappers are service-role only ──────────────────────────────────────────────────────────
select tests.authenticate_as(tests.user_id('selin@runtime.test'));
select throws_ok(format($$ select public.create_approval(%L, '{}'::jsonb) $$, tests.user_id('selin@runtime.test')),
                 '42501', null, 'clients cannot call create_approval');
select throws_ok(format($$ select public.schedule_reminder(%L, '{}'::jsonb) $$, tests.user_id('selin@runtime.test')),
                 '42501', null, 'clients cannot call schedule_reminder');
select tests.clear_authentication();

select * from finish();
rollback;
