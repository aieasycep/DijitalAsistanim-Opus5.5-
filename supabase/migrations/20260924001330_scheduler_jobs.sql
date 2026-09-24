-- Migration 0013d · job queue API, rate limits, service wrappers, scheduler tick and rollups
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §6.2 (jobs), §6.3 (scheduler_tick), §6.5 (rate_limit_hit),
-- §6.6 (transition_approval wrapper), §7.6 of BACKOFFICE_PLAN (rollups), §9 helpers
-- (enqueue_reconciliation, enqueue_billing_reconcile); API_CONTRACTS §11.2 (coalescing keys).
-- Edge Functions reach the database through PostgREST, which exposes only `public` and
-- `admin_api`, so every worker-side private helper has a thin security-definer wrapper here that
-- only service_role may execute (Supabase's default privileges on `public` are revoked per function).

-- Each migration runs in one transaction; never wait long on a lock held by live traffic.
set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Job queue (ADR-04) ═══════════════════════════════════════════════════════════════════════

create function public.enqueue_job(
  p_type public.job_type, p_idempotency_key text, p_payload jsonb default '{}'::jsonb, p_user_id uuid default null,
  p_account_id uuid default null, p_run_after timestamptz default now(), p_priority smallint default 100,
  p_max_attempts integer default 5, p_correlation_id uuid default null
) returns uuid
  language sql
  security definer
  set search_path = ''
  as $$
    select private.enqueue_job(p_type, p_idempotency_key, p_payload, p_user_id, p_account_id, p_run_after, p_priority,
                               p_max_attempts, p_correlation_id)
  $$;

-- Claims due jobs with FOR UPDATE SKIP LOCKED (two runners never claim the same row), leases them,
-- opens one job_attempts row each and renames a coalescing key `…:pending` to `…:pending:{id}` so
-- a new job with the same key can queue while this one runs (API_CONTRACTS §11.2).
create function public.claim_jobs(
  p_worker_id text, p_types public.job_type[] default null, p_limit integer default 10, p_lease_seconds integer default 120
) returns setof public.jobs
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if p_worker_id is null or char_length(p_worker_id) = 0 then
    raise exception 'VALIDATION_FAILED:worker_id' using errcode = '22023';
  end if;
  return query
  with c as (
    select j.id from public.jobs j
    where j.status in ('queued', 'retrying') and j.run_after <= now()
      and (p_types is null or j.type = any(p_types))
    order by j.priority, j.run_after
    limit least(greatest(coalesce(p_limit, 10), 1), 100)
    for update skip locked),
  claimed as (
    update public.jobs j
      set status = 'running', attempts = j.attempts + 1, lease_owner = p_worker_id,
          lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 5), 3600)),
          started_at = coalesce(j.started_at, now()),
          idempotency_key = case when j.idempotency_key like '%:pending' then j.idempotency_key || ':' || j.id
                                 else j.idempotency_key end
    from c where j.id = c.id
    returning j.*),
  attempts as (
    insert into public.job_attempts (job_id, attempt, user_id, worker_id, started_at)
    select claimed.id, claimed.attempts, claimed.user_id, p_worker_id, now() from claimed
    on conflict (job_id, attempt) do update set worker_id = excluded.worker_id, started_at = excluded.started_at,
                                                finished_at = null, outcome = null, error_code = null, error_message = null
    returning job_id)
  select claimed.* from claimed where claimed.id in (select attempts.job_id from attempts);
end
$$;

create function public.extend_job_lease(p_job_id uuid, p_worker_id text, p_seconds integer) returns boolean
  language sql
  security definer
  set search_path = ''
  as $$
    with u as (
      update public.jobs j
        set lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 120), 5), 3600))
      where j.id = p_job_id and j.status = 'running' and j.lease_owner = p_worker_id
      returning 1)
    select exists (select 1 from u)
  $$;

create function private.lock_leased_job(p_job_id uuid, p_worker_id text) returns public.jobs
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs x where x.id = p_job_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if j.status <> 'running' or j.lease_owner is distinct from p_worker_id then
    raise exception 'LEASE_LOST' using errcode = '55000';
  end if;
  return j;
end
$$;

create function public.complete_job(p_job_id uuid, p_worker_id text, p_result jsonb default null) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  j public.jobs := private.lock_leased_job(p_job_id, p_worker_id);
begin
  update public.jobs x
    set status = 'completed', completed_at = now(), result = p_result, lease_owner = null, lease_expires_at = null,
        last_error_code = null, last_error_message = null
  where x.id = j.id;
  update public.job_attempts a
    set finished_at = now(), outcome = 'completed',
        duration_ms = (extract(epoch from (now() - a.started_at)) * 1000)::integer
  where a.job_id = j.id and a.attempt = j.attempts and a.finished_at is null;
end
$$;

-- Back-off (§6.2): not retryable → failed; attempts exhausted → dead_letter; else retrying after
-- min(3600, 30·2^(attempt−1)) s × [0.8, 1.2] or the provider Retry-After. A poison payload
-- (POISON_PAYLOAD) dead-letters on the first attempt (API_CONTRACTS §11.2).
create function public.fail_job(
  p_job_id uuid, p_worker_id text, p_error_code text, p_error_message text, p_retryable boolean default true,
  p_retry_after_seconds integer default null
) returns public.job_status
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  j public.jobs := private.lock_leased_job(p_job_id, p_worker_id);
begin
  if p_error_code = 'POISON_PAYLOAD' then
    update public.jobs x
      set status = 'dead_letter', dead_lettered_at = now(), lease_owner = null, lease_expires_at = null,
          last_error_code = p_error_code, last_error_message = left(p_error_message, 500)
    where x.id = j.id;
    update public.job_attempts a
      set finished_at = now(), outcome = 'dead_letter', error_code = p_error_code, error_message = left(p_error_message, 500),
          duration_ms = (extract(epoch from (now() - a.started_at)) * 1000)::integer
    where a.job_id = j.id and a.attempt = j.attempts and a.finished_at is null;
    return 'dead_letter';
  end if;
  return private.fail_job_row(j, p_error_code, p_error_message, p_retryable, p_retry_after_seconds, null);
end
$$;

-- Merges progress counters (First Analysis) while the lease is held.
create function public.update_job_progress(p_job_id uuid, p_worker_id text, p_progress jsonb) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  j public.jobs := private.lock_leased_job(p_job_id, p_worker_id);
begin
  if p_progress is null or jsonb_typeof(p_progress) <> 'object' then
    raise exception 'VALIDATION_FAILED:progress' using errcode = '22023';
  end if;
  update public.jobs x set progress = x.progress || p_progress where x.id = j.id;
end
$$;

-- ═══ Rate limits (§6.5) ═══════════════════════════════════════════════════════════════════════

-- Fixed window: true = allowed (count ≤ limit after this hit).
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_key is null or p_limit is null or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'VALIDATION_FAILED:rate_limit' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, count) values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  return v_count <= p_limit;
end
$$;

-- ═══ Service wrappers for Edge Functions (service_role only) ═════════════════════════════════

create function public.transition_approval(
  p_id uuid, p_to public.approval_status, p_actor text, p_actor_id uuid, p_idempotency_key text,
  p_reason text default null, p_result jsonb default null, p_error_code text default null,
  p_error_message text default null, p_via public.approval_via default null, p_device_token_hash bytea default null
) returns public.approval_actions
  language sql
  security definer
  set search_path = ''
  as $$
    select private.transition_approval(p_id, p_to, p_actor, p_actor_id, p_idempotency_key, p_reason, p_result, p_error_code,
                                       p_error_message, p_via, p_device_token_hash)
  $$;

create function public.edit_approval_payload(
  p_id uuid, p_user uuid, p_payload jsonb, p_payload_hash bytea, p_change_summary text, p_exact_change jsonb default null
) returns public.approval_actions
  language sql
  security definer
  set search_path = ''
  as $$ select private.edit_approval_payload(p_id, p_user, p_payload, p_payload_hash, p_change_summary, p_exact_change) $$;

create function public.account_can(p_account uuid, p_cap public.capability) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.account_can(p_account, p_cap) $$;

create function public.evaluate_flags(p_user uuid, p_platform public.platform default null, p_app_version text default null)
  returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.evaluate_flags(p_user, p_platform, p_app_version) $$;

create function public.evaluate_flag(
  p_key text, p_user uuid, p_platform public.platform default null, p_app_version text default null
) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.evaluate_flag(p_key, p_user, p_platform, p_app_version) $$;

create function public.consume_provider_quota(
  p_bucket text, p_account uuid, p_units integer, p_limit integer, p_window_seconds integer,
  p_provider public.provider default null
) returns integer
  language sql
  security definer
  set search_path = ''
  as $$ select private.consume_provider_quota(p_bucket, p_account, p_units, p_limit, p_window_seconds, p_provider) $$;

create function public.try_lock_credential_refresh(p_account uuid, p_owner text, p_seconds integer default 30) returns boolean
  language sql
  security definer
  set search_path = ''
  as $$ select private.try_lock_credential_refresh(p_account, p_owner, p_seconds) $$;

create function public.user_apple_sub(p_user uuid) returns text
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.user_apple_sub(p_user) $$;

create function public.grant_entitlement(
  p_user uuid, p_source public.grant_source, p_days smallint, p_reason text, p_admin uuid, p_idempotency_key text,
  p_referral_credit uuid default null
) returns public.entitlement_grants
  language sql
  security definer
  set search_path = ''
  as $$ select private.grant_entitlement(p_user, p_source, p_days, p_reason, p_admin, p_idempotency_key, p_referral_credit) $$;

create function public.reward_referral(p_referral_id uuid) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.reward_referral(p_referral_id) $$;

create function public.ai_budget_reserve(
  p_user uuid, p_feature public.ai_feature, p_est_cost_micros bigint, p_units integer default 0
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.ai_budget_reserve(p_user, p_feature, p_est_cost_micros, p_units) $$;

create function public.ai_budget_settle(
  p_reservation_id uuid, p_ai_request_id uuid, p_actual_cost_micros bigint, p_units integer,
  p_tokens jsonb default '{}'::jsonb
) returns void
  language sql
  security definer
  set search_path = ''
  as $$ select private.ai_budget_settle(p_reservation_id, p_ai_request_id, p_actual_cost_micros, p_units, p_tokens) $$;

create function public.ai_breaker_state(p_provider text, p_model text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.ai_breaker_state(p_provider, p_model) $$;

create function public.memory_stats(p_user uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.memory_stats(p_user) $$;

create function public.plan_limit(p_user uuid, p_key text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.plan_limit(p_user, p_key) $$;

create function public.upsert_learned_preference(
  p_user uuid, p_target_type text, p_target_ref text, p_group_key text, p_effect jsonb, p_evidence_delta integer,
  p_statement text default null
) returns uuid
  language sql
  security definer
  set search_path = ''
  as $$
    select private.upsert_learned_preference(p_user, p_target_type, p_target_ref, p_group_key, p_effect, p_evidence_delta,
                                             p_statement)
  $$;

create function public.retention_cleanup(p_batch integer default 5000, p_now timestamptz default now()) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.retention_cleanup(p_batch, p_now) $$;

create function public.recompute_expires_at(p_user uuid, p_batch integer default 5000) returns integer
  language sql
  security definer
  set search_path = ''
  as $$ select private.recompute_expires_at(p_user, p_batch) $$;

create function public.purge_user_history(p_user uuid) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.purge_user_history(p_user) $$;

create function public.pseudonymize_audit_subject(p_user uuid) returns bigint
  language sql
  security definer
  set search_path = ''
  as $$ select private.pseudonymize_audit_subject(p_user) $$;

-- sha256('da-subject-v1:' ‖ user id): the deletion subject key stored before the user row goes.
create function public.hash_subject(p_user uuid) returns bytea
  language sql immutable
  security definer
  set search_path = ''
  as $$ select private.hash_subject(p_user) $$;

-- ═══ Metric rollups (BACKOFFICE_PLAN §7.6) ════════════════════════════════════════════════════

-- Idempotent delete + re-insert of one reporting-timezone day in metrics_daily and
-- ai_metrics_daily. Anonymous aggregates only; internal and demo users are excluded.
create function private.rollup_metrics_daily(p_day date) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_tz text := coalesce(private.app_setting('metrics.reporting_timezone') #>> '{}', 'Europe/Istanbul');
  v_start timestamptz := p_day::timestamp at time zone v_tz;
  v_end timestamptz := (p_day + 1)::timestamp at time zone v_tz;
  v_metrics integer;
  v_ai integer;
  -- Real (non-demo, non-internal) users; an array keeps the function statically checkable.
  v_population uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('da_rollup:' || p_day::text));
  delete from public.metrics_daily m where m.day = p_day;
  delete from public.ai_metrics_daily m where m.day = p_day;

  v_population := array(select m.user_id from private.metric_population() m);

  insert into public.metrics_daily (day, metric_key, dim1, dim2, dim3, value, value_sum, latency_hist)
  -- briefings.status (kind, status)
  select p_day, 'briefings.status', b.kind::text, b.status::text, '', count(*), null::numeric, null::integer[]
  from public.briefings b join unnest(v_population) as u(user_id) on u.user_id = b.user_id
  where b.scheduled_for >= v_start and b.scheduled_for < v_end
  group by b.kind, b.status
  union all
  -- briefings.gen_latency (kind)
  select p_day, 'briefings.gen_latency', b.kind::text, '', '', count(*), sum(b.latency_ms),
         private.latency_hist(array_agg(b.latency_ms))
  from public.briefings b join unnest(v_population) as u(user_id) on u.user_id = b.user_id
  where b.scheduled_for >= v_start and b.scheduled_for < v_end and b.latency_ms is not null
  group by b.kind
  union all
  -- briefings.delivery_delay (kind)
  select p_day, 'briefings.delivery_delay', b.kind::text, '', '', count(*),
         sum(extract(epoch from (b.delivered_at - b.scheduled_for)) * 1000),
         private.latency_hist(array_agg((extract(epoch from (b.delivered_at - b.scheduled_for)) * 1000)::integer))
  from public.briefings b join unnest(v_population) as u(user_id) on u.user_id = b.user_id
  where b.scheduled_for >= v_start and b.scheduled_for < v_end and b.delivered_at is not null
  group by b.kind
  union all
  -- notifications.decision (category, decision, reason)
  select p_day, 'notifications.decision', n.category::text, n.decision::text, coalesce(n.suppression_reason, ''), count(*),
         null, null
  from public.notifications n join unnest(v_population) as u(user_id) on u.user_id = n.user_id
  where n.created_at >= v_start and n.created_at < v_end and not n.is_test
  group by n.category, n.decision, n.suppression_reason
  union all
  -- push.receipts (status, error)
  select p_day, 'push.receipts', t.status, coalesce(t.error_code, ''), '', count(*), null, null
  from public.push_tickets t join unnest(v_population) as u(user_id) on u.user_id = t.user_id
  where t.sent_at >= v_start and t.sent_at < v_end
  group by t.status, t.error_code
  union all
  -- jobs.finished (type, status)
  select p_day, 'jobs.finished', j.type::text, j.status::text, '', count(*), null, null
  from public.jobs j
  where j.status in ('completed', 'failed', 'dead_letter') and j.updated_at >= v_start and j.updated_at < v_end
    and (j.user_id is null or j.user_id = any(v_population))
  group by j.type, j.status
  union all
  -- jobs.attempts (type, outcome)
  select p_day, 'jobs.attempts', j.type::text, coalesce(a.outcome, 'open'), '', count(*), sum(a.duration_ms),
         private.latency_hist(array_agg(a.duration_ms))
  from public.job_attempts a join public.jobs j on j.id = a.job_id
  where a.started_at >= v_start and a.started_at < v_end
    and (a.user_id is null or a.user_id = any(v_population))
  group by j.type, a.outcome
  union all
  -- email.triage (decision_tier)
  select p_day, 'email.triage', coalesce(m.classification_tier::text, 'unclassified'), '', '', count(*), null, null
  from public.email_messages m join unnest(v_population) as u(user_id) on u.user_id = m.user_id
  where m.received_at >= v_start and m.received_at < v_end
  group by m.classification_tier
  union all
  -- approvals.created (action_type)
  select p_day, 'approvals.created', a.action_type::text, '', '', count(*), null, null
  from public.approval_actions a join unnest(v_population) as u(user_id) on u.user_id = a.user_id
  where a.created_at >= v_start and a.created_at < v_end
  group by a.action_type
  union all
  -- approvals.final (action_type, status)
  select p_day, 'approvals.final', a.action_type::text, a.status::text, '', count(*), null, null
  from public.approval_actions a join unnest(v_population) as u(user_id) on u.user_id = a.user_id
  where a.status in ('executed', 'failed', 'rejected', 'expired')
    and coalesce(a.executed_at, a.failed_at, a.rejected_at, a.updated_at) >= v_start
    and coalesce(a.executed_at, a.failed_at, a.rejected_at, a.updated_at) < v_end
  group by a.action_type, a.status
  union all
  -- ai_feedback.rating (feature, model, rating)
  select p_day, 'ai_feedback.rating', f.feature::text, coalesce(f.model, ''), f.rating::text, count(*), null, null
  from public.ai_feedback f join unnest(v_population) as u(user_id) on u.user_id = f.user_id
  where f.created_at >= v_start and f.created_at < v_end
  group by f.feature, f.model, f.rating;
  get diagnostics v_metrics = row_count;

  insert into public.ai_metrics_daily (day, feature, provider, model, prompt_version_id, plan, profile, status, requests,
                                       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, units_charged,
                                       cost_usd_micros, grounding_proposed, grounding_dropped, latency_hist)
  select p_day, r.feature, r.provider, r.model, r.prompt_version_id, coalesce(r.plan, 'free'), r.profile, r.status,
         count(*), sum(r.input_tokens), sum(r.output_tokens), sum(r.cache_read_tokens),
         sum(r.cache_write_tokens + r.cache_write_1h_tokens), sum(r.units_charged), sum(r.cost_usd_micros),
         coalesce(sum(r.grounding_proposed), 0), coalesce(sum(r.grounding_dropped), 0),
         private.latency_hist(array_agg(r.latency_ms))
  from public.ai_requests r
  where r.created_at >= v_start and r.created_at < v_end
    and (r.user_id is null or r.user_id = any(v_population))
  group by r.feature, r.provider, r.model, r.prompt_version_id, coalesce(r.plan, 'free'), r.profile, r.status;
  get diagnostics v_ai = row_count;

  return jsonb_build_object('day', p_day, 'metrics_rows', v_metrics, 'ai_rows', v_ai);
end
$$;

-- ═══ Cron helpers (§9) ════════════════════════════════════════════════════════════════════════

-- da_reconciliation (every 6 h): one reconciliation job per live account and, at the 00:xx UTC
-- run, the daily credential re-encryption sweep.
create function private.enqueue_reconciliation(p_now timestamptz default now()) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_bucket text := to_char(date_trunc('hour', p_now at time zone 'UTC')
                           - make_interval(hours => extract(hour from p_now at time zone 'UTC')::integer % 6), 'YYYYMMDDHH24');
  v_count integer := 0;
  r record;
begin
  for r in
    select c.id, c.user_id from public.connected_accounts c
    where c.status in ('healthy', 'syncing', 'partial', 'error') and c.provider in ('google', 'microsoft')
      and c.pending_binding_until is null
    order by c.id
    limit 20000
  loop
    perform private.enqueue_job('reconciliation', 'reconciliation:' || r.id || ':' || v_bucket,
                                jsonb_build_object('account_id', r.id), r.user_id, r.id, p_now, 200, 5, null);
    v_count := v_count + 1;
  end loop;
  if extract(hour from p_now at time zone 'UTC')::integer < 6 then
    perform private.enqueue_job('credential_reencrypt', 'credential_reencrypt:' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD'),
                                '{}'::jsonb, null, null, p_now, 300, 5, null);
  end if;
  perform private.poke_worker('reconciliation');
  return jsonb_build_object('reconciliation', v_count);
end
$$;

-- da_billing_reconcile (daily): refetch mirrors that look stale.
create function private.enqueue_billing_reconcile(p_now timestamptz default now()) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select s.user_id from public.subscriptions s
    where (s.is_active and s.expires_at < p_now) or s.synced_at < p_now - interval '7 days'
    order by s.user_id
    limit 20000
  loop
    perform private.enqueue_job('billing_sync', 'billing_sync:' || r.user_id || ':' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD'),
                                jsonb_build_object('user_id', r.user_id, 'reason', 'reconcile'), r.user_id, null, p_now, 200, 5, null);
    v_count := v_count + 1;
  end loop;
  perform private.poke_worker('billing_reconcile');
  return jsonb_build_object('billing_sync', v_count);
end
$$;

-- ═══ scheduler_tick (§6.3; pg_cron every minute) ══════════════════════════════════════════════

-- Attendee e-mails of an event (attendees jsonb [{email, …}]).
create function private.event_attendee_emails(p_attendees jsonb) returns extensions.citext[]
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(array_agg(distinct (a.value ->> 'email')::extensions.citext) filter (where a.value ->> 'email' is not null),
                    '{}'::extensions.citext[])
    from jsonb_array_elements(case when jsonb_typeof(p_attendees) = 'array' then p_attendees else '[]'::jsonb end) as a (value)
  $$;

-- R-23 precompute: a meeting with an attendee outside the user's own mail domains or a VIP.
create function private.event_has_external_or_vip(p_user uuid, p_attendees jsonb) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    with emails as (select unnest(private.event_attendee_emails(p_attendees)) as email),
    own as (
      select distinct lower(split_part(c.account_email::text, '@', 2)) as domain
      from public.connected_accounts c where c.user_id = p_user and c.account_email is not null)
    select exists (select 1 from emails e where lower(split_part(e.email::text, '@', 2)) not in (select own.domain from own))
        or exists (select 1 from emails e
                   join public.contacts ct on ct.user_id = p_user and (ct.primary_email = e.email or e.email = any(ct.emails))
                   join public.vip_people v on v.user_id = p_user and v.contact_id = ct.id)
  $$;

create function private.scheduler_tick(p_now timestamptz default now()) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_enqueued integer := 0;
  v_minute integer := extract(minute from p_now at time zone 'UTC')::integer;
  v_tz text := coalesce(private.app_setting('metrics.reporting_timezone') #>> '{}', 'Europe/Istanbul');
  v_report_day date := (p_now at time zone coalesce(private.app_setting('metrics.reporting_timezone') #>> '{}', 'Europe/Istanbul'))::date;
  v_bucket15 text := to_char(date_trunc('hour', p_now at time zone 'UTC')
                             + make_interval(mins => (extract(minute from p_now at time zone 'UTC')::integer / 15) * 15),
                             'YYYYMMDDHH24MI');
  r record;
begin
  if not pg_try_advisory_xact_lock(hashtext('da_scheduler_tick')) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  -- 1 · lease recovery
  v_counts := v_counts || jsonb_build_object('leases_reaped', private.reap_expired_leases(p_now));

  -- 2 · briefings (DST-safe local wall time; one row per (user, kind, local_date))
  v_n := 0;
  for r in
    with u as (
      select up.*, (p_now at time zone up.timezone) as local_ts,
             extract(isodow from (p_now at time zone up.timezone))::smallint as iso_dow
      from public.user_preferences up
      join public.profiles p on p.user_id = up.user_id and p.state = 'active'),
    slots as (
      select u.user_id, u.timezone, k.kind, u.local_ts::date as local_date, k.slot, u.local_ts
      from u
      cross join lateral (values
        ('morning'::public.briefing_kind, u.morning_enabled and u.iso_dow = any(u.briefing_weekdays),
         case when u.iso_dow in (6, 7) then u.weekend_morning_time else u.morning_time end),
        ('midday'::public.briefing_kind,
         u.midday_enabled and u.iso_dow = any(u.briefing_weekdays) and not (u.iso_dow in (6, 7) and u.weekend_morning_only),
         u.midday_time),
        ('evening'::public.briefing_kind,
         u.evening_enabled and u.iso_dow = any(u.briefing_weekdays) and not (u.iso_dow in (6, 7) and u.weekend_morning_only),
         u.evening_time),
        ('weekly'::public.briefing_kind, u.weekly_enabled and u.iso_dow = u.weekly_dow, u.weekly_time)
      ) as k (kind, enabled, slot)
      where k.enabled
        and u.local_ts >= u.local_ts::date + k.slot
        and u.local_ts < u.local_ts::date + k.slot + interval '3 hours'),
    ins as (
      insert into public.briefings (user_id, kind, local_date, time_zone, scheduled_for, status, idempotency_key)
      select s.user_id, s.kind, s.local_date, s.timezone, (s.local_date + s.slot) at time zone s.timezone, 'scheduled',
             'briefing:' || s.user_id || ':' || s.kind || ':' || s.local_date
      from slots s
      where not exists (select 1 from public.briefings b
                        where b.user_id = s.user_id and b.kind = s.kind and b.local_date = s.local_date)
      order by s.user_id, s.kind
      limit 5000
      on conflict do nothing
      returning id, user_id, idempotency_key)
    select * from ins
  loop
    update public.briefings b
      set job_id = private.enqueue_job('briefing', r.idempotency_key, jsonb_build_object('briefing_id', r.id), r.user_id,
                                       null, p_now, 20, 5, null)
    where b.id = r.id;
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('briefings', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 3a · meeting prep precompute (R-23: Pro, flag, external or VIP attendees, starts in 45–60 min)
  v_n := 0;
  for r in
    select e.id, e.user_id, e.start_at from public.calendar_events e
    join public.profiles p on p.user_id = e.user_id and p.state = 'active'
    where e.start_at >= p_now + interval '45 minutes' and e.start_at <= p_now + interval '60 minutes'
      and e.status <> 'cancelled' and not e.all_day and e.attendee_count >= 1
      and not exists (select 1 from public.meeting_preps m where m.calendar_event_id = e.id and m.status = 'ready')
    order by e.start_at, e.id
    limit 500
  loop
    continue when not private.is_pro(r.user_id);
    continue when not coalesce((private.evaluate_flag('feature.meeting_prep', r.user_id, null, null) ->> 'value')::boolean, false);
    continue when not private.event_has_external_or_vip(r.user_id,
                                                        (select e.attendees from public.calendar_events e where e.id = r.id));
    perform private.enqueue_job('meeting_prep', 'meeting_prep:' || r.id || ':' || extract(epoch from r.start_at)::bigint,
                                jsonb_build_object('event_id', r.id, 'trigger', 'schedule'), r.user_id, null, p_now, 30, 5, null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('meeting_preps', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 3b · meeting prep notification at the user's lead time (15–30 min)
  v_n := 0;
  for r in
    select e.id, e.user_id, e.start_at from public.calendar_events e
    join public.profiles p on p.user_id = e.user_id and p.state = 'active'
    join public.notification_preferences np on np.user_id = e.user_id and np.meeting
    where e.status <> 'cancelled' and not e.all_day and e.attendee_count >= 1
      and e.start_at >= p_now + make_interval(mins => np.meeting_prep_lead_min)
      and e.start_at < p_now + make_interval(mins => np.meeting_prep_lead_min + 1)
    order by e.start_at, e.id
    limit 1000
  loop
    continue when not private.is_pro(r.user_id);
    perform private.enqueue_job('notification', 'meeting_prep_notify:' || r.id || ':' || extract(epoch from r.start_at)::bigint,
                                jsonb_build_object('category', 'meeting', 'trigger', 'meeting_prep', 'event_id', r.id),
                                r.user_id, null, p_now, 20, 3, null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('meeting_prep_notifications', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 4 · post-meeting prompt
  v_n := 0;
  for r in
    select e.id, e.user_id from public.calendar_events e
    join public.profiles p on p.user_id = e.user_id and p.state = 'active'
    where e.end_at between p_now - interval '2 minutes' and p_now and e.status <> 'cancelled' and not e.all_day
      and e.attendee_count >= 1
    order by e.end_at, e.id
    limit 1000
  loop
    continue when not private.is_pro(r.user_id);
    perform private.enqueue_job('notification', 'post_meeting:' || r.id,
                                jsonb_build_object('category', 'meeting', 'trigger', 'post_meeting', 'event_id', r.id),
                                r.user_id, null, p_now, 50, 3, null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('post_meeting', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 5 · watch renewals
  v_n := 0;
  for r in
    select s.id, s.user_id, s.connected_account_id from public.sync_states s
    join public.connected_accounts c on c.id = s.connected_account_id and c.status not in ('disconnected', 'needs_reauth')
    where s.watch_kind <> 'none' and s.watch_renew_after <= p_now
    order by s.watch_renew_after
    limit 1000
  loop
    perform private.enqueue_job('watch_renewal', 'watch_renewal:' || r.id || ':' || to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24'),
                                jsonb_build_object('sync_state_id', r.id), r.user_id, r.connected_account_id, p_now, 40, 5, null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('watch_renewals', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 6 · Graph calendarView re-baseline
  v_n := 0;
  for r in
    select s.id, s.user_id, s.connected_account_id from public.sync_states s
    join public.connected_accounts c on c.id = s.connected_account_id and c.status not in ('disconnected', 'needs_reauth')
    where s.rebaseline_due_at <= p_now
    order by s.rebaseline_due_at
    limit 1000
  loop
    perform private.enqueue_job('calendar_sync',
                                'rebaseline:' || r.id || ':' || private.user_local_date(r.user_id, p_now),
                                jsonb_build_object('sync_state_id', r.id, 'mode', 'rebaseline'), r.user_id,
                                r.connected_account_id, p_now, 60, 5, null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('rebaselines', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 7 · tasks poll (one per account and 15-minute bucket)
  v_n := 0;
  if v_minute % 15 = 0 then
    for r in
      select c.id, c.user_id from public.connected_accounts c
      where c.status in ('healthy', 'syncing', 'partial') and 'tasks_read' = any(c.capabilities_granted)
      order by c.id
      limit 5000
    loop
      continue when not private.account_can(r.id, 'tasks_read');
      perform private.enqueue_job('tasks_sync', 'tasks_sync:' || r.id || ':' || v_bucket15,
                                  jsonb_build_object('account_id', r.id, 'trigger', 'poll'), r.user_id, r.id, p_now, 150, 5, null);
      v_n := v_n + 1;
    end loop;
  end if;
  v_counts := v_counts || jsonb_build_object('tasks_polls', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 8 · reminders due within the next minute
  v_n := 0;
  for r in
    select m.id, m.user_id, m.remind_at from public.reminders m
    where m.status = 'scheduled' and m.remind_at <= p_now + interval '1 minute'
    order by m.remind_at
    limit 1000
  loop
    perform private.enqueue_job('notification', 'reminder:' || r.id,
                                jsonb_build_object('trigger', 'reminder', 'reminder_id', r.id), r.user_id, null,
                                greatest(r.remind_at, p_now), 10, 3, null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('reminders', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 9 · approval expiry
  v_n := 0;
  for r in
    select a.id from public.approval_actions a
    where a.status = 'pending' and a.approval_expires_at < p_now
    order by a.approval_expires_at
    limit 500
  loop
    perform private.transition_approval(r.id, 'expired', 'system', null, null, 'expired');
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('approvals_expired', v_n);

  -- 10 · snooze wake-ups
  update public.insights i set status = 'open', snoozed_until = null
  where i.id in (select x.id from public.insights x where x.status = 'snoozed' and x.snoozed_until <= p_now limit 1000);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('insights_woken', v_n);
  update public.commitments c set status = 'open', snoozed_until = null
  where c.id in (select x.id from public.commitments x where x.status = 'snoozed' and x.snoozed_until <= p_now limit 1000);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('commitments_woken', v_n);
  update public.life_events l set status = 'open', snoozed_until = null
  where l.id in (select x.id from public.life_events x where x.status = 'snoozed' and x.snoozed_until <= p_now limit 1000);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('life_events_woken', v_n);

  -- 11 · deadline / follow-up nudges in the user's local 09:00–09:15 window (the notification
  --      engine applies caps, quiet hours and categories)
  v_n := 0;
  for r in
    select i.id, i.user_id, i.kind, (p_now at time zone up.timezone)::date as local_date
    from public.insights i
    join public.user_preferences up on up.user_id = i.user_id
    join public.profiles p on p.user_id = i.user_id and p.state = 'active'
    where i.status = 'open' and i.kind in ('deadline', 'follow_up') and i.due_at is not null
      and (p_now at time zone up.timezone)::time >= time '09:00' and (p_now at time zone up.timezone)::time < time '09:15'
      and i.due_at < (((p_now at time zone up.timezone)::date + 1)::timestamp at time zone up.timezone)
    order by i.due_at
    limit 1000
  loop
    perform private.enqueue_job('notification', 'nudge:' || r.id || ':' || r.local_date,
                                jsonb_build_object('trigger', 'nudge', 'insight_id', r.id,
                                                   'category', case when r.kind = 'deadline' then 'deadline' else 'follow_up' end),
                                r.user_id, null, p_now, 60, 3, null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('nudges', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 12 · referral qualification sweep (every 15 minutes; the job evaluates the full rules)
  v_n := 0;
  if v_minute % 15 = 0 then
    for r in
      select f.id, f.referee_id from public.referrals f
      where f.status = 'pending' and f.referee_id is not null
        and f.applied_at <= p_now - make_interval(hours => private.app_setting_int('referral.min_account_age_hours', 48))
        and exists (select 1 from public.briefings b where b.user_id = f.referee_id and b.status = 'delivered')
      order by f.applied_at
      limit 500
    loop
      perform private.enqueue_job('referral_evaluate', 'referral_evaluate:' || r.id || ':' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD'),
                                  jsonb_build_object('referral_id', r.id), r.referee_id, null, p_now, 200, 5, null);
      v_n := v_n + 1;
    end loop;
  end if;
  v_counts := v_counts || jsonb_build_object('referral_evaluations', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 13 · device approvals without a result
  v_counts := v_counts || jsonb_build_object('device_approvals_failed', private.fail_stale_device_approvals(p_now));

  -- 14 · expired AI budget holds
  v_counts := v_counts || jsonb_build_object('budget_holds_released', private.release_expired_budget_holds(p_now, 1000));

  -- 15 · OAuth binding expiry (R-07)
  v_n := 0;
  for r in
    select c.id, c.user_id, c.pending_binding_until from public.connected_accounts c
    where c.pending_binding_until < p_now and c.status = 'connecting'
    order by c.pending_binding_until
    limit 500
  loop
    perform private.enqueue_job('integration_purge',
                                'integration_purge:' || r.id || ':' || extract(epoch from r.pending_binding_until)::bigint,
                                jsonb_build_object('account_id', r.id, 'reason', 'binding_expired'), r.user_id, r.id, p_now, 30, 5,
                                null);
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('binding_expired', v_n);
  v_enqueued := v_enqueued + v_n;

  -- 16 · Support Access expiry audit
  v_n := 0;
  for r in
    select g.id, g.user_id, g.admin_user_id from public.support_access_grants g
    where g.expires_at <= p_now and g.revoked_at is null and g.expired_audited_at is null
    order by g.expires_at
    limit 500
    for update skip locked
  loop
    perform private.audit_log_append('system', null, null, 'support_access.expired', 'support_access_grant', r.id::text,
                                     r.user_id, null, 'success', jsonb_build_object('admin_user_id', r.admin_user_id), null);
    update public.support_access_grants g set expired_audited_at = p_now where g.id = r.id;
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('support_access_expired', v_n);

  -- 17 · metric rollups (today and yesterday every 15 min; day − 2 final at 03:30 UTC)
  if v_minute % 15 = 0 then
    perform private.rollup_metrics_daily(v_report_day);
    perform private.rollup_metrics_daily(v_report_day - 1);
    if extract(hour from p_now at time zone 'UTC')::integer = 3 and v_minute = 30 then
      perform private.rollup_metrics_daily(v_report_day - 2);
    end if;
    v_counts := v_counts || jsonb_build_object('rollup_days', case when extract(hour from p_now at time zone 'UTC')::integer = 3
                                                                        and v_minute = 30 then 3 else 2 end);
  end if;

  -- 18 · poke the worker
  if v_enqueued > 0 then
    v_counts := v_counts || jsonb_build_object('poke_request_id', private.poke_worker('scheduler'));
  end if;
  return v_counts || jsonb_build_object('enqueued', v_enqueued, 'tz_reporting', v_tz);
end
$$;

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on all functions in schema private from public;

revoke execute on function
  public.enqueue_job(public.job_type, text, jsonb, uuid, uuid, timestamptz, smallint, integer, uuid),
  public.claim_jobs(text, public.job_type[], integer, integer),
  public.extend_job_lease(uuid, text, integer),
  public.complete_job(uuid, text, jsonb),
  public.fail_job(uuid, text, text, text, boolean, integer),
  public.update_job_progress(uuid, text, jsonb),
  public.rate_limit_hit(text, integer, integer),
  public.transition_approval(uuid, public.approval_status, text, uuid, text, text, jsonb, text, text, public.approval_via, bytea),
  public.edit_approval_payload(uuid, uuid, jsonb, bytea, text, jsonb),
  public.account_can(uuid, public.capability),
  public.evaluate_flags(uuid, public.platform, text),
  public.evaluate_flag(text, uuid, public.platform, text),
  public.consume_provider_quota(text, uuid, integer, integer, integer, public.provider),
  public.try_lock_credential_refresh(uuid, text, integer),
  public.user_apple_sub(uuid),
  public.grant_entitlement(uuid, public.grant_source, smallint, text, uuid, text, uuid),
  public.reward_referral(uuid),
  public.ai_budget_reserve(uuid, public.ai_feature, bigint, integer),
  public.ai_budget_settle(uuid, uuid, bigint, integer, jsonb),
  public.ai_breaker_state(text, text),
  public.memory_stats(uuid),
  public.plan_limit(uuid, text),
  public.upsert_learned_preference(uuid, text, text, text, jsonb, integer, text),
  public.retention_cleanup(integer, timestamptz),
  public.recompute_expires_at(uuid, integer),
  public.purge_user_history(uuid),
  public.pseudonymize_audit_subject(uuid),
  public.hash_subject(uuid)
  from public, anon, authenticated;

grant execute on function
  public.enqueue_job(public.job_type, text, jsonb, uuid, uuid, timestamptz, smallint, integer, uuid),
  public.claim_jobs(text, public.job_type[], integer, integer),
  public.extend_job_lease(uuid, text, integer),
  public.complete_job(uuid, text, jsonb),
  public.fail_job(uuid, text, text, text, boolean, integer),
  public.update_job_progress(uuid, text, jsonb),
  public.rate_limit_hit(text, integer, integer),
  public.transition_approval(uuid, public.approval_status, text, uuid, text, text, jsonb, text, text, public.approval_via, bytea),
  public.edit_approval_payload(uuid, uuid, jsonb, bytea, text, jsonb),
  public.account_can(uuid, public.capability),
  public.evaluate_flags(uuid, public.platform, text),
  public.evaluate_flag(text, uuid, public.platform, text),
  public.consume_provider_quota(text, uuid, integer, integer, integer, public.provider),
  public.try_lock_credential_refresh(uuid, text, integer),
  public.user_apple_sub(uuid),
  public.grant_entitlement(uuid, public.grant_source, smallint, text, uuid, text, uuid),
  public.reward_referral(uuid),
  public.ai_budget_reserve(uuid, public.ai_feature, bigint, integer),
  public.ai_budget_settle(uuid, uuid, bigint, integer, jsonb),
  public.ai_breaker_state(text, text),
  public.memory_stats(uuid),
  public.plan_limit(uuid, text),
  public.upsert_learned_preference(uuid, text, text, text, jsonb, integer, text),
  public.retention_cleanup(integer, timestamptz),
  public.recompute_expires_at(uuid, integer),
  public.purge_user_history(uuid),
  public.pseudonymize_audit_subject(uuid),
  public.hash_subject(uuid)
  to service_role;

grant execute on function private.scheduler_tick(timestamptz), private.rollup_metrics_daily(date),
  private.enqueue_reconciliation(timestamptz), private.enqueue_billing_reconcile(timestamptz) to service_role;
