-- pgTAP · the admin-api contract bridge (20260924002300): admin preferences, ticket patch / note /
-- reply (JOB-31 job, outbound_reply note, no address in the payload), ticket detail with every note
-- kind, force sync resources, integration webhook stats, security counters, the test push that
-- never bypasses quiet hours (R-13, TEST_PLAN UT-NTF-17), feedback rows, app versions below the
-- minimum, model config clears and the new functions in the RBAC map (DB-05 extension).
begin;
select plan(41);

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────
select tests.create_user('kerem@bridge.test');
select tests.create_admin('root@bridge.test', 'super_admin');
select tests.create_admin('help@bridge.test', 'support');

create temporary table bx (k text primary key, id uuid) on commit drop;
grant select on bx to authenticated;
insert into bx values
  ('acct', tests.make_account(tests.user_id('kerem@bridge.test'), 'kerem@gmail.com')),
  ('inst', tests.make_installation(tests.user_id('kerem@bridge.test'), 'ios', '1.0.0'));
with t as (insert into public.support_tickets (user_id, category, subject, message, origin, contact_email)
           values (tests.user_id('kerem@bridge.test'), 'sync', 'Senkron sorunu', 'Mailler gelmiyor', 'app', 'kerem@gmail.com')
           returning id)
insert into bx select 'ticket', id from t;
with t as (insert into public.support_tickets (user_id, category, subject, message, origin)
           values (tests.user_id('kerem@bridge.test'), 'other', 'Adressiz', 'İletişim adresi yok', 'app') returning id)
insert into bx select 'ticket_no_contact', id from t;
insert into public.support_notes (ticket_id, user_id, author_admin_id, kind, body)
select id, tests.user_id('kerem@bridge.test'), null, 'inbound_reply', 'Teşekkürler, düzeldi.' from bx where k = 'ticket';
with f as (insert into public.user_feedback (user_id, type, rating, message, diagnostics)
           values (tests.user_id('kerem@bridge.test'), 'bug', 2, 'Uygulama donuyor', '{"screen": "M-TD-01"}') returning id)
insert into bx select 'feedback', id from f;
insert into public.webhook_events (source, external_id, connected_account_id, signature_valid, status, payload_digest, received_at)
select 'google_gmail', 'ext-' || g, (select id from bx where k = 'acct'), true, case when g = 1 then 'ignored' else 'enqueued' end,
       sha256(convert_to('evt-' || g, 'UTF8')), now() - make_interval(hours => g)
from generate_series(1, 3) as g;
update public.app_installations set last_seen_at = now() - interval '1 hour' where id = (select id from bx where k = 'inst');
insert into public.app_settings (key, value, description)
values ('app.min_supported_version', '{"ios": "1.1.0", "android": "1.0.0"}', 'pgTAP minimum versions')
on conflict (key) do update set value = excluded.value;
-- Quiet hours around the current local time for the test push.
update public.notification_preferences
   set quiet_hours_enabled = true,
       quiet_start = ((now() at time zone 'Europe/Istanbul') - interval '1 hour')::time,
       quiet_end = ((now() at time zone 'Europe/Istanbul') + interval '1 hour')::time,
       quiet_days = array[1, 2, 3, 4, 5, 6, 7]::smallint[]
 where user_id = tests.user_id('kerem@bridge.test');

create temporary table cfg on commit drop as
select id, profile, feature, version from public.ai_model_config where cache_ttl is not null order by feature limit 1;
grant select on cfg to authenticated;

select tests.authenticate_as(md5('da-test-admin:root@bridge.test')::uuid, 'aal2');

-- ─── ADM-00 preferences ──────────────────────────────────────────────────────────────────────
select is(admin_api.admin_preferences_set(p_timezone => 'Europe/Berlin', p_density => 'compact',
                                          p_recent_items => '[{"type": "user", "id": "x", "label": "ke***@gmail.com"}]',
                                          p_sidebar_collapsed => true, p_locale => 'en') ->> 'timezone',
          'Europe/Berlin', 'preferences keep the timezone');
select is(admin_api.admin_preferences_get() ->> 'density', 'compact', 'preferences keep the density');
select is(admin_api.admin_preferences_get() ->> 'locale', 'en-US', 'short locales are stored in full');
select is((admin_api.admin_preferences_get() ->> 'sidebar_collapsed')::boolean, true, 'preferences keep the sidebar state');
select is(jsonb_array_length(admin_api.admin_preferences_get() -> 'recent_items'), 1, 'preferences keep the recent items');
select throws_ok($$ select admin_api.admin_preferences_set(p_timezone => 'Mars/Olympus_Mons') $$, '22023',
                 'VALIDATION_FAILED:timezone', 'an unknown IANA zone is refused');
select throws_ok($$ select admin_api.admin_preferences_set(
                      p_recent_items => (select jsonb_agg(jsonb_build_object('type', 'user', 'id', g::text, 'label', 'x'))
                                         from generate_series(1, 11) as g)) $$,
                 '22023', 'VALIDATION_FAILED:recent_items', 'at most ten recent items');

-- ─── ADM-03 tickets ──────────────────────────────────────────────────────────────────────────
select is(admin_api.ticket_patch((select id from bx where k = 'ticket'), 'in_progress', 'integration',
                                 md5('da-test-admin:help@bridge.test')::uuid) ->> 'status',
          'in_progress', 'ticket_patch changes the status');
select tests.clear_authentication();  -- table reads as the test superuser
select is((select assigned_admin_id from public.support_tickets where id = (select id from bx where k = 'ticket')),
          md5('da-test-admin:help@bridge.test')::uuid, 'ticket_patch assigns');
select isnt((select first_response_at from public.support_tickets where id = (select id from bx where k = 'ticket')), null,
            'leaving open marks the first response');
select ok(exists (select 1 from public.audit_logs a where a.action = 'support.ticket_updated'
                  and a.target_id = (select id from bx where k = 'ticket')::text
                  and a.details -> 'after' ->> 'status' = 'in_progress'), 'the patch is audited with before/after');
select tests.authenticate_as(md5('da-test-admin:root@bridge.test')::uuid, 'aal2');
select is(admin_api.ticket_patch((select id from bx where k = 'ticket'), p_unassign => true) ->> 'assignee', null,
          'ticket_patch unassigns');
select throws_ok($$ select admin_api.ticket_patch((select id from bx where k = 'ticket')) $$, '22023', 'VALIDATION_FAILED:fields',
                 'a patch without fields is refused');
select is(admin_api.ticket_patch((select id from bx where k = 'ticket'), p_status => 'open') ->> 'category', 'integration',
          'fields not in the patch are kept');

select ok(admin_api.ticket_add_note((select id from bx where k = 'ticket'), 'İç not.') ? 'note_id', 'internal note added');
select tests.clear_authentication();  -- table reads as the test superuser
select is((select kind from public.support_notes where body = 'İç not.'), 'internal', 'staff notes are internal');
select tests.authenticate_as(md5('da-test-admin:root@bridge.test')::uuid, 'aal2');

create temporary table reply on commit drop as
select admin_api.ticket_reply((select id from bx where k = 'ticket'), 'Merhaba, sorun giderildi.', 'tr') as r;
grant select on reply to authenticated;
select tests.clear_authentication();  -- table reads as the test superuser
select is((select n.kind from public.support_notes n where n.id = (select (r ->> 'note_id')::uuid from reply)), 'outbound_reply',
          'an e-mailed reply is an outbound_reply note');
select is((select status::text from public.support_tickets where id = (select id from bx where k = 'ticket')), 'waiting_user',
          'a reply waits for the user');
select is((select j.type::text from public.jobs j where j.id = (select (r ->> 'email_job_id')::uuid from reply)), 'transactional_email',
          'the reply queues a transactional_email job');
select is((select j.payload #>> '{recipient_ref,type}' from public.jobs j where j.id = (select (r ->> 'email_job_id')::uuid from reply)),
          'support_ticket', 'the recipient is a reference resolved at send time');
select ok((select j.payload::text !~ '@' from public.jobs j where j.id = (select (r ->> 'email_job_id')::uuid from reply)),
          'the job payload never holds an address');
select tests.authenticate_as(md5('da-test-admin:root@bridge.test')::uuid, 'aal2');
select throws_ok($$ select admin_api.ticket_reply((select id from bx where k = 'ticket_no_contact'), 'Merhaba') $$, '55000',
                 'STATE_CONFLICT', 'a ticket without a contact address cannot be answered by e-mail');

select is((select jsonb_agg(n ->> 'kind' order by n ->> 'kind')
           from jsonb_array_elements(admin_api.ticket_detail((select id from bx where k = 'ticket')) -> 'notes') as n),
          '["inbound_reply", "internal", "outbound_reply"]'::jsonb, 'ticket_detail lists every note kind');
select ok((select bool_or(n ->> 'author' is null and n ->> 'kind' = 'inbound_reply')
           from jsonb_array_elements(admin_api.ticket_detail((select id from bx where k = 'ticket')) -> 'notes') as n),
          'inbound notes have no admin author');

-- ─── ADM-02 / ADM-04 ─────────────────────────────────────────────────────────────────────────
select is(admin_api.user_force_sync(tests.user_id('kerem@bridge.test'), null, 'mail missing since morning', array['mail'])
            -> 'jobs' -> 0 ->> 'type', 'gmail_sync', 'force sync limited to mail queues only the mail sync');
select is(jsonb_array_length(admin_api.user_force_sync(tests.user_id('kerem@bridge.test'), null, 'calendar out of date',
                                                       array['calendar']) -> 'jobs'), 1, 'one job per requested resource');
select throws_ok($$ select admin_api.user_force_sync(tests.user_id('kerem@bridge.test'), null, 'sync everything', array['photos']) $$,
                 '22023', 'VALIDATION_FAILED:resources', 'unknown resources are refused');
select is(admin_api.integration_detail((select id from bx where k = 'acct')) -> 'webhook_stats' -> 'received_24h', '3'::jsonb,
          'webhook stats count the last 24 h');
select is(admin_api.integration_detail((select id from bx where k = 'acct')) -> 'webhook_stats' -> 'unmatched_24h', '1'::jsonb,
          'unmatched = notifications that matched no watch');

-- ─── ADM-01 security counters ────────────────────────────────────────────────────────────────
-- (audit rows carry clock_timestamp(), after this transaction's now(): the window end.)
select ok(admin_api.security_events('7d') ?& array['login_failures', 'lockouts', 'recovery_codes_used', 'permission_denials',
                                                  'webhook_signature_failures', 'by_admin'],
          'security_events carries every ADM-01 counter');
select is(jsonb_typeof(admin_api.security_events('7d') -> 'by_admin'), 'array', 'per-admin counts are a list');

-- ─── ADM-07 test push (R-13) ─────────────────────────────────────────────────────────────────
create temporary table push on commit drop as
select admin_api.notification_send_test(tests.user_id('kerem@bridge.test'), 'user reports no notifications') as r;
grant select on push to authenticated;
select ok((select (r ->> 'deferred_until')::timestamptz > now() from push), 'inside quiet hours the test push is deferred');
select tests.clear_authentication();  -- table reads as the test superuser
select is((select j.payload ->> 'bypass_quiet_hours' from public.jobs j where j.id = (select (r ->> 'job_id')::uuid from push)),
          'false', 'the test push never bypasses quiet hours');
select is((select j.payload ->> 'notification_id' from public.jobs j where j.id = (select (r ->> 'job_id')::uuid from push)),
          (select r ->> 'notification_id' from push), 'the reserved notification id travels in the job');
select is((select n.decision::text || ':' || n.detail_mode::text || ':' || n.is_test::text from public.notifications n
           where n.id = (select (r ->> 'notification_id')::uuid from push)), 'scheduled:generic:true',
          'the test push is a scheduled, generic test row the notification job picks up');
select is(private.quiet_hours_until(tests.user_id('kerem@bridge.test'), now() + interval '3 hours'), null,
          'outside the window nothing is deferred');
select tests.authenticate_as(md5('da-test-admin:root@bridge.test')::uuid, 'aal2');

-- ─── ADM-13 / ADM-18 / ADM-08 ────────────────────────────────────────────────────────────────
select is(admin_api.feedback_update((select id from bx where k = 'feedback'), 'triaged') ->> 'screen', 'M-TD-01',
          'feedback_update returns the full row');
select ok((select bool_or((v ->> 'below_minimum')::boolean)
           from jsonb_array_elements(admin_api.app_versions_breakdown('7d') -> 'versions') as v
           where v ->> 'platform' = 'ios' and v ->> 'app_version' = '1.0.0'), 'ios 1.0.0 is below the 1.1.0 minimum');
select is(admin_api.ai_model_config_update((select profile from cfg), null, (select feature from cfg), null, null, null, null, null, null,
                                           (select version from cfg), 'caching off for this feature',
                                           p_clear_cache_ttl => true) ->> 'version',
          ((select version from cfg) + 1)::text, 'a clear bumps the version');
select tests.clear_authentication();  -- table reads as the test superuser
select is((select cache_ttl from public.ai_model_config where id = (select id from cfg)), null, 'p_clear_cache_ttl clears the TTL');
select tests.authenticate_as(md5('da-test-admin:root@bridge.test')::uuid, 'aal2');

select tests.clear_authentication();
select is((select permissions from private.admin_function_permissions where function_name = 'ticket_reply'), array['support.write'],
          'ticket_reply is in the RBAC map (support.write)');

select * from finish();
rollback;
