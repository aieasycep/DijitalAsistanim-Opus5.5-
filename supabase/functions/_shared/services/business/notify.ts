/**
 * `account`-category push jobs of the business flows (API_CONTRACTS JOB-18 `NotificationPayload`;
 * SCREEN_AND_FLOW_MAP §12.4 templates `account.referral_reward`, `account.trial_ending`,
 * `account.billing_issue`, `account.pro_ended`).
 *
 * The payload carries ids, the template key and public params only (counts, day numbers, plan and
 * store labels); the notification job decides, renders per detail mode and sends. The job key is
 * `notif:{user}:{dedupe_key}` and the ledger dedupes on `(user_id, dedupe_key)`, so re-running a
 * business job never notifies twice.
 */
import { notificationJobKey, toDeepLink } from '@da/domain';
import trCommon from '@da/i18n/messages/tr/common.json' with { type: 'json' };
import enCommon from '@da/i18n/messages/en/common.json' with { type: 'json' };
import trPaywall from '@da/i18n/messages/tr/paywall.json' with { type: 'json' };
import enPaywall from '@da/i18n/messages/en/paywall.json' with { type: 'json' };
import type { EnqueueInput } from '../../jobs/types.ts';

export type AccountTemplate =
  | 'account.referral_reward'
  | 'account.trial_ending'
  | 'account.billing_issue'
  | 'account.pro_ended';

export interface AccountNotification {
  readonly userId: string;
  readonly template: AccountTemplate;
  readonly dedupeKey: string;
  /** App path of the tap target (`/settings/referral`, `/settings/subscription`). */
  readonly path: '/settings/referral' | '/settings/subscription';
  readonly params?: Readonly<Record<string, string | number>>;
  readonly runAfter?: Date;
  readonly correlationId?: string | null;
}

/** The JOB-18 enqueue input for one account notification. */
export function accountNotificationJob(input: AccountNotification): EnqueueInput {
  return {
    type: 'notification',
    idempotencyKey: notificationJobKey(input.userId, input.dedupeKey),
    userId: input.userId,
    payload: {
      user_id: input.userId,
      build: {
        category: 'account',
        dedupe_key: input.dedupeKey,
        entity: null,
        deeplink: toDeepLink(input.path),
        template_key: input.template,
        params_public: { ...(input.params ?? {}) },
        params_sensitive: {},
        urgency: 'normal',
        time_sensitive: false,
        vip: false,
      },
    },
    priority: 60,
    maxAttempts: 5,
    ...(input.runAfter === undefined ? {} : { runAfter: input.runAfter }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  };
}

type Lang = 'tr' | 'en';

function lang(locale: string | null | undefined): Lang {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? 'en' : 'tr';
}

/** Localised plan label for `account.trial_ending {plan}` ("Aylık" / "Annual"). */
export function planLabel(productId: string | null, locale: string | null | undefined): string {
  const periods = (lang(locale) === 'en' ? enPaywall : trPaywall).periods;
  return productId !== null && productId.includes('annual') ? periods.annual : periods.monthly;
}

/** Localised store label for `account.billing_issue {store}`. */
export function storeLabel(store: string | null, locale: string | null | undefined): string {
  const providers = (lang(locale) === 'en' ? enCommon : trCommon).providers;
  return store === 'play_store' ? providers.googlePlay : providers.appStore;
}
