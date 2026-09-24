-- pgTAP · admin_api behaviour with realistic data: every read and mutation runs as a permitted
-- admin against fixture rows, then key outcomes are asserted (masking, reasons, audit rows,
-- state machines). Complements the table-driven guard matrix of 120_admin_rbac.
begin;
select plan(39);

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────
select tests.create_user('kerem@smoke.test');
select tests.create_user('lale@smoke.test');
select tests.make_pro(tests.user_id('lale@smoke.test'));
select tests.create_admin('root@smoke.test', 'super_admin');
select tests.create_admin('root2@smoke.test', 'super_admin');
select tests.create_admin('ops@smoke.test', 'operations');
insert into auth.users (id, email, raw_app_meta_data)
values ('00000000-0000-4000-8000-00000000ad01', 'new.admin@dijitalasistan.app', '{"da_kind": "admin"}');

create temporary table sm (k text primary key, id uuid) on commit drop;
grant select on sm to authenticated;
insert into sm values
  ('acct', tests.make_account(tests.user_id('kerem@smoke.test'), 'kerem@gmail.com')),
  ('inst', tests.make_installation(tests.user_id('kerem@smoke.test'), 'android', '1.2.0')),
  ('briefing', tests.make_briefing(tests.user_id('kerem@smoke.test'), 'morning', 'failed')),
  ('job', public.enqueue_job('gmail_sync', 'smoke:job', '{"account_id": "x", "token": "never-shown"}'));
with t as (insert into public.support_tickets (user_id, category, subject, message, origin)
           values (tests.user_id('kerem@smoke.test'), 'sync', 'Senkron sorunu', 'Mailler gelmiyor', 'app') returning id)
insert into sm select 'ticket', id from t;
with f as (insert into public.user_feedback (user_id, type, rating, message, contact_email)
           values (tests.user_id('kerem@smoke.test'), 'bug', 2, 'Uygulama donuyor', 'kerem@gmail.com') returning id)
insert into sm select 'feedback', id from f;
with e as (insert into public.data_export_requests (user_id, status) values (tests.user_id('kerem@smoke.test'), 'expired') returning id)
insert into sm select 'export', id from e;
with r as (insert into public.referrals (referrer_id, referee_id, code, status, risk_score, risk_signals)
           values (tests.user_id('lale@smoke.test'), tests.user_id('kerem@smoke.test'),
                   (select code from public.referral_codes where user_id = tests.user_id('lale@smoke.test')), 'flagged', 70,
                   '{"velocity": true}') returning id)
insert into sm select 'referral', id from r;
update public.jobs set status = 'dead_letter', attempts = 5, last_error_code = 'UPSTREAM_TIMEOUT' where id = (select id from sm where k = 'job');
insert into public.ai_requests (user_id, plan, profile, feature, tier, provider, model, operation, status, latency_ms, input_tokens,
                                output_tokens, cost_usd_micros, created_at)
select tests.user_id('kerem@smoke.test'), 'free', 'lean', 'email_triage', 't1', 'anthropic', 'model-a', 'generate',
       (array['ok', 'ok', 'error', 'cached'])[1 + g % 4], 200 + g * 10, 1000, 100, 150, now() - interval '1 hour'
from generate_series(1, 20) as g;
insert into public.billing_events (event_id, user_id, event_type, environment, store, product_id, event_timestamp, payload, process_status)
values ('evt-smoke-1', tests.user_id('lale@smoke.test'), 'INITIAL_PURCHASE', 'PRODUCTION', 'app_store', 'pro_monthly', now() - interval '1 day',
        '{"event": {"period_type": "TRIAL", "price": 0, "subscriber_attributes": {"$email": {"value": "secret@example.com"}}}}', 'processed');
insert into public.system_health_checks (component, status, latency_ms, detail, checked_by)
values ('api', 'healthy', 42, '{"code": "ok"}', 'cron'), ('ai_anthropic', 'external_credential_required', null, '{"code": "missing_key"}', 'cron');
insert into public.notifications (user_id, category, decision, suppression_reason, dedupe_key, detail_mode, data, android_channel,
                                  scheduled_for, created_at)
values (tests.user_id('kerem@smoke.test'), 'follow_up', 'suppressed', 'late_delivery', 'smoke:n1', 'title_only',
        '{"type": "follow_up", "deeplink": "dijitalasistan://flow"}', 'follow_up', now() - interval '1 hour', now() - interval '1 hour');

create temporary table smv on commit drop as
select (select correlation_id from public.jobs where id = (select id from sm where k = 'job')) as job_corr,
       (select id from public.billing_events where event_id = 'evt-smoke-1') as billing_id,
       (select max(id) from public.audit_logs) as audit_id;
grant select on smv to authenticated;

-- ─── Reads (each statement must run; failures are listed) ────────────────────────────────────
select tests.authenticate_as(md5('da-test-admin:root@smoke.test')::uuid, 'aal2');
create temporary table smoke_errors (stmt text, err text) on commit drop;
grant all on smoke_errors to authenticated;
do $$
declare
  v_stmt text;
begin
  foreach v_stmt in array array[
    $q$select admin_api.admin_me()$q$, $q$select admin_api.sessions_list_own()$q$, $q$select admin_api.admin_preferences_get()$q$,
    $q$select admin_api.admin_preferences_set('dark', 'en', '{"users": {"density": "compact"}}', '30d')$q$,
    $q$select admin_api.dashboard_metrics(r) from unnest(array['24h', '7d', '30d', '90d']) as r$q$,
    $q$select admin_api.dashboard_series(m, r) from unnest(array['user_growth', 'active_usage', 'ai_costs', 'subscriptions', 'sync_failures']) as m,
       unnest(array['24h', '30d', '90d']) as r$q$,
    $q$select admin_api.metrics_ops('7d'), admin_api.metrics_product('30d'), admin_api.security_events('7d')$q$,
    $q$select admin_api.users_list(1, 10, '-created_at', '{"plan": "free"}')$q$,
    $q$select admin_api.users_list(2, 5, 'last_active_at', '{"q": "kerem"}')$q$,
    $q$select admin_api.user_overview(tests.user_id('kerem@smoke.test')), admin_api.user_integrations(tests.user_id('kerem@smoke.test')),
             admin_api.user_briefings(tests.user_id('kerem@smoke.test')), admin_api.user_usage(tests.user_id('kerem@smoke.test'), '7d'),
             admin_api.user_subscription(tests.user_id('lale@smoke.test')), admin_api.user_referrals(tests.user_id('lale@smoke.test')),
             admin_api.user_support(tests.user_id('kerem@smoke.test')), admin_api.user_audit(tests.user_id('kerem@smoke.test')),
             admin_api.user_devices(tests.user_id('kerem@smoke.test'))$q$,
    $q$select admin_api.tickets_list(), admin_api.ticket_detail((select id from sm where k = 'ticket'))$q$,
    $q$select admin_api.integrations_overview(), admin_api.integrations_summary('7d'), admin_api.integration_detail((select id from sm where k = 'acct'))$q$,
    $q$select admin_api.jobs_list(1, 25, '-created_at', '{"status": "dead_letter"}'), admin_api.jobs_summary('24h'),
             admin_api.job_detail((select id from sm where k = 'job')),
             admin_api.correlation_trace((select job_corr from smv))$q$,
    $q$select admin_api.briefings_metrics('7d'), admin_api.briefings_list(), admin_api.notifications_metrics('7d'),
             admin_api.notifications_user_debug(tests.user_id('kerem@smoke.test'))$q$,
    $q$select admin_api.ai_metrics(r, g) from unnest(array['24h', '30d']) as r,
       unnest(array['feature', 'model', 'provider', 'prompt_version', 'profile', 'day']) as g$q$,
    $q$select admin_api.ai_cost_series('24h', 'feature'), admin_api.ai_cost_series('90d', 'model'), admin_api.ai_requests_list(),
             admin_api.ai_model_config_list(), admin_api.ai_model_prices_list()$q$,
    $q$select admin_api.prompts_list(), admin_api.prompt_versions_list('email_classification')$q$,
    $q$select admin_api.ai_feedback_aggregate('30d', 'prompt_version'), admin_api.ai_feedback_list()$q$,
    $q$select admin_api.subscriptions_metrics('30d'), admin_api.subscriptions_list(), admin_api.billing_events_list(),
             admin_api.billing_event_get((select billing_id from smv)),
             admin_api.trial_stream('30d'), admin_api.entitlement_grants_list(1, 25, null, '{"state": "active"}')$q$,
    $q$select admin_api.referrals_metrics('30d'), admin_api.referrals_list(1, 25, '-risk_score', '{"status": "flagged"}')$q$,
    $q$select admin_api.feedback_list(), admin_api.feedback_summary('30d')$q$,
    $q$select admin_api.flags_list(), admin_api.flag_get('feature.midday'),
             admin_api.flag_evaluate_preview('feature.midday', tests.user_id('kerem@smoke.test'))$q$,
    $q$select admin_api.announcements_list(), admin_api.announcement_audience_estimate('free', array['android']::public.platform[], '1.0.0')$q$,
    $q$select admin_api.data_requests_list(k) from unnest(array['export', 'history', 'account']) as k$q$,
    $q$select admin_api.data_request_get('export', (select id from sm where k = 'export'))$q$,
    $q$select admin_api.audit_list(), admin_api.audit_get((select audit_id from smv)), admin_api.audit_verify()$q$,
    $q$select admin_api.health_latest(), admin_api.health_history('api', '7d'), admin_api.app_versions_breakdown('30d'),
             admin_api.cron_status()$q$,
    $q$select admin_api.admins_list(), admin_api.settings_get(), admin_api.plan_limits_list(),
             admin_api.command_search((select id from sm where k = 'job')::text), admin_api.command_search('DA-2026-000001')$q$]
  loop
    begin
      execute v_stmt;
    exception when others then
      insert into smoke_errors values (v_stmt, sqlstate || ' ' || sqlerrm);
    end;
  end loop;
end
$$;
select is_empty($$ select err || ' ← ' || left(stmt, 120) from smoke_errors $$, 'every admin read runs against fixture data');
select ok(admin_api.billing_event_get((select billing_id from smv))::text !~ 'subscriber_attributes|secret@',
          'billing_event_get never returns subscriber attributes');
select ok(admin_api.job_detail((select id from sm where k = 'job'))::text !~ 'never-shown', 'job payloads are redacted to ids');
select is((admin_api.ai_metrics('24h', 'feature') -> 'rows' -> 0 ->> 'requests')::integer, 20, 'ai_metrics counts the raw requests');
select is((admin_api.ai_metrics('24h', 'feature') -> 'rows' -> 0 ->> 'error_rate')::numeric, round(5::numeric / 15, 4),
          'error rate = errors / calls that reached a provider');
select ok((admin_api.notifications_metrics('7d') -> 'suppression_reasons') ? 'late_delivery',
          'notifications_metrics reports the late_delivery suppression reason');
select is(admin_api.health_latest() -> 'components' -> 0 ->> 'component', 'ai_anthropic', 'health_latest lists the latest probe per component');
select is((select r ->> 'status' from jsonb_array_elements(admin_api.health_latest() -> 'components') as r where r ->> 'component' = 'ai_anthropic'),
          'external_credential_required', 'a missing credential is never reported healthy');
select ok((admin_api.cron_status() ->> 'available')::boolean, 'cron_status reads pg_cron');

-- ─── Mutations ───────────────────────────────────────────────────────────────────────────────
select is(jsonb_array_length(admin_api.user_force_sync(tests.user_id('kerem@smoke.test'), null, 'user reported missing mail') -> 'job_ids'),
          2, 'force sync enqueues the mail and the calendar sync of the account');
select is(admin_api.user_disable(tests.user_id('kerem@smoke.test'), 'abuse report under review') ->> 'state', 'disabled', 'user disabled');
select is(admin_api.user_restore(tests.user_id('kerem@smoke.test'), 'abuse report resolved ok') ->> 'state', 'active', 'user restored');
select is(admin_api.ticket_update((select id from sm where k = 'ticket'), 'in_progress', md5('da-test-admin:root@smoke.test')::uuid, 'high',
                                  'triaged and assigned to myself') ->> 'status', 'in_progress', 'ticket updated');
select ok(admin_api.ticket_add_note((select id from sm where k = 'ticket'), 'Kullanıcıya dönüş yapıldı.') ? 'note_id', 'internal note added');
select is(admin_api.job_retry((select id from sm where k = 'job'), 'upstream recovered, retrying') ->> 'status', 'queued', 'dead letter retried');
select is(admin_api.briefing_regenerate((select id from sm where k = 'briefing'), 'regenerate after the model fix') ->> 'version', '2',
          'briefing regenerated as version 2');
select is(admin_api.referral_review((select id from sm where k = 'referral'), 'approve', 'manual review: legitimate referral') ->> 'status',
          'rewarded', 'a flagged referral approved → rewarded');
select is(admin_api.referral_review((select id from sm where k = 'referral'), 'approve', 'manual review: legitimate referral') ->> 'replayed',
          'true', 'approving twice rewards once');
select is(admin_api.feedback_update((select id from sm where k = 'feedback'), 'triaged', null, 'triaged for the next sprint') ->> 'status',
          'triaged', 'feedback triaged');
select throws_ok($$ select admin_api.feedback_update((select id from sm where k = 'feedback'), 'done', null, 'invalid status value') $$,
                 '22023', 'VALIDATION_FAILED:status', 'a feedback status outside the DB check is rejected');
select is(admin_api.flag_upsert('feature.smoke_test', 'Smoke test flag', false, 50, null, array['pro'], null, null, '{}',
                                'create a staged rollout flag') ->> 'key', 'feature.smoke_test', 'flag created');
select is(admin_api.flag_archive('feature.smoke_test', 'no longer needed after test') ->> 'archived_at' is not null, true, 'disabled flag archived');
select throws_ok($$ select admin_api.flag_archive('ai.global.enabled', 'kill switches are never archived') $$, '55000', 'STATE_CONFLICT',
                 'kill switches cannot be archived');
select is(admin_api.flag_kill('feature.midday', 'incident: midday briefing errors') ->> 'enabled', 'false', 'kill switch turns a flag off');
select is(admin_api.flag_override_set('feature.midday', tests.user_id('lale@smoke.test'), true, 'QA verification override') ->> 'value',
          'true', 'override set');
select is(admin_api.flag_override_delete('feature.midday', tests.user_id('lale@smoke.test'), 'QA verification finished') ->> 'deleted',
          'true', 'override removed');
create temporary table ann on commit drop as
select (admin_api.announcement_upsert(null, jsonb_build_object('title_tr', 'Yeni özellik', 'title_en', 'New feature',
                                                               'body_tr', 'Sabah brifingi artık sesli.', 'body_en', 'Audio briefings are here.',
                                                               'audience', 'pro', 'starts_at', now() + interval '1 hour',
                                                               'ends_at', now() + interval '2 days'),
                                      'announce the audio briefing') ->> 'id')::uuid as id;
select is(admin_api.announcement_publish((select id from ann), 'ship the announcement now', true) ->> 'status', 'live',
          'announcement published live');
select is(admin_api.announcement_cancel((select id from ann), 'copy needs another review') ->> 'status', 'cancelled', 'announcement cancelled');
select ok(admin_api.export_regenerate((select id from sm where k = 'export'), 'user asked for a fresh export') ? 'job_id',
          'an expired export is regenerated with a new job');
select is(admin_api.settings_update('today.max_priorities', '4', 'tighten the Today list') ->> 'value', '4', 'setting updated');
select throws_ok($$ select admin_api.settings_update('session.idle_minutes', '45', 'longer idle sessions please') $$, '22023',
                 'VALIDATION_FAILED:value', 'session values cannot be loosened beyond the baseline');
select throws_ok($$ select admin_api.settings_update('admin.gateway_secret_sha256', '"00"', 'rotate the gateway digest') $$, '22023',
                 'VALIDATION_FAILED:key', 'the gateway digest is never writable through settings');
select is(admin_api.plan_limits_update('free', 'vip_max', '6', 'raise the Free VIP allowance') ->> 'value', '6', 'plan limit updated');
select is(admin_api.plan_routing_profile_set('free', 'balanced', 'evaluate balanced routing for free') ->> 'profile', 'balanced',
          'routing profile switched');
select is(admin_api.admin_invite_record('00000000-0000-4000-8000-00000000ad01', 'new.admin@dijitalasistan.app', 'support', 'Yeni Admin',
                                        'new support teammate joins', sha256('invite-token'::bytea)) ->> 'status', 'invited', 'admin invited');
select is(admin_api.admin_update_role(md5('da-test-admin:ops@smoke.test')::uuid, 'ai_ops', 'moves to the AI operations team') ->> 'role',
          'ai_ops', 'admin role changed');
select throws_ok($$ select admin_api.admin_update_role(md5('da-test-admin:root@smoke.test')::uuid, 'readonly', 'demote myself please') $$,
                 '55000', 'STATE_CONFLICT', 'an admin cannot change their own role');
select throws_ok($$ select admin_api.admin_mfa_reset(md5('da-test-admin:ops@smoke.test')::uuid, 'lost authenticator device') $$,
                 '42501', 'FORBIDDEN', 'MFA reset needs a fresh step-up');
select tests.clear_authentication();
select ok(exists (select 1 from public.audit_logs where action = 'admin.role_changed' and reason = 'moves to the AI operations team'),
          'mutations append their audit row with the reason');

select * from finish();
rollback;
