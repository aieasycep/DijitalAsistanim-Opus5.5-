-- Migration 0001 · extensions, schemas, enums, shared helpers
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §1.1, §1.3, §1.8, §2, §6.1 (check helpers), §10 (row 0001).
-- Portability: PostgreSQL 16 + pgvector 0.6 (tier C) and hosted PostgreSQL 17 (tier A) (§1.7).

-- ─── Time: every instant is stored in UTC (§1.3) ─────────────────────────────────────────────
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'UTC');
exception when insufficient_privilege then
  raise notice 'timezone: cannot alter database %, relying on the platform default (UTC)', current_database();
end
$$;

-- ─── Extensions (§1.8) ────────────────────────────────────────────────────────────────────────
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists vector with schema extensions;   -- 0.6+ (tier C) / 0.8 (hosted)

-- pg_cron can only be created in the database named by cron.database_name (and only when the
-- library is preloaded); pg_net is not packaged for tier C, where the shim provides
-- net.http_post(). Both are optional here: the cron schedules (0015) are guarded as well.
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron')
     and current_setting('cron.database_name', true) is not distinct from current_database() then
    create extension if not exists pg_cron;                               -- schema cron
  else
    raise notice 'pg_cron unavailable in database %: cron schedules (0015) will be skipped', current_database();
  end if;

  if not exists (
       select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'net' and p.proname = 'http_post')
     and exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  elsif not exists (
       select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'net' and p.proname = 'http_post') then
    raise notice 'pg_net unavailable: worker pokes (private.poke_worker) need net.http_post()';
  end if;
end
$$;

-- ─── Schemas (§1.1) ───────────────────────────────────────────────────────────────────────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to service_role, supabase_auth_admin;
comment on schema private is
  'Security-definer helpers, triggers, scheduler, audit chain, admin permission matrix and the Turkish text-search configuration. Never exposed through PostgREST.';

create schema if not exists admin_api;
revoke all on schema admin_api from public;
grant usage on schema admin_api to authenticated, service_role;
comment on schema admin_api is
  'Security-definer RPCs called only by the admin-api Edge Function with the admin JWT; every function starts with private.require_admin(<permission>).';

-- ─── Turkish full-text search with unaccent (§1.8) ────────────────────────────────────────────
create text search configuration private.tr_search (copy = pg_catalog.turkish);
alter text search configuration private.tr_search
  alter mapping for hword, hword_part, word with extensions.unaccent, turkish_stem;
comment on text search configuration private.tr_search is
  'Turkish stemming with accent folding; used by every generated search_tsv / tsv column.';

create function private.immutable_unaccent(text) returns text
  language sql immutable parallel safe strict
  set search_path = ''
  as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;
comment on function private.immutable_unaccent(text) is
  'Accent folding usable in index expressions (trigram search on contacts).';

-- Joins a text array with spaces; immutable (array_to_string is only stable), for generated columns.
create function private.immutable_array_to_text(text[]) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$ select coalesce(string_agg(x, ' '), '') from unnest($1) as t (x) $$;

-- ─── Enums (§2) ───────────────────────────────────────────────────────────────────────────────
create type public.provider as enum ('google', 'microsoft', 'apple_device', 'android_device', 'demo');
create type public.capability as enum ('mail_read', 'mail_send', 'calendar_read', 'calendar_write', 'tasks_read', 'tasks_write');
create type public.account_status as enum ('connecting', 'healthy', 'syncing', 'partial', 'needs_reauth', 'admin_consent_required', 'error', 'disconnected');
create type public.mail_category as enum ('important', 'awaiting_my_reply', 'awaiting_their_reply', 'has_deadline', 'informational', 'low_priority');
create type public.decision_tier as enum ('explicit_rule', 'learned_preference', 'deterministic_signal', 'ai_classification');
create type public.insight_kind as enum ('reply_needed', 'meeting', 'deadline', 'follow_up', 'commitment', 'life_event', 'security', 'conflict', 'schedule_suggestion', 'approval_pending', 'digest');
create type public.urgency as enum ('urgent', 'today', 'normal', 'low');
create type public.item_status as enum ('open', 'done', 'dismissed', 'snoozed', 'expired');
create type public.life_event_type as enum ('shipment', 'flight', 'reservation', 'payment', 'subscription', 'security');
create type public.flow_card_type as enum ('email', 'meeting', 'deadline', 'shipment', 'flight', 'reservation', 'payment', 'subscription', 'security', 'follow_up', 'commitment');
create type public.commitment_direction as enum ('user_owes', 'they_owe');
create type public.commitment_status as enum ('open', 'done', 'snoozed', 'cancelled');
create type public.approval_action_type as enum ('email_send', 'calendar_create', 'calendar_update', 'task_create', 'reminder_create', 'commitment_create');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'executing', 'executed', 'failed', 'expired');
create type public.briefing_kind as enum ('morning', 'midday', 'evening', 'weekly');
create type public.briefing_status as enum ('scheduled', 'generating', 'ready', 'delivered', 'skipped', 'failed');
create type public.capture_kind as enum ('photo', 'screenshot', 'pdf', 'file', 'link', 'text', 'share');
create type public.capture_status as enum ('pending_upload', 'uploaded', 'analyzing', 'extracted', 'actioned', 'discarded', 'failed');
create type public.extracted_entity_type as enum ('event', 'task', 'deadline', 'person', 'payment', 'reservation', 'flight', 'shipment', 'product', 'note');
create type public.notification_category as enum ('morning', 'midday', 'evening', 'critical_email', 'meeting', 'deadline', 'follow_up', 'life_intel', 'approval', 'account');
create type public.notification_detail as enum ('full', 'title_only', 'generic');
create type public.notification_decision as enum ('scheduled', 'sent', 'suppressed', 'deduplicated', 'failed');
create type public.job_type as enum (
  'initial_sync', 'gmail_sync', 'outlook_sync', 'calendar_sync', 'tasks_sync', 'device_calendar_ingest',
  'watch_renewal', 'reconciliation', 'provider_webhook', 'email_triage', 'email_analysis', 'insight_refresh',
  'first_analysis', 'briefing', 'meeting_prep', 'embedding', 'approval_execute', 'notification',
  'push_receipts', 'retention', 'export', 'history_deletion', 'account_deletion', 'billing_sync',
  'referral_evaluate', 'health_check', 'capture_analysis', 'credential_reencrypt', 'integration_purge',
  'ai_batch', 'ai_eval', 'briefing_audio', 'transactional_email');
create type public.job_status as enum ('queued', 'running', 'completed', 'retrying', 'failed', 'dead_letter');
create type public.admin_role as enum ('super_admin', 'operations', 'support', 'finance', 'ai_ops', 'analyst', 'readonly');
create type public.prompt_status as enum ('draft', 'active', 'archived');
create type public.ticket_status as enum ('open', 'in_progress', 'waiting_user', 'resolved', 'closed');
create type public.ticket_category as enum ('account', 'integration', 'sync', 'billing', 'ai_quality', 'notification', 'privacy', 'other');
create type public.feedback_type as enum ('bug', 'feature', 'general', 'ai_quality');
create type public.grant_source as enum ('referral_referrer', 'referral_referee', 'admin', 'support', 'compensation');
create type public.retention_policy as enum ('d30', 'd90', 'd365', 'until_deleted');
-- Registry additions (§2, §14)
create type public.source_type as enum (
  'email_message', 'email_thread', 'calendar_event', 'device_calendar_event', 'task', 'capture',
  'meeting_note', 'post_meeting_note', 'android_notification', 'assistant_message', 'user_input',
  'commitment', 'life_event', 'contact', 'briefing', 'ai_feedback');
create type public.platform as enum ('ios', 'android');
create type public.user_state as enum ('active', 'disabled', 'deletion_pending');
create type public.vip_relationship as enum ('spouse', 'family', 'manager', 'key_client', 'friend', 'other');
create type public.rule_condition as enum ('person', 'domain', 'keyword', 'category', 'sender', 'android_app');
create type public.rule_outcome as enum ('always_important', 'high', 'low', 'always_notify', 'mute');
create type public.referral_status as enum ('pending', 'qualified', 'rewarded', 'rejected', 'flagged');
create type public.referral_side as enum ('referrer', 'referee');
create type public.subscription_status as enum ('none', 'trial', 'active', 'grace_period', 'billing_issue', 'cancelled', 'paused', 'expired', 'refunded');
create type public.reminder_status as enum ('scheduled', 'delivered', 'done', 'cancelled', 'failed');
create type public.export_status as enum ('requested', 'processing', 'ready', 'expired', 'failed', 'cancelled');
create type public.deletion_kind as enum ('history', 'account');
create type public.deletion_status as enum ('requested', 'verified', 'queued', 'processing', 'completed', 'failed', 'cancelled');
create type public.ai_feature as enum (
  'email_triage', 'thread_summary', 'email_deep_extract', 'commitment_extract', 'life_intel_extract',
  'briefing_morning', 'briefing_midday', 'briefing_evening', 'weekly_review', 'meeting_prep',
  'post_meeting_parse', 'capture_extract', 'assistant_intent', 'assistant_qa', 'reply_draft',
  'follow_up_draft', 'embedding_doc', 'embedding_query', 'stt', 'tts', 'admin_probe');
create type public.routing_profile as enum ('balanced', 'lean');
create type public.ai_tier as enum ('t0', 't1', 't2', 't3');
create type public.approval_via as enum ('approval_center', 'inline_sheet', 'voice_card', 'capture_batch', 'in_place');
create type public.support_access_scope as enum ('pii', 'email_metadata', 'insights', 'notifications', 'captures', 'assistant_transcript', 'ai_feedback');
create type public.admin_status as enum ('invited', 'active', 'disabled');

comment on type public.source_type is 'Provenance source of every derived row (M§97).';
comment on type public.approval_via is 'R-03: every value is a tap; a spoken "onayla" never approves.';
comment on type public.support_access_scope is 'R-09 Support Access scopes; tokens, secrets, original mail and files are never grantable.';

-- ─── Common trigger: updated_at (§1.6) ────────────────────────────────────────────────────────
create function private.set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ─── Check-constraint helpers (§0 ⟨EVID⟩, §4.1, §4.2, §4.4, §4.6, §4.7) ─────────────────────
-- Pure, immutable functions that never return NULL (a NULL check result would pass). CHECK and
-- generated-column expressions run with the privileges of the writing role, so these helpers are
-- executable by authenticated and service_role. Dependent sub-checks are nested in CASE so no
-- cast or array function ever runs on a value of the wrong JSON type.

-- JSON number → numeric; NULL for every other JSON type.
create function private.jsonb_numeric(p jsonb) returns numeric
  language sql immutable parallel safe
  set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric end $$;

-- Length of a JSON array; 0 for NULL or any other JSON type (for "at least one evidence" checks).
create function private.jsonb_array_len(p jsonb) returns integer
  language sql immutable parallel safe
  set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'array' then jsonb_array_length(p) else 0 end $$;

-- True when the object has exactly the given key set.
create function private.jsonb_has_exact_keys(p jsonb, p_keys text[]) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when jsonb_typeof(p) <> 'object' then false
      else coalesce((select array_agg(k.key order by k.key) from jsonb_object_keys(p) as k (key))
                    = (select array_agg(x order by x) from unnest(p_keys) as t (x)), false)
    end
  $$;

-- ⟨EVID⟩: array of ≤5 objects. Required: quote (1..300 chars), field. Optional: locator
-- (DATABASE_AND_RLS_PLAN §0) and the verifier's span data ref, span_start, span_end, match,
-- rule_id, ambiguous (AI_PIPELINE_PLAN §6.8). Any other key is rejected.
create function private.valid_evidence(p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p is null or jsonb_typeof(p) <> 'array' then false
      when jsonb_array_length(p) > 5 then false
      else not exists (
        select 1
        from jsonb_array_elements(p) as e (item)
        where case
          when jsonb_typeof(e.item) <> 'object' then true
          when jsonb_typeof(e.item -> 'quote') is distinct from 'string' then true
          when char_length(e.item ->> 'quote') not between 1 and 300 then true
          when jsonb_typeof(e.item -> 'field') is distinct from 'string' then true
          else exists (
            select 1 from jsonb_each(e.item) as k (key, value)
            where case
              when k.key in ('quote', 'field') then false
              when k.key in ('locator', 'ref', 'match', 'rule_id') then jsonb_typeof(k.value) <> 'string'
              when k.key in ('span_start', 'span_end') then jsonb_typeof(k.value) <> 'number'
              when k.key = 'ambiguous' then jsonb_typeof(k.value) <> 'boolean'
              else true
            end)
        end)
    end
  $$;

-- user_preferences.ai_data_access: exactly these five keys, all boolean.
create function private.valid_ai_data_access(p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when not private.jsonb_has_exact_keys(p, array['mail_body', 'attachments', 'calendar', 'contacts', 'location_coarse']) then false
      else not exists (
        select 1 from jsonb_each(p) as e (key, value) where jsonb_typeof(e.value) <> 'boolean')
    end
  $$;

-- connected_accounts.data_source_toggles: known keys only, boolean values.
create function private.valid_data_source_toggles(p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p is null or jsonb_typeof(p) <> 'object' then false
      else not exists (
        select 1 from jsonb_each(p) as e (key, value)
        where e.key not in ('mail_read', 'attachments_analyze', 'deadline_detect', 'draft_replies',
                            'calendar_read', 'schedule_suggest', 'calendar_write_with_approval', 'tasks_read')
           or jsonb_typeof(e.value) <> 'boolean')
    end
  $$;

-- priority_rules.condition_value shape per condition_type (§4.4).
create function private.valid_rule_condition(p_type public.rule_condition, p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(case
      when p is null or p_type is null or jsonb_typeof(p) <> 'object' then false
      when p_type = 'person' then
        case when not private.jsonb_has_exact_keys(p, array['contact_id']) then false
             else (p ->> 'contact_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' end
      when p_type = 'domain' then
        case when not private.jsonb_has_exact_keys(p, array['domain']) then false
             else (p ->> 'domain') ~ '^[a-z0-9.-]+\.[a-z]{2,}$' end
      when p_type = 'keyword' then
        case when not private.jsonb_has_exact_keys(p, array['keywords']) then false
             when jsonb_typeof(p -> 'keywords') <> 'array' then false
             when jsonb_array_length(p -> 'keywords') not between 1 and 10 then false
             else not exists (
               select 1 from jsonb_array_elements(p -> 'keywords') as w (item)
               where case when jsonb_typeof(w.item) <> 'string' then true
                          else char_length(w.item #>> '{}') not between 1 and 100 end)
        end
      when p_type = 'category' then
        case when not private.jsonb_has_exact_keys(p, array['category']) then false
             else (p ->> 'category') in ('important', 'awaiting_my_reply', 'awaiting_their_reply',
                                         'has_deadline', 'informational', 'low_priority', 'promotions') end
      when p_type = 'sender' then
        case when not private.jsonb_has_exact_keys(p, array['address']) then false
             else (p ->> 'address') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' end
      when p_type = 'android_app' then
        case when not private.jsonb_has_exact_keys(p, array['package']) then false
             else (p ->> 'package') ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' end
      else false
    end, false)
  $$;

-- plan_limits.value type and bounds per key (§4.6, R-22).
create function private.valid_plan_limit(p_key text, p_value jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(case
      when p_value is null then false
      when p_key in ('ai_daily_budget_units', 'assistant_retrieval_days') and jsonb_typeof(p_value) = 'null' then true
      when p_key in ('max_mail_accounts', 'max_calendar_accounts', 'max_calendars', 'vip_max', 'priority_rules_max',
                     'ai_daily_budget_units', 'email_analysis_daily', 'reply_drafts_daily', 'assistant_messages_daily',
                     'assistant_retrieval_days', 'transcribe_seconds_daily', 'captures_daily', 'meeting_preps_daily',
                     'semantic_search_daily', 'backfill_days', 'referral_rewards_per_year') then
        private.jsonb_numeric(p_value) >= 0
        and private.jsonb_numeric(p_value) = trunc(private.jsonb_numeric(p_value))
      when p_key in ('ai_soft_cap_usd_day', 'ai_hard_cap_usd_day', 'ai_hard_cap_usd_month') then
        private.jsonb_numeric(p_value) >= 0
      when p_key = 'ai_briefing_reserve_ratio' then
        private.jsonb_numeric(p_value) between 0 and 1
      when p_key = 'ai_routing_profile' then
        jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') in ('balanced', 'lean')
      when p_key in ('meeting_prep', 'memory_search', 'voice_briefing', 'android_ni', 'midday_evening',
                     'advanced_planning', 'follow_up_commitments', 'capture', 'vip') then
        jsonb_typeof(p_value) = 'boolean'
      else false
    end, false)
  $$;

-- app_settings.value type and bounds per key (§4.7 seed table; unknown keys are rejected).
create function private.valid_app_setting(p_key text, p_value jsonb) returns boolean
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
      else false
    end, false)
  $$;

-- ─── Masking and subject hashing (§6.1) ───────────────────────────────────────────────────────
create function private.mask_email(p_email extensions.citext) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p_email is null then null
      when position('@' in p_email::text) = 0 then '***'
      else left(split_part(p_email::text, '@', 1), 2) || '***@' || split_part(p_email::text, '@', 2)
    end
  $$;
comment on function private.mask_email(extensions.citext) is 'yunus@gmail.com → yu***@gmail.com (M§71).';

create function private.hash_subject(p_id uuid) returns bytea
  language sql immutable parallel safe strict
  set search_path = ''
  as $$ select pg_catalog.sha256(convert_to('da-subject-v1:' || p_id::text, 'UTF8')) $$;
comment on function private.hash_subject(uuid) is 'Pseudonymous subject id kept after account deletion: sha256(''da-subject-v1:''‖id).';

-- ─── Function privileges ──────────────────────────────────────────────────────────────────────
revoke execute on function
  private.immutable_unaccent(text),
  private.immutable_array_to_text(text[]),
  private.set_updated_at(),
  private.jsonb_numeric(jsonb),
  private.jsonb_array_len(jsonb),
  private.jsonb_has_exact_keys(jsonb, text[]),
  private.valid_evidence(jsonb),
  private.valid_ai_data_access(jsonb),
  private.valid_data_source_toggles(jsonb),
  private.valid_rule_condition(public.rule_condition, jsonb),
  private.valid_plan_limit(text, jsonb),
  private.valid_app_setting(text, jsonb),
  private.mask_email(extensions.citext),
  private.hash_subject(uuid)
  from public;

grant execute on function
  private.immutable_unaccent(text),
  private.immutable_array_to_text(text[]),
  private.jsonb_numeric(jsonb),
  private.jsonb_array_len(jsonb),
  private.jsonb_has_exact_keys(jsonb, text[]),
  private.valid_evidence(jsonb),
  private.valid_ai_data_access(jsonb),
  private.valid_data_source_toggles(jsonb),
  private.valid_rule_condition(public.rule_condition, jsonb),
  private.valid_plan_limit(text, jsonb),
  private.valid_app_setting(text, jsonb)
  to authenticated, service_role;

grant execute on function private.mask_email(extensions.citext), private.hash_subject(uuid) to service_role;
