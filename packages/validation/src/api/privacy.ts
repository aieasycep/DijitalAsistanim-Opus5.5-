import { z } from 'zod';
import { DELETION_STATUS_VALUES, EXPORT_STATUS_VALUES } from '@da/domain';
import { Base64Url32, IsoDateTime, Sha256Hex, Uuid } from './common.ts';
import { Success } from './envelope.ts';

export const EXPORT_SECTION_VALUES = [
  'profile',
  'preferences',
  'integrations_meta',
  'email_metadata',
  'insights',
  'briefings',
  'commitments',
  'reminders',
  'tasks',
  'calendar_events',
  'assistant',
  'captures',
  'memory',
  'ai_feedback',
  'approvals',
  'notifications',
  'subscriptions',
  'referrals',
] as const;

// API-PRV-01 · POST /privacy/export
export const ExportBody = z.strictObject({
  include: z
    .array(z.enum(EXPORT_SECTION_VALUES))
    .min(1)
    .refine((list) => new Set(list).size === list.length, 'duplicate_section')
    .optional(),
});
export const ExportResponse = Success(
  z.object({ request_id: Uuid, status: z.enum(EXPORT_STATUS_VALUES) }),
);

// API-PRV-02 · POST /privacy/delete-history
export const DeleteHistoryBody = z.strictObject({
  scope: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('all_analysis') }),
    z.strictObject({ type: z.literal('connected_account'), connected_account_id: Uuid }),
  ]),
  confirm: z.literal(true),
});
export const DeleteHistoryResponse = Success(
  z.object({
    request_id: Uuid,
    status: z.string(),
    will_delete: z.object({
      summaries: z.int().min(0),
      priority_decisions: z.int().min(0),
      memory_chunks: z.int().min(0),
      assistant_threads: z.int().min(0),
      learned_preferences: z.int().min(0),
      insights: z.int().min(0),
      briefings: z.int().min(0),
    }),
    preserved: z.array(
      z.enum([
        'connections',
        'settings',
        'vip',
        'priority_rules',
        'approved_items',
        'email_metadata',
        'calendar_events',
      ]),
    ),
  }),
);

// API-PRV-03 · POST /privacy/delete-account
/** The localized confirmation token shown next to the consequences list. */
export const DELETE_CONFIRM_TOKENS = { tr: 'SİL', en: 'DELETE' } as const;
export const DeleteAccountBody = z.strictObject({
  confirm_text: z
    .string()
    .refine(
      (value) => value === DELETE_CONFIRM_TOKENS.tr || value === DELETE_CONFIRM_TOKENS.en,
      'confirm_text_mismatch',
    ),
  acknowledge_subscription: z.boolean(),
  reason: z.enum(['privacy', 'not_useful', 'too_many_notifications', 'other']).optional(),
});
export const DeleteAccountResponse = Success(
  z.object({
    request_id: Uuid,
    status: z.literal('queued'),
    status_token: Base64Url32,
    subscription_notice: z.object({ active: z.boolean(), management_url: z.url().nullable() }),
  }),
);

// API-PRV-04 · POST /privacy/export/:id/download
export const ExportDownloadParams = z.strictObject({ id: Uuid });
export const ExportDownloadBody = z.strictObject({});
export const ExportDownloadResponse = Success(
  z.object({
    signed_url: z.url(),
    expires_at: IsoDateTime,
    file_size_bytes: z.int().min(0),
    sha256: Sha256Hex,
  }),
);

/** Deletion statuses (DB `deletion_status`), shared with PUB-07 and ADM-16. */
export const DeletionStatus = z.enum(DELETION_STATUS_VALUES);
