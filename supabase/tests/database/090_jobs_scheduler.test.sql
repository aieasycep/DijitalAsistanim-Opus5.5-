-- pgTAP · job queue (claim / lease / back-off / dead letter / coalescing), rate limits and the
-- DST-safe scheduler tick (DATABASE_AND_RLS_PLAN §6.2, §6.3, §6.5; §13.2 090, 091, 092).
begin;
select plan(52);

-- ═══ Jobs ═════════════════════════════════════════════════════════════════════════════════════
select is(public.enqueue_job('health_check', 'test:idem'), public.enqueue_job('health_check', 'test:idem'),
          'enqueue_job with the same key returns the same id');
select public.enqueue_job('embedding', 'test:coalesce:pending', '{}', null, null, now(), 5::smallint);
select public.enqueue_job('retention', 'test:retry', '{}', null, null, now(), 6::smallint, 3);
select public.enqueue_job('export', 'test:fatal', '{}', null, null, now(), 7::smallint);
select public.enqueue_job('ai_eval', 'test:poison', '{}', null, null, now(), 8::smallint);
select public.enqueue_job('health_check', 'test:future', '{}', null, null, now() + interval '1 hour', 1::smallint);

create temporary table claimed on commit drop as
select * from public.claim_jobs('worker-a', array['embedding', 'retention', 'export', 'ai_eval', 'health_check']::public.job_type[], 10, 120);
select is((select count(*)::integer from claimed), 5, 'claim_jobs claims every due job (not the future one)');
select ok((select bool_and(status = 'running' and lease_owner = 'worker-a' and attempts = 1
                           and lease_expires_at between now() + interval '119 seconds' and now() + interval '121 seconds') from claimed),
          'claimed jobs are running, leased to the worker, attempt 1');
select is((select count(*)::integer from public.job_attempts where job_id in (select id from claimed) and worker_id = 'worker-a'), 5,
          'one job_attempts row per claimed job');
select is((select idempotency_key from claimed where type = 'embedding'),
          'test:coalesce:pending:' || (select id from claimed where type = 'embedding'),
          'a :pending coalescing key is renamed to key:{id} on claim');
select isnt(public.enqueue_job('embedding', 'test:coalesce:pending'), (select id from claimed where type = 'embedding'),
            'so a new job with the same coalescing key can queue while the first runs');
select is((select count(*)::integer from public.claim_jobs('worker-b', array['retention']::public.job_type[])), 0,
          'a running job is never claimed twice');

select is(public.fail_job((select id from claimed where type = 'retention'), 'worker-a', 'UPSTREAM_TIMEOUT', 'timeout', true),
          'retrying'::public.job_status, 'retryable failure → retrying');
select ok((select run_after between now() + interval '24 seconds' and now() + interval '36 seconds'
           from public.jobs where idempotency_key = 'test:retry'),
          'attempt 1 back-off is 30 s ± 20 %');
select is((select outcome from public.job_attempts where job_id = (select id from claimed where type = 'retention')), 'retrying',
          'the attempt is closed as retrying');
update public.jobs set run_after = now() - interval '1 second' where idempotency_key = 'test:retry';
select is((select attempts from public.claim_jobs('worker-a', array['retention']::public.job_type[])), 2, 'the retry is claimed as attempt 2');
select is(public.fail_job((select id from claimed where type = 'retention'), 'worker-a', 'RATE_LIMITED', 'slow down', true, 600),
          'retrying'::public.job_status, 'provider Retry-After honoured');
select ok((select run_after between now() + interval '599 seconds' and now() + interval '601 seconds'
           from public.jobs where idempotency_key = 'test:retry'), 'Retry-After overrides the computed delay');
update public.jobs set run_after = now() - interval '1 second', max_attempts = 3 where idempotency_key = 'test:retry';
select public.claim_jobs('worker-a', array['retention']::public.job_type[]);
select is(public.fail_job((select id from claimed where type = 'retention'), 'worker-a', 'UPSTREAM_TIMEOUT', 'again', true),
          'dead_letter'::public.job_status, 'attempts exhausted → dead_letter');
select is(public.fail_job((select id from claimed where type = 'export'), 'worker-a', 'PROVIDER_REAUTH_REQUIRED', 'reauth', false),
          'failed'::public.job_status, 'non-retryable → failed');
select is(public.fail_job((select id from claimed where type = 'ai_eval'), 'worker-a', 'POISON_PAYLOAD', 'bad payload', true),
          'dead_letter'::public.job_status, 'a poison payload dead-letters on the first attempt');
select throws_ok(format($$ select public.complete_job(%L, 'worker-z') $$, (select id from claimed where type = 'health_check')),
                 '55000', 'LEASE_LOST', 'complete_job by another worker → LEASE_LOST');
select lives_ok(format($$ select public.update_job_progress(%L, 'worker-a', '{"mails": 12}') $$, (select id from claimed where type = 'health_check')),
                'progress is merged while the lease is held');
select ok(public.extend_job_lease((select id from claimed where type = 'health_check'), 'worker-a', 300), 'lease extended by its owner');
select ok(not public.extend_job_lease((select id from claimed where type = 'health_check'), 'worker-z', 300), 'not by another worker');
update public.jobs set lease_expires_at = now() - interval '1 second' where id = (select id from claimed where type = 'embedding');
select is(private.reap_expired_leases(now()), 1, 'reap_expired_leases handles the expired lease');
select results_eq($$ select status::text, last_error_code from public.jobs where id = (select id from claimed where type = 'embedding') $$,
                  $$ values ('retrying', 'LEASE_EXPIRED') $$, 'as a retryable LEASE_EXPIRED failure');
select lives_ok(format($$ select public.complete_job(%L, 'worker-a', '{"ok": true}') $$, (select id from claimed where type = 'health_check')),
                'complete_job by the lease owner');
select is((select status::text from public.jobs where id = (select id from claimed where type = 'health_check')), 'completed', 'job completed');

-- ═══ Rate limits ══════════════════════════════════════════════════════════════════════════════
select is((select array_agg(public.rate_limit_hit('test:rl', 5, 60) order by g) from generate_series(1, 6) as g),
          array[true, true, true, true, true, false], '5 hits allowed at limit 5, the 6th is refused');
select ok(public.rate_limit_hit('test:rl:other', 5, 60), 'another key has its own window');

select tests.as_service_role();
select ok(public.enqueue_job('health_check', 'test:service') is not null, 'service_role enqueues through the public wrapper');
select is((select count(*)::integer from public.claim_jobs('worker-s', array['health_check']::public.job_type[])), 1,
          'service_role claims through the public wrapper');
select results_eq($$ select is_active from public.effective_entitlement(tests.user_id('client@jobs.test')) $$, array[false],
                  'service_role reads any user''s entitlement');
select tests.clear_authentication();

select tests.create_user('client@jobs.test');
select tests.authenticate_as(tests.user_id('client@jobs.test'));
select throws_ok($$ select * from public.claim_jobs('x') $$, '42501', null, 'authenticated cannot claim jobs');
select throws_ok($$ select public.rate_limit_hit('x', 1, 1) $$, '42501', null, 'authenticated cannot hit rate limits');
select throws_ok($$ select public.enqueue_job('health_check', 'x') $$, '42501', null, 'authenticated cannot enqueue jobs');
select throws_ok($$ select count(*) from public.jobs $$, '42501', null, 'jobs are invisible to users');
select tests.clear_authentication();

-- ═══ scheduler_tick (DST-safe, deterministic p_now) ═══════════════════════════════════════════
-- Istanbul (UTC+3, no DST): Monday 2026-09-28 08:00 local = 05:00Z.
select tests.create_user('ist@sched.test', 'Europe/Istanbul');
select private.scheduler_tick('2026-09-28 05:00:00+00');
select private.scheduler_tick('2026-09-28 05:01:00+00');
select results_eq($$ select kind::text, local_date::text, scheduled_for from public.briefings where user_id = tests.user_id('ist@sched.test') $$,
                  $$ values ('morning', '2026-09-28', '2026-09-28 05:00:00+00'::timestamptz) $$,
                  'Istanbul 08:00 → one morning briefing, no duplicate on the next tick');
select ok(exists (select 1 from public.jobs where idempotency_key = 'briefing:' || tests.user_id('ist@sched.test') || ':morning:2026-09-28'),
          'with its briefing job');

-- Berlin fall back (2026-10-25, Sunday): 02:30 local happens at 00:30Z and again at 01:30Z.
select tests.create_user('ber@sched.test', 'Europe/Berlin');
update public.user_preferences set morning_time = '02:30', weekend_morning_time = '02:30', midday_enabled = false,
                                   evening_enabled = false, weekly_enabled = false
where user_id = tests.user_id('ber@sched.test');
select private.scheduler_tick(t) from unnest(array['2026-10-25 00:00:00+00', '2026-10-25 00:30:00+00', '2026-10-25 01:30:00+00',
                                                     '2026-10-25 02:30:00+00']::timestamptz[]) as t;
select is((select count(*)::integer from public.briefings where user_id = tests.user_id('ber@sched.test')), 1,
          'Berlin fall back: the repeated 02:30 fires exactly one morning briefing');

-- New York spring forward (2026-03-08, Sunday): 02:30 local does not exist; fires at 03:00 EDT.
select tests.create_user('nyc@sched.test', 'America/New_York');
update public.user_preferences set morning_time = '02:30', weekend_morning_time = '02:30', midday_enabled = false,
                                   evening_enabled = false, weekly_enabled = false
where user_id = tests.user_id('nyc@sched.test');
select private.scheduler_tick('2026-03-08 06:59:00+00');
select is((select count(*)::integer from public.briefings where user_id = tests.user_id('nyc@sched.test')), 0,
          'New York: nothing at 01:59 EST');
select private.scheduler_tick('2026-03-08 07:00:00+00');
select is((select count(*)::integer from public.briefings where user_id = tests.user_id('nyc@sched.test')), 1,
          'New York spring forward: the gap slot fires at the first existing minute (03:00 EDT)');

-- Weekly only on the ISO weekday at ≥ weekly_time; weekday exclusions; disabled users.
select tests.create_user('week@sched.test', 'Europe/Istanbul');
update public.user_preferences set morning_enabled = false where user_id = tests.user_id('week@sched.test');
select private.scheduler_tick('2026-09-26 15:00:00+00');
select private.scheduler_tick('2026-09-27 15:00:00+00');
select results_eq($$ select kind::text, local_date::text from public.briefings where user_id = tests.user_id('week@sched.test') $$,
                  $$ values ('weekly', '2026-09-27') $$, 'weekly fires on ISO Sunday at 18:00 local only');
select tests.create_user('nosat@sched.test', 'Europe/Istanbul');
update public.user_preferences set briefing_weekdays = '{1,2,3,4,5,7}' where user_id = tests.user_id('nosat@sched.test');
select tests.create_user('off@sched.test', 'Europe/Istanbul');
update public.profiles set state = 'disabled' where user_id = tests.user_id('off@sched.test');
select private.scheduler_tick('2026-09-26 07:00:00+00');
select is((select count(*)::integer from public.briefings where user_id = tests.user_id('nosat@sched.test')), 0,
          'briefing_weekdays without Saturday → nothing on Saturday');
select is((select count(*)::integer from public.briefings where user_id = tests.user_id('off@sched.test')), 0, 'disabled users get nothing');

-- R-23 meeting prep, reminders, approvals, bindings, device approvals, Support Access, rollups.
select tests.create_user('pro@sched.test', 'Europe/Istanbul');
select tests.make_pro(tests.user_id('pro@sched.test'));
create temporary table sx (k text primary key, id uuid) on commit drop;
insert into sx values ('acct', tests.make_account(tests.user_id('pro@sched.test'), 'pro@kuzey.com'));
insert into sx values ('cal', tests.make_calendar(tests.user_id('pro@sched.test'), (select id from sx where k = 'acct')));
insert into sx values
  ('external', tests.make_event(tests.user_id('pro@sched.test'), (select id from sx where k = 'acct'), (select id from sx where k = 'cal'),
                                'Müşteri toplantısı', '2026-09-28 10:50:00+00', '2026-09-28 11:50:00+00',
                                '[{"email": "mehmet@yilmazendustri.com"}]')),
  ('internal', tests.make_event(tests.user_id('pro@sched.test'), (select id from sx where k = 'acct'), (select id from sx where k = 'cal'),
                                'Haftalık ekip', '2026-09-28 10:55:00+00', '2026-09-28 11:30:00+00',
                                '[{"email": "ekip@kuzey.com"}]')),
  ('lead', tests.make_event(tests.user_id('pro@sched.test'), (select id from sx where k = 'acct'), (select id from sx where k = 'cal'),
                            'Kısa görüşme', '2026-09-28 10:30:00+00', '2026-09-28 10:45:00+00', '[{"email": "ekip@kuzey.com"}]')),
  ('approval', tests.make_approval(tests.user_id('pro@sched.test'), 'task_create', 'server', '2026-09-28 09:00:00+00'));
insert into public.reminders (user_id, title, remind_at, preset, idempotency_key, source_id, source_timestamp, confidence)
values (tests.user_id('pro@sched.test'), 'Teklifi gönder', '2026-09-28 10:00:30+00', 'custom', 'rem-1', 'test', now(), 1);
insert into public.connected_accounts (user_id, provider, provider_account_id, status, pending_binding_until)
values (tests.user_id('pro@sched.test'), 'microsoft', 'pending-binding', 'connecting', '2026-09-28 09:55:00+00');
insert into public.support_access_grants (admin_user_id, user_id, scope, reason, starts_at, expires_at)
values (tests.create_admin('support@sched.test', 'support'), tests.user_id('pro@sched.test'), '{insights}',
        'ticket follow-up investigation', '2026-09-28 09:00:00+00', '2026-09-28 09:15:00+00');
insert into public.sync_states (user_id, connected_account_id, resource, watch_kind, watch_renew_after)
values (tests.user_id('pro@sched.test'), (select id from sx where k = 'acct'), 'gmail_mailbox', 'gmail_watch', '2026-09-28 09:00:00+00');

select private.scheduler_tick('2026-09-28 10:00:00+00') ->> 'rollup_days';
select is((select count(*)::integer from public.jobs where type = 'meeting_prep'
           and idempotency_key = 'meeting_prep:' || (select id from sx where k = 'external') || ':' || extract(epoch from timestamptz '2026-09-28 10:50:00+00')::bigint),
          1, 'R-23: an event with an external attendee 50 minutes out enqueues meeting_prep');
select is((select count(*)::integer from public.jobs where type = 'meeting_prep' and payload ->> 'event_id' = (select id from sx where k = 'internal')::text),
          0, 'an internal-only, non-VIP event is prepared on tap only');
select is((select count(*)::integer from public.jobs where idempotency_key = 'meeting_prep_notify:' || (select id from sx where k = 'lead') || ':'
                                                                         || extract(epoch from timestamptz '2026-09-28 10:30:00+00')::bigint),
          1, 'the prep notification is keyed at start_at − meeting_prep_lead_min (30)');
select is((select count(*)::integer from public.jobs where idempotency_key = 'reminder:' || (select id from public.reminders where idempotency_key = 'rem-1')),
          1, 'a due reminder enqueues its notification job');
select is((select status::text from public.approval_actions where id = (select id from sx where k = 'approval')), 'expired',
          'an expired pending approval is moved to expired');
select is((select count(*)::integer from public.jobs where type = 'integration_purge' and payload ->> 'reason' = 'binding_expired'), 1,
          'an account past pending_binding_until enqueues integration_purge');
select is((select count(*)::integer from public.audit_logs where action = 'support_access.expired'), 1, 'one support_access.expired audit');
select private.scheduler_tick('2026-09-28 10:01:00+00');
select is((select count(*)::integer from public.audit_logs where action = 'support_access.expired'), 1, 'and never a second one');
select is((select count(*)::integer from public.jobs where type = 'watch_renewal'), 1, 'watch renewal keys are unique per hour');
select ok(not (private.scheduler_tick('2026-09-28 10:07:00+00') ? 'rollup_days'), 'no rollup at minute 07');
select is(private.scheduler_tick('2026-09-28 10:15:00+00') ->> 'rollup_days', '2', 'rollups run at minutes 0/15/30/45');

select * from finish();
rollback;
