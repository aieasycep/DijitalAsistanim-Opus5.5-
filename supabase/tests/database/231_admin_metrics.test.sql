-- pgTAP · dashboard metrics against their definitions (IMPLEMENTATION_PLAN T-10.05 acceptance,
-- BACKOFFICE_PLAN §7, §13.3 Metrics): every KPI of private.dashboard_kpis on a hand-built fixture
-- with the expected value computed by hand; demo and internal users are excluded; the ADM-01
-- surface (dashboard_metrics, metrics_product) carries the contract keys; rollup_metrics_daily is
-- idempotent and equals the raw rows for a complete day.
begin;
select plan(29);

-- The window every KPI below is computed over (now() is fixed inside the transaction).
create temporary table win on commit drop as select now() - interval '1 hour' as s, now() + interval '1 hour' as e;
create temporary table k0 on commit drop as select private.dashboard_kpis((select s from win), (select e from win)) as v;

-- ─── Fixture: three real users, one internal, one demo ───────────────────────────────────────
select tests.create_user('ada@kpi.test'), tests.create_user('bora@kpi.test'), tests.create_user('cem@kpi.test'),
       tests.create_user('staff@kpi.test'), tests.create_user('demo@kpi.test');
update public.profiles set is_internal = true where user_id = tests.user_id('staff@kpi.test');
update public.profiles set is_demo = true where user_id = tests.user_id('demo@kpi.test');

-- Active: ada (twice) and bora open the app; staff and demo do too but are excluded.
insert into public.analytics_events (user_id, event_name, occurred_at)
select tests.user_id(e), 'app_opened', now() - interval '10 minutes'
from unnest(array['ada@kpi.test', 'ada@kpi.test', 'bora@kpi.test', 'staff@kpi.test', 'demo@kpi.test']) as e;

-- Pro: bora through a grant, cem through a store trial; staff's store subscription is excluded.
select tests.make_pro(tests.user_id('bora@kpi.test'));
insert into public.subscriptions (user_id, rc_app_user_id, is_active, status, store, environment, product_id, period_type,
                                  expires_at, will_renew, synced_at)
values (tests.user_id('cem@kpi.test'), 'rc-cem', true, 'trial', 'app_store', 'production', 'pro_monthly', 'trial',
        now() + interval '5 days', true, now()),
       (tests.user_id('staff@kpi.test'), 'rc-staff', true, 'active', 'app_store', 'production', 'pro_monthly', 'normal',
        now() + interval '5 days', true, now());

-- Connections: ada mail+calendar, bora mail; cem's disconnected account and staff's are excluded.
create temporary table acct on commit drop as
select tests.make_account(tests.user_id('ada@kpi.test'), 'ada@gmail.com') as ada,
       tests.make_account(tests.user_id('bora@kpi.test'), 'bora@gmail.com', '{mail_read}') as bora,
       tests.make_account(tests.user_id('cem@kpi.test'), 'cem@gmail.com', '{mail_read}', 'google', 'disconnected') as cem,
       tests.make_account(tests.user_id('staff@kpi.test'), 'staff@gmail.com') as staff;
-- Reconnects in the window: bora's account is healthy again, cem's work account still needs one.
update public.connected_accounts set reauth_required_at = now() - interval '20 minutes' where id = (select bora from acct);
select tests.make_account(tests.user_id('cem@kpi.test'), 'cem.work@outlook.com', '{mail_read}', 'microsoft', 'needs_reauth');
update public.connected_accounts set reauth_required_at = now() - interval '5 minutes'
 where account_email = 'cem.work@outlook.com';

-- AI: three ok calls and a budget-blocked one for ada, one system call, one excluded staff call.
insert into public.ai_requests (user_id, plan, profile, feature, tier, provider, model, operation, status, latency_ms,
                                input_tokens, output_tokens, cost_usd_micros, created_at)
select u, 'free', 'lean', 'email_triage', 't1', 'anthropic', 'model-a', 'generate', st, 300, 1000, 100, c, now() - interval '5 minutes'
from (values (tests.user_id('ada@kpi.test'), 'ok', 1500), (tests.user_id('ada@kpi.test'), 'ok', 1500),
             (tests.user_id('ada@kpi.test'), 'ok', 1500), (tests.user_id('ada@kpi.test'), 'budget_blocked', 0),
             (null::uuid, 'ok', 500), (tests.user_id('staff@kpi.test'), 'ok', 9999)) as x (u, st, c);

-- Briefings: ada delivered, bora failed, staff delivered (excluded).
select tests.make_briefing(tests.user_id('ada@kpi.test'), 'morning', 'delivered'),
       tests.make_briefing(tests.user_id('bora@kpi.test'), 'morning', 'failed'),
       tests.make_briefing(tests.user_id('staff@kpi.test'), 'morning', 'delivered');

-- Notifications: ada sent, ada suppressed, ada test push (never a sent KPI), staff sent (excluded).
insert into public.notifications (user_id, category, decision, dedupe_key, detail_mode, data, android_channel, scheduled_for,
                                  sent_at, is_test, suppression_reason)
values (tests.user_id('ada@kpi.test'), 'meeting', 'sent', 'kpi:1', 'title_only', '{"type": "meeting", "deeplink": "dijitalasistan://flow"}', 'meetings', now(), now(), false, null),
       (tests.user_id('ada@kpi.test'), 'follow_up', 'suppressed', 'kpi:2', 'title_only',
        '{"type": "follow_up", "deeplink": "dijitalasistan://flow"}', 'follow_up', now(), null, false, 'quiet_hours'),
       (tests.user_id('ada@kpi.test'), 'account', 'sent', 'kpi:3', 'generic', '{"type": "test", "deeplink": "dijitalasistan://flow"}',
        'account', now(), now(), true, null),
       (tests.user_id('staff@kpi.test'), 'meeting', 'sent', 'kpi:4', 'title_only',
        '{"type": "meeting", "deeplink": "dijitalasistan://flow"}', 'meetings', now(), now(), false, null);

create temporary table k1 on commit drop as select private.dashboard_kpis((select s from win), (select e from win)) as v;
create function pg_temp.d(p_key text) returns numeric
  language sql
  as $$ select coalesce((select (v ->> p_key)::numeric from k1), 0) - coalesce((select (v ->> p_key)::numeric from k0), 0) $$;

-- ─── Counters (deltas over the fixture) ──────────────────────────────────────────────────────
select is(pg_temp.d('total_users'), 3::numeric, 'total users: the three real users (internal and demo excluded)');
select is(pg_temp.d('new_users'), 3::numeric, 'new users: profiles created in the window');
select is(pg_temp.d('active_users'), 2::numeric, 'active users: distinct app_opened users (ada twice counts once)');
select is(pg_temp.d('pro_users'), 2::numeric, 'pro users: store or grant entitlement at the window end');
select is(pg_temp.d('pro_store'), 1::numeric, 'store Pro: the store trial');
select is(pg_temp.d('pro_grant_only'), 1::numeric, 'grant-only Pro: the grant');
select is(pg_temp.d('trials'), 1::numeric, 'trials: active store trials');
select is(pg_temp.d('connected_emails'), 3::numeric, 'connected mail accounts: ada, bora, cem work (disconnected and excluded left out)');
select is(pg_temp.d('connected_calendars'), 1::numeric, 'connected calendars');
select is(pg_temp.d('ai_requests'), 4::numeric, 'AI requests: provider calls of the population plus system calls, blocked ones left out');
select is(pg_temp.d('ai_cost_usd'), 0.005::numeric, 'AI cost: (3 × 1500 + 500) micros');
select is(pg_temp.d('briefings_generated'), 1::numeric, 'briefings generated');
select is(pg_temp.d('push_sent'), 1::numeric, 'pushes sent (test pushes excluded)');

-- ─── Rates (the fixture is the only data in the window) ──────────────────────────────────────
select is((select (v ->> 'briefing_success_rate')::numeric from k1), 0.5, 'briefing success = ready|delivered / scheduled outcomes');
select is((select (v ->> 'suppression_rate')::numeric from k1), 0.3333, 'suppression rate = suppressed|deduplicated / created');
select is((select (v ->> 'reconnect_rate')::numeric from k1), 0.5, 'reconnect rate = healthy again / needed a reconnect');
select is((select v ->> 'approval_conversion' from k1), null, 'no decided approvals → null, never a fake 0');

-- ─── The ADM-01 surface ──────────────────────────────────────────────────────────────────────
select tests.authenticate_as(tests.create_admin('metrics@kpi.test', 'analyst'), 'aal2');
select ok((admin_api.dashboard_metrics('24h') -> 'value') ?& array['total_users', 'active_users', 'reconnect_rate', 'ai_cost_usd',
                                                                     'classification_rate', 'sync_success_rate'],
          'dashboard_metrics carries every contract KPI');
select ok(admin_api.dashboard_metrics('24h') ? 'prev_value', 'dashboard_metrics carries the previous window for the delta');
select is((admin_api.dashboard_metrics('24h') ->> 'ai_cost_per_active_user')::numeric,
          round((admin_api.dashboard_metrics('24h') #>> '{value,ai_cost_usd}')::numeric
                / (admin_api.dashboard_metrics('24h') #>> '{value,active_users}')::numeric, 4),
          'AI cost per active user = cost / active users');
select ok(admin_api.dashboard_series('ai_costs', '24h') -> 'points' -> 0 ->> 't' ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$',
          'chart buckets are timestamptz values with an offset');
select is((admin_api.metrics_product('24h') ->> 'active_users')::integer, 2,
          'metrics_product counts the same active population (internal and demo excluded)');
select tests.clear_authentication();

-- ─── Rollups ─────────────────────────────────────────────────────────────────────────────────
create temporary table day on commit drop as select (now() at time zone 'Europe/Istanbul')::date as d;
select ok((private.rollup_metrics_daily((select d from day)) ->> 'metrics_rows')::integer > 0, 'the rollup writes metric rows');
create temporary table r1 on commit drop as
select metric_key, dim1, dim2, dim3, value, value_sum from public.metrics_daily where day = (select d from day);
select private.rollup_metrics_daily((select d from day));
select is((select count(*) from public.metrics_daily where day = (select d from day)), (select count(*) from r1),
          'running the rollup twice keeps one row per key (idempotent)');
select is_empty($$ select metric_key, dim1, dim2, dim3, value, value_sum from public.metrics_daily where day = (select d from day)
                   except select * from r1 $$, 'a rerun produces identical values');
select is((select value from public.metrics_daily where day = (select d from day) and metric_key = 'briefings.status'
             and dim1 = 'morning' and dim2 = 'delivered'), 1::bigint, 'briefings.status excludes the internal user');
select is((select sum(value) from public.metrics_daily where day = (select d from day) and metric_key = 'notifications.decision'),
          2::numeric, 'notifications.decision equals the raw non-test rows of the population');
select is((select sum(requests) from public.ai_metrics_daily where day = (select d from day)), 5::numeric,
          'ai_metrics_daily equals the raw calls of the population plus system calls');
select is((select sum(cost_usd_micros) from public.ai_metrics_daily where day = (select d from day)), 5000::numeric,
          'the rollup cost equals the raw cost');

select * from finish();
rollback;
