/**
 * Analytics event catalogue (R-21; SECURITY_AND_PRIVACY_PLAN §4.9; ADR-13).
 *
 * The single allow-list of first-party analytics events: the union of the "Analytics events"
 * fields of every SCREEN_AND_FLOW_MAP block (Parts 1–5, including the per-part allow-list tables
 * and the web event table) and the backend events of API_CONTRACTS §17.1. Explicit prop values
 * from the docs are kept; props documented without values get a closed vocabulary (`vocab.ts`,
 * `enums.ts`). `test/analytics/catalog-drift.test.ts` fails when a screen-map event is missing.
 *
 * Props never carry content: only closed enums, booleans, bounded integers, screen IDs, allow-listed
 * route patterns and fixed catalog keys. There are no names, subjects, e-mail addresses, amounts,
 * URLs, ids or free text (M§42).
 */
import { ROUTE_PATTERNS } from '../deeplinks.ts';
import {
  ACCOUNT_STATUS_VALUES,
  APPROVAL_ACTION_TYPE_VALUES,
  APPROVAL_STATUS_VALUES,
  BRIEFING_KIND_VALUES,
  CAPABILITY_VALUES,
  CAPTURE_KIND_VALUES,
  COMMITMENT_DIRECTION_VALUES,
  COMMITMENT_STATUS_VALUES,
  DECISION_TIER_VALUES,
  EXTRACTED_ENTITY_TYPE_VALUES,
  FEEDBACK_TYPE_VALUES,
  FLOW_CARD_TYPE_VALUES,
  INSIGHT_KIND_VALUES,
  ITEM_STATUS_VALUES,
  LIFE_EVENT_TYPE_VALUES,
  MAIL_CATEGORY_VALUES,
  NOTIFICATION_CATEGORY_VALUES,
  NOTIFICATION_DETAIL_VALUES,
  PROVIDER_VALUES,
  RETENTION_POLICY_VALUES,
  RULE_CONDITION_VALUES,
  RULE_OUTCOME_VALUES,
  SOURCE_TYPE_VALUES,
  TICKET_CATEGORY_VALUES,
} from '../enums.ts';
import { REMINDER_PRESETS } from '../reminders/presets.ts';
import {
  APPROVAL_ORIGINS,
  AUTH_METHODS,
  BRIEFING_SECTIONS,
  DATA_SOURCE_TOGGLES,
  ENTITY_TYPES,
  ERROR_CODES,
  FEEDBACK_KINDS,
  FLOW_FILTERS,
  HERO_MODES,
  ONBOARDING_STEPS,
  PAYWALL_SOURCES,
  ANALYTICS_PERMISSIONS,
  ANALYTICS_PRO_FEATURES,
  REMINDER_ORIGINS,
  REPLY_TONES,
  SETTINGS_ROWS,
  SHEET_KEYS,
  STATE_IDS,
  STATE_VARIANTS,
  TIME_OF_DAY,
  TOAST_ORIGINS,
  WEB_PLACEMENTS,
} from './vocab.ts';

export type AnalyticsPropSpec =
  | { readonly type: 'enum'; readonly values: readonly string[] }
  | { readonly type: 'boolean' }
  | {
      readonly type: 'int';
      readonly min: number;
      readonly max: number;
      readonly values?: readonly number[];
    }
  /** A Screen ID from SCREEN_AND_FLOW_MAP (`M-SET-01`, `W-LEGAL-01`). */
  | { readonly type: 'screen_id' }
  /** An allow-listed route pattern (ids replaced by `:id`) or `unknown`. */
  | { readonly type: 'route_pattern' }
  /** A key of a fixed catalog owned by `packages/i18n` (FAQ keys, suggested prompt keys). */
  | { readonly type: 'catalog_key'; readonly catalog: string };

/** Who emits the event: the apps, the Edge Functions, the marketing web, or both apps and server. */
export type AnalyticsSource = 'client' | 'server' | 'web' | 'both';

export interface AnalyticsEventSpec {
  readonly source: AnalyticsSource;
  readonly props: Readonly<Record<string, AnalyticsPropSpec>>;
}

const e = <const T extends readonly string[]>(
  ...values: T
): { readonly type: 'enum'; readonly values: T } => ({
  type: 'enum',
  values: [...new Set(values)] as unknown as T,
});
const B = { type: 'boolean' } as const;
const int = (min: number, max: number) => ({ type: 'int', min, max }) as const;
const ints = (...values: number[]) =>
  ({ type: 'int', min: Math.min(...values), max: Math.max(...values), values }) as const;
const SCREEN = { type: 'screen_id' } as const;
const ROUTE = { type: 'route_pattern' } as const;
const catalog = (name: string) => ({ type: 'catalog_key', catalog: name }) as const;
const ev = <const P extends Readonly<Record<string, AnalyticsPropSpec>>>(
  source: AnalyticsSource,
  props: P,
) => ({
  source,
  props,
});

/** Props allowed on every event (SCREEN_AND_FLOW_MAP §0.9): the Screen ID and the plan. */
export const ANALYTICS_COMMON_PROPS = { screen: SCREEN, is_pro: B } as const;

export const ANALYTICS_EVENTS = {
  app_opened: ev('client', { source: e('cold', 'warm', 'push', 'widget', 'deeplink') }),
  app_backgrounded: ev('client', { session_s: int(0, 86400) }),
  entry_resolved: ev('client', {
    target: e('welcome', 'sign_in', 'onboarding_step', 'today', 'update_required'),
    step: e(...ONBOARDING_STEPS),
  }),
  tab_selected: ev('client', { tab: e('today', 'flow', 'plan', 'assistant'), reselect: B }),
  approvals_chip_tapped: ev('client', { count_bucket: e('1', '2-5', '6+') }),
  avatar_tapped: ev('client', {}),
  search_opened: ev('client', { from: e('today', 'flow', 'plan', 'assistant') }),
  toast_action_tapped: ev('client', {
    action: e('undo', 'view', 'open'),
    origin: e(...TOAST_ORIGINS),
  }),
  sheet_opened: ev('client', { key: e(...SHEET_KEYS) }),
  sheet_dismissed: ev('client', {
    key: e(...SHEET_KEYS),
    via: e('scrim', 'drag', 'back', 'action'),
  }),
  deep_link_opened: ev('client', {
    route_pattern: ROUTE,
    source: e('link', 'widget', 'notification'),
    guarded: B,
  }),
  notification_opened: ev('client', {
    category: e(...NOTIFICATION_CATEGORY_VALUES),
    app_state: e('cold', 'background', 'foreground'),
  }),
  offline_banner_shown: ev('client', { screen: SCREEN }),
  offline_refresh_tapped: ev('client', { result: e('online', 'still_offline') }),
  error_boundary_shown: ev('client', {
    route_pattern: ROUTE,
    error_class: e('render', 'network', 'chunk_load', 'unknown'),
  }),
  not_found_shown: ev('client', { path_pattern: ROUTE }),
  update_required_shown: ev('client', { current: int(0, 999999), min: int(0, 999999) }),
  pro_gate_viewed: ev('client', {
    feature: e(...ANALYTICS_PRO_FEATURES),
    surface: e('sheet', 'inline', 'screen', 'card', 'settings', 'banner'),
    gate: e(...ANALYTICS_PRO_FEATURES),
    context: e('sheet', 'inline', 'screen'),
  }),
  pro_gate_cta_tapped: ev('client', {
    feature: e(...ANALYTICS_PRO_FEATURES),
    trial: B,
    surface: e('sheet', 'inline', 'screen', 'card', 'settings', 'banner'),
  }),
  pro_gate_dismissed: ev('client', {
    feature: e(...ANALYTICS_PRO_FEATURES),
    gate: e(...ANALYTICS_PRO_FEATURES),
  }),
  mini_player_action: ev('client', { action: e('play', 'pause', 'expand', 'close') }),
  auth_screen_viewed: ev('client', { mode: e('sign_in', 'sign_up') }),
  auth_method_selected: ev('client', { method: e(...AUTH_METHODS), mode: e('sign_in', 'sign_up') }),
  auth_succeeded: ev('client', { method: e(...AUTH_METHODS), is_new_user: B }),
  auth_failed: ev('client', {
    method: e(...AUTH_METHODS),
    code: e('cancelled', 'network', 'provider', 'not_configured', 'play_services'),
  }),
  auth_otp_requested: ev('client', { mode: e('sign_in', 'sign_up') }),
  auth_otp_request_failed: ev('client', { code: e(...ERROR_CODES) }),
  auth_otp_verified: ev('client', { mode: e('sign_in', 'sign_up'), is_new_user: B }),
  auth_otp_failed: ev('client', { code: e('invalid', 'expired', 'rate_limited') }),
  auth_otp_resent: ev('client', {}),
  auth_new_account_notice: ev('client', { choice: e('continue', 'switch') }),
  onboarding_step_viewed: ev('client', { step: e(...ONBOARDING_STEPS) }),
  onboarding_signin_link_tapped: ev('client', {}),
  onboarding_skipped: ev('client', { step: e(...ONBOARDING_STEPS) }),
  integration_connect_started: ev('client', {
    provider: e(...PROVIDER_VALUES),
    capability: e(...CAPABILITY_VALUES),
  }),
  integration_connect_result: ev('client', {
    provider: e(...PROVIDER_VALUES),
    capability: e(...CAPABILITY_VALUES),
    result: e(
      'success',
      'cancelled',
      'error',
      'partial',
      'admin_consent_required',
      'not_configured',
      'pro_required',
    ),
  }),
  integration_explainer_viewed: ev('client', {
    provider: e(...PROVIDER_VALUES),
    capability: e(...CAPABILITY_VALUES),
  }),
  integration_explainer_dismissed: ev('client', { provider: e(...PROVIDER_VALUES) }),
  integration_disconnect_confirmed: ev('client', {
    provider: e(...PROVIDER_VALUES),
    context: e('onboarding', 'settings'),
  }),
  integration_admin_consent_shared: ev('client', {}),
  sign_out: ev('client', {
    context: e('onboarding', 'settings'),
    scope: e('this', 'global'),
    offline: B,
  }),
  calendar_os_permission_result: ev('client', { status: e('granted', 'denied', 'blocked') }),
  integration_explainer_chip_changed: ev('client', {
    chip: e('google', 'microsoft', 'apple', 'device'),
  }),
  calendar_picker_saved: ev('client', {
    selected_count: int(0, 10000),
    total_count: int(0, 10000),
    source: e('cloud', 'device'),
  }),
  calendar_denied_shown: ev('client', {}),
  calendar_denied_open_settings: ev('client', {}),
  calendar_denied_skip: ev('client', {}),
  data_source_toggled: ev('client', {
    toggle: e(...DATA_SOURCE_TOGGLES),
    value: B,
    key: e(...DATA_SOURCE_TOGGLES),
    enabled: B,
  }),
  personalization_saved: ev('client', { count: int(0, 10000), all: B }),
  briefing_schedule_saved: ev('client', {
    morning: e(...TIME_OF_DAY),
    midday: e(...TIME_OF_DAY),
    evening: e(...TIME_OF_DAY),
    weekend_enabled: B,
    changed_fields: int(0, 10000),
  }),
  vip_selected: ev('client', {
    count: int(0, 10000),
    from_suggestions: int(0, 10000),
    manual: int(0, 10000),
  }),
  vip_manual_added: ev('client', {}),
  first_analysis_started: ev('client', { sources: int(0, 10000) }),
  first_analysis_completed: ev('client', {
    duration_s: int(0, 86400),
    mail_bucket: e('0', '1-50', '51-200', '201+'),
    important_count: int(0, 10000),
    event_count: int(0, 10000),
    followup_count: int(0, 10000),
  }),
  first_analysis_slow_continue: ev('client', {}),
  first_analysis_failed: ev('client', { error_code: e(...ERROR_CODES) }),
  first_analysis_retry: ev('client', {}),
  aha_viewed: ev('client', { findings_count: int(0, 10000), has_briefing: B }),
  notification_prompt_viewed: ev('client', {
    context: e('onboarding', 'device', 'first_briefing'),
  }),
  notification_permission_result: ev('client', {
    status: e('granted', 'denied', 'blocked'),
    context: e('onboarding', 'device', 'first_briefing'),
  }),
  notification_prompt_deferred: ev('client', {}),
  android_ni_prompt_viewed: ev('client', {}),
  android_ni_result: ev('client', { granted: B, mode: e('all', 'selected') }),
  onboarding_completed: ev('client', {
    mail_connected: B,
    calendar_connected: B,
    skipped_count: int(0, 10000),
    duration_s: int(0, 86400),
  }),
  today_viewed: ev('client', {
    hero_mode: e(...HERO_MODES),
    priorities_count: int(0, 10000),
    has_alert: B,
  }),
  today_hero_cta: ev('client', {
    mode: e(...HERO_MODES),
    cta: e('primary', 'listen', 'secondary'),
  }),
  priority_opened: ev('client', { kind: e(...INSIGHT_KIND_VALUES) }),
  priority_action: ev('client', {
    kind: e(...INSIGHT_KIND_VALUES),
    action: e(
      'reply',
      'remind',
      'prepare',
      'calendar',
      'followup_draft',
      'remind_tomorrow',
      'track',
      'open',
      'done',
      'snooze',
      'dismiss',
    ),
  }),
  priority_complete: ev('client', {
    kind: e(...INSIGHT_KIND_VALUES),
    via: e('button', 'swipe', 'a11y'),
  }),
  priority_undo: ev('client', { action: e('done', 'snooze', 'dismiss', 'feedback') }),
  priority_snoozed: ev('client', {
    preset: e('tonight', 'tomorrow_morning', 'tomorrow', 'next_week', 'custom'),
    entity: e(...ENTITY_TYPES),
  }),
  priority_feedback: ev('client', {
    kind: e(...INSIGHT_KIND_VALUES),
    feedback: e(...FEEDBACK_KINDS),
    learning_on: B,
  }),
  today_section_tapped: ev('client', {
    section: e(
      'priorities',
      'meeting',
      'deadline',
      'follow_up',
      'life',
      'approvals',
      'briefing',
      'weekly',
      'announcement',
    ),
  }),
  today_refreshed: ev('client', { accounts: int(0, 10000) }),
  account_alert_action: ev('client', {
    code: e(
      'needs_reauth',
      'partial',
      'admin_consent_required',
      'error',
      'sync_delayed',
      'disconnected',
    ),
    action: e('reconnect', 'details', 'dismiss'),
  }),
  weekly_card_opened: ev('client', {}),
  announcement_viewed: ev('client', { has_cta: B }),
  announcement_dismissed: ev('client', {}),
  announcement_cta_tapped: ev('client', {}),
  priority_feedback_undone: ev('client', { feedback: e(...FEEDBACK_KINDS) }),
  rule_create_from_insight: ev('client', {}),
  why_important_opened: ev('client', {
    decision_tier: e(...DECISION_TIER_VALUES),
    confidence_bucket: e('<0.7', '>=0.7'),
  }),
  why_source_opened: ev('client', { source_type: e(...SOURCE_TYPE_VALUES) }),
  briefing_opened: ev('client', {
    kind: e(...BRIEFING_KIND_VALUES),
    via: e('today', 'push', 'widget', 'history', 'onboarding'),
  }),
  briefing_item_opened: ev('client', {
    section: e(...BRIEFING_SECTIONS),
    entity_type: e(...ENTITY_TYPES),
  }),
  briefing_feedback: ev('client', { rating: e('up', 'down') }),
  briefing_read_to_end: ev('client', { kind: e(...BRIEFING_KIND_VALUES) }),
  notification_reprompt_result: ev('client', { status: e('granted', 'denied', 'blocked') }),
  briefing_audio_played: ev('client', {
    kind: e(...BRIEFING_KIND_VALUES),
    mode: e('premium_tts', 'native_tts'),
    completion_bucket: ints(0, 25, 50, 75, 100),
  }),
  briefing_audio_pause: ev('client', {}),
  briefing_audio_seek: ev('client', { method: e('skip', 'scrub', 'chapter') }),
  briefing_audio_speed_changed: ev('client', { rate: e('0.75', '1', '1.25', '1.5', '2') }),
  briefing_audio_fallback: ev('client', {
    reason: e('premium_unavailable', 'network', 'generation_failed', 'tts_unavailable'),
  }),
  midday_action: ev('client', {
    action: e('propose_slot', 'see_options', 'followup_draft', 'ask_in_meeting'),
  }),
  midday_no_delta_viewed: ev('client', {}),
  evening_item_completed: ev('client', { entity_type: e(...ENTITY_TYPES) }),
  evening_ready_opened: ev('client', {}),
  evening_ready_confirmed: ev('client', {
    carried_count: int(0, 10000),
    excluded_count: int(0, 10000),
    quiet: B,
  }),
  weekly_open: ev('client', { source: e('today', 'push', 'widget', 'history', 'deeplink') }),
  weekly_person_opened: ev('client', {}),
  weekly_plan_suggestion_tapped: ev('client', {}),
  weekly_share_opened: ev('client', {}),
  weekly_share_format_changed: ev('client', { format: e('4:5', '9:16') }),
  weekly_share_completed: ev('client', { format: e('4:5', '9:16'), with_invite: B }),
  briefing_history_opened: ev('client', {}),
  flow_view: ev('client', { filter: e(...FLOW_FILTERS) }),
  flow_filter_select: ev('client', { filter: e(...FLOW_FILTERS) }),
  flow_card_open: ev('client', { card_type: e(...FLOW_CARD_TYPE_VALUES) }),
  flow_card_action: ev('client', {
    card_type: e(...FLOW_CARD_TYPE_VALUES),
    action: e(
      'reply',
      'remind',
      'prepare',
      'calendar',
      'followup_draft',
      'remind_tomorrow',
      'track',
      'open',
      'done',
      'snooze',
      'dismiss',
    ),
  }),
  flow_swipe: ev('client', {
    direction: e('left', 'right'),
    action: e('done', 'snooze', 'dismiss', 'not_important', 'remind'),
    card_type: e(...FLOW_CARD_TYPE_VALUES),
  }),
  insight_status_change: ev('client', {
    from: e(...ITEM_STATUS_VALUES),
    to: e(...ITEM_STATUS_VALUES),
    via: e('swipe', 'button', 'a11y'),
  }),
  insight_feedback: ev('client', { kind: e(...FEEDBACK_KINDS) }),
  flow_refresh: ev('client', { result: e('ok', 'error', 'offline') }),
  offline_blocked_action: ev('client', {
    action: e(
      'reply',
      'approve',
      'reject',
      'capture',
      'assistant',
      'search',
      'sync',
      'connect',
      'smart_reminder',
      'export',
      'delete',
    ),
  }),
  mail_intel_view: ev('client', { accounts_count: int(0, 10000), has_pending_analysis: B }),
  mail_category_open: ev('client', { category: e(...MAIL_CATEGORY_VALUES) }),
  mail_card_action: ev('client', {
    action: e('open', 'reply', 'remind', 'done', 'not_important', 'vip'),
  }),
  mail_category_list_view: ev('client', { category: e(...MAIL_CATEGORY_VALUES) }),
  mail_card_open: ev('client', { category: e(...MAIL_CATEGORY_VALUES) }),
  email_detail_view: ev('client', {
    category: e(...MAIL_CATEGORY_VALUES),
    ai_status: e('pending', 't0_final', 'classified', 'skipped', 'failed'),
    has_draft: B,
  }),
  email_action: ev('client', { action: e('reply', 'task', 'calendar', 'remind') }),
  email_original_expand: ev('client', { result: e('ok', 'error', 'offline', 'gone') }),
  email_thread_open: ev('client', {}),
  source_sheet_open: ev('client', {
    origin: e(
      'email_detail',
      'today',
      'flow',
      'briefing',
      'life',
      'commitment',
      'capture',
      'assistant',
      'approval',
      'plan',
      'person',
    ),
    target_type: e(...ENTITY_TYPES),
    decision_tier: e(...DECISION_TIER_VALUES),
  }),
  email_provider_handoff: ev('client', { provider: e(...PROVIDER_VALUES) }),
  vip_toggle: ev('client', { on: B }),
  rule_create_start: ev('client', { origin: e('mail', 'flow', 'today', 'settings', 'person') }),
  external_link_open: ev('client', {
    context: e('email', 'life', 'event', 'capture', 'assistant', 'help', 'onboarding', 'settings'),
    mismatch: B,
  }),
  reply_draft_created: ev('client', {
    tone: e(...REPLY_TONES),
    result: e('ok', 'error', 'budget_exhausted', 'offline'),
  }),
  follow_up_draft_created: ev('client', {
    tone: e(...REPLY_TONES),
    result: e('ok', 'error', 'budget_exhausted', 'offline'),
  }),
  reply_tone_change: ev('client', { tone: e(...REPLY_TONES) }),
  reply_assist: ev('client', { kind: e('shorten', 'attach') }),
  reply_draft_edit: ev('client', {}),
  reply_submit: ev('client', { mode: e('reply', 'follow_up') }),
  send_scope_upgrade_start: ev('client', { provider: e(...PROVIDER_VALUES) }),
  send_scope_upgrade_result: ev('client', { result: e('granted', 'denied', 'cancelled', 'error') }),
  approval_decided: ev('client', {
    action_type: e(...APPROVAL_ACTION_TYPE_VALUES),
    decision: e('approved', 'rejected', 'cancelled'),
    via: e('in_place', 'approval_center', 'inline_sheet', 'capture_batch', 'voice_card'),
    origin: e(...APPROVAL_ORIGINS),
    type: e(...APPROVAL_ACTION_TYPE_VALUES),
  }),
  approval_execution_result: ev('client', {
    action_type: e(...APPROVAL_ACTION_TYPE_VALUES),
    status: e('executed', 'failed'),
    error_code: e(...ERROR_CODES),
  }),
  scope_upgrade_view: ev('client', {
    capability: e(...CAPABILITY_VALUES),
    provider: e(...PROVIDER_VALUES),
  }),
  scope_upgrade_result: ev('client', {
    capability: e(...CAPABILITY_VALUES),
    result: e('granted', 'denied', 'cancelled', 'error'),
  }),
  reply_recipients_edit: ev('client', {
    added: int(0, 10000),
    removed: int(0, 10000),
    reply_all: B,
  }),
  reply_tone_overwrite: ev('client', { confirmed: B }),
  reply_draft_close: ev('client', { kept: B }),
  waiting_view: ev('client', { count_bucket: e('0', '1', '2-5', '6-20', '20+') }),
  waiting_action: ev('client', {
    action: e('reply', 'open', 'remind', 'done', 'snooze', 'dismiss'),
  }),
  followup_view: ev('client', {}),
  follow_up_actioned: ev('client', {
    action: e('draft', 'remind_tomorrow', 'close', 'stop_tracking', 'call', 'snooze', 'dismiss'),
  }),
  commitment_view: ev('client', { direction: e(...COMMITMENT_DIRECTION_VALUES) }),
  commitment_action: ev('client', {
    action: e('done', 'snooze', 'source', 'followup_draft', 'reopen'),
  }),
  commitment_confirm: ev('client', { decision: e('confirmed', 'rejected') }),
  commitment_detail_view: ev('client', {
    direction: e(...COMMITMENT_DIRECTION_VALUES),
    status: e(...COMMITMENT_STATUS_VALUES),
  }),
  commitment_edit: ev('client', { fields_changed_count: int(0, 10000) }),
  ai_correction: ev('client', { target: e(...ENTITY_TYPES), kind: e(...FEEDBACK_KINDS) }),
  life_detail_view: ev('client', { type: e(...LIFE_EVENT_TYPE_VALUES) }),
  life_action: ev('client', {
    type: e(...LIFE_EVENT_TYPE_VALUES),
    action: e(
      'track',
      'paid',
      'mine',
      'never_show',
      'remind',
      'open_source',
      'checkin',
      'calendar',
      'dismiss',
    ),
  }),
  external_handoff: ev('client', {
    kind: e('tracking', 'checkin', 'confirm', 'maps', 'tel'),
    target: e('meeting_link', 'maps', 'provider_calendar', 'file'),
  }),
  reminder_sheet_open: ev('client', {
    origin: e(...REMINDER_ORIGINS),
    mode: e('remind', 'snooze'),
  }),
  reminder_created: ev('both', {
    preset: e(...REMINDER_PRESETS),
    destination: e('in_app', 'google_tasks', 'microsoft_todo', 'apple_reminders'),
    mode: e('remind', 'snooze'),
    queued: B,
  }),
  reminder_undo: ev('client', {}),
  reminder_smart_resolve: ev('client', { result: e('slot', 'no_slot', 'error', 'offline') }),
  reminder_custom_pick: ev('client', { lead_bucket: e('<1h', '<1d', '<1w', '>1w') }),
  reminder_destination_select: ev('client', {
    destination: e('in_app', 'google_tasks', 'microsoft_todo', 'apple_reminders'),
  }),
  capture_start: ev('client', {
    kind: e(...CAPTURE_KIND_VALUES),
    entry: e('in_app', 'share', 'assistant', 'today'),
  }),
  capture_created: ev('client', {
    kind: e(...CAPTURE_KIND_VALUES),
    via: e('in_app', 'share'),
    file_count: int(0, 10000),
  }),
  capture_cancel: ev('client', { stage: e('compose', 'analyzing') }),
  capture_photo_source: ev('client', { source: e('camera', 'library') }),
  capture_file_pick: ev('client', {
    origin: e('mail_attachment', 'device'),
    kind: e('pdf', 'file', 'image'),
  }),
  share_intake: ev('client', {
    item_count: int(0, 10000),
    kinds_mask: int(0, 127),
    platform: e('ios', 'android'),
  }),
  capture_analyze_result: ev('client', {
    kind: e(...CAPTURE_KIND_VALUES),
    status: e('extracted', 'partial', 'failed'),
    duration_bucket: e('<5s', '5-15s', '15-60s', '>60s'),
  }),
  capture_results_view: ev('client', {
    kind: e(...CAPTURE_KIND_VALUES),
    item_count: int(0, 10000),
    suggestion_count: int(0, 10000),
  }),
  capture_item_edit: ev('client', { entity_type: e(...EXTRACTED_ENTITY_TYPE_VALUES) }),
  capture_action_proposed: ev('client', { entity_type: e(...EXTRACTED_ENTITY_TYPE_VALUES) }),
  capture_type_override: ev('client', { type: e(...EXTRACTED_ENTITY_TYPE_VALUES) }),
  capture_success_view: ev('client', { executed: int(0, 10000), failed: int(0, 10000) }),
  approval_center_view: ev('client', { pending_count_bucket: e('0', '1', '2-5', '6-20', '20+') }),
  approval_edit_open: ev('client', { action_type: e(...APPROVAL_ACTION_TYPE_VALUES) }),
  approval_retry: ev('client', { action_type: e(...APPROVAL_ACTION_TYPE_VALUES) }),
  approval_history_view: ev('client', {
    filter: e('all', 'executed', 'rejected', 'failed', 'expired'),
  }),
  approval_repropose: ev('client', { action_type: e(...APPROVAL_ACTION_TYPE_VALUES) }),
  approval_detail_view: ev('client', {
    action_type: e(...APPROVAL_ACTION_TYPE_VALUES),
    status: e(...APPROVAL_STATUS_VALUES),
  }),
  approval_sheet_view: ev('client', {
    mode: e('single', 'batch'),
    count: int(0, 10000),
    origin: e(...APPROVAL_ORIGINS),
  }),
  approval_undo: ev('client', { mode: e('single', 'batch'), count: int(0, 10000) }),
  approval_batch_result: ev('client', {
    executed: int(0, 10000),
    failed: int(0, 10000),
    rejected: int(0, 10000),
  }),
  approval_edit: ev('client', {
    action_type: e(...APPROVAL_ACTION_TYPE_VALUES),
    fields_changed_count: int(0, 10000),
  }),
  approval_new_proposal: ev('client', {
    action_type: e(...APPROVAL_ACTION_TYPE_VALUES),
    origin: e(...APPROVAL_ORIGINS),
  }),
  source_open: ev('client', { kind: e('in_app', 'provider') }),
  correction_submit: ev('client', {
    mode: e('field', 'type', 'feedback'),
    kind: e(...FEEDBACK_KINDS),
    target_type: e(...ENTITY_TYPES),
    learning_enabled: B,
  }),
  correction_undo: ev('client', { kind: e(...FEEDBACK_KINDS) }),
  plan_viewed: ev('client', {
    view: e('day', 'week'),
    relative_day: int(-7, 30),
    week_offset: int(-4, 12),
  }),
  plan_date_changed: ev('client', { method: e('strip_tap', 'swipe', 'today_button') }),
  plan_item_opened: ev('client', {
    item_type: e('event', 'task', 'proposal', 'commitment', 'gap'),
  }),
  calendar_insight_action: ev('client', {
    signal: e('conflict', 'back_to_back', 'prep_slot', 'dense_day', 'free_gap', 'travel_stated'),
    action: e('open', 'resolve', 'propose', 'dismiss', 'place_prep'),
  }),
  plan_refreshed: ev('client', { result: e('ok', 'error') }),
  plan_week_paged: ev('client', { direction: e('prev', 'next') }),
  calendar_insight_shown: ev('client', {
    signal: e('conflict', 'back_to_back', 'prep_slot', 'dense_day', 'free_gap', 'travel_stated'),
  }),
  approval_created: ev('client', {
    type: e(...APPROVAL_ACTION_TYPE_VALUES),
    origin: e('plan_week', 'plan_day', 'today', 'assistant', 'capture', 'post_meeting'),
  }),
  schedule_proposal_opened: ev('client', {
    origin: e('today', 'plan_day', 'plan_week', 'push', 'assistant', 'deeplink'),
  }),
  schedule_proposal_time_changed: ev('client', {}),
  schedule_proposal_decided: ev('client', { decision: e('approved', 'cancelled', 'dismissed') }),
  approval_executed: ev('client', {
    type: e(...APPROVAL_ACTION_TYPE_VALUES),
    result: e('executed', 'failed'),
  }),
  free_slot_picker_opened: ev('client', { origin: e('proposal', 'reminder', 'task', 'gap') }),
  free_slot_selected: ev('client', { day_offset: int(0, 14), recommended: B }),
  plan_gap_opened: ev('client', { minutes_bucket: e('<30', '30-60', '60-120', '>120') }),
  plan_gap_action: ev('client', { action: e('focus', 'task', 'remind') }),
  task_sheet_opened: ev('client', { provider: e(...PROVIDER_VALUES) }),
  task_sheet_action: ev('client', {
    action: e('complete', 'plan', 'remind', 'open_provider', 'delete'),
  }),
  conflict_opened: ev('client', {
    origin: e('plan_day', 'plan_week', 'today', 'push', 'deeplink'),
  }),
  conflict_options_shown: ev('client', { count: int(0, 10000) }),
  conflict_option_selected: ev('client', {
    option_kind: e('move_own', 'propose_time', 'shorten', 'keep'),
    recommended: B,
  }),
  conflict_resolved: ev('client', {
    option_kind: e('move_own', 'propose_time', 'shorten', 'keep'),
    outcome: e('executed', 'dismissed', 'failed'),
  }),
  event_detail_opened: ev('client', {
    origin: e('plan_day', 'plan_week', 'today', 'flow', 'search', 'person', 'deeplink'),
    is_meeting: B,
  }),
  event_time_change_started: ev('client', {}),
  meeting_prep_opened: ev('client', {
    origin: e('push', 'today', 'flow', 'plan', 'person', 'widget', 'assistant', 'deeplink'),
    minutes_to_start_bucket: e('<15', '15-30', '30-120', '>120', 'started', 'ended'),
  }),
  meeting_prep_refreshed: ev('client', {}),
  meeting_prep_source_opened: ev('client', {
    section: e(
      'purpose',
      'last_interaction',
      'emails',
      'open_loops',
      'commitments',
      'files',
      'talking_points',
    ),
  }),
  meeting_note_saved: ev('client', { input_mode: e('text', 'voice'), origin: e('prep', 'event') }),
  speech_input_used: ev('client', { engine: e('on_device', 'server'), success: B }),
  meeting_summary_opened: ev('client', {}),
  meeting_summary_audio_played: ev('client', {
    engine: e('native', 'premium'),
    speed: e('0.75', '1', '1.25', '1.5', '2'),
  }),
  meeting_summary_source_opened: ev('client', { type: e(...SOURCE_TYPE_VALUES) }),
  post_meeting_opened: ev('client', {
    origin: e('push', 'prep', 'event', 'deeplink'),
    hours_since_end_bucket: e('<1', '1-4', '4-24', '>24'),
  }),
  post_meeting_input: ev('client', { mode: e('voice', 'text'), engine: e('on_device', 'server') }),
  post_meeting_extracted: ev('client', {
    count_bucket: e('0', '1', '2-3', '4+'),
    low_confidence_count: int(0, 10000),
  }),
  post_meeting_commitments_saved: ev('client', {
    count: int(0, 10000),
    edited_count: int(0, 10000),
  }),
  post_meeting_discarded: ev('client', {}),
  commitment_proposal_edited: ev('client', { fields_changed_count: int(0, 10000) }),
  assistant_opened: ev('client', { has_threads: B }),
  assistant_query_sent: ev('client', {
    suggested: B,
    prompt_key: catalog('assistant_prompt'),
    input_mode: e('text'),
    scoped: B,
  }),
  assistant_thread_opened: ev('client', {}),
  assistant_thread_deleted: ev('client', {}),
  assistant_capture_opened: ev('client', {}),
  assistant_answer_completed: ev('client', {
    grounded: B,
    no_answer: B,
    source_count_bucket: e('0', '1', '2-3', '4+'),
    latency_bucket: e('<1s', '1-3s', '3-10s', '>10s'),
    cancelled: B,
  }),
  assistant_source_opened: ev('client', { source_type: e(...SOURCE_TYPE_VALUES) }),
  assistant_action_proposed: ev('client', { action_type: e(...APPROVAL_ACTION_TYPE_VALUES) }),
  assistant_answer_feedback: ev('client', { rating: e('up', 'down') }),
  assistant_stream_error: ev('client', { code: e(...ERROR_CODES) }),
  voice_session_started: ev('client', {
    origin: e('assistant', 'today', 'widget', 'deeplink', 'briefing'),
  }),
  voice_permission_result: ev('client', { granted: B, kind: e('mic', 'speech') }),
  voice_stt_completed: ev('client', {
    engine: e('on_device', 'server'),
    success: B,
    duration_bucket: e('<5s', '5-15s', '15-60s', '>60s'),
  }),
  voice_tts_played: ev('client', { engine: e('native', 'premium') }),
  voice_action_proposed: ev('client', { action_type: e(...APPROVAL_ACTION_TYPE_VALUES) }),
  voice_intent: ev('client', {
    kind: e('briefing', 'question', 'action', 'navigation', 'cancel', 'not_understood'),
  }),
  memory_search_submitted: ev('client', {
    filter: e('all', 'email', 'event', 'commitment', 'capture', 'person'),
    has_date_filter: B,
    scoped: B,
  }),
  memory_answer_shown: ev('client', {
    confidence_label: e('assertive', 'probably', 'uncertain', 'hidden'),
    source_count_bucket: e('0', '1', '2-3', '4+'),
  }),
  memory_result_opened: ev('client', {
    source_type: e(...SOURCE_TYPE_VALUES),
    rank_bucket: e('1', '2-3', '4-10', '>10'),
  }),
  memory_no_results: ev('client', { reason: e('none', 'retention') }),
  search_performed: ev('both', {
    mode: e('fts_only', 'hybrid'),
    scope_count: int(0, 10000),
    has_contact_filter: B,
    results_bucket: e('0', '1_5', '6_20', 'gt20'),
    result_count: int(0, 10000),
  }),
  search_result_opened: ev('client', {
    result_type: e(
      'email',
      'person',
      'event',
      'task',
      'commitment',
      'life_event',
      'memory',
      'capture',
    ),
    rank_bucket: e('1', '2-3', '4-10', '>10'),
  }),
  search_no_results: ev('client', {}),
  search_scope_changed: ev('client', {
    scope: e(
      'all',
      'email',
      'event',
      'person',
      'task',
      'commitment',
      'life_event',
      'memory',
      'capture',
    ),
  }),
  person_opened: ev('client', {
    origin: e('prep', 'mail', 'event', 'vip', 'search', 'assistant', 'memory', 'deeplink'),
    is_vip: B,
  }),
  person_section_opened: ev('client', {
    section: e('overview', 'emails', 'meetings', 'commitments', 'files', 'notes', 'topics'),
  }),
  person_ask_submitted: ev('client', { input_mode: e('text', 'voice') }),
  vip_list_viewed: ev('client', { count_bucket: e('0', '1', '2-5', '6-20', '20+') }),
  vip_added: ev('client', { origin: e('manual', 'suggestion', 'person_page', 'correction') }),
  vip_removed: ev('client', {}),
  vip_suggestion_shown: ev('client', {}),
  vip_suggestion_dismissed: ev('client', {}),
  vip_updated: ev('client', { field: e('relationship', 'always_notify', 'bypass_quiet_hours') }),
  vip_picker_opened: ev('client', {}),
  vip_picker_manual_email_used: ev('client', {}),
  settings_opened: ev('client', {
    from: e('today', 'flow', 'plan', 'assistant', 'deeplink', 'notification'),
  }),
  settings_row_tapped: ev('client', { row: e(...SETTINGS_ROWS) }),
  profile_name_changed: ev('client', {}),
  accounts_opened: ev('client', {}),
  account_connect_started: ev('client', {
    provider: e(...PROVIDER_VALUES),
    capabilities: int(0, 63),
  }),
  account_retry_sync: ev('client', { provider: e(...PROVIDER_VALUES) }),
  account_connected: ev('client', {
    provider: e(...PROVIDER_VALUES),
    result: e(
      'success',
      'partial',
      'denied',
      'error',
      'expired_state',
      'account_mismatch',
      'already_linked',
      'plan_limit',
    ),
  }),
  account_detail_opened: ev('client', {
    provider: e(...PROVIDER_VALUES),
    status: e(...ACCOUNT_STATUS_VALUES),
  }),
  calendar_selection_changed: ev('client', { count: int(0, 10000) }),
  account_reconnect_started: ev('client', { provider: e(...PROVIDER_VALUES) }),
  account_sync_requested: ev('client', { provider: e(...PROVIDER_VALUES) }),
  account_disconnected: ev('client', {
    provider: e(...PROVIDER_VALUES),
    purge_content: B,
    revocation: e('revoked', 'manual_required', 'failed', 'not_applicable'),
    purge_derived: B,
  }),
  notification_pref_changed: ev('client', {
    category: e(...NOTIFICATION_CATEGORY_VALUES),
    enabled: B,
  }),
  notification_smart_filter_changed: ev('client', { enabled: B }),
  notification_detail_changed: ev('client', { mode: e(...NOTIFICATION_DETAIL_VALUES) }),
  notification_test_sent: ev('client', {
    mode: e(...NOTIFICATION_DETAIL_VALUES),
    category: e(...NOTIFICATION_CATEGORY_VALUES),
  }),
  lock_screen_private_changed: ev('client', { enabled: B }),
  notification_permission_prompted: ev('client', {
    result: e('granted', 'denied', 'blocked', 'provisional'),
  }),
  quiet_hours_changed: ev('client', { enabled: B, days_count: int(0, 7), vip_bypass: B }),
  briefing_schedule_changed: ev('client', {
    kind: e(...BRIEFING_KIND_VALUES),
    enabled: B,
    time_bucket: e('early_morning', 'morning', 'midday', 'afternoon', 'evening', 'night'),
  }),
  silent_days_changed: ev('client', { count: int(0, 10000) }),
  weekend_mode_changed: ev('client', { enabled: B }),
  timezone_changed: ev('client', { mode: e('auto', 'manual') }),
  privacy_center_opened: ev('client', {}),
  permission_row_tapped: ev('client', {
    permission: e(...ANALYTICS_PERMISSIONS),
    state: e('granted', 'denied', 'undetermined', 'limited'),
  }),
  permission_requested: ev('client', {
    permission: e(...ANALYTICS_PERMISSIONS),
    result: e('granted', 'denied', 'blocked', 'limited'),
  }),
  ai_access_toggled: ev('client', {
    class: e('mail_body', 'attachments', 'calendar', 'contacts', 'location_coarse'),
    enabled: B,
    confirmed: B,
  }),
  retention_changed: ev('client', {
    from: e(...RETENTION_POLICY_VALUES),
    to: e(...RETENTION_POLICY_VALUES),
    confirmed: B,
  }),
  history_delete_requested: ev('client', {}),
  history_delete_completed: ev('client', {}),
  export_requested: ev('client', {}),
  export_downloaded: ev('client', { size_bucket: e('<1mb', '1-10mb', '10-100mb', '>100mb') }),
  account_delete_step: ev('client', {
    step: e('intro', 'consequences', 'reauth', 'confirm', 'submitted'),
  }),
  account_delete_requested: ev('client', {
    had_store_subscription: B,
    login_method: e(...AUTH_METHODS),
  }),
  reauth_completed: ev('client', {
    method: e(...AUTH_METHODS),
    result: e('success', 'cancelled', 'error'),
  }),
  learning_toggled: ev('client', { enabled: B }),
  learned_pref_disabled: ev('client', {
    group: e('people', 'topics', 'timing', 'tone', 'categories'),
    kind: e('people', 'topics', 'timing', 'tone', 'categories'),
  }),
  learned_pref_deleted: ev('client', {
    group: e('people', 'topics', 'timing', 'tone', 'categories'),
    kind: e('people', 'topics', 'timing', 'tone', 'categories'),
  }),
  learned_pref_restored: ev('client', {
    group: e('people', 'topics', 'timing', 'tone', 'categories'),
    kind: e('people', 'topics', 'timing', 'tone', 'categories'),
  }),
  learned_pref_edited: ev('client', {
    group: e('people', 'topics', 'timing', 'tone', 'categories'),
    priority: e('high', 'normal', 'low'),
    kind: e('people', 'topics', 'timing', 'tone', 'categories'),
  }),
  priority_rules_opened: ev('client', { count: int(0, 10000) }),
  priority_rule_toggled: ev('client', {
    condition_type: e(...RULE_CONDITION_VALUES),
    outcome: e(...RULE_OUTCOME_VALUES),
    enabled: B,
  }),
  priority_rule_created: ev('client', {
    condition_type: e(...RULE_CONDITION_VALUES),
    outcome: e(...RULE_OUTCOME_VALUES),
  }),
  priority_rule_updated: ev('client', {
    condition_type: e(...RULE_CONDITION_VALUES),
    outcome: e(...RULE_OUTCOME_VALUES),
  }),
  rule_preview_loaded: ev('client', { bucket: e('0', '1-5', '6-20', '21-100', '100+') }),
  rule_exceptions_changed: ev('client', { count: int(0, 10000) }),
  priority_rule_deleted: ev('client', { condition_type: e(...RULE_CONDITION_VALUES) }),
  priority_rule_restored: ev('client', {}),
  rules_precedence_viewed: ev('client', {}),
  theme_changed: ev('client', { mode: e('system', 'light', 'dark') }),
  text_scale_changed: ev('client', { scale: e('small', 'default', 'large', 'xlarge') }),
  reduce_motion_changed: ev('client', { enabled: B }),
  haptics_changed: ev('client', { enabled: B }),
  locale_changed: ev('client', { locale: e('tr', 'en') }),
  subscription_opened: ev('client', {
    state: e(
      'free',
      'trial',
      'active',
      'grace_period',
      'billing_issue',
      'cancelled',
      'expired',
      'grant',
    ),
  }),
  manage_subscription_opened: ev('client', {
    store: e('app_store', 'play_store', 'test_store', 'promotional'),
  }),
  restore_started: ev('client', {}),
  restore_completed: ev('client', { found: B }),
  paywall_viewed: ev('client', { source: e(...PAYWALL_SOURCES), trial_eligible: B }),
  paywall_package_selected: ev('client', { package: e('monthly', 'annual') }),
  purchase_started: ev('client', { package: e('monthly', 'annual'), trial: B }),
  purchase_completed: ev('client', { package: e('monthly', 'annual'), trial: B }),
  purchase_cancelled: ev('client', { package: e('monthly', 'annual') }),
  purchase_pending: ev('client', {}),
  purchase_failed: ev('client', { code: e(...ERROR_CODES) }),
  paywall_dismissed: ev('client', { source: e(...PAYWALL_SOURCES) }),
  referral_viewed: ev('client', {}),
  referral_link_copied: ev('client', {}),
  referral_shared: ev('client', { completed: B }),
  referral_code_applied: ev('client', {
    result: e('applied', 'invalid', 'self', 'already_applied', 'window_closed', 'error'),
  }),
  android_ni_opened: ev('client', {
    state: e('not_granted', 'granted', 'paused', 'enabled', 'not_entitled'),
  }),
  /** M-ANI-01 CTA "Bildirim Erişimini Aç" opened the system access screen (screen-map name renamed for QG-27). */
  android_ni_access_opened: ev('client', {}),
  android_ni_granted: ev('client', { granted: B }),
  android_ni_enabled: ev('client', { enabled: B }),
  android_ni_mode_changed: ev('client', { mode: e('all', 'selected') }),
  android_ni_category_toggled: ev('client', {
    category: e('cargo', 'bank_payment', 'flight', 'reservation', 'other'),
    enabled: B,
  }),
  android_ni_signals_deleted: ev('client', { scope: e('one', 'all') }),
  android_ni_disclosure_viewed: ev('client', {}),
  android_ni_disclosure_accepted: ev('client', {}),
  android_ni_apps_selected: ev('client', { count: int(0, 10000) }),
  android_ni_denylist_viewed: ev('client', {}),
  help_opened: ev('client', { from: e('settings', 'error', 'state', 'onboarding', 'deeplink') }),
  help_faq_expanded: ev('client', { key: catalog('faq') }),
  help_faq_action: ev('client', { key: catalog('faq') }),
  help_search_used: ev('client', { results_bucket: e('0', '1_5', '6_20', 'gt20') }),
  support_tickets_viewed: ev('client', { count_bucket: e('0', '1', '2-5', '6-20', '20+') }),
  support_contact_opened: ev('client', { from: e('help', 'settings', 'state', 'deeplink') }),
  support_ticket_submitted: ev('client', {
    category: e(...TICKET_CATEGORY_VALUES),
    diagnostics: B,
  }),
  support_ticket_failed: ev('client', { code: e(...ERROR_CODES) }),
  feedback_opened: ev('client', {
    from: e('settings', 'briefing', 'assistant', 'state', 'deeplink'),
  }),
  feedback_submitted: ev('client', {
    type: e(...FEEDBACK_TYPE_VALUES),
    rating: int(1, 5),
    queued: B,
    diagnostics: B,
  }),
  feedback_failed: ev('client', { code: e(...ERROR_CODES) }),
  store_review_requested: ev('client', { available: B }),
  about_opened: ev('client', {}),
  about_link_opened: ev('client', {
    link: e('terms', 'privacy', 'licenses', 'website', 'support', 'store', 'release_notes'),
  }),
  licenses_viewed: ev('client', {}),
  widget_opened: ev('client', {
    family: e(
      'small',
      'medium',
      'large',
      'inline',
      'circular',
      'rectangular',
      'android_2x2',
      'android_4x2',
    ),
    target: e('today', 'briefing', 'meeting', 'flow', 'approvals', 'capture', 'assistant'),
  }),
  state_shown: ev('client', {
    state_id: e(...STATE_IDS),
    variant: e(...STATE_VARIANTS),
    screen: SCREEN,
    feature: e(...ANALYTICS_PRO_FEATURES),
  }),
  state_cta_tapped: ev('client', {
    state_id: e(...STATE_IDS),
    action: e(
      'retry',
      'reconnect',
      'open_settings',
      'upgrade',
      'dismiss',
      'back',
      'contact_support',
      'use_text',
    ),
  }),
  web_page_view: ev('web', {}),
  web_nav_click: ev('web', { target: e('how_it_works', 'features', 'security', 'pricing', 'faq') }),
  web_cta_click: ev('web', {
    placement: e(...WEB_PLACEMENTS),
    cta: e(
      'app_store',
      'play_store',
      'get_started',
      'pricing',
      'faq_all',
      'privacy',
      'support',
      'open_in_app',
    ),
  }),
  web_qr_shown: ev('web', { placement: e(...WEB_PLACEMENTS) }),
  web_locale_switch: ev('web', { to: e('tr', 'en') }),
  web_faq_toggle: ev('web', { faq_id: catalog('faq'), open: B }),
  web_pricing_period: ev('web', { period: e('monthly', 'annual') }),
  web_support_submit: ev('web', {
    category: e(...TICKET_CATEGORY_VALUES),
    result: e('ok', 'invalid', 'rate_limited', 'error'),
  }),
  web_deletion_step: ev('web', {
    step: e(
      'email_submitted',
      'code_sent',
      'request_submitted',
      'request_created',
      'otp_invalid',
      'otp_locked',
      'rate_limited',
      'error',
    ),
    kind: e('account'),
  }),
  web_referral_view: ev('web', { valid: B }),
  web_oauth_done_view: ev('web', {
    provider: e('google', 'microsoft', 'demo', 'unknown'),
    result: e(
      'pending_confirmation',
      'denied',
      'error',
      'expired_state',
      'admin_consent_required',
      'unknown',
    ),
  }),
  web_app_link_view: ev('web', {}),
  notification_test_blocked: ev('client', {
    reason: e('quiet_hours', 'os_permission_denied', 'no_device', 'rate_limited'),
  }),
  widget_inventory: ev('client', { ios_families: int(0, 255), android_kinds: int(0, 255) }),
  widget_snapshot_refreshed: ev('client', {
    trigger: e('foreground', 'background', 'push', 'approval', 'login', 'logout', 'settings'),
    result: e('ok', 'not_modified', 'failed'),
  }),
  web_get_redirect: ev('web', {
    target: e('app_store', 'play_store', 'web'),
    src: e(...WEB_PLACEMENTS),
  }),
  device_registered: ev('server', {
    platform: e('ios', 'android'),
    push_permission: e('granted', 'denied', 'provisional', 'undetermined'),
  }),
  push_permission_changed: ev('server', {
    permission: e('granted', 'denied', 'provisional', 'undetermined'),
  }),
  onboarding_first_analysis_started: ev('server', {}),
  onboarding_first_analysis_completed: ev('server', { partial: B }),
  reply_draft_generated: ev('server', { tone: e(...REPLY_TONES) }),
  followup_draft_generated: ev('server', { tone: e(...REPLY_TONES) }),
  capture_analyzed: ev('server', { kind: e(...CAPTURE_KIND_VALUES) }),
  briefing_audio_requested: ev('server', { mode: e('premium_tts', 'native_tts') }),
  evening_closed: ev('server', { carried: int(0, 10000) }),
  weekly_share_card_served: ev('server', {}),
  subscription_started: ev('server', {
    product: e('da_pro_monthly', 'da_pro_annual'),
    store: e('app_store', 'play_store', 'test_store', 'promotional'),
    period_type: e('normal', 'trial', 'intro'),
  }),
  subscription_renewed: ev('server', {
    product: e('da_pro_monthly', 'da_pro_annual'),
    store: e('app_store', 'play_store', 'test_store', 'promotional'),
    period_type: e('normal', 'trial', 'intro'),
  }),
  subscription_cancelled: ev('server', {
    product: e('da_pro_monthly', 'da_pro_annual'),
    store: e('app_store', 'play_store', 'test_store', 'promotional'),
    period_type: e('normal', 'trial', 'intro'),
  }),
  subscription_expired: ev('server', {
    product: e('da_pro_monthly', 'da_pro_annual'),
    store: e('app_store', 'play_store', 'test_store', 'promotional'),
    period_type: e('normal', 'trial', 'intro'),
  }),
  subscription_billing_issue: ev('server', {
    product: e('da_pro_monthly', 'da_pro_annual'),
    store: e('app_store', 'play_store', 'test_store', 'promotional'),
    period_type: e('normal', 'trial', 'intro'),
  }),
  referral_link_opened: ev('server', {}),
} as const satisfies Readonly<Record<string, AnalyticsEventSpec>>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

/** Other names used for the same events in the plans (Part 4 merges, M§42 examples). */
export const ANALYTICS_EVENT_ALIASES: Readonly<Record<string, AnalyticsEventName>> = {
  pro_gate_cta: 'pro_gate_cta_tapped',
  notif_detail_changed: 'notification_detail_changed',
  lock_screen_privacy_changed: 'lock_screen_private_changed',
  briefing_open: 'briefing_opened',
  assistant_prompt_sent: 'assistant_query_sent',
  capture_submit: 'capture_created',
  followup_action: 'follow_up_actioned',
};

type PropValue<S> = S extends { readonly type: 'enum'; readonly values: readonly (infer V)[] }
  ? V
  : S extends { readonly type: 'boolean' }
    ? boolean
    : S extends { readonly type: 'int' }
      ? number
      : string;

/** Typed props of one event (all optional; unknown props are rejected by the validator). */
export type AnalyticsProps<N extends AnalyticsEventName> = {
  readonly [K in keyof (typeof ANALYTICS_EVENTS)[N]['props']]?: PropValue<
    (typeof ANALYTICS_EVENTS)[N]['props'][K]
  >;
} & { readonly screen?: string; readonly is_pro?: boolean };

/** Route patterns accepted by `route_pattern` props. */
export const ANALYTICS_ROUTE_PATTERNS: readonly string[] = [...ROUTE_PATTERNS, 'unknown'];
