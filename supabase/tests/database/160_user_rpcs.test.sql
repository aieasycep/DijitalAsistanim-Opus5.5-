-- pgTAP · user-facing RPCs (API_CONTRACTS §15, DATABASE_AND_RLS_PLAN §6.9, §13.2 160): owner
-- success, another user's ids → NOT_FOUND / nothing, anon denied, Pro gates.
begin;
select plan(45);

select tests.create_user('umut@rpc.test');
select tests.create_user('vildan@rpc.test');
select tests.create_user('zeynep@rpc.test');
select tests.make_pro(tests.user_id('zeynep@rpc.test'));

create temporary table rx (k text primary key, id uuid) on commit drop;
grant select, insert on rx to authenticated;
insert into rx values
  ('acct', tests.make_account(tests.user_id('umut@rpc.test'), 'umut@gmail.com')),
  ('insight', tests.make_insight(tests.user_id('umut@rpc.test'), 'Ahmet''e teklif dönüşü yap', 'reply_needed', 'open', now() + interval '3 hours')),
  ('insight2', tests.make_insight(tests.user_id('umut@rpc.test'), 'Fatura son ödeme', 'deadline')),
  ('v_insight', tests.make_insight(tests.user_id('vildan@rpc.test'))),
  ('commit', tests.make_commitment(tests.user_id('umut@rpc.test'))),
  ('z_commit', tests.make_commitment(tests.user_id('zeynep@rpc.test'))),
  ('briefing', tests.make_briefing(tests.user_id('umut@rpc.test'))),
  ('v_briefing', tests.make_briefing(tests.user_id('vildan@rpc.test'))),
  ('approval', tests.make_approval(tests.user_id('umut@rpc.test'))),
  ('life', tests.make_life_event(tests.user_id('umut@rpc.test'), 'Elektrik faturası', 'payment')),
  ('z_contact', tests.make_contact(tests.user_id('zeynep@rpc.test'), 'Mehmet Yılmaz', 'mehmet@yilmazendustri.com'));
insert into rx values
  ('cal', tests.make_calendar(tests.user_id('umut@rpc.test'), (select id from rx where k = 'acct'))),
  ('thread', tests.make_thread(tests.user_id('umut@rpc.test'), (select id from rx where k = 'acct'), 'Revize teklif', now() - interval '1 hour'));
insert into rx values
  ('msg', tests.make_message(tests.user_id('umut@rpc.test'), (select id from rx where k = 'acct'), (select id from rx where k = 'thread'),
                             'Revize teklif', 'ahmet@kuzeylojistik.com', now() - interval '1 hour')),
  ('event', tests.make_event(tests.user_id('umut@rpc.test'), (select id from rx where k = 'acct'), (select id from rx where k = 'cal'),
                             'Müşteri toplantısı', date_trunc('day', now()) + interval '1 day 11 hours',
                             date_trunc('day', now()) + interval '1 day 12 hours', '[{"email": "mehmet@yilmazendustri.com"}]')),
  ('z_insight', (select tests.make_insight(tests.user_id('zeynep@rpc.test'), 'Mehmet ile görüş')));
update public.insights set entity_type = 'contact', entity_id = (select id from rx where k = 'z_contact') where id = (select id from rx where k = 'z_insight');
with a as (insert into public.announcements (title_tr, title_en, body_tr, body_en, starts_at, ends_at, published_at)
           values ('Duyuru', 'Notice', 'Metin', 'Text', now() - interval '1 hour', now() + interval '1 day', now()) returning id)
insert into rx select 'announcement', id from a;

-- ─── RPC-01 set_insight_status ───────────────────────────────────────────────────────────────
select tests.authenticate_as(tests.user_id('umut@rpc.test'));
select is((public.set_insight_status((select id from rx where k = 'insight'), 'done')).status::text, 'done', 'open → done');
select throws_ok(format($$ select public.set_insight_status(%L, 'snoozed', now() + interval '1 hour') $$, (select id from rx where k = 'insight')),
                 '55000', null, 'done → snoozed is not a legal edge');
select throws_ok(format($$ select public.set_insight_status(%L, 'snoozed') $$, (select id from rx where k = 'insight2')),
                 '22023', 'VALIDATION_FAILED:snoozed_until', 'snooze needs a future time');
select is((public.set_insight_status((select id from rx where k = 'insight2'), 'dismissed', null, 'not_important')).status::text,
          'dismissed', 'dismiss with "Önemli değil"');
select results_eq($$ select rating::integer, reason_code from public.ai_feedback where target_id = (select id from rx where k = 'insight2') $$,
                  $$ values (-1, 'not_important') $$, 'not_important writes ai_feedback');
select throws_ok(format($$ select public.set_insight_status(%L, 'done') $$, (select id from rx where k = 'v_insight')),
                 'P0002', 'NOT_FOUND', 'another user''s insight → NOT_FOUND');

-- ─── RPC-04/05/20 Today and Flow ─────────────────────────────────────────────────────────────
select ok(public.today_overview() ? 'hero_count' or public.today_overview() ? 'hero', 'today_overview answers for the caller');
select lives_ok($$ select public.flow_feed('all') $$, 'flow_feed all');
select lives_ok($$ select public.flow_feed('important', null, 5) $$, 'flow_feed important');
select throws_ok($$ select public.flow_feed('everything') $$, '22023', 'VALIDATION_FAILED:filter', 'unknown flow filter rejected');
select ok(public.flow_meta() ? 'accounts', 'flow_meta lists the accounts');

-- ─── RPC-06 set_commitment_status (Pro) ──────────────────────────────────────────────────────
select throws_ok(format($$ select public.set_commitment_status(%L, 'done') $$, (select id from rx where k = 'commit')),
                 'P0001', 'ENTITLEMENT_REQUIRED:commitments', 'Free: commitments need Pro');

-- ─── RPC-07 mark_briefing_opened ─────────────────────────────────────────────────────────────
select lives_ok(format($$ select public.mark_briefing_opened(%L) $$, (select id from rx where k = 'briefing')), 'briefing opened');
select results_eq($$ select status::text, opened_at is not null from public.briefings $$, $$ values ('delivered', true) $$,
                  'ready → delivered with opened_at');
select lives_ok(format($$ select public.mark_briefing_opened(%L) $$, (select id from rx where k = 'briefing')), 'idempotent');
select throws_ok(format($$ select public.mark_briefing_opened(%L) $$, (select id from rx where k = 'v_briefing')),
                 'P0002', 'NOT_FOUND', 'another user''s briefing → NOT_FOUND');

-- ─── RPC-08/09/18/10 Mail, Plan, Approvals ───────────────────────────────────────────────────
select is((public.mail_intelligence() ->> 'total')::integer, 1, 'mail_intelligence counts today''s mail');
select throws_ok($$ select public.plan_range(now(), now() + interval '40 days') $$, '22023', 'VALIDATION_FAILED:range',
                 'plan_range over 35 days rejected');
select is((select count(*)::integer from jsonb_array_elements(public.plan_range(now(), now() + interval '7 days') -> 'items') as i
           where i ->> 'item_type' = 'event'), 1, 'plan_range returns the event');
select is(jsonb_array_length(public.plan_week_density(date_trunc('week', now())::date)), 7, 'plan_week_density returns 7 days');
select is((select count(*)::integer from jsonb_array_elements(public.plan_week_density(date_trunc('week', now())::date)) as d
           where (d ->> 'is_today')::boolean), 1, 'exactly one of them is today');
select is(jsonb_array_length(public.list_approvals() -> 'items'), 1, 'list_approvals returns the pending approval');

-- ─── RPC-11/12/14/16/17/19 and contacts ──────────────────────────────────────────────────────
select is((public.preview_priority_rule('domain', '{"domain": "kuzeylojistik.com"}', 'always_important') ->> 'match_count')::integer, 1,
          'preview_priority_rule counts own mail');
select ok(jsonb_typeof(public.get_usage_summary()) = 'object', 'get_usage_summary answers');
select throws_ok($$ select public.vip_suggestions() $$, 'P0001', 'ENTITLEMENT_REQUIRED:vip', 'Free: VIP suggestions need Pro');
select lives_ok(format($$ select public.dismiss_announcement(%L); select public.dismiss_announcement(%L) $$,
                       (select id from rx where k = 'announcement'), (select id from rx where k = 'announcement')),
                'dismiss_announcement is idempotent');
select results_eq($$ select count(*)::integer from public.announcement_dismissals $$, array[1], 'one dismissal row');
select ok(public.get_explanation('insight', (select id from rx where k = 'insight')) ? 'decision_tier', '"Bu nereden çıktı?" for an own insight');
select is(public.get_explanation('insight', (select id from rx where k = 'v_insight')), null::jsonb,
          'no explanation for another user''s insight (RLS hides it; the API maps null to 404)');
select throws_ok(format($$ select public.submit_ai_correction('life_event', %L, 'wrong_amount', 'provider', '"x"') $$, (select id from rx where k = 'life')),
                 '22023', 'VALIDATION_FAILED:field', 'a correction outside the field allowlist is rejected');
select lives_ok(format($$ select public.submit_ai_correction('life_event', %L, 'wrong_amount', 'amount', '{"value": 1842, "currency": "TRY"}') $$,
                       (select id from rx where k = 'life')), 'an allowed correction is accepted');
select results_eq($$ select user_overrides ? 'amount' from public.life_events where id = (select id from rx where k = 'life') $$, array[true],
                  'it is stored in user_overrides');
select ok(public.history_deletion_preview() ? 'summaries', 'history_deletion_preview returns the counts');
select is(public.upsert_manual_contact('selin@example.com', 'Selin Kaya'), public.upsert_manual_contact('selin@example.com'),
          'upsert_manual_contact returns the same contact for the same email');
select tests.clear_authentication();

-- ─── Pro: commitments, VIP via feedback, undo, learning switch ───────────────────────────────
select tests.authenticate_as(tests.user_id('zeynep@rpc.test'));
select is((public.set_commitment_status((select id from rx where k = 'z_commit'), 'done')).status::text, 'done', 'Pro: commitment completed');
select lives_ok($$ select public.vip_suggestions() $$, 'Pro: VIP suggestions');
insert into rx select 'feedback', (public.apply_insight_feedback((select id from rx where k = 'z_insight'), 'make_vip') ->> 'feedback_id')::uuid;
select results_eq($$ select count(*)::integer from public.vip_people where contact_id = (select id from rx where k = 'z_contact') $$, array[1],
                  'make_vip stores the VIP row');
select lives_ok(format($$ select public.revert_insight_feedback(%L) $$, (select id from rx where k = 'feedback')), 'undo from the toast');
select results_eq($$ select count(*)::integer from public.vip_people where contact_id = (select id from rx where k = 'z_contact') $$, array[0],
                  'revert removes the VIP it created');
update public.user_preferences set learn_from_interactions = false;
select lives_ok(format($$ select public.apply_insight_feedback(%L, 'not_important') $$, (select id from rx where k = 'z_insight')),
                'feedback with learning switched off');
select results_eq($$ select count(*)::integer from public.learned_preferences $$, array[0],
                  'learn_from_interactions = false writes no learned preference');
select tests.clear_authentication();

-- ─── Anon ────────────────────────────────────────────────────────────────────────────────────
select tests.as_anon();
select throws_ok($$ select public.today_overview() $$, '42501', null, 'anon cannot call today_overview');
select throws_ok($$ select public.flow_feed() $$, '42501', null, 'anon cannot call flow_feed');
select throws_ok($$ select * from public.effective_entitlement() $$, '42501', null, 'anon cannot call effective_entitlement');
select throws_ok($$ select public.list_approvals() $$, '42501', null, 'anon cannot call list_approvals');
select tests.clear_authentication();

select * from finish();
rollback;
