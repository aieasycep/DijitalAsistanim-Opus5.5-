-- Migration · RevenueCat webhook ledger, subscription mirror and sandbox policy (T-7.01)
-- Spec: docs/API_CONTRACTS.md WH-05, JOB-24, API-BIZ-03; docs/DATABASE_AND_RLS_PLAN.md §4.6
-- (subscriptions, billing_events), §4.1 (webhook_events); docs/INTEGRATION_PLAN.md §10.4; ADR-11.
--
-- Events are only a trigger: the worker re-fetches the customer from RevenueCat REST v2 and
-- overwrites the `subscriptions` mirror, so events never apply incrementally and arrive unordered.
-- Owner decision (JOB-24 step 2 vs INTEGRATION_PLAN §10.4): in production a sandbox purchase is
-- honoured only for app user ids listed in app_settings['billing.sandbox_allowed_app_user_ids']
-- (App Review / TestFlight / store testers); everywhere else it is ignored.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Ledger: unknown RevenueCat event types are stored, never rejected (WH-05) ════════════════
alter table public.billing_events drop constraint billing_events_event_type_check;
alter table public.billing_events
  add constraint billing_events_event_type_check check (event_type ~ '^[A-Z][A-Z0-9_]{0,63}$') not valid;
comment on column public.billing_events.event_type is
  'RevenueCat event type; the known set lives in packages/validation (REVENUECAT_EVENT_TYPES), unknown types are stored and ignored.';

-- ═══ Sandbox allow-list (app_settings) ═══════════════════════════════════════════════════════
-- Same rules as 0001 plus billing.sandbox_allowed_app_user_ids: a JSON array (≤ 200) of
-- RevenueCat app user ids (1–128 characters each).
create or replace function private.valid_app_setting(p_key text, p_value jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(case
      when p_value is null then false
      when p_key in ('session.idle_minutes', 'session.absolute_hours', 'metrics.inactive_after_days',
                     'referral.reward_days', 'referral.min_account_age_hours', 'referral.velocity_max_per_hour',
                     'referral.risk_threshold', 'referral.apply_window_days', 'support_access.max_minutes', 'notifications.cap.follow_up', 'notifications.cap.life_intel',
                     'notifications.cap.deadline', 'first_analysis.mail_window_hours',
                     'first_analysis.calendar_window_hours', 'first_analysis.slow_threshold_s',
                     'first_analysis.timeout_s', 'today.max_priorities', 'pro_gate.snooze_days') then
        private.jsonb_numeric(p_value) = trunc(private.jsonb_numeric(p_value))
        and case p_key
          when 'session.idle_minutes' then private.jsonb_numeric(p_value) between 10 and 30
          when 'session.absolute_hours' then private.jsonb_numeric(p_value) between 4 and 12
          when 'metrics.inactive_after_days' then private.jsonb_numeric(p_value) between 7 and 60
          when 'referral.reward_days' then private.jsonb_numeric(p_value) between 1 and 60
          when 'referral.min_account_age_hours' then private.jsonb_numeric(p_value) between 24 and 168
          when 'referral.velocity_max_per_hour' then private.jsonb_numeric(p_value) between 1 and 20
          when 'referral.risk_threshold' then private.jsonb_numeric(p_value) between 0 and 100
          when 'referral.apply_window_days' then private.jsonb_numeric(p_value) between 1 and 30
          when 'support_access.max_minutes' then private.jsonb_numeric(p_value) in (15, 30, 60)
          when 'first_analysis.mail_window_hours' then private.jsonb_numeric(p_value) between 1 and 336
          when 'first_analysis.calendar_window_hours' then private.jsonb_numeric(p_value) between 1 and 336
          when 'first_analysis.slow_threshold_s' then private.jsonb_numeric(p_value) between 5 and 600
          when 'first_analysis.timeout_s' then private.jsonb_numeric(p_value) between 60 and 3600
          when 'today.max_priorities' then private.jsonb_numeric(p_value) between 1 and 10
          when 'pro_gate.snooze_days' then private.jsonb_numeric(p_value) between 1 and 90
          else private.jsonb_numeric(p_value) between 0 and 50          -- notifications.cap.*
        end
      when p_key = 'metrics.reporting_timezone' then
        jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'
      when p_key = 'followup.wait_thresholds_days' then
        case when jsonb_typeof(p_value) <> 'array' then false
             when jsonb_array_length(p_value) <> 2 then false
             else private.jsonb_numeric(p_value -> 0) >= 1
                  and private.jsonb_numeric(p_value -> 0) = trunc(private.jsonb_numeric(p_value -> 0))
                  and private.jsonb_numeric(p_value -> 1) = trunc(private.jsonb_numeric(p_value -> 1))
                  and private.jsonb_numeric(p_value -> 0) < private.jsonb_numeric(p_value -> 1) end
      when p_key = 'web.pricing_display' then
        jsonb_typeof(p_value) = 'object' and jsonb_typeof(p_value -> 'verified') = 'boolean'
      when p_key = 'pricing.estimates' then
        jsonb_typeof(p_value) = 'object'
      when p_key = 'admin.gateway_secret_sha256' then
        jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[0-9a-f]{64}$'
      when p_key = 'billing.sandbox_allowed_app_user_ids' then
        case when jsonb_typeof(p_value) <> 'array' then false
             when jsonb_array_length(p_value) > 200 then false
             else not exists (select 1 from jsonb_array_elements(p_value) as e (item)
                              where jsonb_typeof(e.item) <> 'string'
                                 or char_length(e.item #>> '{}') not between 1 and 128) end
      else false
    end, false)
  $$;

insert into public.app_settings (key, value, description) values
  ('billing.sandbox_allowed_app_user_ids', '[]',
   'RevenueCat app user ids (Supabase user ids) whose sandbox purchases count in production: App Review, TestFlight and store testers only (owner decision, JOB-24).')
on conflict (key) do nothing;

-- True when a sandbox purchase of this app user id counts in production.
create function private.billing_sandbox_allowed(p_app_user_id text) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce((select s.value ? p_app_user_id from public.app_settings s
                     where s.key = 'billing.sandbox_allowed_app_user_ids' and jsonb_typeof(s.value) = 'array'), false)
  $$;

-- The app user id RevenueCat knows is the Supabase user id (INTEGRATION_PLAN §10.2); anonymous
-- `$RCAnonymousID:*` ids and dedicated admin identities map to no user.
create function private.billing_user_for(p_app_user_id text) returns uuid
  language sql stable
  security definer
  set search_path = ''
  as $$
    select u.id from auth.users u
    where p_app_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and u.id = lower(p_app_user_id)::uuid
      and coalesce(u.raw_app_meta_data ->> 'da_kind', '') <> 'admin'
  $$;

-- ═══ Webhook ingest (WH-05) ══════════════════════════════════════════════════════════════════
-- One transaction: the ledger row (dedupe on event_id), the webhook_events replay row and one
-- billing_sync job per affected app user id (key billing_sync:{app_user_id}:{event_id}). A
-- replayed event inserts nothing and enqueues nothing. Events without ids to sync (TEST, unknown
-- types) are stored as processed.
create function private.record_billing_event(
  p_event_id text, p_event_type text, p_app_user_id text, p_environment text, p_store text, p_product_id text,
  p_event_timestamp timestamptz, p_transferred_from text[], p_transferred_to text[], p_payload jsonb,
  p_payload_digest bytea, p_sync_ids text[], p_correlation_id uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_id bigint;
  v_user uuid := private.billing_user_for(p_app_user_id);
  v_sync text[] := array(select distinct x from unnest(coalesce(p_sync_ids, '{}'::text[])) as x
                         where x is not null and char_length(x) between 1 and 128);
  v_target text;
  v_job uuid;
  v_first_job uuid;
  v_jobs jsonb := '[]'::jsonb;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 128 then
    raise exception 'VALIDATION_FAILED:event_id' using errcode = '22023';
  end if;
  insert into public.billing_events (event_id, user_id, rc_app_user_id, event_type, environment, store, product_id,
                                     event_timestamp, transferred_from, transferred_to, payload, process_status,
                                     processed_at)
  values (p_event_id, v_user, p_app_user_id, p_event_type, p_environment, p_store, p_product_id,
          coalesce(p_event_timestamp, now()), p_transferred_from, p_transferred_to, coalesce(p_payload, '{}'::jsonb),
          case when cardinality(v_sync) = 0 then 'processed' else 'received' end,
          case when cardinality(v_sync) = 0 then now() end)
  on conflict (event_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('inserted', false, 'jobs', '[]'::jsonb);
  end if;

  foreach v_target in array v_sync loop
    v_job := private.enqueue_job('billing_sync', left('billing_sync:' || v_target || ':' || p_event_id, 200),
                                 jsonb_build_object('app_user_id', v_target, 'event_id', p_event_id, 'reason', 'webhook'),
                                 private.billing_user_for(v_target), null, now(), 50, 6, p_correlation_id);
    v_first_job := coalesce(v_first_job, v_job);
    v_jobs := v_jobs || to_jsonb(v_job);
  end loop;
  if v_first_job is not null then
    update public.billing_events b set job_id = v_first_job where b.id = v_id;
  end if;

  insert into public.webhook_events (source, external_id, user_id, signature_valid, status, job_id, payload_digest, payload)
  values ('revenuecat', left(p_event_id, 300), v_user, true,
          case when v_first_job is null then 'ignored' else 'enqueued' end, v_first_job,
          coalesce(p_payload_digest, pg_catalog.sha256(convert_to(p_event_id, 'UTF8'))),
          jsonb_build_object('type', p_event_type, 'app_user_id', p_app_user_id))
  on conflict (source, external_id) do nothing;

  return jsonb_build_object('inserted', true, 'billing_event_id', v_id, 'user_id', v_user, 'jobs', v_jobs);
end
$$;

-- ═══ billing_sync (JOB-24) ═══════════════════════════════════════════════════════════════════
-- What the job needs before calling RevenueCat: the mapped user, the sandbox allow-list and the
-- triggering event (its environment decides step 2).
create function private.billing_sync_context(p_app_user_id text, p_event_id text default null) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'user_id', private.billing_user_for(p_app_user_id),
      'sandbox_allowed', private.billing_sandbox_allowed(p_app_user_id),
      'locale', (select p.locale from public.profiles p where p.user_id = private.billing_user_for(p_app_user_id)),
      'event', (select jsonb_build_object('event_id', b.event_id, 'event_type', b.event_type, 'environment', b.environment,
                                          'process_status', b.process_status)
                from public.billing_events b where b.event_id = p_event_id),
      'mirror', (select jsonb_build_object('is_active', s.is_active, 'status', s.status, 'synced_at', s.synced_at)
                 from public.subscriptions s
                 where s.user_id = private.billing_user_for(p_app_user_id) and s.entitlement = 'pro'))
  $$;

-- Marks the ledger row after the job decided (processed | ignored_sandbox | failed).
create function private.billing_mark_event(p_event_id text, p_status text) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if p_status not in ('processed', 'ignored_sandbox', 'failed') then
    raise exception 'VALIDATION_FAILED:status' using errcode = '22023';
  end if;
  update public.billing_events b
  set process_status = p_status, processed_at = now()
  where b.event_id = p_event_id and (b.process_status <> 'processed' or p_status = 'processed');
end
$$;

-- Overwrites the mirror row from a normalised REST v2 snapshot (packages: _shared/services/billing).
-- p_snapshot: {fetched_at, is_active, status, store, environment, product_id, period_type, purchased_at,
-- original_purchased_at, expires_at, will_renew, grace_expires_at, is_family_share}. An older snapshot
-- than the stored one is discarded, so a slow sync can never regress a newer mirror. Derived columns:
-- billing_issue_at / unsubscribe_detected_at keep their first detection time; cancel_reason and
-- expiration_reason come from the latest CANCELLATION / EXPIRATION event; a lapsed subscription whose
-- latest CANCELLATION says CUSTOMER_SUPPORT is `refunded`; trial_reminder_at = expires_at − 24 h for a
-- renewing trial (P-03). Returns the mirror and effective entitlement before and after.
create function private.billing_apply_mirror(
  p_user uuid, p_rc_app_user_id text, p_snapshot jsonb, p_event_id text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_old public.subscriptions;
  v_new public.subscriptions;
  v_fetched timestamptz := coalesce((p_snapshot ->> 'fetched_at')::timestamptz, now());
  v_active boolean := coalesce((p_snapshot ->> 'is_active')::boolean, false);
  v_status public.subscription_status := coalesce(nullif(p_snapshot ->> 'status', ''), 'none')::public.subscription_status;
  v_will_renew boolean := coalesce((p_snapshot ->> 'will_renew')::boolean, false);
  v_expires timestamptz := (p_snapshot ->> 'expires_at')::timestamptz;
  v_period text := nullif(p_snapshot ->> 'period_type', '');
  v_before record;
  v_after record;
  v_event record;
  v_cancel record;
  v_expiration record;
  v_refunded_at timestamptz;
begin
  if p_user is null then
    raise exception 'VALIDATION_FAILED:user' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('billing_mirror:' || p_user::text));
  select * into v_old from public.subscriptions s where s.user_id = p_user and s.entitlement = 'pro' for update;
  if found and v_old.synced_at > v_fetched then
    return jsonb_build_object('skipped', 'stale_snapshot', 'synced_at', v_old.synced_at);
  end if;
  select * into v_before from private.effective_entitlement_at(p_user, now());
  select b.event_id, b.event_type into v_event from public.billing_events b where b.event_id = p_event_id;

  select b.event_timestamp, b.payload into v_cancel from public.billing_events b
  where b.user_id = p_user and b.event_type = 'CANCELLATION' order by b.event_timestamp desc limit 1;
  select b.event_timestamp, b.payload into v_expiration from public.billing_events b
  where b.user_id = p_user and b.event_type = 'EXPIRATION' order by b.event_timestamp desc limit 1;

  if not v_active and v_status in ('expired', 'cancelled', 'none')
     and coalesce(v_cancel.payload #>> '{event,cancel_reason}', '') = 'CUSTOMER_SUPPORT'
     and v_cancel.event_timestamp >= coalesce((p_snapshot ->> 'purchased_at')::timestamptz, '-infinity'::timestamptz) then
    v_status := 'refunded';
    v_refunded_at := coalesce(v_old.refunded_at, v_cancel.event_timestamp);
  end if;

  insert into public.subscriptions as s (
    user_id, entitlement, rc_app_user_id, is_active, status, store, environment, product_id, period_type, purchased_at,
    original_purchased_at, expires_at, will_renew, unsubscribe_detected_at, billing_issue_at, grace_expires_at,
    refunded_at, cancel_reason, expiration_reason, is_family_share, last_event_id, last_event_type, trial_reminder_at,
    synced_at)
  values (
    p_user, 'pro', p_rc_app_user_id, v_active, v_status,
    nullif(p_snapshot ->> 'store', ''), nullif(p_snapshot ->> 'environment', ''), nullif(p_snapshot ->> 'product_id', ''),
    v_period, (p_snapshot ->> 'purchased_at')::timestamptz, (p_snapshot ->> 'original_purchased_at')::timestamptz,
    v_expires, v_will_renew,
    case when v_active and not v_will_renew then coalesce(v_old.unsubscribe_detected_at, v_fetched) end,
    case when v_status in ('billing_issue', 'grace_period') then coalesce(v_old.billing_issue_at, v_fetched) end,
    case when v_status in ('billing_issue', 'grace_period') then (p_snapshot ->> 'grace_expires_at')::timestamptz end,
    v_refunded_at,
    case when not v_will_renew then v_cancel.payload #>> '{event,cancel_reason}' end,
    case when not v_active then v_expiration.payload #>> '{event,expiration_reason}' end,
    coalesce((p_snapshot ->> 'is_family_share')::boolean, false),
    coalesce(v_event.event_id, v_old.last_event_id), coalesce(v_event.event_type, v_old.last_event_type),
    case when v_active and v_will_renew and v_period = 'trial' and v_expires is not null
         then v_expires - interval '24 hours' end,
    v_fetched)
  on conflict (user_id, entitlement) do update set
    rc_app_user_id = excluded.rc_app_user_id, is_active = excluded.is_active, status = excluded.status,
    store = excluded.store, environment = excluded.environment, product_id = excluded.product_id,
    period_type = excluded.period_type, purchased_at = excluded.purchased_at,
    original_purchased_at = excluded.original_purchased_at, expires_at = excluded.expires_at,
    will_renew = excluded.will_renew, unsubscribe_detected_at = excluded.unsubscribe_detected_at,
    billing_issue_at = excluded.billing_issue_at, grace_expires_at = excluded.grace_expires_at,
    refunded_at = excluded.refunded_at, cancel_reason = excluded.cancel_reason,
    expiration_reason = excluded.expiration_reason, is_family_share = excluded.is_family_share,
    last_event_id = excluded.last_event_id, last_event_type = excluded.last_event_type,
    trial_reminder_at = excluded.trial_reminder_at, synced_at = excluded.synced_at
  returning * into v_new;

  if p_event_id is not null then
    perform private.billing_mark_event(p_event_id, 'processed');
  end if;
  select * into v_after from private.effective_entitlement_at(p_user, now());

  return jsonb_build_object(
    'skipped', null,
    'previous', case when v_old.user_id is null then null else jsonb_build_object(
      'is_active', v_old.is_active, 'status', v_old.status, 'will_renew', v_old.will_renew,
      'period_type', v_old.period_type, 'expires_at', v_old.expires_at, 'product_id', v_old.product_id,
      'store', v_old.store) end,
    'current', jsonb_build_object(
      'is_active', v_new.is_active, 'status', v_new.status, 'will_renew', v_new.will_renew,
      'period_type', v_new.period_type, 'expires_at', v_new.expires_at, 'product_id', v_new.product_id,
      'store', v_new.store, 'environment', v_new.environment, 'trial_reminder_at', v_new.trial_reminder_at,
      'original_purchased_at', v_new.original_purchased_at),
    'event_type', v_event.event_type,
    'effective_before', jsonb_build_object('is_active', v_before.is_active, 'active_until', v_before.active_until),
    'effective_after', jsonb_build_object('is_active', v_after.is_active, 'active_until', v_after.active_until));
end
$$;

revoke execute on function
  private.billing_sandbox_allowed(text),
  private.billing_user_for(text),
  private.record_billing_event(text, text, text, text, text, text, timestamptz, text[], text[], jsonb, bytea, text[], uuid),
  private.billing_sync_context(text, text),
  private.billing_mark_event(text, text),
  private.billing_apply_mirror(uuid, text, jsonb, text)
  from public;
grant execute on function
  private.billing_sandbox_allowed(text),
  private.billing_user_for(text),
  private.record_billing_event(text, text, text, text, text, text, timestamptz, text[], text[], jsonb, bytea, text[], uuid),
  private.billing_sync_context(text, text),
  private.billing_mark_event(text, text),
  private.billing_apply_mirror(uuid, text, jsonb, text)
  to service_role;

-- ═══ Service-role wrappers (PostgREST exposes only public and admin_api) ══════════════════════
create function public.record_billing_event(
  p_event_id text, p_event_type text, p_app_user_id text, p_environment text, p_store text, p_product_id text,
  p_event_timestamp timestamptz, p_transferred_from text[], p_transferred_to text[], p_payload jsonb,
  p_payload_digest bytea, p_sync_ids text[], p_correlation_id uuid default null
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$
    select private.record_billing_event(p_event_id, p_event_type, p_app_user_id, p_environment, p_store, p_product_id,
                                        p_event_timestamp, p_transferred_from, p_transferred_to, p_payload,
                                        p_payload_digest, p_sync_ids, p_correlation_id)
  $$;

create function public.billing_sync_context(p_app_user_id text, p_event_id text default null) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.billing_sync_context(p_app_user_id, p_event_id) $$;

create function public.billing_mark_event(p_event_id text, p_status text) returns void
  language sql
  security definer
  set search_path = ''
  as $$ select private.billing_mark_event(p_event_id, p_status) $$;

create function public.billing_apply_mirror(
  p_user uuid, p_rc_app_user_id text, p_snapshot jsonb, p_event_id text default null
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.billing_apply_mirror(p_user, p_rc_app_user_id, p_snapshot, p_event_id) $$;

comment on function public.record_billing_event(text, text, text, text, text, text, timestamptz, text[], text[], jsonb, bytea, text[], uuid) is
  'Service-role wrapper: WH-05 ledger insert (dedupe on event_id) + billing_sync jobs.';
comment on function public.billing_apply_mirror(uuid, text, jsonb, text) is
  'Service-role wrapper: JOB-24 / API-BIZ-03 mirror overwrite from a REST v2 snapshot.';

revoke execute on function
  public.record_billing_event(text, text, text, text, text, text, timestamptz, text[], text[], jsonb, bytea, text[], uuid),
  public.billing_sync_context(text, text),
  public.billing_mark_event(text, text),
  public.billing_apply_mirror(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function
  public.record_billing_event(text, text, text, text, text, text, timestamptz, text[], text[], jsonb, bytea, text[], uuid),
  public.billing_sync_context(text, text),
  public.billing_mark_event(text, text),
  public.billing_apply_mirror(uuid, text, jsonb, text)
  to service_role;
