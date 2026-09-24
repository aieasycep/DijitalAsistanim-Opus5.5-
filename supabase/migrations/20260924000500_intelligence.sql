-- Migration 0005 · intelligence
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.4 (priority_rules … ai_batches), §6.1 (model_routable),
-- §7 (trg_prompt_versions_guard, trg_ai_model_config_version), §10 row 0005; R-02, R-18, ADR-44.
-- Also adds the 0004 forward references to priority_rules, learned_preferences and prompt_versions.
-- Reference data: ai_model_config and ai_model_prices seeds (embedded from supabase/seed/).
-- prompt_versions v1 rows are generated from supabase/prompts/*.md with the AI pipeline (Step 5).

-- ─── prompt_versions (SYS + restrictive aal2 in 0014) ─────────────────────────────────────────
create table public.prompt_versions (
  id uuid not null default gen_random_uuid(),
  prompt_key text not null check (prompt_key in (
    'email_classification', 'thread_summary', 'email_deep_extract', 'commitment', 'post_meeting', 'follow_up',
    'life_intel', 'briefing_morning', 'briefing_midday', 'briefing_evening', 'weekly_review', 'meeting_prep',
    'capture', 'capture_vision', 'capture_pdf', 'assistant_intent', 'assistant', 'reply_draft')),
  version integer not null check (version >= 1),
  status public.prompt_status not null default 'draft',
  system_prompt text not null check (char_length(system_prompt) <= 40000),
  user_template text not null check (char_length(user_template) <= 20000),
  output_schema_ref text not null,
  schema_hash text not null,
  model_role text not null,
  model_constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(model_constraints) = 'object'),
  eval_dataset_version text,
  eval_report jsonb,
  eval_passed boolean not null default false,
  notes text check (char_length(notes) <= 2000),
  changelog text check (char_length(changelog) <= 2000),
  created_by uuid,                                    -- FK → admin_users (0012)
  activated_by uuid,                                  -- FK → admin_users (0012)
  activated_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint prompt_versions_pkey primary key (id),
  constraint prompt_versions_prompt_key_version_key unique (prompt_key, version)
);
create unique index prompt_versions_prompt_key_active_key on public.prompt_versions (prompt_key)
  where status = 'active';
create index prompt_versions_prompt_key_status_idx on public.prompt_versions (prompt_key, status);
alter table public.prompt_versions enable row level security;
alter table public.prompt_versions force row level security;
comment on table public.prompt_versions is
  'Versioned prompts with activate/rollback (M§58); one active version per key; content immutable once not draft. System table.';

-- Content is immutable once a version leaves draft; legal status edges are draft→active,
-- active→archived and archived→active (rollback); activation requires eval_passed (§4.4).
create function private.guard_prompt_versions() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if old.status <> 'draft' and (
       new.prompt_key is distinct from old.prompt_key
       or new.version is distinct from old.version
       or new.system_prompt is distinct from old.system_prompt
       or new.user_template is distinct from old.user_template
       or new.output_schema_ref is distinct from old.output_schema_ref
       or new.schema_hash is distinct from old.schema_hash
       or new.model_role is distinct from old.model_role
       or new.model_constraints is distinct from old.model_constraints) then
    raise exception 'PROMPT_VERSION_IMMUTABLE' using errcode = '55000';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'active')
            or (old.status = 'active' and new.status = 'archived')
            or (old.status = 'archived' and new.status = 'active')) then
      raise exception 'ILLEGAL_TRANSITION:%->%', old.status, new.status using errcode = '55000';
    end if;
    if new.status = 'active' and not new.eval_passed then
      raise exception 'EVAL_REQUIRED' using errcode = '55000';
    end if;
  end if;
  return new;
end
$$;
revoke execute on function private.guard_prompt_versions() from public;

create trigger trg_prompt_versions_guard before update on public.prompt_versions
  for each row execute function private.guard_prompt_versions();

-- ─── priority_rules ───────────────────────────────────────────────────────────────────────────
create table public.priority_rules (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  condition_type public.rule_condition not null,
  condition_value jsonb not null,
  outcome public.rule_outcome not null,
  search_body boolean not null default false,
  exceptions jsonb not null default '[]'::jsonb check (jsonb_typeof(exceptions) = 'array'),
  applies_to text not null default 'mail' check (applies_to in ('mail', 'android_notification', 'all')),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  match_count_30d integer not null default 0,
  last_matched_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint priority_rules_pkey primary key (id),
  constraint priority_rules_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint priority_rules_condition_value_check check (private.valid_rule_condition(condition_type, condition_value))
);
create unique index priority_rules_user_id_condition_outcome_key
  on public.priority_rules (user_id, condition_type, md5(condition_value::text), outcome) where deleted_at is null;
create index priority_rules_user_id_enabled_p on public.priority_rules (user_id, enabled) where deleted_at is null;
create trigger trg_priority_rules_updated_at before update on public.priority_rules
  for each row execute function private.set_updated_at();
alter table public.priority_rules enable row level security;
alter table public.priority_rules force row level security;
comment on table public.priority_rules is
  'Explicit rules, the first tier of the priority engine (M§31); soft-deleted for the 10 s "Geri al" window.';

-- ─── learned_preferences ──────────────────────────────────────────────────────────────────────
create table public.learned_preferences (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  group_key text not null check (group_key in ('people', 'topics', 'timing', 'tone', 'categories')),
  statement text not null check (char_length(statement) between 1 and 200),
  target_type text not null check (target_type in ('contact', 'sender', 'domain', 'category', 'topic', 'setting')),
  target_ref text not null,
  effect jsonb not null check (jsonb_typeof(effect) = 'object'),
  priority_override text check (priority_override in ('high', 'normal', 'low')),
  evidence_count integer not null default 0,
  evidence_summary text check (char_length(evidence_summary) <= 200),
  origin text not null default 'learned' check (origin in ('learned', 'user', 'onboarding', 'settings')),
  enabled boolean not null default true,
  deleted_at timestamptz,
  source_type public.source_type not null default 'ai_feedback',
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learned_preferences_pkey primary key (id),
  constraint learned_preferences_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  -- Tombstones (deleted_at set) are included, so a deleted preference is never re-learned.
  constraint learned_preferences_user_id_target_type_target_ref_group_key_key
    unique (user_id, target_type, target_ref, group_key),
  constraint learned_preferences_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index learned_preferences_user_id_enabled_p on public.learned_preferences (user_id, enabled)
  where deleted_at is null;
create trigger trg_learned_preferences_updated_at before update on public.learned_preferences
  for each row execute function private.set_updated_at();
alter table public.learned_preferences enable row level security;
alter table public.learned_preferences force row level security;
comment on table public.learned_preferences is
  'AI-learned personalization, separate from explicit rules (M§32); written only while learn_from_interactions is on.';

-- ─── insights ─────────────────────────────────────────────────────────────────────────────────
create table public.insights (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  kind public.insight_kind not null,
  urgency public.urgency not null default 'normal',
  status public.item_status not null default 'open',
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 600),
  why_important text check (char_length(why_important) <= 300),
  decision_tier public.decision_tier not null,
  reason_code text not null check (reason_code ~ '^[a-z_]{3,48}$'),
  rule_id uuid,
  learned_preference_id uuid,
  entity_type text not null check (entity_type in (
    'email_thread', 'email_message', 'calendar_event', 'commitment', 'life_event', 'task', 'capture',
    'approval_action', 'contact', 'briefing')),
  entity_id uuid not null,
  flow_card_type public.flow_card_type,
  actions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(actions) = 'array' and private.jsonb_array_len(actions) <= 2),
  due_at timestamptz,
  event_at timestamptz,
  rank_score numeric(8, 4) not null default 0,
  snoozed_until timestamptz,
  done_at timestamptz,
  dismissed_at timestamptz,
  suppression_key text,
  user_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(user_overrides) = 'object'),
  dedupe_key text not null,
  source_type public.source_type not null,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(evidence)),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insights_pkey primary key (id),
  constraint insights_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint insights_rule_id_fkey foreign key (rule_id) references public.priority_rules (id) on delete set null,
  constraint insights_learned_preference_id_fkey foreign key (learned_preference_id)
    references public.learned_preferences (id) on delete set null,
  constraint insights_user_id_dedupe_key_key unique (user_id, dedupe_key),
  constraint insights_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index insights_user_id_urgency_rank_score_p on public.insights (user_id, urgency, rank_score desc)
  where status = 'open';
create index insights_user_id_kind_created_at_idx on public.insights (user_id, kind, created_at desc);
create index insights_user_id_due_at_p on public.insights (user_id, due_at) where status in ('open', 'snoozed');
create index insights_user_id_entity_type_entity_id_idx on public.insights (user_id, entity_type, entity_id);
create index insights_user_id_suppression_key_p on public.insights (user_id, suppression_key)
  where suppression_key is not null;
create index insights_snoozed_until_p on public.insights (snoozed_until) where status = 'snoozed';
create index insights_expires_at_idx on public.insights (expires_at);
create index insights_rule_id_idx on public.insights (rule_id);
create index insights_learned_preference_id_idx on public.insights (learned_preference_id);
create trigger trg_insights_updated_at before update on public.insights
  for each row execute function private.set_updated_at();
create trigger trg_insights_set_expires_at before insert on public.insights
  for each row execute function private.set_expires_at('event_at', 'due_at', 'created_at');
alter table public.insights enable row level security;
alter table public.insights force row level security;
comment on table public.insights is
  'Every user-facing AI or deterministic finding for Today, Flow, follow-ups, conflicts and schedule suggestions, with provenance (M§8, §13, §131).';

-- ─── briefings ────────────────────────────────────────────────────────────────────────────────
create table public.briefings (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  kind public.briefing_kind not null,
  local_date date not null,
  time_zone text not null,
  scheduled_for timestamptz not null,
  status public.briefing_status not null default 'scheduled',
  skipped_reason text
    check (skipped_reason in ('no_meaningful_delta', 'disabled', 'not_entitled', 'no_sources', 'weekday_off', 'flag_off')),
  generated_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  failed_at timestamptz,
  error_code text,
  headline text check (char_length(headline) <= 200),
  hero_line text check (char_length(hero_line) <= 200),
  narrative text check (char_length(narrative) <= 3000),
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  audio_status text not null default 'none' check (audio_status in ('none', 'queued', 'generating', 'ready', 'failed')),
  audio_engine text check (audio_engine in ('premium_tts', 'native_tts')),
  audio_storage_path text,
  audio_duration_s integer,
  audio_chapters jsonb not null default '[]'::jsonb check (jsonb_typeof(audio_chapters) = 'array'),
  evening_ready_at timestamptz,
  origin text not null default 'scheduled' check (origin in ('scheduled', 'onboarding', 'retry')),
  version integer not null default 1,
  source_freshness jsonb not null default '{}'::jsonb check (jsonb_typeof(source_freshness) = 'object'),
  weekly_stats jsonb,
  idempotency_key text not null,
  job_id uuid,
  prompt_version_id uuid,
  ai_cost_usd_micros bigint not null default 0,
  latency_ms integer,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint briefings_pkey primary key (id),
  constraint briefings_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint briefings_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete set null,
  constraint briefings_user_id_kind_local_date_key unique (user_id, kind, local_date),
  constraint briefings_idempotency_key_key unique (idempotency_key),
  constraint briefings_weekly_stats_check check (kind = 'weekly' or weekly_stats is null)
);
create index briefings_user_id_kind_local_date_idx on public.briefings (user_id, kind, local_date desc);
create index briefings_status_scheduled_for_idx on public.briefings (status, scheduled_for);
create index briefings_kind_status_local_date_idx on public.briefings (kind, status, local_date);
create index briefings_prompt_version_id_idx on public.briefings (prompt_version_id);
create trigger trg_briefings_updated_at before update on public.briefings
  for each row execute function private.set_updated_at();
create trigger trg_briefings_set_expires_at before insert on public.briefings
  for each row execute function private.set_expires_at('scheduled_for');
alter table public.briefings enable row level security;
alter table public.briefings force row level security;
comment on table public.briefings is
  'Morning, midday, evening and weekly briefings incl. audio and weekly stats (M§9–12, §54); one per (user, kind, local_date).';

-- ─── briefing_items ───────────────────────────────────────────────────────────────────────────
create table public.briefing_items (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  briefing_id uuid not null,
  section text not null check (section in (
    'priorities', 'schedule', 'awaiting_me', 'awaiting_them', 'deadlines', 'life', 'completed', 'carry_over',
    'follow_up', 'tomorrow_first', 'midday_delta', 'weekly_highlight', 'weekly_outlook')),
  position smallint not null,
  insight_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  title text not null check (char_length(title) <= 200),
  meta text check (char_length(meta) <= 200),
  badge text check (badge in (
    'urgent', 'deadline', 'follow_up', 'meeting', 'today', 'shipment', 'flight', 'reservation', 'payment',
    'subscription', 'security', 'personal', 'commitment')),
  carried_over_to date,
  done_at timestamptz,
  source_type public.source_type not null,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(evidence)),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint briefing_items_pkey primary key (id),
  constraint briefing_items_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint briefing_items_briefing_id_fkey foreign key (briefing_id) references public.briefings (id) on delete cascade,
  constraint briefing_items_insight_id_fkey foreign key (insight_id) references public.insights (id) on delete set null,
  constraint briefing_items_briefing_id_section_position_key unique (briefing_id, section, position),
  constraint briefing_items_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index briefing_items_user_id_entity_type_entity_id_idx on public.briefing_items (user_id, entity_type, entity_id);
create index briefing_items_insight_id_idx on public.briefing_items (insight_id);
create trigger trg_briefing_items_set_expires_at before insert on public.briefing_items
  for each row execute function private.set_expires_at();   -- follows the parent briefing
alter table public.briefing_items enable row level security;
alter table public.briefing_items force row level security;
comment on table public.briefing_items is 'Source-linked lines of a briefing (M§9, §97).';

-- ─── reply_drafts ─────────────────────────────────────────────────────────────────────────────
create table public.reply_drafts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  thread_id uuid not null,
  message_id uuid,
  connected_account_id uuid not null,
  kind text not null default 'reply' check (kind in ('reply', 'follow_up')),
  tone text not null check (tone in ('short', 'professional', 'friendly', 'detailed')),
  to_emails extensions.citext[] not null,
  cc_emails extensions.citext[] not null default '{}',
  subject text check (char_length(subject) <= 300),
  body text not null check (char_length(body) between 1 and 10000),
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'sent', 'discarded', 'failed')),
  generated_by text not null check (generated_by in ('ai', 'user_edit')),
  approval_action_id uuid,                            -- FK → approval_actions (0006)
  ai_request_id uuid,
  prompt_version_id uuid,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array' and private.jsonb_array_len(attachments) <= 5),
  source_type public.source_type not null default 'email_thread',
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reply_drafts_pkey primary key (id),
  constraint reply_drafts_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint reply_drafts_thread_id_fkey foreign key (thread_id) references public.email_threads (id) on delete cascade,
  constraint reply_drafts_message_id_fkey foreign key (message_id) references public.email_messages (id) on delete set null,
  constraint reply_drafts_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint reply_drafts_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete set null,
  constraint reply_drafts_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create unique index reply_drafts_approval_action_id_key on public.reply_drafts (approval_action_id)
  where approval_action_id is not null;
create index reply_drafts_user_id_thread_id_created_at_idx on public.reply_drafts (user_id, thread_id, created_at desc);
create index reply_drafts_thread_id_idx on public.reply_drafts (thread_id);
create index reply_drafts_message_id_idx on public.reply_drafts (message_id);
create index reply_drafts_connected_account_id_idx on public.reply_drafts (connected_account_id);
create index reply_drafts_prompt_version_id_idx on public.reply_drafts (prompt_version_id);
create trigger trg_reply_drafts_updated_at before update on public.reply_drafts
  for each row execute function private.set_updated_at();
create trigger trg_reply_drafts_set_expires_at before insert or update of status on public.reply_drafts
  for each row execute function private.set_expires_at('updated_at');
alter table public.reply_drafts enable row level security;
alter table public.reply_drafts force row level security;
comment on table public.reply_drafts is
  'AI reply and follow-up drafts kept in our DB (no provider drafts, no gmail.compose; ADR-07, M§16–17).';

-- ─── ai_feedback ──────────────────────────────────────────────────────────────────────────────
create table public.ai_feedback (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  feature public.ai_feature not null,
  target_type text not null check (target_type in (
    'insight', 'email_thread', 'email_message', 'briefing', 'briefing_item', 'assistant_message', 'reply_draft',
    'meeting_prep', 'capture', 'approval_action', 'learned_preference', 'life_event', 'commitment')),
  target_id uuid not null,
  rating smallint not null check (rating in (-1, 1)),
  reason_code text check (reason_code in (
    'not_important', 'wrong_category', 'wrong_date', 'wrong_person', 'wrong_amount', 'wrong_type',
    'not_a_commitment', 'inaccurate', 'show_more', 'make_vip', 'stop_tracking', 'never_show', 'helpful', 'other')),
  comment text check (char_length(comment) <= 500),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  client_mutation_id uuid,
  model text,
  prompt_version_id uuid,
  ai_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_feedback_pkey primary key (id),
  constraint ai_feedback_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint ai_feedback_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete set null,
  constraint ai_feedback_user_id_feature_target_type_target_id_key unique (user_id, feature, target_type, target_id)
);
create unique index ai_feedback_user_id_client_mutation_id_key on public.ai_feedback (user_id, client_mutation_id)
  where client_mutation_id is not null;
create index ai_feedback_feature_created_at_idx on public.ai_feedback (feature, created_at);
create index ai_feedback_prompt_version_id_idx on public.ai_feedback (prompt_version_id);
create trigger trg_ai_feedback_updated_at before update on public.ai_feedback
  for each row execute function private.set_updated_at();
alter table public.ai_feedback enable row level security;
alter table public.ai_feedback force row level security;
comment on table public.ai_feedback is
  'Thumbs, "Önemli değil" and correction signals (M§32, §59); learned preferences derive from these rows.';

-- ─── ai_requests (SYS) ────────────────────────────────────────────────────────────────────────
create table public.ai_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  plan text check (plan in ('free', 'pro')),
  profile public.routing_profile,
  feature public.ai_feature not null,
  tier public.ai_tier,
  provider text not null
    check (provider in ('anthropic', 'openai', 'voyage', 'deepgram', 'azure_speech', 'elevenlabs', 'fixture', 'native')),
  model text not null,
  prompt_version_id uuid,
  schema_name text,
  schema_hash text,
  feature_variant text check (char_length(feature_variant) <= 40),
  operation text not null check (operation in ('generate', 'embed', 'transcribe', 'synthesize', 'probe')),
  batch boolean not null default false,
  batch_id text,
  status text not null check (status in (
    'ok', 'error', 'refused', 'timeout', 'budget_blocked', 'killed', 'cached', 'validation_failed',
    'grounding_partial', 'grounding_failed')),
  error_code text,
  http_status smallint,
  provider_request_id text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_write_1h_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  audio_seconds numeric(10, 2),
  characters integer,
  units_charged smallint not null default 0,
  latency_ms integer not null,
  ttft_ms integer,
  retry_count smallint not null default 0,
  fallback_used boolean not null default false,
  fallback_from_model text,
  inference_geo text,
  cost_usd_micros bigint not null default 0,
  source_type public.source_type,
  source_count smallint,
  content_hash bytea,
  grounding_proposed smallint,
  grounding_verified smallint,
  grounding_dropped smallint,
  citation_coverage numeric(4, 3),
  injection_suspected boolean not null default false,
  correlation_id uuid,
  job_id uuid,
  created_at timestamptz not null default now(),
  constraint ai_requests_pkey primary key (id),
  constraint ai_requests_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null,
  constraint ai_requests_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete set null
);
create index ai_requests_created_at_idx on public.ai_requests (created_at);
create index ai_requests_feature_created_at_idx on public.ai_requests (feature, created_at);
create index ai_requests_model_created_at_idx on public.ai_requests (model, created_at);
create index ai_requests_provider_model_created_at_p on public.ai_requests (provider, model, created_at)
  where status in ('error', 'timeout');
create index ai_requests_user_id_created_at_p on public.ai_requests (user_id, created_at) where user_id is not null;
create index ai_requests_correlation_id_idx on public.ai_requests (correlation_id);
create index ai_requests_prompt_version_id_idx on public.ai_requests (prompt_version_id);
alter table public.ai_requests enable row level security;
alter table public.ai_requests force row level security;
comment on table public.ai_requests is
  'Per-call AI telemetry without any content (ADR-08, M§56, §82, §126). System table.';

-- ─── ai_usage_daily ───────────────────────────────────────────────────────────────────────────
create table public.ai_usage_daily (
  user_id uuid not null,
  local_date date not null,
  feature public.ai_feature not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd_micros bigint not null default 0,
  units_used integer not null default 0,
  reserved_usd_micros bigint not null default 0 check (reserved_usd_micros >= 0),
  reserved_units integer not null default 0 check (reserved_units >= 0),
  updated_at timestamptz not null default now(),
  constraint ai_usage_daily_pkey primary key (user_id, local_date, feature),
  constraint ai_usage_daily_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create index ai_usage_daily_local_date_idx on public.ai_usage_daily (local_date);
create trigger trg_ai_usage_daily_updated_at before update on public.ai_usage_daily
  for each row execute function private.set_updated_at();
alter table public.ai_usage_daily enable row level security;
alter table public.ai_usage_daily force row level security;
comment on table public.ai_usage_daily is
  'Per-user AI budget accounting on the local day (Free "AI analiz limiti 50/gün"; Pro "Adil kullanım").';

-- ─── Covered-model exclusion (ADR-44, R-02) ───────────────────────────────────────────────────
-- Covered Models (the Fable and Mythos families) need mandatory 30-day retention, which conflicts
-- with the privacy copy, so they are never routable: not as primary, fallback or escalation.
create function private.model_routable(p_model text) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(
      lower(p_model) not like 'claude-fable-%'
      and lower(p_model) not like 'claude-mythos-%', false)
  $$;

create function private.targets_routable(p_fallbacks jsonb, p_escalation jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p_fallbacks is null or jsonb_typeof(p_fallbacks) <> 'array' then false
      when jsonb_array_length(p_fallbacks) > 4 then false
      when exists (
        select 1 from jsonb_array_elements(p_fallbacks) as t (target)
        where case
          when jsonb_typeof(t.target) <> 'object' then true
          when jsonb_typeof(t.target -> 'provider') is distinct from 'string' then true
          when jsonb_typeof(t.target -> 'model') is distinct from 'string' then true
          else not private.model_routable(t.target ->> 'model')
        end) then false
      when p_escalation is null or jsonb_typeof(p_escalation) = 'null' then true
      when jsonb_typeof(p_escalation) <> 'object' then false
      when jsonb_typeof(p_escalation -> 'model') is distinct from 'string' then false
      else private.model_routable(p_escalation ->> 'model')
    end
  $$;
revoke execute on function private.model_routable(text), private.targets_routable(jsonb, jsonb) from public;
grant execute on function private.model_routable(text), private.targets_routable(jsonb, jsonb) to service_role;

-- ─── ai_model_config (SYS + restrictive aal2 in 0014) ─────────────────────────────────────────
create table public.ai_model_config (
  id uuid not null default gen_random_uuid(),
  profile public.routing_profile not null default 'balanced',
  role text not null check (role in ('classifier', 'reasoning', 'assistant', 'embedding', 'stt', 'tts', 'probe')),
  feature public.ai_feature not null,
  tier public.ai_tier not null,
  provider text not null
    check (provider in ('anthropic', 'openai', 'voyage', 'deepgram', 'azure_speech', 'elevenlabs', 'fixture', 'native')),
  model text not null check (char_length(model) between 1 and 120),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  fallback_targets jsonb not null default '[]'::jsonb,
  escalation_target jsonb,
  batch_policy text not null default 'never' check (batch_policy in ('never', 'non_urgent', 'always')),
  cache_ttl text check (cache_ttl in ('5m', '1h')),
  max_input_tokens integer not null check (max_input_tokens between 1 and 200000),
  eval_status text not null default 'missing' check (eval_status in ('passed', 'failed', 'missing')),
  retires_not_before date,
  enabled boolean not null default true,
  version integer not null default 1,
  updated_by uuid,                                    -- FK → admin_users (0012)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_config_pkey primary key (id),
  constraint ai_model_config_profile_role_feature_key unique (profile, role, feature),
  constraint ai_model_config_covered_model_check
    check (private.model_routable(model) and private.targets_routable(fallback_targets, escalation_target))
);
create index ai_model_config_feature_profile_idx on public.ai_model_config (feature, profile);
create index ai_model_config_retires_not_before_p on public.ai_model_config (retires_not_before)
  where retires_not_before is not null;
create trigger trg_ai_model_config_updated_at before update on public.ai_model_config
  for each row execute function private.set_updated_at();
alter table public.ai_model_config enable row level security;
alter table public.ai_model_config force row level security;
comment on table public.ai_model_config is
  'Backoffice-editable routing per (profile, role, feature) (R-02, R-18); model IDs are config, never code. System table.';

-- Optimistic concurrency and eval gate (§7 trg_ai_model_config_version): every update bumps
-- version; a new primary target (provider/model change) needs eval_status = 'passed'.
create function private.bump_ai_model_config_version() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if (new.provider, new.model) is distinct from (old.provider, old.model) and new.eval_status <> 'passed' then
    raise exception 'EVAL_REQUIRED' using errcode = '55000';
  end if;
  new.version := old.version + 1;
  return new;
end
$$;
revoke execute on function private.bump_ai_model_config_version() from public;

create trigger trg_ai_model_config_version before update on public.ai_model_config
  for each row execute function private.bump_ai_model_config_version();

-- ─── ai_result_cache (SYS) ────────────────────────────────────────────────────────────────────
create table public.ai_result_cache (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  feature public.ai_feature not null,
  content_hash bytea not null check (octet_length(content_hash) = 32),
  prompt_version_id uuid not null,
  model text not null,
  result jsonb not null,
  hit_count integer not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint ai_result_cache_pkey primary key (id),
  constraint ai_result_cache_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint ai_result_cache_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete cascade,
  constraint ai_result_cache_user_id_feature_content_hash_prompt_version_id_key
    unique (user_id, feature, content_hash, prompt_version_id)
);
create index ai_result_cache_expires_at_p on public.ai_result_cache (expires_at) where expires_at is not null;
create index ai_result_cache_prompt_version_id_idx on public.ai_result_cache (prompt_version_id);
create trigger trg_ai_result_cache_set_expires_at before insert on public.ai_result_cache
  for each row execute function private.set_expires_at('created_at');
alter table public.ai_result_cache enable row level security;
alter table public.ai_result_cache force row level security;
comment on table public.ai_result_cache is
  'Per-user dedupe of validated, grounded AI results keyed by a per-user HMAC content hash (R-02, M§82). System table.';

-- ─── ai_budget_reservations (SYS) ─────────────────────────────────────────────────────────────
create table public.ai_budget_reservations (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  local_date date not null,
  feature public.ai_feature not null,
  est_cost_usd_micros bigint not null check (est_cost_usd_micros >= 0),
  units smallint not null default 0 check (units >= 0),
  level text not null check (level in ('l0', 'l1', 'l2')),
  hold_until timestamptz not null default now() + interval '15 minutes',
  settled_at timestamptz,
  ai_request_id uuid,
  created_at timestamptz not null default now(),
  constraint ai_budget_reservations_pkey primary key (id),
  constraint ai_budget_reservations_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create index ai_budget_reservations_hold_until_p on public.ai_budget_reservations (hold_until) where settled_at is null;
create index ai_budget_reservations_user_id_local_date_idx on public.ai_budget_reservations (user_id, local_date);
alter table public.ai_budget_reservations enable row level security;
alter table public.ai_budget_reservations force row level security;
comment on table public.ai_budget_reservations is
  'Open budget holds between ai_budget_reserve and ai_budget_settle so concurrent calls cannot overshoot caps. System table.';

-- ─── ai_model_prices (SYS + restrictive aal2 in 0014) ─────────────────────────────────────────
create table public.ai_model_prices (
  id uuid not null default gen_random_uuid(),
  provider text not null,
  model text not null,
  input_per_mtok_usd numeric(12, 6) not null,
  output_per_mtok_usd numeric(12, 6) not null,
  cache_write_5m_per_mtok_usd numeric(12, 6),
  cache_write_1h_per_mtok_usd numeric(12, 6),
  cache_read_per_mtok_usd numeric(12, 6),
  batch_discount numeric(4, 3) not null default 0.5,
  audio_per_min_usd numeric(12, 6),
  chars_per_million_usd numeric(12, 6),
  effective_from timestamptz not null,
  updated_by uuid,                                    -- FK → admin_users (0012)
  created_at timestamptz not null default now(),
  constraint ai_model_prices_pkey primary key (id),
  constraint ai_model_prices_provider_model_effective_from_key unique (provider, model, effective_from)
);
create index ai_model_prices_provider_model_effective_from_idx
  on public.ai_model_prices (provider, model, effective_from desc);
alter table public.ai_model_prices enable row level security;
alter table public.ai_model_prices force row level security;
comment on table public.ai_model_prices is
  'Provider price book feeding ai_requests.cost_usd_micros and budget estimates (AI_PIPELINE_PLAN §8.13). System table.';

-- ─── ai_calibration_versions (SYS + restrictive aal2 in 0014) ─────────────────────────────────
create table public.ai_calibration_versions (
  id uuid not null default gen_random_uuid(),
  feature public.ai_feature not null,
  field text not null check (char_length(field) <= 60),
  version integer not null,
  method text not null check (method in ('isotonic', 'platt', 'logistic_isotonic')),
  params jsonb not null,
  ece numeric(5, 4),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  activated_by uuid,                                  -- FK → admin_users (0012)
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_calibration_versions_pkey primary key (id),
  constraint ai_calibration_versions_feature_field_version_key unique (feature, field, version)
);
create unique index ai_calibration_versions_feature_field_active_key on public.ai_calibration_versions (feature, field)
  where status = 'active';
alter table public.ai_calibration_versions enable row level security;
alter table public.ai_calibration_versions force row level security;
comment on table public.ai_calibration_versions is
  'Confidence-calibration models per feature and field (AI_PIPELINE_PLAN §6.7), refit weekly by ai_eval. System table.';

-- ─── ai_batches (SYS) ─────────────────────────────────────────────────────────────────────────
create table public.ai_batches (
  id uuid not null default gen_random_uuid(),
  provider text not null default 'anthropic',
  batch_id text not null,
  feature public.ai_feature not null,
  status text not null check (status in ('submitted', 'in_progress', 'ended', 'collected', 'purged', 'failed', 'expired')),
  request_count integer not null,
  submitted_at timestamptz not null,
  ended_at timestamptz,
  collected_at timestamptz,
  purged_at timestamptz,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  constraint ai_batches_pkey primary key (id),
  constraint ai_batches_provider_batch_id_key unique (provider, batch_id)
);
create index ai_batches_status_p on public.ai_batches (status) where status in ('submitted', 'in_progress', 'ended');
alter table public.ai_batches enable row level security;
alter table public.ai_batches force row level security;
comment on table public.ai_batches is
  'Message Batch lifecycle for non-urgent AI work (submit, collect, purge; AI_PIPELINE_PLAN §8.8). System table.';

-- ─── Forward references from 0004 ─────────────────────────────────────────────────────────────
alter table public.email_threads
  add constraint email_threads_category_rule_id_fkey foreign key (category_rule_id)
    references public.priority_rules (id) on delete set null,
  add constraint email_threads_category_learned_preference_id_fkey foreign key (category_learned_preference_id)
    references public.learned_preferences (id) on delete set null,
  add constraint email_threads_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete set null;
alter table public.email_messages
  add constraint email_messages_classification_rule_id_fkey foreign key (classification_rule_id)
    references public.priority_rules (id) on delete set null,
  add constraint email_messages_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete set null;
alter table public.meeting_preps
  add constraint meeting_preps_prompt_version_id_fkey foreign key (prompt_version_id)
    references public.prompt_versions (id) on delete set null;

-- ─── Reference data ───────────────────────────────────────────────────────────────────────────
-- >>> BEGIN SEED BLOCK supabase/seed/ai_model_config.sql
-- AI routing defaults (AI_PIPELINE_PLAN §3.3 balanced table, §3.4 lean overrides, §3.6 shape;
-- DATABASE_AND_RLS_PLAN §4.4). One row per (profile, role, feature); capture_extract has a
-- classifier row (text/link, T1) and a reasoning row (vision/PDF, T2 with T3 escalation).
-- Model IDs live only here and in ai_model_prices.sql (AI_PIPELINE_PLAN §3.7); migration 0005
-- embeds this file verbatim (scripts/db/sync-seed-blocks.sh). Rows are inserted once and are
-- then owned by the backoffice (/ai/models, audited): re-running never overwrites an edit.
-- eval_status starts at 'missing': activation of a new primary requires a passing eval run.
insert into public.ai_model_config
  (profile, role, feature, tier, provider, model, params, fallback_targets, escalation_target,
   batch_policy, cache_ttl, max_input_tokens, retires_not_before, enabled)
values
  -- ── balanced (plan default; Pro) ──────────────────────────────────────────────────────────
  ('balanced', 'classifier', 'email_triage', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":1500,"timeout_ms":20000}',
   '[{"provider":"anthropic","model":"claude-sonnet-5","params":{"thinking":{"type":"disabled"},"effort":"low","max_output_tokens":1500,"timeout_ms":20000}},
     {"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":1500,"timeout_ms":20000}}]',
   null, 'non_urgent', '5m', 12000, '2026-10-15', true),
  ('balanced', 'reasoning', 'thread_summary', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":1200,"timeout_ms":45000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":1200,"timeout_ms":45000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":1200,"timeout_ms":45000}}]',
   null, 'never', '5m', 8000, '2027-06-30', true),
  ('balanced', 'reasoning', 'email_deep_extract', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":2500,"timeout_ms":45000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":2500,"timeout_ms":45000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":2500,"timeout_ms":45000}}]',
   null, 'non_urgent', '5m', 8000, '2027-06-30', true),
  ('balanced', 'classifier', 'commitment_extract', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":1200,"timeout_ms":20000}',
   '[{"provider":"anthropic","model":"claude-sonnet-5","params":{"thinking":{"type":"disabled"},"effort":"low","max_output_tokens":1200,"timeout_ms":20000}},
     {"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":1200,"timeout_ms":20000}}]',
   null, 'non_urgent', '5m', 8000, '2026-10-15', true),
  ('balanced', 'classifier', 'life_intel_extract', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":1500,"timeout_ms":20000}',
   '[{"provider":"anthropic","model":"claude-sonnet-5","params":{"thinking":{"type":"disabled"},"effort":"low","max_output_tokens":1500,"timeout_ms":20000}},
     {"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":1500,"timeout_ms":20000}}]',
   null, 'non_urgent', '5m', 8000, '2026-10-15', true),
  ('balanced', 'reasoning', 'briefing_morning', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":2000,"timeout_ms":60000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":2000,"timeout_ms":60000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":2000,"timeout_ms":60000}}]',
   null, 'never', '5m', 8000, '2027-06-30', true),
  ('balanced', 'reasoning', 'briefing_midday', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":600,"timeout_ms":20000}', '[]', null, 'never', '5m', 4000, '2026-10-15', true),
  ('balanced', 'reasoning', 'briefing_evening', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":600,"timeout_ms":20000}', '[]', null, 'never', '5m', 4000, '2026-10-15', true),
  ('balanced', 'reasoning', 'weekly_review', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":1500,"timeout_ms":60000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":1500,"timeout_ms":60000}}]',
   null, 'always', '1h', 10000, '2027-06-30', true),
  ('balanced', 'reasoning', 'meeting_prep', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"medium","max_output_tokens":3000,"timeout_ms":60000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":3000,"timeout_ms":60000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":3000,"timeout_ms":60000}}]',
   null, 'never', '5m', 12000, '2027-06-30', true),
  ('balanced', 'classifier', 'post_meeting_parse', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":800,"timeout_ms":15000}',
   '[{"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":800,"timeout_ms":15000}}]',
   null, 'never', '5m', 6000, '2026-10-15', true),
  ('balanced', 'classifier', 'capture_extract', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":2000,"timeout_ms":45000}',
   '[{"provider":"anthropic","model":"claude-sonnet-5","params":{"thinking":{"type":"disabled"},"effort":"low","max_output_tokens":2000,"timeout_ms":45000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":2000,"timeout_ms":45000}}]',
   null, 'never', '5m', 8000, '2026-10-15', true),
  ('balanced', 'reasoning', 'capture_extract', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":4000,"timeout_ms":90000}',
   '[{"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":4000,"timeout_ms":90000}}]',
   '{"provider":"anthropic","model":"claude-opus-5-5","params":{"effort":"low","max_output_tokens":4000,"timeout_ms":90000}}',
   'never', '5m', 16000, '2027-06-30', true),
  ('balanced', 'classifier', 'assistant_intent', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":400,"timeout_ms":8000}',
   '[{"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":400,"timeout_ms":8000}}]',
   null, 'never', '5m', 6000, '2026-10-15', true),
  ('balanced', 'assistant', 'assistant_qa', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":1500,"timeout_ms":45000,"ttft_timeout_ms":8000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":1500,"timeout_ms":45000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":1500,"timeout_ms":45000}}]',
   '{"provider":"anthropic","model":"claude-opus-5-5","params":{"effort":"low","max_output_tokens":1500,"timeout_ms":45000}}',
   'never', '5m', 16000, '2027-06-30', true),
  ('balanced', 'reasoning', 'reply_draft', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":2500,"timeout_ms":45000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":2500,"timeout_ms":45000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":2500,"timeout_ms":45000}}]',
   null, 'never', '5m', 8000, '2027-06-30', true),
  ('balanced', 'reasoning', 'follow_up_draft', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":800,"timeout_ms":30000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":800,"timeout_ms":30000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":800,"timeout_ms":30000}}]',
   null, 'never', '5m', 6000, '2027-06-30', true),
  ('balanced', 'embedding', 'embedding_doc', 't1', 'voyage', 'voyage-4',
   '{"input_type":"document","output_dimension":1024,"timeout_ms":20000}', '[]', null, 'non_urgent', null, 32000, null, true),
  ('balanced', 'embedding', 'embedding_query', 't1', 'voyage', 'voyage-4-lite',
   '{"input_type":"query","output_dimension":1024,"timeout_ms":20000}', '[]', null, 'never', null, 32000, null, true),
  ('balanced', 'stt', 'stt', 't1', 'openai', 'gpt-transcribe',
   '{"language":"tr","timeout_ms":30000}',
   '[{"provider":"deepgram","model":"nova-3","params":{"language":"tr","timeout_ms":30000}}]',
   null, 'never', null, 16000, null, true),
  ('balanced', 'tts', 'tts', 't1', 'openai', 'gpt-4o-mini-tts',
   '{"timeout_ms":30000}', '[]', null, 'never', null, 16000, null, true),
  -- ── lean (Free default; AI_PIPELINE_PLAN §3.4) ────────────────────────────────────────────
  ('lean', 'classifier', 'email_triage', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":1500,"timeout_ms":20000}',
   '[{"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":1500,"timeout_ms":20000}}]',
   null, 'non_urgent', '5m', 12000, '2026-10-15', true),
  ('lean', 'reasoning', 'thread_summary', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":1200,"timeout_ms":45000}',
   '[{"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":1200,"timeout_ms":45000}}]',
   null, 'never', '5m', 8000, '2026-10-15', true),
  ('lean', 'reasoning', 'email_deep_extract', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":2500,"timeout_ms":45000}',
   '[{"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":2500,"timeout_ms":45000}}]',
   null, 'non_urgent', '5m', 8000, '2026-10-15', true),
  ('lean', 'classifier', 'commitment_extract', 't1', 'openai', 'gpt-5.6-luna',
   '{"effort":"minimal","max_output_tokens":1200,"timeout_ms":20000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":1200,"timeout_ms":20000}}]',
   null, 'non_urgent', '5m', 8000, null, true),
  ('lean', 'classifier', 'life_intel_extract', 't1', 'openai', 'gpt-5.6-luna',
   '{"effort":"minimal","max_output_tokens":1500,"timeout_ms":20000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":1500,"timeout_ms":20000}}]',
   null, 'non_urgent', '5m', 8000, null, true),
  ('lean', 'reasoning', 'briefing_morning', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":2000,"timeout_ms":60000}', '[]', null, 'never', '5m', 8000, '2026-10-15', true),
  ('lean', 'reasoning', 'briefing_midday', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":600,"timeout_ms":20000}', '[]', null, 'never', '5m', 4000, '2026-10-15', false),
  ('lean', 'reasoning', 'briefing_evening', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":600,"timeout_ms":20000}', '[]', null, 'never', '5m', 4000, '2026-10-15', false),
  ('lean', 'reasoning', 'weekly_review', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":1500,"timeout_ms":60000}', '[]', null, 'always', '1h', 10000, '2026-10-15', true),
  ('lean', 'reasoning', 'meeting_prep', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"medium","max_output_tokens":3000,"timeout_ms":60000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":3000,"timeout_ms":60000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":3000,"timeout_ms":60000}}]',
   null, 'never', '5m', 12000, '2027-06-30', true),
  ('lean', 'classifier', 'post_meeting_parse', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":800,"timeout_ms":15000}',
   '[{"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":800,"timeout_ms":15000}}]',
   null, 'never', '5m', 6000, '2026-10-15', true),
  ('lean', 'classifier', 'capture_extract', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":2000,"timeout_ms":45000}',
   '[{"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":2000,"timeout_ms":45000}}]',
   null, 'never', '5m', 8000, '2026-10-15', true),
  ('lean', 'reasoning', 'capture_extract', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":4000,"timeout_ms":90000}',
   '[{"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":4000,"timeout_ms":90000}}]',
   null, 'never', '5m', 16000, '2027-06-30', true),
  ('lean', 'classifier', 'assistant_intent', 't1', 'openai', 'gpt-5.6-luna',
   '{"effort":"minimal","max_output_tokens":400,"timeout_ms":8000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":400,"timeout_ms":8000}}]',
   null, 'never', '5m', 6000, null, true),
  ('lean', 'assistant', 'assistant_qa', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":1500,"timeout_ms":45000,"ttft_timeout_ms":8000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":1500,"timeout_ms":45000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":1500,"timeout_ms":45000}}]',
   null, 'never', '5m', 16000, '2027-06-30', true),
  ('lean', 'reasoning', 'reply_draft', 't2', 'anthropic', 'claude-sonnet-5',
   '{"thinking":{"type":"adaptive"},"effort":"low","max_output_tokens":2500,"timeout_ms":45000}',
   '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001","params":{"max_output_tokens":2500,"timeout_ms":45000}},
     {"provider":"openai","model":"gpt-5.6-terra","params":{"effort":"low","max_output_tokens":2500,"timeout_ms":45000}}]',
   null, 'never', '5m', 8000, '2027-06-30', true),
  ('lean', 'reasoning', 'follow_up_draft', 't1', 'anthropic', 'claude-haiku-4-5-20251001',
   '{"max_output_tokens":800,"timeout_ms":30000}',
   '[{"provider":"openai","model":"gpt-5.6-luna","params":{"effort":"minimal","max_output_tokens":800,"timeout_ms":30000}}]',
   null, 'never', '5m', 6000, '2026-10-15', true),
  ('lean', 'embedding', 'embedding_doc', 't1', 'voyage', 'voyage-4',
   '{"input_type":"document","output_dimension":1024,"timeout_ms":20000}', '[]', null, 'non_urgent', null, 32000, null, true),
  ('lean', 'embedding', 'embedding_query', 't1', 'voyage', 'voyage-4-lite',
   '{"input_type":"query","output_dimension":1024,"timeout_ms":20000}', '[]', null, 'never', null, 32000, null, true),
  ('lean', 'stt', 'stt', 't1', 'openai', 'gpt-transcribe',
   '{"language":"tr","timeout_ms":30000}',
   '[{"provider":"deepgram","model":"nova-3","params":{"language":"tr","timeout_ms":30000}}]',
   null, 'never', null, 16000, null, true),
  ('lean', 'tts', 'tts', 't1', 'openai', 'gpt-4o-mini-tts',
   '{"timeout_ms":30000}', '[]', null, 'never', null, 16000, null, false)
on conflict (profile, role, feature) do nothing;
-- <<< END SEED BLOCK supabase/seed/ai_model_config.sql

-- >>> BEGIN SEED BLOCK supabase/seed/ai_model_prices.sql
-- AI price book (USD per million tokens / per audio minute / per million characters), feeding
-- ai_requests.cost_usd_micros and budget estimates (AI_PIPELINE_PLAN §0.3, §3.3, §8.13;
-- DATABASE_AND_RLS_PLAN §4.4). Anthropic and Voyage figures were verified on 2026-09-23. OpenAI and
-- Deepgram figures come from secondary summaries (AI_PIPELINE_PLAN §0.3; plan-audits/ai-research):
-- Manual external step — re-verify them on the vendor pages before production seeding and record a
-- new effective_from row through the backoffice (ai.models.write) when a price changes.
-- Migration 0005 embeds this file verbatim (scripts/db/sync-seed-blocks.sh).
insert into public.ai_model_prices
  (provider, model, input_per_mtok_usd, output_per_mtok_usd, cache_write_5m_per_mtok_usd,
   cache_write_1h_per_mtok_usd, cache_read_per_mtok_usd, audio_per_min_usd, chars_per_million_usd, effective_from)
values
  ('anthropic', 'claude-haiku-4-5-20251001', 1.00, 5.00, 1.25, 2.00, 0.10, null, null, '2026-09-23T00:00:00Z'),
  ('anthropic', 'claude-sonnet-5', 2.00, 10.00, 2.50, 4.00, 0.20, null, null, '2026-09-23T00:00:00Z'),
  ('anthropic', 'claude-opus-5-5', 4.00, 20.00, 5.00, 8.00, 0.20, null, null, '2026-09-23T00:00:00Z'),
  ('voyage', 'voyage-4', 0.06, 0.00, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('voyage', 'voyage-4-lite', 0.02, 0.00, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-5.6-luna', 0.20, 1.20, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-5.6-terra', 2.00, 12.00, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-transcribe', 0.00, 0.00, null, null, null, 0.0045, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-4o-mini-tts', 0.00, 0.00, null, null, null, 0.015, null, '2026-09-23T00:00:00Z'),
  ('deepgram', 'nova-3', 0.00, 0.00, null, null, null, 0.0043, null, '2026-09-23T00:00:00Z')
on conflict (provider, model, effective_from) do nothing;
-- <<< END SEED BLOCK supabase/seed/ai_model_prices.sql
