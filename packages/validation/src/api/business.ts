import { z } from 'zod';
import { REFERRAL_STATUS_VALUES } from '@da/domain';
import { EntitlementState, IsoDateTime, Uuid } from './common.ts';
import { Success } from './envelope.ts';

/** Unambiguous referral alphabet (no 0/O/1/I/L), 6–10 chars; input is trimmed and upper-cased. */
export const REFERRAL_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,10}$/;
export const ReferralCode = z.string().trim().toUpperCase().regex(REFERRAL_CODE_PATTERN);

// API-BIZ-01 · POST /referrals/apply
export const ReferralApplyBody = z.strictObject({
  code: ReferralCode,
  installation_id: Uuid,
  source: z.enum(['deep_link', 'manual', 'install_referrer']),
});
export const ReferralApplyResponse = Success(
  z.object({
    referral_id: Uuid,
    status: z.enum(['pending', 'flagged']),
    reward_days: z.int().min(0),
    qualification: z.object({
      onboarding_completed: z.boolean(),
      account_connected: z.boolean(),
      first_briefing_delivered: z.boolean(),
      eligible_after: IsoDateTime,
    }),
  }),
);

// API-BIZ-02 · GET /referrals/me
export const ReferralMeResponse = Success(
  z.object({
    code: z.string().regex(REFERRAL_CODE_PATTERN),
    share_url: z.url(),
    reward_days: z.int().min(0),
    cap_per_year: z.int().min(0),
    remaining_this_year: z.int().min(0),
    earned_days_total: z.int().min(0),
    referrals: z
      .array(
        z.object({
          id: Uuid,
          label: z.string().regex(/^\p{L}\*{3}$/u),
          status: z.enum(REFERRAL_STATUS_VALUES),
          created_at: IsoDateTime,
        }),
      )
      .max(50),
    referred_by: z.object({ status: z.string() }).nullable(),
  }),
);

// API-BIZ-03 · POST /purchases/sync
export const PurchasesSyncBody = z.strictObject({
  reason: z.enum(['purchase', 'restore', 'app_open']),
  rc_app_user_id: z.string().max(128),
});
export const PurchasesSyncResponse = Success(
  z.object({ entitlement: EntitlementState, stale: z.boolean() }),
);
