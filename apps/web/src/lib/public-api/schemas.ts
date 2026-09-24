import { TICKET_CATEGORY_VALUES } from '@da/domain/enums';
import { z } from '../zod.ts';
import { WEB_LOCALES } from '../../i18n/locales.ts';

/**
 * Web-client view of the `public-api` contracts (API_CONTRACTS §2.4 envelope, §13 PUB-01…PUB-07;
 * SCREEN_AND_FLOW_MAP Part 5 §0.8). Request schemas are strict and identical to the server's so
 * client-side validation and the server agree; response schemas are lenient (`z.object`, not
 * strict) so additive server fields never break the site (API_CONTRACTS §2.3).
 */

export const Email = z.email().max(254);

// ── Envelope ───────────────────────────────────────────────────────────────────────────────────

export const FieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message_key: z.string().optional(),
});
export type FieldError = z.infer<typeof FieldErrorSchema>;

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message_key: z.string().optional(),
    retryable: z.boolean().optional(),
    correlation_id: z.string().optional(),
    field_errors: z.array(FieldErrorSchema).optional(),
  }),
});

export function successOf<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

// ── PUB-05 GET /plans ──────────────────────────────────────────────────────────────────────────

const StorePrices = z.object({
  app_store: z.number().positive().nullable(),
  play: z.number().positive().nullable(),
});

export const PricingDisplaySchema = z.object({
  storefront: z.literal('TR'),
  currency: z.literal('TRY'),
  as_of: z.iso.date(),
  verified: z.boolean(),
  monthly: StorePrices,
  annual: StorePrices,
  intro_offer: z
    .object({
      days: z.number().int().min(1).max(365),
      stores: z.array(z.enum(['app_store', 'play'])).min(1),
    })
    .nullable(),
});
export type PricingDisplay = z.infer<typeof PricingDisplaySchema>;

export const PublicPlansSchema = z.object({
  free: z.object({
    mail_accounts: z.number().int().min(0),
    calendars: z.number().int().min(0),
    ai_analyses_per_day: z.number().int().min(0),
  }),
  pro: z.object({
    mail_accounts: z.literal('multiple'),
    calendars: z.literal('multiple'),
    ai_policy: z.literal('fair_use'),
  }),
  pricing: PricingDisplaySchema.nullable(),
  updated_at: z.string(),
});
export type PublicPlans = z.infer<typeof PublicPlansSchema>;

// ── PUB-04 GET /referrals/:code ────────────────────────────────────────────────────────────────

export const ReferralResolveSchema = z.object({
  valid: z.boolean(),
  reward_days: z.number().int().min(0),
  apply_window_days: z.number().int().min(0).optional(),
});
export type ReferralResolve = z.infer<typeof ReferralResolveSchema>;

// ── PUB-01 POST /support ───────────────────────────────────────────────────────────────────────

export const SupportBodySchema = z.strictObject({
  name: z.string().trim().max(120).optional(),
  email: Email,
  category: z.enum(TICKET_CATEGORY_VALUES),
  message: z.string().trim().min(10).max(5000),
  locale: z.enum(WEB_LOCALES),
  website: z.string().max(0).optional(),
  captcha_token: z.string().max(2048).optional(),
});
export type SupportBody = z.infer<typeof SupportBodySchema>;

export const SupportAcceptedSchema = z.object({ reference: z.string().min(1) });

// ── PUB-02 POST /data-deletion/start ───────────────────────────────────────────────────────────

export const DeletionStartBodySchema = z.strictObject({
  email: Email,
  locale: z.enum(WEB_LOCALES),
  captcha_token: z.string().max(2048).optional(),
  website: z.string().max(0).optional(),
});
export type DeletionStartBody = z.infer<typeof DeletionStartBodySchema>;

export const DeletionStartAcceptedSchema = z.object({
  status: z.literal('code_sent_if_account_exists'),
});

// ── PUB-03 POST /data-deletion/verify ──────────────────────────────────────────────────────────

/** The localized confirmation word shown next to the consequences (PUB-03 `confirmation`). */
export const DELETION_CONFIRMATION_WORD = { tr: 'SİL', en: 'DELETE' } as const;

export const DeletionVerifyBodySchema = z.strictObject({
  email: Email,
  code: z.string().regex(/^\d{6}$/),
  kind: z.literal('account'),
  confirmation: z.enum([DELETION_CONFIRMATION_WORD.tr, DELETION_CONFIRMATION_WORD.en]),
  locale: z.enum(WEB_LOCALES),
});
export type DeletionVerifyBody = z.infer<typeof DeletionVerifyBodySchema>;

export const DeletionVerifyAcceptedSchema = z.object({
  reference: z.string().min(1),
  request_id: z.uuid(),
  status: z.literal('queued'),
  status_token: z.string().min(1),
  subscription_notice: z.object({ active: z.boolean() }),
});
export type DeletionVerifyAccepted = z.infer<typeof DeletionVerifyAcceptedSchema>;

// ── PUB-07 GET /data-deletion/:requestId/status ────────────────────────────────────────────────

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

export const DeletionStatusSchema = z.object({
  reference: z.string(),
  status: z.enum(DELETION_STATUS_VALUES),
  requested_at: z.string(),
  completed_at: z.string().nullable(),
});
export type DeletionStatusView = z.infer<typeof DeletionStatusSchema>;
