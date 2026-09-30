-- Migration 0015 · pg_cron schedules
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §9 (UTC; exactly eight da_* jobs, within Supabase's
-- 8-concurrent limit; each runs in well under a second), ADR-04 (pg_cron → pg_net → worker).
-- Idempotent: existing da_* jobs are unscheduled first. Skipped entirely when pg_cron is absent.
-- pg_net may be absent (tier C): private.poke_worker returns NULL without it, and the
-- housekeeping job only touches net._http_response when that table exists.

-- Each migration runs in one transaction; never wait long on a lock held by live traffic.
set local lock_timeout = '10s';
set local statement_timeout = '10min';

do $$
declare
  v_job record;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed: no da_* schedules created';
    return;
  end if;

  for v_job in execute $q$select jobname from cron.job where jobname like 'da\_%'$q$ loop
    perform cron.unschedule(v_job.jobname);
  end loop;

  perform cron.schedule('da_scheduler_tick', '* * * * *', $cmd$select private.scheduler_tick();$cmd$);
  perform cron.schedule('da_worker_poke', '15 seconds', $cmd$select private.poke_worker('cron');$cmd$);
  perform cron.schedule('da_push_receipts', '*/5 * * * *',
    $cmd$select public.enqueue_job('push_receipts', 'push_receipts:' || to_char(date_trunc('minute', now() at time zone 'UTC') - make_interval(mins => extract(minute from now() at time zone 'UTC')::integer % 5), 'YYYYMMDDHH24MI'));$cmd$);
  perform cron.schedule('da_health_check', '*/5 * * * *',
    $cmd$select public.enqueue_job('health_check', 'health:' || to_char(date_trunc('minute', now() at time zone 'UTC') - make_interval(mins => extract(minute from now() at time zone 'UTC')::integer % 5), 'YYYYMMDDHH24MI'));$cmd$);
  perform cron.schedule('da_reconciliation', '7 */6 * * *', $cmd$select private.enqueue_reconciliation();$cmd$);
  perform cron.schedule('da_retention', '30 2 * * *',
    $cmd$select public.enqueue_job('retention', 'retention:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'));$cmd$);
  perform cron.schedule('da_billing_reconcile', '45 3 * * *', $cmd$select private.enqueue_billing_reconcile();$cmd$);
  perform cron.schedule('da_cron_housekeeping', '15 3 * * *',
    $cmd$delete from cron.job_run_details where end_time < now() - interval '7 days';
do $h$ begin
  if to_regclass('net._http_response') is not null then
    execute $x$delete from net._http_response where created < now() - interval '1 day'$x$;
  end if;
end $h$;$cmd$);
end
$$;
