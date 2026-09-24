-- pgTAP · THR-13 replayed writes, THR-05 webhook replay and THR-15 referral loops in SQL
-- (SECURITY_AND_PRIVACY_PLAN §2, CTL-3.7, CTL-3.16; IMPLEMENTATION_PLAN T-11.05; migration
-- 20260924002700). A replayed approve never creates a second execution, an executed approval never
-- runs again, a webhook delivery is stored once, and both legs of an A↔B referral loop are caught
-- whichever is evaluated first.
begin;
select plan(10);

select tests.create_user('writer@threats-w.test');
select tests.create_user('loop.a@threats-w.test');
select tests.create_user('loop.b@threats-w.test');
create temporary table wx (k text primary key, id uuid) on commit drop;
grant select on wx to service_role;
insert into wx values ('approval', tests.make_approval(tests.user_id('writer@threats-w.test')));
create or replace function pg_temp.key_of(p_id uuid) returns text language sql as $$
  select idempotency_key from public.approval_actions where id = p_id $$;

-- ─── THR-13: approve replays ──────────────────────────────────────────────────────────────────
select tests.as_service_role();
select is((public.transition_approval((select id from wx where k = 'approval'), 'approved', 'user',
                                      tests.user_id('writer@threats-w.test'), pg_temp.key_of((select id from wx where k = 'approval')),
                                      null, null, null, null, 'approval_center')).status::text,
          'approved', 'the first approve moves pending → approved');
select lives_ok(format($$ select public.transition_approval(%L, 'approved', 'user', %L, %L, null, null, null, null, 'approval_center') $$,
                       (select id from wx where k = 'approval'), tests.user_id('writer@threats-w.test'),
                       pg_temp.key_of((select id from wx where k = 'approval'))),
                'a double tap with the same key is absorbed');
select throws_ok(format($$ select public.transition_approval(%L, 'approved', 'user', %L, 'replayed-other-key', null, null, null, null,
                                                             'approval_center') $$,
                        (select id from wx where k = 'approval'), tests.user_id('writer@threats-w.test')),
                 '55000', null, 'a captured approve with another key is refused');
select tests.clear_authentication();
select is((select count(*)::integer from public.jobs
           where idempotency_key = 'approval_execute:' || (select id from wx where k = 'approval') || ':v1'), 1,
          'exactly one execution job exists');
select tests.as_service_role();
select lives_ok(format($$ select public.transition_approval(%L, 'executing', 'worker', null, null) $$, (select id from wx where k = 'approval')),
                'the worker starts the execution');
select lives_ok(format($$ select public.transition_approval(%L, 'executed', 'worker', null, null, null, '{"provider_id": "m-1"}') $$,
                       (select id from wx where k = 'approval')),
                'and records its result');
select throws_ok(format($$ select public.transition_approval(%L, 'executing', 'worker', null, null) $$, (select id from wx where k = 'approval')),
                 '55000', null, 'an executed approval never runs again');
select tests.clear_authentication();

-- ─── THR-05: a webhook delivery is stored once ────────────────────────────────────────────────
insert into public.webhook_events (source, external_id, signature_valid, payload_digest)
values ('revenuecat', 'evt-replayed-1', true, sha256('a'::bytea));
select throws_ok($$ insert into public.webhook_events (source, external_id, signature_valid, payload_digest)
                   values ('revenuecat', 'evt-replayed-1', true, sha256('b'::bytea)) $$,
                 '23505', null, 'a replayed delivery violates the (source, external_id) dedupe key');

-- ─── THR-15: an A↔B referral loop is caught on both legs ──────────────────────────────────────
insert into wx select 'a_to_b', (public.apply_referral(
  tests.user_id('loop.b@threats-w.test'), tests.user_id('loop.a@threats-w.test'),
  (select code from public.referral_codes where user_id = tests.user_id('loop.a@threats-w.test')),
  'deep_link', null, null, '{}', now() + interval '48 hours') ->> 'referral_id')::uuid;
insert into wx select 'b_to_a', (public.apply_referral(
  tests.user_id('loop.a@threats-w.test'), tests.user_id('loop.b@threats-w.test'),
  (select code from public.referral_codes where user_id = tests.user_id('loop.b@threats-w.test')),
  'deep_link', null, null, '{}', now() + interval '48 hours') ->> 'referral_id')::uuid;
select is(public.referral_decide((select id from wx where k = 'a_to_b'), 'reject', 'loop', 100, '{"signals": ["loop"]}') ->> 'status',
          'rejected', 'the first evaluated leg is rejected as a loop');
select ok(public.referral_evaluation_context((select id from wx where k = 'b_to_a')) -> 'edges'
            @> jsonb_build_array(jsonb_build_object('referrer_id', tests.user_id('loop.a@threats-w.test'),
                                                    'referee_id', tests.user_id('loop.b@threats-w.test'))),
          'the mirror leg still sees the loop edge, so it cannot be rewarded');

select * from finish();
rollback;
