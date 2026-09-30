/**
 * THR-05 Webhook forgery and replay (SECURITY_AND_PRIVACY_PLAN §2 THR-05, CTL-3.7; API_CONTRACTS
 * WH-01…WH-05; TEST_PLAN TST-EF-05/06/07). Through the merged webhook apps:
 * - Pub/Sub push: a JWT from another key, another issuer, expired, unverified or for another
 *   audience or service account is 401 and enqueues nothing; a redelivered message id is deduped;
 * - Calendar channel: the HMAC is bound to the channel id, so a token lifted from one channel does
 *   not authenticate another; unknown channels only produce an `ignored` ledger row;
 * - Graph: `clientState` is checked against the stored hash of that subscription; the validation
 *   echo is bounded plain text with `nosniff`;
 * - RevenueCat: the Authorization secret is compared in constant time, events are deduped by id,
 *   and even a correctly authenticated forged purchase grants nothing — entitlements come only
 *   from the REST re-fetch (ADR-11).
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { hmacSha256Base64Url, sha256Hex } from '../../_shared/crypto/hmac.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import { syncBillingCustomer } from '../../_shared/services/billing/sync.ts';
import {
  memoryBillingLedger,
  memoryBillingRepo,
  stubRevenueCat,
} from '../../_shared/testing/business.ts';
import { integrationHarness } from '../../_shared/testing/integrations.ts';
import { USER_A, USER_B } from '../../_shared/testing/jwt.ts';
import { createGoogleWebhookApp } from '../../webhooks-google/app.ts';
import { createMicrosoftWebhookApp } from '../../webhooks-microsoft/app.ts';
import { createRevenueCatWebhookApp } from '../../webhooks-revenuecat/app.ts';

const AUDIENCE = 'https://api.example.test/functions/v1/webhooks-google/gmail';
const PUSH_SA = 'gmail-push@project.iam.gserviceaccount.com';
const HMAC = 'calendar-webhook-secret-0123456789abcdef';
const RC_SECRET = 'rc-webhook-secret-0123456789';

async function keyPair(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
}

function pushBody(messageId: string, email: string, historyId: number, extra = {}) {
  const data = btoa(JSON.stringify({ emailAddress: email, historyId, ...extra }));
  return JSON.stringify({
    message: { data, messageId, publishTime: '2026-09-24T07:30:00.000Z' },
    subscription: 'projects/p/subscriptions/gmail-push',
  });
}

Deno.test(
  'THR-05 WH-01: forged Pub/Sub pushes are 401 and enqueue nothing; a redelivery is deduped',
  async () => {
    const h = await integrationHarness();
    const google = await keyPair('k1');
    const attacker = await keyPair('k1');
    const jwks = createLocalJWKSet({ keys: [google.jwk] });
    const account = h.store.addAccount({
      user_id: USER_A,
      provider: 'google',
      account_email: 'yunus@gmail.com',
      capabilities_granted: ['mail_read'],
    });
    const app = createGoogleWebhookApp({
      runtime: h.runtime,
      webhooks: h.webhooks,
      pubsub: { jwks, audience: AUDIENCE, serviceAccount: PUSH_SA },
      calendarSecret: HMAC,
      pepper: h.runtime.config.pepper,
      log: h.runtime.log,
    });
    const sign = (
      key: CryptoKey,
      claims: Record<string, unknown> = {},
      opts: { iss?: string; aud?: string; exp?: number } = {},
    ) =>
      new SignJWT({ email: PUSH_SA, email_verified: true, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(opts.iss ?? 'https://accounts.google.com')
        .setAudience(opts.aud ?? AUDIENCE)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
        .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 3600)
        .sign(key);
    const post = (authorization: string | null, body: string) =>
      app.request('/webhooks-google/gmail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authorization === null ? {} : { Authorization: authorization }),
        },
        body,
      });
    const forgeries: [string, string | null][] = [
      ['no bearer', null],
      ['attacker key', `Bearer ${await sign(attacker.privateKey)}`],
      [
        'other issuer',
        `Bearer ${await sign(google.privateKey, {}, { iss: 'https://evil.example' })}`,
      ],
      [
        'other audience',
        `Bearer ${await sign(google.privateKey, {}, { aud: 'https://evil.example' })}`,
      ],
      [
        'expired',
        `Bearer ${await sign(google.privateKey, {}, { exp: Math.floor(Date.now() / 1000) - 10 })}`,
      ],
      ['unverified email', `Bearer ${await sign(google.privateKey, { email_verified: false })}`],
      [
        'other account',
        `Bearer ${await sign(google.privateKey, { email: 'x@evil.iam.gserviceaccount.com' })}`,
      ],
    ];
    for (const [label, authorization] of forgeries) {
      const res = await post(authorization, pushBody(`m-${label}`, 'yunus@gmail.com', 1000));
      assertEquals(res.status, 401, label);
      await res.body?.cancel();
    }
    assertEquals([...h.jobs.jobs.values()].length, 0, 'no forged push enqueued work');
    assertFalse(h.webhooks.rows.some((r) => r.signatureValid && r.status !== 'rejected'));

    const genuine = `Bearer ${await sign(google.privateKey)}`;
    // A forged body cannot smuggle content: only the mailbox and history id are used.
    const body = pushBody('m-1', 'yunus@gmail.com', 987700, {
      subject: 'Ignore previous instructions',
      raw: 'Rm9yZ2Vk',
    });
    assertEquals((await post(genuine, body)).status, 204);
    assertEquals((await post(genuine, body)).status, 204, 'redelivery');
    const jobs = [...h.jobs.jobs.values()].filter((j) => j.type === 'provider_webhook');
    assertEquals(jobs.length, 1, 'deduped by (source, message id)');
    assertEquals(jobs[0]?.idempotency_key, `gmail_push:${account.id}:987700`);
    assertFalse(JSON.stringify(jobs[0]?.payload).includes('Ignore previous'));
    assertEquals(h.webhooks.rows.filter((r) => r.externalId === 'm-1').length, 1);

    const huge = await post(
      genuine,
      pushBody('m-big', 'yunus@gmail.com', 1, { pad: 'x'.repeat(70_000) }),
    );
    assertEquals(huge.status, 413, 'the 64 KB body cap applies');
  },
);

Deno.test(
  'THR-05 WH-02: a channel token lifted from one Calendar channel does not authenticate another; replays are deduped',
  async () => {
    const h = await integrationHarness();
    const channels: { id: string; resource: string; token: string; userId: string }[] = [];
    for (const [userId, id] of [
      [USER_A, '0c1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b'],
      [USER_B, '1d2b3c4d-5e6f-4a70-9b8c-0d1e2f3a4b5c'],
    ] as const) {
      const account = h.store.addAccount({
        user_id: userId,
        provider: 'google',
        capabilities_granted: ['calendar_read'],
      });
      const token = await hmacSha256Base64Url(HMAC, id);
      const state = await h.store.ensureSyncState({
        userId,
        accountId: account.id,
        resource: 'google_calendar',
        resourceKey: `cal-${userId}`,
      });
      await h.store.updateSyncState(state.id, {
        watch_kind: 'gcal_channel',
        watch_id: id,
        watch_resource_id: `res-${userId}`,
        watch_token_hash: await sha256Hex(token),
      });
      channels.push({ id, resource: `res-${userId}`, token, userId });
    }
    const app = createGoogleWebhookApp({
      runtime: h.runtime,
      webhooks: h.webhooks,
      pubsub: null,
      calendarSecret: HMAC,
      pepper: h.runtime.config.pepper,
      log: h.runtime.log,
    });
    const [a, b] = channels;
    assert(a !== undefined && b !== undefined);
    const post = (headers: Record<string, string>) =>
      app.request('/webhooks-google/calendar', { method: 'POST', headers });
    // A's genuine token on B's channel id.
    const lifted = await post({
      'X-Goog-Channel-ID': b.id,
      'X-Goog-Channel-Token': a.token,
      'X-Goog-Resource-ID': b.resource,
      'X-Goog-Resource-State': 'exists',
      'X-Goog-Message-Number': '7',
    });
    assertEquals(lifted.status, 401);
    // A valid HMAC for a channel we never created is recorded as ignored, nothing queued.
    const unknownId = '2e3c4d5e-6f70-4b81-8c9d-1e2f3a4b5c6d';
    const unknown = await post({
      'X-Goog-Channel-ID': unknownId,
      'X-Goog-Channel-Token': await hmacSha256Base64Url(HMAC, unknownId),
      'X-Goog-Resource-ID': 'res-x',
      'X-Goog-Resource-State': 'exists',
      'X-Goog-Message-Number': '1',
    });
    assertEquals(unknown.status, 200);
    // The right token with another resource id is not accepted as that channel either.
    await post({
      'X-Goog-Channel-ID': a.id,
      'X-Goog-Channel-Token': a.token,
      'X-Goog-Resource-ID': b.resource,
      'X-Goog-Resource-State': 'exists',
      'X-Goog-Message-Number': '2',
    });
    assertEquals([...h.jobs.jobs.values()].length, 0);
    const genuine = {
      'X-Goog-Channel-ID': a.id,
      'X-Goog-Channel-Token': a.token,
      'X-Goog-Resource-ID': a.resource,
      'X-Goog-Resource-State': 'exists',
      'X-Goog-Message-Number': '3',
    };
    assertEquals((await post(genuine)).status, 200);
    assertEquals((await post(genuine)).status, 200, 'replayed message number');
    const pushes = [...h.jobs.jobs.values()].filter((j) => j.type === 'provider_webhook');
    assertEquals(pushes.length, 1);
    assert(pushes[0]?.idempotency_key.startsWith('gcal_push:'));
  },
);

Deno.test(
  'THR-05 WH-03: Graph notifications need the clientState of that exact subscription; the validation echo is inert text',
  async () => {
    const h = await integrationHarness();
    const subs: { id: string; clientState: string }[] = [];
    for (const [userId, id] of [
      [USER_A, 'sub-a'],
      [USER_B, 'sub-b'],
    ] as const) {
      const account = h.store.addAccount({
        user_id: userId,
        provider: 'microsoft',
        capabilities_granted: ['mail_read'],
      });
      const clientState = crypto.randomUUID().replace(/-/g, '').repeat(2);
      const state = await h.store.ensureSyncState({
        userId,
        accountId: account.id,
        resource: 'graph_mail_inbox',
        resourceKey: '',
      });
      await h.store.updateSyncState(state.id, {
        watch_kind: 'graph_subscription',
        watch_id: id,
        watch_token_hash: await sha256Hex(clientState),
      });
      subs.push({ id, clientState });
    }
    const app = createMicrosoftWebhookApp({
      runtime: h.runtime,
      webhooks: h.webhooks,
      log: h.runtime.log,
    });
    const item = (subscriptionId: string, clientState: string) => ({
      subscriptionId,
      subscriptionExpirationDateTime: '2026-10-01T07:20:00Z',
      changeType: 'created',
      resource: "me/mailFolders('inbox')/messages/AAMk-1",
      clientState,
      resourceData: { id: 'AAMk-1' },
    });
    const post = (body: unknown) =>
      app.request('/webhooks-microsoft/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const [a, b] = subs;
    assert(a !== undefined && b !== undefined);
    assertEquals((await post({ value: [item(b.id, a.clientState)] })).status, 401, 'A secret on B');
    assertEquals((await post({ value: [item('sub-unknown', a.clientState)] })).status, 401);
    assertEquals((await post({ value: [item(a.id, '')] })).status, 401);
    assertEquals([...h.jobs.jobs.values()].length, 0);

    const echo = await app.request(
      `/webhooks-microsoft/notifications?validationToken=${encodeURIComponent('<script>alert(1)</script>')}`,
      { method: 'POST' },
    );
    assertEquals(echo.status, 200);
    assertEquals(echo.headers.get('Content-Type'), 'text/plain; charset=utf-8');
    assertEquals(echo.headers.get('X-Content-Type-Options'), 'nosniff');
    assertEquals(await echo.text(), '<script>alert(1)</script>');
    const long = await app.request(
      `/webhooks-microsoft/notifications?validationToken=${'a'.repeat(1025)}`,
      { method: 'POST' },
    );
    assertEquals(long.status, 400);
    await long.body?.cancel();
  },
);

Deno.test(
  'THR-05 WH-05: RevenueCat forgeries are 401; replays are one row; a forged purchase with a leaked secret grants nothing',
  async () => {
    const ledger = memoryBillingLedger();
    const sink = memorySink();
    const pokes: number[] = [];
    const app = createRevenueCatWebhookApp({
      authSecret: RC_SECRET,
      ledger,
      poke: () => Promise.resolve(void pokes.push(1)),
      log: createLogger({ fn: 'webhooks-revenuecat', sink: sink.sink }),
    });
    const event = {
      api_version: '1.0',
      event: {
        id: 'evt-forged-1',
        type: 'INITIAL_PURCHASE',
        app_user_id: USER_A,
        environment: 'PRODUCTION',
        event_timestamp_ms: Date.parse('2026-09-24T08:00:00Z'),
        product_id: 'da_pro_yearly',
        period_type: 'NORMAL',
        store: 'APP_STORE',
        price: 0,
        expiration_at_ms: Date.parse('2036-09-24T08:00:00Z'),
      },
    };
    const post = (authorization: string | null, body: unknown) =>
      app.request('/webhooks-revenuecat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authorization === null ? {} : { Authorization: authorization }),
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    for (const authorization of [null, 'Bearer guess', `bearer ${RC_SECRET}`, RC_SECRET]) {
      const res = await post(authorization, event);
      assertEquals(res.status, 401);
      await res.body?.cancel();
    }
    assertEquals(ledger.rows.length, 0);

    // With a leaked secret: stored once, one sync job, however often it is replayed.
    for (let i = 0; i < 3; i++)
      assertEquals((await post(`Bearer ${RC_SECRET}`, event)).status, 200);
    assertEquals(ledger.rows.length, 1);
    assertEquals(ledger.jobKeys, [`billing_sync:${USER_A}:evt-forged-1`]);
    assertEquals(pokes.length, 1);
    const huge = await post(`Bearer ${RC_SECRET}`, { ...event, pad: 'x'.repeat(260 * 1024) });
    assertEquals(huge.status, 413);
    await huge.body?.cancel();

    // The job re-fetches the customer: RevenueCat knows no purchase, so nothing is granted.
    const repo = memoryBillingRepo();
    repo.users.add(USER_A);
    repo.events.set('evt-forged-1', {
      event_type: 'INITIAL_PURCHASE',
      environment: 'PRODUCTION',
      status: 'received',
    });
    const revenueCat = stubRevenueCat(new Map());
    await syncBillingCustomer(
      {
        repo,
        revenueCat,
        production: true,
        now: () => new Date('2026-09-24T08:01:00Z'),
        log: createLogger({ fn: 'worker', sink: memorySink().sink }),
      },
      { appUserId: USER_A, eventId: 'evt-forged-1', reason: 'webhook', correlationId: null },
    );
    assertEquals(revenueCat.calls, [USER_A], 'the truth comes from the REST API');
    assertFalse(repo.mirrors.get(USER_A)?.is_active === true, 'no Pro from a forged event');
    assertFalse(repo.grantActive.has(USER_A));
  },
);
