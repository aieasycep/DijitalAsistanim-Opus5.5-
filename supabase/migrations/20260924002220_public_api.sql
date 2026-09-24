-- Migration · public-api: web support tickets, inbound support replies, web data deletion with
-- email OTP, deletion status, plans, referral resolve and web analytics (T-9.04/T-9.05 backend)
-- Spec: docs/API_CONTRACTS.md §13 PUB-01…PUB-08, §2.9 rate limits; docs/DATABASE_AND_RLS_PLAN.md
-- §4.7 (web_analytics_daily, rate_limits), §4.8 (data_deletion_requests), §4.10 (support_tickets,
-- support_notes); docs/BACKOFFICE_PLAN.md §6.4 (support_notes.kind, inbound replies).
--
-- Every function here is called by the public-api Edge Function with the secret key after its own
-- rate limits; nothing is reachable by anon or authenticated clients.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ PUB-01 · web support tickets ════════════════════════════════════════════════════════════
alter table public.support_tickets
  add column if not exists contact_name text check (char_length(contact_name) between 1 and 120);
comment on column public.support_tickets.contact_name is
  'Optional name given on the web support form (PUB-01); cleared with contact_email by account deletion.';

-- Creates a web ticket (origin web, platform web, no user link: never matched by e-mail to prevent
-- spoofing). The same e-mail and message within 10 minutes returns the existing reference.
create function private.public_support_ticket(
  p_email extensions.citext, p_name text, p_category public.ticket_category, p_subject text, p_message text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  t public.support_tickets;
begin
  perform pg_advisory_xact_lock(hashtext('public_support:' || lower(p_email::text)));
  select * into t from public.support_tickets x
  where x.origin = 'web' and lower(x.contact_email::text) = lower(p_email::text) and x.message = p_message
    and x.created_at > now() - interval '10 minutes'
  order by x.created_at desc limit 1;
  if found then
    return jsonb_build_object('id', t.id, 'reference', t.public_ref, 'duplicate', true);
  end if;
  insert into public.support_tickets (user_id, category, status, subject, message, contact_email, contact_name, platform, origin)
  values (null, p_category, 'open', left(p_subject, 200), p_message, p_email, nullif(btrim(p_name), ''), 'web', 'web')
  returning * into t;
  return jsonb_build_object('id', t.id, 'reference', t.public_ref, 'duplicate', false);
end
$$;

-- ═══ PUB-08 · inbound support replies ════════════════════════════════════════════════════════
-- support_notes.kind (BACKOFFICE_PLAN §16 row 14): internal and outbound replies have an admin
-- author; inbound replies from the requester and system notes have none.
alter table public.support_notes add column if not exists kind text not null default 'internal';
alter table public.support_notes
  add constraint support_notes_kind_values_check
    check (kind in ('internal', 'outbound_reply', 'inbound_reply', 'system'));
alter table public.support_notes alter column author_admin_id drop not null;
alter table public.support_notes
  add constraint support_notes_author_kind_check
    check (kind not in ('internal', 'outbound_reply') or author_admin_id is not null);

alter table public.webhook_events drop constraint webhook_events_source_check;
alter table public.webhook_events
  add constraint webhook_events_source_check
    check (source in ('google_gmail', 'google_calendar', 'microsoft_graph', 'microsoft_lifecycle', 'revenuecat',
                      'support_inbound'));

-- Stores one inbound reply as an `inbound_reply` note (≤ 5,000 characters) when the ticket exists
-- and the sender is the ticket's contact e-mail; moves waiting_user → open. The provider message
-- id dedupes replays through webhook_events (source support_inbound). Anything else is recorded
-- as ignored and nothing is stored.
create function private.support_inbound_note(
  p_message_id text, p_reference text, p_sender extensions.citext, p_body text, p_digest bytea
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_event bigint;
  t public.support_tickets;
  v_note uuid;
  v_reopened boolean := false;
begin
  insert into public.webhook_events (source, external_id, signature_valid, status, payload_digest, payload)
  values ('support_inbound', left(p_message_id, 300), true, 'received',
          coalesce(p_digest, pg_catalog.sha256(convert_to(p_message_id, 'UTF8'))),
          jsonb_build_object('reference', p_reference))
  on conflict (source, external_id) do nothing
  returning id into v_event;
  if v_event is null then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end if;
  select * into t from public.support_tickets x where x.public_ref = upper(p_reference) for update;
  if not found then
    update public.webhook_events w set status = 'ignored' where w.id = v_event;
    return jsonb_build_object('stored', false, 'reason', 'ticket_not_found');
  end if;
  if t.contact_email is null or p_sender is null or lower(t.contact_email::text) <> lower(p_sender::text) then
    update public.webhook_events w set status = 'ignored', user_id = t.user_id where w.id = v_event;
    return jsonb_build_object('stored', false, 'reason', 'sender_mismatch');
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    update public.webhook_events w set status = 'ignored', user_id = t.user_id where w.id = v_event;
    return jsonb_build_object('stored', false, 'reason', 'empty_body');
  end if;
  insert into public.support_notes (ticket_id, user_id, author_admin_id, kind, body)
  values (t.id, t.user_id, null, 'inbound_reply', left(p_body, 5000))
  returning id into v_note;
  if t.status = 'waiting_user' then
    update public.support_tickets x set status = 'open' where x.id = t.id;
    v_reopened := true;
  end if;
  update public.webhook_events w set status = 'enqueued', user_id = t.user_id where w.id = v_event;
  return jsonb_build_object('stored', true, 'ticket_id', t.id, 'note_id', v_note, 'reopened', v_reopened);
end
$$;

-- ADM-03 ticket detail lists every note kind (inbound replies have no admin author).
create or replace function admin_api.ticket_detail(p_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('support.read');
  t public.support_tickets;
begin
  select * into t from public.support_tickets x where x.id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', t.id, 'reference', t.public_ref, 'user', case when t.user_id is not null then private.admin_user_label(t.user_id) end,
    'category', t.category, 'status', t.status, 'priority', t.priority, 'subject', t.subject, 'message', t.message,
    'contact_email_masked', private.mask_email(t.contact_email), 'platform', t.platform, 'app_version', t.app_version,
    'origin', t.origin, 'assignee', t.assigned_admin_id, 'first_response_at', t.first_response_at,
    'resolved_at', t.resolved_at, 'closed_at', t.closed_at, 'created_at', t.created_at, 'updated_at', t.updated_at,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'author_admin_id', n.author_admin_id,
                                                          'author', a.display_name, 'body', n.body, 'created_at', n.created_at)
                                        order by n.created_at)
                       from public.support_notes n left join public.admin_users a on a.user_id = n.author_admin_id
                       where n.ticket_id = t.id), '[]'::jsonb));
end
$$;

-- ═══ PUB-02 / PUB-03 · web data deletion with e-mail OTP ═════════════════════════════════════
-- The account behind an e-mail (case-insensitive). Admin identities never receive a deletion code
-- (R-08); deleted auth users do not count.
create function private.public_deletion_subject(p_email extensions.citext) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'user_id', u.id,
      'is_admin', coalesce(u.raw_app_meta_data ->> 'da_kind', '') = 'admin',
      'state', (select p.state from public.profiles p where p.user_id = u.id))
    from auth.users u
    where lower(u.email) = lower(p_email::text) and u.deleted_at is null
    limit 1
  $$;

-- OTP lockout over rate_limits rows (SECURITY_AND_PRIVACY_PLAN §4.8): every failed verification of
-- a subject (the peppered e-mail hash) is one row `otp_fail:{subject}`; p_max failures within
-- p_window_seconds write a lock row `otp_lock:{subject}` that holds for p_lock_seconds.
create function private.public_otp_lock_seconds(p_subject text, p_lock_seconds integer default 3600) returns integer
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce((
      select greatest(0, ceil(p_lock_seconds - extract(epoch from now() - max(r.window_start))))::integer
      from public.rate_limits r
      where r.key = left('otp_lock:' || p_subject, 200) and r.window_start > now() - make_interval(secs => p_lock_seconds)), 0)
  $$;

create function private.public_otp_record_failure(
  p_subject text, p_max integer default 5, p_window_seconds integer default 900, p_lock_seconds integer default 3600
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_failures integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (left('otp_fail:' || p_subject, 200), clock_timestamp(), 1)
  on conflict (key, window_start) do update set count = r.count + 1;
  select coalesce(sum(r.count), 0) into v_failures from public.rate_limits r
  where r.key = left('otp_fail:' || p_subject, 200) and r.window_start > now() - make_interval(secs => p_window_seconds);
  if v_failures >= p_max then
    insert into public.rate_limits as r (key, window_start, count)
    values (left('otp_lock:' || p_subject, 200), now(), 1)
    on conflict (key, window_start) do update set count = r.count + 1;
    return jsonb_build_object('locked', true, 'failures', v_failures, 'retry_after', p_lock_seconds);
  end if;
  return jsonb_build_object('locked', false, 'failures', v_failures, 'retry_after', 0);
end
$$;

-- Creates the deletion request (or returns the user's active one of that kind, rotating its status
-- token so the new holder can follow it), then: account → profile deletion_pending, push tokens
-- disabled, account_deletion (JOB-23) enqueued; history → history_deletion (JOB-22) enqueued. The
-- insert, the state change, the job and the audit row commit together. Shared by PUB-03 and the
-- in-app privacy routes (T-11.02 / T-11.03).
create function private.create_deletion_request(
  p_user uuid, p_kind public.deletion_kind, p_origin text, p_confirmation text, p_status_token_hash bytea,
  p_subject_email_hash bytea default null, p_scope text default null, p_account uuid default null,
  p_source text default 'app', p_correlation_id uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  d public.data_deletion_requests;
  v_job uuid;
begin
  if p_source not in ('app', 'web', 'admin') then
    raise exception 'VALIDATION_FAILED:source' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('deletion_request:' || p_user::text || ':' || p_kind::text));
  select * into d from public.data_deletion_requests x
  where x.user_id = p_user and x.kind = p_kind and x.status in ('requested', 'verified', 'queued', 'processing')
  order by x.created_at desc limit 1;
  if found then
    if p_status_token_hash is not null then
      update public.data_deletion_requests x set status_token_hash = p_status_token_hash where x.id = d.id;
    end if;
    return jsonb_build_object('request_id', d.id, 'status', d.status, 'created', false, 'created_at', d.created_at,
                              'job_id', d.job_id);
  end if;

  insert into public.data_deletion_requests (user_id, subject_hash, subject_email_hash, kind, status, origin,
                                             confirmation_method, scope, connected_account_id, status_token_hash)
  values (p_user, private.hash_subject(p_user), p_subject_email_hash, p_kind, 'queued', p_origin, p_confirmation,
          case when p_kind = 'history' then coalesce(p_scope, 'all_analysis') end,
          case when p_kind = 'history' then p_account end, p_status_token_hash)
  returning * into d;

  if p_kind = 'account' then
    update public.profiles p set state = 'deletion_pending' where p.user_id = p_user;
    update public.push_tokens t set status = 'disabled', disabled_reason = 'account_deleted'
    where t.user_id = p_user and t.status = 'active';
    v_job := private.enqueue_job('account_deletion', 'account_deletion:' || d.id,
                                 jsonb_build_object('data_deletion_request_id', d.id, 'user_id', p_user, 'source', p_source),
                                 null, null, now(), 10, 8, p_correlation_id);
  else
    v_job := private.enqueue_job('history_deletion', 'history_deletion:' || d.id,
                                 jsonb_build_object('data_deletion_request_id', d.id, 'user_id', p_user,
                                                    'scope', d.scope, 'connected_account_id', d.connected_account_id),
                                 p_user, null, now(), 50, 6, p_correlation_id);
  end if;
  update public.data_deletion_requests x set job_id = v_job where x.id = d.id;
  perform private.audit_log_append('user', p_user, null,
                                   case when p_kind = 'account' then 'user.privacy.account_deletion_requested'
                                        else 'user.privacy.history_deletion_requested' end,
                                   'data_deletion_request', d.id::text, p_user, null, 'success',
                                   jsonb_build_object('source', p_source, 'origin', p_origin), p_correlation_id);
  return jsonb_build_object('request_id', d.id, 'status', 'queued', 'created', true, 'created_at', d.created_at,
                            'job_id', v_job);
end
$$;

-- True when the user has an active App Store / Play subscription (PUB-03 subscription_notice).
create function private.public_subscription_active(p_user uuid) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce((select s.is_active and s.store in ('app_store', 'play_store', 'mac_app_store', 'amazon')
                     from public.subscriptions s where s.user_id = p_user and s.entitlement = 'pro'), false)
  $$;

-- ═══ PUB-07 · deletion status ═════════════════════════════════════════════════════════════════
-- Identifier-free status of one request; the caller compares sha256(token) with the returned
-- hash in constant time and answers the same 404 for an unknown id and a wrong token.
create function private.public_deletion_status(p_request_id uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'status', d.status, 'requested_at', d.created_at, 'completed_at', d.completed_at,
      'steps', d.steps, 'status_token_hash', encode(d.status_token_hash, 'hex'))
    from public.data_deletion_requests d where d.id = p_request_id
  $$;

-- ═══ PUB-05 · plans ══════════════════════════════════════════════════════════════════════════
create function private.public_plans() returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'free', (select jsonb_object_agg(pl.key, pl.value) from public.plan_limits pl
               where pl.plan = 'free' and pl.key in ('max_mail_accounts', 'max_calendars', 'ai_daily_budget_units')),
      'pricing', (select s.value from public.app_settings s where s.key = 'web.pricing_display'),
      'updated_at', greatest((select max(pl.updated_at) from public.plan_limits pl),
                             (select s.updated_at from public.app_settings s where s.key = 'web.pricing_display')))
  $$;

-- ═══ PUB-04 · referral resolve ═══════════════════════════════════════════════════════════════
-- Whether a code is active, plus the reward and apply-window settings. The referrer is never
-- returned. A valid open is counted as the content-free server event referral_link_opened.
create function private.public_referral_resolve(p_code text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_valid boolean := exists (select 1 from public.referral_codes rc where rc.code = upper(p_code) and rc.disabled_at is null);
begin
  if v_valid then
    insert into public.analytics_events (event_name, props, platform, occurred_at)
    values ('referral_link_opened', '{}'::jsonb, 'web', now());
  end if;
  return jsonb_build_object(
    'valid', v_valid,
    'reward_days', private.app_setting_int('referral.reward_days', 14),
    'apply_window_days', private.app_setting_int('referral.apply_window_days', 7));
end
$$;

-- ═══ PUB-06 · web analytics counters ═════════════════════════════════════════════════════════
-- One counter per (day, event, allow-listed dimensions); no identifier is ever stored.
create function private.web_analytics_increment(p_day date, p_event text, p_dims jsonb) returns void
  language sql
  security definer
  set search_path = ''
  as $$
    insert into public.web_analytics_daily as w (day, event, dims_hash, dims, count)
    values (p_day, p_event, pg_catalog.sha256(convert_to(coalesce(p_dims, '{}'::jsonb)::text, 'UTF8')),
            coalesce(p_dims, '{}'::jsonb), 1)
    on conflict (day, event, dims_hash) do update set count = w.count + 1
  $$;

revoke execute on function
  private.public_support_ticket(extensions.citext, text, public.ticket_category, text, text),
  private.support_inbound_note(text, text, extensions.citext, text, bytea),
  private.public_deletion_subject(extensions.citext),
  private.public_otp_lock_seconds(text, integer),
  private.public_otp_record_failure(text, integer, integer, integer),
  private.create_deletion_request(uuid, public.deletion_kind, text, text, bytea, bytea, text, uuid, text, uuid),
  private.public_subscription_active(uuid),
  private.public_deletion_status(uuid),
  private.public_plans(),
  private.public_referral_resolve(text),
  private.web_analytics_increment(date, text, jsonb)
  from public;
grant execute on function
  private.public_support_ticket(extensions.citext, text, public.ticket_category, text, text),
  private.support_inbound_note(text, text, extensions.citext, text, bytea),
  private.public_deletion_subject(extensions.citext),
  private.public_otp_lock_seconds(text, integer),
  private.public_otp_record_failure(text, integer, integer, integer),
  private.create_deletion_request(uuid, public.deletion_kind, text, text, bytea, bytea, text, uuid, text, uuid),
  private.public_subscription_active(uuid),
  private.public_deletion_status(uuid),
  private.public_plans(),
  private.public_referral_resolve(text),
  private.web_analytics_increment(date, text, jsonb)
  to service_role;

-- ═══ Service-role wrappers ═══════════════════════════════════════════════════════════════════
create function public.public_support_ticket(
  p_email extensions.citext, p_name text, p_category public.ticket_category, p_subject text, p_message text
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.public_support_ticket(p_email, p_name, p_category, p_subject, p_message) $$;

create function public.support_inbound_note(
  p_message_id text, p_reference text, p_sender extensions.citext, p_body text, p_digest bytea
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.support_inbound_note(p_message_id, p_reference, p_sender, p_body, p_digest) $$;

create function public.public_deletion_subject(p_email extensions.citext) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.public_deletion_subject(p_email) $$;

create function public.public_otp_lock_seconds(p_subject text, p_lock_seconds integer default 3600) returns integer
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.public_otp_lock_seconds(p_subject, p_lock_seconds) $$;

create function public.public_otp_record_failure(
  p_subject text, p_max integer default 5, p_window_seconds integer default 900, p_lock_seconds integer default 3600
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.public_otp_record_failure(p_subject, p_max, p_window_seconds, p_lock_seconds) $$;

create function public.create_deletion_request(
  p_user uuid, p_kind public.deletion_kind, p_origin text, p_confirmation text, p_status_token_hash bytea,
  p_subject_email_hash bytea default null, p_scope text default null, p_account uuid default null,
  p_source text default 'app', p_correlation_id uuid default null
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$
    select private.create_deletion_request(p_user, p_kind, p_origin, p_confirmation, p_status_token_hash,
                                           p_subject_email_hash, p_scope, p_account, p_source, p_correlation_id)
  $$;

create function public.public_subscription_active(p_user uuid) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.public_subscription_active(p_user) $$;

create function public.public_deletion_status(p_request_id uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.public_deletion_status(p_request_id) $$;

create function public.public_plans() returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$ select private.public_plans() $$;

create function public.public_referral_resolve(p_code text) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.public_referral_resolve(p_code) $$;

create function public.web_analytics_increment(p_day date, p_event text, p_dims jsonb) returns void
  language sql
  security definer
  set search_path = ''
  as $$ select private.web_analytics_increment(p_day, p_event, p_dims) $$;

revoke execute on function
  public.public_support_ticket(extensions.citext, text, public.ticket_category, text, text),
  public.support_inbound_note(text, text, extensions.citext, text, bytea),
  public.public_deletion_subject(extensions.citext),
  public.public_otp_lock_seconds(text, integer),
  public.public_otp_record_failure(text, integer, integer, integer),
  public.create_deletion_request(uuid, public.deletion_kind, text, text, bytea, bytea, text, uuid, text, uuid),
  public.public_subscription_active(uuid),
  public.public_deletion_status(uuid),
  public.public_plans(),
  public.public_referral_resolve(text),
  public.web_analytics_increment(date, text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.public_support_ticket(extensions.citext, text, public.ticket_category, text, text),
  public.support_inbound_note(text, text, extensions.citext, text, bytea),
  public.public_deletion_subject(extensions.citext),
  public.public_otp_lock_seconds(text, integer),
  public.public_otp_record_failure(text, integer, integer, integer),
  public.create_deletion_request(uuid, public.deletion_kind, text, text, bytea, bytea, text, uuid, text, uuid),
  public.public_subscription_active(uuid),
  public.public_deletion_status(uuid),
  public.public_plans(),
  public.public_referral_resolve(text),
  public.web_analytics_increment(date, text, jsonb)
  to service_role;
