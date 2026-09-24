import { z } from 'zod';
import { DELETION_STATUS_VALUES, TICKET_CATEGORY_VALUES } from '@da/domain';
import { AnalyticsEventNameFormat } from '../analytics-events.ts';
import { Base64Url32, Email, IsoDateTime, LocalDate, Uuid } from '../api/common.ts';
import { Success } from '../api/envelope.ts';
import { ReferralCode } from '../api/business.ts';
import { DELETE_CONFIRM_TOKENS } from '../api/privacy.ts';

/*
 * public-api (docs/API_CONTRACTS.md §13; web usage SCREEN_AND_FLOW_MAP web §0.8). Anonymous, CORS-bound
 * to PUBLIC_WEB_URL, rate-limited by hashed IP / email. The honeypot `website` must be empty (the
 * handler checks it before the schema and answers a silent 202). Responses never reveal whether an
 * account exists.
 */

const Honeypot = z.string().max(0).optional();
const CaptchaToken = z.string().max(2048).optional();
const WebLocale = z.enum(['tr', 'en']);

// PUB-01 · POST /support
export const PublicSupportBody = z.strictObject({
  name: z.string().trim().max(120).optional(),
  email: Email.max(254),
  category: z.enum(TICKET_CATEGORY_VALUES),
  message: z.string().trim().min(10).max(5000),
  locale: WebLocale,
  website: Honeypot,
  captcha_token: CaptchaToken,
});
export const PublicSupportResponse = Success(
  z.object({ reference: z.string().regex(/^DA-[A-Z0-9-]{4,20}$/) }),
);

// PUB-02 · POST /data-deletion/start
export const DataDeletionStartBody = z.strictObject({
  email: Email.max(254),
  locale: WebLocale,
  captcha_token: CaptchaToken,
  website: Honeypot,
});
export const DataDeletionStartResponse = Success(
  z.object({ status: z.literal('code_sent_if_account_exists') }),
);

// PUB-03 · POST /data-deletion/verify
export const DataDeletionVerifyBody = z.strictObject({
  email: Email.max(254),
  code: z.string().regex(/^\d{6}$/),
  kind: z.enum(['account', 'history']).default('account'),
  confirmation: z
    .string()
    .refine(
      (value) => value === DELETE_CONFIRM_TOKENS.tr || value === DELETE_CONFIRM_TOKENS.en,
      'confirmation_mismatch',
    ),
  locale: WebLocale,
});
export const DataDeletionVerifyResponse = Success(
  z.object({
    reference: z.string(),
    request_id: Uuid,
    status: z.literal('queued'),
    status_token: Base64Url32,
    subscription_notice: z.object({ active: z.boolean() }),
  }),
);

// PUB-04 · GET /referrals/:code
export const PublicReferralParams = z.strictObject({ code: ReferralCode });
/** Never the referrer's identity; an unknown code is 200 with `valid:false`. */
export const PublicReferralResolve = z.strictObject({
  valid: z.boolean(),
  reward_days: z.int().min(0),
  apply_window_days: z.int().min(0),
  store_urls: z.strictObject({ ios: z.url(), android: z.url() }),
  deep_link: z
    .string()
    .regex(/^dijitalasistan:\/\/settings\/referral\?code=[23456789A-HJKMNP-Z]*$/),
  message_key: z.literal('referral.landing'),
});
export const PublicReferralResponse = Success(PublicReferralResolve);

// PUB-05 · GET /plans
const StorePrice = z.strictObject({
  app_store: z.number().positive().nullable(),
  play: z.number().positive().nullable(),
});
/** `app_settings['web.pricing_display']`, owner-verified store prices for `/pricing`. */
export const PricingDisplay = z.strictObject({
  storefront: z.literal('TR'),
  currency: z.literal('TRY'),
  as_of: LocalDate,
  verified: z.boolean(),
  monthly: StorePrice,
  annual: StorePrice,
  intro_offer: z
    .strictObject({
      days: z.int().min(1).max(90),
      stores: z.array(z.enum(['app_store', 'play'])).min(1),
    })
    .nullable(),
});
export type PricingDisplay = z.infer<typeof PricingDisplay>;
export const PRICING_MAX_AGE_DAYS = 90;
/** Rendered only when `verified=true` and `as_of` is at most 90 days old. */
export function pricingDisplayUsable(pricing: PricingDisplay, now: Date): boolean {
  const age = now.getTime() - Date.parse(`${pricing.as_of}T00:00:00Z`);
  return pricing.verified && age >= 0 && age <= PRICING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}
export const PublicPlans = z.strictObject({
  free: z.strictObject({
    mail_accounts: z.int().min(0),
    calendars: z.int().min(0),
    ai_analyses_per_day: z.int().min(0),
  }),
  pro: z.strictObject({
    mail_accounts: z.literal('multiple'),
    calendars: z.literal('multiple'),
    ai_policy: z.literal('fair_use'),
  }),
  pricing: PricingDisplay.nullable(),
  updated_at: IsoDateTime,
});
export const PublicPlansResponse = Success(PublicPlans);

// PUB-06 · POST /web-events
/** Cookieless web analytics: enums/booleans only; the page path never carries a query string. */
export const WebEventInput = z.strictObject({
  event: AnalyticsEventNameFormat,
  page: z
    .string()
    .max(120)
    .regex(/^\/[a-z0-9\-/[\]]*$/),
  locale: WebLocale,
  device_class: z.enum(['mobile', 'tablet', 'desktop']),
  theme: z.enum(['light', 'dark']),
  props: z
    .record(z.string(), z.union([z.string().max(64), z.number(), z.boolean(), z.null()]))
    .optional(),
});

// PUB-07 · GET /data-deletion/:requestId/status
export const DeletionStatusParams = z.strictObject({ requestId: Uuid });
export const DeletionStatusQuery = z.strictObject({ token: Base64Url32 });
const PublicStep = z.enum(['pending', 'done', 'skipped', 'failed']);
/** No identifiers: no email, no user id (strict). */
export const PublicDeletionStatus = z.strictObject({
  reference: z.string(),
  kind: z.enum(['account', 'history']),
  status: z.enum(DELETION_STATUS_VALUES),
  requested_at: IsoDateTime,
  completed_at: IsoDateTime.nullable(),
  steps_public: z.strictObject({
    provider_revoke: PublicStep,
    storage_purged: PublicStep,
    db_purged: PublicStep,
    auth_user_deleted: PublicStep,
  }),
});
export const DeletionStatusResponse = Success(PublicDeletionStatus);

// PUB-08 · POST /support/inbound-email (HTTP Basic, server-to-server; attachments dropped)
export const InboundEmailBody = z.looseObject({
  from: z.string().max(320),
  to: z.string().max(2000),
  subject: z.string().max(998),
  text: z.string().max(200000),
  message_id: z.string().min(1).max(998),
  in_reply_to: z.string().max(998).nullable().optional(),
});
export const InboundEmailAck = z.strictObject({ ok: z.literal(true) });
/** Extracts the ticket reference from a `support+{reference}@…` reply address. */
export function supportReferenceFromAddress(address: string): string | null {
  const match = /support\+(DA-[A-Z0-9-]{4,20})@/i.exec(address);
  return match?.[1]?.toUpperCase() ?? null;
}
