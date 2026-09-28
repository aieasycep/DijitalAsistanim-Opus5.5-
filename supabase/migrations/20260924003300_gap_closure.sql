-- Gap closure of the as-built review (GAP-1): configuration and SQL behind
--   · the referral reward kill switch `referral.rewards_enabled` (STORE_CHECKLIST Guideline 3.1.1):
--     off → no new credits or Pro grants for either side; codes still apply, qualification is
--     recorded and history is kept (the referral stays `qualified` with
--     risk_signals.reward_withheld = 'rewards_disabled'; an admin can reward it later through
--     ADM-12 once rewards are on again);
--   · the Google OAuth verification status `google.oauth_verified` (KPL-32; default false): read by
--     GET /me/bootstrap (config.google_oauth_verified) and the `google_oauth` health probe;
--   · the disaster-recovery embeddings `ai.embedding_dr` (AI_PIPELINE_PLAN §10.8 step 6, ADR-45):
--     turning `reembed` on enqueues the first `embedding {mode:'reembed'}` job (the worker fills
--     memory_chunks.embedding_dr in batches); `search` switches the vector leg of RPC-02 to
--     `embedding_dr` (the api embeds queries with the same DR target);
--   · the price row of the DR embedding model (USD per million tokens; manual external step:
--     re-verify on the OpenAI pricing page before relying on the recorded cost);
--   · the per-user feature usage (`admin_api.user_usage`) counts the app's analytics rows only, now
--     that the Edge Functions also write the API_CONTRACTS §17.1 server events (`session_id` null).
-- private.valid_app_setting keeps every earlier key (20260924002300) and adds the three keys.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ App settings ═════════════════════════════════════════════════════════════════════════════
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
      when p_key = 'app.min_supported_version' then
        jsonb_typeof(p_value) = 'object'
        and (select count(*) from jsonb_object_keys(p_value)) = 2
        and coalesce(p_value ->> 'ios', '') ~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$'
        and coalesce(p_value ->> 'android', '') ~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$'
      when p_key = 'google.calendar_write_scope' then
        jsonb_typeof(p_value) = 'string'
        and (p_value #>> '{}') in ('https://www.googleapis.com/auth/calendar.events.owned',
                                   'https://www.googleapis.com/auth/calendar.events')
      -- GAP-1: the referral reward kill switch and the Google OAuth verification status.
      when p_key in ('referral.rewards_enabled', 'google.oauth_verified') then
        jsonb_typeof(p_value) = 'boolean'
      -- GAP-1: disaster-recovery embeddings; the DR target is always a 1024-d OpenAI model (R-01).
      when p_key = 'ai.embedding_dr' then
        jsonb_typeof(p_value) = 'object'
        and (select count(*) from jsonb_object_keys(p_value)) = 5
        and jsonb_typeof(p_value -> 'reembed') = 'boolean'
        and jsonb_typeof(p_value -> 'search') = 'boolean'
        and coalesce(p_value ->> 'provider', '') = 'openai'
        and coalesce(p_value ->> 'model', '') ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
        and jsonb_typeof(p_value -> 'dimensions') = 'number'
        and private.jsonb_numeric(p_value -> 'dimensions') = 1024
      else false
    end, false)
  $$;

insert into public.app_settings (key, value, description) values
  ('referral.rewards_enabled', 'true',
   'Referral reward kill switch: false stops new credits and Pro grants for both sides; codes still apply and history is kept (App Store 3.1.1).'),
  ('google.oauth_verified', 'false',
   'Google verified the OAuth app and the restricted Gmail scope (CASA LOA). False: unverified notice on the Gmail explainer and the 100-user cap detail on System Health.'),
  ('ai.embedding_dr', '{"reembed": false, "search": false, "provider": "openai", "model": "text-embedding-3-small", "dimensions": 1024}',
   'Disaster-recovery embeddings: reembed=true fills memory_chunks.embedding_dr through embedding jobs; search=true makes search use embedding_dr and the DR query model.')
on conflict (key) do nothing;

-- The DR embedding model's price (input per million tokens; embeddings have no output tokens).
insert into public.ai_model_prices
  (provider, model, input_per_mtok_usd, output_per_mtok_usd, cache_write_5m_per_mtok_usd,
   cache_write_1h_per_mtok_usd, cache_read_per_mtok_usd, audio_per_min_usd, chars_per_million_usd, effective_from)
values
  ('openai', 'text-embedding-3-small', 0.02, 0.00, null, null, null, null, null, '2026-09-28T00:00:00Z')
on conflict (provider, model, effective_from) do nothing;

-- ═══ Readers ══════════════════════════════════════════════════════════════════════════════════

-- `referral.rewards_enabled` (missing or malformed → on, the documented default).
create function private.referral_rewards_enabled() returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce((select (s.value #>> '{}')::boolean from public.app_settings s
                     where s.key = 'referral.rewards_enabled' and jsonb_typeof(s.value) = 'boolean'), true)
  $$;

-- `ai.embedding_dr.search`: the vector leg reads `embedding_dr` instead of `embedding`.
create function private.embedding_dr_search() returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select coalesce((select (s.value ->> 'search')::boolean from public.app_settings s
                     where s.key = 'ai.embedding_dr' and jsonb_typeof(s.value -> 'search') = 'boolean'), false)
  $$;

-- ═══ Referral rewards honour the kill switch ═══════════════════════════════════════════════════

-- A qualified referral whose reward is withheld because rewards are off: it stays `qualified`, the
-- reason is recorded once in risk_signals and audited once; nothing is credited or granted.
create function private.referral_reward_withheld(p_referral_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_id uuid;
  v_referrer uuid;
begin
  update public.referrals x
  set risk_signals = x.risk_signals || jsonb_build_object('reward_withheld', 'rewards_disabled')
  where x.id = p_referral_id and not (x.risk_signals ? 'reward_withheld')
  returning x.id, x.referrer_id into v_id, v_referrer;
  if v_id is not null then
    perform private.audit_log_append('system', null, null, 'system.referral.reward_withheld', 'referral', v_id::text,
                                     v_referrer, null, 'success', jsonb_build_object('reason', 'rewards_disabled'), null);
  end if;
  return jsonb_build_object('status', 'qualified', 'rewards_disabled', true, 'days', 0, 'sides', '[]'::jsonb);
end
$$;

-- As 20260924001300_functions_private.sql, plus the kill switch before any credit is written.
create or replace function private.reward_referral(p_referral_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.referrals;
  v_days smallint := private.app_setting_int('referral.reward_days', 14)::smallint;
  v_cap integer;
  v_used integer;
  v_side public.referral_side;
  v_user uuid;
  v_credit uuid;
  v_grant public.entitlement_grants;
  v_result jsonb := '{}'::jsonb;
begin
  select * into r from public.referrals x where x.id = p_referral_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.status = 'rewarded' then
    return jsonb_build_object('status', 'rewarded', 'replayed', true);
  end if;
  if r.status <> 'qualified' then
    raise exception 'ILLEGAL_TRANSITION:%->rewarded', r.status using errcode = '55000';
  end if;
  if not private.referral_rewards_enabled() then
    return private.referral_reward_withheld(r.id);
  end if;

  if r.referrer_id is not null then
    v_cap := coalesce(private.plan_limit_int(r.referrer_id, 'referral_rewards_per_year'), 6);
    select count(*) into v_used from public.referral_credits c
    where c.user_id = r.referrer_id and c.side = 'referrer' and c.created_at > now() - interval '365 days';
    if v_used >= v_cap then
      update public.referrals x set status = 'rejected', rejected_at = now(), reject_reason = 'cap_reached'
      where x.id = r.id;
      perform private.audit_log_append('system', null, null, 'referral.rejected', 'referral', r.id::text, r.referrer_id,
                                       null, 'success', jsonb_build_object('reason', 'cap_reached'), null);
      return jsonb_build_object('status', 'rejected', 'reason', 'cap_reached');
    end if;
  end if;

  foreach v_side in array array['referrer', 'referee']::public.referral_side[] loop
    v_user := case v_side when 'referrer' then r.referrer_id else r.referee_id end;
    continue when v_user is null;
    insert into public.referral_credits (referral_id, user_id, side, days, idempotency_key)
    values (r.id, v_user, v_side, v_days, 'referral:' || r.id || ':' || v_side)
    on conflict (referral_id, side) do nothing
    returning id into v_credit;
    if v_credit is null then
      select c.id into v_credit from public.referral_credits c where c.referral_id = r.id and c.side = v_side;
    end if;
    v_grant := private.grant_entitlement(v_user,
                 case v_side when 'referrer' then 'referral_referrer' else 'referral_referee' end::public.grant_source,
                 v_days, null, null, 'referral:' || r.id || ':' || v_side, v_credit);
    update public.referral_credits c set entitlement_grant_id = v_grant.id
    where c.id = v_credit and c.entitlement_grant_id is null;
    v_result := v_result || jsonb_build_object(v_side::text, jsonb_build_object('credit_id', v_credit, 'grant_id', v_grant.id));
  end loop;

  update public.referrals x set status = 'rewarded', rewarded_at = now() where x.id = r.id;
  perform private.audit_log_append('system', null, null, 'referral.rewarded', 'referral', r.id::text, r.referrer_id,
                                   null, 'success', jsonb_build_object('days', v_days), null);
  return v_result || jsonb_build_object('status', 'rewarded');
end
$$;

-- As 20260924002210_referrals.sql, plus the kill switch before any credit is written.
create or replace function private.reward_referral_with_cap(p_referral_id uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  r public.referrals;
  v_days smallint := private.app_setting_int('referral.reward_days', 14)::smallint;
  v_cap integer;
  v_used integer;
  v_credit uuid;
  v_grant public.entitlement_grants;
  v_result jsonb;
begin
  select * into r from public.referrals x where x.id = p_referral_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.status = 'rewarded' then
    return jsonb_build_object('status', 'rewarded', 'replayed', true, 'days', v_days,
                              'sides', coalesce((select jsonb_agg(c.side order by c.side) from public.referral_credits c
                                                 where c.referral_id = r.id), '[]'::jsonb));
  end if;
  if r.status <> 'qualified' then
    raise exception 'ILLEGAL_TRANSITION:%->rewarded', r.status using errcode = '55000';
  end if;
  if not private.referral_rewards_enabled() then
    return private.referral_reward_withheld(r.id);
  end if;
  if r.referrer_id is not null then
    v_cap := coalesce(private.plan_limit_int(r.referrer_id, 'referral_rewards_per_year'), 6);
    select count(*) into v_used from public.referral_credits c
    where c.user_id = r.referrer_id and c.side = 'referrer' and c.created_at > now() - interval '365 days';
    if v_used < v_cap then
      v_result := private.reward_referral(r.id);
      return v_result || jsonb_build_object(
        'days', v_days,
        'sides', coalesce((select jsonb_agg(c.side order by c.side) from public.referral_credits c
                           where c.referral_id = r.id), '[]'::jsonb));
    end if;
  end if;
  if r.referee_id is null then
    raise exception 'STATE_CONFLICT:referee_deleted' using errcode = '55000';
  end if;

  insert into public.referral_credits (referral_id, user_id, side, days, idempotency_key)
  values (r.id, r.referee_id, 'referee', v_days, 'referral:' || r.id || ':referee')
  on conflict (referral_id, side) do nothing
  returning id into v_credit;
  if v_credit is null then
    select c.id into v_credit from public.referral_credits c where c.referral_id = r.id and c.side = 'referee';
  end if;
  v_grant := private.grant_entitlement(r.referee_id, 'referral_referee', v_days, null, null,
                                       'referral:' || r.id || ':referee', v_credit);
  update public.referral_credits c set entitlement_grant_id = v_grant.id where c.id = v_credit and c.entitlement_grant_id is null;
  update public.referrals x
  set status = 'rewarded', rewarded_at = now(),
      risk_signals = x.risk_signals || jsonb_build_object('referrer_withheld',
                                                          case when r.referrer_id is null then 'referrer_deleted' else 'cap_reached' end)
  where x.id = r.id;
  perform private.audit_log_append('system', null, null, 'system.referral.rewarded', 'referral', r.id::text, r.referee_id,
                                   null, 'success',
                                   jsonb_build_object('days', v_days, 'referrer_withheld',
                                                      case when r.referrer_id is null then 'referrer_deleted' else 'cap_reached' end),
                                   null);
  return jsonb_build_object('status', 'rewarded', 'days', v_days, 'sides', jsonb_build_array('referee'),
                            'referee', jsonb_build_object('credit_id', v_credit, 'grant_id', v_grant.id),
                            'referrer_withheld', case when r.referrer_id is null then 'referrer_deleted' else 'cap_reached' end);
end
$$;

-- ═══ Disaster-recovery embeddings ═════════════════════════════════════════════════════════════

-- Turning `ai.embedding_dr.reembed` on queues the first DR re-embed batch; the worker continues
-- batch by batch (JOB-16 `embedding {mode:'reembed', after_id}`) while the setting stays on.
create function private.app_settings_embedding_dr_changed() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.key = 'ai.embedding_dr'
     and coalesce((new.value ->> 'reembed')::boolean, false)
     and not coalesce((old.value ->> 'reembed')::boolean, false) then
    perform private.enqueue_job('embedding', 'embedding:dr:' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
                                jsonb_build_object('mode', 'reembed'), null, null, now(), 150, 5, null);
  end if;
  return new;
end
$$;

create trigger trg_app_settings_embedding_dr after update of value on public.app_settings
  for each row execute function private.app_settings_embedding_dr_changed();

-- As 20260924001310_functions_public_rpcs.sql; with `ai.embedding_dr.search` on the ranking runs
-- over `embedding_dr` (an exact scan: its HNSW index is created only by the DR runbook). The query
-- embedding then comes from the same DR model (api `embedQueryText`).
create or replace function public.memory_vector_candidates(
  p_query_embedding extensions.vector(1024), p_from timestamptz default null, p_to timestamptz default null,
  p_contact_id uuid default null, p_min integer default 20
) returns uuid[]
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v_ids uuid[] := '{}';
begin
  if v_uid is null or p_query_embedding is null then
    return v_ids;
  end if;
  if extensions.vector_dims(p_query_embedding) <> 1024 then
    raise exception 'VALIDATION_FAILED:query_embedding' using errcode = '22023';
  end if;
  if not private.is_pro(v_uid) then
    return v_ids;
  end if;
  if private.embedding_dr_search() then
    with own as materialized (
      select m.id, m.embedding_dr from public.memory_chunks m
      where m.user_id = v_uid and m.embedding_dr is not null
        and (m.expires_at is null or m.expires_at > now())
        and m.source_timestamp >= v_from and m.source_timestamp < v_to
        and (p_contact_id is null or p_contact_id = any(m.contact_ids)))
    select coalesce(array_agg(o.id order by o.embedding_dr operator(extensions.<=>) p_query_embedding), '{}') into v_ids
    from (select own.id, own.embedding_dr from own
          order by own.embedding_dr operator(extensions.<=>) p_query_embedding limit 200) as o;
    return v_ids;
  end if;
  perform set_config('hnsw.ef_search', '200', true);
  select coalesce(array_agg(x.id order by x.dist), '{}') into v_ids
  from (select m.id, m.embedding operator(extensions.<=>) p_query_embedding as dist
        from public.memory_chunks m
        where m.user_id = v_uid and m.embedding is not null
          and (m.expires_at is null or m.expires_at > now())
          and m.source_timestamp >= v_from and m.source_timestamp < v_to
          and (p_contact_id is null or p_contact_id = any(m.contact_ids))
        order by m.embedding operator(extensions.<=>) p_query_embedding
        limit 200) as x;
  if coalesce(array_length(v_ids, 1), 0) < least(greatest(coalesce(p_min, 20), 1), 200) then
    with own as materialized (
      select m.id, m.embedding from public.memory_chunks m
      where m.user_id = v_uid and m.embedding is not null
        and (m.expires_at is null or m.expires_at > now())
        and m.source_timestamp >= v_from and m.source_timestamp < v_to
        and (p_contact_id is null or p_contact_id = any(m.contact_ids)))
    select coalesce(array_agg(o.id order by o.embedding operator(extensions.<=>) p_query_embedding), '{}') into v_ids
    from (select own.id, own.embedding from own
          order by own.embedding operator(extensions.<=>) p_query_embedding limit 200) as o;
  end if;
  return v_ids;
end
$$;

-- ═══ Server analytics events ══════════════════════════════════════════════════════════════════
-- The Edge Functions now write the API_CONTRACTS §17.1 events (`session_id` null). `search_performed`
-- is emitted by the app and by API-SRCH-01, so the per-user feature usage (`GET /users/:id/usage`)
-- counts the app's rows only. As 20260924001320_functions_admin_api.sql otherwise.
create or replace function admin_api.user_usage(p_user uuid, p_range text default '30d') returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('users.read');
  v_days integer;
  v_from timestamptz;
  v_cap integer;
begin
  perform private.admin_assert_user(p_user);
  v_days := case coalesce(p_range, '30d') when '7d' then 7 when '30d' then 30 when '90d' then 90 end;
  if v_days is null then
    raise exception 'VALIDATION_FAILED:range' using errcode = '22023';
  end if;
  v_from := now() - make_interval(days => v_days);
  v_cap := private.plan_limit_int(p_user, 'ai_daily_budget_units');
  return jsonb_build_object(
    'range', coalesce(p_range, '30d'),
    'ai', jsonb_build_object(
      'days', coalesce((select jsonb_agg(jsonb_build_object('date', u.local_date, 'feature', u.feature, 'requests', u.requests,
                                                            'input_tokens', u.input_tokens, 'output_tokens', u.output_tokens,
                                                            'cost_usd', round(u.cost_usd_micros / 1000000.0, 4), 'units', u.units_used)
                                         order by u.local_date desc, u.feature)
                        from public.ai_usage_daily u where u.user_id = p_user and u.local_date >= v_from::date), '[]'::jsonb),
      'daily_budget_units', v_cap,
      'budget_hit_days', (select count(*) from (select u.local_date from public.ai_usage_daily u
                                                where u.user_id = p_user and u.local_date >= v_from::date
                                                group by u.local_date
                                                having v_cap is not null and sum(u.units_used) >= v_cap) as d)),
    'feature_usage', coalesce((select jsonb_object_agg(x.event_name, x.n)
                               from (select e.event_name, count(*) as n from public.analytics_events e
                                     where e.user_id = p_user and e.occurred_at >= v_from
                                       and e.session_id is not null
                                       and e.event_name in ('briefing_opened', 'assistant_query_sent', 'capture_created',
                                                            'meeting_prep_opened', 'follow_up_actioned', 'search_performed',
                                                            'approval_decided')
                                     group by 1) as x), '{}'::jsonb),
    'approvals', (select jsonb_build_object('created', count(*),
                                            'approved', count(*) filter (where a.approved_at is not null),
                                            'executed', count(*) filter (where a.status = 'executed'))
                  from public.approval_actions a where a.user_id = p_user and a.created_at >= v_from),
    'reminders_created', (select count(*) from public.reminders r where r.user_id = p_user and r.created_at >= v_from),
    'captures', (select jsonb_build_object('count', count(*), 'bytes', coalesce(sum(c.size_bytes), 0))
                 from public.captures c where c.user_id = p_user and c.created_at >= v_from),
    'content_volumes', jsonb_build_object(
      'email_threads', (select count(*) from public.email_threads t where t.user_id = p_user),
      'calendar_events', (select count(*) from public.calendar_events e where e.user_id = p_user),
      'insights', (select count(*) from public.insights i where i.user_id = p_user),
      'memory_chunks', (select count(*) from public.memory_chunks m where m.user_id = p_user)),
    'notifications_by_decision', coalesce((select jsonb_object_agg(n.decision, n.c)
                                           from (select nt.decision::text as decision, count(*) as c from public.notifications nt
                                                 where nt.user_id = p_user and nt.created_at >= v_from group by 1) as n), '{}'::jsonb));
end
$$;

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on function
  private.referral_rewards_enabled(),
  private.embedding_dr_search(),
  private.referral_reward_withheld(uuid),
  private.app_settings_embedding_dr_changed()
  from public;
grant execute on function
  private.referral_rewards_enabled(),
  private.embedding_dr_search(),
  private.referral_reward_withheld(uuid)
  to service_role;
