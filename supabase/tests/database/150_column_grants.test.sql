-- pgTAP · column privileges of authenticated (DATABASE_AND_RLS_PLAN §3.4, §4 per-table RLS lines,
-- §13.2 150): state machines, provenance, AI output, hashes and embeddings are never client-writable
-- or client-readable; user-editable columns are.
begin;
select plan(6);

create temporary table expect (tbl text, col text, priv text, allowed boolean) on commit drop;
insert into expect values
  ('insights', 'status', 'UPDATE', true), ('insights', 'snoozed_until', 'UPDATE', true), ('insights', 'confidence', 'UPDATE', false),
  ('insights', 'title', 'UPDATE', false), ('insights', 'user_overrides', 'UPDATE', false), ('insights', 'rank_score', 'UPDATE', false),
  ('commitments', 'status', 'UPDATE', true), ('commitments', 'due_at', 'UPDATE', true), ('commitments', 'text', 'UPDATE', false),
  ('commitments', 'confidence', 'UPDATE', false), ('commitments', 'user_overrides', 'UPDATE', false),
  ('life_events', 'suppressed', 'UPDATE', true), ('life_events', 'amount', 'UPDATE', false), ('life_events', 'user_overrides', 'UPDATE', false),
  ('email_messages', 'subject', 'SELECT', true), ('email_messages', 'content_hash', 'SELECT', false),
  ('email_messages', 'references_ids', 'SELECT', false), ('email_messages', 'classification', 'UPDATE', false),
  ('email_threads', 'analysis_hash', 'SELECT', false), ('email_threads', 'ai_summary', 'SELECT', true),
  ('memory_chunks', 'content', 'SELECT', true), ('memory_chunks', 'embedding', 'SELECT', false), ('memory_chunks', 'embedding_dr', 'SELECT', false),
  ('user_preferences', 'analytics_opt_out', 'UPDATE', true), ('user_preferences', 'timezone', 'UPDATE', true),
  ('user_preferences', 'retention_policy', 'UPDATE', true), ('user_preferences', 'first_analysis_job_id', 'UPDATE', false),
  ('user_preferences', 'user_id', 'UPDATE', false), ('user_preferences', 'updated_at', 'UPDATE', false),
  ('notification_preferences', 'quiet_start', 'UPDATE', true), ('notification_preferences', 'snooze_until', 'UPDATE', false),
  ('approval_actions', 'what', 'SELECT', true), ('approval_actions', 'device_token_hash', 'SELECT', false),
  ('approval_actions', 'executor', 'UPDATE', false), ('approval_actions', 'status', 'UPDATE', false), ('approval_actions', 'payload', 'UPDATE', false),
  ('profiles', 'display_name', 'UPDATE', true), ('profiles', 'state', 'UPDATE', false), ('profiles', 'is_internal', 'SELECT', false),
  ('profiles', 'is_demo', 'SELECT', false), ('profiles', 'apple_sub_hash', 'SELECT', false),
  ('app_installations', 'device_hash', 'SELECT', false), ('app_installations', 'app_version', 'SELECT', true),
  ('push_tokens', 'expo_push_token', 'SELECT', false), ('push_tokens', 'status', 'SELECT', true),
  ('sync_states', 'cursor', 'SELECT', false), ('sync_states', 'watch_token_hash', 'SELECT', false), ('sync_states', 'page_token', 'SELECT', false),
  ('sync_states', 'status', 'SELECT', true),
  ('subscriptions', 'rc_app_user_id', 'SELECT', false), ('subscriptions', 'last_event_id', 'SELECT', false),
  ('subscriptions', 'is_active', 'SELECT', true), ('subscriptions', 'is_active', 'UPDATE', false),
  ('support_tickets', 'subject', 'SELECT', true), ('support_tickets', 'message', 'SELECT', false),
  ('support_tickets', 'contact_email', 'SELECT', false),
  ('calendars', 'selected', 'UPDATE', true), ('calendars', 'name', 'UPDATE', false),
  ('captures', 'status', 'UPDATE', true), ('captures', 'storage_path', 'UPDATE', false), ('captures', 'extracted', 'UPDATE', false),
  ('priority_rules', 'outcome', 'UPDATE', true), ('priority_rules', 'deleted_at', 'UPDATE', true),
  ('priority_rules', 'match_count_30d', 'UPDATE', false),
  ('learned_preferences', 'enabled', 'UPDATE', true), ('learned_preferences', 'evidence_count', 'UPDATE', false),
  ('briefings', 'opened_at', 'UPDATE', true), ('briefings', 'status', 'UPDATE', false), ('briefings', 'narrative', 'UPDATE', false),
  ('notifications', 'opened_at', 'UPDATE', true), ('notifications', 'decision', 'UPDATE', false),
  ('ai_feedback', 'rating', 'UPDATE', true), ('ai_feedback', 'feature', 'UPDATE', false), ('ai_feedback', 'comment', 'INSERT', true),
  ('ai_feedback', 'model', 'INSERT', false),
  ('vip_people', 'relationship', 'UPDATE', true), ('vip_people', 'contact_id', 'UPDATE', false),
  ('data_deletion_requests', 'status', 'SELECT', true), ('data_deletion_requests', 'status_token_hash', 'SELECT', false),
  ('data_deletion_requests', 'subject_hash', 'SELECT', false),
  ('tasks', 'title', 'UPDATE', true), ('tasks', 'provider_task_id', 'UPDATE', false), ('tasks', 'connected_account_id', 'INSERT', false),
  ('meeting_notes', 'body', 'UPDATE', true), ('meeting_notes', 'kind', 'UPDATE', false),
  ('assistant_threads', 'title', 'UPDATE', true), ('assistant_threads', 'message_count', 'UPDATE', false),
  ('connected_accounts', 'account_email', 'SELECT', true), ('connected_accounts', 'data_source_toggles', 'UPDATE', false),
  ('contacts', 'display_name', 'UPDATE', true), ('contacts', 'primary_email', 'UPDATE', false), ('contacts', 'origin', 'INSERT', true),
  ('meeting_preps', 'input_hash', 'SELECT', false), ('meeting_preps', 'talking_points', 'SELECT', true),
  ('reply_drafts', 'body', 'UPDATE', false), ('plan_limits', 'value', 'SELECT', true), ('plan_limits', 'value', 'UPDATE', false);

select is_empty(
  $$ select tbl || '.' || col || ' ' || priv || ' expected ' || allowed from expect
     where has_column_privilege('authenticated', 'public.' || tbl, col, priv) <> allowed $$,
  'authenticated column privileges match the §4 grants'
);
select is_empty(
  $$ select tbl || '.' || col || ' ' || priv from expect where has_column_privilege('anon', 'public.' || tbl, col, priv) $$,
  'anon has none of these column privileges'
);
select set_eq(
  $$ select distinct table_name::text from information_schema.column_privileges
     where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE' $$,
  array['profiles', 'user_preferences', 'notification_preferences', 'calendars', 'tasks', 'commitments', 'meeting_notes', 'contacts',
        'vip_people', 'life_events', 'captures', 'priority_rules', 'learned_preferences', 'insights', 'briefings', 'assistant_threads',
        'ai_feedback', 'notifications'],
  'exactly the §4 tables carry client UPDATE grants'
);
select set_eq(
  $$ select distinct table_name::text from information_schema.column_privileges
     where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'INSERT' $$,
  array['tasks', 'contacts', 'vip_people', 'priority_rules', 'ai_feedback', 'announcement_dismissals'],
  'exactly the §4 tables carry client INSERT grants'
);
select set_eq(
  $$ select table_name::text from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'DELETE' $$,
  array['tasks', 'meeting_notes', 'vip_people', 'android_notification_signals', 'assistant_threads', 'ai_feedback'],
  'exactly the §4 tables carry client DELETE grants'
);
select is_empty(
  $$ select table_name || '.' || column_name from information_schema.column_privileges
     where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE'
       and column_name in ('id', 'user_id', 'created_at', 'updated_at', 'expires_at', 'confidence', 'evidence', 'source_type',
                           'source_id', 'source_provider', 'source_timestamp', 'user_overrides', 'dedupe_key') $$,
  'ids, ownership, timestamps, provenance and overrides are never client-writable'
);

select * from finish();
rollback;
