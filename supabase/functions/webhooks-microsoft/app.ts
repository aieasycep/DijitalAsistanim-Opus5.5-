/**
 * `webhooks-microsoft` (`/functions/v1/webhooks-microsoft`; API_CONTRACTS WH-03
 * `POST /notifications`, WH-04 `POST /lifecycle`). The subscription validation handshake echoes
 * `validationToken` as `text/plain` before anything else; notifications answer 202 (401 when every
 * item failed its `clientState`). No provider call happens here (Graph's 3-second budget).
 */
import type { Hono } from 'hono';
import { AppError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppContext, AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import type { IntegrationRuntime } from '../_shared/services/integrations/runtime.ts';
import type { WebhookLedger } from '../_shared/webhooks/ledger.ts';
import { ingestGraphLifecycle, ingestGraphNotifications } from '../_shared/webhooks/microsoft.ts';

export interface MicrosoftWebhookAppDeps {
  readonly runtime: IntegrationRuntime;
  readonly webhooks: WebhookLedger;
  readonly log: Logger;
  readonly sentry?: Sentry;
}

function validationEcho(c: AppContext): Response | null {
  const token = c.req.query('validationToken');
  if (token === undefined) return null;
  if (token.length === 0 || token.length > 1024)
    throw new AppError('BAD_REQUEST', { details: { reason: 'validation_token' } });
  return new Response(token, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function createMicrosoftWebhookApp(deps: MicrosoftWebhookAppDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'webhooks-microsoft',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
    maxBodyBytes: 1024 * 1024,
  });

  app.post('/notifications', async (c) => {
    c.set('routeKey', 'POST /notifications');
    const echo = validationEcho(c);
    if (echo !== null) return echo;
    const outcome = await ingestGraphNotifications(
      { runtime: deps.runtime, webhooks: deps.webhooks, log: c.get('log') },
      await c.req.text(),
    );
    c.get('log').info('webhook_graph', { outcome: outcome.reason, enqueued: outcome.enqueued });
    if (outcome.status === 401) throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    if (outcome.status === 400)
      throw new AppError('BAD_REQUEST', { details: { reason: outcome.reason } });
    return c.body(null, 202);
  });

  app.post('/lifecycle', async (c) => {
    c.set('routeKey', 'POST /lifecycle');
    const echo = validationEcho(c);
    if (echo !== null) return echo;
    const outcome = await ingestGraphLifecycle(
      { runtime: deps.runtime, webhooks: deps.webhooks, log: c.get('log') },
      await c.req.text(),
    );
    c.get('log').info('webhook_graph_lifecycle', {
      outcome: outcome.reason,
      enqueued: outcome.enqueued,
    });
    if (outcome.status === 401) throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    if (outcome.status === 400)
      throw new AppError('BAD_REQUEST', { details: { reason: outcome.reason } });
    return c.body(null, 202);
  });

  return app;
}
