/**
 * Closed vocabularies for analytics props (SECURITY_AND_PRIVACY_PLAN §4.9): every string prop is an
 * enum from one of these lists or from the canonical enums in `enums.ts`. None of them can carry
 * names, subjects, addresses, amounts, URLs or free text.
 */
import { PROVIDER_VALUES } from '../enums.ts';

export const REPLY_TONES = ['short', 'professional', 'friendly', 'detailed'] as const;

/** Entity kinds an event may refer to (never ids). */
export const ENTITY_TYPES = [
  'email_thread',
  'email_message',
  'calendar_event',
  'commitment',
  'life_event',
  'task',
  'capture',
  'approval_action',
  'contact',
  'briefing',
  'insight',
  'reminder',
] as const;

/** Pro capabilities and gates (M§44; contextual Pro gate M-GL-13). */
export const ANALYTICS_PRO_FEATURES = [
  'midday',
  'evening',
  'meeting_prep',
  'followups',
  'commitments',
  'voice_briefing',
  'ai_memory',
  'vip',
  'advanced_planning',
  'capture',
  'android_ni',
  'second_account',
  'multi_account',
  'weekly_review',
] as const;

/** API error codes (API_CONTRACTS §2.6) plus device, purchase and client-side codes. */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'REAUTH_REQUIRED',
  'AAL2_REQUIRED',
  'FORBIDDEN',
  'ACCOUNT_DISABLED',
  'ACCOUNT_DELETION_PENDING',
  'DATA_SOURCE_DISABLED',
  'OAUTH_COMPLETION_INVALID',
  'ENTITLEMENT_REQUIRED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'SOURCE_GONE',
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPLOAD_INVALID',
  'SSRF_BLOCKED',
  'FETCH_FAILED',
  'STATE_CONFLICT',
  'APPROVAL_STATE_CONFLICT',
  'APPROVAL_STALE',
  'IDEMPOTENCY_REPLAY',
  'PROVIDER_REAUTH_REQUIRED',
  'PROVIDER_SCOPE_MISSING',
  'PROVIDER_ADMIN_CONSENT_REQUIRED',
  'PROVIDER_REJECTED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'EXTERNAL_CREDENTIAL_REQUIRED',
  'AI_UNAVAILABLE',
  'AI_OUTPUT_INVALID',
  'FEATURE_DISABLED',
  'CLIENT_UPGRADE_REQUIRED',
  'REFERRAL_CODE_INVALID',
  'REFERRAL_SELF',
  'REFERRAL_ALREADY_APPLIED',
  'REFERRAL_WINDOW_CLOSED',
  'OTP_INVALID',
  'OTP_LOCKED',
  'WEBHOOK_SIGNATURE_INVALID',
  'METHOD_NOT_ALLOWED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'OFFLINE_BLOCKED',
  'DEVICE_RESULT_MISSING',
  'DEVICE_WRITE_FAILED',
  'DEVICE_CANCELLED',
  'PURCHASE_NOT_ALLOWED',
  'PRODUCT_NOT_AVAILABLE',
  'PAYMENT_PENDING',
  'STORE_PROBLEM',
  'NETWORK_ERROR',
  'UNKNOWN',
] as const;

export const AUTH_METHODS = ['apple', 'google', 'microsoft', 'email_otp'] as const;

export const ANALYTICS_PERMISSIONS = [
  'notifications',
  'calendar',
  'reminders',
  'microphone',
  'speech',
  'photos',
  'camera',
  'notification_listener',
  'exact_alarm',
] as const;

/** `connected_accounts.data_source_toggles` keys (API_CONTRACTS §4.5). */
export const DATA_SOURCE_TOGGLES = [
  'mail_read',
  'attachments_analyze',
  'deadline_detect',
  'draft_replies',
  'calendar_read',
  'schedule_suggest',
  'calendar_write_with_approval',
  'tasks_read',
] as const;

/** Configured local times on a 5-minute grid ("08:00") — configuration, not content. */
export const TIME_OF_DAY: readonly string[] = Array.from({ length: 288 }, (_, i) => {
  const m = i * 5;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

export const HERO_MODES = [
  'morning_ready',
  'briefing_generating',
  'midday_ready',
  'evening_ready',
  'no_sources',
  'first_run',
  'all_clear',
  'offline',
  'weekend',
] as const;

export const SHEET_KEYS = [
  'reminder',
  'snooze',
  'approval',
  'approval_batch',
  'why',
  'source',
  'correction',
  'quiet_hours',
  'time_picker',
  'calendar_picker',
  'account',
  'pro_gate',
  'share',
  'filter',
  'confirm',
  'sign_out',
  'destination',
  'tone',
  'recipients',
  'capture',
  'conflict',
  'proposal',
  'task',
  'life',
] as const;

export const TOAST_ORIGINS = [
  'today',
  'flow',
  'mail',
  'reply',
  'reminder',
  'approval',
  'capture',
  'plan',
  'assistant',
  'settings',
  'commitment',
  'followup',
  'life',
  'briefing',
] as const;

export const REMINDER_ORIGINS = [
  'email_detail',
  'today',
  'deadline',
  'meeting',
  'commitment',
  'life_event',
  'followup',
  'assistant',
  'plan',
] as const;

/** `approval_actions.origin` values (API_CONTRACTS §5.2). */
export const APPROVAL_ORIGINS = [
  'reply_draft',
  'assistant',
  'voice',
  'capture',
  'plan_proposal',
  'conflict_resolution',
  'post_meeting',
  'email_detail',
  'life_event',
  'follow_up',
  'reminder_sheet',
  'commitment_detection',
  'insight',
  'manual',
  'conflict',
] as const;

/** `ai_feedback.reason_code` values (DATABASE_AND_RLS_PLAN §4.4). */
export const FEEDBACK_KINDS = [
  'not_important',
  'wrong_category',
  'wrong_date',
  'wrong_person',
  'wrong_amount',
  'wrong_type',
  'not_a_commitment',
  'inaccurate',
  'show_more',
  'make_vip',
  'stop_tracking',
  'never_show',
  'helpful',
  'other',
  'create_rule',
] as const;

export const FLOW_FILTERS = [
  'all',
  'important',
  'mail',
  'calendar',
  'followup',
  'personal',
] as const;

/** `briefing_items.section` values. */
export const BRIEFING_SECTIONS = [
  'priorities',
  'schedule',
  'awaiting_me',
  'awaiting_them',
  'deadlines',
  'life',
  'completed',
  'carry_over',
  'follow_up',
  'tomorrow_first',
  'midday_delta',
  'weekly_highlight',
  'weekly_outlook',
] as const;

export const SETTINGS_ROWS = [
  'profile',
  'approvals',
  'briefings',
  'notifications',
  'priority_rules',
  'vip',
  'personalization',
  'android_notifications',
  'subscription',
  'accounts',
  'privacy',
  'referral',
  'delete_account',
  'appearance',
  'language',
  'help',
  'feedback',
  'about',
  'sign_out',
  'upgrade',
] as const;

/** Global state screens M-STATE-01…12. */
export const STATE_IDS = Array.from(
  { length: 12 },
  (_, i) => `M-STATE-${String(i + 1).padStart(2, '0')}`,
);

/** `plan_limits` keys that can show a limit state. */
export const LIMIT_KEYS = [
  'max_mail_accounts',
  'max_calendars',
  'ai_daily_budget_units',
  'vip_max',
  'priority_rules_max',
] as const;

export const STATE_VARIANTS = [
  'account',
  'source_off',
  'device_stale',
  'no_cache',
  'server_unreachable',
  'unavailable',
  'output_invalid',
  ...ERROR_CODES,
  ...ANALYTICS_PERMISSIONS,
  ...PROVIDER_VALUES,
  ...LIMIT_KEYS,
] as const;

export const ONBOARDING_STEPS = [
  'welcome',
  'noise',
  'proactive',
  'control',
  'account',
  'connect_mail',
  'connect_calendar',
  'permissions',
  'personalization',
  'briefing_schedule',
  'vip',
  'analysis',
  'ready',
  'notifications',
  'android_notifications',
  'done',
] as const;

export const PAYWALL_SOURCES = [
  ...ANALYTICS_PRO_FEATURES,
  'hub_upgrade',
  'midday_gate',
  'onboarding',
  'subscription',
  'deeplink',
  'settings',
  'today',
] as const;

/** Web `campaign` / `placement` enum (SCREEN_AND_FLOW_MAP §0.7, Part 5). */
export const WEB_PLACEMENTS = [
  'header',
  'hero',
  'pricing',
  'final',
  'menu',
  'referral',
  'app_link',
  'oauth_done',
  'qr_hero',
  'qr_final',
  'qr_pricing',
] as const;
