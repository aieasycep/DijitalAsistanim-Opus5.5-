/**
 * Provider webhooks (TEST_PLAN EF-WH-01/02; API_CONTRACTS WH-01…WH-04, JOB-09): Pub/Sub OIDC
 * authentication, dedupe, routing, the Calendar channel HMAC, the Graph validation echo, clientState
 * checks and lifecycle mapping. Payloads never reach the logs.
 */
import { assert, assertEquals } from '@std/assert';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { hmacSha256Base64Url, sha256Hex } from '../crypto/hmac.ts';
import { drain, integrationHarness } from '../testing/integrations.ts';
import { USER_A } from '../testing/jwt.ts';
import { createGoogleWebhookApp } from '../../webhooks-google/app.ts';
import { createMicrosoftWebhookApp } from '../../webhooks-microsoft/app.ts';

const AUDIENCE = 'https://api.example.test/functions/v1/webhooks-google/gmail';
const PUSH_SA = 'gmail-push@project.iam.gserviceaccount.com';
const HMAC = 'calendar-webhook-secret-0123456789abcdef';

async function pubsub() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }],
  });
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT({ email: PUSH_SA, email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://accounts.google.com')
      .setAudience((claims.aud as string | undefined) ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  return { jwks, sign };
}

function pushBody(messageId: string, email: string, historyId: number) {
  const data = btoa(JSON.stringify({ emailAddress: email, historyId }));
  return JSON.stringify({
    message: { data, messageId, publishTime: '2026-09-24T07:30:00.000Z' },
    subscription: 'projects/p/subscriptions/gmail-push',
  });
}

Deno.test(
  'WH-01: a valid Pub/Sub JWT → one provider_webhook job per delivery; wrong aud / email → 401; unknown mailbox → 204',
  async () => {
    const h = await integrationHarness();
    const { jwks, sign } = await pubsub();
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
    const post = async (token: string, body: string) =>
      await app.request('/webhooks-google/gmail', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      });
    const ok = await sign({});
    assertEquals((await post(ok, pushBody('m-1', 'Yunus@gmail.com', 987700))).status, 204);
    assertEquals((await post(ok, pushBody('m-1', 'yunus@gmail.com', 987700))).status, 204);
    const jobs = [...h.jobs.jobs.values()].filter((j) => j.type === 'provider_webhook');
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0]?.idempotency_key, `gmail_push:${account.id}:987700`);
    assertEquals(
      (
        await post(
          await sign({ aud: 'https://other.example.test' }),
          pushBody('m-2', 'yunus@gmail.com', 1),
        )
      ).status,
      401,
    );
    assertEquals(
      (
        await post(
          await sign({ email: 'someone@example.com' }),
          pushBody('m-3', 'yunus@gmail.com', 1),
        )
      ).status,
      401,
    );
    assertEquals((await post(ok, pushBody('m-4', 'nobody@gmail.com', 5))).status, 204);
    assertEquals([...h.jobs.jobs.values()].filter((j) => j.type === 'provider_webhook').length, 1);
    assertEquals(h.webhooks.rows.find((r) => r.externalId === 'm-4')?.status, 'ignored');
    assert(!h.logLines.some((l) => l.includes('yunus@gmail.com')));
    // JOB-09 turns the delivery into the coalesced gmail_sync.
    await drain(h, ['provider_webhook']);
    const sync = [...h.jobs.jobs.values()].find((j) => j.type === 'gmail_sync');
    assertEquals(sync?.idempotency_key, `gmail_sync:${account.id}:pending`);
    assertEquals((sync?.payload as { target_history_id: string }).target_history_id, '987700');
    assertEquals(h.webhooks.rows.find((r) => r.externalId === 'm-1')?.status, 'enqueued');
  },
);

Deno.test(
  'WH-02: HMAC channel token; mismatch → 401; sync handshake no-op; exists → coalesced calendar sync',
  async () => {
    const h = await integrationHarness();
    const account = h.store.addAccount({
      user_id: USER_A,
      provider: 'google',
      capabilities_granted: ['calendar_read'],
    });
    const channelId = '0c1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const token = await hmacSha256Base64Url(HMAC, channelId);
    const state = await h.store.ensureSyncState({
      userId: USER_A,
      accountId: account.id,
      resource: 'google_calendar',
      resourceKey: 'cal',
    });
    await h.store.updateSyncState(state.id, {
      watch_kind: 'gcal_channel',
      watch_id: channelId,
      watch_resource_id: 'res-1',
      watch_token_hash: await sha256Hex(token),
    });
    const app = createGoogleWebhookApp({
      runtime: h.runtime,
      webhooks: h.webhooks,
      pubsub: null,
      calendarSecret: HMAC,
      pepper: h.runtime.config.pepper,
      log: h.runtime.log,
    });
    const post = async (headers: Record<string, string>) =>
      await app.request('/webhooks-google/calendar', { method: 'POST', headers });
    const base = {
      'X-Goog-Channel-ID': channelId,
      'X-Goog-Resource-ID': 'res-1',
      'X-Goog-Message-Number': '1',
    };
    assertEquals(
      (await post({ ...base, 'X-Goog-Channel-Token': 'forged', 'X-Goog-Resource-State': 'exists' }))
        .status,
      401,
    );
    assertEquals(
      (await post({ ...base, 'X-Goog-Channel-Token': token, 'X-Goog-Resource-State': 'sync' }))
        .status,
      200,
    );
    assertEquals(h.jobs.jobs.size, 0);
    assertEquals(
      (
        await post({
          ...base,
          'X-Goog-Channel-Token': token,
          'X-Goog-Resource-State': 'exists',
          'X-Goog-Message-Number': '2',
        })
      ).status,
      200,
    );
    assertEquals(
      (
        await post({
          ...base,
          'X-Goog-Channel-Token': token,
          'X-Goog-Resource-State': 'exists',
          'X-Goog-Message-Number': '3',
        })
      ).status,
      200,
    );
    assertEquals([...h.jobs.jobs.values()].filter((j) => j.type === 'provider_webhook').length, 1);
    // Gmail push is refused when Pub/Sub is not configured.
    assertEquals(
      (await app.request('/webhooks-google/gmail', { method: 'POST', body: '{}' })).status,
      401,
    );
  },
);

Deno.test(
  'WH-03/04: validation echo, clientState check, lifecycle → watch_renewal / reconciliation',
  async () => {
    const h = await integrationHarness();
    const account = h.store.addAccount({
      user_id: USER_A,
      provider: 'microsoft',
      capabilities_granted: ['mail_read'],
    });
    const clientState = 'c'.repeat(64);
    const state = await h.store.ensureSyncState({
      userId: USER_A,
      accountId: account.id,
      resource: 'graph_mail_inbox',
      resourceKey: '',
    });
    await h.store.updateSyncState(state.id, {
      watch_kind: 'graph_subscription',
      watch_id: 'sub-1',
      watch_token_hash: await sha256Hex(clientState),
    });
    const app = createMicrosoftWebhookApp({
      runtime: h.runtime,
      webhooks: h.webhooks,
      log: h.runtime.log,
    });

    const echo = await app.request(
      '/webhooks-microsoft/notifications?validationToken=Validation%3A%20Testing%20client%20application',
      { method: 'POST' },
    );
    assertEquals(echo.status, 200);
    assertEquals(echo.headers.get('Content-Type'), 'text/plain; charset=utf-8');
    assertEquals(await echo.text(), 'Validation: Testing client application');

    const item = (cs: string) => ({
      subscriptionId: 'sub-1',
      subscriptionExpirationDateTime: '2026-10-01T07:20:00Z',
      changeType: 'created',
      resource: "me/mailFolders('inbox')/messages/AAMk-1",
      clientState: cs,
      resourceData: { id: 'AAMk-1' },
    });
    const post = async (path: string, body: unknown) =>
      await app.request(`/webhooks-microsoft/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    assertEquals((await post('notifications', { value: [item('wrong')] })).status, 401);
    assertEquals(
      (await post('notifications', { value: [item(clientState), item('wrong')] })).status,
      202,
    );
    assertEquals(
      (await post('notifications', { value: [item(clientState), item('wrong')] })).status,
      202,
    );
    const pushes = [...h.jobs.jobs.values()].filter((j) => j.type === 'provider_webhook');
    assertEquals(
      pushes.map((j) => j.idempotency_key),
      [`graph_push:${account.id}:inbox:pending`],
    );

    const lifecycle = (event: string) => ({
      value: [
        {
          lifecycleEvent: event,
          subscriptionId: 'sub-1',
          clientState,
          subscriptionExpirationDateTime: '2026-10-01T07:20:00Z',
        },
      ],
    });
    assertEquals((await post('lifecycle', lifecycle('reauthorizationRequired'))).status, 202);
    assertEquals((await post('lifecycle', lifecycle('missed'))).status, 202);
    await drain(h, ['provider_webhook']);
    const types = [...h.jobs.jobs.values()].map((j) => j.type);
    assert(types.includes('watch_renewal'));
    assert(types.includes('reconciliation'));
    assert(types.includes('outlook_sync'));
    const renewal = [...h.jobs.jobs.values()].find((j) => j.type === 'watch_renewal');
    assertEquals((renewal?.payload as { mode: string }).mode, 'reauthorize');
    assertEquals(h.store.syncStates.get(state.id)?.lifecycle_last_event, 'missed');
  },
);
