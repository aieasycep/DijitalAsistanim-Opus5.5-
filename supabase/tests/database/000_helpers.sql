-- pgTAP helpers (docs/DATABASE_AND_RLS_PLAN.md §13), schema `tests`. Not a suite: both runners
-- (scripts/db/tier-c.sh, scripts/db/tier-a.sh) load this file once before the *.test.sql files.
-- Identity helpers switch the role and the GoTrue claims for the rest of the current transaction
-- (set_config(..., true)); every suite runs inside begin … rollback, so nothing leaks.
-- Fixture helpers (tests.make_*) write as the calling superuser and must be called before
-- switching to a client role or after tests.clear_authentication().

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- The admin-api gateway secret used by every admin test (its sha256 is the stored digest).
create or replace function tests.gateway_secret() returns text
  language sql immutable
  as $$ select 'da-test-gateway-secret'::text $$;

insert into public.app_settings (key, value, description)
values ('admin.gateway_secret_sha256',
        to_jsonb(encode(sha256(convert_to('da-test-gateway-secret', 'UTF8')), 'hex')),
        'sha256 of the admin-api gateway secret (pgTAP helper value).')
on conflict (key) do update set value = excluded.value;

-- ─── Identities ───────────────────────────────────────────────────────────────────────────────

-- Deterministic app user (handle_new_user creates profile, preferences, notification prefs and
-- the referral code).
create or replace function tests.create_user(p_email text, p_timezone text default 'Europe/Istanbul') returns uuid
  language plpgsql
  as $$
declare
  v_id uuid := md5('da-test-user:' || lower(p_email))::uuid;
begin
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  values (v_id, lower(p_email), '{"provider": "email"}'::jsonb, jsonb_build_object('timezone', p_timezone))
  on conflict (id) do nothing;
  return v_id;
end
$$;

create or replace function tests.user_id(p_email text) returns uuid
  language sql immutable
  as $$ select md5('da-test-user:' || lower(p_email))::uuid $$;

-- Pro through a 30-day admin grant.
create or replace function tests.make_pro(p_user uuid) returns uuid
  language sql
  as $$
    select (private.grant_entitlement(p_user, 'admin', 30::smallint, 'pgTAP pro fixture', null, 'test_pro:' || p_user)).id
  $$;

-- Claims as GoTrue issues them; `request.headers` carries the admin-api gateway secret.
create or replace function tests.set_claims(p_claims jsonb) returns void
  language plpgsql
  as $$
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_claims ->> 'sub', ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_claims ->> 'role', ''), true);
  perform set_config('request.headers', jsonb_build_object('x-da-admin-gateway', tests.gateway_secret())::text, true);
end
$$;

create or replace function tests.authenticate_as(p_user uuid, p_aal text default 'aal1', p_session uuid default null)
  returns void
  language plpgsql
  as $$
begin
  perform tests.set_claims(jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
    'session_id', coalesce(p_session, md5('da-test-session:' || p_user)::uuid),
    'app_metadata', coalesce((select u.raw_app_meta_data from auth.users u where u.id = p_user), '{}'::jsonb)));
  perform set_config('role', 'authenticated', true);
end
$$;

-- Creates (or reuses) a dedicated admin identity with an active admin_users row and a live
-- admin session, then authenticates as that admin. Returns the admin user id.
create or replace function tests.create_admin(p_email text, p_role public.admin_role, p_status public.admin_status default 'active')
  returns uuid
  language plpgsql
  as $$
declare
  v_id uuid := md5('da-test-admin:' || lower(p_email))::uuid;
begin
  insert into auth.users (id, email, raw_app_meta_data)
  values (v_id, lower(p_email), '{"provider": "email", "da_kind": "admin"}'::jsonb)
  on conflict (id) do nothing;
  insert into public.admin_users (user_id, role, status, display_name, email, activated_at)
  values (v_id, p_role, p_status, initcap(split_part(p_email, '@', 1)), lower(p_email),
          case when p_status = 'active' then now() end)
  on conflict (user_id) do update set role = excluded.role, status = excluded.status;
  insert into public.admin_sessions (admin_user_id, auth_session_id, aal, idle_expires_at, absolute_expires_at)
  values (v_id, md5('da-test-session:' || v_id)::uuid, 'aal2', now() + interval '30 minutes', now() + interval '12 hours')
  on conflict (auth_session_id) do update
    set ended_at = null, end_reason = null, last_activity_at = now(), idle_expires_at = now() + interval '30 minutes',
        absolute_expires_at = now() + interval '12 hours', created_at = now();
  return v_id;
end
$$;

create or replace function tests.authenticate_as_admin(p_role public.admin_role, p_aal text default 'aal2', p_email text default null)
  returns uuid
  language plpgsql
  as $$
declare
  v_id uuid := tests.create_admin(coalesce(p_email, p_role::text || '@admin.test'), p_role);
begin
  perform tests.authenticate_as(v_id, p_aal);
  return v_id;
end
$$;

create or replace function tests.as_anon() returns void
  language plpgsql
  as $$
begin
  perform tests.set_claims(jsonb_build_object('role', 'anon'));
  perform set_config('role', 'anon', true);
end
$$;

create or replace function tests.as_service_role() returns void
  language plpgsql
  as $$
begin
  perform tests.set_claims(jsonb_build_object('role', 'service_role'));
  perform set_config('role', 'service_role', true);
end
$$;

create or replace function tests.clear_authentication() returns void
  language plpgsql
  as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('role', 'none', true);
end
$$;

-- ─── Fixtures (call as the superuser) ─────────────────────────────────────────────────────────

create or replace function tests.make_account(
  p_user uuid, p_email text, p_caps public.capability[] default '{mail_read,calendar_read}',
  p_provider public.provider default 'google', p_status public.account_status default 'healthy'
) returns uuid
  language sql
  as $$
    insert into public.connected_accounts (user_id, provider, provider_account_id, account_email, status, capabilities_granted,
                                           granted_scopes, connected_at, demo_flavor)
    values (p_user, p_provider, md5('acct:' || p_user || ':' || p_email), p_email, p_status, p_caps, '{}', now(),
            case when p_provider = 'demo' then 'google' end)
    returning id
  $$;

create or replace function tests.make_calendar(p_user uuid, p_account uuid, p_name text default 'Takvim', p_selected boolean default true)
  returns uuid
  language sql
  as $$
    insert into public.calendars (user_id, connected_account_id, provider, provider_calendar_id, name, access_role, selected,
                                  can_write)
    values (p_user, p_account, 'google', md5(p_account || ':' || p_name), p_name, 'owner', p_selected, true)
    returning id
  $$;

create or replace function tests.make_event(
  p_user uuid, p_account uuid, p_calendar uuid, p_title text, p_start timestamptz, p_end timestamptz,
  p_attendees jsonb default '[]'::jsonb
) returns uuid
  language sql
  as $$
    insert into public.calendar_events (user_id, connected_account_id, calendar_id, provider, provider_event_id, title, start_at,
                                        end_at, attendees, attendee_count, origin)
    values (p_user, p_account, p_calendar, 'google', md5(p_calendar || ':' || p_title || ':' || p_start), p_title, p_start, p_end,
            p_attendees, jsonb_array_length(p_attendees), 'provider_sync')
    returning id
  $$;

create or replace function tests.make_thread(p_user uuid, p_account uuid, p_subject text, p_at timestamptz default now())
  returns uuid
  language sql
  as $$
    insert into public.email_threads (user_id, connected_account_id, provider, provider_thread_id, subject, last_message_at,
                                      message_count)
    values (p_user, p_account, 'google', md5(p_account || ':' || p_subject || ':' || p_at), p_subject, p_at, 1)
    returning id
  $$;

create or replace function tests.make_message(
  p_user uuid, p_account uuid, p_thread uuid, p_subject text, p_from text default 'sender@example.com',
  p_at timestamptz default now()
) returns uuid
  language sql
  as $$
    insert into public.email_messages (user_id, connected_account_id, thread_id, provider, provider_message_id, direction,
                                       from_email, subject, snippet, received_at, content_hash)
    values (p_user, p_account, p_thread, 'google', md5(p_thread || ':' || p_subject || ':' || p_at), 'inbound', p_from,
            p_subject, left(p_subject, 200), p_at, sha256(convert_to(p_thread || p_subject, 'UTF8')))
    returning id
  $$;

create or replace function tests.make_insight(
  p_user uuid, p_title text default 'Test insight', p_kind public.insight_kind default 'reply_needed',
  p_status public.item_status default 'open', p_due_at timestamptz default null
) returns uuid
  language sql
  as $$
    insert into public.insights (user_id, kind, title, decision_tier, reason_code, entity_type, entity_id, dedupe_key,
                                 source_type, source_id, source_timestamp, confidence, status, due_at, snoozed_until)
    values (p_user, p_kind, p_title, 'deterministic_signal', 'test_reason', 'email_thread', gen_random_uuid(),
            'test:' || gen_random_uuid(), 'user_input', 'test', now(), 0.9, p_status, p_due_at,
            case when p_status = 'snoozed' then now() + interval '1 day' end)
    returning id
  $$;

create or replace function tests.make_commitment(p_user uuid, p_text text default 'Teklifi yarın göndereceğim.')
  returns uuid
  language sql
  as $$
    insert into public.commitments (user_id, direction, text, counterparty_name, dedupe_key, origin, source_type, source_id,
                                    source_timestamp, confidence, due_at)
    values (p_user, 'user_owes', p_text, 'Mehmet Yılmaz', 'test:' || gen_random_uuid(), 'user', 'user_input', 'test', now(), 1,
            now() + interval '1 day')
    returning id
  $$;

create or replace function tests.make_life_event(p_user uuid, p_title text default 'Kargo yolda',
                                                 p_type public.life_event_type default 'shipment')
  returns uuid
  language sql
  as $$
    insert into public.life_events (user_id, type, title, dedupe_key, source_type, source_id, source_timestamp, confidence)
    values (p_user, p_type, p_title, 'test:' || gen_random_uuid(), 'user_input', 'test', now(), 0.9)
    returning id
  $$;

create or replace function tests.make_contact(p_user uuid, p_name text, p_email text, p_origin text default 'mail')
  returns uuid
  language sql
  as $$
    insert into public.contacts (user_id, display_name, primary_email, emails, avatar_seed, origin, last_contact_at)
    values (p_user, p_name, p_email, array[p_email]::extensions.citext[], 7, p_origin, now())
    returning id
  $$;

-- A 1024-d unit-ish vector with weight on one axis (deterministic fixture embeddings).
create or replace function tests.axis_vector(p_axis integer, p_noise real default 0) returns extensions.vector
  language sql immutable
  as $$
    select (array_agg(case when g = p_axis then 1::real else p_noise end order by g))::real[]::extensions.vector
    from generate_series(1, 1024) as g
  $$;

create or replace function tests.make_memory(
  p_user uuid, p_content text, p_embedding extensions.vector default null, p_at timestamptz default now(),
  p_contact_ids uuid[] default '{}'
) returns uuid
  language sql
  as $$
    insert into public.memory_chunks (user_id, source_type, source_id, source_timestamp, confidence, chunk_kind, content,
                                      content_hash, embedding, embedded_at, occurred_at, contact_ids)
    values (p_user, 'user_input', 'test:' || md5(p_content), p_at, 0.9, 'email_summary', p_content,
            sha256(convert_to(p_user || p_content, 'UTF8')), p_embedding,
            case when p_embedding is not null then now() end, p_at, p_contact_ids)
    returning id
  $$;

create or replace function tests.make_approval(
  p_user uuid, p_action_type public.approval_action_type default 'task_create', p_executor text default 'server',
  p_expires timestamptz default now() + interval '1 day', p_installation uuid default null
) returns uuid
  language plpgsql
  as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.approval_actions (id, user_id, action_type, payload, payload_hash, what, change_summary, idempotency_key,
                                       origin, source_type, source_id, source_timestamp, confidence, executor,
                                       device_installation_id, approval_expires_at)
  values (v_id, p_user, p_action_type, '{"title": "Teklif hazırlama"}', sha256('payload'::bytea), 'Görev oluştur',
          'Yeni görev', 'approval:' || v_id || ':v1', 'assistant', 'user_input', 'test', now(), 0.9, p_executor,
          p_installation, p_expires);
  return v_id;
end
$$;

create or replace function tests.make_installation(p_user uuid, p_platform public.platform default 'ios',
                                                   p_version text default '1.0.0')
  returns uuid
  language sql
  as $$
    insert into public.app_installations (user_id, installation_id, platform, app_version, build_number, device_hash, push_enabled)
    values (p_user, gen_random_uuid(), p_platform, p_version, '1', sha256(convert_to('device:' || p_user || p_platform, 'UTF8')), true)
    returning id
  $$;

create or replace function tests.make_briefing(
  p_user uuid, p_kind public.briefing_kind default 'morning', p_status public.briefing_status default 'ready',
  p_local_date date default current_date
) returns uuid
  language sql
  as $$
    insert into public.briefings (user_id, kind, local_date, time_zone, scheduled_for, status, idempotency_key, generated_at)
    values (p_user, p_kind, p_local_date, 'Europe/Istanbul', now(), p_status,
            'briefing:' || p_user || ':' || p_kind || ':' || p_local_date,
            case when p_status in ('ready', 'delivered') then now() end)
    returning id
  $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
