-- pgTAP · admin RBAC, table-driven over private.admin_function_permissions (every admin_api
-- function × non-admin, missing gateway, aal1, disabled admin, forbidden role, permitted role),
-- plus session limits, masking, reasons, the token hook and the identity trigger
-- (DATABASE_AND_RLS_PLAN §6.8, §6.10, §13.2 120; BACKOFFICE_PLAN §4).
begin;
select plan(22);

select tests.create_admin(r::text || '@rbac.test', r) from unnest(enum_range(null::public.admin_role)) as r;
select tests.create_admin('disabled@rbac.test', 'super_admin', 'disabled');
select tests.create_user('app@rbac.test');
update auth.users set email = 'yunus.emre@gmail.com' where id = tests.user_id('app@rbac.test');

create temporary table rbac (function_name text, scenario text, expected text, actual text) on commit drop;

-- Calls admin_api.<fn> with typed NULL arguments and returns the error text, or DA_TEST_OK when
-- the call succeeded (it is then rolled back, so no scenario leaves side effects).
create function pg_temp.call_admin(p_fn text) returns text
  language plpgsql
  as $$
declare
  v_sql text;
  v_err text;
begin
  select format('select admin_api.%I(%s)', p.proname,
                coalesce((select string_agg(format('null::%s', format_type(u.t, null)), ', ' order by u.ord)
                          from unnest(p.proargtypes) with ordinality as u (t, ord)), ''))
  into v_sql
  from pg_catalog.pg_proc p where p.pronamespace = 'admin_api'::regnamespace and p.proname = p_fn;
  begin
    execute v_sql;
    raise exception 'DA_TEST_OK';
  exception when others then
    v_err := sqlerrm;
  end;
  return v_err;
end
$$;

-- A role that holds the function's permission(s) and one that does not (NULL when every role does).
create function pg_temp.permitted_role(p_perms text[], p_all boolean) returns public.admin_role
  language sql
  as $$
    select r from unnest(enum_range(null::public.admin_role)) as r
    where p_perms is null
       or (not p_all and exists (select 1 from private.admin_role_permissions x where x.role = r and x.permission = any(p_perms)))
       or (p_all and not exists (select 1 from unnest(p_perms) as q (perm)
                                 where not exists (select 1 from private.admin_role_permissions x where x.role = r and x.permission = q.perm)))
    order by r desc limit 1
  $$;
create function pg_temp.forbidden_role(p_perms text[], p_all boolean) returns public.admin_role
  language sql
  as $$
    select r from unnest(enum_range(null::public.admin_role)) as r
    where p_perms is not null
      and ((not p_all and not exists (select 1 from private.admin_role_permissions x where x.role = r and x.permission = any(p_perms)))
           or (p_all and exists (select 1 from unnest(p_perms) as q (perm)
                                 where not exists (select 1 from private.admin_role_permissions x where x.role = r and x.permission = q.perm))))
    order by r desc limit 1
  $$;

do $$
declare
  f record;
  v_role public.admin_role;
  v_actual text;
begin
  for f in select * from private.admin_function_permissions order by function_name loop
    if f.guard = 'service_role' then
      perform tests.authenticate_as(md5('da-test-admin:super_admin@rbac.test')::uuid, 'aal2');
      v_actual := pg_temp.call_admin(f.function_name);
      perform tests.clear_authentication();
      insert into rbac values (f.function_name, 'authenticated on a service_role function', 'permission denied', v_actual);
      continue;
    end if;

    perform tests.authenticate_as(tests.user_id('app@rbac.test'), 'aal2');
    v_actual := pg_temp.call_admin(f.function_name);
    perform tests.clear_authentication();
    insert into rbac values (f.function_name, 'app user', case when f.guard = 'gateway' then 'passes' else 'ADMIN_REQUIRED' end, v_actual);

    perform tests.authenticate_as(md5('da-test-admin:super_admin@rbac.test')::uuid, 'aal2');
    perform set_config('request.headers', '{}', true);
    v_actual := pg_temp.call_admin(f.function_name);
    perform tests.clear_authentication();
    insert into rbac values (f.function_name, 'no gateway header', 'ADMIN_GATEWAY_REQUIRED', v_actual);

    perform tests.authenticate_as(md5('da-test-admin:super_admin@rbac.test')::uuid, 'aal1');
    v_actual := pg_temp.call_admin(f.function_name);
    perform tests.clear_authentication();
    insert into rbac values (f.function_name, 'aal1 admin', case when f.guard in ('aal1', 'gateway') then 'passes' else 'ADMIN_AAL2_REQUIRED' end,
                             v_actual);

    perform tests.authenticate_as(md5('da-test-admin:disabled@rbac.test')::uuid, 'aal2');
    v_actual := pg_temp.call_admin(f.function_name);
    perform tests.clear_authentication();
    insert into rbac values (f.function_name, 'disabled admin', case when f.guard = 'gateway' then 'passes' else 'ADMIN_REQUIRED' end,
                             v_actual);

    v_role := pg_temp.forbidden_role(f.permissions, f.all_permissions);
    if v_role is not null then
      perform tests.authenticate_as(md5('da-test-admin:' || v_role || '@rbac.test')::uuid, 'aal2');
      v_actual := pg_temp.call_admin(f.function_name);
      perform tests.clear_authentication();
      insert into rbac values (f.function_name, 'forbidden role ' || v_role, 'ADMIN_FORBIDDEN', v_actual);
    end if;

    v_role := pg_temp.permitted_role(f.permissions, f.all_permissions);
    perform tests.authenticate_as(md5('da-test-admin:' || v_role || '@rbac.test')::uuid, 'aal2');
    v_actual := pg_temp.call_admin(f.function_name);
    perform tests.clear_authentication();
    insert into rbac values (f.function_name, 'permitted role ' || v_role, 'passes', v_actual);
  end loop;
end
$$;

create function pg_temp.is_guard_error(p text) returns boolean
  language sql immutable
  as $$ select p in ('ADMIN_REQUIRED', 'ADMIN_AAL2_REQUIRED', 'ADMIN_FORBIDDEN', 'ADMIN_SESSION_EXPIRED', 'ADMIN_GATEWAY_REQUIRED',
                     'ADMIN_LOCKED') or p like 'permission denied%' $$;

select is((select count(distinct function_name)::integer from rbac), (select count(*)::integer from private.admin_function_permissions),
          'every mapped admin_api function was exercised');
select is_empty($$ select function_name || ': ' || actual from rbac where scenario = 'app user'
                   and ((expected = 'passes' and pg_temp.is_guard_error(actual)) or (expected <> 'passes' and actual <> expected)) $$,
                'a non-admin JWT gets ADMIN_REQUIRED everywhere (auth_status answers is_admin=false)');
select is_empty($$ select function_name || ': ' || actual from rbac where scenario = 'no gateway header' and actual <> expected $$,
                'a call without the admin-api gateway header gets ADMIN_GATEWAY_REQUIRED everywhere');
select is_empty($$ select function_name || ': ' || actual from rbac where scenario = 'aal1 admin'
                   and ((expected = 'passes' and pg_temp.is_guard_error(actual)) or (expected <> 'passes' and actual <> expected)) $$,
                'aal1 admins get ADMIN_AAL2_REQUIRED except on the aal1 sign-in functions');
select is_empty($$ select function_name || ': ' || actual from rbac where scenario = 'disabled admin'
                   and ((expected = 'passes' and pg_temp.is_guard_error(actual)) or (expected <> 'passes' and actual <> expected)) $$,
                'a disabled admin gets ADMIN_REQUIRED everywhere (auth_status reports the status)');
select is_empty($$ select function_name || ' (' || scenario || '): ' || actual from rbac where scenario like 'forbidden role%' and actual <> expected $$,
                'roles lacking the permission get ADMIN_FORBIDDEN');
select isnt_empty($$ select 1 from rbac where scenario like 'forbidden role%' $$, 'the forbidden-role scenario covered functions');
select is_empty($$ select function_name || ' (' || scenario || '): ' || actual from rbac where scenario like 'permitted role%'
                   and pg_temp.is_guard_error(actual) $$,
                'permitted roles pass the guard on every function');
select is_empty($$ select function_name || ' (' || scenario || '): ' || actual from rbac where scenario like 'permitted role%'
                   and not (actual = 'DA_TEST_OK' or actual in ('NOT_FOUND', 'STATE_CONFLICT', 'FORBIDDEN', 'INVITE_INVALID', 'RECOVERY_CODE_INVALID', 'RATE_LIMITED')
                            or actual like 'VALIDATION_FAILED:%') $$,
                'with NULL arguments every permitted call either succeeds or fails with a contract error code');
select is_empty($$ select function_name || ': ' || actual from rbac where scenario like 'authenticated on a service_role%'
                   and actual not like 'permission denied%' $$,
                'service_role-only functions are not executable with a user JWT');

-- ─── Session limits ──────────────────────────────────────────────────────────────────────────
update public.admin_sessions set last_activity_at = now() - interval '31 minutes', idle_expires_at = now() - interval '1 minute'
where admin_user_id = md5('da-test-admin:readonly@rbac.test')::uuid;
select tests.authenticate_as(md5('da-test-admin:readonly@rbac.test')::uuid, 'aal2');
select throws_ok($$ select admin_api.admin_me() $$, '42501', 'ADMIN_SESSION_EXPIRED', 'idle-expired session → ADMIN_SESSION_EXPIRED');
select is(admin_api.session_expire() ->> 'end_reason', 'idle_timeout', 'session_expire persists the idle end');
select tests.clear_authentication();
update public.admin_sessions set created_at = now() - interval '13 hours', absolute_expires_at = now() - interval '1 hour'
where admin_user_id = md5('da-test-admin:analyst@rbac.test')::uuid;
select tests.authenticate_as(md5('da-test-admin:analyst@rbac.test')::uuid, 'aal2');
select throws_ok($$ select admin_api.dashboard_metrics('7d') $$, '42501', 'ADMIN_SESSION_EXPIRED', 'absolute-expired session → ADMIN_SESSION_EXPIRED');
select tests.clear_authentication();

-- ─── Masking, reasons, denial audit, palette ─────────────────────────────────────────────────
select tests.authenticate_as(md5('da-test-admin:support@rbac.test')::uuid, 'aal2');
select ok((select bool_and(r ->> 'email_masked' ~ '^.{1,2}\*\*\*@') from jsonb_array_elements(admin_api.users_list() -> 'rows') as r),
          'users_list returns masked emails');
select throws_ok(format($$ select admin_api.user_force_sync(%L, null, 'short') $$, tests.user_id('app@rbac.test')), '22023',
                 'VALIDATION_FAILED:reason', 'a mutation with a too-short reason is rejected');
select ok(admin_api.audit_denied('/api/admin/flags', 'flags.write') > 0, 'audit_denied appends a denial row');
select tests.clear_authentication();
select is((select result from public.audit_logs where action = 'admin.permission_denied' order by chain_seq desc limit 1), 'denied',
          'with result denied');
select tests.authenticate_as(md5('da-test-admin:super_admin@rbac.test')::uuid, 'aal2');
select is(jsonb_array_length(admin_api.command_search('teklif') -> 'results'), 0, 'command_search never matches free text (no content search)');
select is(jsonb_array_length(admin_api.command_search('yunus.emre@gmail.com') -> 'results'), 1, 'command_search finds an exact email');
select tests.clear_authentication();

-- ─── Token hook and identity trigger (R-08) ──────────────────────────────────────────────────
select is(private.custom_access_token_hook(jsonb_build_object('user_id', md5('da-test-admin:finance@rbac.test')::uuid, 'claims', '{}'::jsonb))
          -> 'claims' ->> 'admin_role', 'finance', 'the token hook adds admin_role for an active admin');
select is(private.custom_access_token_hook(jsonb_build_object('user_id', md5('da-test-admin:disabled@rbac.test')::uuid,
                                                              'claims', '{"admin_role": "super_admin"}'::jsonb))
          -> 'claims' ->> 'admin_role', null, 'and strips it for a disabled admin');
select throws_ok($$ insert into public.admin_users (user_id, role, display_name, email)
                    values (tests.user_id('app@rbac.test'), 'readonly', 'App', 'app@rbac.test') $$,
                 '23514', 'EMAIL_IN_USE_BY_APP_USER', 'an app user can never become an admin');

select * from finish();
rollback;
