/**
 * Canonical enums, mirroring the Postgres enums in docs/DATABASE_AND_RLS_PLAN.md (`create type
 * public.*`), the authoritative source for enum values (MASTER_PLAN R-20). The database migrations
 * declare the same values; a parity test compares them with the migrations (T-2.25).
 */

export const PROVIDER_VALUES = [
  'google',
  'microsoft',
  'apple_device',
  'android_device',
  'demo',
] as const;
export type Provider = (typeof PROVIDER_VALUES)[number];

export const CAPABILITY_VALUES = [
  'mail_read',
  'mail_send',
  'calendar_read',
  'calendar_write',
  'tasks_read',
  'tasks_write',
] as const;
export type Capability = (typeof CAPABILITY_VALUES)[number];

export const ACCOUNT_STATUS_VALUES = [
  'connecting',
  'healthy',
  'syncing',
  'partial',
  'needs_reauth',
  'admin_consent_required',
  'error',
  'disconnected',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUS_VALUES)[number];

export const MAIL_CATEGORY_VALUES = [
  'important',
  'awaiting_my_reply',
  'awaiting_their_reply',
  'has_deadline',
  'informational',
  'low_priority',
] as const;
export type MailCategory = (typeof MAIL_CATEGORY_VALUES)[number];

export const DECISION_TIER_VALUES = [
  'explicit_rule',
  'learned_preference',
  'deterministic_signal',
  'ai_classification',
] as const;
export type DecisionTier = (typeof DECISION_TIER_VALUES)[number];

export const INSIGHT_KIND_VALUES = [
  'reply_needed',
  'meeting',
  'deadline',
  'follow_up',
  'commitment',
  'life_event',
  'security',
  'conflict',
  'schedule_suggestion',
  'approval_pending',
  'digest',
] as const;
export type InsightKind = (typeof INSIGHT_KIND_VALUES)[number];

export const URGENCY_VALUES = ['urgent', 'today', 'normal', 'low'] as const;
export type Urgency = (typeof URGENCY_VALUES)[number];

export const ITEM_STATUS_VALUES = ['open', 'done', 'dismissed', 'snoozed', 'expired'] as const;
export type ItemStatus = (typeof ITEM_STATUS_VALUES)[number];

export const LIFE_EVENT_TYPE_VALUES = [
  'shipment',
  'flight',
  'reservation',
  'payment',
  'subscription',
  'security',
] as const;
export type LifeEventType = (typeof LIFE_EVENT_TYPE_VALUES)[number];

export const FLOW_CARD_TYPE_VALUES = [
  'email',
  'meeting',
  'deadline',
  'shipment',
  'flight',
  'reservation',
  'payment',
  'subscription',
  'security',
  'follow_up',
  'commitment',
] as const;
export type FlowCardType = (typeof FLOW_CARD_TYPE_VALUES)[number];

export const COMMITMENT_DIRECTION_VALUES = ['user_owes', 'they_owe'] as const;
export type CommitmentDirection = (typeof COMMITMENT_DIRECTION_VALUES)[number];

export const COMMITMENT_STATUS_VALUES = ['open', 'done', 'snoozed', 'cancelled'] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUS_VALUES)[number];

export const APPROVAL_ACTION_TYPE_VALUES = [
  'email_send',
  'calendar_create',
  'calendar_update',
  'task_create',
  'reminder_create',
  'commitment_create',
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPE_VALUES)[number];

export const APPROVAL_STATUS_VALUES = [
  'pending',
  'approved',
  'rejected',
  'executing',
  'executed',
  'failed',
  'expired',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS_VALUES)[number];

export const BRIEFING_KIND_VALUES = ['morning', 'midday', 'evening', 'weekly'] as const;
export type BriefingKind = (typeof BRIEFING_KIND_VALUES)[number];

export const BRIEFING_STATUS_VALUES = [
  'scheduled',
  'generating',
  'ready',
  'delivered',
  'skipped',
  'failed',
] as const;
export type BriefingStatus = (typeof BRIEFING_STATUS_VALUES)[number];

export const CAPTURE_KIND_VALUES = [
  'photo',
  'screenshot',
  'pdf',
  'file',
  'link',
  'text',
  'share',
] as const;
export type CaptureKind = (typeof CAPTURE_KIND_VALUES)[number];

export const CAPTURE_STATUS_VALUES = [
  'pending_upload',
  'uploaded',
  'analyzing',
  'extracted',
  'actioned',
  'discarded',
  'failed',
] as const;
export type CaptureStatus = (typeof CAPTURE_STATUS_VALUES)[number];

export const EXTRACTED_ENTITY_TYPE_VALUES = [
  'event',
  'task',
  'deadline',
  'person',
  'payment',
  'reservation',
  'flight',
  'shipment',
  'product',
  'note',
] as const;
export type ExtractedEntityType = (typeof EXTRACTED_ENTITY_TYPE_VALUES)[number];

export const NOTIFICATION_CATEGORY_VALUES = [
  'morning',
  'midday',
  'evening',
  'critical_email',
  'meeting',
  'deadline',
  'follow_up',
  'life_intel',
  'approval',
  'account',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORY_VALUES)[number];

export const NOTIFICATION_DETAIL_VALUES = ['full', 'title_only', 'generic'] as const;
export type NotificationDetail = (typeof NOTIFICATION_DETAIL_VALUES)[number];

export const NOTIFICATION_DECISION_VALUES = [
  'scheduled',
  'sent',
  'suppressed',
  'deduplicated',
  'failed',
] as const;
export type NotificationDecision = (typeof NOTIFICATION_DECISION_VALUES)[number];

export const JOB_TYPE_VALUES = [
  'initial_sync',
  'gmail_sync',
  'outlook_sync',
  'calendar_sync',
  'tasks_sync',
  'device_calendar_ingest',
  'watch_renewal',
  'reconciliation',
  'provider_webhook',
  'email_triage',
  'email_analysis',
  'insight_refresh',
  'first_analysis',
  'briefing',
  'meeting_prep',
  'embedding',
  'approval_execute',
  'notification',
  'push_receipts',
  'retention',
  'export',
  'history_deletion',
  'account_deletion',
  'billing_sync',
  'referral_evaluate',
  'health_check',
  'capture_analysis',
  'credential_reencrypt',
  'integration_purge',
  'ai_batch',
  'ai_eval',
  'briefing_audio',
  'transactional_email',
] as const;
export type JobType = (typeof JOB_TYPE_VALUES)[number];

export const JOB_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'retrying',
  'failed',
  'dead_letter',
] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

export const ADMIN_ROLE_VALUES = [
  'super_admin',
  'operations',
  'support',
  'finance',
  'ai_ops',
  'analyst',
  'readonly',
] as const;
export type AdminRole = (typeof ADMIN_ROLE_VALUES)[number];

export const PROMPT_STATUS_VALUES = ['draft', 'active', 'archived'] as const;
export type PromptStatus = (typeof PROMPT_STATUS_VALUES)[number];

export const TICKET_STATUS_VALUES = [
  'open',
  'in_progress',
  'waiting_user',
  'resolved',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUS_VALUES)[number];

export const TICKET_CATEGORY_VALUES = [
  'account',
  'integration',
  'sync',
  'billing',
  'ai_quality',
  'notification',
  'privacy',
  'other',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORY_VALUES)[number];

export const FEEDBACK_TYPE_VALUES = ['bug', 'feature', 'general', 'ai_quality'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPE_VALUES)[number];

export const GRANT_SOURCE_VALUES = [
  'referral_referrer',
  'referral_referee',
  'admin',
  'support',
  'compensation',
] as const;
export type GrantSource = (typeof GRANT_SOURCE_VALUES)[number];

export const RETENTION_POLICY_VALUES = ['d30', 'd90', 'd365', 'until_deleted'] as const;
export type RetentionPolicy = (typeof RETENTION_POLICY_VALUES)[number];

export const SOURCE_TYPE_VALUES = [
  'email_message',
  'email_thread',
  'calendar_event',
  'device_calendar_event',
  'task',
  'capture',
  'meeting_note',
  'post_meeting_note',
  'android_notification',
  'assistant_message',
  'user_input',
  'commitment',
  'life_event',
  'contact',
  'briefing',
  'ai_feedback',
] as const;
export type SourceType = (typeof SOURCE_TYPE_VALUES)[number];

export const PLATFORM_VALUES = ['ios', 'android'] as const;
export type Platform = (typeof PLATFORM_VALUES)[number];

export const USER_STATE_VALUES = ['active', 'disabled', 'deletion_pending'] as const;
export type UserState = (typeof USER_STATE_VALUES)[number];

export const VIP_RELATIONSHIP_VALUES = [
  'spouse',
  'family',
  'manager',
  'key_client',
  'friend',
  'other',
] as const;
export type VipRelationship = (typeof VIP_RELATIONSHIP_VALUES)[number];

export const RULE_CONDITION_VALUES = [
  'person',
  'domain',
  'keyword',
  'category',
  'sender',
  'android_app',
] as const;
export type RuleCondition = (typeof RULE_CONDITION_VALUES)[number];

export const RULE_OUTCOME_VALUES = [
  'always_important',
  'high',
  'low',
  'always_notify',
  'mute',
] as const;
export type RuleOutcome = (typeof RULE_OUTCOME_VALUES)[number];

export const REFERRAL_STATUS_VALUES = [
  'pending',
  'qualified',
  'rewarded',
  'rejected',
  'flagged',
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUS_VALUES)[number];

export const REFERRAL_SIDE_VALUES = ['referrer', 'referee'] as const;
export type ReferralSide = (typeof REFERRAL_SIDE_VALUES)[number];

export const SUBSCRIPTION_STATUS_VALUES = [
  'none',
  'trial',
  'active',
  'grace_period',
  'billing_issue',
  'cancelled',
  'paused',
  'expired',
  'refunded',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS_VALUES)[number];

export const REMINDER_STATUS_VALUES = [
  'scheduled',
  'delivered',
  'done',
  'cancelled',
  'failed',
] as const;
export type ReminderStatus = (typeof REMINDER_STATUS_VALUES)[number];

export const EXPORT_STATUS_VALUES = [
  'requested',
  'processing',
  'ready',
  'expired',
  'failed',
  'cancelled',
] as const;
export type ExportStatus = (typeof EXPORT_STATUS_VALUES)[number];

export const DELETION_KIND_VALUES = ['history', 'account'] as const;
export type DeletionKind = (typeof DELETION_KIND_VALUES)[number];

export const DELETION_STATUS_VALUES = [
  'requested',
  'verified',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type DeletionStatus = (typeof DELETION_STATUS_VALUES)[number];

export const AI_FEATURE_VALUES = [
  'email_triage',
  'thread_summary',
  'email_deep_extract',
  'commitment_extract',
  'life_intel_extract',
  'briefing_morning',
  'briefing_midday',
  'briefing_evening',
  'weekly_review',
  'meeting_prep',
  'post_meeting_parse',
  'capture_extract',
  'assistant_intent',
  'assistant_qa',
  'reply_draft',
  'follow_up_draft',
  'embedding_doc',
  'embedding_query',
  'stt',
  'tts',
  'admin_probe',
] as const;
export type AiFeature = (typeof AI_FEATURE_VALUES)[number];

export const ROUTING_PROFILE_VALUES = ['balanced', 'lean'] as const;
export type RoutingProfile = (typeof ROUTING_PROFILE_VALUES)[number];

export const AI_TIER_VALUES = ['t0', 't1', 't2', 't3'] as const;
export type AiTier = (typeof AI_TIER_VALUES)[number];

export const APPROVAL_VIA_VALUES = [
  'approval_center',
  'inline_sheet',
  'voice_card',
  'capture_batch',
  'in_place',
] as const;
export type ApprovalVia = (typeof APPROVAL_VIA_VALUES)[number];

export const SUPPORT_ACCESS_SCOPE_VALUES = [
  'pii',
  'email_metadata',
  'insights',
  'notifications',
  'captures',
  'assistant_transcript',
  'ai_feedback',
] as const;
export type SupportAccessScope = (typeof SUPPORT_ACCESS_SCOPE_VALUES)[number];

export const ADMIN_STATUS_VALUES = ['invited', 'active', 'disabled'] as const;
export type AdminStatus = (typeof ADMIN_STATUS_VALUES)[number];

/** Every Postgres enum by its SQL type name (used by the DB parity test and validation). */
export const DB_ENUMS = {
  provider: PROVIDER_VALUES,
  capability: CAPABILITY_VALUES,
  account_status: ACCOUNT_STATUS_VALUES,
  mail_category: MAIL_CATEGORY_VALUES,
  decision_tier: DECISION_TIER_VALUES,
  insight_kind: INSIGHT_KIND_VALUES,
  urgency: URGENCY_VALUES,
  item_status: ITEM_STATUS_VALUES,
  life_event_type: LIFE_EVENT_TYPE_VALUES,
  flow_card_type: FLOW_CARD_TYPE_VALUES,
  commitment_direction: COMMITMENT_DIRECTION_VALUES,
  commitment_status: COMMITMENT_STATUS_VALUES,
  approval_action_type: APPROVAL_ACTION_TYPE_VALUES,
  approval_status: APPROVAL_STATUS_VALUES,
  briefing_kind: BRIEFING_KIND_VALUES,
  briefing_status: BRIEFING_STATUS_VALUES,
  capture_kind: CAPTURE_KIND_VALUES,
  capture_status: CAPTURE_STATUS_VALUES,
  extracted_entity_type: EXTRACTED_ENTITY_TYPE_VALUES,
  notification_category: NOTIFICATION_CATEGORY_VALUES,
  notification_detail: NOTIFICATION_DETAIL_VALUES,
  notification_decision: NOTIFICATION_DECISION_VALUES,
  job_type: JOB_TYPE_VALUES,
  job_status: JOB_STATUS_VALUES,
  admin_role: ADMIN_ROLE_VALUES,
  prompt_status: PROMPT_STATUS_VALUES,
  ticket_status: TICKET_STATUS_VALUES,
  ticket_category: TICKET_CATEGORY_VALUES,
  feedback_type: FEEDBACK_TYPE_VALUES,
  grant_source: GRANT_SOURCE_VALUES,
  retention_policy: RETENTION_POLICY_VALUES,
  source_type: SOURCE_TYPE_VALUES,
  platform: PLATFORM_VALUES,
  user_state: USER_STATE_VALUES,
  vip_relationship: VIP_RELATIONSHIP_VALUES,
  rule_condition: RULE_CONDITION_VALUES,
  rule_outcome: RULE_OUTCOME_VALUES,
  referral_status: REFERRAL_STATUS_VALUES,
  referral_side: REFERRAL_SIDE_VALUES,
  subscription_status: SUBSCRIPTION_STATUS_VALUES,
  reminder_status: REMINDER_STATUS_VALUES,
  export_status: EXPORT_STATUS_VALUES,
  deletion_kind: DELETION_KIND_VALUES,
  deletion_status: DELETION_STATUS_VALUES,
  ai_feature: AI_FEATURE_VALUES,
  routing_profile: ROUTING_PROFILE_VALUES,
  ai_tier: AI_TIER_VALUES,
  approval_via: APPROVAL_VIA_VALUES,
  support_access_scope: SUPPORT_ACCESS_SCOPE_VALUES,
  admin_status: ADMIN_STATUS_VALUES,
} as const;

export type DbEnumName = keyof typeof DB_ENUMS;
