-- pgTAP · referral codes, apply, evaluation context, decisions and capped rewards (T-7.03;
-- API_CONTRACTS API-BIZ-01/02, JOB-25; TEST_PLAN UT-REF-04/05/08/09, DB-19).
begin;
select plan(38);

select tests.create_user('ref-owner@referral.test');
select tests.create_user('ref-friend@referral.test');
select tests.create_user('ref-other@referral.test');
select tests.create_user('ref-dup@referral.test');

create temporary table rx (k text primary key, id uuid, v text) on commit drop;

-- ─── Codes (API-BIZ-02) ───────────────────────────────────────────────────────────────────────
select is(public.ensure_referral_code(tests.user_id('ref-owner@referral.test'), '2222222'),
          (select code from public.referral_codes where user_id = tests.user_id('ref-owner@referral.test')),
          'an existing code is returned unchanged');
delete from public.referral_codes where user_id = tests.user_id('ref-dup@referral.test');
select is(public.ensure_referral_code(tests.user_id('ref-dup@referral.test'),
                                      (select code from public.referral_codes where user_id = tests.user_id('ref-owner@referral.test'))),
          null::text, 'a candidate colliding with another user''s code returns null (caller retries)');
select is(public.ensure_referral_code(tests.user_id('ref-dup@referral.test'), '3222223'), '3222223',
          'a free candidate becomes the user''s code (lazy creation)');
delete from public.referral_codes where user_id = tests.user_id('ref-other@referral.test');
select throws_ok($$ select public.ensure_referral_code(tests.user_id('ref-other@referral.test'), 'ZZZZZZD') $$,
                 '22023', null, 'a candidate with a wrong check character is rejected');

-- ─── Apply (API-BIZ-01) ───────────────────────────────────────────────────────────────────────
insert into rx (k, v) values ('code', (select code from public.referral_codes where user_id = tests.user_id('ref-owner@referral.test')));
select is(public.referral_apply_context(tests.user_id('ref-friend@referral.test'), (select v from rx where k = 'code'), null)
            ->> 'code_owner', tests.user_id('ref-owner@referral.test')::text, 'the active code resolves to its owner');
select is(public.referral_apply_context(tests.user_id('ref-friend@referral.test'), lower((select v from rx where k = 'code')), null)
            #>> '{referee,email}', 'ref-friend@referral.test', 'the referee identity material is returned for hashing');
insert into rx (k, id)
select 'ref1', (public.apply_referral(tests.user_id('ref-friend@referral.test'), tests.user_id('ref-owner@referral.test'),
                                      (select v from rx where k = 'code'), 'deep_link', '\x01'::bytea, '\x02'::bytea,
                                      '{"network_day_hash": "ab"}', now() + interval '48 hours') ->> 'referral_id')::uuid;
select is((select status::text from public.referrals where id = (select id from rx where k = 'ref1')), 'pending',
          'apply records a pending referral');
select is((select run_after > now() + interval '47 hours' from public.jobs
           where idempotency_key = 'referral_evaluate:' || (select id from rx where k = 'ref1') || ':apply'), true,
          'the first evaluation runs after the 48 h qualification age');
select is((select risk_signals ->> 'source' from public.referrals where id = (select id from rx where k = 'ref1')), 'deep_link',
          'the apply source is kept with the hashed signals');
select is((select count(*)::integer from public.audit_logs where action = 'user.referral.applied'
           and target_id = (select id from rx where k = 'ref1')::text), 1, 'apply is audited');
select throws_ok($$ select public.apply_referral(tests.user_id('ref-friend@referral.test'), tests.user_id('ref-owner@referral.test'),
                                                 (select v from rx where k = 'code'), 'manual', null, null, '{}', now()) $$,
                 '23505', 'REFERRAL_ALREADY_APPLIED', 'a second referral for the same referee is rejected');
select throws_ok($$ select public.apply_referral(tests.user_id('ref-other@referral.test'), tests.user_id('ref-dup@referral.test'),
                                                 (select v from rx where k = 'code'), 'manual', null, null, '{}', now()) $$,
                 'P0002', 'REFERRAL_CODE_INVALID', 'a code that is not the referrer''s is invalid');
update public.referral_codes set disabled_at = now() where user_id = tests.user_id('ref-dup@referral.test');
select is(public.referral_apply_context(tests.user_id('ref-other@referral.test'), '3222223', null) ->> 'code_owner', null::text,
          'a disabled code has no owner');

-- ─── Overview (API-BIZ-02) ────────────────────────────────────────────────────────────────────
update public.profiles set display_name = 'Zeynep' where user_id = tests.user_id('ref-friend@referral.test');
select is(public.referral_overview(tests.user_id('ref-owner@referral.test')) #>> '{referrals,0,initial}', 'Z',
          'a referee is shown only by an initial');
select is((public.referral_overview(tests.user_id('ref-owner@referral.test')) ->> 'cap_per_year')::integer, 6,
          'the yearly cap comes from plan_limits.referral_rewards_per_year');
select is(public.referral_overview(tests.user_id('ref-friend@referral.test')) #>> '{referred_by,status}', 'pending',
          'the referee sees their own referral status');
select ok(position('@' in public.referral_overview(tests.user_id('ref-owner@referral.test'))::text) = 0,
          'the overview never contains an e-mail address');

-- ─── Evaluation context (JOB-25) ──────────────────────────────────────────────────────────────
select tests.make_installation(tests.user_id('ref-friend@referral.test'));
insert into public.app_installations (user_id, installation_id, platform, app_version, build_number, device_hash)
select tests.user_id('ref-other@referral.test'), gen_random_uuid(), 'ios', '1.0.0', '1', i.device_hash
from public.app_installations i where i.user_id = tests.user_id('ref-friend@referral.test');
select is((public.referral_evaluation_context((select id from rx where k = 'ref1')) ->> 'other_accounts_sharing')::integer, 1,
          'another account on the referee''s device is counted (duplicate-account heuristic)');
select is(public.referral_evaluation_context((select id from rx where k = 'ref1')) #>> '{referrer,email}',
          'ref-owner@referral.test', 'the referrer identity material is returned for hashing');
select is((public.referral_evaluation_context((select id from rx where k = 'ref1')) -> 'settings' ->> 'referral.velocity_max_per_hour')::integer,
          3, 'the referral.* settings are part of the context');
select is(jsonb_array_length(public.referral_evaluation_context((select id from rx where k = 'ref1')) -> 'referrer_applied_at'), 1,
          'the referrer''s recent applications feed the velocity check');
-- A loop: the referee referred someone who in turn referred the referrer.
insert into public.referrals (referrer_id, referee_id, code, status)
values (tests.user_id('ref-friend@referral.test'), tests.user_id('ref-other@referral.test'), '4222224', 'pending');
insert into public.referrals (referrer_id, referee_id, code, status)
values (tests.user_id('ref-other@referral.test'), tests.user_id('ref-owner@referral.test'), '5222225', 'pending');
select ok(public.referral_evaluation_context((select id from rx where k = 'ref1')) -> 'edges'
            @> jsonb_build_array(jsonb_build_object('referrer_id', tests.user_id('ref-other@referral.test'),
                                                    'referee_id', tests.user_id('ref-owner@referral.test'))),
          'the referral graph reachable from the referee is returned (loop detection, UT-REF-04)');

insert into public.privacy_tombstones (kind, signal_hash) values ('email', sha256('tombstoned'::bytea));
select ok(public.referral_tombstone_match(jsonb_build_array(jsonb_build_object('kind', 'email',
                                                                                'hash', encode(sha256('tombstoned'::bytea), 'hex')))),
          'a tombstoned signal hash matches (UT-REF-08)');
select ok(not public.referral_tombstone_match(jsonb_build_array(jsonb_build_object('kind', 'installation',
                                                                                    'hash', encode(sha256('tombstoned'::bytea), 'hex')))),
          'the kind must match too');

-- ─── Decisions ────────────────────────────────────────────────────────────────────────────────
select is(public.referral_decide((select id from rx where k = 'ref1'), 'wait', null, 10, '{"signals": []}',
                                 '{"onboarding_completed_at": null}') ->> 'status', 'pending', 'wait keeps the referral pending');
select is((select qualification from public.referrals where id = (select id from rx where k = 'ref1')),
          '{"onboarding_completed_at": null}'::jsonb, 'wait records the qualification progress');
select is(public.referral_decide((select id from rx where k = 'ref1'), 'qualify', null, 10, '{"signals": []}', '{}') ->> 'status',
          'rewarded', 'a clean qualified referral is rewarded in the same transaction');
select is((select count(*)::integer from public.referral_credits where referral_id = (select id from rx where k = 'ref1')), 2,
          'both sides are credited');
select is((select count(*)::integer from public.entitlement_grants
           where idempotency_key in ('referral:' || (select id from rx where k = 'ref1') || ':referrer',
                                     'referral:' || (select id from rx where k = 'ref1') || ':referee')), 2,
          'one grant per side keyed referral:{id}:{side} (UT-REF-09)');
select is(public.referral_decide((select id from rx where k = 'ref1'), 'qualify') ->> 'replayed', 'true',
          'evaluating a rewarded referral again replays');
select is((select count(*)::integer from public.referral_credits where referral_id = (select id from rx where k = 'ref1')), 2,
          'a double evaluation grants nothing more');
select is(public.referral_decide((select id from rx where k = 'ref1'), 'reject', 'loop') ->> 'changed', 'false',
          'a rewarded referral cannot be rejected afterwards');

insert into rx (k, id)
select 'loop', id from public.referrals where referee_id = tests.user_id('ref-owner@referral.test');
select is(public.referral_decide((select id from rx where k = 'loop'), 'reject', 'loop', 100, '{"signals": ["loop"]}') ->> 'status',
          'rejected', 'a loop is rejected');
select is((select reject_reason from public.referrals where id = (select id from rx where k = 'loop')), 'loop', 'with its reason');

insert into rx (k, id)
select 'flag', id from public.referrals where referee_id = tests.user_id('ref-other@referral.test');
select is(public.referral_decide((select id from rx where k = 'flag'), 'flag', null, 60, '{"flag_reasons": ["shared_device"]}')
            ->> 'status', 'flagged', 'a risky referral is flagged for review');
select is((select count(*)::integer from public.audit_logs where action = 'system.referral.flagged'
           and target_id = (select id from rx where k = 'flag')::text), 1, 'flagging is audited');

-- ─── Yearly cap: the referee is still rewarded, the referrer credit is withheld (UT-REF-05) ────
do $$
declare
  i integer;
  v_referee uuid;
  v_ref uuid;
begin
  for i in 1 .. 5 loop
    v_referee := tests.create_user('cap' || i || '@referral.test');
    insert into public.referrals (referrer_id, referee_id, code, status, qualified_at)
    values (tests.user_id('ref-owner@referral.test'), v_referee, '6222226', 'qualified', now())
    returning id into v_ref;
    perform private.reward_referral(v_ref);
  end loop;
end
$$;
select tests.create_user('cap7@referral.test');
insert into rx (k, id)
select 'cap', (public.apply_referral(tests.user_id('cap7@referral.test'), tests.user_id('ref-owner@referral.test'),
                                     (select v from rx where k = 'code'), 'manual', null, null, '{}', now()) ->> 'referral_id')::uuid;
select is(public.referral_decide((select id from rx where k = 'cap'), 'qualify') ->> 'referrer_withheld', 'cap_reached',
          'at the yearly cap the referrer credit is withheld');
select is((select array_agg(side::text) from public.referral_credits where referral_id = (select id from rx where k = 'cap')),
          array['referee'], 'only the referee is credited');

select * from finish();
rollback;
