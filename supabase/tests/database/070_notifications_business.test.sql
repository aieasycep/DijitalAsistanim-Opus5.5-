-- pgTAP · notifications, subscriptions, entitlements (stacking), referrals, plan limits, flags
-- (DATABASE_AND_RLS_PLAN §13.2 070, 080, 100; ADR-11; R-10, R-12, R-22).
begin;
select plan(40);

select tests.create_user('nur@business.test');
select tests.create_user('oya@business.test');
select tests.create_user('pinar@business.test');

-- ─── Notifications ───────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.notify(p_user uuid, p_decision public.notification_decision, p_reason text,
                                          p_data jsonb default '{"type": "deadline", "deeplink": "dijitalasistan://today"}',
                                          p_channel text default 'deadlines') returns uuid
  language sql as $$
    insert into public.notifications (user_id, category, decision, suppression_reason, dedupe_key, detail_mode, data,
                                      android_channel, scheduled_for)
    values (p_user, 'deadline', p_decision, p_reason, 'n:' || gen_random_uuid(), 'title_only', p_data, p_channel, now())
    returning id $$;

select lives_ok($$ select pg_temp.notify(tests.user_id('nur@business.test'), 'suppressed', 'late_delivery') $$,
                'suppression_reason late_delivery is accepted (pushes more than 90 minutes late)');
select lives_ok($$ select pg_temp.notify(tests.user_id('nur@business.test'), 'suppressed', 'quiet_hours') $$,
                'suppression_reason quiet_hours is accepted');
select throws_ok($$ select pg_temp.notify(tests.user_id('nur@business.test'), 'suppressed', null) $$, '23514', null,
                 'suppressed without a reason is rejected');
select throws_ok($$ select pg_temp.notify(tests.user_id('nur@business.test'), 'suppressed', 'too_late') $$, '23514', null,
                 'an unknown suppression reason is rejected');
select throws_ok($$ select pg_temp.notify(tests.user_id('nur@business.test'), 'sent', null,
                                          '{"type": "deadline", "deeplink": "dijitalasistan://today", "body": "secret"}') $$,
                 '23514', null, 'data containing body is rejected');
select throws_ok($$ select pg_temp.notify(tests.user_id('nur@business.test'), 'sent', null,
                                          '{"type": "deadline", "deeplink": "dijitalasistan://today"}', 'brifing') $$,
                 '23514', null, 'android_channel outside the R-12 ids is rejected');
select pg_temp.notify(tests.user_id('oya@business.test'), 'sent', null);

select tests.authenticate_as(tests.user_id('nur@business.test'));
select results_eq($$ select count(*)::integer from public.notifications $$, array[2], 'owner sees her notifications only');
select lives_ok($$ update public.notifications set opened_at = now() $$, 'owner sets opened_at');
select throws_ok($$ update public.notifications set decision = 'sent' $$, '42501', null, 'decision is server-owned');
select throws_ok($$ select count(*) from public.push_tickets $$, '42501', null, 'push_tickets invisible');
select tests.clear_authentication();

-- ─── effective_entitlement matrix (ADR-11) ───────────────────────────────────────────────────
select results_eq($$ select is_active, source from public.effective_entitlement(tests.user_id('nur@business.test')) $$,
                  $$ values (false, 'none') $$, 'no store, no grant → Free');
insert into public.subscriptions (user_id, rc_app_user_id, is_active, status, store, environment, product_id, period_type,
                                  expires_at, will_renew, synced_at)
values (tests.user_id('nur@business.test'), 'rc-nur', true, 'trial', 'app_store', 'production', 'pro_monthly', 'trial',
        now() + interval '5 days', true, now());
select results_eq($$ select is_active, source, is_trial from public.effective_entitlement(tests.user_id('nur@business.test')) $$,
                  $$ values (true, 'store', true) $$, 'active store trial → Pro (store, trial)');
update public.subscriptions set is_active = false, status = 'expired', expires_at = now() - interval '1 day', period_type = 'normal'
where user_id = tests.user_id('nur@business.test');
select private.grant_entitlement(tests.user_id('nur@business.test'), 'admin', 7::smallint, 'goodwill after outage', null, 'g1');
select private.grant_entitlement(tests.user_id('nur@business.test'), 'compensation', 14::smallint, 'billing issue compensation', null, 'g2');
select results_eq($$ select is_active, source from public.effective_entitlement(tests.user_id('nur@business.test')) $$,
                  $$ values (true, 'grant') $$, 'store expired + grant active → Pro (grant)');
select ok((select active_until from public.effective_entitlement(tests.user_id('nur@business.test')))
          between now() + interval '21 days' - interval '1 minute' and now() + interval '21 days' + interval '1 minute',
          'two stacked grants → active_until = now + 7 + 14 days');
select is((private.grant_entitlement(tests.user_id('nur@business.test'), 'admin', 7::smallint, 'goodwill after outage', null, 'g1')).id,
          (select id from public.entitlement_grants where idempotency_key = 'g1'), 'grant_entitlement is idempotent on its key');
update public.entitlement_grants set revoked_at = now() where user_id = tests.user_id('nur@business.test');
select results_eq($$ select is_active from public.effective_entitlement(tests.user_id('nur@business.test')) $$, array[false],
                  'revoked grants are ignored');
select throws_ok($$ select private.grant_entitlement(tests.user_id('nur@business.test'), 'admin', 3::smallint, 'three days test', null, 'g3') $$,
                 '23514', null, 'an admin grant of 3 days is rejected');

select tests.authenticate_as(tests.user_id('nur@business.test'));
select throws_ok($$ select * from public.effective_entitlement(tests.user_id('oya@business.test')) $$, '42501', 'FORBIDDEN',
                 'a user cannot read another user''s entitlement');
select results_eq($$ select count(*)::integer from public.entitlement_grants $$, array[2], 'owner reads her grants');
select throws_ok($$ select rc_app_user_id from public.subscriptions $$, '42501', null, 'rc_app_user_id is hidden');
select results_eq($$ select status::text from public.subscriptions $$, array['expired'], 'owner reads her subscription mirror');
select throws_ok($$ update public.subscriptions set is_active = true $$, '42501', null, 'subscriptions are read-only');
select throws_ok($$ select count(*) from public.referrals $$, '42501', null, 'referrals invisible to users');
select results_eq($$ select count(*)::integer from public.plan_limits $$, array[60], 'plan_limits readable');
select throws_ok($$ update public.plan_limits set value = '5' where plan = 'free' and key = 'vip_max' $$, '42501', null,
                 'plan_limits not writable');
select results_eq($$ select (public.check_plan_limit('vip_max') ->> 'allowed')::boolean $$, array[true], 'check_plan_limit for self');
select throws_ok($$ select public.check_plan_limit('vip_max', 1, tests.user_id('oya@business.test')) $$, '42501', 'FORBIDDEN',
                 'check_plan_limit for another user is forbidden');
select tests.clear_authentication();

select throws_ok($$ update public.plan_limits set value = '-1' where plan = 'free' and key = 'max_mail_accounts' $$, '23514', null,
                 'max_mail_accounts = -1 rejected');
select throws_ok($$ update public.plan_limits set value = '1' where plan = 'free' and key = 'meeting_prep' $$, '23514', null,
                 'meeting_prep = 1 (not boolean) rejected');

-- ─── Referral rewards: idempotent, two credits, two grants; 6 per 365 days ───────────────────
insert into public.referrals (id, referrer_id, referee_id, code, status, qualified_at)
values ('00000000-0000-4000-8000-000000000001', tests.user_id('oya@business.test'), tests.user_id('pinar@business.test'),
        (select code from public.referral_codes where user_id = tests.user_id('oya@business.test')), 'qualified', now());
select is(private.reward_referral('00000000-0000-4000-8000-000000000001') ->> 'status', 'rewarded', 'qualified referral rewarded');
select is(private.reward_referral('00000000-0000-4000-8000-000000000001') ->> 'replayed', 'true', 'second reward replays');
select is((select count(*)::integer from public.referral_credits where referral_id = '00000000-0000-4000-8000-000000000001'), 2,
          'exactly two credits');
select is((select count(*)::integer from public.entitlement_grants where source in ('referral_referrer', 'referral_referee')), 2,
          'exactly two grants');
-- six more qualified referrals for the same referrer: five fill the yearly cap of 6, the sixth is rejected
do $$
declare
  i integer;
  v_referee uuid;
  v_ref uuid;
begin
  for i in 1 .. 6 loop
    v_referee := tests.create_user('referee' || i || '@business.test');
    insert into public.referrals (referrer_id, referee_id, code, status, qualified_at)
    values (tests.user_id('oya@business.test'), v_referee,
            (select code from public.referral_codes where user_id = tests.user_id('oya@business.test')), 'qualified', now())
    returning id into v_ref;
    perform private.reward_referral(v_ref);
  end loop;
end
$$;
select is((select count(*)::integer from public.referral_credits where user_id = tests.user_id('oya@business.test') and side = 'referrer'),
          6, 'the referrer is credited at most 6 times per 365 days');
select is((select reject_reason from public.referrals where referee_id = tests.user_id('referee6@business.test')), 'cap_reached',
          'the 7th referral is rejected with cap_reached');

-- ─── Feature flags (R-10) ────────────────────────────────────────────────────────────────────
update public.feature_flags set is_kill_switch = false, enabled = true, rollout_percentage = 100, platforms = '{android}'
where key = 'feature.new_ai_model';
select is(private.evaluate_flag('feature.new_ai_model', tests.user_id('nur@business.test'), 'ios', '1.0.0') ->> 'matched_rule',
          'platform', 'platform targeting');
update public.feature_flags set platforms = null, min_app_version = '1.2.0' where key = 'feature.new_ai_model';
select is(private.evaluate_flag('feature.new_ai_model', tests.user_id('nur@business.test'), 'ios', '1.1.9') ->> 'matched_rule',
          'version', 'minimum version targeting');
insert into public.feature_flag_overrides (flag_key, user_id, value, reason, created_by_admin_id)
values ('feature.new_ai_model', tests.user_id('nur@business.test'), true, 'QA override for release', tests.create_admin('flags@admin.test', 'super_admin'));
select is(private.evaluate_flag('feature.new_ai_model', tests.user_id('nur@business.test'), 'ios', '1.1.9') ->> 'matched_rule',
          'override', 'a user override wins over targeting');
update public.feature_flags set enabled = false, is_kill_switch = true where key = 'feature.new_ai_model';
select is(private.evaluate_flag('feature.new_ai_model', tests.user_id('nur@business.test'), 'ios', '1.3.0') ->> 'value', 'false',
          'a killed kill switch beats the override');
select is(private.evaluate_flag('ai.global.enabled', tests.user_id('oya@business.test'), 'android', '1.0.0') ->> 'bucket',
          private.evaluate_flag('ai.global.enabled', tests.user_id('oya@business.test'), 'ios', '2.0.0') ->> 'bucket',
          'percentage bucket is stable per (key, user)');

select * from finish();
rollback;
