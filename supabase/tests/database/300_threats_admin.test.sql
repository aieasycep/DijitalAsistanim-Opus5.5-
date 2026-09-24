-- pgTAP · THR-12 admin abuse (SECURITY_AND_PRIVACY_PLAN §2 THR-12, CTL-3.8; M§47–49, M§66; R-09;
-- IMPLEMENTATION_PLAN T-11.05). Complements 121_audit_admin_guard: lists are masked, a reveal needs a
-- reason and is audited with it, a Support Access grant only opens its own user's data for its own
-- admin and only while it lasts, no admin function touches provider credentials, and deleting or
-- forging an audit row is detected by the chain verification.
begin;
select plan(12);

select tests.create_user('customer@admin-threat.test');
select tests.create_user('bystander@admin-threat.test');
select tests.create_admin('helper@admin-threat.test', 'support');
select tests.create_admin('helper2@admin-threat.test', 'support');
create temporary table ax (k text primary key, id uuid) on commit drop;
grant select, insert on ax to authenticated;
insert into ax values ('bystander_account', tests.make_account(tests.user_id('bystander@admin-threat.test'), 'bystander@gmail.com'));
insert into ax values ('bystander_thread', tests.make_thread(tests.user_id('bystander@admin-threat.test'),
                                                             (select id from ax where k = 'bystander_account'), 'Özel yazışma'));

-- ─── Masking and reveal ───────────────────────────────────────────────────────────────────────
select tests.authenticate_as(md5('da-test-admin:helper@admin-threat.test')::uuid, 'aal2');
select ok(position('customer@admin-threat.test' in admin_api.users_list()::text) = 0
          and position('bystander@admin-threat.test' in admin_api.users_list()::text) = 0,
          'the user list never carries a raw e-mail address');
select ok(admin_api.users_list()::text like '%email_masked%', 'it carries the masked form instead');
select throws_ok(format($$ select admin_api.user_reveal_email(%L, '') $$, tests.user_id('customer@admin-threat.test')),
                 '22023', null, 'a reveal without a reason is refused');
select is(admin_api.user_reveal_email(tests.user_id('customer@admin-threat.test'),
                                      'Kullanıcı e-posta adresinin doğrulanmasını istedi') ->> 'value',
          'customer@admin-threat.test', 'a reasoned reveal returns the value');
select tests.clear_authentication();
select is((select count(*)::integer from public.audit_logs
           where action = 'pii.reveal' and target_user_id = tests.user_id('customer@admin-threat.test')
             and actor_id = md5('da-test-admin:helper@admin-threat.test')::uuid
             and reason = 'Kullanıcı e-posta adresinin doğrulanmasını istedi'), 1,
          'the reveal is audited with its actor and reason');

-- ─── Support Access is scoped to one user, one admin and its time box ─────────────────────────
select tests.authenticate_as(md5('da-test-admin:helper@admin-threat.test')::uuid, 'aal2');
insert into ax select 'grant', (admin_api.support_access_grant(tests.user_id('customer@admin-threat.test'), '{email_metadata,pii}',
                                                                'customer asked why a mail was flagged', 15) ->> 'id')::uuid;
select throws_ok(format($$ select admin_api.support_access_authorize(%L, 'email_metadata', 'email_thread', %L,
                                                                      'looking at the flagged thread') $$,
                        (select id from ax where k = 'grant'), (select id from ax where k = 'bystander_thread')),
                 '42501', 'SUPPORT_ACCESS_DENIED', 'a grant for one user never opens another user''s data');
select tests.clear_authentication();
select tests.authenticate_as(md5('da-test-admin:helper2@admin-threat.test')::uuid, 'aal2');
select throws_ok(format($$ select admin_api.support_access_authorize(%L, 'pii', 'user', %L, 'borrowing a colleague''s grant') $$,
                        (select id from ax where k = 'grant'), tests.user_id('customer@admin-threat.test')),
                 '42501', 'SUPPORT_ACCESS_DENIED', 'another admin cannot use the grant');
select tests.clear_authentication();
update public.support_access_grants
   set starts_at = now() - interval '2 hours', expires_at = now() - interval '105 minutes'
 where id = (select id from ax where k = 'grant');
select tests.authenticate_as(md5('da-test-admin:helper@admin-threat.test')::uuid, 'aal2');
select throws_ok(format($$ select admin_api.support_access_authorize(%L, 'pii', 'user', %L, 'still looking after the time box') $$,
                        (select id from ax where k = 'grant'), tests.user_id('customer@admin-threat.test')),
                 '42501', 'SUPPORT_ACCESS_DENIED', 'an expired grant opens nothing');
select tests.clear_authentication();

-- ─── No admin function reaches provider credentials ───────────────────────────────────────────
select is_empty(
  $$ select p.oid::regprocedure::text || ': ' || m[1] from pg_proc p,
            regexp_matches(p.prosrc, '([a-z_.()*,]+)\s+from\s+public\.oauth_credentials', 'gi') as m
     where p.pronamespace = 'admin_api'::regnamespace and m[1] <> 'max(c.key_version)'
     union all
     select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'admin_api'::regnamespace and (p.prosrc ilike '%ciphertext%' or p.prosrc ilike '%aad_hash%') $$,
  'admin_api reads only the key version of provider credentials, never token material');

-- ─── Audit chain: deletion and forgery are detected ───────────────────────────────────────────
create temporary table chain (k text primary key, seq bigint) on commit drop;
select private.audit_log_append('system', null, null, 'test.threat_one', 'test', 'a', null, null, 'success', '{}', null);
select private.audit_log_append('system', null, null, 'test.threat_two', 'test', 'b', null, null, 'success', '{}', null);
select private.audit_log_append('system', null, null, 'test.threat_three', 'test', 'c', null, null, 'success', '{}', null);
insert into chain
select case action when 'test.threat_one' then 'a' when 'test.threat_two' then 'b' else 'c' end, chain_seq
from public.audit_logs where action in ('test.threat_one', 'test.threat_two', 'test.threat_three');
select results_eq($$ select ok from private.audit_verify_chain((select seq from chain where k = 'a')) $$, array[true],
                  'the fresh chain verifies');
alter table public.audit_logs disable trigger trg_audit_logs_immutable;
delete from public.audit_logs where chain_seq = (select seq from chain where k = 'b');
alter table public.audit_logs enable trigger trg_audit_logs_immutable;
select results_eq($$ select ok, first_bad_seq from private.audit_verify_chain((select seq from chain where k = 'a')) $$,
                  $$ select false, seq from chain where k = 'b' $$,
                  'a deleted row breaks the chain at its sequence number');
-- A forged row with the right sequence number and prev_hash but made-up content and hash.
insert into public.audit_logs (chain_seq, actor_type, action, result, details, prev_hash, row_hash)
select c.seq, 'system', 'test.threat_two', 'success', '{"forged": true}',
       (select row_hash from public.audit_logs where chain_seq = (select seq from chain where k = 'a')),
       sha256('forged'::bytea)
from chain c where c.k = 'b';
select results_eq($$ select ok, first_bad_seq from private.audit_verify_chain((select seq from chain where k = 'a')) $$,
                  $$ select false, seq from chain where k = 'b' $$,
                  'a forged replacement row does not verify');

select * from finish();
rollback;
