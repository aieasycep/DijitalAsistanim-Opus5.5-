-- pgTAP · GAP-1 closure (migration 20260924003300): the referral reward kill switch
-- (`referral.rewards_enabled`, STORE_CHECKLIST 3.1.1), the Google OAuth verification setting
-- (`google.oauth_verified`, KPL-32) and the disaster-recovery embeddings (`ai.embedding_dr`,
-- AI_PIPELINE_PLAN §10.8): seeds, validation, rewards withheld without breaking application or
-- history, the audited backoffice toggle, the DR re-embed trigger and the DR search switch; the
-- per-user feature usage counts the app's analytics rows, not the server copies (§17.1).
begin;
select plan(32);

-- ─── Seeds and validation ────────────────────────────────────────────────────────────────────
select is((select value from public.app_settings where key = 'referral.rewards_enabled'), 'true'::jsonb,
          'referral rewards are on by default');
select is((select value from public.app_settings where key = 'google.oauth_verified'), 'false'::jsonb,
          'the Google OAuth app starts unverified');
select is((select value ->> 'reembed' from public.app_settings where key = 'ai.embedding_dr'), 'false',
          'the DR re-embed is off by default');
select is((select value ->> 'dimensions' from public.app_settings where key = 'ai.embedding_dr'), '1024',
          'the DR target is 1024-d (R-01)');
select ok(private.valid_app_setting('referral.rewards_enabled', 'false'), 'a boolean kill switch is valid');
select ok(not private.valid_app_setting('google.oauth_verified', '"yes"'), 'a non-boolean verification status is refused');
select ok(not private.valid_app_setting('ai.embedding_dr',
            '{"reembed": true, "search": false, "provider": "openai", "model": "text-embedding-3-small", "dimensions": 1536}'),
          'a DR target other than 1024-d is refused');
select ok(not private.valid_app_setting('ai.embedding_dr',
            '{"reembed": true, "search": false, "provider": "voyage", "model": "x", "dimensions": 1024}'),
          'the DR provider is OpenAI only');
select ok(private.valid_app_setting('session.idle_minutes', '20'), 'earlier keys keep validating');
select is((select count(*)::integer from public.ai_model_prices where provider = 'openai' and model = 'text-embedding-3-small'),
          1, 'the DR embedding model has a price row');

-- ─── Referral rewards: the kill switch ───────────────────────────────────────────────────────
select tests.create_user('ks-owner@referral.test');
select tests.create_user('ks-friend@referral.test');
select tests.create_user('ks-late@referral.test');
create temporary table ks (k text primary key, id uuid) on commit drop;
grant select on ks to authenticated;
insert into ks (k, id)
select 'r1', (public.apply_referral(tests.user_id('ks-friend@referral.test'), tests.user_id('ks-owner@referral.test'),
                                    public.ensure_referral_code(tests.user_id('ks-owner@referral.test'), '7222227'),
                                    'manual', null, null, '{}', now()) ->> 'referral_id')::uuid;
select ok((select id from ks where k = 'r1') is not null, 'a code still applies while rewards are off (switched below)');

update public.app_settings set value = 'false' where key = 'referral.rewards_enabled';
select is(private.referral_rewards_enabled(), false, 'the switch reads off');
select is(public.referral_decide((select id from ks where k = 'r1'), 'qualify', null, 5, '{"signals": []}', '{}') ->> 'status',
          'qualified', 'a qualifying referral stays qualified while rewards are off');
select is((select count(*)::integer from public.referral_credits where referral_id = (select id from ks where k = 'r1')), 0,
          'no credit is written for either side');
select is((select count(*)::integer from public.entitlement_grants
           where idempotency_key like 'referral:' || (select id from ks where k = 'r1') || ':%'), 0,
          'no Pro grant is written for either side');
select is((select risk_signals ->> 'reward_withheld' from public.referrals where id = (select id from ks where k = 'r1')),
          'rewards_disabled', 'the withheld reason is kept with the referral');
select is(public.referral_decide((select id from ks where k = 'r1'), 'qualify') ->> 'rewards_disabled', 'true',
          'a second evaluation withholds again');
select is((select count(*)::integer from public.audit_logs where action = 'system.referral.reward_withheld'
           and target_id = (select id from ks where k = 'r1')::text), 1, 'the withholding is audited once');
select is(public.referral_overview(tests.user_id('ks-owner@referral.test')) #>> '{referrals,0,status}', 'qualified',
          'history stays visible to the referrer');
insert into ks (k, id)
select 'late', (public.apply_referral(tests.user_id('ks-late@referral.test'), tests.user_id('ks-owner@referral.test'),
                                      public.ensure_referral_code(tests.user_id('ks-owner@referral.test'), '7222227'),
                                      'manual', null, null, '{}', now()) ->> 'referral_id')::uuid;
select is((select status::text from public.referrals where id = (select id from ks where k = 'late')), 'pending',
          'codes keep applying while rewards are off');
select is(private.reward_referral((select id from ks where k = 'r1')) ->> 'status', 'qualified',
          'the admin approval path (reward_referral) also withholds');

update public.app_settings set value = 'true' where key = 'referral.rewards_enabled';
select is(public.referral_decide((select id from ks where k = 'r1'), 'qualify') ->> 'status', 'rewarded',
          'with rewards back on the qualified referral is rewarded');
select is((select count(*)::integer from public.referral_credits where referral_id = (select id from ks where k = 'r1')), 2,
          'both sides are credited once rewards are on');

-- The backoffice toggle goes through the audited settings module (ADM-20).
select tests.create_admin('ks-root@gap.test', 'super_admin');
select tests.authenticate_as(md5('da-test-admin:ks-root@gap.test')::uuid, 'aal2');
select is(admin_api.settings_update('referral.rewards_enabled', 'false', 'App Review objected to the reward') ->> 'value',
          'false', 'the kill switch is editable in Settings');
select throws_ok($$ select admin_api.settings_update('referral.rewards_enabled', '"off"', 'wrong type for the switch') $$,
                 '22023', 'VALIDATION_FAILED:value', 'the switch only takes a boolean');
select tests.clear_authentication();
select is((select count(*)::integer from public.audit_logs where action = 'settings.system_updated'
           and target_id = 'referral.rewards_enabled'), 1, 'turning rewards off is audited');

-- ─── Server analytics rows (API_CONTRACTS §17.1) ─────────────────────────────────────────────
-- The app and API-SRCH-01 both write `search_performed`; the usage panel counts the app's rows.
insert into public.analytics_events (user_id, session_id, event_name, props, platform, occurred_at) values
  (tests.user_id('ks-friend@referral.test'), gen_random_uuid(), 'search_performed', '{"mode": "hybrid"}', 'ios', now()),
  (tests.user_id('ks-friend@referral.test'), null, 'search_performed', '{"mode": "hybrid", "result_count": 3}', 'ios', now()),
  (tests.user_id('ks-friend@referral.test'), null, 'reply_draft_generated', '{"tone": "short"}', null, now());
select tests.authenticate_as(md5('da-test-admin:ks-root@gap.test')::uuid, 'aal2');
select is((admin_api.user_usage(tests.user_id('ks-friend@referral.test'), '7d') -> 'feature_usage' ->> 'search_performed')::integer,
          1, 'a search counts once in the usage panel although the server also recorded it');
select ok(not (admin_api.user_usage(tests.user_id('ks-friend@referral.test'), '7d') -> 'feature_usage') ? 'reply_draft_generated',
          'server-only events stay out of the app feature usage');
select tests.clear_authentication();

-- ─── Disaster-recovery embeddings ────────────────────────────────────────────────────────────
delete from public.jobs where type = 'embedding';
update public.app_settings set value = jsonb_set(value, '{reembed}', 'true') where key = 'ai.embedding_dr';
select is((select count(*)::integer from public.jobs where type = 'embedding' and payload ->> 'mode' = 'reembed'), 1,
          'turning the DR re-embed on queues the first batch');
update public.app_settings set value = jsonb_set(value, '{search}', 'false') where key = 'ai.embedding_dr';
select is((select count(*)::integer from public.jobs where type = 'embedding' and payload ->> 'mode' = 'reembed'), 1,
          'an update that leaves reembed on queues nothing more');

select tests.create_user('dr@gap.test');
select tests.make_pro(tests.user_id('dr@gap.test'));
insert into ks (k, id) values
  ('dr_both', tests.make_memory(tests.user_id('dr@gap.test'), 'DR iki vektörlü parça', tests.axis_vector(1))),
  ('dr_primary_only', tests.make_memory(tests.user_id('dr@gap.test'), 'DR yalnız birincil vektör', tests.axis_vector(1, 0.01)));
update public.memory_chunks set embedding_dr = tests.axis_vector(2) where id = (select id from ks where k = 'dr_both');

select tests.authenticate_as(tests.user_id('dr@gap.test'));
select is(cardinality(public.memory_vector_candidates(tests.axis_vector(1))), 2,
          'with DR search off the vector leg ranks the primary embeddings');
select tests.clear_authentication();
update public.app_settings set value = jsonb_set(value, '{search}', 'true') where key = 'ai.embedding_dr';
select tests.authenticate_as(tests.user_id('dr@gap.test'));
select is(public.memory_vector_candidates(tests.axis_vector(2)), array[(select id from ks where k = 'dr_both')],
          'with DR search on only chunks with a DR vector are ranked, by the DR column');
select tests.clear_authentication();

select * from finish();
rollback;
