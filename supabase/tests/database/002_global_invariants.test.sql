-- pgTAP · global RLS and privilege invariants (DATABASE_AND_RLS_PLAN §13.1, T-2.22).
begin;
select plan(18);

select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and not (c.relrowsecurity and c.relforcerowsecurity) $$,
  'every public table has RLS enabled and forced'
);
select is(
  (select count(*)::integer from pg_policies where schemaname in ('public', 'storage') and 'anon' = any(roles)),
  0, 'no policy targets anon'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
  0, 'anon holds no table privilege in public'
);
select is(
  (select count(*)::integer from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public'),
  0, 'anon holds no column privilege in public'
);
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'admin_api'::regnamespace, 'private'::regnamespace)
       and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon cannot execute any public, admin_api or private function'
);
select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
       and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('authenticated', c.oid, 'usage')) $$,
  'client roles cannot use any public sequence'
);
select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped)
       and c.relname not in ('plan_limits', 'feature_flags', 'announcements', 'prompt_versions', 'ai_model_config',
                             'system_health_checks', 'rate_limits', 'audit_logs', 'admin_users', 'admin_sessions',
                             'admin_preferences', 'billing_events', 'webhook_events', 'referrals', 'referral_codes', 'jobs',
                             'job_attempts', 'analytics_events', 'ai_requests', 'support_tickets', 'support_notes',
                             'feature_flag_overrides', 'ai_model_prices', 'ai_calibration_versions', 'ai_batches',
                             'app_settings', 'metrics_daily', 'ai_metrics_daily', 'web_analytics_daily',
                             'privacy_tombstones', 'admin_mfa_recovery_codes') $$,
  'every table outside the allowlist has a user_id column'
);

-- SYS tables: no permissive policy for authenticated and no select privilege.
select is_empty(
  $$ select t from unnest(array[
       'oauth_credentials', 'oauth_states', 'provider_quota_usage', 'webhook_events', 'ai_requests', 'ai_model_config',
       'prompt_versions', 'ai_result_cache', 'ai_budget_reservations', 'ai_model_prices', 'ai_calibration_versions',
       'ai_batches', 'push_tickets', 'billing_events', 'referrals', 'jobs', 'job_attempts', 'analytics_events',
       'feature_flags', 'feature_flag_overrides', 'announcements', 'user_feedback', 'system_health_checks', 'rate_limits',
       'api_idempotency_keys', 'app_settings', 'metrics_daily', 'ai_metrics_daily', 'web_analytics_daily',
       'privacy_tombstones', 'admin_users', 'admin_sessions', 'admin_preferences', 'admin_mfa_recovery_codes',
       'audit_logs', 'support_notes', 'support_access_grants']) as t
     where has_table_privilege('authenticated', 'public.' || t, 'select')
        or has_table_privilege('authenticated', 'public.' || t, 'insert')
        or has_table_privilege('authenticated', 'public.' || t, 'update')
        or has_table_privilege('authenticated', 'public.' || t, 'delete')
        or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                   and p.permissive = 'PERMISSIVE' and ('authenticated' = any(p.roles) or 'public' = any(p.roles))) $$,
  'SYS tables have no client privilege and no permissive policy'
);
select is_empty(
  $$ select t from unnest(array[
       'ai_model_config', 'prompt_versions', 'ai_model_prices', 'ai_calibration_versions', 'billing_events', 'jobs',
       'system_health_checks', 'app_settings', 'metrics_daily', 'ai_metrics_daily', 'admin_users', 'admin_sessions',
       'admin_mfa_recovery_codes', 'audit_logs', 'support_notes', 'support_access_grants']) as t
     where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                       and p.policyname = t || '_admin_aal2' and p.permissive = 'RESTRICTIVE') $$,
  'every admin-only table carries the restrictive *_admin_aal2 policy'
);
select is_empty(
  $$ select p.tablename || '.' || p.policyname from pg_policies p
     where p.schemaname = 'public' and p.permissive = 'PERMISSIVE' and p.policyname <> 'plan_limits_select_all'
       and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%auth.uid()%' $$,
  'every permissive policy (except plan_limits_select_all) is scoped to auth.uid()'
);
select is_empty(
  $$ select p.tablename || '.' || p.policyname from pg_policies p
     where p.schemaname = 'public' and not (p.roles = array['authenticated']::name[]) $$,
  'every public policy targets authenticated only'
);
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc p join pg_roles r on r.oid = p.proowner
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'admin_api'::regnamespace) and p.prosecdef
       and (not coalesce(p.proconfig @> array['search_path=""'], false) or not (r.rolsuper or r.rolbypassrls)) $$,
  'security definer functions pin search_path and have a superuser / bypassrls owner'
);
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')) $$,
  'no public function is executable by PUBLIC'
);
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'admin_api'::regnamespace
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')) $$,
  'no admin_api function is executable by PUBLIC'
);
select results_eq(
  $$ select format_type(a.atttypid, a.atttypmod) from pg_attribute a
     where a.attrelid = 'public.memory_chunks'::regclass and a.attname in ('embedding', 'embedding_dr') order by a.attname $$,
  $$ values ('vector(1024)'), ('vector(1024)') $$,
  'memory_chunks embeddings are vector(1024) (R-01)'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'memory_chunks'
          and indexname = 'memory_chunks_embedding_hnsw' and indexdef like '%hnsw%vector_cosine_ops%'),
  'memory_chunks_embedding_hnsw uses vector_cosine_ops'
);
select is(
  (select count(*)::integer from pg_publication_tables where pubname = 'supabase_realtime'),
  0, 'supabase_realtime publishes no table (R-19)'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'ai_model_config_covered_model_check'),
  'ai_model_config carries the Covered-Model check (ADR-44)'
);

select * from finish();
rollback;
