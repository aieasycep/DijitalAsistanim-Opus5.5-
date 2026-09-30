-- Migration 0020 · integrations runtime (IMPLEMENTATION_PLAN T-4.01 … T-4.13)
-- Spec: docs/API_CONTRACTS.md §8.3 (API-INT-01…07), §9 (OAUTH-01…04), §10 (WH-01…04),
-- §11.4 (JOB-01…09, JOB-29); docs/INTEGRATION_PLAN.md §3.2 (R-07 completion binding), §3.5
-- (sync_states leases), §3.10–§3.14 (data minimisation, plan limits, reconciliation, disconnect),
-- §13.2 (demo writes in private.demo_fixture_state); DATABASE_AND_RLS_PLAN §4.2–§4.3.
--
-- Everything here is called by the Edge Functions with the secret key through a `public`
-- service-role wrapper (PostgREST exposes only `public` and `admin_api`). Each function does one
-- atomic step of the integration flows: the OAuth callback hand-off, the R-07 completion swap,
-- content upserts that keep thread aggregates consistent, the device snapshot diff, disconnect and
-- the bounded purge. No function stores a raw mail body, an event description beyond the
-- 500-character excerpt, a token in plaintext or an attendee identity from a device snapshot.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ oauth_states: demo provider and the per-variant app callback schemes ═════════════════════
-- The demo provider runs the real state/PKCE/completion path (OAUTH-03/04); the api refuses it
-- unless DEMO_MODE is on. Every EAS variant has its own scheme (INTEGRATION_PLAN §0.5). The new
-- checks are added NOT VALID and validated in migration 20260924002001 (no long write lock here).
alter table public.oauth_states drop constraint oauth_states_provider_check;
alter table public.oauth_states
  add constraint oauth_states_provider_check check (provider in ('google', 'microsoft', 'demo')) not valid;
alter table public.oauth_states drop constraint oauth_states_return_to_check;
alter table public.oauth_states
  add constraint oauth_states_return_to_check
  check (return_to ~ '^(dijitalasistan(-dev|-preview|-e2e)?://integrations/callback|https://[a-z0-9.-]+(:[0-9]{2,5})?/oauth/done)')
  not valid;

-- ═══ Helpers ══════════════════════════════════════════════════════════════════════════════════

-- text[] from a jsonb array of strings (null → empty).
create function private.jsonb_text_array(p_value jsonb) returns text[]
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value
                                                                else '[]'::jsonb end)), '{}'::text[])
  $$;

-- Lower-cased citext[] of e-mail addresses, capped (INTEGRATION_PLAN §2.2: to/cc ≤ 50).
create function private.jsonb_email_array(p_value jsonb, p_cap integer default 50) returns extensions.citext[]
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(array(select lower(e.value)::extensions.citext
                          from jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value
                                                              else '[]'::jsonb end) with ordinality as e (value, n)
                          where e.value <> '' order by e.n limit p_cap), '{}'::extensions.citext[])
  $$;

-- A conferencing URL kept only for the allow-listed https hosts of calendar_events.conference_url.
create function private.allowed_conference_url(p_url text) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case when p_url ~ '^https://(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)/'
                then left(p_url, 2048) end
  $$;

-- '#RRGGBB' (an 8-digit '#RRGGBBAA' device colour loses its alpha); anything else is null.
create function private.normalized_hex_color(p_color text) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case when p_color ~ '^#[0-9A-Fa-f]{6}$' then p_color
                when p_color ~ '^#[0-9A-Fa-f]{8}$' then left(p_color, 7) end
  $$;

-- Whether a Pro→Free downgrade paused this account (API_CONTRACTS §4.1 `paused_by_plan`): the
-- same allowance ranking as private.account_can, per capability class the account holds.
create function private.account_paused_by_plan(p_account uuid) returns boolean
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_class public.capability;
  v_limit integer;
  v_rank bigint;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found or a.status = 'disconnected' then
    return false;
  end if;
  foreach v_class in array array['mail_read', 'calendar_read']::public.capability[] loop
    continue when not (v_class = any(a.capabilities_granted));
    v_limit := private.plan_limit_int(a.user_id,
                 case v_class when 'mail_read' then 'max_mail_accounts' else 'max_calendar_accounts' end);
    continue when v_limit is null;
    select r.rn into v_rank from (
      select ca.id, row_number() over (order by coalesce(ca.connected_at, ca.created_at), ca.id) as rn
      from public.connected_accounts ca
      where ca.user_id = a.user_id and ca.status <> 'disconnected' and v_class = any(ca.capabilities_granted)
    ) as r where r.id = a.id;
    if v_rank is not null and v_rank > v_limit then
      return true;
    end if;
  end loop;
  return false;
end
$$;

-- ═══ Sync leases (INTEGRATION_PLAN §3.5.1 single flight per account resource) ═════════════════

create function private.acquire_sync_lease(p_sync_state uuid, p_owner text, p_seconds integer default 120)
  returns boolean
  language sql
  security definer
  set search_path = ''
  as $$
    with u as (
      update public.sync_states s
        set lease_owner = p_owner,
            lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 120), 5), 900))
      where s.id = p_sync_state
        and (s.lease_expires_at is null or s.lease_expires_at < now() or s.lease_owner = p_owner)
      returning 1)
    select exists (select 1 from u)
  $$;

create function private.release_sync_lease(p_sync_state uuid, p_owner text) returns void
  language sql
  security definer
  set search_path = ''
  as $$
    update public.sync_states s set lease_owner = null, lease_expires_at = null
    where s.id = p_sync_state and s.lease_owner = p_owner
  $$;

-- ═══ OAuth callback hand-off and R-07 completion ══════════════════════════════════════════════

-- OAUTH-01/02/04 step 9: stores the callback outcome on the consumed state. For a new identity it
-- inserts the `connecting` account (pending_binding_until = now + 10 min, so nothing can use it)
-- and its encrypted credentials; a reconnect or upgrade keeps the token set on the state row
-- (p_state.token_ciphertext) until POST /integrations/oauth/complete swaps it in. The plan-limit
-- trigger may raise PLAN_LIMIT here; the callback then records the `plan_limit` pre-result.
create function private.oauth_callback_store(
  p_state_id uuid, p_state jsonb, p_account jsonb default null, p_credentials jsonb default '[]'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  s public.oauth_states%rowtype;
  v_account uuid;
  c jsonb;
begin
  select * into s from public.oauth_states x where x.id = p_state_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if s.used_at is null or s.completion_code_hash is not null or s.completed_at is not null then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;

  if p_account is not null then
    v_account := (p_account ->> 'id')::uuid;
    insert into public.connected_accounts (
      id, user_id, provider, provider_account_id, account_email, display_label, tenant_type, tenant_id, status,
      granted_scopes, capabilities_granted, pending_binding_until, demo_flavor, credential_expires_at)
    values (
      v_account, s.user_id, s.provider, p_account ->> 'provider_account_id', nullif(p_account ->> 'account_email', ''),
      left(nullif(p_account ->> 'display_label', ''), 120), nullif(p_account ->> 'tenant_type', ''),
      nullif(p_account ->> 'tenant_id', ''), 'connecting', private.jsonb_text_array(p_account -> 'granted_scopes'),
      private.jsonb_text_array(p_account -> 'capabilities_granted')::public.capability[],
      now() + interval '10 minutes', nullif(p_account ->> 'demo_flavor', ''),
      (p_account ->> 'credential_expires_at')::timestamptz);
    for c in select value from jsonb_array_elements(coalesce(p_credentials, '[]'::jsonb)) loop
      insert into public.oauth_credentials (user_id, connected_account_id, provider, token_kind, key_version, iv, ciphertext,
                                            aad_hash, access_expires_at, scope_snapshot)
      values (s.user_id, v_account, s.provider, c ->> 'token_kind', (c ->> 'key_version')::smallint,
              decode(c ->> 'iv', 'hex'), decode(c ->> 'ciphertext', 'hex'), decode(c ->> 'aad_hash', 'hex'),
              (c ->> 'access_expires_at')::timestamptz, c ->> 'scope_snapshot');
    end loop;
  else
    v_account := nullif(p_state ->> 'connected_account_id', '')::uuid;
  end if;

  update public.oauth_states x
    set completion_code_hash = decode(nullif(p_state ->> 'completion_code_hash', ''), 'hex'),
        result = p_state ->> 'result',
        error_code = nullif(p_state ->> 'error_code', ''),
        token_ciphertext = decode(nullif(p_state ->> 'token_ciphertext', ''), 'hex'),
        token_iv = decode(nullif(p_state ->> 'token_iv', ''), 'hex'),
        key_version = coalesce((p_state ->> 'key_version')::smallint, x.key_version),
        connected_account_id = coalesce(v_account, x.connected_account_id)
  where x.id = s.id;
  return jsonb_build_object('state_id', s.id, 'connected_account_id', coalesce(v_account, s.connected_account_id));
end
$$;

-- API-INT-07 success (one transaction): re-checks the binding under a row lock (user, used, not yet
-- completed, within 10 min of the callback), swaps the re-encrypted credentials in, activates the
-- account, clears the held token set, sets completed_at and clears the approval's scope block
-- (§7). Raises STATE_CONFLICT when the binding no longer holds; PLAN_LIMIT from the plan-limit
-- trigger propagates (the api reports `plan_limit`).
create function private.oauth_complete_binding(
  p_state_id uuid, p_user uuid, p_account_id uuid, p_account jsonb, p_credentials jsonb default '[]'::jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  s public.oauth_states%rowtype;
  a public.connected_accounts%rowtype;
  c jsonb;
begin
  select * into s from public.oauth_states x where x.id = p_state_id for update;
  if not found or s.user_id <> p_user then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if s.used_at is null or s.completed_at is not null or s.used_at < now() - interval '10 minutes' then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  select * into a from public.connected_accounts ca where ca.id = p_account_id for update;
  if not found or a.user_id <> p_user or a.provider <> s.provider then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  for c in select value from jsonb_array_elements(coalesce(p_credentials, '[]'::jsonb)) loop
    insert into public.oauth_credentials as oc (user_id, connected_account_id, provider, token_kind, key_version, iv,
                                                 ciphertext, aad_hash, access_expires_at, scope_snapshot, rotated_at)
    values (p_user, a.id, a.provider, c ->> 'token_kind', (c ->> 'key_version')::smallint, decode(c ->> 'iv', 'hex'),
            decode(c ->> 'ciphertext', 'hex'), decode(c ->> 'aad_hash', 'hex'), (c ->> 'access_expires_at')::timestamptz,
            c ->> 'scope_snapshot', now())
    on conflict (connected_account_id, token_kind) where connected_account_id is not null
    do update set key_version = excluded.key_version, iv = excluded.iv, ciphertext = excluded.ciphertext,
                  aad_hash = excluded.aad_hash, access_expires_at = excluded.access_expires_at,
                  scope_snapshot = excluded.scope_snapshot, rotated_at = now(),
                  refresh_lock_until = null, refresh_lock_owner = null;
  end loop;

  update public.connected_accounts ca
    set status = (p_account ->> 'status')::public.account_status,
        granted_scopes = coalesce(private.jsonb_text_array(p_account -> 'granted_scopes'), ca.granted_scopes),
        capabilities_granted = private.jsonb_text_array(p_account -> 'capabilities_granted')::public.capability[],
        account_email = coalesce(nullif(p_account ->> 'account_email', '')::extensions.citext, ca.account_email),
        display_label = coalesce(left(nullif(p_account ->> 'display_label', ''), 120), ca.display_label),
        pending_binding_until = null,
        connected_at = case when ca.connected_at is null or ca.status = 'disconnected' then now() else ca.connected_at end,
        disconnected_at = null, revocation_mode = null, reauth_required_at = null, status_reason = null,
        last_error_code = null, last_error_at = null,
        credential_expires_at = coalesce((p_account ->> 'credential_expires_at')::timestamptz, ca.credential_expires_at)
  where ca.id = a.id;

  update public.oauth_states x
    set completed_at = now(), token_ciphertext = null, token_iv = null,
        connected_account_id = a.id
  where x.id = s.id;

  if s.approval_id is not null then
    update public.approval_actions ap set requires_scope = null
    where ap.id = s.approval_id and ap.user_id = p_user;
  end if;

  select * into a from public.connected_accounts ca where ca.id = p_account_id;
  return to_jsonb(a) || jsonb_build_object('paused_by_plan', private.account_paused_by_plan(a.id));
end
$$;

-- Stores the terminal pre-result of a flow that completes without binding anything
-- (account_mismatch, already_linked, plan_limit) or is rejected (R-07): the held token set is
-- dropped and a `connecting` row created by this flow's callback is deleted (its credentials go
-- with it). The caller revokes at the provider first.
create function private.oauth_close_flow(p_state_id uuid, p_result text, p_error_code text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  s public.oauth_states%rowtype;
  v_deleted uuid;
begin
  select * into s from public.oauth_states x where x.id = p_state_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if s.purpose = 'connect' and s.connected_account_id is not null then
    delete from public.connected_accounts ca
    where ca.id = s.connected_account_id and ca.status = 'connecting' and ca.pending_binding_until is not null
    returning ca.id into v_deleted;
  end if;
  update public.oauth_states x
    set completed_at = coalesce(x.completed_at, now()), token_ciphertext = null, token_iv = null,
        result = coalesce(p_result, x.result), error_code = coalesce(p_error_code, x.error_code),
        connected_account_id = case when v_deleted is not null then null else x.connected_account_id end
  where x.id = s.id;
  return jsonb_build_object('state_id', s.id, 'deleted_account_id', v_deleted);
end
$$;

-- ═══ Content upserts (headers subset + ≤200-char snippet only; ADR-05) ══════════════════════════

-- Upserts messages and their threads (dedupe on (connected_account_id, provider_message_id) and
-- (connected_account_id, provider_thread_id)) and recomputes the touched threads' aggregates.
-- Returns [{id, provider_message_id, thread_id, inserted}].
create function private.upsert_mail_messages(p_account uuid, p_messages jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  m jsonb;
  v_thread uuid;
  v_id uuid;
  v_inserted boolean;
  v_threads uuid[] := '{}';
  v_out jsonb := '[]'::jsonb;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 500 then
    raise exception 'VALIDATION_FAILED:messages' using errcode = '22023';
  end if;
  for m in select value from jsonb_array_elements(p_messages) loop
    insert into public.email_threads as t (user_id, connected_account_id, provider, provider_thread_id, subject,
                                           last_message_at, web_link)
    values (a.user_id, a.id, a.provider, m ->> 'provider_thread_id', left(m ->> 'subject', 300),
            (m ->> 'received_at')::timestamptz,
            case when m ->> 'thread_web_link' ~ '^https://' then m ->> 'thread_web_link' end)
    on conflict (connected_account_id, provider_thread_id)
    do update set web_link = coalesce(excluded.web_link, t.web_link)
    returning t.id into v_thread;

    insert into public.email_messages as e (
      user_id, connected_account_id, thread_id, provider, provider_message_id, internet_message_id, in_reply_to,
      references_ids, direction, from_email, from_name, to_emails, cc_emails, subject, snippet, sent_at, received_at,
      is_read, importance, labels, has_attachments, list_unsubscribe, auto_submitted, precedence_bulk, dkim_pass,
      spf_pass, content_hash, web_link, provider_deleted_at)
    values (
      a.user_id, a.id, v_thread, a.provider, m ->> 'provider_message_id', nullif(m ->> 'internet_message_id', ''),
      nullif(m ->> 'in_reply_to', ''),
      (select coalesce(array_agg(x.v order by x.n), '{}'::text[]) from (
         select r.v, r.n from jsonb_array_elements_text(coalesce(m -> 'references_ids', '[]'::jsonb)) with ordinality as r (v, n)
         order by r.n desc limit 20) as x),
      coalesce(m ->> 'direction', 'inbound'), lower(coalesce(m ->> 'from_email', ''))::extensions.citext,
      left(nullif(m ->> 'from_name', ''), 200),
      private.jsonb_email_array(m -> 'to_emails'), private.jsonb_email_array(m -> 'cc_emails'),
      left(m ->> 'subject', 300), left(m ->> 'snippet', 200), (m ->> 'sent_at')::timestamptz,
      (m ->> 'received_at')::timestamptz, coalesce((m ->> 'is_read')::boolean, false),
      case when m ->> 'importance' in ('low', 'normal', 'high') then m ->> 'importance' end,
      private.jsonb_text_array(m -> 'labels'), coalesce((m ->> 'has_attachments')::boolean, false),
      coalesce((m ->> 'list_unsubscribe')::boolean, false), coalesce((m ->> 'auto_submitted')::boolean, false),
      coalesce((m ->> 'precedence_bulk')::boolean, false), (m ->> 'dkim_pass')::boolean, (m ->> 'spf_pass')::boolean,
      decode(m ->> 'content_hash', 'hex'),
      case when m ->> 'web_link' ~ '^https://' then m ->> 'web_link' end,
      case when coalesce((m ->> 'deleted')::boolean, false) then now() end)
    on conflict (connected_account_id, provider_message_id)
    do update set is_read = excluded.is_read, labels = excluded.labels, snippet = excluded.snippet,
                  subject = excluded.subject, has_attachments = excluded.has_attachments,
                  web_link = coalesce(excluded.web_link, e.web_link),
                  provider_deleted_at = case when excluded.provider_deleted_at is not null
                                             then coalesce(e.provider_deleted_at, excluded.provider_deleted_at) end
    returning e.id, (e.xmax = 0) into v_id, v_inserted;

    v_threads := v_threads || v_thread;
    v_out := v_out || jsonb_build_object('id', v_id, 'provider_message_id', m ->> 'provider_message_id',
                                         'thread_id', v_thread, 'inserted', v_inserted);
  end loop;
  perform private.refresh_thread_aggregates(v_threads);
  return v_out;
end
$$;

-- Thread counters, participants (≤50, {email, name}), unread and last in/out timestamps from the
-- thread's live messages.
create function private.refresh_thread_aggregates(p_threads uuid[]) returns void
  language sql
  security definer
  set search_path = ''
  as $$
    update public.email_threads t
      set message_count = s.cnt,
          last_message_at = coalesce(s.last_at, t.last_message_at),
          last_inbound_at = s.last_in,
          last_outbound_at = s.last_out,
          has_unread = s.unread,
          labels = s.labels,
          participants = s.participants,
          subject = coalesce(t.subject, s.subject)
    from (
      select m.thread_id,
             count(*)::integer as cnt,
             max(m.received_at) as last_at,
             max(m.received_at) filter (where m.direction = 'inbound') as last_in,
             max(m.received_at) filter (where m.direction = 'outbound') as last_out,
             coalesce(bool_or(not m.is_read and m.direction = 'inbound'), false) as unread,
             coalesce((select array_agg(distinct l) from public.email_messages m2 cross join lateral unnest(m2.labels) as l
                       where m2.thread_id = m.thread_id and m2.provider_deleted_at is null), '{}'::text[]) as labels,
             coalesce((select jsonb_agg(p.obj) from (
                         select jsonb_build_object('email', q.email, 'name', max(q.name)) as obj
                         from (select m3.from_email::text as email, m3.from_name as name
                               from public.email_messages m3 where m3.thread_id = m.thread_id and m3.provider_deleted_at is null
                               union all
                               select unnest(m3.to_emails || m3.cc_emails)::text, null
                               from public.email_messages m3 where m3.thread_id = m.thread_id and m3.provider_deleted_at is null) as q
                         where q.email <> ''
                         group by q.email
                         order by q.email
                         limit 50) as p), '[]'::jsonb) as participants,
             (array_agg(m.subject order by m.received_at))[1] as subject
      from public.email_messages m
      where m.thread_id = any(p_threads) and m.provider_deleted_at is null
      group by m.thread_id) as s
    where t.id = s.thread_id;
    -- Threads whose every message was deleted at the provider.
    update public.email_threads t set message_count = 0, has_unread = false
    where t.id = any(p_threads)
      and not exists (select 1 from public.email_messages m where m.thread_id = t.id and m.provider_deleted_at is null);
  $$;

-- Label / read-state changes and provider deletions (INTEGRATION_PLAN §3.13).
create function private.apply_mail_changes(p_account uuid, p_label_changes jsonb, p_deleted text[]) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  ch jsonb;
  v_threads uuid[] := '{}';
  v_deleted_threads uuid[];
  v_labels integer := 0;
  v_deleted integer := 0;
  v_thread uuid;
begin
  for ch in select value from jsonb_array_elements(coalesce(p_label_changes, '[]'::jsonb)) loop
    update public.email_messages e
      set labels = private.jsonb_text_array(ch -> 'labels'),
          is_read = coalesce((ch ->> 'is_read')::boolean, e.is_read)
    where e.connected_account_id = p_account and e.provider_message_id = ch ->> 'provider_message_id'
    returning e.thread_id into v_thread;
    if found then
      v_labels := v_labels + 1;
      v_threads := v_threads || v_thread;
    end if;
  end loop;
  with d as (
    update public.email_messages e set provider_deleted_at = now()
    where e.connected_account_id = p_account and e.provider_message_id = any(coalesce(p_deleted, '{}'))
      and e.provider_deleted_at is null
    returning e.thread_id)
  select count(*)::integer, coalesce(array_agg(d.thread_id), '{}') into v_deleted, v_deleted_threads from d;
  perform private.refresh_thread_aggregates(v_threads || v_deleted_threads);
  return jsonb_build_object('label_changes', v_labels, 'deleted', v_deleted);
end
$$;

-- Normalised events of one calendar (dedupe on (calendar_id, provider_event_id)). Cancelled or
-- deleted events keep their row with provider_deleted_at set (§3.13). da_approval_id is kept only
-- when it names one of the user's approvals.
create function private.upsert_calendar_events(p_account uuid, p_calendar uuid, p_events jsonb, p_origin text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  cal public.calendars%rowtype;
  ev jsonb;
  v_upserted integer := 0;
  v_deleted integer := 0;
  v_conf text;
  v_gone boolean;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  select * into cal from public.calendars c where c.id = p_calendar and c.connected_account_id = p_account;
  if a.id is null or cal.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_origin not in ('provider_sync', 'device_snapshot', 'demo', 'approval_write') then
    raise exception 'VALIDATION_FAILED:origin' using errcode = '22023';
  end if;
  for ev in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_gone := coalesce((ev ->> 'deleted')::boolean, false) or ev ->> 'status' = 'cancelled';
    v_conf := private.allowed_conference_url(ev ->> 'conference_url');
    insert into public.calendar_events as e (
      user_id, connected_account_id, calendar_id, provider, provider_event_id, ical_uid, recurring_event_id, etag,
      title, description_excerpt, location, is_online, conference_url, start_at, end_at, all_day, start_date, end_date,
      time_zone, status, organizer_email, organizer_self, can_modify, attendees, attendee_count, origin, da_approval_id,
      provider_updated_at, provider_deleted_at)
    values (
      a.user_id, a.id, cal.id, a.provider, ev ->> 'provider_event_id', nullif(ev ->> 'ical_uid', ''),
      nullif(ev ->> 'recurring_event_id', ''), nullif(ev ->> 'etag', ''), left(ev ->> 'title', 300),
      left(nullif(ev ->> 'description_excerpt', ''), 500), left(nullif(ev ->> 'location', ''), 300), v_conf is not null,
      v_conf, (ev ->> 'start_at')::timestamptz, greatest((ev ->> 'end_at')::timestamptz, (ev ->> 'start_at')::timestamptz),
      coalesce((ev ->> 'all_day')::boolean, false), (ev ->> 'start_date')::date, (ev ->> 'end_date')::date,
      nullif(ev ->> 'time_zone', ''), case when v_gone then 'cancelled' else coalesce(ev ->> 'status', 'confirmed') end,
      nullif(lower(ev ->> 'organizer_email'), '')::extensions.citext, coalesce((ev ->> 'organizer_self')::boolean, false),
      coalesce((ev ->> 'can_modify')::boolean, false),
      case when jsonb_typeof(ev -> 'attendees') = 'array' then
        (select coalesce(jsonb_agg(x.value), '[]'::jsonb) from (
           select value from jsonb_array_elements(ev -> 'attendees') with ordinality as t (value, n) order by n limit 200) as x)
      else '[]'::jsonb end,
      greatest(coalesce((ev ->> 'attendee_count')::integer, 0), 0), p_origin,
      (select ap.id from public.approval_actions ap
       where ap.id = case when ev ->> 'da_approval_id' ~ '^[0-9a-f-]{36}$' then (ev ->> 'da_approval_id')::uuid end
         and ap.user_id = a.user_id),
      (ev ->> 'provider_updated_at')::timestamptz, case when v_gone then now() end)
    on conflict (calendar_id, provider_event_id)
    do update set ical_uid = excluded.ical_uid, recurring_event_id = excluded.recurring_event_id, etag = excluded.etag,
                  title = excluded.title, description_excerpt = excluded.description_excerpt,
                  location = excluded.location, is_online = excluded.is_online, conference_url = excluded.conference_url,
                  start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day,
                  start_date = excluded.start_date, end_date = excluded.end_date, time_zone = excluded.time_zone,
                  status = excluded.status, organizer_email = excluded.organizer_email,
                  organizer_self = excluded.organizer_self, can_modify = excluded.can_modify,
                  attendees = excluded.attendees, attendee_count = excluded.attendee_count,
                  da_approval_id = coalesce(excluded.da_approval_id, e.da_approval_id),
                  provider_updated_at = excluded.provider_updated_at,
                  provider_deleted_at = case when excluded.provider_deleted_at is null then null
                                             else coalesce(e.provider_deleted_at, excluded.provider_deleted_at) end;
    if v_gone then v_deleted := v_deleted + 1; else v_upserted := v_upserted + 1; end if;
  end loop;
  return jsonb_build_object('upserted', v_upserted, 'cancelled', v_deleted);
end
$$;

-- Marks events deleted at the provider (Google `status=cancelled` without a body, Graph `@removed`).
create function private.mark_calendar_events_deleted(p_calendar uuid, p_provider_event_ids text[]) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_n integer;
begin
  update public.calendar_events e set provider_deleted_at = now(), status = 'cancelled'
  where e.calendar_id = p_calendar and e.provider_event_id = any(coalesce(p_provider_event_ids, '{}'))
    and e.provider_deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- After a full resync (Calendar 410, Graph re-baseline): rows of the calendar inside the window
-- that the resync did not touch no longer exist at the provider and are removed.
create function private.prune_calendar_events(
  p_calendar uuid, p_since timestamptz, p_window_start timestamptz default null, p_window_end timestamptz default null
) returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_n integer;
begin
  delete from public.calendar_events e
  where e.calendar_id = p_calendar and e.updated_at < p_since
    and (p_window_start is null or e.end_at >= p_window_start)
    and (p_window_end is null or e.start_at <= p_window_end);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Calendar list of an account (§3.11): new calendars get the default selection (Free: primary only
-- within max_calendars; Pro: owned/writable default and personal calendars; holidays and birthdays
-- never), existing rows keep the user's choice. Returns the rows and the ids the provider no longer
-- lists (the caller stops their watches, then deletes them).
create function private.upsert_calendars(p_account uuid, p_calendars jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  c jsonb;
  v_pro boolean;
  v_select boolean;
  v_seen text[] := '{}';
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_pro := private.is_pro(a.user_id);
  for c in select value from jsonb_array_elements(coalesce(p_calendars, '[]'::jsonb)) loop
    v_seen := v_seen || (c ->> 'provider_calendar_id');
    v_select := case
      when c ->> 'kind' in ('holidays', 'birthdays') then false
      when v_pro then c ->> 'access_role' in ('owner', 'writer') and c ->> 'kind' in ('default', 'other')
      else coalesce((c ->> 'is_primary')::boolean, false) end;
    insert into public.calendars as k (user_id, connected_account_id, provider, provider_calendar_id, name, color, time_zone,
                                       access_role, is_primary, selected, can_write)
    values (a.user_id, a.id, a.provider, c ->> 'provider_calendar_id', left(coalesce(nullif(c ->> 'name', ''), '—'), 200),
            private.normalized_hex_color(c ->> 'color'), nullif(c ->> 'time_zone', ''), c ->> 'access_role',
            coalesce((c ->> 'is_primary')::boolean, false), v_select, coalesce((c ->> 'can_write')::boolean, false))
    on conflict (connected_account_id, provider_calendar_id)
    do update set name = excluded.name, color = excluded.color, time_zone = excluded.time_zone,
                  access_role = excluded.access_role, is_primary = excluded.is_primary, can_write = excluded.can_write;
  end loop;
  return jsonb_build_object(
    'calendars', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', k.id, 'provider_calendar_id', k.provider_calendar_id, 'name', k.name, 'selected', k.selected,
                    'can_write', k.can_write, 'is_primary', k.is_primary, 'time_zone', k.time_zone, 'color', k.color)
                    order by k.is_primary desc, k.name)
                  from public.calendars k where k.connected_account_id = a.id
                    and k.provider_calendar_id = any(v_seen)), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(k.id) from public.calendars k
                         where k.connected_account_id = a.id and not (k.provider_calendar_id = any(v_seen))), '[]'::jsonb));
end
$$;

-- Provider tasks of one account (dedupe on (connected_account_id, provider_list_id,
-- provider_task_id)). Google due dates are date-only; a task deleted at the provider is dismissed.
create function private.upsert_tasks(p_account uuid, p_tasks jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  t jsonb;
  v_n integer := 0;
  v_gone boolean;
  v_title text;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  for t in select value from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    v_gone := coalesce((t ->> 'deleted')::boolean, false);
    v_title := left(nullif(btrim(t ->> 'title'), ''), 500);
    if v_title is null then
      -- An untitled provider task carries nothing to show; a deleted one only needs dismissing.
      update public.tasks x set status = 'dismissed'
      where v_gone and x.connected_account_id = a.id and x.provider_list_id = t ->> 'provider_list_id'
        and x.provider_task_id = t ->> 'provider_task_id';
      continue;
    end if;
    insert into public.tasks as x (user_id, connected_account_id, provider, provider_task_id, provider_list_id, title,
                                   notes_excerpt, due_date, due_at, status, completed_at, origin)
    values (a.user_id, a.id, a.provider, t ->> 'provider_task_id', t ->> 'provider_list_id', v_title,
            left(nullif(t ->> 'notes_excerpt', ''), 1000), (t ->> 'due_date')::date, (t ->> 'due_at')::timestamptz,
            case when v_gone then 'dismissed'::public.item_status
                 when t ->> 'status' = 'completed' then 'done'::public.item_status
                 else 'open'::public.item_status end,
            (t ->> 'completed_at')::timestamptz, 'provider_sync')
    on conflict (connected_account_id, provider_list_id, provider_task_id) where provider_task_id is not null
    do update set title = excluded.title, notes_excerpt = excluded.notes_excerpt, due_date = excluded.due_date,
                  due_at = excluded.due_at, status = excluded.status, completed_at = excluded.completed_at;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('upserted', v_n);
end
$$;

-- ═══ Device calendars (API-INT-06, JOB-06) ════════════════════════════════════════════════════

-- The device account of one installation (provider_account_id = installation_id), created or
-- reactivated by an accepted snapshot. `created` drives the first-snapshot audit entry.
create function private.upsert_device_account(
  p_user uuid, p_provider public.provider, p_installation uuid, p_capabilities public.capability[]
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_created boolean := false;
begin
  if p_provider not in ('apple_device', 'android_device') then
    raise exception 'VALIDATION_FAILED:provider' using errcode = '22023';
  end if;
  select * into a from public.connected_accounts ca
  where ca.user_id = p_user and ca.provider = p_provider and ca.provider_account_id = p_installation::text
  for update;
  if not found then
    insert into public.connected_accounts (user_id, provider, provider_account_id, display_label, status,
                                           capabilities_granted, connected_at)
    values (p_user, p_provider, p_installation::text,
            case p_provider when 'apple_device' then 'Apple Takvim' else 'Cihaz Takvimi' end, 'healthy',
            p_capabilities, now())
    returning * into a;
    v_created := true;
  elsif a.status = 'disconnected' or not (a.capabilities_granted @> p_capabilities) then
    update public.connected_accounts ca
      set status = 'healthy', disconnected_at = null, revocation_mode = null,
          connected_at = case when ca.status = 'disconnected' then now() else ca.connected_at end,
          capabilities_granted = (select array_agg(distinct x) from unnest(ca.capabilities_granted || p_capabilities) as x)
    where ca.id = a.id
    returning * into a;
    v_created := true;
  end if;
  return jsonb_build_object('account_id', a.id, 'created', v_created, 'status', a.status);
end
$$;

-- Applies one full-window snapshot: calendars by device_calendar_hash (selection within
-- max_calendars), events of selected calendars upserted by event_key_hash, window events missing
-- from the snapshot deleted, Apple reminders mirrored into tasks, sync_states freshness recorded.
-- An older snapshot than the last applied one is a no-op.
create function private.apply_device_snapshot(p_account uuid, p_snapshot jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_tz text;
  v_at timestamptz := (p_snapshot ->> 'snapshot_at')::timestamptz;
  v_start timestamptz := (p_snapshot #>> '{window,start}')::timestamptz;
  v_end timestamptz := (p_snapshot #>> '{window,end}')::timestamptz;
  v_last timestamptz;
  v_limit integer;
  v_selected integer;
  c jsonb;
  ev jsonb;
  r jsonb;
  k public.calendars%rowtype;
  v_cal_hashes text[] := '{}';
  v_event_keys text[] := '{}';
  v_reminder_keys text[] := '{}';
  v_events integer := 0;
  v_dropped integer := 0;
  v_deleted integer := 0;
  v_tasks integer := 0;
  v_conf text;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.provider::text <> p_snapshot ->> 'provider' or a.provider_account_id <> p_snapshot ->> 'installation_id' then
    raise exception 'VALIDATION_FAILED:account' using errcode = '22023';
  end if;
  if a.status = 'disconnected' then
    return jsonb_build_object('skipped', 'account_disconnected');
  end if;
  select s.last_success_at into v_last from public.sync_states s
  where s.connected_account_id = a.id and s.resource = 'device_calendar' and s.resource_key = '';
  if v_last is not null and v_last >= v_at then
    return jsonb_build_object('skipped', 'stale_snapshot');
  end if;
  v_tz := private.user_timezone(a.user_id);
  v_limit := private.plan_limit_int(a.user_id, 'max_calendars');
  select count(*)::integer into v_selected from public.calendars x where x.user_id = a.user_id and x.selected
    and x.connected_account_id <> a.id;

  -- Calendars: keep the user's server-side choice; select a new one only within the allowance.
  for c in select value from jsonb_array_elements(coalesce(p_snapshot -> 'calendars', '[]'::jsonb)) loop
    v_cal_hashes := v_cal_hashes || (c ->> 'device_calendar_hash');
    select * into k from public.calendars x
    where x.connected_account_id = a.id and x.provider_calendar_id = c ->> 'device_calendar_hash';
    if k.id is null then
      insert into public.calendars (user_id, connected_account_id, provider, provider_calendar_id, name, color, time_zone,
                                    access_role, is_primary, selected, can_write)
      values (a.user_id, a.id, a.provider, c ->> 'device_calendar_hash', left(coalesce(nullif(c ->> 'title', ''), '—'), 200),
              private.normalized_hex_color(c ->> 'color'), v_tz,
              case when coalesce((c ->> 'allows_modifications')::boolean, false) then 'owner' else 'reader' end, false,
              coalesce((c ->> 'selected')::boolean, false) and (v_limit is null or v_selected < v_limit),
              coalesce((c ->> 'allows_modifications')::boolean, false))
      returning * into k;
    else
      update public.calendars x
        set name = left(coalesce(nullif(c ->> 'title', ''), '—'), 200), color = private.normalized_hex_color(c ->> 'color'),
            can_write = coalesce((c ->> 'allows_modifications')::boolean, false),
            access_role = case when coalesce((c ->> 'allows_modifications')::boolean, false) then 'owner' else 'reader' end,
            selected = case when not coalesce((c ->> 'selected')::boolean, false) then false
                            when x.selected then true
                            else v_limit is null or v_selected < v_limit end
      where x.id = k.id
      returning * into k;
    end if;
    if k.selected then
      v_selected := v_selected + 1;
    end if;
    k := null;
  end loop;
  delete from public.calendars x where x.connected_account_id = a.id and not (x.provider_calendar_id = any(v_cal_hashes));

  -- Events of selected calendars (attendee identities never leave the device; only the count).
  for ev in select value from jsonb_array_elements(coalesce(p_snapshot -> 'events', '[]'::jsonb)) loop
    select * into k from public.calendars x
    where x.connected_account_id = a.id and x.provider_calendar_id = ev ->> 'device_calendar_hash' and x.selected;
    if k.id is null then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    v_event_keys := v_event_keys || (ev ->> 'event_key_hash');
    v_conf := private.allowed_conference_url(ev ->> 'meeting_url');
    insert into public.calendar_events as e (
      user_id, connected_account_id, calendar_id, provider, provider_event_id, title, location, is_online, conference_url,
      start_at, end_at, all_day, start_date, end_date, time_zone, status, organizer_self, can_modify, attendee_count, origin,
      device_last_synced_at, provider_updated_at, provider_deleted_at)
    values (
      a.user_id, a.id, k.id, a.provider, ev ->> 'event_key_hash', left(ev ->> 'title', 300),
      left(nullif(ev ->> 'location', ''), 300), v_conf is not null, v_conf, (ev ->> 'start_at')::timestamptz,
      greatest((ev ->> 'end_at')::timestamptz, (ev ->> 'start_at')::timestamptz), coalesce((ev ->> 'all_day')::boolean, false),
      case when coalesce((ev ->> 'all_day')::boolean, false) then ((ev ->> 'start_at')::timestamptz at time zone v_tz)::date end,
      case when coalesce((ev ->> 'all_day')::boolean, false) then ((ev ->> 'end_at')::timestamptz at time zone v_tz)::date end,
      v_tz, coalesce(ev ->> 'status', 'confirmed'), coalesce((ev ->> 'organizer_is_self')::boolean, false), k.can_write,
      greatest(coalesce((ev ->> 'attendee_count')::integer, 0), 0), 'device_snapshot', v_at,
      (ev ->> 'last_modified_at')::timestamptz, case when ev ->> 'status' = 'cancelled' then v_at end)
    on conflict (calendar_id, provider_event_id)
    do update set title = excluded.title, location = excluded.location, is_online = excluded.is_online,
                  conference_url = excluded.conference_url, start_at = excluded.start_at, end_at = excluded.end_at,
                  all_day = excluded.all_day, start_date = excluded.start_date, end_date = excluded.end_date,
                  status = excluded.status, organizer_self = excluded.organizer_self, can_modify = excluded.can_modify,
                  attendee_count = excluded.attendee_count, device_last_synced_at = excluded.device_last_synced_at,
                  provider_updated_at = excluded.provider_updated_at, provider_deleted_at = excluded.provider_deleted_at;
    v_events := v_events + 1;
    k := null;
  end loop;

  -- Full-window truth: window events of this installation that the snapshot no longer carries.
  delete from public.calendar_events e
  where e.connected_account_id = a.id and e.start_at >= v_start and e.start_at <= v_end
    and not (e.provider_event_id = any(v_event_keys));
  get diagnostics v_deleted = row_count;

  -- Apple Reminders (iOS only) → provider tasks.
  if p_snapshot ? 'reminders' then
    for r in select value from jsonb_array_elements(coalesce(p_snapshot -> 'reminders', '[]'::jsonb)) loop
      continue when nullif(btrim(r ->> 'title'), '') is null;
      v_reminder_keys := v_reminder_keys || (r ->> 'reminder_key_hash');
      insert into public.tasks as x (user_id, connected_account_id, provider, provider_task_id, provider_list_id, title, due_at,
                                     status, completed_at, origin)
      values (a.user_id, a.id, a.provider, r ->> 'reminder_key_hash', r ->> 'list_hash', left(btrim(r ->> 'title'), 500),
              (r ->> 'due_at')::timestamptz,
              case when coalesce((r ->> 'completed')::boolean, false) then 'done'::public.item_status
                   else 'open'::public.item_status end,
              case when coalesce((r ->> 'completed')::boolean, false) then v_at end, 'provider_sync')
      on conflict (connected_account_id, provider_list_id, provider_task_id) where provider_task_id is not null
      do update set title = excluded.title, due_at = excluded.due_at, status = excluded.status,
                    completed_at = coalesce(x.completed_at, excluded.completed_at);
      v_tasks := v_tasks + 1;
    end loop;
    delete from public.tasks x where x.connected_account_id = a.id and x.provider_task_id is not null
      and not (x.provider_task_id = any(v_reminder_keys));
    insert into public.sync_states as s (user_id, connected_account_id, resource, resource_key, status, last_success_at,
                                         last_full_sync_at, stats)
    values (a.user_id, a.id, 'device_reminders', '', 'idle', v_at, now(), jsonb_build_object('reminders', v_tasks))
    on conflict (connected_account_id, resource, resource_key)
    do update set status = 'idle', last_success_at = excluded.last_success_at, last_full_sync_at = excluded.last_full_sync_at,
                  stats = excluded.stats, consecutive_failures = 0, last_error_code = null;
  end if;

  insert into public.sync_states as s (user_id, connected_account_id, resource, resource_key, status, last_success_at,
                                       last_full_sync_at, window_start, window_end, stats)
  values (a.user_id, a.id, 'device_calendar', '', 'idle', v_at, now(), v_start, v_end,
          jsonb_build_object('events', v_events, 'dropped', v_dropped, 'deleted', v_deleted,
                             'calendars', coalesce(array_length(v_cal_hashes, 1), 0)))
  on conflict (connected_account_id, resource, resource_key)
  do update set status = 'idle', last_success_at = excluded.last_success_at, last_full_sync_at = excluded.last_full_sync_at,
                window_start = excluded.window_start, window_end = excluded.window_end, stats = excluded.stats,
                consecutive_failures = 0, last_error_code = null;
  update public.connected_accounts ca set last_sync_at = now(), last_successful_sync_at = now()
  where ca.id = a.id;
  return jsonb_build_object('events', v_events, 'dropped', v_dropped, 'deleted', v_deleted, 'reminders', v_tasks);
end
$$;

-- ═══ Device snapshot staging (API-INT-06 → JOB-06) ═══════════════════════════════════════════
-- jobs.payload is limited to 8 KiB (ids only), so an accepted snapshot (≤ 1 MiB) waits here for its
-- device_calendar_ingest job, keyed by (account, content_hash) so an identical upload is a no-op.
create table private.device_snapshot_uploads (
  id uuid not null default gen_random_uuid(),
  connected_account_id uuid not null,
  user_id uuid not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint device_snapshot_uploads_pkey primary key (id),
  constraint device_snapshot_uploads_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint device_snapshot_uploads_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint device_snapshot_uploads_connected_account_id_content_hash_key unique (connected_account_id, content_hash)
);
create index device_snapshot_uploads_user_id_idx on private.device_snapshot_uploads (user_id);
create index device_snapshot_uploads_created_at_idx on private.device_snapshot_uploads (created_at);
alter table private.device_snapshot_uploads enable row level security;
alter table private.device_snapshot_uploads force row level security;
comment on table private.device_snapshot_uploads is
  'Accepted device calendar snapshots awaiting their device_calendar_ingest job (hashed native ids only; deleted once applied).';

create function private.stage_device_snapshot(p_account uuid, p_snapshot jsonb) returns uuid
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_id uuid;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found or a.provider not in ('apple_device', 'android_device') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Uploads whose job never ran (dead-lettered) do not linger.
  delete from private.device_snapshot_uploads u where u.connected_account_id = a.id and u.created_at < now() - interval '1 day';
  insert into private.device_snapshot_uploads (connected_account_id, user_id, content_hash, snapshot)
  values (a.id, a.user_id, p_snapshot ->> 'content_hash', p_snapshot)
  on conflict (connected_account_id, content_hash) do nothing
  returning id into v_id;
  if v_id is null then
    select u.id into v_id from private.device_snapshot_uploads u
    where u.connected_account_id = a.id and u.content_hash = p_snapshot ->> 'content_hash';
  end if;
  return v_id;
end
$$;

-- JOB-06: applies a staged snapshot once and removes it (a re-run finds nothing to do).
create function private.apply_staged_device_snapshot(p_account uuid, p_content_hash text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  u private.device_snapshot_uploads%rowtype;
  v_result jsonb;
begin
  select * into u from private.device_snapshot_uploads x
  where x.connected_account_id = p_account and x.content_hash = p_content_hash
  for update;
  if not found then
    return jsonb_build_object('skipped', 'already_applied');
  end if;
  v_result := private.apply_device_snapshot(u.connected_account_id, u.snapshot);
  delete from private.device_snapshot_uploads x where x.id = u.id;
  return v_result;
end
$$;

-- ═══ Disconnect and purge (API-INT-03, JOB-29; INTEGRATION_PLAN §3.14) ═════════════════════════

-- The database half of a disconnect, after the watches were stopped and the provider grant revoked:
-- status `disconnected`, ciphertext deleted, cursors and watch secrets cleared, calendars
-- deselected, queued sync jobs cancelled and `integration_purge` enqueued (now with
-- purge_content, otherwise after 30 days). An already disconnected account is returned unchanged.
create function private.disconnect_integration(
  p_account uuid, p_user uuid, p_revocation_mode text, p_purge_content boolean, p_correlation_id uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_at timestamptz := now();
  v_key text;
  v_job uuid;
  v_cancelled integer;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account and ca.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status = 'disconnected' then
    select j.id into v_job from public.jobs j
    where j.idempotency_key = 'integration_purge:' || a.id || ':' || extract(epoch from a.disconnected_at)::bigint;
    return jsonb_build_object('account', to_jsonb(a), 'already', true, 'purge_job_id', v_job,
                              'disconnected_at', a.disconnected_at);
  end if;
  if p_revocation_mode is not null and p_revocation_mode not in ('provider_revoked', 'local_only', 'device_local') then
    raise exception 'VALIDATION_FAILED:revocation_mode' using errcode = '22023';
  end if;

  delete from public.oauth_credentials c where c.connected_account_id = a.id;
  update public.sync_states s
    set cursor = null, page_token = null, backfill_cursor = null, status = 'paused', watch_kind = 'none', watch_id = null,
        watch_resource_id = null, watch_token_hash = null, watch_history_id = null, watch_expires_at = null,
        watch_renew_after = null, next_poll_at = null, rebaseline_due_at = null, lease_owner = null, lease_expires_at = null
  where s.connected_account_id = a.id;
  update public.calendars k set selected = false where k.connected_account_id = a.id and k.selected;
  update public.jobs j
    set status = 'completed', completed_at = v_at, lease_owner = null, lease_expires_at = null,
        last_error_code = 'CANCELLED', last_error_message = 'cancelled:account_disconnected',
        result = jsonb_build_object('skipped', 'account_disconnected')
  where j.connected_account_id = a.id and j.status in ('queued', 'retrying')
    and j.type in ('initial_sync', 'gmail_sync', 'outlook_sync', 'calendar_sync', 'tasks_sync', 'device_calendar_ingest',
                   'watch_renewal', 'reconciliation', 'provider_webhook');
  get diagnostics v_cancelled = row_count;
  update public.connected_accounts ca
    set status = 'disconnected', disconnected_at = v_at, revocation_mode = p_revocation_mode, pending_binding_until = null,
        reauth_required_at = null
  where ca.id = a.id
  returning * into a;

  v_key := 'integration_purge:' || a.id || ':' || extract(epoch from v_at)::bigint;
  v_job := private.enqueue_job(
    'integration_purge', v_key,
    jsonb_build_object('connected_account_id', a.id, 'user_id', a.user_id, 'purge_content', coalesce(p_purge_content, false),
                       'disconnected_at', v_at),
    a.user_id, a.id, case when coalesce(p_purge_content, false) then v_at else v_at + interval '30 days' end, 150, 6,
    p_correlation_id);
  return jsonb_build_object('account', to_jsonb(a), 'already', false, 'purge_job_id', v_job, 'disconnected_at', v_at,
                            'cancelled_jobs', v_cancelled);
end
$$;

-- One bounded purge step (JOB-29): the account's synced copies (and, with p_purge_derived, the
-- analyses sourced from them together with their memory chunks), then the account row itself.
-- Skips when the account was reconnected after p_disconnected_at. `done` is false while rows remain.
create function private.integration_purge_batch(
  p_account uuid, p_disconnected_at timestamptz, p_purge_derived boolean, p_batch integer default 500,
  p_reason text default 'disconnect'
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_batch integer := least(greatest(coalesce(p_batch, 500), 1), 5000);
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_msg_ids text[];
  v_thread_ids text[];
  v_event_ids text[];
  v_task_ids text[];
  v_sources text[];
begin
  select * into a from public.connected_accounts ca where ca.id = p_account for update;
  if not found then
    return jsonb_build_object('done', true, 'skipped', 'account_gone');
  end if;
  if p_reason = 'binding_expired' then
    if a.status <> 'connecting' or a.pending_binding_until is null or a.pending_binding_until > now() then
      return jsonb_build_object('done', true, 'skipped', 'bound');
    end if;
  elsif a.status <> 'disconnected' or (p_disconnected_at is not null and a.disconnected_at > p_disconnected_at) then
    return jsonb_build_object('done', true, 'skipped', 'reconnected');
  end if;

  select coalesce(array_agg(x.id::text), '{}') into v_msg_ids from (
    select e.id from public.email_messages e where e.connected_account_id = a.id limit v_batch) as x;
  select coalesce(array_agg(x.id::text), '{}') into v_thread_ids from (
    select t.id from public.email_threads t where t.connected_account_id = a.id
      and not exists (select 1 from public.email_messages e where e.thread_id = t.id and not (e.id::text = any(v_msg_ids)))
    limit v_batch) as x;
  select coalesce(array_agg(x.id::text), '{}') into v_event_ids from (
    select e.id from public.calendar_events e where e.connected_account_id = a.id limit v_batch) as x;
  select coalesce(array_agg(x.id::text), '{}') into v_task_ids from (
    select t.id from public.tasks t where t.connected_account_id = a.id limit v_batch) as x;
  v_sources := v_msg_ids || v_thread_ids || v_event_ids || v_task_ids;

  if coalesce(p_purge_derived, false) and cardinality(v_sources) > 0 then
    with d as (delete from public.memory_chunks m where m.user_id = a.user_id
                 and m.source_type in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event', 'task')
                 and m.source_id = any(v_sources) returning 1)
    select count(*) into v_n from d;
    v_counts := v_counts || jsonb_build_object('memory_chunks', v_n);
    with d as (delete from public.insights i where i.user_id = a.user_id
                 and ((i.source_type in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event', 'task')
                       and i.source_id = any(v_sources))
                      or (i.entity_type in ('email_thread', 'email_message', 'calendar_event', 'task')
                          and i.entity_id::text = any(v_sources)))
               returning 1)
    select count(*) into v_n from d;
    v_counts := v_counts || jsonb_build_object('insights', v_n);
    with d as (delete from public.life_events l where l.user_id = a.user_id
                 and l.source_type in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event', 'task')
                 and l.source_id = any(v_sources) returning 1)
    select count(*) into v_n from d;
    v_counts := v_counts || jsonb_build_object('life_events', v_n);
    with d as (delete from public.briefing_items b where b.user_id = a.user_id
                 and b.source_type in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event', 'task')
                 and b.source_id = any(v_sources) returning 1)
    select count(*) into v_n from d;
    v_counts := v_counts || jsonb_build_object('briefing_items', v_n);
    with d as (delete from public.commitments c where c.user_id = a.user_id and c.origin <> 'user'
                 and c.approval_action_id is null
                 and c.source_type in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event', 'task')
                 and c.source_id = any(v_sources) returning 1)
    select count(*) into v_n from d;
    v_counts := v_counts || jsonb_build_object('commitments', v_n);
  end if;

  delete from public.email_messages e where e.id::text = any(v_msg_ids);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('email_messages', v_n);
  delete from public.email_threads t where t.id::text = any(v_thread_ids);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('email_threads', v_n);
  delete from public.calendar_events e where e.id::text = any(v_event_ids);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('calendar_events', v_n);
  delete from public.tasks t where t.id::text = any(v_task_ids);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('tasks', v_n);

  if exists (select 1 from public.email_messages e where e.connected_account_id = a.id)
     or exists (select 1 from public.email_threads t where t.connected_account_id = a.id)
     or exists (select 1 from public.calendar_events e where e.connected_account_id = a.id)
     or exists (select 1 from public.tasks t where t.connected_account_id = a.id) then
    return jsonb_build_object('done', false, 'deleted', v_counts);
  end if;

  delete from public.calendars k where k.connected_account_id = a.id;
  delete from public.sync_states s where s.connected_account_id = a.id;
  -- Job history outlives the account (jobs.connected_account_id cascades), including this purge job.
  update public.jobs j set connected_account_id = null where j.connected_account_id = a.id;
  delete from public.connected_accounts ca where ca.id = a.id;
  return jsonb_build_object('done', true, 'deleted', v_counts || jsonb_build_object('connected_accounts', 1));
end
$$;

-- ═══ Demo adapter state (private.demo_fixture_state; INTEGRATION_PLAN §13.2) ═══════════════════

create function private.demo_state_get(p_account uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce(jsonb_object_agg(d.resource, jsonb_build_object('state', d.state, 'demo_clock', d.demo_clock)),
                    '{}'::jsonb)
    from private.demo_fixture_state d where d.connected_account_id = p_account
  $$;

-- Records one demo write under state.writes[p_key] exactly once (the key is the approval id, so a
-- retried write returns the stored item with created = false). Only demo accounts have state.
create function private.demo_state_record_write(p_account uuid, p_resource text, p_key text, p_item jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
  v_state jsonb;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found or a.provider <> 'demo' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_key is null or p_key = '' or jsonb_typeof(p_item) <> 'object' then
    raise exception 'VALIDATION_FAILED:demo_write' using errcode = '22023';
  end if;
  insert into private.demo_fixture_state (connected_account_id, user_id, resource, state)
  values (a.id, a.user_id, p_resource, '{"writes": {}}'::jsonb)
  on conflict (connected_account_id, resource) do nothing;
  select d.state into v_state from private.demo_fixture_state d
  where d.connected_account_id = a.id and d.resource = p_resource for update;
  if v_state #> array['writes', p_key] is not null then
    return jsonb_build_object('created', false, 'item', v_state #> array['writes', p_key]);
  end if;
  update private.demo_fixture_state d
    set state = jsonb_set(case when jsonb_typeof(d.state -> 'writes') = 'object' then d.state
                               else d.state || '{"writes": {}}'::jsonb end,
                          array['writes', p_key], p_item, true)
  where d.connected_account_id = a.id and d.resource = p_resource;
  return jsonb_build_object('created', true, 'item', p_item);
end
$$;

create function private.demo_state_set_clock(p_account uuid, p_resource text, p_clock timestamptz) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  a public.connected_accounts%rowtype;
begin
  select * into a from public.connected_accounts ca where ca.id = p_account;
  if not found or a.provider <> 'demo' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into private.demo_fixture_state as d (connected_account_id, user_id, resource, demo_clock)
  values (a.id, a.user_id, p_resource, p_clock)
  on conflict (connected_account_id, resource) do update set demo_clock = greatest(d.demo_clock, excluded.demo_clock);
end
$$;

-- ═══ Service-role wrappers (PostgREST exposes only public and admin_api) ═══════════════════════

create function public.acquire_sync_lease(p_sync_state uuid, p_owner text, p_seconds integer default 120) returns boolean
  language sql security definer set search_path = ''
  as $$ select private.acquire_sync_lease(p_sync_state, p_owner, p_seconds) $$;

create function public.release_sync_lease(p_sync_state uuid, p_owner text) returns void
  language sql security definer set search_path = ''
  as $$ select private.release_sync_lease(p_sync_state, p_owner) $$;

create function public.account_paused_by_plan(p_account uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.account_paused_by_plan(p_account) $$;

create function public.oauth_callback_store(
  p_state_id uuid, p_state jsonb, p_account jsonb default null, p_credentials jsonb default '[]'::jsonb
) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.oauth_callback_store(p_state_id, p_state, p_account, p_credentials) $$;

create function public.oauth_complete_binding(
  p_state_id uuid, p_user uuid, p_account_id uuid, p_account jsonb, p_credentials jsonb default '[]'::jsonb
) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.oauth_complete_binding(p_state_id, p_user, p_account_id, p_account, p_credentials) $$;

create function public.oauth_close_flow(p_state_id uuid, p_result text, p_error_code text default null) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.oauth_close_flow(p_state_id, p_result, p_error_code) $$;

create function public.upsert_mail_messages(p_account uuid, p_messages jsonb) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.upsert_mail_messages(p_account, p_messages) $$;

create function public.apply_mail_changes(p_account uuid, p_label_changes jsonb, p_deleted text[]) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.apply_mail_changes(p_account, p_label_changes, p_deleted) $$;

create function public.upsert_calendar_events(p_account uuid, p_calendar uuid, p_events jsonb, p_origin text)
  returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.upsert_calendar_events(p_account, p_calendar, p_events, p_origin) $$;

create function public.mark_calendar_events_deleted(p_calendar uuid, p_provider_event_ids text[]) returns integer
  language sql security definer set search_path = ''
  as $$ select private.mark_calendar_events_deleted(p_calendar, p_provider_event_ids) $$;

create function public.prune_calendar_events(
  p_calendar uuid, p_since timestamptz, p_window_start timestamptz default null, p_window_end timestamptz default null
) returns integer
  language sql security definer set search_path = ''
  as $$ select private.prune_calendar_events(p_calendar, p_since, p_window_start, p_window_end) $$;

create function public.upsert_calendars(p_account uuid, p_calendars jsonb) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.upsert_calendars(p_account, p_calendars) $$;

create function public.upsert_tasks(p_account uuid, p_tasks jsonb) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.upsert_tasks(p_account, p_tasks) $$;

create function public.upsert_device_account(
  p_user uuid, p_provider public.provider, p_installation uuid, p_capabilities public.capability[]
) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.upsert_device_account(p_user, p_provider, p_installation, p_capabilities) $$;

create function public.apply_device_snapshot(p_account uuid, p_snapshot jsonb) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.apply_device_snapshot(p_account, p_snapshot) $$;

create function public.stage_device_snapshot(p_account uuid, p_snapshot jsonb) returns uuid
  language sql security definer set search_path = ''
  as $$ select private.stage_device_snapshot(p_account, p_snapshot) $$;

create function public.apply_staged_device_snapshot(p_account uuid, p_content_hash text) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.apply_staged_device_snapshot(p_account, p_content_hash) $$;

create function public.disconnect_integration(
  p_account uuid, p_user uuid, p_revocation_mode text, p_purge_content boolean, p_correlation_id uuid default null
) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.disconnect_integration(p_account, p_user, p_revocation_mode, p_purge_content, p_correlation_id) $$;

create function public.integration_purge_batch(
  p_account uuid, p_disconnected_at timestamptz, p_purge_derived boolean, p_batch integer default 500,
  p_reason text default 'disconnect'
) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.integration_purge_batch(p_account, p_disconnected_at, p_purge_derived, p_batch, p_reason) $$;

create function public.demo_state_get(p_account uuid) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select private.demo_state_get(p_account) $$;

create function public.demo_state_record_write(p_account uuid, p_resource text, p_key text, p_item jsonb) returns jsonb
  language sql security definer set search_path = ''
  as $$ select private.demo_state_record_write(p_account, p_resource, p_key, p_item) $$;

create function public.demo_state_set_clock(p_account uuid, p_resource text, p_clock timestamptz) returns void
  language sql security definer set search_path = ''
  as $$ select private.demo_state_set_clock(p_account, p_resource, p_clock) $$;

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on function
  private.jsonb_text_array(jsonb),
  private.jsonb_email_array(jsonb, integer),
  private.allowed_conference_url(text),
  private.normalized_hex_color(text),
  private.account_paused_by_plan(uuid),
  private.acquire_sync_lease(uuid, text, integer),
  private.release_sync_lease(uuid, text),
  private.oauth_callback_store(uuid, jsonb, jsonb, jsonb),
  private.oauth_complete_binding(uuid, uuid, uuid, jsonb, jsonb),
  private.oauth_close_flow(uuid, text, text),
  private.upsert_mail_messages(uuid, jsonb),
  private.refresh_thread_aggregates(uuid[]),
  private.apply_mail_changes(uuid, jsonb, text[]),
  private.upsert_calendar_events(uuid, uuid, jsonb, text),
  private.mark_calendar_events_deleted(uuid, text[]),
  private.prune_calendar_events(uuid, timestamptz, timestamptz, timestamptz),
  private.upsert_calendars(uuid, jsonb),
  private.upsert_tasks(uuid, jsonb),
  private.upsert_device_account(uuid, public.provider, uuid, public.capability[]),
  private.apply_device_snapshot(uuid, jsonb),
  private.stage_device_snapshot(uuid, jsonb),
  private.apply_staged_device_snapshot(uuid, text),
  private.disconnect_integration(uuid, uuid, text, boolean, uuid),
  private.integration_purge_batch(uuid, timestamptz, boolean, integer, text),
  private.demo_state_get(uuid),
  private.demo_state_record_write(uuid, text, text, jsonb),
  private.demo_state_set_clock(uuid, text, timestamptz)
from public, anon, authenticated;

revoke execute on function
  public.acquire_sync_lease(uuid, text, integer),
  public.release_sync_lease(uuid, text),
  public.account_paused_by_plan(uuid),
  public.oauth_callback_store(uuid, jsonb, jsonb, jsonb),
  public.oauth_complete_binding(uuid, uuid, uuid, jsonb, jsonb),
  public.oauth_close_flow(uuid, text, text),
  public.upsert_mail_messages(uuid, jsonb),
  public.apply_mail_changes(uuid, jsonb, text[]),
  public.upsert_calendar_events(uuid, uuid, jsonb, text),
  public.mark_calendar_events_deleted(uuid, text[]),
  public.prune_calendar_events(uuid, timestamptz, timestamptz, timestamptz),
  public.upsert_calendars(uuid, jsonb),
  public.upsert_tasks(uuid, jsonb),
  public.upsert_device_account(uuid, public.provider, uuid, public.capability[]),
  public.apply_device_snapshot(uuid, jsonb),
  public.stage_device_snapshot(uuid, jsonb),
  public.apply_staged_device_snapshot(uuid, text),
  public.disconnect_integration(uuid, uuid, text, boolean, uuid),
  public.integration_purge_batch(uuid, timestamptz, boolean, integer, text),
  public.demo_state_get(uuid),
  public.demo_state_record_write(uuid, text, text, jsonb),
  public.demo_state_set_clock(uuid, text, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.acquire_sync_lease(uuid, text, integer),
  public.release_sync_lease(uuid, text),
  public.account_paused_by_plan(uuid),
  public.oauth_callback_store(uuid, jsonb, jsonb, jsonb),
  public.oauth_complete_binding(uuid, uuid, uuid, jsonb, jsonb),
  public.oauth_close_flow(uuid, text, text),
  public.upsert_mail_messages(uuid, jsonb),
  public.apply_mail_changes(uuid, jsonb, text[]),
  public.upsert_calendar_events(uuid, uuid, jsonb, text),
  public.mark_calendar_events_deleted(uuid, text[]),
  public.prune_calendar_events(uuid, timestamptz, timestamptz, timestamptz),
  public.upsert_calendars(uuid, jsonb),
  public.upsert_tasks(uuid, jsonb),
  public.upsert_device_account(uuid, public.provider, uuid, public.capability[]),
  public.apply_device_snapshot(uuid, jsonb),
  public.stage_device_snapshot(uuid, jsonb),
  public.apply_staged_device_snapshot(uuid, text),
  public.disconnect_integration(uuid, uuid, text, boolean, uuid),
  public.integration_purge_batch(uuid, timestamptz, boolean, integer, text),
  public.demo_state_get(uuid),
  public.demo_state_record_write(uuid, text, text, jsonb),
  public.demo_state_set_clock(uuid, text, timestamptz)
to service_role;

comment on function public.oauth_complete_binding(uuid, uuid, uuid, jsonb, jsonb) is
  'API-INT-07 (R-07): swaps the re-encrypted credentials in and activates the account in one transaction.';
comment on function public.apply_device_snapshot(uuid, jsonb) is
  'JOB-06: applies one full-window EventKit / CalendarContract snapshot (upsert, window delete, reminders).';
comment on function public.integration_purge_batch(uuid, timestamptz, boolean, integer, text) is
  'JOB-29: one bounded purge step of a disconnected (or never bound) account.';
