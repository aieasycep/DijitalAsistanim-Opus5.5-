-- Migration · privacy engine: data export requests, history deletion (both scopes), account
-- deletion steps, privacy tombstones and the schema-driven "no rows remain" check
-- (IMPLEMENTATION_PLAN T-11.01…T-11.03).
-- Spec: docs/API_CONTRACTS.md API-PRV-01…04, JOB-21…JOB-23, JOB-31; docs/SECURITY_AND_PRIVACY_PLAN.md
-- §4.6–§4.8; docs/DATABASE_AND_RLS_PLAN.md §4.8, §6.4; plan R-16.
--
-- Every function here is called by the `api` or `worker` Edge Function with the secret key (through
-- the public service-role wrappers at the end); the user id always comes from verified claims or
-- from the request row, never from a request body.
--
-- History deletion (decision, recorded in the T-11.02 report): `private.purge_history` follows the
-- scope of `private.purge_user_history` (DATABASE_AND_RLS_PLAN §6.4) with the promises shown in the
-- consequences sheet (privacy.history.willKeep / pendingCancelled) and in SECURITY_AND_PRIVACY_PLAN
-- §4.7: open and snoozed commitments, scheduled reminders, in-flight approvals, user-authored
-- meeting notes (and the past events they belong to) and future events are kept; pending approvals
-- are expired with reason `history_deleted`. It also serves the single-account scope (API-PRV-02
-- `connected_account`, JOB-22) by restricting every delete to rows of, or derived from, that account.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Columns ══════════════════════════════════════════════════════════════════════════════════
-- API-PRV-01 `include` (null = every section). Validated in 20260924002590.
alter table public.data_export_requests add column include text[];
alter table public.data_export_requests
  add constraint data_export_requests_include_check check (
    include is null or (cardinality(include) between 1 and 18 and include <@ array[
      'profile', 'preferences', 'integrations_meta', 'email_metadata', 'insights', 'briefings', 'commitments',
      'reminders', 'tasks', 'calendar_events', 'assistant', 'captures', 'memory', 'ai_feedback', 'approvals',
      'notifications', 'subscriptions', 'referrals']::text[])) not valid;
comment on column public.data_export_requests.include is
  'Sections of the export (API-PRV-01 ExportBody.include); null exports every section.';
grant select (include) on table public.data_export_requests to authenticated;

-- JOB-31 recipient of the deletion confirmation (API_CONTRACTS "Proposed additions"): the address is
-- AES-GCM encrypted by the worker (never readable by clients: no column grant), resolved only when
-- the e-mail is sent and wiped right after.
alter table public.data_deletion_requests add column notify_email_ciphertext bytea;
alter table public.data_deletion_requests add column notify_locale text;
alter table public.data_deletion_requests
  add constraint data_deletion_requests_notify_email_ciphertext_check
    check (notify_email_ciphertext is null or octet_length(notify_email_ciphertext) between 30 and 2048) not valid;
alter table public.data_deletion_requests
  add constraint data_deletion_requests_notify_locale_check
    check (notify_locale is null or notify_locale in ('tr', 'en')) not valid;
comment on column public.data_deletion_requests.notify_email_ciphertext is
  'version(1) ‖ iv(12) ‖ AES-256-GCM ciphertext of the confirmation address (JOB-31); wiped after sending.';

-- ═══ API-PRV-01 · export request ══════════════════════════════════════════════════════════════
-- One export in flight per user: an existing requested/processing export is returned with
-- created=false (the route answers STATE_CONFLICT {active_request_id}). Otherwise the request,
-- its `export` job (JOB-21, key export:{id}) and the audit row commit together.
create function private.create_export_request(p_user uuid, p_include text[] default null, p_correlation_id uuid default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_active public.data_export_requests;
  v_id uuid;
  v_job uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('export_request:' || p_user::text));
  select * into v_active from public.data_export_requests x
  where x.user_id = p_user and x.status in ('requested', 'processing')
  order by x.created_at desc limit 1;
  if found then
    return jsonb_build_object('created', false, 'request_id', v_active.id, 'status', v_active.status);
  end if;
  insert into public.data_export_requests (user_id, requested_via, include)
  values (p_user, 'app', case when cardinality(p_include) > 0 then p_include end)
  returning id into v_id;
  v_job := private.enqueue_job('export', 'export:' || v_id,
                               jsonb_build_object('data_export_request_id', v_id, 'user_id', p_user),
                               p_user, null, now(), 60, 4, p_correlation_id);
  update public.data_export_requests x set job_id = v_job where x.id = v_id;
  perform private.audit_log_append('user', p_user, null, 'user.privacy.export_requested', 'data_export_request',
                                   v_id::text, p_user, null, 'success',
                                   jsonb_build_object('sections', coalesce(cardinality(p_include), 0)), p_correlation_id);
  return jsonb_build_object('created', true, 'request_id', v_id, 'status', 'requested', 'job_id', v_job);
end
$$;

-- ═══ API-PRV-02 / JOB-22 · history deletion ═══════════════════════════════════════════════════

-- Text ids of the content rows of one connected account (the `source_id` of rows derived from them).
create function private.history_source_ids(p_user uuid, p_account uuid) returns table (source_id text)
  language sql stable
  set search_path = ''
  as $$
    select t.id::text from public.email_threads t where t.user_id = p_user and t.connected_account_id = p_account
    union all
    select m.id::text from public.email_messages m where m.user_id = p_user and m.connected_account_id = p_account
    union all
    select e.id::text from public.calendar_events e where e.user_id = p_user and e.connected_account_id = p_account
  $$;

-- What a history deletion removes, counted before it is queued (API-PRV-02 will_delete). The
-- whole-history numbers match RPC-19 history_deletion_preview; the account scope counts the rows of
-- that account and the rows derived from it.
create function private.history_deletion_counts(p_user uuid, p_account uuid default null) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  v_all boolean := p_account is null;
  v_insights integer;
begin
  if not v_all and not exists (select 1 from public.connected_accounts c where c.id = p_account and c.user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select count(*)::integer into v_insights from public.insights i
  where i.user_id = p_user
    and (v_all or i.source_id in (select s.source_id from private.history_source_ids(p_user, p_account) s));
  return jsonb_build_object(
    'summaries',
      (select count(*)::integer from public.email_threads t
       where t.user_id = p_user and (v_all or t.connected_account_id = p_account)
         and not exists (select 1 from public.reply_drafts r join public.approval_actions a on a.id = r.approval_action_id
                         where r.thread_id = t.id and a.status in ('pending', 'approved', 'executing')))
      + (case when v_all then (select count(*)::integer from public.briefings b where b.user_id = p_user) else 0 end)
      + (select count(*)::integer from public.meeting_preps p
         where p.user_id = p_user
           and (v_all or p.calendar_event_id in (select e.id from public.calendar_events e
                                                 where e.user_id = p_user and e.connected_account_id = p_account))),
    'priority_decisions', v_insights,
    'memory_chunks',
      (select count(*)::integer from public.memory_chunks m
       where m.user_id = p_user
         and (v_all or m.source_id in (select s.source_id from private.history_source_ids(p_user, p_account) s))),
    'assistant_threads',
      case when v_all then (select count(*)::integer from public.assistant_threads a where a.user_id = p_user) else 0 end,
    'learned_preferences',
      case when v_all then (select count(*)::integer from public.learned_preferences lp where lp.user_id = p_user) else 0 end,
    'insights', v_insights,
    'briefings',
      case when v_all then (select count(*)::integer from public.briefings b where b.user_id = p_user) else 0 end);
end
$$;

-- Deletes the analysis history of one user (p_account null) or of one connected account and
-- returns {deleted:{table:n}, storage_paths:{bucket:[…]}}; the worker removes the returned objects
-- through the Storage API. Idempotent: a second run deletes nothing more.
create function private.purge_history(p_user uuid, p_account uuid default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_all boolean := p_account is null;
  v_sources text[] := '{}'::text[];
  v_account_events uuid[] := '{}'::uuid[];
  v_deleted jsonb := '{}'::jsonb;
  v_captures text[] := '{}'::text[];
  v_drafts text[] := '{}'::text[];
  v_audio text[] := '{}'::text[];
  v_expired integer := 0;
  v_approval uuid;
  v_n bigint;
begin
  if p_user is null then
    raise exception 'VALIDATION_FAILED:user' using errcode = '22023';
  end if;
  if not v_all then
    if not exists (select 1 from public.connected_accounts c where c.id = p_account and c.user_id = p_user) then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    select coalesce(array_agg(s.source_id), '{}') into v_sources from private.history_source_ids(p_user, p_account) s;
    select coalesce(array_agg(e.id), '{}') into v_account_events from public.calendar_events e
    where e.user_id = p_user and e.connected_account_id = p_account;
  end if;

  -- Pending approvals are cancelled (the sheet says "Bekleyen onaylar iptal edilir").
  for v_approval in
    select a.id from public.approval_actions a
    where a.user_id = p_user and a.status = 'pending' and (v_all or a.source_id = any(v_sources))
  loop
    perform private.transition_approval(v_approval, 'expired', 'system', null, null, 'history_deleted');
    v_expired := v_expired + 1;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('approvals_expired', v_expired);

  -- ── Derived rows ──
  with d as (delete from public.insights t
             where t.user_id = p_user and (v_all or t.source_id = any(v_sources)) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('insights', v_n);

  with d as (delete from public.life_events t
             where t.user_id = p_user and (v_all or t.source_id = any(v_sources)) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('life_events', v_n);

  with d as (delete from public.briefing_items t
             where t.user_id = p_user and (v_all or t.source_id = any(v_sources)) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('briefing_items', v_n);

  if v_all then
    with d as (delete from public.briefings t where t.user_id = p_user
               returning t.user_id, t.id, t.version, t.audio_status, t.audio_storage_path)
    select count(*), coalesce((select array_agg(p) from d d2
                               cross join lateral unnest(private.briefing_audio_paths(d2.user_id, d2.id, d2.version)) as u (p)
                               where d2.audio_status <> 'none' or d2.audio_storage_path is not null), '{}')
      into v_n, v_audio from d;
    v_deleted := v_deleted || jsonb_build_object('briefings', v_n);
  end if;

  with d as (delete from public.memory_chunks t
             where t.user_id = p_user and (v_all or t.source_id = any(v_sources)) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('memory_chunks', v_n);

  if v_all then
    with d as (delete from public.assistant_threads t where t.user_id = p_user returning 1) select count(*) into v_n from d;
    v_deleted := v_deleted || jsonb_build_object('assistant_threads', v_n);

    with d as (delete from public.learned_preferences t where t.user_id = p_user returning 1) select count(*) into v_n from d;
    v_deleted := v_deleted || jsonb_build_object('learned_preferences', v_n);

    with d as (delete from public.ai_feedback t where t.user_id = p_user returning 1) select count(*) into v_n from d;
    v_deleted := v_deleted || jsonb_build_object('ai_feedback', v_n);
  end if;

  with d as (delete from public.meeting_preps t
             where t.user_id = p_user and (v_all or t.calendar_event_id = any(v_account_events)) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('meeting_preps', v_n);

  -- Open and snoozed commitments stay ("açık taahhütlerin korunur"); finished ones are history.
  with d as (delete from public.commitments t
             where t.user_id = p_user and t.status in ('done', 'cancelled') and (v_all or t.source_id = any(v_sources))
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('commitments', v_n);

  with d as (delete from public.reminders t
             where t.user_id = p_user and t.status <> 'scheduled' and (v_all or t.source_id = any(v_sources)) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('reminders', v_n);

  with d as (delete from public.approval_actions t
             where t.user_id = p_user and t.status in ('rejected', 'executed', 'failed', 'expired')
               and (v_all or t.source_id = any(v_sources))
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('approval_actions', v_n);

  -- Drafts referenced by an in-flight approval stay until it finishes.
  with d as (delete from public.reply_drafts t
             where t.user_id = p_user and (v_all or t.connected_account_id = p_account)
               and not exists (select 1 from public.approval_actions a
                               where a.id = t.approval_action_id and a.status in ('pending', 'approved', 'executing'))
             returning t.attachments)
  select count(*), coalesce((select array_agg(p) from d d2 cross join lateral unnest(private.reply_attachment_paths(d2.attachments)) as u (p)), '{}')
    into v_n, v_drafts from d;
  v_deleted := v_deleted || jsonb_build_object('reply_drafts', v_n);

  if v_all then
    with d as (delete from public.captures t where t.user_id = p_user returning t.storage_path, t.file_deleted_at)
    select count(*), coalesce(array_agg(d.storage_path) filter (where d.storage_path is not null and d.file_deleted_at is null), '{}')
      into v_n, v_captures from d;
    v_deleted := v_deleted || jsonb_build_object('captures', v_n);

    with d as (delete from public.notifications t where t.user_id = p_user returning 1) select count(*) into v_n from d;
    v_deleted := v_deleted || jsonb_build_object('notifications', v_n);

    with d as (delete from public.android_notification_signals t where t.user_id = p_user returning 1) select count(*) into v_n from d;
    v_deleted := v_deleted || jsonb_build_object('android_notification_signals', v_n);

    with d as (delete from public.ai_result_cache t where t.user_id = p_user returning 1) select count(*) into v_n from d;
    v_deleted := v_deleted || jsonb_build_object('ai_result_cache', v_n);
  end if;

  -- ── Content mirrors (the provider keeps the originals) ──
  with d as (delete from public.email_messages t
             where t.user_id = p_user and (v_all or t.connected_account_id = p_account) returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('email_messages', v_n);

  with d as (delete from public.email_threads t
             where t.user_id = p_user and (v_all or t.connected_account_id = p_account)
               and not exists (select 1 from public.reply_drafts r where r.thread_id = t.id)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('email_threads', v_n);

  -- Past events go; future events and events that carry the user's own meeting notes stay.
  with d as (delete from public.calendar_events t
             where t.user_id = p_user and (v_all or t.connected_account_id = p_account) and t.end_at < now()
               and not exists (select 1 from public.meeting_notes n where n.calendar_event_id = t.id)
             returning 1)
  select count(*) into v_n from d;
  v_deleted := v_deleted || jsonb_build_object('calendar_events', v_n);

  -- Cursors stay, so old mail is not re-ingested (DATABASE_AND_RLS_PLAN §6.4).
  update public.sync_states s set backfill_until = now()
  where s.user_id = p_user and (v_all or s.connected_account_id = p_account);

  return jsonb_build_object(
    'deleted', v_deleted,
    'storage_paths', jsonb_build_object('captures', to_jsonb(v_captures || v_drafts), 'briefing-audio', to_jsonb(v_audio)));
end
$$;

-- ═══ Deletion request status (JOB-22, JOB-23; honest status, M§129) ════════════════════════════
-- Merges `p_steps` into `steps` and moves the status along the only honest edges:
-- requested/verified/queued/failed → processing → completed | failed. `completed` and `cancelled`
-- are terminal (only steps may still be recorded on a completed request, e.g. the confirmation
-- e-mail). `p_notify` stores (or with p_clear_notify wipes) the confirmation address ciphertext.
create function private.deletion_request_update(
  p_request uuid, p_status public.deletion_status default null, p_steps jsonb default '{}'::jsonb,
  p_error_code text default null, p_notify bytea default null, p_notify_locale text default null,
  p_clear_notify boolean default false
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  d public.data_deletion_requests;
begin
  select * into d from public.data_deletion_requests x where x.id = p_request for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_status is not null and p_status is distinct from d.status then
    if not ((d.status in ('requested', 'verified', 'queued', 'failed') and p_status = 'processing')
            or (d.status = 'processing' and p_status in ('completed', 'failed'))) then
      raise exception 'ILLEGAL_TRANSITION:%->%', d.status, p_status using errcode = '55000';
    end if;
  end if;
  if d.status = 'cancelled' and p_steps <> '{}'::jsonb then
    raise exception 'ILLEGAL_TRANSITION:cancelled' using errcode = '55000';
  end if;
  update public.data_deletion_requests x
    set status = coalesce(p_status, x.status),
        steps = x.steps || coalesce(p_steps, '{}'::jsonb),
        completed_at = case when p_status = 'completed' then now() else x.completed_at end,
        failed_at = case when p_status = 'failed' then now() when p_status = 'processing' then null else x.failed_at end,
        error_code = case when p_status = 'failed' then left(p_error_code, 80)
                          when p_status in ('processing', 'completed') then null else x.error_code end,
        notify_email_ciphertext = case when p_clear_notify then null else coalesce(p_notify, x.notify_email_ciphertext) end,
        notify_locale = case when p_clear_notify then null else coalesce(p_notify_locale, x.notify_locale) end
  where x.id = p_request
  returning * into d;
  return jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status, 'steps', d.steps, 'user_id', d.user_id,
                            'completed_at', d.completed_at);
end
$$;

-- ═══ JOB-23 · account deletion ════════════════════════════════════════════════════════════════

-- Everything the job needs before the auth user is gone: the sign-in address (tombstone and
-- confirmation e-mail), locale, installation ids, Apple subject, connected accounts, active
-- provider watches and the subscription mirror. Service role only; never logged.
create function private.account_deletion_context(p_user uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'user_exists', exists (select 1 from auth.users u where u.id = p_user),
      'email', (select u.email::text from auth.users u where u.id = p_user),
      'locale', (select p.locale from public.profiles p where p.user_id = p_user),
      'installation_ids', coalesce((select jsonb_agg(i.installation_id order by i.created_at)
                                    from public.app_installations i where i.user_id = p_user), '[]'::jsonb),
      'apple_sub', private.user_apple_sub(p_user),
      'accounts', coalesce((select jsonb_agg(jsonb_build_object(
                                     'id', c.id, 'provider', c.provider, 'provider_account_id', c.provider_account_id,
                                     'email', c.account_email::text, 'tenant_id', c.tenant_id, 'tenant_type', c.tenant_type,
                                     'capabilities', to_jsonb(c.capabilities_granted), 'toggles', c.data_source_toggles,
                                     'status', c.status) order by c.created_at)
                            from public.connected_accounts c where c.user_id = p_user), '[]'::jsonb),
      'watches', coalesce((select jsonb_agg(jsonb_build_object(
                                    'connected_account_id', s.connected_account_id, 'resource', s.resource,
                                    'resource_key', s.resource_key, 'watch_kind', s.watch_kind, 'watch_id', s.watch_id,
                                    'watch_resource_id', s.watch_resource_id, 'watch_expires_at', s.watch_expires_at)
                                  order by s.created_at)
                           from public.sync_states s
                           where s.user_id = p_user and s.watch_kind <> 'none' and s.watch_id is not null), '[]'::jsonb),
      'subscription', (select jsonb_build_object('rc_app_user_id', s.rc_app_user_id, 'store', s.store, 'is_active', s.is_active)
                       from public.subscriptions s where s.user_id = p_user order by s.updated_at desc limit 1))
  $$;

-- Step 1: the request moves to processing (a cancelled or completed request is reported, never
-- touched), the profile is deletion_pending, push is disabled, pending approvals expire and every
-- other queued job of the user is cancelled.
create function private.account_deletion_begin(p_request uuid, p_user uuid, p_job uuid default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  d public.data_deletion_requests;
  v_approval uuid;
  v_jobs bigint := 0;
begin
  select * into d from public.data_deletion_requests x where x.id = p_request for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.kind <> 'account' then
    raise exception 'VALIDATION_FAILED:kind' using errcode = '22023';
  end if;
  -- After the auth user is gone (a resumed run) the request keeps only the subject hash.
  if (d.user_id is not null and d.user_id <> p_user)
     or (d.user_id is null and d.subject_hash <> private.hash_subject(p_user)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if d.status in ('cancelled', 'completed') then
    return jsonb_build_object('state', d.status, 'steps', d.steps, 'user_id', d.user_id);
  end if;
  update public.data_deletion_requests x
    set status = 'processing', failed_at = null, error_code = null, job_id = coalesce(p_job, x.job_id)
  where x.id = p_request;

  if exists (select 1 from auth.users u where u.id = p_user) then
    update public.profiles p set state = 'deletion_pending' where p.user_id = p_user and p.state <> 'deletion_pending';
    update public.push_tokens t set status = 'disabled', disabled_reason = 'account_deleted'
    where t.user_id = p_user and t.status = 'active';
    for v_approval in select a.id from public.approval_actions a where a.user_id = p_user and a.status = 'pending' loop
      perform private.transition_approval(v_approval, 'expired', 'system', null, null, 'account_deletion');
    end loop;
    with c as (update public.jobs j
                 set status = 'failed', last_error_code = 'CANCELLED', last_error_message = 'account deletion in progress',
                     lease_owner = null, lease_expires_at = null
               where (j.user_id = p_user or j.payload ->> 'user_id' = p_user::text)
                 and j.status in ('queued', 'retrying') and j.type <> 'account_deletion'
                 and (p_job is null or j.id <> p_job)
               returning 1)
    select count(*) into v_jobs from c;
  end if;
  return jsonb_build_object('state', 'processing', 'steps', d.steps, 'user_id', d.user_id, 'jobs_cancelled', v_jobs,
                            'has_notify_email', d.notify_email_ciphertext is not null, 'origin', d.origin);
end
$$;

-- Step "system tables" (SECURITY_AND_PRIVACY_PLAN §4.8 step 7, JOB-23 step 6): rows that would not
-- cascade with the auth user are deleted or pseudonymised. Finance rows keep their amounts with the
-- subject hash in place of the user id; support tickets are anonymised; the user's other jobs go.
create function private.account_deletion_system_purge(p_user uuid, p_job uuid default null) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_subject text := encode(private.hash_subject(p_user), 'hex');
  v_result jsonb := '{}'::jsonb;
  v_n bigint;
begin
  with d as (delete from public.analytics_events t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_result := v_result || jsonb_build_object('analytics_events', v_n);

  with d as (delete from public.ai_requests t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_result := v_result || jsonb_build_object('ai_requests', v_n);

  with d as (delete from public.webhook_events t where t.user_id = p_user returning 1) select count(*) into v_n from d;
  v_result := v_result || jsonb_build_object('webhook_events', v_n);

  with d as (delete from public.jobs j
             where (j.user_id = p_user or j.payload ->> 'user_id' = p_user::text or j.payload ->> 'app_user_id' = p_user::text)
               and j.type <> 'account_deletion' and (p_job is null or j.id <> p_job)
             returning 1)
  select count(*) into v_n from d;
  v_result := v_result || jsonb_build_object('jobs', v_n);

  with d as (update public.support_notes n set user_id = null where n.user_id = p_user returning 1)
  select count(*) into v_n from d;
  v_result := v_result || jsonb_build_object('support_notes_anonymized', v_n);

  with d as (update public.support_tickets t
               set user_id = null, contact_email = null, contact_name = null, app_version = null
             where t.user_id = p_user returning 1)
  select count(*) into v_n from d;
  v_result := v_result || jsonb_build_object('support_tickets_anonymized', v_n);

  -- RevenueCat ledger: finance fields stay (10-year hold); every identifier becomes the subject hash.
  with d as (update public.billing_events b
               set user_id = null,
                   rc_app_user_id = v_subject,
                   transferred_from = array_replace(b.transferred_from, p_user::text, v_subject),
                   transferred_to = array_replace(b.transferred_to, p_user::text, v_subject),
                   payload = jsonb_build_object('pseudonymized', true, 'event',
                     coalesce((select jsonb_object_agg(e.key, e.value)
                               from jsonb_each(case when jsonb_typeof(b.payload -> 'event') = 'object' then b.payload -> 'event'
                                                    else '{}'::jsonb end) as e (key, value)
                               where e.key in ('id', 'type', 'product_id', 'period_type', 'purchased_at_ms', 'expiration_at_ms',
                                               'event_timestamp_ms', 'environment', 'store', 'price', 'currency',
                                               'price_in_purchased_currency', 'takehome_percentage', 'tax_percentage',
                                               'commission_percentage', 'country_code', 'is_trial_conversion', 'renewal_number',
                                               'cancel_reason', 'expiration_reason')), '{}'::jsonb))
             where b.user_id = p_user or b.rc_app_user_id = p_user::text
             returning 1)
  select count(*) into v_n from d;
  v_result := v_result || jsonb_build_object('billing_events_pseudonymized', v_n);

  return v_result;
end
$$;

-- Hashed anti-abuse signals kept 12 months after the account is gone (DATABASE_AND_RLS_PLAN §4.8).
-- p_signals = [{kind, hash}] with the HMAC hex computed by the worker (HASH_PEPPER never reaches SQL);
-- a repeated signal extends its expiry.
create function private.privacy_tombstones_upsert(p_signals jsonb) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_n bigint;
begin
  with s as (
    select distinct x.kind, decode(x.hash, 'hex') as signal_hash
    from jsonb_to_recordset(case when jsonb_typeof(p_signals) = 'array' then p_signals else '[]'::jsonb end) as x (kind text, hash text)
    where x.kind in ('email', 'installation', 'apple_sub') and x.hash ~ '^[0-9a-f]{64}$'),
  i as (
    insert into public.privacy_tombstones as t (kind, signal_hash, reason, expires_at)
    select s.kind, s.signal_hash, 'account_deleted', now() + interval '12 months' from s
    on conflict (kind, signal_hash) do update set expires_at = greatest(t.expires_at, excluded.expires_at)
    returning 1)
  select count(*) into v_n from i;
  return v_n::integer;
end
$$;

-- Schema-driven verification (JOB-23 test, SECURITY_AND_PRIVACY_PLAN §4.8 step 10): every public
-- table with a uuid `user_id` / `referrer_id` / `referee_id` column must hold no row for the user,
-- and no object may remain under the user's storage prefix. Returns {"table.column": n} for the
-- rows that remain (empty object = clean).
create function private.user_rows_remaining(p_user uuid) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  r record;
  v_sql text;
  v_n bigint;
  v_result jsonb := '{}'::jsonb;
begin
  for r in
    select c.relname as table_name, a.attname as column_name
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and a.atttypid = 'uuid'::regtype and a.attname in ('user_id', 'referrer_id', 'referee_id')
    order by 1, 2
  loop
    v_sql := format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name);
    execute v_sql into v_n using p_user;
    if v_n > 0 then
      v_result := v_result || jsonb_build_object(r.table_name || '.' || r.column_name, v_n);
    end if;
  end loop;
  select count(*) into v_n from storage.objects o
  where o.bucket_id in ('captures', 'exports', 'briefing-audio') and o.name like p_user::text || '/%';
  if v_n > 0 then
    v_result := v_result || jsonb_build_object('storage.objects', v_n);
  end if;
  return v_result;
end
$$;

-- ═══ Privileges and service-role wrappers ═════════════════════════════════════════════════════
revoke execute on function
  private.create_export_request(uuid, text[], uuid),
  private.history_source_ids(uuid, uuid),
  private.history_deletion_counts(uuid, uuid),
  private.purge_history(uuid, uuid),
  private.deletion_request_update(uuid, public.deletion_status, jsonb, text, bytea, text, boolean),
  private.account_deletion_context(uuid),
  private.account_deletion_begin(uuid, uuid, uuid),
  private.account_deletion_system_purge(uuid, uuid),
  private.privacy_tombstones_upsert(jsonb),
  private.user_rows_remaining(uuid)
  from public;
grant execute on function
  private.create_export_request(uuid, text[], uuid),
  private.history_source_ids(uuid, uuid),
  private.history_deletion_counts(uuid, uuid),
  private.purge_history(uuid, uuid),
  private.deletion_request_update(uuid, public.deletion_status, jsonb, text, bytea, text, boolean),
  private.account_deletion_context(uuid),
  private.account_deletion_begin(uuid, uuid, uuid),
  private.account_deletion_system_purge(uuid, uuid),
  private.privacy_tombstones_upsert(jsonb),
  private.user_rows_remaining(uuid)
  to service_role;

create function public.create_export_request(p_user uuid, p_include text[] default null, p_correlation_id uuid default null)
  returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.create_export_request(p_user, p_include, p_correlation_id) $$;

create function public.history_deletion_counts(p_user uuid, p_account uuid default null) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.history_deletion_counts(p_user, p_account) $$;

create function public.purge_history(p_user uuid, p_account uuid default null) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.purge_history(p_user, p_account) $$;

create function public.deletion_request_update(
  p_request uuid, p_status public.deletion_status default null, p_steps jsonb default '{}'::jsonb,
  p_error_code text default null, p_notify bytea default null, p_notify_locale text default null,
  p_clear_notify boolean default false
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$
    select private.deletion_request_update(p_request, p_status, p_steps, p_error_code, p_notify, p_notify_locale,
                                           p_clear_notify)
  $$;

create function public.account_deletion_context(p_user uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.account_deletion_context(p_user) $$;

create function public.account_deletion_begin(p_request uuid, p_user uuid, p_job uuid default null) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.account_deletion_begin(p_request, p_user, p_job) $$;

create function public.account_deletion_system_purge(p_user uuid, p_job uuid default null) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.account_deletion_system_purge(p_user, p_job) $$;

create function public.privacy_tombstones_upsert(p_signals jsonb) returns integer
  language sql
  security definer
  set search_path = ''
  as $$ select private.privacy_tombstones_upsert(p_signals) $$;

create function public.user_rows_remaining(p_user uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.user_rows_remaining(p_user) $$;

revoke execute on function
  public.create_export_request(uuid, text[], uuid),
  public.history_deletion_counts(uuid, uuid),
  public.purge_history(uuid, uuid),
  public.deletion_request_update(uuid, public.deletion_status, jsonb, text, bytea, text, boolean),
  public.account_deletion_context(uuid),
  public.account_deletion_begin(uuid, uuid, uuid),
  public.account_deletion_system_purge(uuid, uuid),
  public.privacy_tombstones_upsert(jsonb),
  public.user_rows_remaining(uuid)
  from public, anon, authenticated;
grant execute on function
  public.create_export_request(uuid, text[], uuid),
  public.history_deletion_counts(uuid, uuid),
  public.purge_history(uuid, uuid),
  public.deletion_request_update(uuid, public.deletion_status, jsonb, text, bytea, text, boolean),
  public.account_deletion_context(uuid),
  public.account_deletion_begin(uuid, uuid, uuid),
  public.account_deletion_system_purge(uuid, uuid),
  public.privacy_tombstones_upsert(jsonb),
  public.user_rows_remaining(uuid)
  to service_role;
