/**
 * `webhooks-google` (`/functions/v1/webhooks-google`; API_CONTRACTS WH-01 `POST /gmail`, WH-02
 * `POST /calendar`). Authentication failures answer 401 `WEBHOOK_SIGNATURE_INVALID` and are logged as
 * security events with the peppered source-IP hash; bodies are never logged.
 */
import type { Hono } from 'hono';
import { logHash } from '../_shared/crypto/hash.ts';
import { clientIp } from '../_shared/crypto/hash.ts';
import { AppError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppContext, AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import type { IntegrationRuntime } from '../_shared/services/integrations/runtime.ts';
import {
  ingestCalendarNotification,
  ingestGmailPush,
  type PubSubAuthConfig,
  verifyPubSubPush,
} from '../_shared/webhooks/google.ts';
import type { WebhookLedger } from '../_shared/webhooks/ledger.ts';

export interface GoogleWebhookAppDeps {
  readonly runtime: IntegrationRuntime;
  readonly webhooks: WebhookLedger;
  readonly pubsub: PubSubAuthConfig | null;
  /** `WEBHOOK_HMAC_SECRET` (Calendar channel tokens). */
  readonly calendarSecret: string | null;
  readonly pepper: string;
  readonly log: Logger;
  readonly sentry?: Sentry;
}

async function rejected(
  c: AppContext,
  deps: GoogleWebhookAppDeps,
  route: string,
  reason: string,
): Promise<never> {
  const ip = clientIp(c.req.header('X-Forwarded-For'));
  c.get('log').warn('webhook_signature_invalid', {
    route,
    reason,
    ip_hash: ip === null ? null : await logHash({ HASH_PEPPER: deps.pepper }, `ip:${ip}`),
  });
  throw new AppError('WEBHOOK_SIGNATURE_INVALID');
}

export function createGoogleWebhookApp(deps: GoogleWebhookAppDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'webhooks-google',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
    maxBodyBytes: 64 * 1024,
  });

  app.post('/gmail', async (c) => {
    c.set('routeKey', 'POST /gmail');
    if (!(await verifyPubSubPush(c.req.header('Authorization'), deps.pubsub))) {
      return await rejected(c, deps, 'gmail', deps.pubsub === null ? 'not_configured' : 'jwt');
    }
    const outcome = await ingestGmailPush(
      {
        runtime: deps.runtime,
        webhooks: deps.webhooks,
        log: c.get('log'),
        correlationId: c.get('correlationId'),
      },
      await c.req.text(),
    );
    c.get('log').info('webhook_gmail', { outcome: outcome.reason, enqueued: outcome.enqueued });
    return c.body(null, 204);
  });

  app.post('/calendar', async (c) => {
    c.set('routeKey', 'POST /calendar');
    const headers: Record<string, string | undefined> = {};
    for (const name of [
      'x-goog-channel-id',
      'x-goog-channel-token',
      'x-goog-resource-id',
      'x-goog-resource-state',
      'x-goog-message-number',
      'x-goog-channel-expiration',
    ]) {
      const value = c.req.header(name);
      if (value !== undefined) headers[name] = value;
    }
    await c.req.text();
    const outcome = await ingestCalendarNotification(
      {
        runtime: deps.runtime,
        webhooks: deps.webhooks,
        log: c.get('log'),
        correlationId: c.get('correlationId'),
      },
      headers,
      deps.calendarSecret,
    );
    if (outcome.status === 401) return await rejected(c, deps, 'calendar', outcome.reason);
    c.get('log').info('webhook_calendar', { outcome: outcome.reason, enqueued: outcome.enqueued });
    return c.body(null, 200);
  });

  return app;
}
