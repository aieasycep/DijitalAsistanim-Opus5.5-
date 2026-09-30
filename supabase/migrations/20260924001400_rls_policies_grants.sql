-- Migration 0014 · RLS policies and grants
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §3 (baseline, anon, owner templates, column privileges,
-- restrictive aal2 on admin-only tables, append-only tables) and the per-table RLS lines of §4.
-- Owner policies use `(select auth.uid())` so the uid is an initPlan evaluated once per statement.
-- Tables without a policy below are SYS: RLS on, no client grant, reached only by service_role
-- (Edge Functions with the secret key) and by security-definer functions.

-- Each migration runs in one transaction; never wait long on a lock held by live traffic.
set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ Check helpers evaluated under the writing client role ═══════════════════════════════════
-- CHECK expressions run as the writing role, and a SQL function body resolves every name it
-- references when it starts. authenticated has no USAGE on schema private (§3.2, §6.9), so the
-- two helpers behind client-writable columns (user_preferences.ai_data_access,
-- priority_rules.condition_value) must not reference other private functions: same logic, with
-- the exact-key test inlined. Signatures, OIDs and the constraints that use them are unchanged.
create or replace function private.valid_ai_data_access(p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select case
      when p is null or jsonb_typeof(p) <> 'object' then false
      when (select array_agg(k.key order by k.key) from jsonb_object_keys(p) as k (key))
           is distinct from array['attachments', 'calendar', 'contacts', 'location_coarse', 'mail_body'] then false
      else not exists (select 1 from jsonb_each(p) as e (key, value) where jsonb_typeof(e.value) <> 'boolean')
    end
  $$;

create or replace function private.valid_rule_condition(p_type public.rule_condition, p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(case
      when p is null or p_type is null or jsonb_typeof(p) <> 'object' then false
      when (select array_agg(k.key order by k.key) from jsonb_object_keys(p) as k (key))
           is distinct from array[case p_type when 'person' then 'contact_id' when 'domain' then 'domain'
                                              when 'keyword' then 'keywords' when 'category' then 'category'
                                              when 'sender' then 'address' when 'android_app' then 'package' end] then false
      when p_type = 'person' then
        (p ->> 'contact_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      when p_type = 'domain' then (p ->> 'domain') ~ '^[a-z0-9.-]+\.[a-z]{2,}$'
      when p_type = 'keyword' then
        case when jsonb_typeof(p -> 'keywords') <> 'array' then false
             when jsonb_array_length(p -> 'keywords') not between 1 and 10 then false
             else not exists (
               select 1 from jsonb_array_elements(p -> 'keywords') as w (item)
               where case when jsonb_typeof(w.item) <> 'string' then true
                          else char_length(w.item #>> '{}') not between 1 and 100 end)
        end
      when p_type = 'category' then
        (p ->> 'category') in ('important', 'awaiting_my_reply', 'awaiting_their_reply', 'has_deadline', 'informational',
                               'low_priority', 'promotions')
      when p_type = 'sender' then (p ->> 'address') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      when p_type = 'android_app' then (p ->> 'package') ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      else false
    end, false)
  $$;

-- ═══ Baseline for every table (§3.1) ═══════════════════════════════════════════════════════════
do $$
declare
  t record;
begin
  for t in select c.relname from pg_catalog.pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('alter table public.%I force row level security', t.relname);
    execute format('revoke all on table public.%I from public, anon, authenticated', t.relname);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t.relname);
  end loop;
end
$$;

-- Append-only tables (§3.6): nobody updates or deletes, not even the secret key.
revoke update, delete, truncate on table public.audit_logs from public, anon, authenticated, service_role;
revoke update, delete, truncate on table public.approval_events from public, anon, authenticated, service_role;
revoke update, truncate on table public.support_notes from public, anon, authenticated, service_role;

-- Sequences: only the secret key.
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

-- private tables (never exposed through PostgREST).
revoke all on table private.demo_fixture_state, private.admin_role_permissions from public, anon, authenticated;
grant select, insert, update, delete on table private.demo_fixture_state to service_role;
grant select on table private.admin_role_permissions to service_role;

-- Future objects created by the migration role get no client privileges by default.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema admin_api revoke execute on functions from public, anon;
alter default privileges in schema private revoke execute on functions from public;

-- ═══ Column-subset select grants (hidden: cursors, hashes, secrets, embeddings; §3.4) ═══════════
-- grant select on every column of the table except the listed ones.
do $$
declare
  r record;
  v_cols text;
begin
  for r in select * from (values
      ('user_preferences', array[]::text[]),
      ('notification_preferences', array[]::text[]),
      ('connected_accounts', array[]::text[]),
      ('calendars', array[]::text[]),
      ('email_threads', array['analysis_hash']),
      ('email_messages', array['content_hash', 'references_ids']),
      ('calendar_events', array[]::text[]),
      ('tasks', array[]::text[]),
      ('commitments', array[]::text[]),
      ('reminders', array[]::text[]),
      ('meeting_notes', array[]::text[]),
      ('meeting_preps', array['input_hash']),
      ('contacts', array[]::text[]),
      ('vip_people', array[]::text[]),
      ('life_events', array[]::text[]),
      ('captures', array[]::text[]),
      ('android_notification_signals', array[]::text[]),
      ('priority_rules', array[]::text[]),
      ('learned_preferences', array[]::text[]),
      ('insights', array[]::text[]),
      ('briefings', array[]::text[]),
      ('briefing_items', array[]::text[]),
      ('reply_drafts', array[]::text[]),
      ('approval_actions', array['device_token_hash']),
      ('approval_events', array[]::text[]),
      ('assistant_threads', array[]::text[]),
      ('assistant_messages', array[]::text[]),
      ('memory_chunks', array['embedding', 'embedding_dr']),
      ('ai_feedback', array[]::text[]),
      ('ai_usage_daily', array[]::text[]),
      ('notifications', array[]::text[]),
      ('entitlement_grants', array[]::text[]),
      ('referral_codes', array[]::text[]),
      ('referral_credits', array[]::text[]),
      ('announcement_dismissals', array[]::text[]),
      ('data_export_requests', array[]::text[]),
      ('data_deletion_requests', array['subject_hash', 'subject_email_hash', 'status_token_hash'])
    ) as v (table_name, hidden)
  loop
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_catalog.pg_attribute a
    where a.attrelid = format('public.%I', r.table_name)::regclass and a.attnum > 0 and not a.attisdropped
      and not (a.attname = any(r.hidden));
    execute format('grant select (%s) on table public.%I to authenticated', v_cols, r.table_name);
  end loop;
end
$$;

-- Explicit column lists from §4.
grant select (user_id, display_name, avatar_path, locale, state, onboarding_step, onboarding_completed_at, terms_accepted_at,
              terms_version, created_at, updated_at)
  on table public.profiles to authenticated;
grant select (id, user_id, installation_id, platform, app_version, push_enabled, ni_listener_granted, ni_mode,
              ni_allowed_packages, ni_last_signal_at, platform_capabilities, last_seen_at, created_at)
  on table public.app_installations to authenticated;
grant select (id, user_id, installation_id, status, disabled_reason, last_registered_at, created_at)
  on table public.push_tokens to authenticated;
grant select (id, user_id, connected_account_id, calendar_id, resource, status, last_success_at, last_incremental_sync_at,
              last_error_code, last_error_at, created_at, updated_at)
  on table public.sync_states to authenticated;
grant select (user_id, entitlement, is_active, status, store, product_id, period_type, expires_at, will_renew,
              billing_issue_at, synced_at)
  on table public.subscriptions to authenticated;
grant select (id, public_ref, user_id, category, status, subject, created_at, updated_at)
  on table public.support_tickets to authenticated;
grant select on table public.plan_limits to authenticated;
revoke all on table public.connected_account_sync_health from public, anon, authenticated;
grant select on table public.connected_account_sync_health to authenticated, service_role;

-- ═══ Column update / insert grants (state machines, provenance and AI output never) ═══════════
grant update (display_name, avatar_path, locale, onboarding_step, onboarding_completed_at, terms_accepted_at, terms_version)
  on table public.profiles to authenticated;

do $$
declare
  r record;
  v_cols text;
begin
  for r in select * from (values
      ('user_preferences', array['user_id', 'first_analysis_job_id', 'created_at', 'updated_at']),
      ('notification_preferences', array['user_id', 'snooze_until', 'created_at', 'updated_at'])
    ) as v (table_name, fixed)
  loop
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_catalog.pg_attribute a
    where a.attrelid = format('public.%I', r.table_name)::regclass and a.attnum > 0 and not a.attisdropped
      and not (a.attname = any(r.fixed));
    execute format('grant update (%s) on table public.%I to authenticated', v_cols, r.table_name);
  end loop;
end
$$;

grant update (selected) on table public.calendars to authenticated;
grant insert (user_id, title, notes_excerpt, due_date, due_at, status, origin) on table public.tasks to authenticated;
grant update (title, notes_excerpt, due_date, due_at, status, completed_at) on table public.tasks to authenticated;
grant delete on table public.tasks to authenticated;
grant update (status, snoozed_until, due_at, due_is_date_only, completed_at, cancelled_at) on table public.commitments to authenticated;
grant update (body) on table public.meeting_notes to authenticated;
grant delete on table public.meeting_notes to authenticated;
grant insert (user_id, display_name, primary_email, emails, avatar_seed, origin) on table public.contacts to authenticated;
grant update (display_name, organization) on table public.contacts to authenticated;
grant insert (user_id, contact_id, relationship, always_notify, bypass_quiet_hours, note, origin)
  on table public.vip_people to authenticated;
grant update (relationship, always_notify, bypass_quiet_hours, note) on table public.vip_people to authenticated;
grant delete on table public.vip_people to authenticated;
grant update (status, snoozed_until, resolved_at, suppressed) on table public.life_events to authenticated;
grant update (status) on table public.captures to authenticated;
grant delete on table public.android_notification_signals to authenticated;
grant insert (user_id, condition_type, condition_value, outcome, search_body, exceptions, applies_to, enabled, sort_order)
  on table public.priority_rules to authenticated;
grant update (condition_value, outcome, search_body, exceptions, applies_to, enabled, sort_order, deleted_at)
  on table public.priority_rules to authenticated;
grant update (enabled, priority_override, deleted_at) on table public.learned_preferences to authenticated;
grant update (status, snoozed_until, done_at, dismissed_at) on table public.insights to authenticated;
grant update (opened_at) on table public.briefings to authenticated;
grant update (title, archived_at) on table public.assistant_threads to authenticated;
grant delete on table public.assistant_threads to authenticated;
grant insert (user_id, feature, target_type, target_id, rating, reason_code, comment, detail, client_mutation_id)
  on table public.ai_feedback to authenticated;
grant update (rating, reason_code, comment) on table public.ai_feedback to authenticated;
grant delete on table public.ai_feedback to authenticated;
grant update (opened_at) on table public.notifications to authenticated;
grant insert (user_id, announcement_id) on table public.announcement_dismissals to authenticated;

-- ═══ Owner policies (§3.3 templates; `to authenticated` only) ══════════════════════════════════

-- OWN-R on every owner table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_preferences', 'notification_preferences', 'app_installations', 'push_tokens', 'connected_accounts',
    'calendars', 'sync_states', 'email_threads', 'email_messages', 'calendar_events', 'tasks', 'commitments', 'reminders',
    'meeting_notes', 'meeting_preps', 'contacts', 'vip_people', 'life_events', 'captures', 'android_notification_signals',
    'priority_rules', 'learned_preferences', 'insights', 'briefings', 'briefing_items', 'reply_drafts', 'approval_actions',
    'approval_events', 'assistant_threads', 'assistant_messages', 'memory_chunks', 'ai_feedback', 'ai_usage_daily',
    'notifications', 'subscriptions', 'entitlement_grants', 'referral_codes', 'referral_credits',
    'announcement_dismissals', 'data_export_requests', 'data_deletion_requests', 'support_tickets']
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
                   t || '_select_own', t);
  end loop;
end
$$;

-- OWN-U (plain).
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_preferences', 'notification_preferences', 'calendars', 'commitments', 'meeting_notes', 'contacts',
    'vip_people', 'life_events', 'priority_rules', 'learned_preferences', 'insights', 'briefings', 'assistant_threads',
    'ai_feedback', 'notifications']
  loop
    execute format('create policy %I on public.%I for update to authenticated '
                   'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
  end loop;
end
$$;

-- OWN-I (plain).
do $$
declare
  t text;
begin
  foreach t in array array['vip_people', 'priority_rules', 'ai_feedback', 'announcement_dismissals']
  loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
                   t || '_insert_own', t);
  end loop;
end
$$;

-- OWN-D (plain).
do $$
declare
  t text;
begin
  foreach t in array array['meeting_notes', 'vip_people', 'android_notification_signals', 'assistant_threads', 'ai_feedback']
  loop
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
                   t || '_delete_own', t);
  end loop;
end
$$;

-- tasks: only in-app tasks are client-writable; provider tasks change through approvals (M§115).
create policy tasks_insert_own on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id and connected_account_id is null and origin = 'user' and approval_action_id is null);
create policy tasks_update_own on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id and connected_account_id is null)
  with check ((select auth.uid()) = user_id and connected_account_id is null);
create policy tasks_delete_own on public.tasks for delete to authenticated
  using ((select auth.uid()) = user_id and connected_account_id is null);

-- contacts: manual contacts only (VIP "Kişi Ekle" by email).
create policy contacts_insert_own on public.contacts for insert to authenticated
  with check ((select auth.uid()) = user_id and origin = 'manual');

-- captures: the owner may only discard.
create policy captures_update_own on public.captures for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and status = 'discarded');

-- plan_limits: readable by every signed-in user (limits are not secrets).
create policy plan_limits_select_all on public.plan_limits for select to authenticated using (true);

-- ═══ Restrictive aal2 on admin-only tables (§3.5; defence in depth) ═════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_model_config', 'prompt_versions', 'ai_model_prices', 'ai_calibration_versions', 'billing_events', 'jobs',
    'system_health_checks', 'app_settings', 'metrics_daily', 'ai_metrics_daily', 'admin_users', 'admin_sessions',
    'admin_mfa_recovery_codes', 'audit_logs', 'support_notes', 'support_access_grants']
  loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated '
                   'using ((select auth.jwt() ->> ''aal'') = ''aal2'')', t || '_admin_aal2', t);
  end loop;
end
$$;
