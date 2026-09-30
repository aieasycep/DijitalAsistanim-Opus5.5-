-- pgTAP · the backoffice contract gaps (20260924003000): the §10 audit catalogue and the canonical
-- action names (every emitted literal is known; the writer stores the catalogue name), the
-- dashboard platform filter and rollup freshness, the PII reveal fields, the per-profile cost
-- estimate, the push-test quiet-hours preview and the bulk retry of selected jobs — each new
-- function denied for aal1 and for a role without its permission.
begin;
select plan(45);

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────
select tests.create_user('ios@gaps.test');
select tests.create_user('droid@gaps.test');
select tests.create_admin('root@gaps.test', 'super_admin');
select tests.create_admin('ops@gaps.test', 'operations');
select tests.create_admin('ro@gaps.test', 'readonly');
update public.profiles set display_name = 'Yunus Kaya' where user_id = tests.user_id('ios@gaps.test');
update public.profiles set created_at = now() - interval '2 hours'
 where user_id in (tests.user_id('ios@gaps.test'), tests.user_id('droid@gaps.test'));

create temporary table gx (k text primary key, id uuid) on commit drop;
grant select on gx to authenticated;
insert into gx values
  ('inst_ios', tests.make_installation(tests.user_id('ios@gaps.test'), 'ios', '1.4.0')),
  ('inst_droid', tests.make_installation(tests.user_id('droid@gaps.test'), 'android', '1.4.0')),
  ('acct', tests.make_account(tests.user_id('ios@gaps.test'), 'yunus.work@gmail.com')),
  ('acct_other', tests.make_account(tests.user_id('droid@gaps.test'), 'droid@gmail.com')),
  ('job_failed', public.enqueue_job('gmail_sync', 'gaps:failed', '{"account_id": "x"}')),
  ('job_queued', public.enqueue_job('gmail_sync', 'gaps:queued', '{"account_id": "y"}'));
update public.jobs set status = 'failed', attempts = 5, last_error_code = 'UPSTREAM_TIMEOUT'
 where id = (select id from gx where k = 'job_failed');
with t as (insert into public.support_tickets (user_id, category, subject, message, origin, contact_email)
           values (tests.user_id('ios@gaps.test'), 'sync', 'Senkron', 'Mailler gelmiyor', 'app', 'yunus.contact@gmail.com')
           returning id)
insert into gx select 'ticket', id from t;
insert into public.analytics_events (user_id, event_name, platform, occurred_at)
values (tests.user_id('ios@gaps.test'), 'app_opened', 'ios', now() - interval '1 hour'),
       (tests.user_id('droid@gaps.test'), 'app_opened', 'android', now() - interval '1 hour');
-- A sent push to the iOS device only.
with tok as (insert into public.push_tokens (user_id, installation_id, expo_push_token)
             values (tests.user_id('ios@gaps.test'), (select id from gx where k = 'inst_ios'), 'ExponentPushToken[abcdefghij]')
             returning id),
n as (insert into public.notifications (user_id, category, decision, dedupe_key, detail_mode, data, android_channel, sent_at,
                                       scheduled_for)
      values (tests.user_id('ios@gaps.test'), 'account', 'sent', 'gaps:push', 'generic',
              '{"type": "admin_test", "deeplink": "dijitalasistan://today"}', 'account', now() - interval '30 minutes',
              now() - interval '31 minutes')
      returning id)
insert into public.push_tickets (user_id, notification_id, push_token_id, status, sent_at)
select tests.user_id('ios@gaps.test'), n.id, tok.id, 'ok', now() - interval '30 minutes' from n, tok;
-- Quiet hours around the iOS user's current local time.
update public.notification_preferences
   set quiet_hours_enabled = true,
       quiet_start = ((now() at time zone 'Europe/Istanbul') - interval '1 hour')::time,
       quiet_end = ((now() at time zone 'Europe/Istanbul') + interval '1 hour')::time,
       quiet_days = array[1, 2, 3, 4, 5, 6, 7]::smallint[]
 where user_id = tests.user_id('ios@gaps.test');
-- AI traffic: one Pro user, two email_triage calls on balanced, priced in the daily rollup.
insert into public.ai_requests (user_id, plan, profile, feature, tier, provider, model, operation, status, latency_ms,
                                input_tokens, output_tokens, cost_usd_micros, created_at)
select tests.user_id('ios@gaps.test'), 'pro', 'balanced', 'email_triage', 't1', 'anthropic', 'model-a', 'generate', 'ok', 300,
       1000, 100, 1500, now() - interval '2 days'
from generate_series(1, 2);
insert into public.ai_metrics_daily (day, feature, provider, model, plan, profile, status, requests, cost_usd_micros)
values ((now() - interval '2 days')::date, 'email_triage', 'anthropic', 'model-a', 'pro', 'balanced', 'ok', 2, 3000);

-- ─── §10 audit catalogue and canonical names ─────────────────────────────────────────────────
create temporary table emitted on commit drop as
with src as (
  select p.proname, p.prosrc from pg_catalog.pg_proc p
  where p.pronamespace in ('admin_api'::regnamespace, 'private'::regnamespace, 'public'::regnamespace)),
lits as (
  select s.proname, m[1] as action from src s, regexp_matches(s.prosrc, 'admin_audit\(v_admin,\s*''([a-z_.]+)''', 'g') as m
  union all
  select s.proname, x[1] from src s, regexp_matches(s.prosrc, 'admin_audit\(v_admin,\s*case(.*?)\mend\M', 'g') as m,
         regexp_matches(m[1], '''([a-z_]+\.[a-z_.]+)''', 'g') as x
  union all
  select s.proname, m[1] from src s,
         regexp_matches(s.prosrc, 'audit_log_append\(\s*''(?:system|user|admin|worker)'',\s*[^,]+,\s*[^,]+,\s*''([a-z_.]+)''', 'g') as m
  union all
  select s.proname, x[1] from src s, regexp_matches(s.prosrc, 'audit_log_append\(\s*[^;]*?,\s*case\s+when(.*?)\mend\M', 'g') as m,
         regexp_matches(m[1], '''([a-z_]+\.[a-z_.]+)''', 'g') as x
  union all
  select s.proname, m[1] from src s,
         regexp_matches(s.prosrc, 'audit_log_append\(\s*case\s[^;]*?\mend\M,\s*[^,]+,\s*[^,]+,\s*''([a-z_.]+)''', 'g') as m)
select distinct proname, action from lits where action !~ '\.$';

select cmp_ok((select count(*)::integer from emitted), '>=', 60, 'the scan finds the audit emitters');
select is_empty($$ select proname || ': ' || action from emitted
                   where not private.audit_action_known(private.audit_action_canonical(action)) $$,
                'every emitted audit action is a §10 catalogue action (or an app/system namespace)');
select ok(exists (select 1 from emitted where action = 'entitlement.granted'), 'case-form emitters are scanned too');
select is((select count(*)::integer from private.audit_action_catalogue), 88, 'the catalogue has 88 actions');
select is_empty($$ select action from private.audit_action_catalogue group by action having count(*) > 1 $$,
                'catalogue actions are unique');
select is(private.audit_action_canonical('pii.reveal', '{"resource_type": "user"}'), 'user.pii_revealed', 'user reveal');
select is(private.audit_action_canonical('pii.reveal', '{"grant_id": "x", "resource_type": "insight"}'),
          'support_access.content_viewed', 'support access content view');
select is(private.audit_action_canonical('pii.reveal', '{"resource_type": "ai_feedback"}'), 'ai_feedback.comment_revealed',
          'AI feedback comment reveal');
select is(private.audit_action_canonical('flag.killed', '{"on": false}'), 'flag.kill_switch_off', 'kill switch off');
select is(private.audit_action_canonical('referral.reviewed', '{"decision": "approve"}'), 'referral.approved', 'approve');
select is(private.audit_action_canonical('support.ticket_updated',
                                         '{"before": {"status": "open", "assignee": null}, "after": {"status": "open", "assignee": "a"}}'),
          'ticket.assigned', 'an assignee-only change is ticket.assigned');
select is(private.audit_action_canonical('admin.sessions_revoked', '{"scope": "others"}'), 'admin.logout_all',
          'own sign-out elsewhere is admin.logout_all');
select is(private.audit_action_canonical('system.referral.flagged'), 'system.referral.flagged', 'app/system names pass');

-- ─── ADM-02 reveal: every §5.5 field, audited as user.pii_revealed ───────────────────────────
select tests.authenticate_as(md5('da-test-admin:root@gaps.test')::uuid, 'aal2');
select is(admin_api.user_reveal_email(tests.user_id('ios@gaps.test'), 'Kullanıcı adının doğrulanması istendi',
                                      'display_name') ->> 'value', 'Yunus Kaya', 'the display name is revealed');
select is(admin_api.user_reveal_email(tests.user_id('ios@gaps.test'), 'Bağlı posta kutusunun doğrulanması',
                                      'integration_email:' || (select id from gx where k = 'acct')) ->> 'value',
          'yunus.work@gmail.com', 'an integration mailbox email is revealed');
select is(admin_api.user_reveal_email(tests.user_id('ios@gaps.test'), 'Talep iletişim adresinin doğrulanması',
                                      'ticket_contact_email:' || (select id from gx where k = 'ticket')) ->> 'value',
          'yunus.contact@gmail.com', 'a ticket contact email is revealed');
select throws_ok(format($$ select admin_api.user_reveal_email(%L, 'Başka kullanıcının hesabı denendi', %L) $$,
                        tests.user_id('ios@gaps.test'), 'integration_email:' || (select id from gx where k = 'acct_other')),
                 'P0002', null, 'another user''s account cannot be revealed through this user');
select throws_ok(format($$ select admin_api.user_reveal_email(%L, 'Geçersiz alan denemesi yapıldı', 'phone') $$,
                        tests.user_id('ios@gaps.test')),
                 '22023', 'VALIDATION_FAILED:field', 'unknown fields are refused');
select tests.clear_authentication();
select is((select count(*)::integer from public.audit_logs
           where action = 'user.pii_revealed' and target_user_id = tests.user_id('ios@gaps.test')), 3,
          'each reveal writes one user.pii_revealed row');
select is((select array_agg(details ->> 'field' order by id) from public.audit_logs
           where action = 'user.pii_revealed' and target_user_id = tests.user_id('ios@gaps.test')),
          array['display_name', 'integration_email', 'ticket_contact_email'], 'the audit row names the field kind');

-- ─── ADM-01 dashboard: platform filter and rollup freshness ──────────────────────────────────
select tests.authenticate_as(md5('da-test-admin:ro@gaps.test')::uuid, 'aal2');
select is((admin_api.dashboard_metrics('24h', 'ios') #>> '{value,active_users}')::integer, 1, 'iOS active users');
select is((admin_api.dashboard_metrics('24h', 'android') #>> '{value,active_users}')::integer, 1, 'Android active users');
select is((admin_api.dashboard_metrics('24h') #>> '{value,active_users}')::integer, 2, 'all platforms by default');
select is((admin_api.dashboard_metrics('24h', 'ios') #>> '{value,push_sent}')::integer, 1, 'iOS push sent');
select is((admin_api.dashboard_metrics('24h', 'android') #>> '{value,push_sent}')::integer, 0, 'no Android push');
select is((admin_api.dashboard_metrics('24h', 'android') #>> '{value,new_users}')::integer, 1, 'Android new users');
select is(admin_api.dashboard_metrics('24h', 'ios') ->> 'platform', 'ios', 'the platform is echoed');
select throws_ok($$ select admin_api.dashboard_metrics('24h', 'web') $$, '22023', 'VALIDATION_FAILED:platform',
                 'unknown platforms are refused');
select is((admin_api.dashboard_metrics('7d') #>> '{rollup,stale}')::boolean, true, 'never-computed rollups are stale');
select tests.clear_authentication();
insert into public.metrics_daily (day, metric_key, value, computed_at) values (current_date, 'jobs.finished', 1, now());
select tests.authenticate_as(md5('da-test-admin:ro@gaps.test')::uuid, 'aal2');
select is((admin_api.dashboard_metrics('7d') #>> '{rollup,stale}')::boolean, false, 'a fresh rollup is not stale');

-- ─── ADM-08 per-profile cost estimate ────────────────────────────────────────────────────────
select is((admin_api.ai_model_config_list() #>> '{profile_costs,balanced,monthly_usd}')::numeric, 0.003,
          'balanced: the Pro mix priced at the balanced cost per request, per Pro user');
select is(admin_api.ai_model_config_list() #>> '{profile_costs,lean,monthly_usd}', null,
          'lean: no priced traffic → no figure');
select is((admin_api.ai_model_config_list() #>> '{profile_costs,balanced,pro_users}')::integer, 1, 'one active Pro user');

-- ─── ADM-07 push-test preview (R-13) ─────────────────────────────────────────────────────────
select throws_ok(format($$ select admin_api.notification_test_preview(%L) $$, tests.user_id('ios@gaps.test')),
                 '42501', 'ADMIN_FORBIDDEN', 'readonly cannot preview a test push');
select tests.clear_authentication();
select tests.authenticate_as(md5('da-test-admin:ops@gaps.test')::uuid, 'aal2');
select is((admin_api.notification_test_preview(tests.user_id('ios@gaps.test')) ->> 'in_quiet_hours')::boolean, true,
          'inside quiet hours the preview says so');
select isnt(admin_api.notification_test_preview(tests.user_id('ios@gaps.test')) ->> 'quiet_hours_end_local', null,
            'and names the local end time');
select is((admin_api.notification_test_preview(tests.user_id('ios@gaps.test')) ->> 'active_devices')::integer, 1,
          'one active device');
select is((admin_api.notification_test_preview(tests.user_id('droid@gaps.test')) ->> 'in_quiet_hours')::boolean, false,
          'outside quiet hours it is sent at once');

-- ─── ADM-05 bulk retry of selected jobs ──────────────────────────────────────────────────────
select is(admin_api.job_retry_selected(array[(select id from gx where k = 'job_failed'),
                                             (select id from gx where k = 'job_queued'),
                                             '00000000-0000-4000-8000-00000000dead'::uuid],
                                       'Seçilen işler yeniden deneniyor') -> 'retried',
          jsonb_build_array((select id from gx where k = 'job_failed')), 'only the failed job is retried');
select throws_ok($$ select admin_api.job_retry_selected('{}'::uuid[], 'Boş seçim ile deneme yapıldı') $$,
                 '22023', 'VALIDATION_FAILED:job_ids', 'an empty selection is refused');
select tests.clear_authentication();
select is((select status::text from public.jobs where id = (select id from gx where k = 'job_failed')), 'queued',
          'the retried job is queued again');
select is((select array_agg(a.action order by a.id) from public.audit_logs a
           where a.action in ('job.retried', 'job.bulk_retried') and a.actor_id = md5('da-test-admin:ops@gaps.test')::uuid),
          array['job.retried', 'job.bulk_retried'], 'one job.retried row per job and one summary row');
select is((select (details ->> 'skipped')::integer from public.audit_logs
           where action = 'job.bulk_retried' and actor_id = md5('da-test-admin:ops@gaps.test')::uuid), 2,
          'the summary counts the skipped (invalid state, not found)');

-- ─── Guards: aal1 and a role without the permission ──────────────────────────────────────────
select tests.authenticate_as(md5('da-test-admin:ops@gaps.test')::uuid, 'aal1');
select throws_ok(format($$ select admin_api.job_retry_selected(array[%L::uuid], 'aal1 oturumuyla deneme yapıldı') $$,
                        (select id from gx where k = 'job_failed')),
                 '42501', 'ADMIN_AAL2_REQUIRED', 'aal1 cannot bulk-retry');
select tests.clear_authentication();
select tests.authenticate_as(md5('da-test-admin:ro@gaps.test')::uuid, 'aal2');
select throws_ok(format($$ select admin_api.job_retry_selected(array[%L::uuid], 'Salt okunur rol ile deneme') $$,
                        (select id from gx where k = 'job_failed')),
                 '42501', 'ADMIN_FORBIDDEN', 'readonly cannot bulk-retry');
select tests.clear_authentication();

select * from finish();
rollback;
