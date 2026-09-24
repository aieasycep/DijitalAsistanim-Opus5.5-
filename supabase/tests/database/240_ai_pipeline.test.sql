-- pgTAP · AI pipeline part 1 (IMPLEMENTATION_PLAN T-5.06, T-5.08, T-5.16, T-5.17; migrations
-- 20260924002400, 20260924002410): contacts from mail headers and person intelligence owes/owed,
-- evening-ready carry-over, briefing retry, org budget auto-trip, the nightly reconciliation
-- enqueue, the prompt-version seed and the service-role-only wrappers.
begin;
select plan(20);

select tests.create_user('ai1@pipeline.test');
select tests.make_pro(tests.user_id('ai1@pipeline.test'));
select tests.make_account(tests.user_id('ai1@pipeline.test'), 'ai1@pipeline.test');

create temporary table ctx (k text primary key, v jsonb) on commit drop;
insert into ctx values ('people', public.upsert_contacts_from_people(tests.user_id('ai1@pipeline.test'), '[
  {"email": "Mehmet@YilmazEndustri.example", "name": "Mehmet Yılmaz", "organization": "Yilmazendustri", "role": "from"},
  {"email": "ai1@pipeline.test", "name": "Ben", "role": "to"},
  {"email": "noreply@kampanya.example", "name": "Kampanya", "role": "from"},
  {"email": "selin@kayahukuk.example", "role": "cc"}]'::jsonb));

select is((select count(*)::integer from jsonb_object_keys((select v from ctx where k = 'people'))), 2,
          'contacts: own address and no-reply senders are skipped');
select results_eq($$ select display_name, organization from public.contacts
                     where user_id = tests.user_id('ai1@pipeline.test') and primary_email = 'mehmet@yilmazendustri.example' $$,
                  $$ values ('Mehmet Yılmaz'::text, 'Yilmazendustri'::text) $$, 'contacts: normalised address, name and organisation');
select is(public.upsert_contacts_from_people(tests.user_id('ai1@pipeline.test'),
            '[{"email": "mehmet@yilmazendustri.example", "role": "from"}]'::jsonb) ->> 'mehmet@yilmazendustri.example',
          (select v ->> 'mehmet@yilmazendustri.example' from ctx where k = 'people'), 'contacts: upsert is idempotent');

-- Thread participants get contact ids; stats follow the synced rows.
insert into ctx values ('thread', to_jsonb(tests.make_thread(tests.user_id('ai1@pipeline.test'),
  (select id from public.connected_accounts where user_id = tests.user_id('ai1@pipeline.test')), 'Revize teklif')));
update public.email_threads set participants = '[{"email": "mehmet@yilmazendustri.example", "name": "Mehmet Yılmaz"}]'
where id = (select (v #>> '{}')::uuid from ctx where k = 'thread');
select tests.make_message(tests.user_id('ai1@pipeline.test'),
  (select id from public.connected_accounts where user_id = tests.user_id('ai1@pipeline.test')),
  (select (v #>> '{}')::uuid from ctx where k = 'thread'), 'Revize teklif', 'mehmet@yilmazendustri.example');
select is(public.link_contact_refs(tests.user_id('ai1@pipeline.test'),
            array[(select (v #>> '{}')::uuid from ctx where k = 'thread')], '{}'), 1, 'link_contact_refs writes contact ids');
select ok(public.refresh_contact_stats(tests.user_id('ai1@pipeline.test'), null) >= 1, 'refresh_contact_stats runs');
select isnt((select last_inbound_at from public.contacts where primary_email = 'mehmet@yilmazendustri.example'),
            null, 'the sender has a last inbound time');

-- T-5.06 acceptance: the Person payload lists owes and owed items.
insert into public.commitments (user_id, contact_id, direction, text, dedupe_key, origin, source_type, source_id,
                                source_timestamp, confidence, evidence)
select tests.user_id('ai1@pipeline.test'), (select (v ->> 'mehmet@yilmazendustri.example')::uuid from ctx where k = 'people'),
       d, t, 'k:' || d, 'email_analysis', 'user_input', 'src', now(), 0.9, '[{"quote": "Cuma gönderirim", "field": "commitment"}]'
from (values ('user_owes'::public.commitment_direction, 'Teklifi Cuma göndereceğim'),
             ('they_owe'::public.commitment_direction, 'Numuneleri gönderecek')) as x (d, t);
select tests.authenticate_as(tests.user_id('ai1@pipeline.test'));
select results_eq($$ select jsonb_array_length(p -> 'user_owes'), jsonb_array_length(p -> 'they_owe')
                     from (select public.person_intelligence((select id from public.contacts
                                                              where primary_email = 'mehmet@yilmazendustri.example')) as p) as x $$,
                  $$ values (1, 1) $$, 'person_intelligence lists what the user owes and is owed');
select tests.clear_authentication();

-- API-BRF-02: evening-ready carries the chosen rows and replays.
insert into public.briefings (id, user_id, kind, local_date, time_zone, scheduled_for, status, idempotency_key)
values ('00000000-0000-4000-8000-000000002401', tests.user_id('ai1@pipeline.test'), 'evening',
        private.user_local_date(tests.user_id('ai1@pipeline.test'), now()), 'Europe/Istanbul', now(), 'ready', 'ev-1'),
       ('00000000-0000-4000-8000-000000002402', tests.user_id('ai1@pipeline.test'), 'morning',
        private.user_local_date(tests.user_id('ai1@pipeline.test'), now()), 'Europe/Istanbul', now(), 'failed', 'mo-1');
insert into ctx values ('insight', to_jsonb(tests.make_insight(tests.user_id('ai1@pipeline.test'), 'Teklif')));
insert into public.briefing_items (user_id, briefing_id, section, position, insight_id, entity_type, entity_id, title,
                                   source_type, source_id, source_timestamp, confidence)
values (tests.user_id('ai1@pipeline.test'), '00000000-0000-4000-8000-000000002401', 'carry_over', 0,
        (select (v #>> '{}')::uuid from ctx where k = 'insight'), 'email_thread', gen_random_uuid(), 'Teklif',
        'user_input', 'src', now(), 0.9);
select is(public.briefing_evening_ready(tests.user_id('ai1@pipeline.test'), '00000000-0000-4000-8000-000000002401') ->> 'carried',
          '1', 'evening-ready carries the open row');
select is((select status::text from public.insights where id = (select (v #>> '{}')::uuid from ctx where k = 'insight')),
          'snoozed', 'the linked insight snoozes until the next morning');
select is(public.briefing_evening_ready(tests.user_id('ai1@pipeline.test'), '00000000-0000-4000-8000-000000002401') ->> 'replayed',
          'true', 'a second call returns the first result');
select is(public.briefing_evening_ready(tests.user_id('ai1@pipeline.test'), '00000000-0000-4000-8000-000000002402') ->> 'reason',
          'state_conflict', 'a morning briefing is a state conflict');

-- API-BRF-04: a failed briefing of today is re-queued; any other state conflicts.
select is(public.briefing_retry(tests.user_id('ai1@pipeline.test'), '00000000-0000-4000-8000-000000002402') ->> 'status',
          'scheduled', 'retry: failed → scheduled');
select results_eq($$ select version, origin from public.briefings where id = '00000000-0000-4000-8000-000000002402' $$,
                  $$ values (2, 'retry'::text) $$, 'retry updates the row in place');
select is(public.briefing_retry(tests.user_id('ai1@pipeline.test'), '00000000-0000-4000-8000-000000002401') ->> 'reason',
          'state_conflict', 'retry of a ready briefing conflicts');

-- T-5.17: the org ceiling trips the large model; the nightly reconciliation is enqueued once.
update public.feature_flags set enabled = true, payload = '{"usd": 1}' where key = 'ai.budget.org_daily_usd';
update public.feature_flags set enabled = true where key in ('ai.model.large.enabled', 'ai.model.opus_escalation');
insert into public.ai_requests (feature, provider, model, operation, status, latency_ms, cost_usd_micros)
values ('thread_summary', 'anthropic', 'primary-model', 'generate', 'ok', 0, 2000000);
select is(public.ai_org_budget_evaluate(now()) ->> 'tripped', 'true', 'org budget above 100% trips');
select is((select enabled from public.feature_flags where key = 'ai.model.large.enabled'), false,
          'ai.model.large.enabled is switched off');
select lives_ok($$ select private.release_expired_budget_holds(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '3 hours 31 minutes') $$,
                'the hold release runs the AI cost housekeeping');
select ok(exists (select 1 from public.jobs where type = 'reconciliation' and payload ->> 'scope' = 'ai_cost'),
          'a reconciliation {scope: ai_cost} job is queued');

-- T-5.16 seed and wrapper grants.
select ok((select count(*) from public.prompt_versions where status = 'active' and eval_passed
           and prompt_key in ('email_classification', 'thread_summary', 'email_deep_extract', 'commitment', 'life_intel',
                              'briefing_morning', 'briefing_midday', 'briefing_evening', 'weekly_review')) = 9,
          'the nine pipeline prompt keys have an active v1');
select ok(not has_function_privilege('authenticated', 'public.briefing_retry(uuid, uuid, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.briefing_retry(uuid, uuid, timestamptz)', 'execute'),
          'pipeline wrappers are service-role only');

select * from finish();
rollback;
