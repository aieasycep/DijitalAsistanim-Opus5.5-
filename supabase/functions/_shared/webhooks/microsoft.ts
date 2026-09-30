/**
 * Graph change and lifecycle notifications (API_CONTRACTS WH-03, WH-04; INTEGRATION_PLAN §5.4;
 * T-4.09). Tiny and provider-call free so the answer stays well under Graph's 3-second budget:
 * - `?validationToken=` → 200 `text/plain` echo, nothing else;
 * - each item's `clientState` is hashed and compared in constant time with the subscription's stored
 *   hash; failing / unknown items are dropped (401 when every item fails);
 * - the body hash dedupes redeliveries; valid items become coalesced `provider_webhook` jobs per
 *   account and resource (`graph_push:{account}:{inbox|sentitems|calendar}:pending`), lifecycle items
 *   per subscription and 10-minute bucket (`graph_lifecycle:{subscriptionId}:{event}:{bucket}`).
 */
import {
  type GraphChangeNotification,
  type GraphLifecycleNotification,
  GraphLifecycleBody,
  GraphNotificationBody,
  graphResourceKind,
} from '@da/validation';
import { toHex } from '../crypto/encoding.ts';
import { sha256, sha256Hex, timingSafeEqual } from '../crypto/hmac.ts';
import { fromHex } from '../crypto/encoding.ts';
import type { Logger } from '../logging/logger.ts';
import type { IntegrationRuntime } from '../services/integrations/runtime.ts';
import type { SyncStateRecord } from '../services/integrations/types.ts';
import type { WebhookLedger } from './ledger.ts';
import type { WebhookOutcome } from './google.ts';

export interface MicrosoftWebhookDeps {
  readonly runtime: IntegrationRuntime;
  readonly webhooks: WebhookLedger;
  readonly log: Logger;
  /** The request's correlation id, threaded into the enqueued jobs (TEST_PLAN IT-JOB-05). */
  readonly correlationId?: string;
}

const LIFECYCLE_BUCKET_MS = 10 * 60_000;

async function authenticItem(
  deps: MicrosoftWebhookDeps,
  item: { subscriptionId: string; clientState?: string | undefined },
): Promise<SyncStateRecord | null> {
  if (item.clientState === undefined) return null;
  const state = await deps.runtime.store.findSyncStateByWatch(
    'graph_subscription',
    item.subscriptionId,
  );
  if (state === null || state.watch_token_hash === null) return null;
  const actual = fromHex(await sha256Hex(item.clientState));
  return timingSafeEqual(actual, fromHex(state.watch_token_hash)) ? state : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** WH-03 (the validation echo is handled by the route). */
export async function ingestGraphNotifications(
  deps: MicrosoftWebhookDeps,
  rawBody: string,
): Promise<WebhookOutcome> {
  const parsed = GraphNotificationBody.safeParse(parseJson(rawBody));
  if (!parsed.success) return { status: 400, enqueued: 0, reason: 'invalid_body' };
  const valid: { item: GraphChangeNotification; state: SyncStateRecord }[] = [];
  for (const item of parsed.data.value) {
    const state = await authenticItem(deps, item);
    if (state !== null) valid.push({ item, state });
  }
  if (valid.length === 0) {
    deps.log.warn('webhook_client_state_rejected', { items: parsed.data.value.length });
    return {
      status: parsed.data.value.length === 0 ? 202 : 401,
      enqueued: 0,
      reason: 'client_state',
    };
  }
  const digest = await sha256(rawBody);
  const recorded = await deps.webhooks.record({
    source: 'microsoft_graph',
    externalId: toHex(digest),
    userId: valid[0]?.state.user_id ?? null,
    accountId: valid[0]?.state.connected_account_id ?? null,
    signatureValid: true,
    status: 'received',
    payloadDigest: digest,
    payload: { items: valid.length, dropped: parsed.data.value.length - valid.length },
  });
  if (recorded.duplicate) return { status: 202, enqueued: 0, reason: 'duplicate' };
  const groups = new Map<
    string,
    { state: SyncStateRecord; kind: 'inbox' | 'sentitems' | 'calendar' }
  >();
  for (const { item, state } of valid) {
    const resourceKind = graphResourceKind(item.resource);
    const kind =
      state.resource === 'graph_calendar_view' || resourceKind === 'events'
        ? 'calendar'
        : state.resource === 'graph_mail_sentitems' || resourceKind === 'sentitems'
          ? 'sentitems'
          : 'inbox';
    groups.set(
      `${state.connected_account_id}:${kind}:${kind === 'calendar' ? (state.calendar_id ?? '') : ''}`,
      { state, kind },
    );
  }
  let lastJob: string | null = null;
  for (const { state, kind } of groups.values()) {
    lastJob = await deps.runtime.enqueue({
      ...(deps.correlationId === undefined ? {} : { correlationId: deps.correlationId }),
      type: 'provider_webhook',
      idempotencyKey: `graph_push:${state.connected_account_id}:${kind === 'calendar' ? `calendar:${state.calendar_id ?? 'all'}` : kind}:pending`,
      payload: {
        webhook_event_id: recorded.id,
        source: 'graph_notification',
        connected_account_id: state.connected_account_id,
        data:
          kind === 'calendar'
            ? state.calendar_id === null
              ? {}
              : { calendar_id: state.calendar_id }
            : { folder: kind },
      },
      userId: state.user_id,
      accountId: state.connected_account_id,
      priority: 20,
      maxAttempts: 5,
    });
  }
  await deps.webhooks.mark(recorded.id, 'enqueued', lastJob);
  await deps.runtime.poke('graph_push');
  return { status: 202, enqueued: groups.size, reason: 'enqueued' };
}

/** WH-04. */
export async function ingestGraphLifecycle(
  deps: MicrosoftWebhookDeps,
  rawBody: string,
): Promise<WebhookOutcome> {
  const parsed = GraphLifecycleBody.safeParse(parseJson(rawBody));
  if (!parsed.success) return { status: 400, enqueued: 0, reason: 'invalid_body' };
  const valid: { item: GraphLifecycleNotification; state: SyncStateRecord }[] = [];
  for (const item of parsed.data.value) {
    const state = await authenticItem(deps, item);
    if (state !== null) valid.push({ item, state });
  }
  if (valid.length === 0) {
    deps.log.warn('webhook_client_state_rejected', {
      items: parsed.data.value.length,
      lifecycle: true,
    });
    return {
      status: parsed.data.value.length === 0 ? 202 : 401,
      enqueued: 0,
      reason: 'client_state',
    };
  }
  const digest = await sha256(rawBody);
  const recorded = await deps.webhooks.record({
    source: 'microsoft_lifecycle',
    externalId: toHex(digest),
    userId: valid[0]?.state.user_id ?? null,
    accountId: valid[0]?.state.connected_account_id ?? null,
    signatureValid: true,
    status: 'received',
    payloadDigest: digest,
    payload: { items: valid.length },
  });
  if (recorded.duplicate) return { status: 202, enqueued: 0, reason: 'duplicate' };
  const now = deps.runtime.now();
  const bucket = Math.floor(now.getTime() / LIFECYCLE_BUCKET_MS);
  let lastJob: string | null = null;
  for (const { item, state } of valid) {
    await deps.runtime.store.updateSyncState(state.id, {
      lifecycle_last_event: item.lifecycleEvent,
      lifecycle_last_at: now.toISOString(),
    });
    lastJob = await deps.runtime.enqueue({
      ...(deps.correlationId === undefined ? {} : { correlationId: deps.correlationId }),
      type: 'provider_webhook',
      idempotencyKey: `graph_lifecycle:${item.subscriptionId}:${item.lifecycleEvent}:${bucket}`,
      payload: {
        webhook_event_id: recorded.id,
        source: 'graph_lifecycle',
        connected_account_id: state.connected_account_id,
        data: { lifecycle_event: item.lifecycleEvent, sync_state_id: state.id },
      },
      userId: state.user_id,
      accountId: state.connected_account_id,
      priority: 20,
      maxAttempts: 5,
    });
  }
  await deps.webhooks.mark(recorded.id, 'enqueued', lastJob);
  await deps.runtime.poke('graph_lifecycle');
  return { status: 202, enqueued: valid.length, reason: 'enqueued' };
}
