/**
 * Google push ingest (API_CONTRACTS WH-01, WH-02; INTEGRATION_PLAN §4.3.2, §4.5; T-4.03, T-4.04).
 *
 * WH-01 Gmail (Pub/Sub push): the OIDC bearer JWT is verified against Google's keys (issuer, audience
 * `GOOGLE_PUBSUB_PUSH_AUDIENCE`, `email = GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`, `email_verified`); the
 * delivery is deduped by Pub/Sub `messageId`, routed by mailbox address to the active Google accounts
 * and turned into `provider_webhook` jobs (key `gmail_push:{account}:{historyId}`). 204 always after
 * authentication; 500 only when the ledger or enqueue failed (Pub/Sub retries).
 * WH-02 Calendar channel: `X-Goog-Channel-Token` must equal `base64url(HMAC-SHA256(WEBHOOK_HMAC_SECRET,
 * channel_id))` and the stored channel's token hash and resource id; `sync` handshakes are no-ops.
 * Payloads are never logged; the ledger keeps ids only.
 */
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { CalendarChannelHeaders, parseGmailPush } from '@da/validation';
import { utf8 } from '../crypto/encoding.ts';
import { hmacSha256Base64Url, sha256, sha256Hex, timingSafeEqual } from '../crypto/hmac.ts';
import { bearerToken } from '../auth/user.ts';
import type { Logger } from '../logging/logger.ts';
import { GOOGLE_ISSUERS } from '../providers/google/auth.ts';
import type { IntegrationRuntime } from '../services/integrations/runtime.ts';
import type { WebhookLedger } from './ledger.ts';

export interface PubSubAuthConfig {
  readonly jwks: JWTVerifyGetKey;
  readonly audience: string;
  readonly serviceAccount: string;
  readonly now?: () => Date;
}

/** WH-01 authentication. */
export async function verifyPubSubPush(
  authorization: string | undefined,
  config: PubSubAuthConfig | null,
): Promise<boolean> {
  if (config === null) return false;
  const token = bearerToken(authorization);
  if (token === null) return false;
  try {
    const { payload } = await jwtVerify(token, config.jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: config.audience,
      ...(config.now === undefined ? {} : { currentDate: config.now() }),
    });
    return (
      payload.email_verified === true &&
      typeof payload.email === 'string' &&
      payload.email.toLowerCase() === config.serviceAccount.toLowerCase()
    );
  } catch {
    return false;
  }
}

export type WebhookOutcome = {
  status: 200 | 202 | 204 | 401 | 400;
  enqueued: number;
  reason: string;
};

export interface GoogleWebhookDeps {
  readonly runtime: IntegrationRuntime;
  readonly webhooks: WebhookLedger;
  readonly log: Logger;
  /** The request's correlation id, threaded into the enqueued jobs (TEST_PLAN IT-JOB-05). */
  readonly correlationId?: string;
}

/** WH-01 after authentication. */
export async function ingestGmailPush(
  deps: GoogleWebhookDeps,
  rawBody: string,
): Promise<WebhookOutcome> {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 204, enqueued: 0, reason: 'malformed_body' };
  }
  const parsed = parseGmailPush(body);
  if (!parsed.success) return { status: 204, enqueued: 0, reason: `invalid_${parsed.error}` };
  const email = parsed.data.emailAddress.toLowerCase();
  const historyId = parsed.data.historyId;
  const recorded = await deps.webhooks.record({
    source: 'google_gmail',
    externalId: parsed.push.message.messageId,
    userId: null,
    accountId: null,
    signatureValid: true,
    status: 'received',
    payloadDigest: await sha256(rawBody),
    payload: { history_id: historyId },
  });
  if (recorded.duplicate) return { status: 204, enqueued: 0, reason: 'duplicate' };
  const accounts = (await deps.runtime.store.findMailAccountsByEmail(email)).filter(
    (a) => a.provider === 'google' && ['healthy', 'syncing', 'partial', 'error'].includes(a.status),
  );
  if (accounts.length === 0) {
    await deps.webhooks.mark(recorded.id, 'ignored', null);
    return { status: 204, enqueued: 0, reason: 'unmatched' };
  }
  let lastJob: string | null = null;
  for (const account of accounts) {
    lastJob = await deps.runtime.enqueue({
      ...(deps.correlationId === undefined ? {} : { correlationId: deps.correlationId }),
      type: 'provider_webhook',
      idempotencyKey: `gmail_push:${account.id}:${historyId}`,
      payload: {
        webhook_event_id: recorded.id,
        source: 'gmail_pubsub',
        connected_account_id: account.id,
        data: { history_id: historyId },
      },
      userId: account.user_id,
      accountId: account.id,
      priority: 20,
      maxAttempts: 5,
    });
  }
  await deps.webhooks.mark(recorded.id, 'enqueued', lastJob);
  await deps.runtime.poke('gmail_push');
  return { status: 204, enqueued: accounts.length, reason: 'enqueued' };
}

/** WH-02. */
export async function ingestCalendarNotification(
  deps: GoogleWebhookDeps,
  headers: Readonly<Record<string, string | undefined>>,
  hmacSecret: string | null,
): Promise<WebhookOutcome> {
  const parsed = CalendarChannelHeaders.safeParse(headers);
  if (!parsed.success) {
    return headers['x-goog-channel-token'] === undefined
      ? { status: 401, enqueued: 0, reason: 'missing_token' }
      : { status: 200, enqueued: 0, reason: 'invalid_headers' };
  }
  const h = parsed.data;
  if (hmacSecret === null) return { status: 401, enqueued: 0, reason: 'not_configured' };
  const expected = await hmacSha256Base64Url(hmacSecret, h['x-goog-channel-id']);
  if (!timingSafeEqual(utf8.encode(expected), utf8.encode(h['x-goog-channel-token']))) {
    return { status: 401, enqueued: 0, reason: 'token_mismatch' };
  }
  const state = await deps.runtime.store.findSyncStateByWatch(
    'gcal_channel',
    h['x-goog-channel-id'],
  );
  const tokenHash = await sha256Hex(h['x-goog-channel-token']);
  if (
    state === null ||
    state.watch_resource_id !== h['x-goog-resource-id'] ||
    state.watch_token_hash !== tokenHash
  ) {
    await deps.webhooks.record({
      source: 'google_calendar',
      externalId: `${h['x-goog-channel-id']}:${h['x-goog-message-number']}`,
      userId: null,
      accountId: null,
      signatureValid: true,
      status: 'ignored',
      payloadDigest: await sha256(`${h['x-goog-channel-id']}:${h['x-goog-message-number']}`),
      payload: { resource_state: h['x-goog-resource-state'] },
    });
    return { status: 200, enqueued: 0, reason: 'unmatched' };
  }
  if (h['x-goog-resource-state'] === 'sync') return { status: 200, enqueued: 0, reason: 'sync' };
  const recorded = await deps.webhooks.record({
    source: 'google_calendar',
    externalId: `${h['x-goog-channel-id']}:${h['x-goog-message-number']}`,
    userId: state.user_id,
    accountId: state.connected_account_id,
    signatureValid: true,
    status: 'received',
    payloadDigest: await sha256(`${h['x-goog-channel-id']}:${h['x-goog-message-number']}`),
    payload: { resource_state: h['x-goog-resource-state'] },
  });
  if (recorded.duplicate) return { status: 200, enqueued: 0, reason: 'duplicate' };
  const jobId = await deps.runtime.enqueue({
    ...(deps.correlationId === undefined ? {} : { correlationId: deps.correlationId }),
    type: 'provider_webhook',
    idempotencyKey: `gcal_push:${state.connected_account_id}:${state.calendar_id ?? 'all'}:pending`,
    payload: {
      webhook_event_id: recorded.id,
      source: 'gcal_channel',
      connected_account_id: state.connected_account_id,
      data: state.calendar_id === null ? {} : { calendar_id: state.calendar_id },
    },
    userId: state.user_id,
    accountId: state.connected_account_id,
    priority: 20,
    maxAttempts: 5,
  });
  await deps.webhooks.mark(recorded.id, 'enqueued', jobId);
  await deps.runtime.poke('gcal_push');
  return { status: 200, enqueued: 1, reason: 'enqueued' };
}
