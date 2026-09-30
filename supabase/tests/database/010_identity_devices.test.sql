-- pgTAP · identity, settings and devices: handle_new_user, owner isolation, column privileges,
-- anon denial (DATABASE_AND_RLS_PLAN §13.2 010/011, T-2.22).
begin;
select plan(29);

select tests.create_user('alice@identity.test');
select tests.create_user('bob@identity.test', 'Europe/Berlin');

-- handle_new_user creates profile, preferences, notification preferences and a referral code.
select is((select count(*)::integer from public.profiles where user_id = tests.user_id('alice@identity.test')), 1, 'profile created');
select is((select timezone from public.user_preferences where user_id = tests.user_id('bob@identity.test')), 'Europe/Berlin',
          'timezone taken from the sign-up metadata');
select is((select count(*)::integer from public.notification_preferences where user_id = tests.user_id('alice@identity.test')), 1,
          'notification preferences created');
select ok((select private.referral_code_valid(code) from public.referral_codes where user_id = tests.user_id('alice@identity.test')),
          'referral code created with a valid check character');
select results_eq(
  $$ select detail_level::text, retention_policy::text, morning_time::text
     from public.notification_preferences n join public.user_preferences u using (user_id)
     where user_id = tests.user_id('alice@identity.test') $$,
  $$ values ('title_only', 'd90', '08:00:00') $$,
  'defaults: title_only, d90, 08:00'
);

-- Owner isolation.
select tests.authenticate_as(tests.user_id('alice@identity.test'));
select results_eq($$ select count(*)::integer from public.profiles $$, array[1], 'alice sees exactly one profile');
select results_eq($$ select user_id from public.profiles $$, array[tests.user_id('alice@identity.test')], 'and it is her own');
select results_eq($$ select count(*)::integer from public.user_preferences $$, array[1], 'one preferences row visible');
select lives_ok($$ update public.profiles set display_name = 'Alice' $$, 'owner updates display_name');
select results_eq($$ select display_name from public.profiles $$, array['Alice'], 'display_name updated');
select throws_ok($$ update public.profiles set state = 'disabled' $$, '42501', null, 'state is not client-writable');
select throws_ok($$ update public.profiles set is_internal = true $$, '42501', null, 'is_internal is not client-writable');
select throws_ok($$ select is_demo from public.profiles $$, '42501', null, 'is_demo is not client-readable');
select throws_ok($$ insert into public.profiles (user_id) values (gen_random_uuid()) $$, '42501', null, 'no profile insert');
select throws_ok($$ delete from public.profiles $$, '42501', null, 'no profile delete');
select results_eq(
  $$ with u as (update public.user_preferences set morning_time = '07:30' where user_id = tests.user_id('bob@identity.test')
               returning 1) select count(*)::integer from u $$,
  array[0], 'another user''s preferences cannot be updated (0 rows)'
);
select throws_ok($$ update public.user_preferences set timezone = 'Mars/Olympus' $$, '22023', null, 'unknown time zone rejected');
select throws_ok($$ update public.user_preferences set briefing_weekdays = '{}' $$, '23514', null, 'empty briefing_weekdays rejected');
select throws_ok($$ update public.user_preferences set ai_data_access = ai_data_access || '{"microphone": true}' $$, '23514', null,
                 'ai_data_access with an unknown key rejected');
select throws_ok($$ update public.notification_preferences set daily_cap = 0 $$, '23514', null, 'daily_cap 0 rejected');
select throws_ok($$ update public.notification_preferences set snooze_until = now() $$, '42501', null, 'snooze_until is server-set');
select throws_ok($$ update public.user_preferences set first_analysis_job_id = gen_random_uuid() $$, '42501', null,
                 'first_analysis_job_id is server-set');
select lives_ok($$ update public.user_preferences set analytics_opt_out = true $$, 'analytics opt-out is user-editable');
select tests.clear_authentication();

-- Devices: device hash and push token never reach the client.
select tests.make_installation(tests.user_id('alice@identity.test'));
insert into public.push_tokens (user_id, installation_id, expo_push_token)
select user_id, id, 'ExponentPushToken[abcdefghijklmnopqrstuv]' from public.app_installations where user_id = tests.user_id('alice@identity.test');
select tests.authenticate_as(tests.user_id('alice@identity.test'));
select results_eq($$ select count(*)::integer from public.app_installations $$, array[1], 'owner reads her installation');
select throws_ok($$ select device_hash from public.app_installations $$, '42501', null, 'device_hash is hidden');
select throws_ok($$ select expo_push_token from public.push_tokens $$, '42501', null, 'the push token is hidden');
select throws_ok($$ update public.app_installations set push_enabled = false $$, '42501', null, 'installations are server-written');
select tests.clear_authentication();

select tests.authenticate_as(tests.user_id('bob@identity.test'));
select results_eq($$ select count(*)::integer from public.app_installations $$, array[0], 'another user sees no installation');
select tests.clear_authentication();

select tests.as_anon();
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'anon cannot read profiles');
select tests.clear_authentication();

select * from finish();
rollback;
