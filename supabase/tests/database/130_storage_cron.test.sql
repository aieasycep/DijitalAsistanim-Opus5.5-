-- pgTAP · storage buckets and folder policies (§8), pg_cron schedules and the worker poke (§9)
-- (DATABASE_AND_RLS_PLAN §13.2 130, 140).
begin;
select plan(21);

-- ─── Buckets ─────────────────────────────────────────────────────────────────────────────────
select results_eq(
  $$ select id, public, file_size_limit from storage.buckets where id in ('captures', 'exports', 'briefing-audio') order by id $$,
  $$ values ('briefing-audio', false, 20971520::bigint), ('captures', false, 20971520::bigint), ('exports', false, 536870912::bigint) $$,
  'three private buckets with the §8 size limits'
);
select ok((select allowed_mime_types @> array['image/heic', 'application/pdf', 'audio/mp4', 'application/json'] from storage.buckets where id = 'captures'),
          'captures accepts images, PDFs, transient audio and JSON page text');
select is((select allowed_mime_types from storage.buckets where id = 'exports'), array['application/zip'], 'exports are zip only');
select is((select allowed_mime_types from storage.buckets where id = 'briefing-audio'), array['audio/mpeg', 'audio/mp4', 'audio/aac'],
          'briefing audio MIME list');
select is(private.briefing_audio_paths('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000bb', 3),
          array['00000000-0000-4000-8000-0000000000aa/00000000-0000-4000-8000-0000000000bb/1.mp3',
                '00000000-0000-4000-8000-0000000000aa/00000000-0000-4000-8000-0000000000bb/2.mp3',
                '00000000-0000-4000-8000-0000000000aa/00000000-0000-4000-8000-0000000000bb/3.mp3'],
          'briefing audio paths are {user}/{briefing}/{version}.mp3 for every version');

-- ─── Folder policies ─────────────────────────────────────────────────────────────────────────
select tests.create_user('sel@storage.test');
select tests.create_user('tan@storage.test');
insert into storage.objects (bucket_id, name) values
  ('captures', tests.user_id('sel@storage.test') || '/11111111-1111-4111-8111-111111111111/fis.jpg'),
  ('captures', tests.user_id('sel@storage.test') || '/replies/22222222-2222-4222-8222-222222222222/teklif.pdf'),
  ('captures', tests.user_id('tan@storage.test') || '/33333333-3333-4333-8333-333333333333/fatura.pdf'),
  ('exports', tests.user_id('sel@storage.test') || '/44444444-4444-4444-8444-444444444444.zip'),
  ('briefing-audio', tests.user_id('tan@storage.test') || '/55555555-5555-4555-8555-555555555555/1.mp3');

select tests.authenticate_as(tests.user_id('sel@storage.test'));
select results_eq($$ select count(*)::integer from storage.objects where bucket_id = 'captures' $$, array[2],
                  'the owner sees her own captures (including reply attachments)');
select results_eq($$ select count(*)::integer from storage.objects where bucket_id = 'exports' $$, array[1], 'and her own export');
select results_eq($$ select count(*)::integer from storage.objects where bucket_id = 'briefing-audio' $$, array[0],
                  'but no other user''s briefing audio');
select results_eq($$ select count(*)::integer from storage.objects where name like tests.user_id('tan@storage.test') || '/%' $$, array[0],
                  'another user''s folder is invisible');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('captures', '%s/x/y.jpg') $$, tests.user_id('sel@storage.test')),
                 '42501', null, 'clients cannot insert objects (uploads use signed upload URLs)');
select results_eq($$ with u as (update storage.objects set name = name || '.bak' returning 1) select count(*)::integer from u $$, array[0],
                  'clients cannot update objects');
-- Hosted Supabase also blocks every direct DELETE on storage.objects (storage.protect_delete); either
-- way a client's delete must remove nothing.
select lives_ok($$ do $d$ begin delete from storage.objects; exception when others then null; end $d$ $$,
                'a client delete on storage.objects is blocked or matches no row');
select results_eq($$ select count(*)::integer from storage.objects where bucket_id in ('captures', 'exports') $$, array[3],
                  'clients cannot delete objects');
select tests.clear_authentication();

select tests.as_anon();
select results_eq($$ select count(*)::integer from storage.objects $$, array[0], 'anon sees no object');
select tests.clear_authentication();
select is((select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT'), 0,
          'storage.objects has select policies only');

-- ─── pg_cron schedules and worker poke ───────────────────────────────────────────────────────
select case when to_regclass('cron.job') is null
            then skip('pg_cron is not installed', 3)
            else collect_tap(
              results_eq($$ select jobname::text, schedule::text from cron.job where jobname like 'da\_%' order by jobname $$,
                         $$ values ('da_billing_reconcile', '45 3 * * *'), ('da_cron_housekeeping', '15 3 * * *'),
                                   ('da_health_check', '*/5 * * * *'), ('da_push_receipts', '*/5 * * * *'),
                                   ('da_reconciliation', '7 */6 * * *'), ('da_retention', '30 2 * * *'),
                                   ('da_scheduler_tick', '* * * * *'), ('da_worker_poke', '15 seconds') $$,
                         'exactly the eight da_* jobs with the §9 schedules'),
              ok((select count(*) from cron.job) <= 8, 'no more than eight cron jobs'),
              ok((select bool_and(command not like '%claude-%') from cron.job), 'cron commands carry no model ids'))
       end;

select case when to_regclass('net._shim_requests') is null
            then skip('tier A: the real pg_net is not asserted here', 3)
            else collect_tap(
              is(private.poke_worker('test'), null::bigint, 'no due job → no request'),
              ok((select private.poke_worker('test') from (select public.enqueue_job('health_check', 'poke:test')) as j) is not null,
                 'a due job → one request'),
              results_eq($$ select url, headers ->> 'x-da-reason', headers ->> 'apikey' from net._shim_requests order by id desc limit 1 $$,
                         $$ values ('http://localhost:54321/functions/v1/worker/run', 'test', 'test-secret') $$,
                         'the poke uses the Vault URL and secret'))
       end;

select * from finish();
rollback;
