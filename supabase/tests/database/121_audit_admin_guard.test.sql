-- pgTAP · audit log immutability and hash chain, last-super-admin guard, Support Access (R-09)
-- (DATABASE_AND_RLS_PLAN §3.6, §6.7, §6.8; §13.2 121, 122, 123).
begin;
select plan(26);

-- ─── Audit chain ─────────────────────────────────────────────────────────────────────────────
select private.audit_log_append('system', null, null, 'test.chain_one', 'test', 'a', null, null, 'success', '{"n": 1}', null);
select private.audit_log_append('system', null, null, 'test.chain_two', 'test', 'b', null, null, 'success', '{"n": 2}', null);
select private.audit_log_append('system', null, null, 'test.chain_three', 'test', 'c', null, null, 'success', '{"n": 3}', null);
select results_eq($$ select ok from private.audit_verify_chain() $$, array[true], 'the chain verifies');
select is((select max(chain_seq) - min(chain_seq) + 1 from public.audit_logs), (select count(*) from public.audit_logs),
          'chain_seq is contiguous');
select ok((select bool_and(a.prev_hash = b.row_hash) from public.audit_logs a join public.audit_logs b on b.chain_seq = a.chain_seq - 1),
          'every row links to its predecessor');
select throws_ok($$ update public.audit_logs set reason = 'x' $$, '55000', 'AUDIT_IMMUTABLE', 'update raises even for the owner');
select throws_ok($$ delete from public.audit_logs $$, '55000', 'AUDIT_IMMUTABLE', 'delete raises even for the owner');
select throws_ok($$ truncate public.audit_logs $$, '55000', 'AUDIT_IMMUTABLE', 'truncate raises');
select tests.as_service_role();
select throws_ok($$ update public.audit_logs set reason = 'x' $$, '42501', null, 'service_role has no update privilege');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'service_role has no delete privilege');
select tests.clear_authentication();
select tests.create_user('audit@guard.test');
select tests.authenticate_as(tests.user_id('audit@guard.test'), 'aal2');
select throws_ok($$ select count(*) from public.audit_logs $$, '42501', null, 'users cannot read the audit log');
select tests.clear_authentication();
alter table public.audit_logs disable trigger trg_audit_logs_immutable;
update public.audit_logs set details = '{"n": 99}' where action = 'test.chain_two';
alter table public.audit_logs enable trigger trg_audit_logs_immutable;
select results_eq($$ select ok, first_bad_seq from private.audit_verify_chain() $$,
                  $$ select false, chain_seq from public.audit_logs where action = 'test.chain_two' $$,
                  'superuser tampering is detected at the tampered row');

-- ─── Last super admin (§6.8) ─────────────────────────────────────────────────────────────────
select tests.create_admin('only.root@guard.test', 'super_admin');
delete from public.admin_sessions;
update public.admin_users set status = 'disabled' where role = 'super_admin' and user_id <> md5('da-test-admin:only.root@guard.test')::uuid;
select throws_ok($$ update public.admin_users set role = 'operations' where email = 'only.root@guard.test' $$, '55000', 'LAST_SUPER_ADMIN',
                 'the last active super_admin cannot be demoted');
select throws_ok($$ update public.admin_users set status = 'disabled' where email = 'only.root@guard.test' $$, '55000', 'LAST_SUPER_ADMIN',
                 'nor disabled');
select throws_ok($$ delete from public.admin_users where email = 'only.root@guard.test' $$, '55000', 'LAST_SUPER_ADMIN', 'nor deleted');
select tests.create_admin('second.root@guard.test', 'super_admin');
select lives_ok($$ update public.admin_users set role = 'operations' where email = 'only.root@guard.test' $$,
                'with two active super_admins one can be demoted');
select throws_ok($$ delete from public.admin_users where email = 'only.root@guard.test' $$, '55000', 'ADMINS_NEVER_DELETED',
                 'admins are never deleted');
select throws_ok($$ update public.admin_users set mfa_required = false where email = 'second.root@guard.test' $$, '23514', null,
                 'mfa_required cannot be switched off');

-- ─── Support Access (R-09) ───────────────────────────────────────────────────────────────────
select tests.create_admin('helper@guard.test', 'support');
select tests.create_admin('money@guard.test', 'finance');
create temporary table sa (k text primary key, id uuid) on commit drop;
grant select, insert on sa to authenticated;
select tests.authenticate_as(md5('da-test-admin:helper@guard.test')::uuid, 'aal2');
select throws_ok(format($$ select admin_api.support_access_grant(%L, '{insights}', 'user asked about a missing insight', 20) $$,
                        tests.user_id('audit@guard.test')),
                 '22023', 'VALIDATION_FAILED:minutes', 'a 20-minute grant is rejected (15/30/60 only)');
select throws_ok(format($$ select admin_api.support_access_grant(%L, '{insights}', 'too short why', 15) $$, tests.user_id('audit@guard.test')),
                 '22023', 'VALIDATION_FAILED:reason', 'a reason under 15 characters is rejected');
select throws_ok($$ select '{mail_original_view}'::public.support_access_scope[] $$, '22P02', null,
                 'original mail is not a grantable scope');
insert into sa select 'grant', (admin_api.support_access_grant(tests.user_id('audit@guard.test'), '{pii,insights}',
                                                                'user asked about a missing insight', 15) ->> 'id')::uuid;
select is((admin_api.support_access_authorize((select id from sa where k = 'grant'), 'pii', 'user', tests.user_id('audit@guard.test'),
                                              'verify the account email with the user') -> 'value' ->> 'email'),
          'audit@guard.test', 'an authorized pii reveal returns the stored field');
select throws_ok(format($$ select admin_api.support_access_authorize(%L, 'captures', 'capture', gen_random_uuid(), 'look at the capture fields') $$,
                        (select id from sa where k = 'grant')),
                 '42501', 'SUPPORT_ACCESS_DENIED', 'a scope outside the grant is denied');
select lives_ok(format($$ select admin_api.support_access_revoke(%L, 'investigation finished') $$, (select id from sa where k = 'grant')),
                'grant revoked');
select throws_ok(format($$ select admin_api.support_access_authorize(%L, 'pii', 'user', %L, 'verify the account email again') $$,
                        (select id from sa where k = 'grant'), tests.user_id('audit@guard.test')),
                 '42501', 'SUPPORT_ACCESS_DENIED', 'a revoked grant is denied');
select tests.clear_authentication();
select is((select reveal_count from public.support_access_grants where id = (select id from sa where k = 'grant')), 1,
          'reveal_count counts the reveal');
select ok(exists (select 1 from public.audit_logs where action = 'pii.reveal' and target_user_id = tests.user_id('audit@guard.test')),
          'the reveal is audited as pii.reveal');
select tests.authenticate_as(md5('da-test-admin:money@guard.test')::uuid, 'aal2');
select throws_ok(format($$ select admin_api.support_access_grant(%L, '{insights}', 'finance should not have this', 15) $$,
                        tests.user_id('audit@guard.test')),
                 '42501', 'ADMIN_FORBIDDEN', 'finance cannot grant Support Access');
select tests.clear_authentication();

select * from finish();
rollback;
