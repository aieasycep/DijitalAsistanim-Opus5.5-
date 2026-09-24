-- Migration 20260924002100 · approvals, reminders and notification runtime (IMPLEMENTATION_PLAN
-- T-6.01…T-6.08; API_CONTRACTS §6, API-APR-01..05, API-REM-02/03, JOB-17/18; DATABASE_AND_RLS_PLAN
-- §4.4, §4.5, §6.6).
--
-- 1. `approval_actions.origin` accepts the proposed `insight` and `manual` origins of the
--    ApprovalOrigin contract (API_CONTRACTS §5.2).
-- 2. No duplicate pending proposal for the same origin (API-APR-01 domain uniqueness). Batch rows
--    (captures, multi-action sheets) share an origin by design and are excluded.
-- 3. `private.create_approval`: inserts a `pending` approval with key `approval:{id}:v1` and its
--    `approval_events` row in one transaction (clients never insert approvals, plan §5b).
-- 4. `private.start_device_execution`: device-target approvals move `approved|failed → executing` on
--    the destination installation and store the hash of a fresh one-time execution token (R-18).
-- 5. `private.schedule_reminder` / `private.cancel_reminder`: in-app reminders with their scheduled
--    push ledger row and `notification` job (API-REM-02/03).
-- Every function the Edge Functions call gets a service-role-only `public` wrapper.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ─── 1 · origin values ────────────────────────────────────────────────────────────────────────
alter table public.approval_actions drop constraint approval_actions_origin_check;
alter table public.approval_actions add constraint approval_actions_origin_check check (origin in (
  'reply_draft', 'assistant', 'voice', 'capture', 'plan_proposal', 'conflict_resolution', 'post_meeting',
  'email_detail', 'life_event', 'follow_up', 'reminder_sheet', 'commitment_detection', 'insight', 'manual')) not valid;
-- Validated in 20260924002101 (a separate transaction, so reads are never blocked).

-- ─── 2 · one pending proposal per origin ──────────────────────────────────────────────────────
-- Each migration runs in one transaction (tier C / Supabase), where CONCURRENTLY is impossible; the
-- partial index covers only pending rows, a small set bounded by the expiry sweep.
-- squawk-ignore require-concurrent-index-creation
create unique index approval_actions_pending_origin_key
  on public.approval_actions (user_id, origin, origin_ref_id, action_type)
  where status = 'pending' and origin_ref_id is not null and batch_id is null;

-- ─── 3 · create_approval ──────────────────────────────────────────────────────────────────────
-- p_row carries the proposal columns computed by the api (payload, exact change, side effects,
-- destination, provenance, expiry). The key is always `approval:{id}:v1`. A duplicate pending
-- proposal for the same origin raises `APPROVAL_PENDING_DUPLICATE:<existing id>` (23505).
create function private.create_approval(p_user uuid, p_row jsonb, p_actor text default 'user')
  returns public.approval_actions
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.approval_actions;
  v_id uuid := coalesce((p_row ->> 'id')::uuid, gen_random_uuid());
  v_existing uuid;
begin
  if p_user is null then
    raise exception 'VALIDATION_FAILED:user' using errcode = '22023';
  end if;
  if p_actor is null or p_actor not in ('user', 'system', 'worker') then
    raise exception 'VALIDATION_FAILED:actor' using errcode = '22023';
  end if;
  if coalesce(p_row ->> 'payload_hash_hex', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED:payload_hash' using errcode = '22023';
  end if;
  if (p_row ->> 'device_installation_id') is not null and not exists (
       select 1 from public.app_installations i
       where i.id = (p_row ->> 'device_installation_id')::uuid and i.user_id = p_user) then
    raise exception 'DEVICE_INSTALLATION_MISMATCH' using errcode = '42501';
  end if;
  if (p_row ->> 'destination_account_id') is not null and not exists (
       select 1 from public.connected_accounts c
       where c.id = (p_row ->> 'destination_account_id')::uuid and c.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  begin
    insert into public.approval_actions (
      id, user_id, action_type, status, payload, payload_version, payload_hash, what, why, change_summary,
      side_effects, destination_account_id, destination_label, idempotency_key, origin, origin_ref_id,
      requires_scope, exact_change, batch_id, executor, device_installation_id, approval_expires_at,
      source_type, source_id, source_provider, source_timestamp, confidence, evidence)
    values (
      v_id, p_user, (p_row ->> 'action_type')::public.approval_action_type, 'pending', p_row -> 'payload', 1,
      decode(p_row ->> 'payload_hash_hex', 'hex'), p_row ->> 'what', p_row ->> 'why', p_row ->> 'change_summary',
      coalesce(p_row -> 'side_effects', '[]'::jsonb), (p_row ->> 'destination_account_id')::uuid,
      p_row ->> 'destination_label', 'approval:' || v_id || ':v1', p_row ->> 'origin',
      (p_row ->> 'origin_ref_id')::uuid, p_row ->> 'requires_scope', coalesce(p_row -> 'exact_change', '{}'::jsonb),
      (p_row ->> 'batch_id')::uuid, coalesce(p_row ->> 'executor', 'server'),
      (p_row ->> 'device_installation_id')::uuid, (p_row ->> 'approval_expires_at')::timestamptz,
      (p_row ->> 'source_type')::public.source_type, p_row ->> 'source_id',
      (p_row ->> 'source_provider')::public.provider, (p_row ->> 'source_timestamp')::timestamptz,
      (p_row ->> 'confidence')::numeric, coalesce(p_row -> 'evidence', '[]'::jsonb))
    returning * into a;
  exception when unique_violation then
    select x.id into v_existing from public.approval_actions x
    where x.user_id = p_user and x.status = 'pending' and x.batch_id is null
      and x.origin = p_row ->> 'origin' and x.origin_ref_id = (p_row ->> 'origin_ref_id')::uuid
      and x.action_type = (p_row ->> 'action_type')::public.approval_action_type
    limit 1;
    if v_existing is null then
      raise;
    end if;
    raise exception 'APPROVAL_PENDING_DUPLICATE:%', v_existing using errcode = '23505';
  end;

  insert into public.approval_events (user_id, approval_action_id, from_status, to_status, actor, actor_id,
                                      payload_version, idempotency_key, reason, correlation_id)
  values (a.user_id, a.id, null, 'pending', p_actor, case when p_actor = 'user' then p_user end, a.payload_version,
          a.idempotency_key, 'proposed', (p_row ->> 'correlation_id')::uuid);
  return a;
end
$$;

-- ─── 4 · start_device_execution ───────────────────────────────────────────────────────────────
-- The destination installation (p_installation = app_installations.id) starts or re-claims a
-- device-target approval: `approved → executing` (claim or approve on the destination),
-- `failed → executing` (retry after the app re-probed its marker) or, while already `executing` on
-- the same installation, a token rotation after an app restart. Only the sha256 of the one-time
-- token is stored. Server approvals and other installations are refused.
create function private.start_device_execution(p_id uuid, p_user uuid, p_installation uuid, p_token_hash bytea)
  returns public.approval_actions
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.approval_actions;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'VALIDATION_FAILED:device_token_hash' using errcode = '22023';
  end if;
  select * into a from public.approval_actions x where x.id = p_id and x.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.executor <> 'device' or a.device_installation_id is distinct from p_installation then
    raise exception 'DEVICE_INSTALLATION_MISMATCH' using errcode = '42501';
  end if;
  if a.status not in ('approved', 'failed', 'executing') then
    raise exception 'ILLEGAL_TRANSITION:%->executing', a.status using errcode = '55000';
  end if;
  update public.approval_actions x set device_token_hash = p_token_hash where x.id = p_id;
  if a.status = 'executing' then
    select * into a from public.approval_actions x where x.id = p_id;
    return a;
  end if;
  return private.transition_approval(p_id, 'executing', 'user', p_user, a.idempotency_key,
                                     case when a.status = 'failed' then 'device_retry' else 'device_claim' end);
end
$$;

-- ─── 5 · reminders ────────────────────────────────────────────────────────────────────────────
-- In-app reminder (API-REM-02). Idempotent on (user_id, idempotency_key): a replay returns the
-- existing row with created=false and writes nothing. A push reminder also gets its ledger row
-- (`decision='scheduled'`, dedupe key `reminder:{id}`) and the `notification` job at fire time;
-- the job key `reminder:{id}` is the one scheduler_tick uses, so there is never a second job.
create function private.schedule_reminder(p_user uuid, p_row jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.reminders;
  v_notification uuid;
  v_detail public.notification_detail;
begin
  insert into public.reminders (user_id, title, remind_at, preset, anchor_at, destination, origin, resolution_reason,
                                channel, status, target_type, target_id, idempotency_key, approval_action_id,
                                source_type, source_id, source_provider, source_timestamp, confidence)
  values (p_user, p_row ->> 'title', (p_row ->> 'remind_at')::timestamptz, p_row ->> 'preset',
          (p_row ->> 'anchor_at')::timestamptz, coalesce(p_row -> 'destination', '{"kind":"in_app"}'::jsonb),
          coalesce(p_row ->> 'origin', 'today'), p_row ->> 'resolution_reason', coalesce(p_row ->> 'channel', 'push'),
          'scheduled', p_row ->> 'target_type', (p_row ->> 'target_id')::uuid, p_row ->> 'idempotency_key',
          (p_row ->> 'approval_action_id')::uuid, coalesce((p_row ->> 'source_type')::public.source_type, 'user_input'),
          coalesce(p_row ->> 'source_id', p_user::text), (p_row ->> 'source_provider')::public.provider,
          coalesce((p_row ->> 'source_timestamp')::timestamptz, now()), (p_row ->> 'confidence')::numeric)
  on conflict (user_id, idempotency_key) do nothing
  returning * into r;

  if r.id is null then
    select * into r from public.reminders x
    where x.user_id = p_user and x.idempotency_key = p_row ->> 'idempotency_key';
    return jsonb_build_object('created', false, 'reminder', to_jsonb(r));
  end if;

  if r.channel = 'push' then
    select coalesce(np.detail_level, 'title_only') into v_detail
    from public.notification_preferences np where np.user_id = p_user;
    insert into public.notifications (user_id, category, decision, dedupe_key, priority, detail_mode, data, entity_type,
                                      entity_id, interruption_level, android_channel, scheduled_for)
    values (p_user, coalesce((p_row ->> 'category')::public.notification_category, 'deadline'), 'scheduled',
            'reminder:' || r.id, 70, coalesce(v_detail, 'title_only'),
            jsonb_build_object('type', 'reminder', 'entity_id', r.id, 'deeplink', 'dijitalasistan://today'),
            'reminder', r.id, 'time_sensitive', 'reminders', r.remind_at)
    on conflict (user_id, dedupe_key) do nothing
    returning id into v_notification;
    if v_notification is null then
      select n.id into v_notification from public.notifications n
      where n.user_id = p_user and n.dedupe_key = 'reminder:' || r.id;
    end if;
    update public.reminders x set notification_id = v_notification where x.id = r.id returning * into r;
    update public.notifications n
      set job_id = private.enqueue_job('notification', 'reminder:' || r.id,
                                       jsonb_build_object('user_id', p_user, 'notification_id', v_notification,
                                                          'trigger', 'reminder', 'reminder_id', r.id),
                                       p_user, null, r.remind_at, 10, 5, (p_row ->> 'correlation_id')::uuid)
    where n.id = v_notification;
  end if;
  return jsonb_build_object('created', true, 'reminder', to_jsonb(r));
end
$$;

-- Cancel (API-REM-03): only `scheduled` rows change; a terminal row is returned as is. The pending
-- push job fails with CANCELLED and its ledger row is suppressed (the item is no longer relevant).
create function private.cancel_reminder(p_user uuid, p_id uuid, p_reason text default 'user_cancel')
  returns public.reminders
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.reminders;
begin
  select * into r from public.reminders x where x.id = p_id and x.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.status <> 'scheduled' then
    return r;
  end if;
  update public.reminders x set status = 'cancelled', cancelled_at = now() where x.id = p_id returning * into r;
  update public.jobs j
    set status = 'failed', last_error_code = 'CANCELLED', last_error_message = left(coalesce(p_reason, 'user_cancel'), 500),
        lease_owner = null, lease_expires_at = null, completed_at = now()
  where j.idempotency_key = 'reminder:' || p_id and j.status in ('queued', 'retrying');
  update public.notifications n
    set decision = 'suppressed', suppression_reason = 'low_relevance'
  where n.user_id = p_user and n.dedupe_key = 'reminder:' || p_id and n.decision = 'scheduled';
  return r;
end
$$;

-- ─── Service-role wrappers ────────────────────────────────────────────────────────────────────
create function public.create_approval(p_user uuid, p_row jsonb, p_actor text default 'user')
  returns public.approval_actions
  language sql
  security definer
  set search_path = ''
  as $$ select private.create_approval(p_user, p_row, p_actor) $$;

create function public.start_device_execution(p_id uuid, p_user uuid, p_installation uuid, p_token_hash bytea)
  returns public.approval_actions
  language sql
  security definer
  set search_path = ''
  as $$ select private.start_device_execution(p_id, p_user, p_installation, p_token_hash) $$;

create function public.schedule_reminder(p_user uuid, p_row jsonb) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.schedule_reminder(p_user, p_row) $$;

create function public.cancel_reminder(p_user uuid, p_id uuid, p_reason text default 'user_cancel')
  returns public.reminders
  language sql
  security definer
  set search_path = ''
  as $$ select private.cancel_reminder(p_user, p_id, p_reason) $$;

comment on function public.create_approval(uuid, jsonb, text) is
  'Service-role wrapper: inserts a pending approval and its approval_events row (API-APR-01).';
comment on function public.start_device_execution(uuid, uuid, uuid, bytea) is
  'Service-role wrapper: device-target approval → executing with a fresh execution token hash (API-APR-03/05, R-18).';
comment on function public.schedule_reminder(uuid, jsonb) is
  'Service-role wrapper: idempotent in-app reminder with its scheduled push (API-REM-02).';
comment on function public.cancel_reminder(uuid, uuid, text) is
  'Service-role wrapper: cancels a scheduled reminder and its pending push (API-REM-03).';

revoke execute on function
  private.create_approval(uuid, jsonb, text),
  private.start_device_execution(uuid, uuid, uuid, bytea),
  private.schedule_reminder(uuid, jsonb),
  private.cancel_reminder(uuid, uuid, text)
  from public;

revoke execute on function
  public.create_approval(uuid, jsonb, text),
  public.start_device_execution(uuid, uuid, uuid, bytea),
  public.schedule_reminder(uuid, jsonb),
  public.cancel_reminder(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.create_approval(uuid, jsonb, text),
  public.start_device_execution(uuid, uuid, uuid, bytea),
  public.schedule_reminder(uuid, jsonb),
  public.cancel_reminder(uuid, uuid, text)
  to service_role;
