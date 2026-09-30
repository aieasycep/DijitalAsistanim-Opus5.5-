-- Migration 0013b · user-facing RPCs (PostgREST, `authenticated`)
-- Spec: docs/API_CONTRACTS.md §15 (RPC-01…RPC-23; names, parameters and shapes are authoritative per
-- R-20), docs/DATABASE_AND_RLS_PLAN.md §6.5, §6.9; IMPLEMENTATION_PLAN T-2.16.
--
-- Rules (§6.9): SECURITY INVOKER unless noted, so RLS and column grants of 0014 scope every row to
-- the caller; search_path = ''; EXECUTE granted to authenticated only. Invoker functions never
-- reference the private schema (it is not granted to authenticated): they read plan_limits
-- directly, check Pro through public.effective_entitlement(), and resolve the Turkish text-search
-- configuration private.tr_search by OID from pg_catalog. Security-definer RPCs start with an
-- ownership check against auth.uid() and write only the listed columns.
-- Errors: P0002 NOT_FOUND · P0001 ENTITLEMENT_REQUIRED:<feature> · 22023 VALIDATION_FAILED:<field> ·
-- 55000 ILLEGAL_TRANSITION (status triggers) · 42501 FORBIDDEN · 23505 → STATE_CONFLICT.

-- Each migration runs in one transaction; never wait long on a lock held by live traffic.
set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ RPC-15 effective_entitlement and plan limits (SD, §6.5) ═════════════════════════════════

create function public.effective_entitlement(p_user_id uuid default auth.uid())
  returns table (
    entitlement text, is_active boolean, source text, is_trial boolean, will_renew boolean,
    store_expires_at timestamptz, grant_ends_at timestamptz, active_until timestamptz
  )
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
begin
  if private.caller_is_client() and p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query select * from private.effective_entitlement_at(p_user_id, now());
end
$$;

-- {allowed, limit, used, plan, resets_at} for count keys, daily quota keys (reset at local
-- midnight) and feature keys ({allowed: value}).
create function public.check_plan_limit(p_key text, p_increment integer default 1, p_user_id uuid default auth.uid())
  returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  v_plan text;
  v_value jsonb;
  v_limit integer;
  v_used bigint;
  v_tz text;
  v_day date;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  if private.caller_is_client() and p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_plan := private.plan_of(p_user_id);
  select pl.value into v_value from public.plan_limits pl where pl.plan = v_plan and pl.key = p_key;
  if not found then
    raise exception 'VALIDATION_FAILED:key' using errcode = '22023';
  end if;
  if jsonb_typeof(v_value) = 'boolean' then
    return jsonb_build_object('key', p_key, 'allowed', (v_value #>> '{}')::boolean, 'plan', v_plan);
  end if;
  v_limit := private.jsonb_numeric(v_value)::integer;
  v_tz := private.user_timezone(p_user_id);
  v_day := (now() at time zone v_tz)::date;
  v_day_start := v_day::timestamp at time zone v_tz;
  v_day_end := (v_day + 1)::timestamp at time zone v_tz;

  v_used := case p_key
    when 'max_mail_accounts' then (select count(*) from public.connected_accounts ca
                                   where ca.user_id = p_user_id and ca.status <> 'disconnected'
                                     and 'mail_read' = any(ca.capabilities_granted))
    when 'max_calendar_accounts' then (select count(*) from public.connected_accounts ca
                                       where ca.user_id = p_user_id and ca.status <> 'disconnected'
                                         and 'calendar_read' = any(ca.capabilities_granted))
    when 'max_calendars' then (select count(*) from public.calendars c where c.user_id = p_user_id and c.selected)
    when 'vip_max' then (select count(*) from public.vip_people v where v.user_id = p_user_id)
    when 'priority_rules_max' then (select count(*) from public.priority_rules r
                                    where r.user_id = p_user_id and r.deleted_at is null)
    when 'ai_daily_budget_units' then (select coalesce(sum(u.units_used + u.reserved_units), 0) from public.ai_usage_daily u
                                       where u.user_id = p_user_id and u.local_date = v_day)
    when 'email_analysis_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                      where u.user_id = p_user_id and u.local_date = v_day
                                        and u.feature in ('email_triage', 'email_deep_extract'))
    when 'reply_drafts_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                    where u.user_id = p_user_id and u.local_date = v_day
                                      and u.feature in ('reply_draft', 'follow_up_draft'))
    when 'captures_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                where u.user_id = p_user_id and u.local_date = v_day and u.feature = 'capture_extract')
    when 'meeting_preps_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                     where u.user_id = p_user_id and u.local_date = v_day and u.feature = 'meeting_prep')
    when 'semantic_search_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                       where u.user_id = p_user_id and u.local_date = v_day
                                         and u.feature = 'embedding_query')
    when 'assistant_messages_daily' then (select count(*) from public.assistant_messages m
                                          where m.user_id = p_user_id and m.role = 'user'
                                            and m.created_at >= v_day_start and m.created_at < v_day_end)
    when 'transcribe_seconds_daily' then (select coalesce(ceil(sum(r.audio_seconds)), 0) from public.ai_requests r
                                          where r.user_id = p_user_id and r.feature = 'stt'
                                            and r.created_at >= v_day_start and r.created_at < v_day_end)
  end;
  if v_used is null then
    raise exception 'VALIDATION_FAILED:key' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'key', p_key,
    'allowed', v_limit is null or v_used + coalesce(p_increment, 1) <= v_limit,
    'limit', v_limit,
    'used', v_used,
    'plan', v_plan,
    'resets_at', case when p_key like '%\_daily' or p_key = 'ai_daily_budget_units' then v_day_end end);
end
$$;

-- ═══ RPC-01 set_insight_status (SI) ══════════════════════════════════════════════════════════

create function public.set_insight_status(
  p_insight_id uuid, p_status public.item_status, p_snoozed_until timestamptz default null, p_feedback text default null
) returns public.insights
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  v public.insights;
begin
  if p_status = 'expired' then
    raise exception 'VALIDATION_FAILED:status' using errcode = '22023';
  end if;
  if p_feedback is not null and p_feedback <> 'not_important' then
    raise exception 'VALIDATION_FAILED:feedback' using errcode = '22023';
  end if;
  select * into v from public.insights i where i.id = p_insight_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status <> p_status then
    if p_status = 'snoozed' and (p_snoozed_until is null or p_snoozed_until <= now()) then
      raise exception 'VALIDATION_FAILED:snoozed_until' using errcode = '22023';
    end if;
    update public.insights i
      set status = p_status,
          snoozed_until = case when p_status = 'snoozed' then p_snoozed_until else i.snoozed_until end
    where i.id = v.id
    returning * into v;
  end if;
  if p_feedback = 'not_important' then
    insert into public.ai_feedback (user_id, feature, target_type, target_id, rating, reason_code)
    values (v.user_id,
            (case v.kind when 'commitment' then 'commitment_extract' when 'life_event' then 'life_intel_extract'
                         when 'security' then 'life_intel_extract' when 'meeting' then 'meeting_prep'
                         when 'digest' then 'briefing_morning' else 'email_triage' end)::public.ai_feature,
            'insight', v.id, -1, 'not_important')
    on conflict (user_id, feature, target_type, target_id)
      do update set rating = -1, reason_code = 'not_important';
  end if;
  return v;
end
$$;

-- Vector leg of RPC-02 over the caller's own memory chunks. Security definer so that
-- memory_chunks.embedding stays outside the client column grant (§4.5); it returns ids only, ranked
-- by cosine distance: the HNSW top 200 and, when HNSW under-fills (pgvector 0.6 post-filter), an
-- exact scan over the caller's rows in a MATERIALIZED CTE. Pro only (empty for Free callers).
create function public.memory_vector_candidates(
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

-- ═══ RPC-02 search_user_content (SI; hybrid FTS + vector, RRF k = 60) ════════════════════════

-- Types: email · person · event · task · commitment · life_event · memory · capture. The FTS leg
-- uses private.tr_search (Turkish + unaccent) on every search_tsv (memory: tsv); contacts also
-- match by trigram similarity. The vector leg (Pro, query embedding given, 1024-d) takes the
-- HNSW top 200 and, when HNSW under-fills (pgvector 0.6 post-filter), an exact scan over the
-- caller's rows in a MATERIALIZED CTE. Always user-scoped and unexpired. Free: no memory, no
-- vector leg, only the last plan_limits.assistant_retrieval_days. p_cursor is
-- base64("<score>|<result_type>|<entity_id>") of the last row of the previous page.
create function public.search_user_content(
  p_query text,
  p_query_embedding extensions.vector(1024) default null,
  p_types text[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_contact_id uuid default null,
  p_cursor text default null,
  p_limit integer default 20
) returns table (
  result_type text, entity_id uuid, title text, snippet text, source_type public.source_type, source_id text,
  source_provider public.provider, source_timestamp timestamptz, score double precision
)
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_cfg regconfig := (select c.oid::regconfig from pg_catalog.pg_ts_config c
                      join pg_catalog.pg_namespace n on n.oid = c.cfgnamespace
                      where n.nspname = 'private' and c.cfgname = 'tr_search');
  v_pro boolean := coalesce((select e.is_active from public.effective_entitlement() as e), false);
  v_types text[] := coalesce(p_types, array['email', 'person', 'event', 'task', 'commitment', 'life_event', 'memory', 'capture']);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v_tsq tsquery;
  v_query text := btrim(coalesce(p_query, ''));
  v_days integer;
  v_vec uuid[] := '{}';
  v_cursor_score double precision;
  v_cursor_type text;
  v_cursor_id uuid;
  v_parts text[];
  v_emails text[];
begin
  if v_uid is null then
    return;
  end if;
  if char_length(v_query) < 2 and p_query_embedding is null then
    raise exception 'VALIDATION_FAILED:query' using errcode = '22023';
  end if;
  if p_query_embedding is not null and extensions.vector_dims(p_query_embedding) <> 1024 then
    raise exception 'VALIDATION_FAILED:query_embedding' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_types) as t (x)
             where x not in ('email', 'person', 'event', 'task', 'commitment', 'life_event', 'memory', 'capture')) then
    raise exception 'VALIDATION_FAILED:types' using errcode = '22023';
  end if;
  if p_cursor is not null then
    begin
      v_parts := string_to_array(convert_from(decode(p_cursor, 'base64'), 'UTF8'), '|');
      v_cursor_score := v_parts[1]::double precision;
      v_cursor_type := v_parts[2];
      v_cursor_id := v_parts[3]::uuid;
    exception when others then
      raise exception 'VALIDATION_FAILED:cursor' using errcode = '22023';
    end;
  end if;

  if not v_pro then
    v_types := array_remove(v_types, 'memory');
    select private_days.d into v_days
    from (select (pl.value #>> '{}')::integer as d from public.plan_limits pl
          where pl.plan = 'free' and pl.key = 'assistant_retrieval_days' and jsonb_typeof(pl.value) = 'number') as private_days;
    if v_days is not null then
      v_from := greatest(v_from, now() - make_interval(days => v_days));
    end if;
  end if;
  if v_query <> '' then
    v_tsq := websearch_to_tsquery(v_cfg, v_query);
  end if;
  if p_contact_id is not null then
    select array_agg(distinct lower(e)) into v_emails
    from public.contacts c, unnest(c.emails::text[] || array[c.primary_email::text]) as e
    where c.id = p_contact_id and e is not null;
    if v_emails is null then
      return;                                        -- not the caller's contact
    end if;
  end if;

  -- Vector leg (Pro only; ids only, the embeddings stay column-hidden from clients).
  if v_pro and p_query_embedding is not null and 'memory' = any(v_types) then
    v_vec := public.memory_vector_candidates(p_query_embedding, v_from, v_to, p_contact_id, v_limit);
  end if;

  return query
  with fts as (
    select 'email'::text as rt, t.id, t.subject as ttl, left(t.ai_summary, 200) as snip, 'email_thread'::public.source_type as st,
           t.id::text as sid, t.provider as sp, t.last_message_at as ts, ts_rank_cd(t.search_tsv, v_tsq) as rank
    from public.email_threads t
    where 'email' = any(v_types) and v_tsq is not null and t.user_id = v_uid and t.search_tsv @@ v_tsq
      and (t.expires_at is null or t.expires_at > now()) and t.last_message_at >= v_from and t.last_message_at < v_to
      and (p_contact_id is null or exists (select 1 from jsonb_array_elements(t.participants) as p (x)
                                           where p.x ->> 'contact_id' = p_contact_id::text
                                              or lower(p.x ->> 'email') = any(v_emails)))
    union all
    select 'person', c.id, c.display_name, c.organization, 'contact'::public.source_type, c.id::text, null::public.provider,
           coalesce(c.last_contact_at, c.created_at),
           greatest(case when v_tsq is not null and c.search_tsv @@ v_tsq then ts_rank_cd(c.search_tsv, v_tsq) else 0 end,
                    extensions.similarity(extensions.unaccent(lower(c.display_name)), extensions.unaccent(lower(v_query))))
    from public.contacts c
    where 'person' = any(v_types) and v_query <> '' and c.user_id = v_uid and c.merged_into_id is null
      and ((v_tsq is not null and c.search_tsv @@ v_tsq)
           or extensions.similarity(extensions.unaccent(lower(c.display_name)), extensions.unaccent(lower(v_query))) > 0.3)
      and (p_contact_id is null or c.id = p_contact_id)
    union all
    select 'event', e.id, e.title, left(coalesce(e.location, e.description_excerpt), 200),
           (case when e.provider in ('apple_device', 'android_device') then 'device_calendar_event' else 'calendar_event' end)::public.source_type,
           e.id::text, e.provider, e.start_at, ts_rank_cd(e.search_tsv, v_tsq)
    from public.calendar_events e
    where 'event' = any(v_types) and v_tsq is not null and e.user_id = v_uid and e.search_tsv @@ v_tsq
      and (e.expires_at is null or e.expires_at > now()) and e.start_at >= v_from and e.start_at < v_to
      and (p_contact_id is null or exists (select 1 from jsonb_array_elements(e.attendees) as a (x)
                                           where a.x ->> 'contact_id' = p_contact_id::text
                                              or lower(a.x ->> 'email') = any(v_emails)))
    union all
    select 'task', k.id, k.title, left(k.notes_excerpt, 200), coalesce(k.source_type, 'task'::public.source_type),
           coalesce(k.source_id, k.id::text), coalesce(k.source_provider, k.provider), coalesce(k.source_timestamp, k.created_at),
           ts_rank_cd(k.search_tsv, v_tsq)
    from public.tasks k
    where 'task' = any(v_types) and v_tsq is not null and k.user_id = v_uid and k.search_tsv @@ v_tsq
      and (k.expires_at is null or k.expires_at > now()) and k.created_at >= v_from and k.created_at < v_to
      and p_contact_id is null
    union all
    select 'commitment', m.id, m.text, m.counterparty_name, m.source_type, m.source_id, m.source_provider, m.source_timestamp,
           ts_rank_cd(m.search_tsv, v_tsq)
    from public.commitments m
    where 'commitment' = any(v_types) and v_tsq is not null and m.user_id = v_uid and m.search_tsv @@ v_tsq
      and (m.expires_at is null or m.expires_at > now()) and m.source_timestamp >= v_from and m.source_timestamp < v_to
      and (p_contact_id is null or m.contact_id = p_contact_id)
    union all
    select 'life_event', l.id, l.title, null::text, l.source_type, l.source_id, l.source_provider, l.source_timestamp,
           ts_rank_cd(l.search_tsv, v_tsq)
    from public.life_events l
    where 'life_event' = any(v_types) and v_tsq is not null and l.user_id = v_uid and l.search_tsv @@ v_tsq
      and not l.suppressed and (l.expires_at is null or l.expires_at > now())
      and l.source_timestamp >= v_from and l.source_timestamp < v_to and p_contact_id is null
    union all
    select 'memory', mc.id, left(mc.content, 120), left(mc.content, 200), mc.source_type, mc.source_id, mc.source_provider,
           mc.source_timestamp, ts_rank_cd(mc.tsv, v_tsq)
    from public.memory_chunks mc
    where 'memory' = any(v_types) and v_tsq is not null and mc.user_id = v_uid and mc.tsv @@ v_tsq
      and (mc.expires_at is null or mc.expires_at > now()) and mc.source_timestamp >= v_from and mc.source_timestamp < v_to
      and (p_contact_id is null or p_contact_id = any(mc.contact_ids))
    union all
    select 'capture', cp.id, cp.original_filename, left(cp.text_content, 200), 'capture'::public.source_type, cp.id::text,
           null::public.provider, cp.created_at, ts_rank_cd(cp.search_tsv, v_tsq)
    from public.captures cp
    where 'capture' = any(v_types) and v_tsq is not null and cp.user_id = v_uid and cp.search_tsv @@ v_tsq
      and cp.status <> 'discarded' and (cp.expires_at is null or cp.expires_at > now())
      and cp.created_at >= v_from and cp.created_at < v_to and p_contact_id is null
  ),
  fts_ranked as (
    select f.*, row_number() over (order by f.rank desc, f.ts desc, f.id) as r from fts f
  ),
  vec_ranked as (
    select mc.id, u.ord as r, left(mc.content, 120) as ttl, left(mc.content, 200) as snip, mc.source_type as st,
           mc.source_id as sid, mc.source_provider as sp, mc.source_timestamp as ts
    from unnest(v_vec) with ordinality as u (id, ord)
    join public.memory_chunks mc on mc.id = u.id
  ),
  fused as (
    select coalesce(f.rt, 'memory') as rt, coalesce(f.id, v.id) as id, coalesce(f.ttl, v.ttl) as ttl,
           coalesce(f.snip, v.snip) as snip, coalesce(f.st, v.st) as st, coalesce(f.sid, v.sid) as sid,
           coalesce(f.sp, v.sp) as sp, coalesce(f.ts, v.ts) as ts,
           coalesce(1.0 / (60 + f.r), 0) + coalesce(1.0 / (60 + v.r), 0) as score
    from fts_ranked f
    full join vec_ranked v on f.rt = 'memory' and f.id = v.id
  )
  select x.rt, x.id, x.ttl, x.snip, x.st, x.sid, x.sp, x.ts, x.score::double precision
  from fused x
  where v_cursor_score is null
     or x.score::double precision < v_cursor_score
     or (x.score::double precision = v_cursor_score and (x.rt, x.id) > (v_cursor_type, v_cursor_id))
  order by x.score desc, x.rt, x.id
  limit v_limit;
end
$$;

-- ═══ RPC-03 person_intelligence (SI) ══════════════════════════════════════════════════════════

create function public.person_intelligence(p_contact_id uuid) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  c public.contacts;
  v_pro boolean := coalesce((select e.is_active from public.effective_entitlement() as e), false);
  v_emails text[];
  v_vip public.vip_people;
  v_result jsonb;
begin
  select * into c from public.contacts x where x.id = p_contact_id;
  if not found then
    return null;
  end if;
  v_emails := array(select distinct lower(e) from unnest(c.emails::text[] || array[c.primary_email::text]) as e where e is not null);
  select * into v_vip from public.vip_people v where v.contact_id = c.id;

  v_result := jsonb_build_object(
    'contact', jsonb_build_object('id', c.id, 'display_name', c.display_name, 'primary_email', c.primary_email,
                                  'organization', c.organization, 'title', c.title, 'avatar_seed', c.avatar_seed),
    'is_vip', v_vip.id is not null,
    'relationship', v_vip.relationship,
    'last_contact_at', c.last_contact_at,
    'upcoming_meetings', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                                          'is_online', e.is_online) order by e.start_at)
      from (select e.* from public.calendar_events e
            where e.start_at >= now() and e.status <> 'cancelled'
              and exists (select 1 from jsonb_array_elements(e.attendees) as a (x)
                          where a.x ->> 'contact_id' = c.id::text or lower(a.x ->> 'email') = any(v_emails))
            order by e.start_at limit 5) as e), '[]'::jsonb),
    'related_emails', coalesce((
      select jsonb_agg(jsonb_build_object('thread_id', t.id, 'subject', t.subject, 'ai_summary', t.ai_summary,
                                          'last_message_at', t.last_message_at, 'reply_state', t.reply_state)
                       order by t.last_message_at desc)
      from (select t.id, t.subject, t.ai_summary, t.last_message_at, t.reply_state from public.email_threads t
            where exists (select 1 from jsonb_array_elements(t.participants) as p (x)
                          where p.x ->> 'contact_id' = c.id::text or lower(p.x ->> 'email') = any(v_emails))
              and (t.expires_at is null or t.expires_at > now())
            order by t.last_message_at desc limit 10) as t), '[]'::jsonb),
    'recent_topics', coalesce((
      select jsonb_agg(x.topic_label order by x.at desc)
      from (select t.topic_label, max(t.last_message_at) as at from public.email_threads t
            where t.topic_label is not null
              and exists (select 1 from jsonb_array_elements(t.participants) as p (x)
                          where p.x ->> 'contact_id' = c.id::text or lower(p.x ->> 'email') = any(v_emails))
            group by t.topic_label order by max(t.last_message_at) desc limit 5) as x), '[]'::jsonb));

  if v_pro then
    v_result := v_result || jsonb_build_object(
      'open_loops', coalesce((
        select jsonb_agg(jsonb_build_object('insight_id', i.id, 'kind', i.kind, 'title', i.title, 'due_at', i.due_at)
                         order by i.rank_score desc)
        from (select i.* from public.insights i
              where i.status = 'open'
                and ((i.entity_type = 'contact' and i.entity_id = c.id)
                     or (i.entity_type = 'commitment'
                         and exists (select 1 from public.commitments m where m.id = i.entity_id and m.contact_id = c.id)))
              order by i.rank_score desc limit 10) as i), '[]'::jsonb),
      'user_owes', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.id, 'text', m.text, 'due_at', m.due_at, 'status', m.status) order by m.due_at)
        from public.commitments m
        where m.contact_id = c.id and m.direction = 'user_owes' and m.status in ('open', 'snoozed')), '[]'::jsonb),
      'they_owe', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.id, 'text', m.text, 'due_at', m.due_at, 'status', m.status) order by m.due_at)
        from public.commitments m
        where m.contact_id = c.id and m.direction = 'they_owe' and m.status in ('open', 'snoozed')), '[]'::jsonb),
      'locked_sections', '[]'::jsonb);
  else
    v_result := v_result || jsonb_build_object('locked_sections', '["open_loops","user_owes","they_owe","commitments"]'::jsonb);
  end if;
  return v_result;
end
$$;

-- ═══ RPC-04 today_overview (SI) ═══════════════════════════════════════════════════════════════

create function public.today_overview(p_local_date date default null) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_tz text := coalesce((select up.timezone from public.user_preferences up where up.user_id = auth.uid()), 'Europe/Istanbul');
  v_date date := coalesce(p_local_date, (now() at time zone coalesce((select up.timezone from public.user_preferences up
                                                                       where up.user_id = auth.uid()), 'Europe/Istanbul'))::date);
  v_start timestamptz;
  v_end timestamptz;
  v_priorities jsonb;
begin
  v_start := v_date::timestamp at time zone v_tz;
  v_end := (v_date + 1)::timestamp at time zone v_tz;
  select coalesce(jsonb_agg(x.item order by x.u, x.rank desc, x.created_at desc), '[]'::jsonb) into v_priorities
  from (select jsonb_build_object(
                 'id', i.id, 'kind', i.kind, 'urgency', i.urgency, 'flow_card_type', i.flow_card_type,
                 'title', coalesce(i.user_overrides -> 'title' ->> 'value', i.title), 'body', i.body,
                 'why_important', i.why_important, 'decision_tier', i.decision_tier, 'reason_code', i.reason_code,
                 'entity_type', i.entity_type, 'entity_id', i.entity_id, 'actions', i.actions,
                 'due_at', coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at),
                 'event_at', i.event_at, 'user_corrected', i.user_overrides <> '{}'::jsonb,
                 'source', jsonb_build_object('source_type', i.source_type, 'source_id', i.source_id,
                                              'provider', i.source_provider, 'source_timestamp', i.source_timestamp)) as item,
               array_position(array['urgent', 'today', 'normal', 'low']::public.urgency[], i.urgency) as u,
               i.rank_score as rank, i.created_at
        from public.insights i
        where i.status = 'open' and (i.expires_at is null or i.expires_at > now())
          and (i.urgency in ('urgent', 'today')
               or coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at) < v_end
               or (i.event_at >= v_start and i.event_at < v_end))
        order by 2, 3 desc limit 20) as x;

  return jsonb_build_object(
    'local_date', v_date,
    'time_zone', v_tz,
    'hero_count', jsonb_array_length(v_priorities),
    'priorities', v_priorities,
    'next_meeting', (
      select jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                                'location', e.location, 'is_online', e.is_online, 'conference_url', e.conference_url,
                                'attendee_count', e.attendee_count,
                                'prep_status', (select p.status from public.meeting_preps p where p.calendar_event_id = e.id))
      from public.calendar_events e
      join public.calendars cal on cal.id = e.calendar_id and cal.selected
      where e.end_at > now() and e.start_at < v_end and e.status <> 'cancelled' and not e.all_day
      order by e.start_at limit 1),
    'deadlines', coalesce((
      select jsonb_agg(jsonb_build_object('insight_id', i.id, 'title', coalesce(i.user_overrides -> 'title' ->> 'value', i.title),
                                          'due_at', coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at))
                       order by coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at))
      from public.insights i
      where i.kind = 'deadline' and i.status in ('open', 'snoozed')
        and coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at) < v_end + interval '1 day'), '[]'::jsonb),
    'follow_ups', coalesce((
      select jsonb_agg(jsonb_build_object('insight_id', i.id, 'title', i.title, 'entity_id', i.entity_id, 'due_at', i.due_at)
                       order by i.rank_score desc)
      from (select i.* from public.insights i where i.kind = 'follow_up' and i.status = 'open'
            order by i.rank_score desc limit 10) as i), '[]'::jsonb),
    'life_intel', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'type', l.type, 'title', coalesce(l.user_overrides -> 'title' ->> 'value', l.title),
                                          'event_at', coalesce((l.user_overrides -> 'event_at' ->> 'value')::timestamptz, l.event_at),
                                          'due_at', coalesce((l.user_overrides -> 'due_at' ->> 'value')::timestamptz, l.due_at),
                                          'amount', coalesce((l.user_overrides -> 'amount' ->> 'value')::numeric, l.amount),
                                          'currency', coalesce(l.user_overrides -> 'currency' ->> 'value', l.currency::text))
                       order by coalesce(l.event_at, l.due_at))
      from (select l.* from public.life_events l
            where l.status = 'open' and not l.suppressed
              and coalesce(l.event_at, l.due_at, l.created_at) < v_end + interval '7 days'
              and coalesce(l.event_at, l.due_at, l.created_at) >= v_start - interval '1 day'
            order by coalesce(l.event_at, l.due_at) limit 10) as l), '[]'::jsonb),
    'pending_approvals_count', (select count(*) from public.approval_actions a where a.status = 'pending'),
    'briefing', (
      select jsonb_build_object('id', b.id, 'kind', b.kind, 'status', b.status, 'audio_status', b.audio_status,
                                'audio_available', b.audio_status = 'ready', 'headline', b.headline, 'opened_at', b.opened_at)
      from public.briefings b where b.local_date = v_date
      order by array_position(array['morning', 'midday', 'evening', 'weekly']::public.briefing_kind[], b.kind) desc,
               b.scheduled_for desc
      limit 1));
end
$$;

-- ═══ RPC-05 flow_feed and RPC-20 flow_meta (SI) ═══════════════════════════════════════════════

create function public.flow_feed(p_filter text default 'all', p_cursor text default null, p_limit integer default 30)
  returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_filter text := coalesce(p_filter, 'all');
  v_c_u integer;
  v_c_rank numeric;
  v_c_created timestamptz;
  v_c_id uuid;
  v_parts text[];
  v_items jsonb;
  v_next text;
begin
  if v_filter not in ('all', 'important', 'mail', 'calendar', 'followup', 'personal') then
    raise exception 'VALIDATION_FAILED:filter' using errcode = '22023';
  end if;
  if p_cursor is not null then
    begin
      v_parts := string_to_array(convert_from(decode(p_cursor, 'base64'), 'UTF8'), '|');
      v_c_u := v_parts[1]::integer;
      v_c_rank := v_parts[2]::numeric;
      v_c_created := v_parts[3]::timestamptz;
      v_c_id := v_parts[4]::uuid;
    exception when others then
      raise exception 'VALIDATION_FAILED:cursor' using errcode = '22023';
    end;
  end if;

  with base as (
    select i.*, array_position(array['urgent', 'today', 'normal', 'low']::public.urgency[], i.urgency) as u,
           coalesce(i.flow_card_type, case i.kind
             when 'reply_needed' then 'email' when 'deadline' then 'deadline' when 'meeting' then 'meeting'
             when 'follow_up' then 'follow_up' when 'commitment' then 'commitment' when 'security' then 'security'
             when 'conflict' then 'meeting' when 'schedule_suggestion' then 'meeting' end::public.flow_card_type) as card
    from public.insights i
    where i.status = 'open' and (i.expires_at is null or i.expires_at > now())
  ),
  filtered as (
    select b.* from base b
    where b.card is not null
      and (v_filter = 'all'
           or (v_filter = 'important' and b.urgency in ('urgent', 'today'))
           or (v_filter = 'mail' and b.card in ('email', 'follow_up'))
           or (v_filter = 'calendar' and b.card in ('meeting', 'deadline'))
           or (v_filter = 'followup' and b.card in ('follow_up', 'commitment'))
           or (v_filter = 'personal' and b.card in ('shipment', 'flight', 'reservation', 'payment', 'subscription', 'security')))
      and (v_c_id is null or (b.u, -b.rank_score, b.created_at, b.id) > (v_c_u, -v_c_rank, v_c_created, v_c_id))
    order by b.u, b.rank_score desc, b.created_at, b.id
    limit v_limit + 1
  ),
  numbered as (select f.*, row_number() over (order by f.u, f.rank_score desc, f.created_at, f.id) as n from filtered f)
  select coalesce(jsonb_agg(jsonb_build_object(
             'id', n.id, 'card_type', n.card, 'kind', n.kind, 'urgency', n.urgency,
             'title', coalesce(n.user_overrides -> 'title' ->> 'value', n.title), 'body', n.body,
             'why_important', n.why_important, 'decision_tier', n.decision_tier, 'reason_code', n.reason_code,
             'entity_type', n.entity_type, 'entity_id', n.entity_id, 'actions', n.actions,
             'due_at', coalesce((n.user_overrides -> 'due_at' ->> 'value')::timestamptz, n.due_at), 'event_at', n.event_at,
             'created_at', n.created_at, 'user_corrected', n.user_overrides <> '{}'::jsonb,
             'source', jsonb_build_object('source_type', n.source_type, 'source_id', n.source_id,
                                          'provider', n.source_provider, 'source_timestamp', n.source_timestamp))
           order by n.n) filter (where n.n <= v_limit), '[]'::jsonb),
         (select encode(convert_to(format('%s|%s|%s|%s', m.u, m.rank_score, m.created_at, m.id), 'UTF8'), 'base64')
          from numbered m where m.n = v_limit and exists (select 1 from numbered z where z.n = v_limit + 1))
    into v_items, v_next
  from numbered n;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next, 'meta', public.flow_meta(v_filter));
end
$$;

create function public.flow_meta(p_filter text default 'all') returns jsonb
  language sql stable
  security invoker
  set search_path = ''
  as $$
    select jsonb_build_object(
      'filter', coalesce(p_filter, 'all'),
      'total', (select count(*) from public.insights i
                where i.status = 'open' and (i.expires_at is null or i.expires_at > now())),
      'important', (select count(*) from public.insights i
                    where i.status = 'open' and i.urgency in ('urgent', 'today')
                      and (i.expires_at is null or i.expires_at > now())),
      'last_analysis_at', greatest((select max(t.analyzed_at) from public.email_threads t),
                                   (select max(m.analyzed_at) from public.email_messages m)),
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'provider', a.provider, 'status', a.status,
                                                                'last_success_at', a.last_successful_sync_at)
                                             order by a.created_at)
                            from public.connected_accounts a where a.status <> 'disconnected'), '[]'::jsonb))
  $$;

-- ═══ RPC-06 set_commitment_status (SI, Pro) ═══════════════════════════════════════════════════

create function public.set_commitment_status(
  p_commitment_id uuid, p_status public.commitment_status, p_due_at timestamptz default null
) returns public.commitments
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  v public.commitments;
begin
  if not coalesce((select e.is_active from public.effective_entitlement() as e), false) then
    raise exception 'ENTITLEMENT_REQUIRED:commitments' using errcode = 'P0001';
  end if;
  select * into v from public.commitments c where c.id = p_commitment_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status = p_status and (p_due_at is null or p_due_at is not distinct from v.due_at) then
    return v;
  end if;
  if p_status = 'snoozed' and (p_due_at is null or p_due_at <= now()) then
    raise exception 'VALIDATION_FAILED:due_at' using errcode = '22023';
  end if;
  update public.commitments c
    set status = p_status,
        snoozed_until = case when p_status = 'snoozed' then p_due_at else c.snoozed_until end,
        due_at = coalesce(p_due_at, c.due_at),
        due_is_date_only = case when p_due_at is not null then false else c.due_is_date_only end
  where c.id = v.id
  returning * into v;
  return v;
end
$$;

-- ═══ RPC-07 mark_briefing_opened (SD, owner check) ════════════════════════════════════════════

create function public.mark_briefing_opened(p_briefing_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  update public.briefings b
    set opened_at = coalesce(b.opened_at, now()),
        delivered_at = case when b.status = 'ready' then coalesce(b.delivered_at, now()) else b.delivered_at end,
        status = case when b.status = 'ready' then 'delivered'::public.briefing_status else b.status end
  where b.id = p_briefing_id and b.user_id = auth.uid();
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end
$$;

-- ═══ RPC-08 mail_intelligence (SI) ════════════════════════════════════════════════════════════

-- Inbound mail of the caller's local day: the total, attention count, category counts (sum = total;
-- unclassified mail is counted under `unclassified`) and thread rows with the decision explanation.
create function public.mail_intelligence(
  p_local_date date default null, p_category public.mail_category default null, p_account_id uuid default null,
  p_cursor text default null, p_limit integer default 20
) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_tz text := coalesce((select up.timezone from public.user_preferences up where up.user_id = auth.uid()), 'Europe/Istanbul');
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_c_at timestamptz;
  v_c_id uuid;
  v_parts text[];
  v_counts jsonb;
  v_total bigint;
  v_attention bigint;
  v_rows jsonb;
  v_next text;
begin
  v_date := coalesce(p_local_date, (now() at time zone v_tz)::date);
  v_start := v_date::timestamp at time zone v_tz;
  v_end := (v_date + 1)::timestamp at time zone v_tz;
  if p_cursor is not null then
    begin
      v_parts := string_to_array(convert_from(decode(p_cursor, 'base64'), 'UTF8'), '|');
      v_c_at := v_parts[1]::timestamptz;
      v_c_id := v_parts[2]::uuid;
    exception when others then
      raise exception 'VALIDATION_FAILED:cursor' using errcode = '22023';
    end;
  end if;

  select count(*), count(*) filter (where m.classification in ('important', 'awaiting_my_reply', 'has_deadline'))
    into v_total, v_attention
  from public.email_messages m
  where m.direction = 'inbound' and m.received_at >= v_start and m.received_at < v_end
    and (p_account_id is null or m.connected_account_id = p_account_id);
  select coalesce(jsonb_object_agg(x.cat, x.n), '{}'::jsonb) into v_counts
  from (select coalesce(m2.classification::text, 'unclassified') as cat, count(*) as n
        from public.email_messages m2
        where m2.direction = 'inbound' and m2.received_at >= v_start and m2.received_at < v_end
          and (p_account_id is null or m2.connected_account_id = p_account_id)
        group by 1) as x;

  with rows as (
    select t.*, row_number() over (order by t.last_message_at desc, t.id) as n
    from (select t.id, t.connected_account_id, t.provider, t.subject, t.participants, t.message_count, t.last_message_at,
                 t.has_unread, t.category, t.urgency, t.reply_state, t.ai_summary, t.deadline_at, t.category_tier,
                 t.category_reason, t.category_confidence, t.category_rule_id, t.category_learned_preference_id
          from public.email_threads t
          where t.last_message_at >= v_start and t.last_message_at < v_end
            and (p_category is null or t.category = p_category)
            and (p_account_id is null or t.connected_account_id = p_account_id)
            and (t.expires_at is null or t.expires_at > now())
            and (v_c_id is null or (t.last_message_at, t.id) < (v_c_at, v_c_id))
          order by t.last_message_at desc, t.id limit v_limit + 1) as t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'thread_id', r.id, 'connected_account_id', r.connected_account_id, 'provider', r.provider,
             'subject', r.subject, 'participants', r.participants, 'message_count', r.message_count,
             'last_message_at', r.last_message_at, 'has_unread', r.has_unread, 'category', r.category,
             'urgency', r.urgency, 'reply_state', r.reply_state, 'ai_summary', r.ai_summary, 'deadline_at', r.deadline_at,
             'explain', jsonb_build_object('decision_tier', r.category_tier, 'reason', r.category_reason,
                                           'confidence', r.category_confidence,
                                           'rule', case when r.category_rule_id is null then null else
                                             (select jsonb_build_object('id', pr.id, 'condition_type', pr.condition_type,
                                                                        'condition_value', pr.condition_value, 'outcome', pr.outcome)
                                              from public.priority_rules pr where pr.id = r.category_rule_id) end,
                                           'learned_preference', case when r.category_learned_preference_id is null then null else
                                             (select jsonb_build_object('id', lp.id, 'statement', lp.statement)
                                              from public.learned_preferences lp where lp.id = r.category_learned_preference_id) end))
           order by r.n) filter (where r.n <= v_limit), '[]'::jsonb),
         (select encode(convert_to(format('%s|%s', z.last_message_at, z.id), 'UTF8'), 'base64')
          from rows z where z.n = v_limit and exists (select 1 from rows y where y.n = v_limit + 1))
    into v_rows, v_next
  from rows r;

  return jsonb_build_object('local_date', v_date, 'time_zone', v_tz, 'total', v_total, 'attention', v_attention,
                            'counts', v_counts, 'rows', v_rows, 'next_cursor', v_next);
end
$$;

-- ═══ RPC-09 plan_range and RPC-18 plan_week_density (SI) ══════════════════════════════════════

create function public.plan_range(p_from timestamptz, p_to timestamptz) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '35 days' then
    raise exception 'VALIDATION_FAILED:range' using errcode = '22023';
  end if;
  return jsonb_build_object('from', p_from, 'to', p_to, 'items', coalesce((
    select jsonb_agg(x.item order by x.start_at, x.item ->> 'item_type', x.item ->> 'id')
    from (
      select e.start_at, jsonb_build_object(
               'item_type', 'event', 'id', e.id, 'start_at', e.start_at, 'end_at', e.end_at, 'all_day', e.all_day,
               'title', e.title, 'calendar_id', e.calendar_id, 'status', e.status, 'is_online', e.is_online,
               'attendee_count', e.attendee_count, 'created_by_assistant', e.da_approval_id is not null,
               'source', jsonb_build_object('source_type',
                                            case when e.provider in ('apple_device', 'android_device') then 'device_calendar_event'
                                                 else 'calendar_event' end,
                                            'source_id', e.id, 'provider', e.provider,
                                            'source_timestamp', coalesce(e.provider_updated_at, e.updated_at))) as item
      from public.calendar_events e
      join public.calendars c on c.id = e.calendar_id and c.selected
      where e.start_at < p_to and e.end_at > p_from and e.status <> 'cancelled'
      union all
      select t.due_at, jsonb_build_object(
               'item_type', 'task', 'id', t.id, 'start_at', t.due_at, 'end_at', t.due_at, 'all_day', false,
               'title', t.title, 'status', t.status,
               'source', jsonb_build_object('source_type', coalesce(t.source_type, 'task'), 'source_id', coalesce(t.source_id, t.id::text),
                                            'provider', coalesce(t.source_provider, t.provider),
                                            'source_timestamp', coalesce(t.source_timestamp, t.created_at)))
      from public.tasks t
      where t.due_at >= p_from and t.due_at < p_to and t.status = 'open'
      union all
      select m.due_at, jsonb_build_object(
               'item_type', 'commitment', 'id', m.id, 'start_at', m.due_at, 'end_at', m.due_at, 'all_day', m.due_is_date_only,
               'title', coalesce(m.user_overrides -> 'text' ->> 'value', m.text), 'status', m.status, 'direction', m.direction,
               'source', jsonb_build_object('source_type', m.source_type, 'source_id', m.source_id,
                                            'provider', m.source_provider, 'source_timestamp', m.source_timestamp))
      from public.commitments m
      where m.due_at >= p_from and m.due_at < p_to and m.status in ('open', 'snoozed')
      union all
      select coalesce(l.event_at, l.due_at), jsonb_build_object(
               'item_type', case when l.event_at is null then 'deadline' else 'life_event' end, 'id', l.id,
               'start_at', coalesce(l.event_at, l.due_at), 'end_at', coalesce(l.event_at, l.due_at), 'all_day', false,
               'title', coalesce(l.user_overrides -> 'title' ->> 'value', l.title), 'life_event_type', l.type,
               'source', jsonb_build_object('source_type', l.source_type, 'source_id', l.source_id,
                                            'provider', l.source_provider, 'source_timestamp', l.source_timestamp))
      from public.life_events l
      where coalesce(l.event_at, l.due_at) >= p_from and coalesce(l.event_at, l.due_at) < p_to
        and l.status in ('open', 'snoozed') and not l.suppressed
      union all
      select coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at), jsonb_build_object(
               'item_type', 'deadline', 'id', i.id,
               'start_at', coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at),
               'end_at', coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at), 'all_day', false,
               'title', coalesce(i.user_overrides -> 'title' ->> 'value', i.title), 'insight_id', i.id,
               'source', jsonb_build_object('source_type', i.source_type, 'source_id', i.source_id,
                                            'provider', i.source_provider, 'source_timestamp', i.source_timestamp))
      from public.insights i
      where i.kind = 'deadline' and i.status in ('open', 'snoozed') and i.entity_type <> 'life_event'
        and coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at) >= p_from
        and coalesce((i.user_overrides -> 'due_at' ->> 'value')::timestamptz, i.due_at) < p_to
      union all
      select (p.t ->> 'start')::timestamptz, jsonb_build_object(
               'item_type', 'proposal', 'id', a.id, 'start_at', (p.t ->> 'start')::timestamptz,
               'end_at', (p.t ->> 'end')::timestamptz, 'all_day', false, 'title', a.what, 'approval_status', a.status,
               'action_type', a.action_type,
               'source', jsonb_build_object('source_type', a.source_type, 'source_id', a.source_id,
                                            'provider', a.source_provider, 'source_timestamp', a.source_timestamp))
      from public.approval_actions a
      cross join lateral (select case a.action_type when 'calendar_create' then a.payload -> 'time'
                                                    else a.payload -> 'changes' -> 'time' end as t) as p
      where a.action_type in ('calendar_create', 'calendar_update') and a.status in ('pending', 'approved', 'executing')
        and p.t ->> 'kind' = 'timed'
        and (p.t ->> 'start')::timestamptz < p_to and (p.t ->> 'end')::timestamptz > p_from
    ) as x), '[]'::jsonb));
end
$$;

-- Seven local days from p_week_start: meeting_minutes = non-all-day events with another attendee
-- or a conference link; focus_minutes = Dijital Asistan–created blocks plus timed tasks (30 min each);
-- is_hot = meeting_minutes ≥ 300.
create function public.plan_week_density(p_week_start date) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_tz text := coalesce((select up.timezone from public.user_preferences up where up.user_id = auth.uid()), 'Europe/Istanbul');
  v_today date;
begin
  if p_week_start is null then
    raise exception 'VALIDATION_FAILED:week_start' using errcode = '22023';
  end if;
  v_today := (now() at time zone v_tz)::date;
  return (
    select jsonb_agg(jsonb_build_object(
             'local_date', d.day, 'meeting_minutes', d.meeting_minutes, 'focus_minutes', d.focus_minutes,
             'event_count', d.event_count, 'is_hot', d.meeting_minutes >= 300, 'is_today', d.day = v_today)
           order by d.day)
    from (
      select g.day,
             coalesce((select sum(extract(epoch from (least(e.end_at, g.day_end) - greatest(e.start_at, g.day_start))) / 60)::integer
                       from public.calendar_events e join public.calendars c on c.id = e.calendar_id and c.selected
                       where not e.all_day and e.status <> 'cancelled' and e.start_at < g.day_end and e.end_at > g.day_start
                         and e.da_approval_id is null and (e.attendee_count >= 2 or e.conference_url is not null)), 0) as meeting_minutes,
             coalesce((select sum(extract(epoch from (least(e.end_at, g.day_end) - greatest(e.start_at, g.day_start))) / 60)::integer
                       from public.calendar_events e join public.calendars c on c.id = e.calendar_id and c.selected
                       where not e.all_day and e.status <> 'cancelled' and e.start_at < g.day_end and e.end_at > g.day_start
                         and e.da_approval_id is not null), 0)
             + 30 * (select count(*) from public.tasks t
                     where t.status = 'open' and t.due_at >= g.day_start and t.due_at < g.day_end)::integer as focus_minutes,
             (select count(*) from public.calendar_events e join public.calendars c on c.id = e.calendar_id and c.selected
              where e.status <> 'cancelled' and e.start_at < g.day_end and e.end_at > g.day_start)::integer as event_count
      from (select (p_week_start + i) as day,
                   (p_week_start + i)::timestamp at time zone v_tz as day_start,
                   (p_week_start + i + 1)::timestamp at time zone v_tz as day_end
            from generate_series(0, 6) as s (i)) as g
    ) as d);
end
$$;

-- ═══ RPC-10 list_approvals (SI) ═══════════════════════════════════════════════════════════════

create function public.list_approvals(
  p_status public.approval_status[] default '{pending}', p_cursor text default null, p_limit integer default 30
) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_c_at timestamptz;
  v_c_id uuid;
  v_parts text[];
  v_items jsonb;
  v_next text;
begin
  if p_cursor is not null then
    begin
      v_parts := string_to_array(convert_from(decode(p_cursor, 'base64'), 'UTF8'), '|');
      v_c_at := v_parts[1]::timestamptz;
      v_c_id := v_parts[2]::uuid;
    exception when others then
      raise exception 'VALIDATION_FAILED:cursor' using errcode = '22023';
    end;
  end if;
  with rows as (
    select a.*, row_number() over (order by a.created_at desc, a.id) as n
    from (select a.id, a.action_type, a.status, a.what, a.why, a.change_summary, a.exact_change, a.side_effects,
                 a.destination_label, a.executor, a.origin, a.payload_version, a.idempotency_key, a.requires_scope, a.batch_id,
                 a.approved_via, a.created_at, a.approval_expires_at, a.approved_at, a.rejected_at, a.executing_at,
                 a.executed_at, a.failed_at, a.last_error_code, a.attempt_count, a.source_type, a.source_id,
                 a.source_provider, a.source_timestamp, a.evidence
          from public.approval_actions a
          where a.status = any(coalesce(p_status, '{pending}'))
            and (v_c_id is null or (a.created_at, a.id) < (v_c_at, v_c_id))
          order by a.created_at desc, a.id limit v_limit + 1) as a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'action_type', r.action_type, 'status', r.status, 'what', r.what, 'why', r.why,
             'change_summary', r.change_summary, 'exact_change', r.exact_change, 'side_effects', r.side_effects,
             'destination_label', r.destination_label, 'executor', r.executor, 'origin', r.origin,
             'payload_version', r.payload_version, 'idempotency_key', r.idempotency_key,
             'requires_scope', r.requires_scope, 'batch_id', r.batch_id, 'approved_via', r.approved_via,
             'created_at', r.created_at, 'approval_expires_at', r.approval_expires_at, 'approved_at', r.approved_at,
             'rejected_at', r.rejected_at, 'executing_at', r.executing_at, 'executed_at', r.executed_at,
             'failed_at', r.failed_at, 'last_error_code', r.last_error_code, 'attempt_count', r.attempt_count,
             'poll_after_ms', case when r.status in ('approved', 'executing') then 1500 end,
             'source', jsonb_build_object('source_type', r.source_type, 'source_id', r.source_id,
                                          'provider', r.source_provider, 'source_timestamp', r.source_timestamp,
                                          'evidence', r.evidence))
           order by r.n) filter (where r.n <= v_limit), '[]'::jsonb),
         (select encode(convert_to(format('%s|%s', z.created_at, z.id), 'UTF8'), 'base64')
          from rows z where z.n = v_limit and exists (select 1 from rows y where y.n = v_limit + 1))
    into v_items, v_next
  from rows r;
  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end
$$;

-- ═══ RPC-11 preview_priority_rule (SI) ════════════════════════════════════════════════════════

create function public.preview_priority_rule(
  p_condition_type public.rule_condition, p_condition_value jsonb, p_outcome public.rule_outcome
) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_emails text[];
begin
  if p_condition_type = 'person' then
    select array_agg(distinct lower(e)) into v_emails
    from public.contacts c, unnest(c.emails::text[] || array[c.primary_email::text]) as e
    where c.id::text = p_condition_value ->> 'contact_id' and e is not null;
  end if;
  return (
    with m as (
      select em.from_name, em.from_email, em.subject, em.received_at, em.classification from public.email_messages em
      where em.direction = 'inbound' and em.received_at >= now() - interval '30 days'
        and case p_condition_type
          when 'person' then lower(em.from_email::text) = any(coalesce(v_emails, '{}'))
          when 'domain' then lower(split_part(em.from_email::text, '@', 2)) = lower(p_condition_value ->> 'domain')
                          or lower(split_part(em.from_email::text, '@', 2)) like '%.' || lower(p_condition_value ->> 'domain')
          when 'sender' then lower(em.from_email::text) = lower(p_condition_value ->> 'address')
          when 'keyword' then exists (
            select 1 from jsonb_array_elements_text(case when jsonb_typeof(p_condition_value -> 'keywords') = 'array'
                                                         then p_condition_value -> 'keywords' else '[]'::jsonb end) as k (w)
            where extensions.unaccent(lower(coalesce(em.subject, '') || ' ' || coalesce(em.snippet, '')))
                  like '%' || extensions.unaccent(lower(k.w)) || '%')
          when 'category' then case when p_condition_value ->> 'category' = 'promotions'
                                    then 'CATEGORY_PROMOTIONS' = any(em.labels) or em.classification = 'low_priority'
                                    else em.classification::text = p_condition_value ->> 'category' end
          else false
        end
    )
    select jsonb_build_object(
      'match_count', (select count(*) from m),
      'sample', coalesce((select jsonb_agg(jsonb_build_object('sender_label', coalesce(s.from_name, s.from_email::text),
                                                              'subject', s.subject, 'date', s.received_at)
                                           order by s.received_at desc)
                          from (select * from m order by m.received_at desc limit 3) as s), '[]'::jsonb),
      'already_important', (select count(*) from m where m.classification = 'important'),
      'will_move_up', case when p_outcome in ('always_important', 'high', 'always_notify')
                           then (select count(*) from m where m.classification is distinct from 'important') else 0 end));
end
$$;

-- ═══ RPC-12 get_usage_summary (SI) ════════════════════════════════════════════════════════════

-- Free sees AI units ("AI analiz limiti 50/gün"); Pro sees only the fair-use state, never numbers.
create function public.get_usage_summary() returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_tz text := coalesce((select up.timezone from public.user_preferences up where up.user_id = auth.uid()), 'Europe/Istanbul');
  v_pro boolean := coalesce((select e.is_active from public.effective_entitlement() as e), false);
  v_plan text;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_limits jsonb := '{}'::jsonb;
  v_key text;
  v_limit integer;
  v_used bigint;
  v_day_cost bigint;
  v_month_cost bigint;
  v_state text := 'ok';
begin
  v_plan := case when v_pro then 'pro' else 'free' end;
  v_day := (now() at time zone v_tz)::date;
  v_start := v_day::timestamp at time zone v_tz;
  v_end := (v_day + 1)::timestamp at time zone v_tz;
  foreach v_key in array array['ai_daily_budget_units', 'email_analysis_daily', 'reply_drafts_daily', 'assistant_messages_daily',
                               'captures_daily', 'meeting_preps_daily', 'semantic_search_daily'] loop
    select case when jsonb_typeof(pl.value) = 'number' then (pl.value #>> '{}')::integer end into v_limit
    from public.plan_limits pl where pl.plan = v_plan and pl.key = v_key;
    v_used := case v_key
      when 'ai_daily_budget_units' then (select coalesce(sum(u.units_used + u.reserved_units), 0) from public.ai_usage_daily u
                                         where u.user_id = v_uid and u.local_date = v_day)
      when 'email_analysis_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                        where u.user_id = v_uid and u.local_date = v_day
                                          and u.feature in ('email_triage', 'email_deep_extract'))
      when 'reply_drafts_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                      where u.user_id = v_uid and u.local_date = v_day
                                        and u.feature in ('reply_draft', 'follow_up_draft'))
      when 'captures_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                  where u.user_id = v_uid and u.local_date = v_day and u.feature = 'capture_extract')
      when 'meeting_preps_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                       where u.user_id = v_uid and u.local_date = v_day and u.feature = 'meeting_prep')
      when 'semantic_search_daily' then (select coalesce(sum(u.requests), 0) from public.ai_usage_daily u
                                         where u.user_id = v_uid and u.local_date = v_day and u.feature = 'embedding_query')
      when 'assistant_messages_daily' then (select count(*) from public.assistant_messages m
                                            where m.role = 'user' and m.created_at >= v_start and m.created_at < v_end)
    end;
    if v_pro and v_key = 'ai_daily_budget_units' then
      continue;                                      -- Pro: "Adil kullanım", never unit numbers
    end if;
    v_limits := v_limits || jsonb_build_object(v_key, jsonb_build_object(
      'limit', v_limit, 'used', v_used,
      'remaining', case when v_limit is null then null else greatest(v_limit - v_used, 0) end, 'resets_at', v_end));
  end loop;

  if v_pro then
    select coalesce(sum(u.cost_usd_micros + u.reserved_usd_micros) filter (where u.local_date = v_day), 0),
           coalesce(sum(u.cost_usd_micros + u.reserved_usd_micros), 0)
      into v_day_cost, v_month_cost
    from public.ai_usage_daily u
    where u.user_id = v_uid and u.local_date >= date_trunc('month', v_day)::date and u.local_date <= v_day;
    if v_day_cost >= (select ((pl.value #>> '{}')::numeric * 1000000)::bigint from public.plan_limits pl
                      where pl.plan = 'pro' and pl.key = 'ai_hard_cap_usd_day')
       or v_month_cost >= (select ((pl.value #>> '{}')::numeric * 1000000)::bigint from public.plan_limits pl
                           where pl.plan = 'pro' and pl.key = 'ai_hard_cap_usd_month') then
      v_state := 'fair_use_reached';
    else
      v_state := 'fair_use';
    end if;
  elsif (v_limits -> 'ai_daily_budget_units' ->> 'remaining')::integer = 0 then
    v_state := 'units_exhausted';
  end if;
  return jsonb_build_object('plan', v_plan, 'local_date', v_day, 'resets_at', v_end, 'limits', v_limits,
                            'ai_budget', jsonb_build_object('state', v_state));
end
$$;

-- ═══ RPC-13 vip_suggestions (SI, Pro) ═════════════════════════════════════════════════════════

-- Contacts with ≥ 10 exchanges in the last 30 days and no VIP row ("son 30 günde 14 kez yazıştın").
create function public.vip_suggestions() returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
begin
  if not coalesce((select e.is_active from public.effective_entitlement() as e), false) then
    raise exception 'ENTITLEMENT_REQUIRED:vip' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('contact_id', s.id, 'display_name', s.display_name, 'primary_email', s.primary_email,
                                        'organization', s.organization, 'exchanges_30d', s.n)
                     order by s.n desc, s.display_name)
    from (
      select c.id, c.display_name, c.primary_email, c.organization,
             (select count(*) from public.email_messages m
              where m.received_at >= now() - interval '30 days'
                and (lower(m.from_email::text) = any(x.emails) or exists (
                       select 1 from unnest(m.to_emails::text[] || m.cc_emails::text[]) as r (e) where lower(r.e) = any(x.emails)))) as n
      from public.contacts c
      cross join lateral (select array(select distinct lower(e) from unnest(c.emails::text[] || array[c.primary_email::text]) as e
                                       where e is not null) as emails) as x
      where c.merged_into_id is null and not exists (select 1 from public.vip_people v where v.contact_id = c.id)
    ) as s
    where s.n >= 10
    limit 5), '[]'::jsonb);
end
$$;

-- ═══ RPC-14 dismiss_announcement (SI) ═════════════════════════════════════════════════════════

create function public.dismiss_announcement(p_announcement_id uuid) returns void
  language sql
  security invoker
  set search_path = ''
  as $$
    insert into public.announcement_dismissals (user_id, announcement_id) values (auth.uid(), p_announcement_id)
    on conflict (user_id, announcement_id) do nothing
  $$;

-- ═══ RPC-16 get_explanation (SI) ══════════════════════════════════════════════════════════════

-- "Bu nereden çıktı?": decision tier, reason, rule / learned preference, signals, confidence and the
-- source cards (provider, account, evidence quotes, deep link, freshness). Never raw bodies.
create function public.get_explanation(p_target_type text, p_target_id uuid) returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
  as $$
declare
  v_tier public.decision_tier;
  v_reason text;
  v_rule uuid;
  v_learned uuid;
  v_confidence numeric;
  v_signals text[] := '{}';
  v_source_type public.source_type;
  v_source_id text;
  v_source_provider public.provider;
  v_source_ts timestamptz;
  v_evidence jsonb := '[]'::jsonb;
  v_account uuid;
  v_display text;
  v_web_link text;
  v_link text;
  v_src_uuid uuid;
begin
  if p_target_type not in ('insight', 'email_thread', 'email_message', 'commitment', 'life_event', 'briefing_item',
                           'capture', 'approval_action', 'meeting_prep') then
    raise exception 'VALIDATION_FAILED:target_type' using errcode = '22023';
  end if;
  case p_target_type
    when 'insight' then
      select i.decision_tier, coalesce(i.why_important, i.reason_code), i.rule_id, i.learned_preference_id, i.confidence,
             i.source_type, i.source_id, i.source_provider, i.source_timestamp, i.evidence, array[i.reason_code]
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts,
             v_evidence, v_signals
      from public.insights i where i.id = p_target_id;
    when 'email_thread' then
      select t.category_tier, t.category_reason, t.category_rule_id, t.category_learned_preference_id, t.category_confidence,
             'email_thread', t.id::text, t.provider, t.last_message_at, coalesce(t.deadline_evidence, '[]'::jsonb)
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_evidence
      from public.email_threads t where t.id = p_target_id;
    when 'email_message' then
      select m.classification_tier, m.classification_reason, m.classification_rule_id, null, m.classification_confidence,
             'email_message', m.id::text, m.provider, m.received_at,
             array_remove(array[case when m.list_unsubscribe then 'list_unsubscribe' end,
                                case when m.auto_submitted then 'auto_submitted' end,
                                case when m.precedence_bulk then 'precedence_bulk' end,
                                case when m.life_signal <> 'none' then 'life_signal:' || m.life_signal end], null)
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_signals
      from public.email_messages m where m.id = p_target_id;
    when 'commitment' then
      select null, c.origin, null, null, c.confidence, c.source_type, c.source_id, c.source_provider, c.source_timestamp, c.evidence
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_evidence
      from public.commitments c where c.id = p_target_id;
    when 'life_event' then
      select null, l.type::text, null, null, l.confidence, l.source_type, l.source_id, l.source_provider, l.source_timestamp,
             l.evidence || coalesce(l.amount_evidence, '[]'::jsonb)
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_evidence
      from public.life_events l where l.id = p_target_id;
    when 'briefing_item' then
      select null, b.section, null, null, b.confidence, b.source_type, b.source_id, b.source_provider, b.source_timestamp, b.evidence
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_evidence
      from public.briefing_items b where b.id = p_target_id;
    when 'capture' then
      select null, c.primary_type::text, null, null, null, 'capture', c.id::text, null, c.created_at, '[]'::jsonb
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_evidence
      from public.captures c where c.id = p_target_id;
    when 'approval_action' then
      select null, a.why, null, null, a.confidence, a.source_type, a.source_id, a.source_provider, a.source_timestamp, a.evidence
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_evidence
      from public.approval_actions a where a.id = p_target_id;
    when 'meeting_prep' then
      select null, p.purpose, null, null, p.confidence, p.source_type, p.source_id, p.source_provider, p.source_timestamp,
             p.evidence || p.purpose_evidence
        into v_tier, v_reason, v_rule, v_learned, v_confidence, v_source_type, v_source_id, v_source_provider, v_source_ts, v_evidence
      from public.meeting_preps p where p.id = p_target_id;
  end case;
  if v_source_type is null then
    return null;
  end if;

  if v_source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_src_uuid := v_source_id::uuid;
  end if;
  case v_source_type
    when 'email_message' then
      select m.connected_account_id, coalesce(m.subject, m.from_name, m.from_email::text), t.web_link
        into v_account, v_display, v_web_link
      from public.email_messages m join public.email_threads t on t.id = m.thread_id where m.id = v_src_uuid;
      v_link := 'dijitalasistan://mail/' || v_source_id;
    when 'email_thread' then
      select t.connected_account_id, t.subject, t.web_link into v_account, v_display, v_web_link
      from public.email_threads t where t.id = v_src_uuid;
      v_link := 'dijitalasistan://mail/' || v_source_id;
    when 'calendar_event', 'device_calendar_event' then
      select e.connected_account_id, e.title into v_account, v_display from public.calendar_events e where e.id = v_src_uuid;
      v_link := 'dijitalasistan://event/' || v_source_id;
    when 'capture' then
      select c.original_filename into v_display from public.captures c where c.id = v_src_uuid;
      v_link := 'dijitalasistan://capture/' || v_source_id;
    when 'commitment' then
      select c.text into v_display from public.commitments c where c.id = v_src_uuid;
      v_link := 'dijitalasistan://commitments/' || v_source_id;
    when 'life_event' then
      select l.title into v_display from public.life_events l where l.id = v_src_uuid;
      v_link := 'dijitalasistan://life/' || v_source_id;
    else
      v_link := null;
  end case;

  return jsonb_build_object(
    'target_type', p_target_type, 'target_id', p_target_id,
    'reason_text', v_reason, 'decision_tier', v_tier,
    'rule', (select jsonb_build_object('id', r.id, 'condition_type', r.condition_type, 'condition_value', r.condition_value,
                                       'outcome', r.outcome)
             from public.priority_rules r where r.id = v_rule),
    'learned_preference', (select jsonb_build_object('id', lp.id, 'statement', lp.statement)
                           from public.learned_preferences lp where lp.id = v_learned),
    'signals', to_jsonb(v_signals), 'confidence', v_confidence, 'model_label', null,
    'sources', jsonb_build_array(jsonb_build_object(
      'source_type', v_source_type, 'source_id', v_source_id, 'provider', v_source_provider,
      'account_label', (select coalesce(a.display_label, a.account_email::text) from public.connected_accounts a where a.id = v_account),
      'display', v_display, 'source_timestamp', v_source_ts, 'evidence', v_evidence,
      'in_app_deeplink', v_link, 'provider_web_link', v_web_link,
      'freshness', jsonb_build_object(
        'last_sync_at', (select max(s.last_success_at) from public.sync_states s where s.connected_account_id = v_account),
        'is_device', v_source_provider in ('apple_device', 'android_device') or v_source_type = 'device_calendar_event'))));
end
$$;

-- ═══ RPC-17 submit_ai_correction (SD, owner check) ════════════════════════════════════════════

-- Field allow-list: commitments {due_at, text, contact_id, counterparty_name, direction},
-- life events {amount, currency, due_at, event_at, type, title}, insights {due_at, title}.
-- p_kind accepts the API vocabulary (date, amount, person, type, not_commitment, other) and the
-- ai_feedback reason codes (wrong_date, wrong_amount, wrong_person, wrong_type, not_a_commitment).
create function public.submit_ai_correction(
  p_target_type text, p_target_id uuid, p_kind text, p_field text, p_corrected jsonb, p_comment text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_reason text;
  v_feature public.ai_feature;
  v_kind public.insight_kind;
  v_override jsonb;
  v_feedback uuid;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_reason := case p_kind
    when 'date' then 'wrong_date' when 'wrong_date' then 'wrong_date'
    when 'amount' then 'wrong_amount' when 'wrong_amount' then 'wrong_amount'
    when 'person' then 'wrong_person' when 'wrong_person' then 'wrong_person'
    when 'type' then 'wrong_type' when 'wrong_type' then 'wrong_type'
    when 'not_commitment' then 'not_a_commitment' when 'not_a_commitment' then 'not_a_commitment'
    when 'other' then 'other' end;
  if v_reason is null then
    raise exception 'VALIDATION_FAILED:kind' using errcode = '22023';
  end if;
  if p_target_type = 'commitment' then
    if v_reason <> 'not_a_commitment' and (p_field is null or p_field not in ('due_at', 'text', 'contact_id', 'counterparty_name', 'direction')) then
      raise exception 'VALIDATION_FAILED:field' using errcode = '22023';
    end if;
    perform 1 from public.commitments c where c.id = p_target_id and c.user_id = v_uid for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_feature := 'commitment_extract';
  elsif p_target_type = 'life_event' then
    if p_field is null or p_field not in ('amount', 'currency', 'due_at', 'event_at', 'type', 'title') then
      raise exception 'VALIDATION_FAILED:field' using errcode = '22023';
    end if;
    perform 1 from public.life_events l where l.id = p_target_id and l.user_id = v_uid for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_feature := 'life_intel_extract';
  elsif p_target_type = 'insight' then
    if p_field is null or p_field not in ('due_at', 'title') then
      raise exception 'VALIDATION_FAILED:field' using errcode = '22023';
    end if;
    select i.kind into v_kind from public.insights i where i.id = p_target_id and i.user_id = v_uid for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_feature := (case v_kind when 'commitment' then 'commitment_extract' when 'life_event' then 'life_intel_extract'
                              when 'security' then 'life_intel_extract' when 'meeting' then 'meeting_prep'
                              when 'digest' then 'briefing_morning' else 'email_triage' end)::public.ai_feature;
  else
    raise exception 'VALIDATION_FAILED:target_type' using errcode = '22023';
  end if;

  if p_field is not null then
    v_override := jsonb_build_object(p_field, jsonb_build_object('value', p_corrected, 'corrected_at', now()));
    case p_target_type
      when 'commitment' then
        update public.commitments c set user_overrides = c.user_overrides || v_override where c.id = p_target_id;
      when 'life_event' then
        update public.life_events l set user_overrides = l.user_overrides || v_override where l.id = p_target_id;
      when 'insight' then
        update public.insights i set user_overrides = i.user_overrides || v_override where i.id = p_target_id;
    end case;
  end if;
  if v_reason = 'not_a_commitment' and p_target_type = 'commitment' then
    update public.commitments c set status = 'cancelled'
    where c.id = p_target_id and c.status in ('open', 'snoozed');
  end if;

  insert into public.ai_feedback (user_id, feature, target_type, target_id, rating, reason_code, comment, detail)
  values (v_uid, v_feature, p_target_type, p_target_id, -1, v_reason, left(p_comment, 500),
          case when p_field is null then '{}'::jsonb else jsonb_build_object('field', p_field) end)
  on conflict (user_id, feature, target_type, target_id)
    do update set rating = -1, reason_code = excluded.reason_code, comment = coalesce(excluded.comment, public.ai_feedback.comment),
                  detail = excluded.detail
  returning id into v_feedback;
  return jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'field', p_field,
                            'reason_code', v_reason, 'feedback_id', v_feedback, 'applied', true);
end
$$;

-- ═══ RPC-21 apply_insight_feedback / RPC-22 revert_insight_feedback (SD, owner check) ═════════

create function public.apply_insight_feedback(p_insight_id uuid, p_kind text, p_client_mutation_id uuid default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  i public.insights;
  f public.ai_feedback;
  v_feature public.ai_feature;
  v_rating smallint;
  v_target_type text;
  v_target_ref text;
  v_group text;
  v_label text;
  v_contact uuid;
  v_learned uuid;
  v_vip uuid;
  v_vip_created boolean := false;
  v_prev_follow text;
  v_suppressed_life uuid;
  v_detail jsonb;
  v_feedback uuid;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('not_important', 'show_more', 'make_vip', 'stop_tracking', 'never_show') then
    raise exception 'VALIDATION_FAILED:kind' using errcode = '22023';
  end if;
  if p_client_mutation_id is not null then
    select * into f from public.ai_feedback x where x.user_id = v_uid and x.client_mutation_id = p_client_mutation_id;
    if found then
      return jsonb_build_object('feedback_id', f.id, 'learned_preference_id', f.detail ->> 'learned_preference_id',
                                'vip_id', f.detail ->> 'vip_id', 'replayed', true);
    end if;
  end if;
  select * into i from public.insights x where x.id = p_insight_id and x.user_id = v_uid for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_feature := (case i.kind when 'commitment' then 'commitment_extract' when 'life_event' then 'life_intel_extract'
                            when 'security' then 'life_intel_extract' when 'meeting' then 'meeting_prep'
                            when 'digest' then 'briefing_morning' else 'email_triage' end)::public.ai_feature;
  v_rating := case when p_kind in ('show_more', 'make_vip') then 1 else -1 end;

  -- The person or category the feedback is about.
  if i.entity_type = 'contact' then
    v_contact := i.entity_id;
  elsif i.entity_type = 'commitment' then
    select c.contact_id into v_contact from public.commitments c where c.id = i.entity_id and c.user_id = v_uid;
  elsif i.entity_type in ('email_thread', 'email_message') then
    select m.from_email::text, coalesce(m.from_name, m.from_email::text) into v_target_ref, v_label
    from public.email_messages m
    where m.user_id = v_uid and m.direction = 'inbound'
      and (m.id = i.entity_id or m.thread_id = i.entity_id)
    order by m.received_at desc limit 1;
    if v_target_ref is not null then
      select c.id into v_contact from public.contacts c
      where c.user_id = v_uid and (c.primary_email = v_target_ref::extensions.citext or v_target_ref::extensions.citext = any(c.emails))
      order by c.created_at limit 1;
    end if;
  end if;
  if v_contact is not null then
    select c.id::text, c.display_name into v_target_ref, v_label from public.contacts c where c.id = v_contact;
    v_target_type := 'contact';
    v_group := 'people';
  elsif v_target_ref is not null then
    v_target_type := 'sender';
    v_group := 'people';
  else
    v_target_type := 'category';
    v_target_ref := i.kind::text;
    v_label := i.kind::text;
    v_group := 'categories';
  end if;

  if p_kind <> 'make_vip' then
    v_learned := private.upsert_learned_preference(v_uid, v_target_type, v_target_ref, v_group,
                   jsonb_build_object('priority', case when p_kind = 'show_more' then 'high' else 'low' end), 1, v_label);
  else
    if v_contact is null and v_target_type = 'sender' then
      insert into public.contacts (user_id, display_name, primary_email, emails, avatar_seed, origin)
      values (v_uid, left(coalesce(v_label, v_target_ref), 120), v_target_ref::extensions.citext,
              array[v_target_ref::extensions.citext], (abs(hashtext(lower(v_target_ref))::bigint) % 1000)::integer, 'mail')
      on conflict (user_id, primary_email) where primary_email is not null do nothing
      returning id into v_contact;
      if v_contact is null then
        select c.id into v_contact from public.contacts c where c.user_id = v_uid and c.primary_email = v_target_ref::extensions.citext;
      end if;
    end if;
    if v_contact is null then
      raise exception 'VALIDATION_FAILED:no_person' using errcode = '22023';
    end if;
    insert into public.vip_people (user_id, contact_id, origin) values (v_uid, v_contact, 'suggestion')
    on conflict (user_id, contact_id) do nothing
    returning id into v_vip;
    if v_vip is null then
      select v.id into v_vip from public.vip_people v where v.user_id = v_uid and v.contact_id = v_contact;
    else
      v_vip_created := true;
    end if;
  end if;

  if p_kind = 'stop_tracking' and i.kind = 'follow_up' and i.entity_type = 'email_thread' then
    select t.follow_up_state into v_prev_follow from public.email_threads t where t.id = i.entity_id and t.user_id = v_uid;
    update public.email_threads t set follow_up_state = 'muted' where t.id = i.entity_id and t.user_id = v_uid;
  end if;
  if p_kind = 'never_show' and i.entity_type = 'life_event' then
    update public.life_events l set suppressed = true
    where l.id = i.entity_id and l.user_id = v_uid and not l.suppressed
    returning l.id into v_suppressed_life;
  end if;
  if p_kind in ('not_important', 'stop_tracking', 'never_show') and i.status in ('open', 'snoozed') then
    update public.insights x set status = 'dismissed' where x.id = i.id;
  end if;

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'kind', p_kind, 'prev_status', i.status, 'learned_preference_id', v_learned,
    'vip_id', v_vip, 'vip_created', case when v_vip_created then true end,
    'prev_follow_up_state', v_prev_follow, 'suppressed_life_event_id', v_suppressed_life));
  insert into public.ai_feedback (user_id, feature, target_type, target_id, rating, reason_code, client_mutation_id, detail)
  values (v_uid, v_feature, 'insight', i.id, v_rating, p_kind, p_client_mutation_id, v_detail)
  on conflict (user_id, feature, target_type, target_id)
    do update set rating = excluded.rating, reason_code = excluded.reason_code,
                  client_mutation_id = coalesce(excluded.client_mutation_id, public.ai_feedback.client_mutation_id),
                  detail = excluded.detail
  returning id into v_feedback;
  perform private.enqueue_job('insight_refresh',
    'insight_refresh:' || v_uid || ':' || to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYYMMDDHH24MI'),
    jsonb_build_object('user_id', v_uid, 'reason', 'feedback'), v_uid, null, now(), 100, 5, null);
  return jsonb_build_object('feedback_id', v_feedback, 'learned_preference_id', v_learned, 'vip_id', v_vip);
end
$$;

-- "Geri al" for RPC-21: removes the feedback's effects (learned-preference evidence, a VIP row it
-- created, a muted follow-up, a suppressed life event) and restores the insight; idempotent.
create function public.revert_insight_feedback(p_feedback_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  f public.ai_feedback;
  v_lp uuid;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into f from public.ai_feedback x where x.id = p_feedback_id and x.user_id = v_uid for update;
  if not found then
    return;
  end if;
  if f.target_type = 'insight' then
    v_lp := nullif(f.detail ->> 'learned_preference_id', '')::uuid;
    if v_lp is not null then
      update public.learned_preferences lp set evidence_count = greatest(lp.evidence_count - 1, 0)
      where lp.id = v_lp and lp.user_id = v_uid;
      delete from public.learned_preferences lp
      where lp.id = v_lp and lp.user_id = v_uid and lp.evidence_count = 0 and lp.origin = 'learned' and lp.deleted_at is null;
    end if;
    if (f.detail ->> 'vip_created')::boolean then
      delete from public.vip_people v where v.id = nullif(f.detail ->> 'vip_id', '')::uuid and v.user_id = v_uid;
    end if;
    if f.detail ? 'prev_follow_up_state' then
      update public.email_threads t set follow_up_state = f.detail ->> 'prev_follow_up_state'
      where t.user_id = v_uid and t.follow_up_state = 'muted'
        and t.id = (select i.entity_id from public.insights i where i.id = f.target_id);
    end if;
    if f.detail ? 'suppressed_life_event_id' then
      update public.life_events l set suppressed = false
      where l.id = (f.detail ->> 'suppressed_life_event_id')::uuid and l.user_id = v_uid;
    end if;
    if f.detail ->> 'prev_status' in ('open', 'snoozed') then
      update public.insights i set status = 'open'
      where i.id = f.target_id and i.user_id = v_uid and i.status = 'dismissed';
    end if;
  end if;
  delete from public.ai_feedback x where x.id = f.id;
end
$$;

-- ═══ RPC-19 history_deletion_preview (SI) ═════════════════════════════════════════════════════

-- Counts shown before "Geçmişi sil" (p_older_than NULL = the whole private.purge_user_history
-- scope) or before a retention shortening (rows whose retention anchor is older than p_older_than).
create function public.history_deletion_preview(p_older_than timestamptz default null) returns jsonb
  language sql stable
  security invoker
  set search_path = ''
  as $$
    select jsonb_build_object(
      'older_than', p_older_than,
      'summaries',
        (select count(*) from public.email_threads t
         where (p_older_than is null and not exists (select 1 from public.reply_drafts r
                                                     join public.approval_actions a on a.id = r.approval_action_id
                                                     where r.thread_id = t.id and a.status in ('pending', 'approved', 'executing')))
            or t.last_message_at < p_older_than)
        + (select count(*) from public.briefings b where p_older_than is null or b.scheduled_for < p_older_than)
        + (select count(*) from public.meeting_preps p where p_older_than is null or p.created_at < p_older_than),
      'priority_decisions',
        (select count(*) from public.insights i
         where p_older_than is null or coalesce(i.event_at, i.due_at, i.created_at) < p_older_than),
      'memory_entries',
        (select count(*) from public.memory_chunks m where p_older_than is null or m.occurred_at < p_older_than),
      'learned_preferences',
        (select count(*) from public.learned_preferences lp where p_older_than is null),
      'assistant_conversations',
        (select count(*) from public.assistant_threads a
         where p_older_than is null or coalesce(a.last_message_at, a.created_at) < p_older_than),
      'captures',
        (select count(*) from public.captures c where p_older_than is null or c.created_at < p_older_than))
  $$;

-- ═══ RPC-23 upsert_manual_contact (SI) ════════════════════════════════════════════════════════

create function public.upsert_manual_contact(p_email extensions.citext, p_display_name text default null) returns uuid
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  v_id uuid;
  v_email extensions.citext := lower(btrim(p_email::text))::extensions.citext;
begin
  if v_email is null or v_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION_FAILED:email' using errcode = '22023';
  end if;
  select c.id into v_id from public.contacts c
  where c.primary_email = v_email or v_email = any(c.emails)
  order by c.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.contacts (user_id, display_name, primary_email, emails, avatar_seed, origin)
  values (auth.uid(), left(coalesce(nullif(btrim(p_display_name), ''), split_part(v_email::text, '@', 1)), 120), v_email,
          array[v_email], (abs(hashtext(v_email::text)::bigint) % 1000)::integer, 'manual')
  on conflict (user_id, primary_email) where primary_email is not null do nothing
  returning id into v_id;
  if v_id is null then
    select c.id into v_id from public.contacts c where c.primary_email = v_email;
  end if;
  return v_id;
end
$$;

-- ═══ Privileges ═══════════════════════════════════════════════════════════════════════════════
revoke execute on function
  public.effective_entitlement(uuid),
  public.check_plan_limit(text, integer, uuid),
  public.set_insight_status(uuid, public.item_status, timestamptz, text),
  public.search_user_content(text, extensions.vector, text[], timestamptz, timestamptz, uuid, text, integer),
  public.memory_vector_candidates(extensions.vector, timestamptz, timestamptz, uuid, integer),
  public.person_intelligence(uuid),
  public.today_overview(date),
  public.flow_feed(text, text, integer),
  public.flow_meta(text),
  public.set_commitment_status(uuid, public.commitment_status, timestamptz),
  public.mark_briefing_opened(uuid),
  public.mail_intelligence(date, public.mail_category, uuid, text, integer),
  public.plan_range(timestamptz, timestamptz),
  public.plan_week_density(date),
  public.list_approvals(public.approval_status[], text, integer),
  public.preview_priority_rule(public.rule_condition, jsonb, public.rule_outcome),
  public.get_usage_summary(),
  public.vip_suggestions(),
  public.dismiss_announcement(uuid),
  public.get_explanation(text, uuid),
  public.submit_ai_correction(text, uuid, text, text, jsonb, text),
  public.apply_insight_feedback(uuid, text, uuid),
  public.revert_insight_feedback(uuid),
  public.history_deletion_preview(timestamptz),
  public.upsert_manual_contact(extensions.citext, text)
  from public, anon;

grant execute on function
  public.effective_entitlement(uuid),
  public.check_plan_limit(text, integer, uuid),
  public.set_insight_status(uuid, public.item_status, timestamptz, text),
  public.search_user_content(text, extensions.vector, text[], timestamptz, timestamptz, uuid, text, integer),
  public.memory_vector_candidates(extensions.vector, timestamptz, timestamptz, uuid, integer),
  public.person_intelligence(uuid),
  public.today_overview(date),
  public.flow_feed(text, text, integer),
  public.flow_meta(text),
  public.set_commitment_status(uuid, public.commitment_status, timestamptz),
  public.mark_briefing_opened(uuid),
  public.mail_intelligence(date, public.mail_category, uuid, text, integer),
  public.plan_range(timestamptz, timestamptz),
  public.plan_week_density(date),
  public.list_approvals(public.approval_status[], text, integer),
  public.preview_priority_rule(public.rule_condition, jsonb, public.rule_outcome),
  public.get_usage_summary(),
  public.vip_suggestions(),
  public.dismiss_announcement(uuid),
  public.get_explanation(text, uuid),
  public.submit_ai_correction(text, uuid, text, text, jsonb, text),
  public.apply_insight_feedback(uuid, text, uuid),
  public.revert_insight_feedback(uuid),
  public.history_deletion_preview(timestamptz),
  public.upsert_manual_contact(extensions.citext, text)
  to authenticated;

-- Servers call the entitlement and limit checks with the secret key for any user.
grant execute on function public.effective_entitlement(uuid), public.check_plan_limit(text, integer, uuid) to service_role;
