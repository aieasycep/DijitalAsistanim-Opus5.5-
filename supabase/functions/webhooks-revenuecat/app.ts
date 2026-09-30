/**
 * WH-05 `POST /webhooks-revenuecat` (API_CONTRACTS §10; IMPLEMENTATION_PLAN T-7.01; ADR-11).
 *
 * 1. `Authorization` must equal `Bearer ${REVENUECAT_WEBHOOK_AUTH}` (constant-time compare on
 *    SHA-256 digests; SECURITY_AND_PRIVACY_PLAN CTL-3.7) → otherwise 401 `WEBHOOK_SIGNATURE_INVALID`
 *    and nothing is stored. Without the secret the endpoint answers 503
 *    `EXTERNAL_CREDENTIAL_REQUIRED` (RevenueCat retries).
 * 2. The body (≤ 256 KiB) is validated with `RevenueCatWebhook`; unknown event types are stored and
 *    ignored, never rejected.
 * 3. One transaction stores the event in `billing_events` (dedupe on the event id, subscriber
 *    attributes stripped) and `webhook_events`, and enqueues `billing_sync` for `app_user_id` and
 *    every id in `transferred_from` / `transferred_to` (`billing_sync:{app_user_id}:{event_id}`).
 *    A replay stores and enqueues nothing.
 * 4. The worker is poked and the answer is `200 {"ok":true}` before any REST call: the mirror is
 *    rebuilt from RevenueCat by the job, never from the event.
 * Payloads are never logged.
 */
import type { Hono } from 'hono';
import {
  isKnownRevenueCatEventType,
  revenueCatAffectedUserIds,
  RevenueCatWebhook,
} from '@da/validation';
import { secretsEqual, sha256 } from '../_shared/crypto/hmac.ts';
import { AppError, validationError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import type { BillingLedger } from '../_shared/services/billing/repo.ts';

export const REVENUECAT_BODY_LIMIT = 256 * 1024;

export interface RevenueCatWebhookDeps {
  /** `REVENUECAT_WEBHOOK_AUTH`. */
  readonly authSecret: string | undefined;
  readonly ledger: BillingLedger;
  /** Immediate worker poke after new jobs (best effort). */
  readonly poke: () => Promise<unknown>;
  readonly log: Logger;
  readonly sentry?: Sentry;
}

/** The stored event: the webhook body without `subscriber_attributes` (DATABASE_AND_RLS_PLAN §4.6). */
export function ledgerPayload(body: Record<string, unknown>): Record<string, unknown> {
  const event = { ...(body.event as Record<string, unknown>) };
  delete event.subscriber_attributes;
  return { ...body, event };
}

function eventTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function createRevenueCatWebhookApp(deps: RevenueCatWebhookDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'webhooks-revenuecat',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
    maxBodyBytes: REVENUECAT_BODY_LIMIT,
  });

  app.post('/', async (c) => {
    c.set('routeKey', 'POST /webhooks-revenuecat');
    const secret = deps.authSecret?.trim() ?? '';
    if (secret === '') {
      c.get('log').warn('revenuecat_webhook_secret_missing');
      throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
        details: { feature: 'revenuecat_webhook', credential_keys: ['REVENUECAT_WEBHOOK_AUTH'] },
      });
    }
    const presented = c.req.header('Authorization') ?? '';
    if (!(await secretsEqual(presented, `Bearer ${secret}`))) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }

    const text = await c.req.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError('BAD_REQUEST', { details: { reason: 'malformed_json' } });
    }
    const parsed = RevenueCatWebhook.safeParse(json);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;
    const event = body.event;
    const known = isKnownRevenueCatEventType(event.type);
    const syncIds = known && event.type !== 'TEST' ? revenueCatAffectedUserIds(body) : [];

    const result = await deps.ledger.record({
      eventId: event.id,
      eventType: event.type,
      appUserId: event.app_user_id ?? null,
      environment: event.environment,
      store: event.store ?? null,
      productId: event.product_id ?? null,
      eventTimestamp: eventTime(event.event_timestamp_ms),
      transferredFrom: event.transferred_from ?? null,
      transferredTo: event.transferred_to ?? null,
      payload: ledgerPayload(json as Record<string, unknown>),
      payloadDigest: await sha256(text),
      syncIds,
      correlationId: c.get('correlationId'),
    });
    c.get('log').info('revenuecat_event', {
      event_type: known ? event.type : 'unknown',
      inserted: result.inserted,
      jobs: result.jobs.length,
    });
    if (result.jobs.length > 0) await deps.poke();
    return c.json({ ok: true }, 200);
  });

  return app;
}
