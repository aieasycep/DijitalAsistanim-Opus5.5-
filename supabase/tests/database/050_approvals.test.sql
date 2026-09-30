-- pgTAP · approval state machine (plan §5, R-03, R-06, R-18; DATABASE_AND_RLS_PLAN §6.6, §13.2 050).
begin;
select plan(34);

select tests.create_user('deniz@approvals.test');
select tests.create_user('ece@approvals.test');

create temporary table ap (k text primary key, id uuid) on commit drop;
grant select on ap to authenticated;
insert into ap values
  ('main', tests.make_approval(tests.user_id('deniz@approvals.test'))),
  ('reject', tests.make_approval(tests.user_id('deniz@approvals.test'))),
  ('expired', tests.make_approval(tests.user_id('deniz@approvals.test'), 'task_create', 'server', now() - interval '1 minute')),
  ('edit', tests.make_approval(tests.user_id('deniz@approvals.test'))),
  ('dev_inst', tests.make_installation(tests.user_id('deniz@approvals.test'))),
  ('other_inst', tests.make_installation(tests.user_id('ece@approvals.test'), 'android'));
insert into ap values
  ('device', tests.make_approval(tests.user_id('deniz@approvals.test'), 'calendar_create', 'device', now() + interval '1 day',
                                 (select id from ap where k = 'dev_inst'))),
  ('foreign_device', tests.make_approval(tests.user_id('deniz@approvals.test'), 'calendar_create', 'device', now() + interval '1 day',
                                         (select id from ap where k = 'other_inst')));

create or replace function pg_temp.key_of(p_id uuid) returns text language sql as $$
  select idempotency_key from public.approval_actions where id = p_id $$;
create or replace function pg_temp.events_of(p_id uuid) returns integer language sql as $$
  select count(*)::integer from public.approval_events where approval_action_id = p_id $$;

-- ─── Legal edges and their events ────────────────────────────────────────────────────────────
select throws_ok(format($$ select private.transition_approval(%L, 'approved', 'user', %L, 'wrong-key', null, null, null, null,
                                                             'approval_center') $$,
                        (select id from ap where k = 'main'), tests.user_id('deniz@approvals.test')),
                 '55000', 'IDEMPOTENCY_MISMATCH', 'approve with a wrong key');
select throws_ok(format($$ select private.transition_approval(%L, 'approved', 'user', null, %L) $$,
                        (select id from ap where k = 'main'), pg_temp.key_of((select id from ap where k = 'main'))),
                 '22023', 'VALIDATION_FAILED:approved_via', 'approve without a tap surface (R-03)');
select throws_ok(format($$ select private.transition_approval(%L, 'executing', 'worker', null, null) $$,
                        (select id from ap where k = 'main')),
                 '55000', 'ILLEGAL_TRANSITION:pending->executing', 'pending → executing is illegal');
select is((private.transition_approval((select id from ap where k = 'main'), 'approved', 'user', tests.user_id('deniz@approvals.test'),
                                       pg_temp.key_of((select id from ap where k = 'main')), null, null, null, null,
                                       'approval_center')).status::text,
          'approved', 'pending → approved');
select is(pg_temp.events_of((select id from ap where k = 'main')), 1, 'exactly one event written');
select is((select approved_via::text from public.approval_actions where id = (select id from ap where k = 'main')), 'approval_center',
          'approved_via stored');
select ok(exists (select 1 from public.jobs where idempotency_key = 'approval_execute:' || (select id from ap where k = 'main') || ':v1'),
          'server approval enqueues approval_execute:{id}:v1');
select is((private.transition_approval((select id from ap where k = 'main'), 'approved', 'user', null,
                                       pg_temp.key_of((select id from ap where k = 'main')), null, null, null, null,
                                       'approval_center')).status::text,
          'approved', 'repeated approve with the same key is a no-op');
select is(pg_temp.events_of((select id from ap where k = 'main')), 1, 'no second event');
select is((private.transition_approval((select id from ap where k = 'main'), 'executing', 'worker', null, null)).attempt_count::integer,
          1, 'approved → executing counts the attempt');
select is((private.transition_approval((select id from ap where k = 'main'), 'failed', 'worker', null, null, null, null,
                                       'PROVIDER_ERROR', 'provider said no')).status::text, 'failed', 'executing → failed');
select throws_ok(format($$ select private.transition_approval(%L, 'rejected', 'user', null, null) $$, (select id from ap where k = 'main')),
                 '55000', 'ILLEGAL_TRANSITION:failed->rejected', 'failed → rejected is illegal (R-06)');
select throws_ok(format($$ select private.transition_approval(%L, 'expired', 'system', null, null) $$, (select id from ap where k = 'main')),
                 '55000', 'ILLEGAL_TRANSITION:failed->expired', 'failed → expired is illegal (R-06)');
select is((private.transition_approval((select id from ap where k = 'main'), 'executing', 'worker', null,
                                       pg_temp.key_of((select id from ap where k = 'main')))).status::text,
          'executing', 'failed → executing retry keeps the key');
select is((select status::text from public.jobs where idempotency_key = 'approval_execute:' || (select id from ap where k = 'main') || ':v1'),
          'queued', 'the retry re-queues the same job');
select is((private.transition_approval((select id from ap where k = 'main'), 'executed', 'worker', null, null, null,
                                       '{"provider_idempotency_ref": "evt-1"}')).status::text,
          'executed', 'executing → executed');
select throws_ok(format($$ select private.transition_approval(%L, 'failed', 'worker', null, null) $$, (select id from ap where k = 'main')),
                 '55000', 'ILLEGAL_TRANSITION:executed->failed', 'executed → failed is illegal');
select ok(exists (select 1 from public.audit_logs where action = 'approval.executed' and target_id = (select id from ap where k = 'main')::text
                   and details ? 'action_type' and not details ? 'payload'),
          'executed writes an audit row without the payload');

select is((private.transition_approval((select id from ap where k = 'reject'), 'rejected', 'user', null, null, 'user_reject')).status::text,
          'rejected', 'pending → rejected');
select throws_ok(format($$ select private.transition_approval(%L, 'approved', 'user', null, %L, null, null, null, null, 'inline_sheet') $$,
                        (select id from ap where k = 'reject'), pg_temp.key_of((select id from ap where k = 'reject'))),
                 '55000', 'ILLEGAL_TRANSITION:rejected->approved', 'rejected → approved is illegal');
select is((private.transition_approval((select id from ap where k = 'expired'), 'approved', 'user', null,
                                       pg_temp.key_of((select id from ap where k = 'expired')), null, null, null, null,
                                       'approval_center')).status::text,
          'expired', 'approving after approval_expires_at moves the row to expired');
select throws_ok(format($$ select private.transition_approval(%L, 'approved', 'user', null, %L, null, null, null, null, 'approval_center') $$,
                        (select id from ap where k = 'expired'), pg_temp.key_of((select id from ap where k = 'expired'))),
                 '55000', 'ILLEGAL_TRANSITION:expired->approved', 'expired → approved is illegal');

-- ─── Edit while pending (SREQ-44) ────────────────────────────────────────────────────────────
select is((private.edit_approval_payload((select id from ap where k = 'edit'), tests.user_id('deniz@approvals.test'),
                                         '{"title": "Teklif hazırlama v2"}', sha256('v2'::bytea), 'Başlık değişti')).payload_version,
          2, 'edit bumps payload_version');
select is(pg_temp.key_of((select id from ap where k = 'edit')), 'approval:' || (select id from ap where k = 'edit') || ':v2',
          'edit issues the new idempotency key');
select throws_ok(format($$ select private.edit_approval_payload(%L, %L, '{}', '\x00', 'x') $$,
                        (select id from ap where k = 'reject'), tests.user_id('deniz@approvals.test')),
                 '55000', null, 'edit is rejected when not pending');

-- ─── Device executor (R-18) ──────────────────────────────────────────────────────────────────
select throws_ok(format($$ select private.transition_approval(%L, 'approved', 'user', null, %L, null, null, null, null, 'approval_center') $$,
                        (select id from ap where k = 'foreign_device'), pg_temp.key_of((select id from ap where k = 'foreign_device'))),
                 '42501', 'DEVICE_INSTALLATION_MISMATCH', 'approval on another user''s installation is rejected');
select lives_ok(format($$ select private.transition_approval(%L, 'approved', 'user', null, %L, null, null, null, null, 'approval_center');
                         select private.transition_approval(%L, 'executing', 'user', null, null) $$,
                       (select id from ap where k = 'device'), pg_temp.key_of((select id from ap where k = 'device')),
                       (select id from ap where k = 'device')),
                'device approval: pending → approved → executing');
select ok(not exists (select 1 from public.jobs where idempotency_key like 'approval_execute:' || (select id from ap where k = 'device') || '%'),
          'device approvals enqueue no job');
select throws_ok(format($$ select private.transition_approval(%L, 'executed', 'user', null, null, null, null, null, null, null, '\x01') $$,
                        (select id from ap where k = 'device')),
                 '42501', 'DEVICE_TOKEN_MISMATCH', 'a device result needs the matching token hash');
select is(private.fail_stale_device_approvals(now() + interval '11 minutes'), 1, 'a device row executing for 10+ minutes fails');
select is((select last_error_code from public.approval_actions where id = (select id from ap where k = 'device')), 'DEVICE_RESULT_MISSING',
          'with DEVICE_RESULT_MISSING');

-- ─── Guards ──────────────────────────────────────────────────────────────────────────────────
select throws_ok(format($$ update public.approval_actions set status = 'executed' where id = %L $$, (select id from ap where k = 'edit')),
                 '42501', 'APPROVAL_TX_REQUIRED', 'direct status update outside transition_approval raises (even for the owner role)');
select throws_ok($$ update public.approval_events set reason = 'x' $$, '55000', 'AUDIT_IMMUTABLE', 'approval_events are append-only');
select tests.authenticate_as(tests.user_id('deniz@approvals.test'));
select throws_ok(format($$ update public.approval_actions set executor = 'server' where id = %L $$, (select id from ap where k = 'edit')),
                 '42501', null, 'authenticated cannot update approvals');
select tests.clear_authentication();

select * from finish();
rollback;
