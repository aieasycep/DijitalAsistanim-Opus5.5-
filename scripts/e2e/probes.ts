/**
 * Read-only harness probes (TEST_PLAN §9.1 `GET /state?user=&probe=`). A fixed allowlist: each
 * query receives the user's email as `:'p1'` and the probe argument (`approval:<id>`) as `:'p2'`
 * through psql variables, and returns one JSON document. Nothing here writes.
 */
const USER = `(select id from auth.users where lower(email) = lower(:'p1'))`;

export const PROBES = {
  connected_accounts: `select json_build_object('count', count(*), 'rows', coalesce(json_agg(json_build_object('provider', provider, 'status', status, 'demo_flavor', demo_flavor)), '[]'::json)) from public.connected_accounts where user_id = ${USER} and disconnected_at is null`,
  approvals_by_status: `select coalesce(json_object_agg(status, n), '{}'::json) from (select status, count(*) n from public.approval_actions where user_id = ${USER} group by status) s`,
  approval: `select json_build_object('status', status, 'payload_version', payload_version, 'idempotency_key', idempotency_key, 'approved_via', approved_via, 'batch_id', batch_id) from public.approval_actions where user_id = ${USER} and id = :'p2'::uuid`,
  emails_sent_via_approval: `select json_build_object('count', count(*)) from public.approval_actions where user_id = ${USER} and action_type = 'email_send' and status = 'executed'`,
  reminders_active: `select json_build_object('count', count(*), 'keys', count(distinct idempotency_key)) from public.reminders where user_id = ${USER} and status in ('scheduled', 'pending_approval', 'active')`,
  insight_status: `select json_build_object('status', status) from public.insights where user_id = ${USER} and dedupe_key = :'p2'`,
  entitlement: `select to_json(e) from public.effective_entitlement(${USER}) e`,
  briefing_today: `select json_build_object('status', status) from public.briefings where user_id = ${USER} and kind = :'p2' order by local_date desc limit 1`,
  export_request: `select json_build_object('status', status) from public.data_export_requests where user_id = ${USER} order by created_at desc limit 1`,
  deletion_request: `select json_build_object('status', status) from public.data_deletion_requests where user_id = ${USER} order by created_at desc limit 1`,
  referral_state: `select json_build_object('status', status, 'rewarded', rewarded_at is not null) from public.referrals where referrer_id = ${USER} or referee_id = ${USER} order by created_at desc limit 1`,
  analytics_event_names: `select json_build_object('names', coalesce(json_agg(distinct event_name), '[]'::json)) from public.analytics_events where user_id = ${USER}`,
  commitments: `select json_build_object('count', count(*)) from public.commitments where user_id = ${USER} and status <> 'cancelled'`,
  announcement_dismissals: `select json_build_object('count', count(*)) from public.announcement_dismissals where user_id = ${USER}`,
  ai_feedback: `select json_build_object('count', count(*)) from public.ai_feedback where user_id = ${USER} and (:'p2' = '' or target_id::text = :'p2')`,
  ani_signals: `select json_build_object('count', count(*)) from public.android_notification_signals where user_id = ${USER}`,
  oauth_state: `select json_build_object('completed', completed_at is not null) from public.oauth_states where user_id = ${USER} order by created_at desc limit 1`,
  onboarding: `select json_build_object('completed', onboarding_completed_at is not null) from public.profiles where user_id = ${USER}`,
  retention: `select json_build_object('policy', retention_policy) from public.user_preferences where user_id = ${USER}`,
} as const;

export type ProbeName = keyof typeof PROBES;
