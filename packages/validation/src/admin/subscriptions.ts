import { z } from 'zod';
import {
  GRANT_SOURCE_VALUES,
  REFERRAL_STATUS_VALUES,
  SUBSCRIPTION_STATUS_VALUES,
} from '@da/domain';
import { IsoDateTime, JobRef, Uuid } from '../api/common.ts';
import {
  EmailMasked,
  MetricsRange,
  PagedSuccess,
  ReasonBody,
  SensitiveBody,
  Success,
  adminListQuery,
} from './common.ts';
import { GrantState } from './users.ts';

/* ADM-11 · Subscriptions and ADM-12 · Referrals (§12.3). Store and grant counts stay separate. */

const Environment = z.enum(['SANDBOX', 'PRODUCTION']);
export const SubscriptionsMetricsQuery = z.strictObject({ range: MetricsRange.default('30d') });
/** `mrr_usd` / `arr_estimate_usd` are absent without `metrics.revenue.read`. */
export const SubscriptionsMetricsResponse = Success(
  z.object({
    active_pro: z.int().min(0),
    trials: z.int().min(0),
    cancelled: z.int().min(0),
    expired: z.int().min(0),
    refunded: z.int().min(0),
    mrr_usd: z.number().min(0).optional(),
    arr_estimate_usd: z.number().min(0).optional(),
    by_store: z.record(z.string(), z.int().min(0)),
    by_product: z.record(z.string(), z.int().min(0)),
    renewal_rate: z.number().min(0).max(1),
    store_pro: z.int().min(0),
    grant_pro: z.int().min(0),
    both: z.int().min(0),
  }),
);
export const SubscriptionsListQuery = adminListQuery({
  sort: ['expires_at', 'status'],
  filters: {
    status: z.enum(SUBSCRIPTION_STATUS_VALUES),
    store: z.enum(['app_store', 'play_store', 'test_store', 'promotional']),
    product: z.string().max(80),
    environment: Environment,
  },
});
export const SubscriptionRow = z.object({
  user_id: Uuid,
  status: z.enum(SUBSCRIPTION_STATUS_VALUES),
  store: z.string().nullable(),
  product_id: z.string().nullable(),
  period_type: z.string().nullable(),
  expires_at: IsoDateTime.nullable(),
  will_renew: z.boolean(),
  source: z.literal('store'),
});
export const SubscriptionsListResponse = PagedSuccess(SubscriptionRow);
export const BillingEventsQuery = adminListQuery({
  sort: ['received_at'],
  filters: { type: z.string().max(64), user: Uuid, environment: Environment },
  q: false,
});
export const BillingEventRow = z.strictObject({
  event_id: z.string(),
  type: z.string(),
  environment: Environment,
  received_at: IsoDateTime,
  processed: z.boolean(),
});
export const BillingEventsResponse = PagedSuccess(BillingEventRow);
export const BillingEventParams = z.strictObject({ id: z.string().min(1).max(128) });
/** Sanitised projection: never `subscriber_attributes`, `aliases` or the raw payload (strict). */
export const BillingEventDetailResponse = Success(
  z.strictObject({
    event_id: z.string(),
    type: z.string(),
    store: z.string().nullable(),
    environment: Environment,
    product_id: z.string().nullable(),
    period_type: z.string().nullable(),
    purchased_at: IsoDateTime.nullable(),
    expiration_at: IsoDateTime.nullable(),
    event_at: IsoDateTime,
    price_usd: z.number().nullable(),
    price_local: z.number().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    cancel_reason: z.string().nullable(),
    expiration_reason: z.string().nullable(),
    is_trial_conversion: z.boolean().nullable(),
    received_at: IsoDateTime,
    processed_at: IsoDateTime.nullable(),
    processing_error_code: z.string().nullable(),
    job_id: Uuid.nullable(),
    user_id: Uuid.nullable(),
  }),
);
export const TrialStreamQuery = z.strictObject({
  range: MetricsRange.default('30d'),
  'filter[store]': z.string().max(40).optional(),
  'filter[product]': z.string().max(80).optional(),
  'filter[environment]': Environment.default('PRODUCTION'),
});
/** No prices in the trial stream. */
export const TrialStreamResponse = Success(
  z.object({
    events: z.array(
      z.strictObject({
        event_id: z.string(),
        kind: z.enum(['trial_started', 'trial_converted', 'trial_cancelled', 'trial_expired']),
        email_masked: EmailMasked.nullable(),
        product_id: z.string().nullable(),
        store: z.string().nullable(),
        event_at: IsoDateTime,
      }),
    ),
    summary: z.object({
      conversions: z.int().min(0),
      trial_expirations: z.int().min(0),
      conversion_rate: z.number().min(0).max(1),
    }),
  }),
);
export const EntitlementGrantsListQuery = adminListQuery({
  sort: ['starts_at'],
  filters: {
    source: z.enum(GRANT_SOURCE_VALUES),
    state: GrantState,
    granted_by_admin_id: Uuid,
    user_id: Uuid,
  },
  q: false,
});
export const EntitlementGrantRow = z.object({
  id: Uuid,
  user_id: Uuid,
  email_masked: EmailMasked.nullable(),
  source: z.enum(GRANT_SOURCE_VALUES),
  duration_days: z.int().min(1),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  state: GrantState,
  granted_by: z.string().nullable(),
  reason: z.string().nullable(),
  revoked_at: IsoDateTime.nullable(),
  revoked_by: z.string().nullable(),
});
export const EntitlementGrantsListResponse = PagedSuccess(EntitlementGrantRow);
export const SubscriptionUserParams = z.strictObject({ userId: Uuid });
export const SubscriptionResyncBody = ReasonBody;
export const SubscriptionResyncResponse = Success(z.object({ job: JobRef }));

// ADM-12 · Referrals
export const ReferralsMetricsQuery = z.strictObject({ range: MetricsRange.default('30d') });
export const ReferralsMetricsResponse = Success(
  z.object({
    invites: z.int().min(0),
    signups: z.int().min(0),
    qualified: z.int().min(0),
    rewarded: z.int().min(0),
    conversion: z.number().min(0).max(1),
    bonus_days_granted: z.int().min(0),
    flagged: z.int().min(0),
  }),
);
export const ReferralsListQuery = adminListQuery({
  sort: ['created_at', 'risk_score'],
  filters: { status: z.enum(REFERRAL_STATUS_VALUES) },
});
export const AdminReferralRow = z.object({
  id: Uuid,
  code: z.string(),
  referrer_id: Uuid,
  referee_id: Uuid,
  status: z.enum(REFERRAL_STATUS_VALUES),
  risk_score: z.number().min(0).max(1).nullable(),
  signals_summary: z.array(z.string()),
  created_at: IsoDateTime,
});
export const ReferralsListResponse = PagedSuccess(AdminReferralRow);
export const ReferralReviewBody = SensitiveBody;
export const ReferralReviewResponse = Success(
  z.object({ id: Uuid, status: z.enum(REFERRAL_STATUS_VALUES) }),
);
