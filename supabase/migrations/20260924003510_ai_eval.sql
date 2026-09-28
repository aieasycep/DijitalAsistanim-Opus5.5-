-- GAP-4 · the `ai_eval` job (AI_PIPELINE_PLAN §5.4 "Gate run", §16.3; DATABASE_AND_RLS_PLAN §4.4
-- `prompt_versions.eval_report / eval_passed / eval_dataset_version`, `ai_model_config.eval_status`,
-- idempotency key `ai_eval:{feature}:{iso_week}`; BACKOFFICE_PLAN §6.11 "run eval").
--
-- · private.ai_eval_record: stores a finished gate run on the evaluated prompt version and, when that
--   version is the active one (or the suite has no prompt), the eval status of every model-config
--   row of the key's features whose primary target was evaluated; audited as
--   `system.ai_eval.recorded`. `private.model_eval_passed` already reads `eval_report.targets`.
-- · admin_api.ai_eval_request (`prompts.write`, aal2 through private.require_admin): queues the job
--   for one version with a coalescing key (a queued request per version and ISO week at a time; the
--   key is renamed on claim, so a later request runs again), audited as `prompt.tested`
--   with `details.run = 'eval'` (the BACKOFFICE_PLAN §10 catalogue has no separate eval action).
-- No table is added: results live on the rows the plan names; eval calls are `ai_requests` rows with
-- `feature_variant = 'eval'`.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

create function private.ai_eval_record(
  p_version uuid, p_features public.ai_feature[], p_report jsonb, p_passed boolean, p_dataset_version text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v public.prompt_versions;
  v_features public.ai_feature[] := coalesce(p_features, '{}'::public.ai_feature[]);
  v_rows integer := 0;
  v_update_status boolean := true;
begin
  if p_report is null or jsonb_typeof(p_report) <> 'object' or jsonb_typeof(p_report -> 'targets') <> 'array'
     or jsonb_array_length(p_report -> 'targets') = 0 then
    raise exception 'VALIDATION_FAILED:report' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_report -> 'targets') e
             where jsonb_typeof(e -> 'provider') is distinct from 'string'
                or jsonb_typeof(e -> 'model') is distinct from 'string'
                or jsonb_typeof(e -> 'passed') is distinct from 'boolean') then
    raise exception 'VALIDATION_FAILED:report.targets' using errcode = '22023';
  end if;
  if p_passed is null then
    raise exception 'VALIDATION_FAILED:passed' using errcode = '22023';
  end if;
  if p_dataset_version is null or char_length(p_dataset_version) not between 1 and 80 then
    raise exception 'VALIDATION_FAILED:dataset_version' using errcode = '22023';
  end if;
  if octet_length(p_report::text) > 65536 then
    raise exception 'VALIDATION_FAILED:report' using errcode = '22023';
  end if;

  if p_version is not null then
    select * into v from public.prompt_versions x where x.id = p_version for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    update public.prompt_versions x
      set eval_report = p_report, eval_passed = p_passed, eval_dataset_version = p_dataset_version
    where x.id = v.id;
    select coalesce(array_agg(f), '{}'::public.ai_feature[]) into v_features
    from unnest(enum_range(null::public.ai_feature)) f
    where private.prompt_key_for_feature(f) = v.prompt_key;
    -- A draft's run gates its activation; the routes keep the status of the active prompt.
    v_update_status := v.status = 'active';
  elsif cardinality(v_features) = 0 then
    raise exception 'VALIDATION_FAILED:features' using errcode = '22023';
  end if;

  if v_update_status then
    update public.ai_model_config c
      set eval_status = case
        when (select bool_and((e ->> 'passed')::boolean) from jsonb_array_elements(p_report -> 'targets') e
              where e ->> 'provider' = c.provider and e ->> 'model' = c.model) then 'passed'
        else 'failed' end
    where c.feature = any (v_features)
      and exists (select 1 from jsonb_array_elements(p_report -> 'targets') e
                  where e ->> 'provider' = c.provider and e ->> 'model' = c.model);
    get diagnostics v_rows = row_count;
  end if;

  perform private.audit_log_append(
    'system', null, null, 'system.ai_eval.recorded', 'prompt_version',
    coalesce(p_version::text, array_to_string(v_features, ',')), null, null,
    case when p_passed then 'success' else 'failure' end,
    jsonb_build_object('prompt_key', v.prompt_key, 'version', v.version, 'passed', p_passed,
                       'dataset_version', p_dataset_version, 'mode', p_report ->> 'mode',
                       'targets', p_report -> 'targets', 'model_rows', v_rows),
    null);
  return jsonb_build_object('prompt_version_id', p_version, 'prompt_key', v.prompt_key, 'version', v.version,
                            'passed', p_passed, 'model_rows', v_rows);
end
$$;

create function public.ai_eval_record(
  p_version uuid, p_features public.ai_feature[], p_report jsonb, p_passed boolean, p_dataset_version text
) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.ai_eval_record(p_version, p_features, p_report, p_passed, p_dataset_version) $$;

-- ADM-09 · request a gate run for one prompt version (the worker's `ai_eval` job does the work).
create function admin_api.ai_eval_request(p_key text, p_version integer, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_admin public.admin_users := private.require_admin('prompts.write');
  v_reason text := private.admin_require_reason(p_reason);
  v public.prompt_versions;
  v_feature public.ai_feature;
  v_key text;
  v_job uuid;
begin
  select * into v from public.prompt_versions x where x.prompt_key = p_key and x.version = p_version;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status = 'archived' then
    raise exception 'STATE_CONFLICT' using errcode = '55000';
  end if;
  select f into v_feature
  from unnest(enum_range(null::public.ai_feature)) with ordinality as u (f, n)
  where private.prompt_key_for_feature(f) = v.prompt_key
  order by n
  limit 1;
  if v_feature is null then
    raise exception 'VALIDATION_FAILED:key' using errcode = '22023';
  end if;
  v_key := 'ai_eval:' || v_feature::text || ':' || to_char(now() at time zone 'UTC', 'IYYY-"W"IW') || ':v'
           || v.version::text || ':pending';
  v_job := private.enqueue_job('ai_eval', v_key,
                               jsonb_build_object('prompt_key', v.prompt_key, 'prompt_version_id', v.id,
                                                  'trigger', 'admin'),
                               null, null, now(), 200, 3, null);
  perform private.admin_audit(v_admin, 'prompt.tested', 'prompt_version', v.id::text, null, v_reason,
                              jsonb_build_object('run', 'eval', 'prompt_key', v.prompt_key, 'version', v.version,
                                                 'job_id', v_job));
  return jsonb_build_object('prompt_key', v.prompt_key, 'version', v.version, 'prompt_version_id', v.id,
                            'job_id', v_job);
end
$$;

-- ═══ Function → permission map (pgTAP 120 is table-driven over it; the admin-api catalogue test
-- reads the latest full definition): every row of 20260924003000 plus ai_eval_request. ════════════
create or replace view private.admin_function_permissions as
  select v.function_name, v.permissions, v.all_permissions, v.guard
  from (values
    ('admin_me', null::text[], false, 'session'),
    ('admin_session_start', null, false, 'no_session'),
    ('admin_session_end', null, false, 'session'),
    ('admin_session_step_up', null, false, 'session'),
    ('session_expire', null, false, 'no_session'),
    ('sessions_list_own', null, false, 'session'),
    ('admin_preferences_get', null, false, 'session'),
    ('admin_preferences_set', null, false, 'session'),
    ('authorize', null, false, 'session'),
    ('audit_write', null, false, 'session'),
    ('audit_denied', null, false, 'session'),
    ('recovery_codes_store', null, false, 'session'),
    ('auth_status', null, false, 'gateway'),
    ('recovery_code_consume', null, false, 'aal1'),
    ('login_preflight', null, false, 'service_role'),
    ('login_attempt_record', null, false, 'service_role'),
    ('invite_redeem', null, false, 'service_role'),
    ('health_record', null, false, 'service_role'),
    ('dashboard_metrics', array['dashboard.read'], false, 'session'),
    ('dashboard_series', array['dashboard.read'], false, 'session'),
    ('metrics_ops', array['metrics.ops.read'], false, 'session'),
    ('metrics_product', array['metrics.product.read'], false, 'session'),
    ('security_events', array['admins.manage'], false, 'session'),
    ('users_list', array['users.read'], false, 'session'),
    ('user_lookup_email', array['users.read'], false, 'session'),
    ('user_overview', array['users.read'], false, 'session'),
    ('user_integrations', array['users.read', 'integrations.read'], true, 'session'),
    ('user_briefings', array['users.read', 'briefings.read'], true, 'session'),
    ('user_usage', array['users.read'], false, 'session'),
    ('user_subscription', array['users.read', 'subscriptions.read'], true, 'session'),
    ('user_referrals', array['users.read', 'referrals.read'], true, 'session'),
    ('user_support', array['users.read', 'support.read'], true, 'session'),
    ('user_audit', array['users.read', 'audit.read'], true, 'session'),
    ('user_devices', array['users.read', 'notifications.read'], true, 'session'),
    ('user_reveal_email', array['users.pii.reveal'], false, 'session'),
    ('user_force_sync', array['users.force_sync'], false, 'session'),
    ('user_disable', array['users.disable'], false, 'session'),
    ('user_restore', array['users.disable'], false, 'session'),
    ('user_mark_internal', array['users.mark_internal'], false, 'session'),
    ('tickets_list', array['support.read'], false, 'session'),
    ('ticket_detail', array['support.read'], false, 'session'),
    ('ticket_update', array['support.write'], false, 'session'),
    ('ticket_add_note', array['support.write'], false, 'session'),
    ('support_access_grant', array['support.access'], false, 'session'),
    ('support_access_revoke', array['support.access'], false, 'session'),
    ('support_access_authorize', array['support.access'], false, 'session'),
    ('integrations_overview', array['integrations.read'], false, 'session'),
    ('integrations_summary', array['integrations.read', 'metrics.ops.read'], false, 'session'),
    ('integration_detail', array['integrations.read'], false, 'session'),
    ('integration_disconnect', array['integrations.disconnect'], false, 'session'),
    ('integration_renew_watch', array['integrations.renew_watch'], false, 'session'),
    ('jobs_list', array['jobs.read'], false, 'session'),
    ('jobs_summary', array['jobs.read'], false, 'session'),
    ('job_detail', array['jobs.read'], false, 'session'),
    ('correlation_trace', array['jobs.read'], false, 'session'),
    ('job_retry', array['jobs.retry'], false, 'session'),
    ('job_retry_bulk', array['jobs.retry'], false, 'session'),
    ('job_cancel', array['jobs.cancel'], false, 'session'),
    ('briefings_metrics', array['briefings.read'], false, 'session'),
    ('briefings_list', array['briefings.read'], false, 'session'),
    ('briefing_regenerate', array['briefings.regenerate'], false, 'session'),
    ('notifications_metrics', array['notifications.read'], false, 'session'),
    ('notifications_user_debug', array['notifications.read'], false, 'session'),
    ('notification_send_test', array['push.test'], false, 'session'),
    ('ai_metrics', array['metrics.ai.read', 'ai.read'], false, 'session'),
    ('ai_cost_series', array['metrics.ai.read', 'ai.read'], false, 'session'),
    ('ai_requests_list', array['ai.read'], false, 'session'),
    ('ai_model_config_list', array['ai.read'], false, 'session'),
    ('ai_model_prices_list', array['ai.read'], false, 'session'),
    ('ai_model_config_update', array['ai.models.write'], false, 'session'),
    ('plan_routing_profile_set', array['ai.models.write'], false, 'session'),
    ('ai_model_prices_upsert', array['ai.models.write'], false, 'session'),
    ('ai_calibration_activate', array['ai.models.write'], false, 'session'),
    ('prompts_list', array['prompts.read'], false, 'session'),
    ('prompt_versions_list', array['prompts.read'], false, 'session'),
    ('prompt_version_get', array['prompts.read'], false, 'session'),
    ('prompt_diff', array['prompts.read'], false, 'session'),
    ('prompt_create_draft', array['prompts.write'], false, 'session'),
    ('prompt_update_draft', array['prompts.write'], false, 'session'),
    ('prompt_activate', array['prompts.activate'], false, 'session'),
    ('prompt_rollback', array['prompts.activate'], false, 'session'),
    ('prompt_archive', array['prompts.activate'], false, 'session'),
    ('ai_feedback_aggregate', array['ai_feedback.read'], false, 'session'),
    ('ai_feedback_list', array['ai_feedback.read'], false, 'session'),
    ('ai_feedback_reveal_comment', array['ai_feedback.reveal'], false, 'session'),
    ('subscriptions_metrics', array['subscriptions.read', 'metrics.revenue.read'], false, 'session'),
    ('subscriptions_list', array['subscriptions.read'], false, 'session'),
    ('billing_events_list', array['billing_events.read'], false, 'session'),
    ('billing_event_get', array['billing_events.read'], false, 'session'),
    ('trial_stream', array['subscriptions.read'], false, 'session'),
    ('entitlement_grants_list', array['subscriptions.read'], false, 'session'),
    ('subscription_resync', array['subscriptions.resync'], false, 'session'),
    ('entitlement_grant', array['entitlements.grant', 'entitlements.grant_limited'], false, 'session'),
    ('entitlement_revoke', array['entitlements.revoke'], false, 'session'),
    ('referrals_metrics', array['referrals.read'], false, 'session'),
    ('referrals_list', array['referrals.read'], false, 'session'),
    ('referral_review', array['referrals.review'], false, 'session'),
    ('feedback_list', array['feedback.read'], false, 'session'),
    ('feedback_summary', array['feedback.read'], false, 'session'),
    ('feedback_update', array['feedback.write'], false, 'session'),
    ('feedback_reveal', array['users.pii.reveal'], false, 'session'),
    ('flags_list', array['flags.read'], false, 'session'),
    ('flag_get', array['flags.read'], false, 'session'),
    ('flag_evaluate_preview', array['flags.read'], false, 'session'),
    ('flag_upsert', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_kill', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_archive', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_override_set', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('flag_override_delete', array['flags.write', 'flags.write_ai'], false, 'session'),
    ('announcements_list', array['announcements.read'], false, 'session'),
    ('announcement_get', array['announcements.read'], false, 'session'),
    ('announcement_audience_estimate', array['announcements.read'], false, 'session'),
    ('announcement_upsert', array['announcements.write'], false, 'session'),
    ('announcement_publish', array['announcements.write'], false, 'session'),
    ('announcement_cancel', array['announcements.write'], false, 'session'),
    ('data_requests_list', array['data_requests.read'], false, 'session'),
    ('data_request_get', array['data_requests.read'], false, 'session'),
    ('data_request_retry', array['data_requests.manage'], false, 'session'),
    ('data_request_cancel', array['data_requests.manage'], false, 'session'),
    ('export_regenerate', array['data_requests.manage'], false, 'session'),
    ('audit_list', array['audit.read'], false, 'session'),
    ('audit_get', array['audit.read'], false, 'session'),
    ('audit_verify', array['audit.read'], false, 'session'),
    ('health_latest', array['health.read'], false, 'session'),
    ('health_history', array['health.read'], false, 'session'),
    ('app_versions_breakdown', array['health.read'], false, 'session'),
    ('cron_status', array['health.read'], false, 'session'),
    ('admins_list', array['admins.read'], false, 'session'),
    ('admin_invite_record', array['admins.manage'], false, 'session'),
    ('admin_invite_rotate', array['admins.manage'], false, 'session'),
    ('admin_update_role', array['admins.manage'], false, 'session'),
    ('admin_disable', array['admins.manage'], false, 'session'),
    ('admin_enable', array['admins.manage'], false, 'session'),
    ('admin_sessions_revoke_all', array['admins.manage'], false, 'session'),
    ('admin_mfa_reset', array['admins.manage'], false, 'session'),
    ('admin_unlock', array['admins.manage'], false, 'session'),
    ('settings_get', null, false, 'session'),
    ('settings_update', array['settings.system.write'], false, 'session'),
    ('plan_limits_list', null, false, 'session'),
    ('plan_limits_update', array['settings.system.write'], false, 'session'),
    ('command_search', array['search.global'], false, 'session'),
    ('ticket_patch', array['support.write'], false, 'session'),
    ('ticket_reply', array['support.write'], false, 'session'),
    ('notification_test_preview', array['push.test'], false, 'session'),
    ('job_retry_selected', array['jobs.retry'], false, 'session'),
    ('ai_eval_request', array['prompts.write'], false, 'session')
  ) as v (function_name, permissions, all_permissions, guard);
revoke all on private.admin_function_permissions from public;

revoke execute on function private.ai_eval_record(uuid, public.ai_feature[], jsonb, boolean, text) from public;
revoke execute on function public.ai_eval_record(uuid, public.ai_feature[], jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function public.ai_eval_record(uuid, public.ai_feature[], jsonb, boolean, text) to service_role;
revoke execute on function admin_api.ai_eval_request(text, integer, text) from public, anon;
grant execute on function admin_api.ai_eval_request(text, integer, text) to authenticated;
