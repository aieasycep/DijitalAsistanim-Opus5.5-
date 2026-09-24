-- Migration 0017 · service-role wrappers for Edge Functions
-- PostgREST exposes only `public` and `admin_api`, so every `private` function the Edge Functions
-- call needs a `public` wrapper that only service_role may execute (DATABASE_AND_RLS_PLAN §6).
-- The `health` function's audit-chain probe (T-3.07) verifies the tail of the hash chain.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

create function public.audit_verify_chain(p_from bigint default 1, p_to bigint default null)
  returns table (ok boolean, checked bigint, first_bad_seq bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$ select * from private.audit_verify_chain(p_from, p_to) $$;

comment on function public.audit_verify_chain(bigint, bigint) is
  'Service-role wrapper around private.audit_verify_chain for the health audit-chain probe.';

revoke execute on function public.audit_verify_chain(bigint, bigint) from public, anon, authenticated;
grant execute on function public.audit_verify_chain(bigint, bigint) to service_role;
