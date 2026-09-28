-- pgTAP · GAP-4:
-- · migration 20260924003500: PUB-04 referral resolve carries the reward kill switch
--   (`referral.rewards_enabled`, STORE_CHECKLIST 3.1.1) so the web landing never promises the Pro
--   reward while rewards are off; the code keeps resolving, the referrer stays hidden, and the
--   function stays reachable by the service role only;
-- · migration 20260924003510: the `ai_eval` job's results (AI_PIPELINE_PLAN §5.4 "Gate run") —
--   `public.ai_eval_record` validates the report, writes it on the evaluated version, updates
--   `ai_model_config.eval_status` only for the active version, feeds `private.model_eval_passed` and
--   audits; `admin_api.ai_eval_request` (`prompts.write`) queues one coalesced job per version and
--   ISO week and is audited as `prompt.tested`.
begin;
select plan(35);

-- ═══ PUB-04 · rewards flag ══════════════════════════════════════════════════════════════════
select tests.create_user('gap4-owner@referral.test');
create temporary table g4 (code text) on commit drop;
insert into g4 (code) select public.ensure_referral_code(tests.user_id('gap4-owner@referral.test'), '733333U');

select is(public.public_referral_resolve((select code from g4)) ->> 'rewards_enabled', 'true',
          'rewards are reported on by default');
select is((public.public_referral_resolve('2222222') ->> 'rewards_enabled')::boolean, true,
          'the flag is present for an unknown code too (same response shape)');

update public.app_settings set value = 'false' where key = 'referral.rewards_enabled';
select is((public.public_referral_resolve((select code from g4)) ->> 'rewards_enabled')::boolean, false,
          'rewards off is reported to the landing');
select is((public.public_referral_resolve((select code from g4)) ->> 'valid')::boolean, true,
          'the code still resolves while rewards are off');
select is((public.public_referral_resolve((select code from g4)) ->> 'reward_days')::integer, 14,
          'the reward days stay the configured value');
select is((select array_agg(k order by k) from jsonb_object_keys(public.public_referral_resolve((select code from g4))) k),
          array['apply_window_days', 'reward_days', 'rewards_enabled', 'valid'],
          'the response carries no referrer field');

delete from public.app_settings where key = 'referral.rewards_enabled';
select is((public.public_referral_resolve((select code from g4)) ->> 'rewards_enabled')::boolean, true,
          'a missing setting reads as on (the documented default)');

select ok(not has_function_privilege('anon', 'public.public_referral_resolve(text)', 'execute'),
          'anon cannot call the resolve wrapper directly');
select ok(has_function_privilege('service_role', 'public.public_referral_resolve(text)', 'execute'),
          'the public-api service role can');

-- ═══ ai_eval · results and requests ═══════════════════════════════════════════════════════════
select tests.create_admin('ops@eval.test', 'ai_ops');
select tests.create_admin('money@eval.test', 'finance');

create temporary table ev (k text primary key, id uuid, provider text, model text) on commit drop;
grant select on ev to authenticated;
insert into ev (k, id) select 'active', id from public.prompt_versions where prompt_key = 'post_meeting' and status = 'active';
insert into public.prompt_versions (prompt_key, version, status, system_prompt, user_template, output_schema_ref,
                                    schema_hash, model_role)
select 'post_meeting', 2, 'draft', v.system_prompt || ' (taslak)', v.user_template, v.output_schema_ref, v.schema_hash,
       v.model_role
from public.prompt_versions v where v.id = (select id from ev where k = 'active');
insert into ev (k, id) select 'draft', id from public.prompt_versions where prompt_key = 'post_meeting' and version = 2;
insert into ev (k, id, provider, model)
select 'cfg', c.id, c.provider, c.model from public.ai_model_config c
where c.feature = 'post_meeting_parse' and c.profile = 'balanced';

create function pg_temp.report(p_passed boolean, p_model text default null) returns jsonb
  language sql
  as $$
    select jsonb_build_object(
      'mode', 'live', 'suite', 'post_meeting', 'finished_at', '2026-09-28T01:52:00Z',
      'targets', jsonb_build_array(jsonb_build_object(
        'provider', (select provider from ev where k = 'cfg'),
        'model', coalesce(p_model, (select model from ev where k = 'cfg')),
        'passed', p_passed)),
      'results', '[]'::jsonb)
  $$;

select throws_ok($$ select public.ai_eval_record(null, '{post_meeting_parse}', '{"targets": []}', true, 'sha256:x') $$,
                 '22023', 'VALIDATION_FAILED:report', 'a report without targets is refused');
select throws_ok($$ select public.ai_eval_record(null, '{post_meeting_parse}', '{"targets": [{"provider": "anthropic"}]}',
                                                 true, 'sha256:x') $$,
                 '22023', 'VALIDATION_FAILED:report.targets', 'a target needs provider, model and passed');
select throws_ok($$ select public.ai_eval_record(gen_random_uuid(), null, pg_temp.report(true), true, 'sha256:x') $$,
                 'P0002', 'NOT_FOUND', 'an unknown version is refused');
select throws_ok($$ select public.ai_eval_record((select id from ev where k = 'draft'), null, pg_temp.report(true), true, '') $$,
                 '22023', 'VALIDATION_FAILED:dataset_version', 'the dataset version is required');

-- A draft's run gates its activation only; the route keeps the status of the active prompt.
select is(public.ai_eval_record((select id from ev where k = 'draft'), null, pg_temp.report(true), true,
                                'sha256:0123456789abcdef') ->> 'model_rows', '0',
          'recording a draft touches no model-config row');
select is((select row(eval_passed, eval_dataset_version, eval_report ->> 'mode')::text from public.prompt_versions
           where id = (select id from ev where k = 'draft')),
          '(t,sha256:0123456789abcdef,live)', 'the draft carries the report');
select is((select eval_status from public.ai_model_config where id = (select id from ev where k = 'cfg')), 'missing',
          'the route status is unchanged by a draft run');

-- The active version's run sets the status of every row whose primary was evaluated.
select is((public.ai_eval_record((select id from ev where k = 'active'), null, pg_temp.report(false), false,
                                 'sha256:0123456789abcdef') ->> 'model_rows')::integer, 2,
          'both profiles'' rows with that primary are updated');
select is((select eval_status from public.ai_model_config where id = (select id from ev where k = 'cfg')), 'failed',
          'a failed run marks the route failed');
select is((select eval_passed from public.prompt_versions where id = (select id from ev where k = 'active')), false,
          'eval_passed follows the run');
select is(public.ai_eval_record((select id from ev where k = 'active'), null, pg_temp.report(true), true,
                                'sha256:0123456789abcdef') ->> 'passed', 'true', 'a passing run is recorded');
select is((select eval_status from public.ai_model_config where id = (select id from ev where k = 'cfg')), 'passed',
          'a passing run marks the route passed');
select ok(private.model_eval_passed('post_meeting_parse', (select provider from ev where k = 'cfg'),
                                    (select model from ev where k = 'cfg'), '[]'),
          'private.model_eval_passed reads the recorded targets');
select ok(not private.model_eval_passed('post_meeting_parse', (select provider from ev where k = 'cfg'), 'other-model', '[]'),
          'an unevaluated model is not passed');
select is((select count(*)::integer from public.audit_logs where action = 'system.ai_eval.recorded'), 3,
          'every recorded run is audited');
select ok(not has_function_privilege('authenticated', 'public.ai_eval_record(uuid, public.ai_feature[], jsonb, boolean, text)',
                                     'execute'),
          'app users cannot record eval results');

-- The admin request (ADM-09, `prompts.write`).
select tests.authenticate_as(md5('da-test-admin:ops@eval.test')::uuid, 'aal2');
create temporary table rq (k text primary key, out jsonb) on commit drop;
grant all on rq to authenticated;
insert into rq select 'first', admin_api.ai_eval_request('post_meeting', 2, 'Taslak sürümün kapı değerlendirmesi.');
insert into rq select 'second', admin_api.ai_eval_request('post_meeting', 2, 'Aynı hafta ikinci istek.');
select tests.clear_authentication();

select is((select out ->> 'prompt_version_id' from rq where k = 'first'), (select id::text from ev where k = 'draft'),
          'the request names the version');
select is((select out ->> 'job_id' from rq where k = 'second'), (select out ->> 'job_id' from rq where k = 'first'),
          'a queued request per version and week coalesces');
select matches((select idempotency_key from public.jobs where id = (select (out ->> 'job_id')::uuid from rq where k = 'first')),
               '^ai_eval:post_meeting_parse:[0-9]{4}-W[0-9]{2}:v2:pending$', 'the key follows ai_eval:{feature}:{iso_week}');
select is((select payload from public.jobs where id = (select (out ->> 'job_id')::uuid from rq where k = 'first')),
          jsonb_build_object('prompt_key', 'post_meeting', 'prompt_version_id', (select id from ev where k = 'draft'),
                             'trigger', 'admin'),
          'the payload carries ids only');
select is((select count(*)::integer from public.audit_logs where action = 'prompt.tested' and details ->> 'run' = 'eval'
           and target_id = (select id::text from ev where k = 'draft')), 2,
          'each request is audited as prompt.tested (run eval)');

select tests.authenticate_as(md5('da-test-admin:money@eval.test')::uuid, 'aal2');
select throws_ok($$ select admin_api.ai_eval_request('post_meeting', 2, 'Yetkisiz değerlendirme isteği.') $$,
                 '42501', null, 'finance lacks prompts.write');
select tests.clear_authentication();

-- The passing draft can be activated; the archived version can no longer be evaluated.
update public.prompt_versions set status = 'archived', archived_at = now() where id = (select id from ev where k = 'active');
update public.prompt_versions set status = 'active', activated_at = now() where id = (select id from ev where k = 'draft');
select is((select status::text from public.prompt_versions where id = (select id from ev where k = 'draft')), 'active',
          'a recorded passing eval lets the draft become active');
select tests.authenticate_as(md5('da-test-admin:ops@eval.test')::uuid, 'aal2');
select throws_ok($$ select admin_api.ai_eval_request('post_meeting', 1, 'Arşivlenmiş sürüm değerlendirmesi.') $$,
                 '55000', 'STATE_CONFLICT', 'an archived version is not evaluated');
select throws_ok($$ select admin_api.ai_eval_request('post_meeting', 9, 'Olmayan sürüm değerlendirmesi.') $$,
                 'P0002', 'NOT_FOUND', 'an unknown version is not found');
select throws_ok($$ select admin_api.ai_eval_request('capture_vision', 1, 'Özellik eşlemesi olmayan anahtar.') $$,
                 '22023', 'VALIDATION_FAILED:key', 'a prompt key without a route feature is refused');
select tests.clear_authentication();

select * from finish();
rollback;
