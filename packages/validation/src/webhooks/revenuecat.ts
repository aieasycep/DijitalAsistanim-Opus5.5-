import { z } from 'zod';

/*
 * WH-05 · POST /webhooks-revenuecat (docs/API_CONTRACTS.md §10). Auth: `Authorization: Bearer
 * ${REVENUECAT_WEBHOOK_AUTH}` (constant-time). Events arrive unordered, so they are stored and trigger a
 * customer re-fetch; they are never applied incrementally. Unknown event types are stored and ignored,
 * which is why `event` is a loose object and `type` is a bounded string.
 */

/** Event types the billing sync reacts to; anything else is stored with `processed=false`. */
export const REVENUECAT_EVENT_TYPES = [
  'TEST',
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'TRANSFER',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
  'INVOICE_ISSUANCE',
  'VIRTUAL_CURRENCY_TRANSACTION',
] as const;
export const RevenueCatEventType = z.enum(REVENUECAT_EVENT_TYPES);

export const RevenueCatEvent = z.looseObject({
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  app_user_id: z.string().max(128).optional(),
  original_app_user_id: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  transferred_from: z.array(z.string()).optional(),
  transferred_to: z.array(z.string()).optional(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  event_timestamp_ms: z.number(),
  product_id: z.string().optional(),
  entitlement_ids: z.array(z.string()).nullable().optional(),
  period_type: z.string().optional(),
  store: z.string().optional(),
  price: z.number().nullable().optional(),
  expiration_at_ms: z.number().nullable().optional(),
});
export type RevenueCatEvent = z.infer<typeof RevenueCatEvent>;

export const RevenueCatWebhook = z
  .object({ api_version: z.string(), event: RevenueCatEvent })
  .superRefine((body, ctx) => {
    if (body.event.type === 'TRANSFER') {
      const moved =
        (body.event.transferred_from?.length ?? 0) + (body.event.transferred_to?.length ?? 0);
      if (moved === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['event', 'transferred_from'],
          message: 'transfer_without_ids',
        });
      }
    } else if (
      isKnownRevenueCatEventType(body.event.type) &&
      body.event.type !== 'TEST' &&
      body.event.app_user_id === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['event', 'app_user_id'],
        message: 'app_user_id_required',
      });
    }
  });
export type RevenueCatWebhook = z.infer<typeof RevenueCatWebhook>;

/** WH-05 response: `200 {"ok":true}`. */
export const RevenueCatWebhookAck = z.strictObject({ ok: z.literal(true) });

/** `true` for event types the billing sync understands (others are stored and ignored). */
export function isKnownRevenueCatEventType(
  type: string,
): type is z.infer<typeof RevenueCatEventType> {
  return (REVENUECAT_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * The app user ids whose customer record must be re-fetched: `app_user_id` plus both sides of a
 * `TRANSFER` (enqueued as `billing_sync:{app_user_id}:{event_id}`).
 */
export function revenueCatAffectedUserIds(body: RevenueCatWebhook): string[] {
  const ids = [
    body.event.app_user_id,
    ...(body.event.transferred_from ?? []),
    ...(body.event.transferred_to ?? []),
  ].filter((id): id is string => typeof id === 'string' && id !== '');
  return [...new Set(ids)];
}
