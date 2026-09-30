-- pgTAP · AI budget reservations (Free "AI analiz limiti 50/gün", soft and hard caps, briefing
-- reserve, idempotent settle, hold release) and AI system tables (DATABASE_AND_RLS_PLAN §6.5, §13.2 061).
begin;
select plan(16);

select tests.create_user('ai@budget.test');
select tests.create_user('caps@budget.test');

create temporary table res (k text primary key, r jsonb) on commit drop;
insert into res values ('fifty', private.ai_budget_reserve(tests.user_id('ai@budget.test'), 'email_triage', 100, 50));
select is((select r ->> 'allow' from res where k = 'fifty'), 'true', 'Free: 50 units in a day are allowed');
select results_eq($$ select private.ai_budget_reserve(tests.user_id('ai@budget.test'), 'email_triage', 1, 1) ->> 'reason' $$,
                  array['units_exhausted'], 'the 51st unit on the same local day is refused');
select is(private.ai_budget_reserve(tests.user_id('ai@budget.test'), 'briefing_morning', 100, 5) ->> 'allow', 'true',
          'briefing features never consume units');
select lives_ok(format($$ select private.ai_budget_settle(%L, null, 150, 50, '{"input": 1000, "output": 100}') $$,
                       (select r ->> 'reservation_id' from res where k = 'fifty')), 'settle the reservation');
select lives_ok(format($$ select private.ai_budget_settle(%L, null, 150, 50, '{"input": 1000, "output": 100}') $$,
                       (select r ->> 'reservation_id' from res where k = 'fifty')), 'settling twice is a no-op');
select results_eq($$ select cost_usd_micros, units_used, reserved_units from public.ai_usage_daily
                     where user_id = tests.user_id('ai@budget.test') and feature = 'email_triage' $$,
                  $$ values (150::bigint, 50, 0) $$, 'actuals recorded once and the hold released');

-- Free caps: soft $0.02, hard $0.03 per day with a 25 % briefing reserve (non-briefing ≤ $0.0225).
select is(private.ai_budget_reserve(tests.user_id('caps@budget.test'), 'thread_summary', 21000) ->> 'level', 'l1',
          'above the soft cap → level l1');
select is(private.ai_budget_reserve(tests.user_id('caps@budget.test'), 'thread_summary', 2000) ->> 'reason', 'hard_cap_day',
          'non-briefing work cannot eat the briefing reserve');
select is(private.ai_budget_reserve(tests.user_id('caps@budget.test'), 'briefing_morning', 8000) ->> 'allow', 'true',
          'briefings may use the reserved share');
select is(private.ai_budget_reserve(tests.user_id('caps@budget.test'), 'briefing_morning', 2000) ->> 'reason', 'hard_cap_day',
          'nothing passes the daily hard cap');
select ok((private.scheduler_tick(now() + interval '20 minutes') ->> 'budget_holds_released')::integer >= 1,
          'scheduler_tick releases expired holds');
select is((select coalesce(sum(reserved_usd_micros), 0)::bigint from public.ai_usage_daily where user_id = tests.user_id('caps@budget.test')),
          0::bigint, 'released holds free the reserved budget');

-- System tables stay invisible; ai_usage_daily is owner-readable.
select tests.authenticate_as(tests.user_id('ai@budget.test'));
select results_eq($$ select count(*)::integer from public.ai_usage_daily $$, array[2], 'owner reads her usage rows');
select throws_ok($$ select count(*) from public.ai_budget_reservations $$, '42501', null, 'reservations invisible');
select throws_ok($$ select count(*) from public.ai_requests $$, '42501', null, 'ai_requests invisible');
select throws_ok($$ select count(*) from public.ai_model_config $$, '42501', null, 'ai_model_config invisible');
select tests.clear_authentication();

select * from finish();
rollback;
