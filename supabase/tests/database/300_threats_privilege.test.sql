-- pgTAP · THR-06 privilege escalation, attacked as a signed-in app user (SECURITY_AND_PRIVACY_PLAN
-- §2 THR-06, CTL-3.4, CTL-3.8; IMPLEMENTATION_PLAN T-11.05). The catalogue-level invariants live in
-- 002_global_invariants and 150_column_grants; here the concrete escalation attempts fail.
begin;
select plan(19);

select tests.create_user('mallory@threats.test');
select tests.create_user('victim@threats.test');
select tests.create_admin('ops@threats.test', 'operations');
create temporary table px (k text primary key, id uuid) on commit drop;
grant select on px to authenticated;
insert into px values ('approval', tests.make_approval(tests.user_id('mallory@threats.test')));

-- ─── Entitlements, approvals, credits and audit are never client-writable ────────────────────
select tests.authenticate_as(tests.user_id('mallory@threats.test'), 'aal2');
select throws_ok($$ insert into public.subscriptions (user_id, rc_app_user_id, is_active, status)
                    values (auth.uid(), auth.uid()::text, true, 'active') $$,
                 '42501', null, 'a user cannot insert an active subscription');
select throws_ok($$ update public.subscriptions set is_active = true where user_id = auth.uid() $$,
                 '42501', null, 'a user cannot flip is_active');
select throws_ok($$ insert into public.entitlement_grants (user_id, source, starts_at, ends_at, duration_days, reason, idempotency_key)
                    values (auth.uid(), 'admin', now(), now() + interval '3650 days', 3650, 'self granted pro forever', 'x') $$,
                 '42501', null, 'a user cannot grant themselves Pro');
select throws_ok($$ insert into public.referral_credits (referral_id, user_id, side, idempotency_key)
                    values (gen_random_uuid(), auth.uid(), 'referee', 'x') $$,
                 '42501', null, 'a user cannot mint referral credits');
select throws_ok($$ update public.approval_actions set status = 'approved' where id = (select id from px where k = 'approval') $$,
                 '42501', null, 'a user cannot approve by updating the row');
select throws_ok($$ select public.transition_approval((select id from px where k = 'approval'), 'approved', 'user', auth.uid(),
                                                      'guess', null, null, null, null, 'approval_center') $$,
                 '42501', null, 'the service-role transition wrapper is not callable by users');
select throws_ok($$ insert into public.audit_logs (chain_seq, actor_type, action, result, row_hash)
                    values (999999, 'user', 'test.forged_entry', 'success', '\x00') $$,
                 '42501', null, 'a user cannot write the audit log');
select throws_ok($$ update public.profiles set state = 'active', is_internal = true where user_id = auth.uid() $$,
                 '42501', null, 'a user cannot mark themselves internal');

-- ─── private schema and admin_api are closed to app users, even at aal2 ────────────────────────
select throws_ok($$ select private.grant_entitlement(auth.uid(), 'admin', 30::smallint, 'self grant attempt', null, 'x') $$,
                 '42501', null, 'private functions are not executable by users');
select throws_ok($$ select public.grant_entitlement(auth.uid(), 'admin', 30::smallint, 'self grant attempt', null, 'x') $$,
                 '42501', null, 'the service-role grant wrapper is not executable by users');
select throws_ok($$ select admin_api.users_list() $$, '42501', null, 'admin_api refuses an app user at aal2');
select throws_ok($$ select admin_api.user_reveal_email(auth.uid(), 'I want to see my victim''s address') $$,
                 '42501', null, 'an app user cannot reveal PII');
select tests.clear_authentication();

-- ─── admin_role is sourced only from admin_users, never from user-editable metadata ────────────
update auth.users
   set raw_user_meta_data = '{"admin_role": "super_admin", "da_kind": "admin"}'::jsonb
 where id = tests.user_id('mallory@threats.test');
select is(private.custom_access_token_hook(jsonb_build_object(
            'user_id', tests.user_id('mallory@threats.test'),
            'claims', jsonb_build_object('role', 'authenticated', 'admin_role', 'super_admin'))) #>> '{claims,admin_role}',
          null, 'a forged admin_role claim is stripped for a user who only edited user_metadata');
select is(private.custom_access_token_hook(jsonb_build_object(
            'user_id', md5('da-test-admin:ops@threats.test')::uuid, 'claims', '{}'::jsonb)) #>> '{claims,admin_role}',
          'operations', 'a real admin gets its role from admin_users');

-- ─── RBAC in SQL: a real admin without the permission, or at aal1, is refused ─────────────────
select tests.authenticate_as(md5('da-test-admin:ops@threats.test')::uuid, 'aal2');
select throws_ok(format($$ select admin_api.user_reveal_email(%L, 'operations peeking at an address') $$,
                        tests.user_id('victim@threats.test')),
                 '42501', null, 'operations has no users.pii.reveal');
select tests.clear_authentication();
select tests.authenticate_as(md5('da-test-admin:ops@threats.test')::uuid, 'aal1');
select throws_ok($$ select admin_api.users_list() $$, '42501', null, 'an aal1 admin session is refused');
select tests.clear_authentication();

-- ─── Definer functions cannot be hijacked through search_path ─────────────────────────────────
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.prosecdef and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'admin_api'::regnamespace)
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'every security definer function pins its search_path');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE') and not has_schema_privilege('anon', 'private', 'USAGE'),
          'client roles cannot even resolve names in the private schema');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.prosecdef and p.pronamespace = 'private'::regnamespace
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')) $$,
  'no private security definer function is executable by client roles');

select * from finish();
rollback;
