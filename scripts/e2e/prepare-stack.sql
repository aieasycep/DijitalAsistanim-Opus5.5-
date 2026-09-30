-- E2E stack preparation (TEST_PLAN §9.1): the harness drives the scheduler with `POST /tick`, so
-- the pg_cron jobs of DATABASE_AND_RLS_PLAN §9 (`da_*`) are unscheduled on the local stack. Never
-- run against a hosted project: scripts/e2e/start-stack.sh only targets the loopback database.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname like 'da\_%';
  end if;
end
$$;
