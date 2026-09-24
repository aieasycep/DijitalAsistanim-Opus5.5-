-- pgTAP · schema structure of migrations 0001–0012 (IMPLEMENTATION_PLAN T-2.03 … T-2.14).
-- Tables, RLS enabled + forced, Realtime publication empty (R-19), canonical enums, key uniques
-- (MASTER_PLAN §5), vector(1024) (R-01), FK indexes, triggers, reference data and the table-level
-- acceptance behaviours. Owner-isolation / policy suites come with the RLS migration (T-2.22).
-- Runs on tier C (shim) and tier A (supabase test db) as the database owner; everything is rolled back.
begin;
select plan(156);

-- ─── Tables and views ─────────────────────────────────────────────────────────────────────────
select tables_are(
  'public',
  array[
    'profiles', 'user_preferences', 'notification_preferences', 'app_installations', 'push_tokens',
    'connected_accounts', 'oauth_credentials', 'oauth_states', 'calendars', 'sync_states', 'provider_quota_usage',
    'webhook_events',
    'contacts', 'vip_people', 'email_threads', 'email_messages', 'calendar_events', 'tasks', 'commitments',
    'reminders', 'meeting_notes', 'meeting_preps', 'life_events', 'captures', 'android_notification_signals',
    'prompt_versions', 'priority_rules', 'learned_preferences', 'insights', 'briefings', 'briefing_items',
    'reply_drafts', 'ai_feedback', 'ai_requests', 'ai_usage_daily', 'ai_model_config', 'ai_result_cache',
    'ai_budget_reservations', 'ai_model_prices', 'ai_calibration_versions', 'ai_batches',
    'approval_actions', 'approval_events',
    'assistant_threads', 'assistant_messages', 'memory_chunks',
    'notifications', 'push_tickets',
    'subscriptions', 'billing_events', 'referral_codes', 'referrals', 'entitlement_grants', 'referral_credits',
    'plan_limits',
    'jobs', 'job_attempts', 'analytics_events', 'feature_flags', 'feature_flag_overrides', 'announcements',
    'announcement_dismissals', 'user_feedback', 'system_health_checks', 'rate_limits', 'api_idempotency_keys',
    'app_settings', 'metrics_daily', 'ai_metrics_daily', 'web_analytics_daily',
    'data_export_requests', 'data_deletion_requests', 'privacy_tombstones',
    'admin_users', 'admin_sessions', 'admin_preferences', 'admin_mfa_recovery_codes', 'audit_logs',
    'support_tickets', 'support_notes', 'support_access_grants'
  ],
  'public has exactly the DATABASE_AND_RLS_PLAN §4 tables'
);
select tables_are('private', array['demo_fixture_state', 'admin_role_permissions', 'device_snapshot_uploads'],
                  'private has exactly its tables (device_snapshot_uploads: migration 20260924002000)');
select views_are('public', array['connected_account_sync_health'], 'public has exactly one view');
select ok(
  (select coalesce('security_invoker=true' = any (c.reloptions), false)
   from pg_class c where c.oid = 'public.connected_account_sync_health'::regclass),
  'connected_account_sync_health is security invoker'
);

-- ─── RLS enabled and forced everywhere; no Realtime (R-19) ────────────────────────────────────
select is_empty(
  $$ select c.oid::regclass::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
       and not (c.relrowsecurity and c.relforcerowsecurity) $$,
  'every table in public and private has row level security enabled and forced'
);
select is(
  (select count(*)::integer from pg_publication_tables where schemaname = 'public'),
  0,
  'no public table belongs to any publication (R-19)'
);
select is(
  (select count(*)::integer from pg_publication_tables where pubname = 'supabase_realtime'),
  0,
  'the supabase_realtime publication has no tables (R-19)'
);

-- ─── Enums (DATABASE_AND_RLS_PLAN §2 = packages/domain DB_ENUMS) ──────────────────────────────
select enums_are(
  'public',
  array[
    'provider',
    'capability',
    'account_status',
    'mail_category',
    'decision_tier',
    'insight_kind',
    'urgency',
    'item_status',
    'life_event_type',
    'flow_card_type',
    'commitment_direction',
    'commitment_status',
    'approval_action_type',
    'approval_status',
    'briefing_kind',
    'briefing_status',
    'capture_kind',
    'capture_status',
    'extracted_entity_type',
    'notification_category',
    'notification_detail',
    'notification_decision',
    'job_type',
    'job_status',
    'admin_role',
    'prompt_status',
    'ticket_status',
    'ticket_category',
    'feedback_type',
    'grant_source',
    'retention_policy',
    'source_type',
    'platform',
    'user_state',
    'vip_relationship',
    'rule_condition',
    'rule_outcome',
    'referral_status',
    'referral_side',
    'subscription_status',
    'reminder_status',
    'export_status',
    'deletion_kind',
    'deletion_status',
    'ai_feature',
    'routing_profile',
    'ai_tier',
    'approval_via',
    'support_access_scope',
    'admin_status'
  ],
  'public has exactly the canonical enums (DATABASE_AND_RLS_PLAN §2)'
);
select enum_has_labels('public', 'provider', array['google', 'microsoft', 'apple_device', 'android_device', 'demo']);
select enum_has_labels('public', 'capability', array['mail_read', 'mail_send', 'calendar_read', 'calendar_write', 'tasks_read', 'tasks_write']);
select enum_has_labels('public', 'account_status', array['connecting', 'healthy', 'syncing', 'partial', 'needs_reauth', 'admin_consent_required', 'error', 'disconnected']);
select enum_has_labels('public', 'mail_category', array['important', 'awaiting_my_reply', 'awaiting_their_reply', 'has_deadline', 'informational', 'low_priority']);
select enum_has_labels('public', 'decision_tier', array['explicit_rule', 'learned_preference', 'deterministic_signal', 'ai_classification']);
select enum_has_labels('public', 'insight_kind', array['reply_needed', 'meeting', 'deadline', 'follow_up', 'commitment', 'life_event', 'security', 'conflict', 'schedule_suggestion', 'approval_pending', 'digest']);
select enum_has_labels('public', 'urgency', array['urgent', 'today', 'normal', 'low']);
select enum_has_labels('public', 'item_status', array['open', 'done', 'dismissed', 'snoozed', 'expired']);
select enum_has_labels('public', 'life_event_type', array['shipment', 'flight', 'reservation', 'payment', 'subscription', 'security']);
select enum_has_labels('public', 'flow_card_type', array['email', 'meeting', 'deadline', 'shipment', 'flight', 'reservation', 'payment', 'subscription', 'security', 'follow_up', 'commitment']);
select enum_has_labels('public', 'commitment_direction', array['user_owes', 'they_owe']);
select enum_has_labels('public', 'commitment_status', array['open', 'done', 'snoozed', 'cancelled']);
select enum_has_labels('public', 'approval_action_type', array['email_send', 'calendar_create', 'calendar_update', 'task_create', 'reminder_create', 'commitment_create']);
select enum_has_labels('public', 'approval_status', array['pending', 'approved', 'rejected', 'executing', 'executed', 'failed', 'expired']);
select enum_has_labels('public', 'briefing_kind', array['morning', 'midday', 'evening', 'weekly']);
select enum_has_labels('public', 'briefing_status', array['scheduled', 'generating', 'ready', 'delivered', 'skipped', 'failed']);
select enum_has_labels('public', 'capture_kind', array['photo', 'screenshot', 'pdf', 'file', 'link', 'text', 'share']);
select enum_has_labels('public', 'capture_status', array['pending_upload', 'uploaded', 'analyzing', 'extracted', 'actioned', 'discarded', 'failed']);
select enum_has_labels('public', 'extracted_entity_type', array['event', 'task', 'deadline', 'person', 'payment', 'reservation', 'flight', 'shipment', 'product', 'note']);
select enum_has_labels('public', 'notification_category', array['morning', 'midday', 'evening', 'critical_email', 'meeting', 'deadline', 'follow_up', 'life_intel', 'approval', 'account']);
select enum_has_labels('public', 'notification_detail', array['full', 'title_only', 'generic']);
select enum_has_labels('public', 'notification_decision', array['scheduled', 'sent', 'suppressed', 'deduplicated', 'failed']);
select enum_has_labels('public', 'job_type', array['initial_sync', 'gmail_sync', 'outlook_sync', 'calendar_sync', 'tasks_sync', 'device_calendar_ingest', 'watch_renewal', 'reconciliation', 'provider_webhook', 'email_triage', 'email_analysis', 'insight_refresh', 'first_analysis', 'briefing', 'meeting_prep', 'embedding', 'approval_execute', 'notification', 'push_receipts', 'retention', 'export', 'history_deletion', 'account_deletion', 'billing_sync', 'referral_evaluate', 'health_check', 'capture_analysis', 'credential_reencrypt', 'integration_purge', 'ai_batch', 'ai_eval', 'briefing_audio', 'transactional_email']);
select enum_has_labels('public', 'job_status', array['queued', 'running', 'completed', 'retrying', 'failed', 'dead_letter']);
select enum_has_labels('public', 'admin_role', array['super_admin', 'operations', 'support', 'finance', 'ai_ops', 'analyst', 'readonly']);
select enum_has_labels('public', 'prompt_status', array['draft', 'active', 'archived']);
select enum_has_labels('public', 'ticket_status', array['open', 'in_progress', 'waiting_user', 'resolved', 'closed']);
select enum_has_labels('public', 'ticket_category', array['account', 'integration', 'sync', 'billing', 'ai_quality', 'notification', 'privacy', 'other']);
select enum_has_labels('public', 'feedback_type', array['bug', 'feature', 'general', 'ai_quality']);
select enum_has_labels('public', 'grant_source', array['referral_referrer', 'referral_referee', 'admin', 'support', 'compensation']);
select enum_has_labels('public', 'retention_policy', array['d30', 'd90', 'd365', 'until_deleted']);
select enum_has_labels('public', 'source_type', array['email_message', 'email_thread', 'calendar_event', 'device_calendar_event', 'task', 'capture', 'meeting_note', 'post_meeting_note', 'android_notification', 'assistant_message', 'user_input', 'commitment', 'life_event', 'contact', 'briefing', 'ai_feedback']);
select enum_has_labels('public', 'platform', array['ios', 'android']);
select enum_has_labels('public', 'user_state', array['active', 'disabled', 'deletion_pending']);
select enum_has_labels('public', 'vip_relationship', array['spouse', 'family', 'manager', 'key_client', 'friend', 'other']);
select enum_has_labels('public', 'rule_condition', array['person', 'domain', 'keyword', 'category', 'sender', 'android_app']);
select enum_has_labels('public', 'rule_outcome', array['always_important', 'high', 'low', 'always_notify', 'mute']);
select enum_has_labels('public', 'referral_status', array['pending', 'qualified', 'rewarded', 'rejected', 'flagged']);
select enum_has_labels('public', 'referral_side', array['referrer', 'referee']);
select enum_has_labels('public', 'subscription_status', array['none', 'trial', 'active', 'grace_period', 'billing_issue', 'cancelled', 'paused', 'expired', 'refunded']);
select enum_has_labels('public', 'reminder_status', array['scheduled', 'delivered', 'done', 'cancelled', 'failed']);
select enum_has_labels('public', 'export_status', array['requested', 'processing', 'ready', 'expired', 'failed', 'cancelled']);
select enum_has_labels('public', 'deletion_kind', array['history', 'account']);
select enum_has_labels('public', 'deletion_status', array['requested', 'verified', 'queued', 'processing', 'completed', 'failed', 'cancelled']);
select enum_has_labels('public', 'ai_feature', array['email_triage', 'thread_summary', 'email_deep_extract', 'commitment_extract', 'life_intel_extract', 'briefing_morning', 'briefing_midday', 'briefing_evening', 'weekly_review', 'meeting_prep', 'post_meeting_parse', 'capture_extract', 'assistant_intent', 'assistant_qa', 'reply_draft', 'follow_up_draft', 'embedding_doc', 'embedding_query', 'stt', 'tts', 'admin_probe']);
select enum_has_labels('public', 'routing_profile', array['balanced', 'lean']);
select enum_has_labels('public', 'ai_tier', array['t0', 't1', 't2', 't3']);
select enum_has_labels('public', 'approval_via', array['approval_center', 'inline_sheet', 'voice_card', 'capture_batch', 'in_place']);
select enum_has_labels('public', 'support_access_scope', array['pii', 'email_metadata', 'insights', 'notifications', 'captures', 'assistant_transcript', 'ai_feedback']);
select enum_has_labels('public', 'admin_status', array['invited', 'active', 'disabled']);

-- ─── Key uniques and idempotency (MASTER_PLAN §5 key invariants; R-02, R-18) ──────────────────
create function pg_temp.has_unique_on(p_table text, p_cols text[]) returns boolean
  language sql stable
  as $$
    select exists (
      select 1
      from pg_index i
      where i.indrelid = ('public.' || p_table)::regclass
        and i.indisunique
        and i.indnkeyatts = cardinality(p_cols)
        and (select array_agg(a.attname::text order by k.ord)
             from unnest(i.indkey::smallint[]) with ordinality as k (attnum, ord)
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = p_cols)
  $$;

select ok(pg_temp.has_unique_on('email_messages', array['connected_account_id', 'provider_message_id']), 'unique email_messages (connected_account_id, provider_message_id)');
select ok(pg_temp.has_unique_on('email_threads', array['connected_account_id', 'provider_thread_id']), 'unique email_threads (connected_account_id, provider_thread_id)');
select ok(pg_temp.has_unique_on('calendar_events', array['calendar_id', 'provider_event_id']), 'unique calendar_events (calendar_id, provider_event_id)');
select ok(pg_temp.has_unique_on('insights', array['user_id', 'dedupe_key']), 'unique insights (user_id, dedupe_key)');
select ok(pg_temp.has_unique_on('life_events', array['user_id', 'dedupe_key']), 'unique life_events (user_id, dedupe_key)');
select ok(pg_temp.has_unique_on('commitments', array['user_id', 'dedupe_key']), 'unique commitments (user_id, dedupe_key)');
select ok(pg_temp.has_unique_on('reminders', array['user_id', 'idempotency_key']), 'unique reminders (user_id, idempotency_key)');
select ok(pg_temp.has_unique_on('approval_actions', array['idempotency_key']), 'unique approval_actions (idempotency_key)');
select ok(pg_temp.has_unique_on('briefings', array['user_id', 'kind', 'local_date']), 'unique briefings (user_id, kind, local_date)');
select ok(pg_temp.has_unique_on('notifications', array['user_id', 'dedupe_key']), 'unique notifications (user_id, dedupe_key)');
select ok(pg_temp.has_unique_on('jobs', array['idempotency_key']), 'unique jobs (idempotency_key)');
select ok(pg_temp.has_unique_on('billing_events', array['event_id']), 'unique billing_events (event_id)');
select ok(pg_temp.has_unique_on('webhook_events', array['source', 'external_id']), 'unique webhook_events (source, external_id)');
select ok(pg_temp.has_unique_on('referral_credits', array['referral_id', 'side']), 'unique referral_credits (referral_id, side)');
select ok(pg_temp.has_unique_on('entitlement_grants', array['idempotency_key']), 'unique entitlement_grants (idempotency_key)');
select ok(pg_temp.has_unique_on('prompt_versions', array['prompt_key', 'version']), 'unique prompt_versions (prompt_key, version)');
select ok(pg_temp.has_unique_on('vip_people', array['user_id', 'contact_id']), 'unique vip_people (user_id, contact_id)');
select ok(pg_temp.has_unique_on('ai_result_cache', array['user_id', 'feature', 'content_hash', 'prompt_version_id']), 'unique ai_result_cache (user_id, feature, content_hash, prompt_version_id) (R-02)');
select ok(pg_temp.has_unique_on('ai_model_config', array['profile', 'role', 'feature']), 'unique ai_model_config (profile, role, feature) (R-18)');
select ok(pg_temp.has_unique_on('connected_accounts', array['user_id', 'provider', 'provider_account_id']), 'unique connected_accounts (user_id, provider, provider_account_id)');
select ok(pg_temp.has_unique_on('captures', array['user_id', 'idempotency_key']), 'unique captures (user_id, idempotency_key)');
select ok(pg_temp.has_unique_on('android_notification_signals', array['user_id', 'signal_hash']), 'unique android_notification_signals (user_id, signal_hash)');
select ok(pg_temp.has_unique_on('plan_limits', array['plan', 'key']), 'primary key plan_limits (plan, key) (R-22)');
select ok(
  exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relname = 'prompt_versions_prompt_key_active_key' and i.indisunique and i.indpred is not null),
  'partial unique index: one active prompt version per key'
);

-- ─── Embeddings (R-01; pgvector 0.6: vector + HNSW) ───────────────────────────────────────────
select is(
  (select t.typname || '(' || a.atttypmod || ')' from pg_attribute a join pg_type t on t.oid = a.atttypid
   where a.attrelid = 'public.memory_chunks'::regclass and a.attname = 'embedding'),
  'vector(1024)',
  'memory_chunks.embedding is vector(1024)'
);
select is(
  (select t.typname || '(' || a.atttypmod || ')' from pg_attribute a join pg_type t on t.oid = a.atttypid
   where a.attrelid = 'public.memory_chunks'::regclass and a.attname = 'embedding_dr'),
  'vector(1024)',
  'memory_chunks.embedding_dr is vector(1024)'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'memory_chunks_embedding_hnsw'
          and indexdef ~ 'USING hnsw .*vector_cosine_ops'),
  'memory_chunks_embedding_hnsw is an HNSW vector_cosine_ops index'
);

-- ─── Structural invariants ────────────────────────────────────────────────────────────────────
select is_empty(
  $$ select c.conrelid::regclass::text || '.' || a.attname
     from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]) $$,
  'every foreign key has an index whose leading column is the FK column'
);
select is_empty(
  $$ select c.oid::regclass::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
     where n.nspname in ('public', 'private') and c.relkind = 'r'
       and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'trg_' || c.relname || '_updated_at') $$,
  'every table with updated_at has its trg_<table>_updated_at trigger'
);
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
     where n.nspname in ('public', 'private', 'admin_api') and p.prosecdef
       and (not coalesce(p.proconfig @> array['search_path=""'], false) or not (r.rolsuper or r.rolbypassrls)) $$,
  'security definer functions pin search_path to empty and are owned by a superuser or BYPASSRLS role'
);
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and (not coalesce(p.proconfig @> array['search_path=""'], false)
            or p.proacl is null
            or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')) $$,
  'private functions pin search_path and are not executable by PUBLIC'
);
select is_empty(
  $$ select table_name || '.' || column_name from information_schema.columns
     where table_schema = 'public' and table_name in ('email_messages', 'email_threads') and column_name ~ 'body' $$,
  'no mail body column exists (ADR-05)'
);

-- ─── Reference data ───────────────────────────────────────────────────────────────────────────
select is((select count(*)::integer from public.plan_limits), 60, 'plan_limits: 30 canonical keys for free and pro (R-22)');
select is((select value from public.plan_limits where plan = 'free' and key = 'ai_daily_budget_units'), '50'::jsonb, 'Free ai_daily_budget_units = 50 ("AI analiz limiti 50/gün")');
select is((select value from public.plan_limits where plan = 'free' and key = 'ai_routing_profile'), '"lean"'::jsonb, 'Free routing profile is lean');
select is((select value from public.plan_limits where plan = 'pro' and key = 'ai_routing_profile'), '"balanced"'::jsonb, 'Pro routing profile is balanced');
select throws_ok(
  $$ update public.plan_limits set value = '"fast"' where plan = 'pro' and key = 'ai_routing_profile' $$,
  '23514', null, 'plan_limits rejects an unknown routing profile'
);
select set_eq(
  $$ select key from public.feature_flags $$,
  $$ select unnest(array[
       'ai.global.enabled', 'ai.provider.anthropic.enabled', 'ai.provider.openai.enabled', 'ai.provider.voyage.enabled',
       'ai.feature.briefing_polish', 'ai.model.large.enabled', 'ai.model.opus_escalation', 'ai.batch.enabled',
       'ai.backfill.enabled', 'ai.budget.org_daily_usd', 'voice.stt_server', 'voice.tts_premium', 'feature.midday',
       'feature.evening', 'feature.voice', 'feature.meeting_prep', 'feature.capture', 'feature.android_ni',
       'feature.weekly_review', 'feature.new_ai_model'])
     union all
     select 'ai.feature.' || f.feature::text from unnest(enum_range(null::public.ai_feature)) as f (feature) $$,
  'feature_flags hold exactly the R-10 keys'
);
select is(
  (select array_agg(key order by key) from public.feature_flags where not enabled),
  array['ai.feature.briefing_polish', 'ai.model.opus_escalation', 'feature.new_ai_model', 'voice.tts_premium'],
  'only briefing polish, Opus escalation, the new-model rollout and premium TTS start disabled'
);
select is((select count(*)::integer from public.ai_model_config), 42, 'ai_model_config: 21 routes per profile');
select is_empty(
  $$ select p.profile::text || ':' || f.feature::text
     from unnest(enum_range(null::public.ai_feature)) as f (feature)
     cross join unnest(enum_range(null::public.routing_profile)) as p (profile)
     where f.feature <> 'admin_probe'
       and not exists (select 1 from public.ai_model_config c where c.feature = f.feature and c.profile = p.profile) $$,
  'every AI feature except admin_probe has a route in both routing profiles'
);
select throws_ok(
  $$ insert into public.ai_model_config (profile, role, feature, tier, provider, model, max_input_tokens)
     values ('balanced', 'probe', 'admin_probe', 't2', 'anthropic', 'claude-fable-5-1', 1000) $$,
  '23514', null, 'a Covered Model is rejected as primary target (R-02)'
);
select throws_ok(
  $$ insert into public.ai_model_config (profile, role, feature, tier, provider, model, max_input_tokens, fallback_targets)
     values ('balanced', 'probe', 'admin_probe', 't2', 'anthropic', 'claude-sonnet-5', 1000,
             '[{"provider":"anthropic","model":"claude-fable-5-1","params":{}}]') $$,
  '23514', null, 'a Covered Model is rejected in fallback_targets (R-02)'
);
select throws_ok(
  $$ insert into public.ai_model_config (profile, role, feature, tier, provider, model, max_input_tokens, escalation_target)
     values ('balanced', 'probe', 'admin_probe', 't2', 'anthropic', 'claude-sonnet-5', 1000,
             '{"provider":"anthropic","model":"claude-fable-5-1","params":{}}') $$,
  '23514', null, 'a Covered Model is rejected as escalation target (R-02)'
);
select throws_ok(
  $$ insert into public.ai_model_config (profile, role, feature, tier, provider, model, max_input_tokens)
     select profile, role, feature, tier, provider, model, max_input_tokens from public.ai_model_config
     where profile = 'balanced' and feature = 'email_triage' $$,
  '23505', null, 'a second route for the same (profile, role, feature) is rejected (R-18)'
);
select throws_ok(
  $$ update public.ai_model_config set model = 'claude-sonnet-5', provider = 'anthropic'
     where profile = 'lean' and feature = 'email_triage' $$,
  '55000', 'EVAL_REQUIRED', 'a new primary target needs a passing eval'
);
select is((select count(*)::integer from public.ai_model_prices), 10, 'ai_model_prices seeded');
select is((select count(*)::integer from private.admin_role_permissions), 173, 'admin_role_permissions seeded from the BACKOFFICE_PLAN §4.2 matrix');
select ok(
  exists (select 1 from private.admin_role_permissions where role = 'support' and permission = 'support.access')
  and not exists (select 1 from private.admin_role_permissions where role = 'finance' and permission = 'support.access'),
  'Support Access is limited to support and super_admin (R-09)'
);
select is(
  (select array_agg(role::text order by role) from private.admin_role_permissions where permission = 'push.test'),
  array['super_admin', 'operations'],
  'push.test is super_admin and operations only (BACKOFFICE_PLAN §4.2)'
);
select is_empty(
  $$ select role || ':' || permission from private.admin_role_permissions
     where role in ('analyst', 'readonly') and permission !~ '\.read$' and permission <> 'search.global' $$,
  'analyst and readonly hold read permissions only'
);
select set_eq(
  $$ select key from public.app_settings where key <> 'admin.gateway_secret_sha256' $$,
  array['session.idle_minutes', 'session.absolute_hours', 'metrics.inactive_after_days', 'metrics.reporting_timezone',
        'referral.reward_days', 'referral.min_account_age_hours', 'referral.velocity_max_per_hour',
        'referral.risk_threshold', 'referral.apply_window_days', 'support_access.max_minutes',
        'notifications.cap.follow_up', 'notifications.cap.life_intel', 'notifications.cap.deadline',
        'followup.wait_thresholds_days', 'first_analysis.mail_window_hours', 'first_analysis.calendar_window_hours',
        'first_analysis.slow_threshold_s', 'first_analysis.timeout_s', 'today.max_priorities', 'pro_gate.snooze_days',
        'web.pricing_display', 'pricing.estimates', 'billing.sandbox_allowed_app_user_ids'],
  'app_settings seeded with the documented keys (the gateway digest is written by the deploy job, and by 000_helpers in tests)'
);
select throws_ok(
  $$ update public.app_settings set value = '45' where key = 'session.idle_minutes' $$,
  '23514', null, 'app_settings enforces per-key bounds'
);

-- ─── New users (T-2.04) ───────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'structure-a@test.local', '{"timezone":"Europe/Berlin"}'),
  ('00000000-0000-4000-8000-000000000002', 'structure-b@test.local', '{}');
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'structure-admin-1@test.local', '{"da_kind":"admin"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'structure-admin-2@test.local', '{"da_kind":"admin"}');

select is(
  (select array[(select count(*) from public.profiles where user_id = u.id),
                (select count(*) from public.user_preferences where user_id = u.id),
                (select count(*) from public.notification_preferences where user_id = u.id),
                (select count(*) from public.referral_codes where user_id = u.id)]::integer[]
   from auth.users u where u.id = '00000000-0000-4000-8000-000000000001'),
  array[1, 1, 1, 1],
  'a new auth user gets exactly one profile, preferences, notification preferences and referral code row'
);
select is(
  (select array[(select count(*) from public.profiles where user_id = u.id),
                (select count(*) from public.user_preferences where user_id = u.id),
                (select count(*) from public.notification_preferences where user_id = u.id),
                (select count(*) from public.referral_codes where user_id = u.id)]::integer[]
   from auth.users u where u.id = '00000000-0000-4000-8000-0000000000a1'),
  array[0, 0, 0, 0],
  'a dedicated admin identity gets no app rows (R-08)'
);
select is(
  (select timezone from public.user_preferences where user_id = '00000000-0000-4000-8000-000000000001'),
  'Europe/Berlin', 'timezone taken from valid sign-up metadata'
);
select is(
  (select timezone || '/' || retention_policy::text from public.user_preferences where user_id = '00000000-0000-4000-8000-000000000002'),
  'Europe/Istanbul/d90', 'defaults: Europe/Istanbul and d90 retention'
);
select is(
  (select array[quiet_hours_enabled::text, quiet_start::text, quiet_end::text, vip_bypass_quiet::text, daily_cap::text, detail_level::text]
   from public.notification_preferences where user_id = '00000000-0000-4000-8000-000000000002'),
  array['true', '22:30:00', '07:30:00', 'true', '5', 'title_only'],
  'notification defaults: quiet hours 22:30–07:30 with VIP bypass (R-13), daily cap 5 (R-14), title_only'
);
select ok(
  (select private.referral_code_valid(code) from public.referral_codes where user_id = '00000000-0000-4000-8000-000000000001'),
  'the generated referral code carries a valid check character'
);
select ok(
  private.referral_code_valid('2222222') and private.referral_code_valid('3222223') and private.referral_code_valid('ZZZZZZC')
  and not private.referral_code_valid('ZZZZZZD') and not private.referral_code_valid('222222L'),
  'referral check character matches packages/domain referralCheckChar vectors'
);
select throws_ok(
  $$ update public.user_preferences set timezone = 'Mars/Olympus' where user_id = '00000000-0000-4000-8000-000000000002' $$,
  '22023', null, 'an unknown IANA timezone is rejected'
);

-- ─── Content fixtures ─────────────────────────────────────────────────────────────────────────
insert into public.connected_accounts (id, user_id, provider, provider_account_id, account_email, status)
values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-000000000001', 'google', 'g-1', 'structure-a@gmail.test', 'healthy');
insert into public.app_installations (id, user_id, installation_id, platform, app_version, build_number, device_hash)
values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-000000000001', gen_random_uuid(), 'ios', '1.0.0', '1', '\x01');

insert into public.email_threads (id, user_id, connected_account_id, provider, provider_thread_id, last_message_at)
values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-00000000c001', 'google', 't-1', '2026-01-01T00:00:00Z');
select is(
  (select expires_at from public.email_threads where id = '00000000-0000-4000-8000-00000000e001'),
  '2026-04-01T00:00:00Z'::timestamptz,
  'expires_at follows the d90 retention policy from the anchor column'
);
select throws_ok(
  $$ insert into public.email_threads (user_id, connected_account_id, provider, provider_thread_id, last_message_at)
     values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000c001', 'google', 't-1', now()) $$,
  '23505', null, 'the provider thread id is unique per account'
);
select throws_ok(
  $$ insert into public.email_threads (user_id, connected_account_id, provider, provider_thread_id, last_message_at, deadline_at)
     values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000c001', 'google', 't-2', now(), now()) $$,
  '23514', null, 'a deadline without evidence is rejected (M§83)'
);

insert into public.tasks (id, user_id, title, origin) values
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-000000000001', 'Teklif hazırla', 'user');
select is(
  (select expires_at from public.tasks where id = '00000000-0000-4000-8000-00000000f001'),
  null::timestamptz, 'open tasks never expire'
);
update public.tasks set status = 'done', completed_at = '2026-02-01T00:00:00Z' where id = '00000000-0000-4000-8000-00000000f001';
select is(
  (select expires_at from public.tasks where id = '00000000-0000-4000-8000-00000000f001'),
  '2026-05-02T00:00:00Z'::timestamptz, 'a completed task expires 90 days after completion'
);
select throws_ok(
  $$ insert into public.commitments (user_id, direction, text, dedupe_key, origin, source_type, source_id, source_timestamp, confidence)
     values ('00000000-0000-4000-8000-000000000001', 'user_owes', 'Cuma gönderirim.', 'c-1', 'user', 'user_input', 'u-1', now(), 1) $$,
  '23514', null, 'a commitment needs a contact or a counterparty name'
);
select throws_ok(
  $$ insert into public.captures (user_id, kind, storage_path, idempotency_key)
     values ('00000000-0000-4000-8000-000000000001', 'photo', '00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000009/x.jpg', 'k-1') $$,
  '23514', null, 'a capture path outside the owner folder is rejected'
);

-- ─── Intelligence (T-2.07) ────────────────────────────────────────────────────────────────────
insert into public.prompt_versions (id, prompt_key, version, status, system_prompt, user_template, output_schema_ref, schema_hash, model_role, eval_passed)
values ('00000000-0000-4000-8000-0000000b0001', 'reply_draft', 1, 'active', 's', 'u', 'ReplyDraftsV1', 'h', 'reasoning', true);
select throws_ok(
  $$ insert into public.prompt_versions (prompt_key, version, status, system_prompt, user_template, output_schema_ref, schema_hash, model_role, eval_passed)
     values ('reply_draft', 2, 'active', 's', 'u', 'ReplyDraftsV1', 'h', 'reasoning', true) $$,
  '23505', null, 'a second active prompt version for the same key is rejected'
);
select throws_ok(
  $$ update public.prompt_versions set system_prompt = 'changed' where id = '00000000-0000-4000-8000-0000000b0001' $$,
  '55000', 'PROMPT_VERSION_IMMUTABLE', 'the content of an active prompt version is immutable'
);
insert into public.ai_result_cache (user_id, feature, content_hash, prompt_version_id, model, result)
values ('00000000-0000-4000-8000-000000000001', 'reply_draft', decode(repeat('ab', 32), 'hex'),
        '00000000-0000-4000-8000-0000000b0001', 'claude-sonnet-5', '{}');
select throws_ok(
  $$ insert into public.ai_result_cache (user_id, feature, content_hash, prompt_version_id, model, result)
     values ('00000000-0000-4000-8000-000000000001', 'reply_draft', decode(repeat('ab', 32), 'hex'),
             '00000000-0000-4000-8000-0000000b0001', 'claude-sonnet-5', '{}') $$,
  '23505', null, 'a duplicate ai_result_cache key is rejected (R-02)'
);
select throws_ok(
  $$ insert into public.ai_result_cache (user_id, feature, content_hash, prompt_version_id, model, result)
     values ('00000000-0000-4000-8000-000000000001', 'reply_draft', decode(repeat('ab', 16), 'hex'),
             '00000000-0000-4000-8000-0000000b0001', 'claude-sonnet-5', '{}') $$,
  '23514', null, 'a content hash that is not 32 bytes is rejected'
);

-- ─── Approvals (T-2.08) ───────────────────────────────────────────────────────────────────────
insert into public.approval_actions (id, user_id, action_type, payload, payload_hash, what, change_summary, idempotency_key,
                                     origin, executor, device_installation_id, source_type, source_id, source_timestamp, confidence)
values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-000000000001', 'calendar_create', '{}', '\x00',
        'Teklif hazırlama', 'Yarın 14:00–16:30', 'approval:1:v1', 'plan_proposal', 'device',
        '00000000-0000-4000-8000-00000000d001', 'user_input', 'u-1', now(), 1);
insert into public.approval_events (user_id, approval_action_id, from_status, to_status, actor, payload_version, idempotency_key)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000a0001', null, 'pending', 'user', 1, 'approval:1:v1');
select throws_ok(
  $$ update public.approval_actions set status = 'executed' where id = '00000000-0000-4000-8000-0000000a0001' $$,
  '42501', 'APPROVAL_TX_REQUIRED', 'guarded approval columns change only inside the approval transaction functions'
);
select throws_ok(
  $$ insert into public.approval_actions (user_id, action_type, payload, payload_hash, what, change_summary, idempotency_key,
                                          origin, executor, source_type, source_id, source_timestamp, confidence)
     values ('00000000-0000-4000-8000-000000000001', 'calendar_create', '{}', '\x00', 'x', 'y', 'approval:2:v1',
             'plan_proposal', 'device', 'user_input', 'u-1', now(), 1) $$,
  '23514', null, 'a device-executed approval must name its installation'
);
select is(
  (select expires_at from public.approval_actions where id = '00000000-0000-4000-8000-0000000a0001'),
  null::timestamptz, 'pending approvals never expire through retention'
);
select throws_ok(
  $$ update public.approval_events set reason = 'x' where approval_action_id = '00000000-0000-4000-8000-0000000a0001' $$,
  '55000', 'AUDIT_IMMUTABLE', 'approval_events rows cannot be updated'
);
select throws_ok(
  $$ delete from public.approval_events where approval_action_id = '00000000-0000-4000-8000-0000000a0001' $$,
  '55000', 'AUDIT_IMMUTABLE', 'approval_events rows cannot be deleted directly'
);
set local role authenticated;
select throws_ok(
  $$ insert into public.approval_actions (user_id, action_type, payload, payload_hash, what, change_summary, idempotency_key,
                                          origin, source_type, source_id, source_timestamp, confidence)
     values ('00000000-0000-4000-8000-000000000001', 'email_send', '{}', '\x00', 'x', 'y', 'approval:3:v1',
             'reply_draft', 'user_input', 'u-1', now(), 1) $$,
  '42501', null, 'a client cannot insert approval_actions directly'
);
reset role;

-- ─── Notifications (T-2.10) ───────────────────────────────────────────────────────────────────
insert into public.notifications (user_id, category, decision, dedupe_key, detail_mode, data, android_channel, scheduled_for)
values ('00000000-0000-4000-8000-000000000001', 'deadline', 'sent', 'deadline:insight:1:2026-09-24', 'title_only',
        '{"type":"deadline","deeplink":"dijitalasistan://today"}', 'deadlines', now());
select throws_ok(
  $$ insert into public.notifications (user_id, category, decision, dedupe_key, detail_mode, data, android_channel, scheduled_for)
     values ('00000000-0000-4000-8000-000000000001', 'deadline', 'sent', 'deadline:insight:1:2026-09-24', 'title_only',
             '{"type":"deadline","deeplink":"dijitalasistan://today"}', 'deadlines', now()) $$,
  '23505', null, 'a duplicate notification dedupe_key for the same user is rejected'
);
select throws_ok(
  $$ insert into public.notifications (user_id, category, decision, dedupe_key, detail_mode, data, android_channel, scheduled_for)
     values ('00000000-0000-4000-8000-000000000001', 'deadline', 'sent', 'n-2', 'full',
             '{"type":"deadline","deeplink":"dijitalasistan://today","body":"x"}', 'deadlines', now()) $$,
  '23514', null, 'a push payload never carries a body'
);
select throws_ok(
  $$ insert into public.notifications (user_id, category, decision, dedupe_key, detail_mode, data, android_channel, scheduled_for)
     values ('00000000-0000-4000-8000-000000000001', 'morning', 'sent', 'n-3', 'title_only',
             '{"type":"briefing","deeplink":"dijitalasistan://today"}', 'brifing', now()) $$,
  '23514', null, 'only the R-12 Android channel ids are accepted'
);

-- ─── Admin and audit (T-2.14) ─────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.admin_users (user_id, role, status, display_name, email)
     values ('00000000-0000-4000-8000-000000000002', 'support', 'active', 'App User', 'structure-b@test.local') $$,
  '23514', 'EMAIL_IN_USE_BY_APP_USER', 'an app user can never become an admin (R-08)'
);
insert into public.admin_users (user_id, role, status, display_name, email)
values ('00000000-0000-4000-8000-0000000000a1', 'super_admin', 'active', 'Admin One', 'structure-admin-1@test.local');
select throws_ok(
  $$ update public.admin_users set role = 'operations' where user_id = '00000000-0000-4000-8000-0000000000a1' $$,
  '55000', 'LAST_SUPER_ADMIN', 'the last active super_admin cannot be demoted'
);
select throws_ok(
  $$ update public.admin_users set status = 'disabled' where user_id = '00000000-0000-4000-8000-0000000000a1' $$,
  '55000', 'LAST_SUPER_ADMIN', 'the last active super_admin cannot be disabled'
);
select throws_ok(
  $$ delete from public.admin_users where user_id = '00000000-0000-4000-8000-0000000000a1' $$,
  '55000', 'LAST_SUPER_ADMIN', 'the last active super_admin cannot be deleted'
);
insert into public.admin_users (user_id, role, status, display_name, email)
values ('00000000-0000-4000-8000-0000000000a2', 'super_admin', 'active', 'Admin Two', 'structure-admin-2@test.local');
select lives_ok(
  $$ update public.admin_users set role = 'operations' where user_id = '00000000-0000-4000-8000-0000000000a1' $$,
  'a super_admin can be demoted while another active super_admin exists'
);
select throws_ok(
  $$ delete from public.admin_users where user_id = '00000000-0000-4000-8000-0000000000a1' $$,
  '55000', 'ADMINS_NEVER_DELETED', 'admin rows are never deleted'
);
select throws_ok(
  $$ insert into public.support_access_grants (admin_user_id, user_id, scope, reason, starts_at, expires_at)
     values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', array['pii']::public.support_access_scope[],
             'Destek talebi DA-2026-000001 inceleniyor', now(), now() + interval '90 minutes') $$,
  '23514', null, 'Support Access grants longer than 60 minutes are rejected (R-09)'
);
select lives_ok(
  $$ insert into public.support_access_grants (admin_user_id, user_id, scope, reason, starts_at, expires_at)
     values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', array['pii']::public.support_access_scope[],
             'Destek talebi DA-2026-000001 inceleniyor', now(), now() + interval '30 minutes') $$,
  'a 30-minute Support Access grant is accepted'
);

select lives_ok(
  $$ select private.audit_log_append('admin', '00000000-0000-4000-8000-0000000000a2', 'super_admin', 'admin.role_changed',
                                     'admin_user', '00000000-0000-4000-8000-0000000000a1', null, 'Rol değişikliği', 'success',
                                     '{"from":"super_admin","to":"operations"}', null),
            private.audit_log_append('system', null, null, 'health.run', null, null, null, null, 'success', '{}', null),
            private.audit_log_append('user', '00000000-0000-4000-8000-000000000001', null, 'privacy.retention_changed',
                                     'user', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
                                     null, 'success', '{}', null) $$,
  'audit rows are appended through private.audit_log_append'
);
select is(
  (select ok from private.audit_verify_chain()),
  true, 'the audit hash chain verifies'
);
select throws_ok(
  $$ update public.audit_logs set reason = 'tampered' $$,
  '55000', 'AUDIT_IMMUTABLE', 'audit_logs rows cannot be updated'
);
select throws_ok(
  $$ delete from public.audit_logs $$,
  '55000', 'AUDIT_IMMUTABLE', 'audit_logs rows cannot be deleted'
);
select throws_ok(
  $$ truncate public.audit_logs $$,
  '55000', 'AUDIT_IMMUTABLE', 'audit_logs cannot be truncated'
);

-- ─── Privacy (T-2.13) and account deletion cascade ────────────────────────────────────────────
insert into public.data_deletion_requests (id, user_id, subject_hash, kind, origin, confirmation_method)
values ('00000000-0000-4000-8000-00000000dd01', '00000000-0000-4000-8000-000000000001',
        private.hash_subject('00000000-0000-4000-8000-000000000001'), 'account', 'app', 'reauth');
select throws_ok(
  $$ insert into public.data_deletion_requests (user_id, subject_hash, kind, origin, confirmation_method)
     values ('00000000-0000-4000-8000-000000000002', private.hash_subject('00000000-0000-4000-8000-000000000002'),
             'history', 'web_otp', 'email_otp') $$,
  '23514', null, 'history deletion requires re-authentication (R-16)'
);
select lives_ok(
  $$ delete from auth.users where id = '00000000-0000-4000-8000-000000000001' $$,
  'deleting an auth user cascades through every owned table, including approvals and their events'
);
select is(
  (select array[(user_id is null)::text, (subject_hash = private.hash_subject('00000000-0000-4000-8000-000000000001'))::text]
   from public.data_deletion_requests where id = '00000000-0000-4000-8000-00000000dd01'),
  array['true', 'true'],
  'the deletion request survives the deletion of its user, keyed by subject_hash'
);
select is(
  (select count(*)::integer from public.approval_events where user_id = '00000000-0000-4000-8000-000000000001'),
  0, 'approval events are removed with their user'
);

select * from finish();
rollback;
