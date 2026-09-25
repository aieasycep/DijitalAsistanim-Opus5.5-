/**
 * Integration routes through the real `api` app (API_CONTRACTS API-INT-01…07, API-MAIL-01): envelope,
 * validation, idempotent replays, the per-account manual-sync limit and the sanitised original mail.
 */
import { assert, assertEquals } from '@std/assert';
import { activeDemoAccount, drain, integrationHarness } from '../_shared/testing/integrations.ts';
import { USER_A } from '../_shared/testing/jwt.ts';
import { enqueueInitialSync } from '../_shared/services/integrations/enqueue.ts';
import { call, createHarness } from './testing.ts';

async function setup() {
  const ih = await integrationHarness();
  const h = await createHarness({ integrations: ih.runtime });
  return { ih, h, jwt: await h.token(USER_A) };
}

Deno.test(
  'API-INT-01: demo start returns the flow; an idempotent replay re-renders the same state; device providers → 422',
  async () => {
    const { h, jwt } = await setup();
    const key = crypto.randomUUID();
    const body = {
      capabilities: ['mail_read', 'calendar_read'],
      device_nonce_hash: 'a'.repeat(64),
    };
    const res = await call(h, 'POST', '/integrations/demo/start', { jwt, key, body });
    assertEquals(res.status, 200);
    const first = (await res.json()).data;
    assertEquals(first.callback_url, 'dijitalasistan://integrations/callback');
    assert(first.auth_url.includes('/functions/v1/oauth/demo/authorize'));
    const replay = await call(h, 'POST', '/integrations/demo/start', { jwt, key, body });
    assertEquals(replay.headers.get('Idempotency-Replayed'), 'true');
    const again = (await replay.json()).data;
    assertEquals(again.state_id, first.state_id);
    assertEquals(
      new URL(again.auth_url).searchParams.get('state'),
      new URL(first.auth_url).searchParams.get('state'),
    );
    const device = await call(h, 'POST', '/integrations/apple_device/start', {
      jwt,
      key: crypto.randomUUID(),
      body,
    });
    assertEquals(device.status, 422);
    const missingNonce = await call(h, 'POST', '/integrations/demo/start', {
      jwt,
      key: crypto.randomUUID(),
      body: { capabilities: ['mail_read'] },
    });
    assertEquals(missingNonce.status, 422);
  },
);

Deno.test('API-INT-07: an unknown completion code → 403 OAUTH_COMPLETION_INVALID', async () => {
  const { h, jwt } = await setup();
  const res = await call(h, 'POST', '/integrations/oauth/complete', {
    jwt,
    key: crypto.randomUUID(),
    body: { completion_code: 'c'.repeat(43), device_nonce: 'd'.repeat(43) },
  });
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, 'OAUTH_COMPLETION_INVALID');
});

Deno.test(
  'API-INT-04: coalesced manual sync, 1 per 60 s per account; needs_reauth → 424',
  async () => {
    const { ih, h, jwt } = await setup();
    const account = await activeDemoAccount(ih, { userId: USER_A, status: 'healthy' });
    const res = await call(h, 'POST', `/integrations/${account.id}/sync`, {
      jwt,
      body: { resources: ['mail'] },
    });
    assertEquals(res.status, 202);
    const data = (await res.json()).data;
    assertEquals(data.jobs.length, 1);
    assertEquals(
      ih.jobs.jobs.get(data.jobs[0].job_id)?.idempotency_key,
      `gmail_sync:${account.id}:pending`,
    );
    const limited = await call(h, 'POST', `/integrations/${account.id}/sync`, {
      jwt,
      body: { resources: ['mail'] },
    });
    assertEquals(limited.status, 429);
    const broken = await activeDemoAccount(ih, {
      userId: USER_A,
      status: 'needs_reauth',
      flavor: 'microsoft',
    });
    const reauth = await call(h, 'POST', `/integrations/${broken.id}/sync`, { jwt, body: {} });
    assertEquals(reauth.status, 424);
    assertEquals((await reauth.json()).error.code, 'PROVIDER_REAUTH_REQUIRED');
    const foreign = await call(h, 'POST', `/integrations/${crypto.randomUUID()}/sync`, {
      jwt,
      body: {},
    });
    assertEquals(foreign.status, 404);
  },
);

Deno.test(
  'API-INT-04 force_analysis: enqueues email_analysis for owned messages only; body rules → 422',
  async () => {
    const { ih, h, jwt } = await setup();
    const account = await activeDemoAccount(ih, { userId: USER_A, status: 'healthy' });
    const [stored] = await ih.store.upsertMail(account.id, [
      {
        provider_message_id: 'force-1',
        provider_thread_id: 'force-thread',
        internet_message_id: null,
        in_reply_to: null,
        references_ids: [],
        direction: 'inbound',
        from_email: 'bulten@kampanya.example',
        from_name: null,
        to_emails: ['user@example.test'],
        cc_emails: [],
        subject: 'Kampanya',
        snippet: 'Kampanya',
        sent_at: null,
        received_at: '2026-09-22T05:00:00.000Z',
        is_read: false,
        importance: null,
        labels: [],
        has_attachments: false,
        list_unsubscribe: false,
        auto_submitted: false,
        precedence_bulk: false,
        dkim_pass: null,
        spf_pass: null,
        content_hash: 'a'.repeat(64),
        web_link: null,
        thread_web_link: null,
        deleted: false,
      } as Parameters<typeof ih.store.upsertMail>[1][number],
    ]);
    const messageId = stored!.id;
    const mixed = await call(h, 'POST', `/integrations/${account.id}/sync`, {
      jwt,
      body: { message_ids: [messageId], force_analysis: true, resources: ['calendar'] },
    });
    assertEquals(mixed.status, 422);
    const alone = await call(h, 'POST', `/integrations/${account.id}/sync`, {
      jwt,
      body: { message_ids: [messageId] },
    });
    assertEquals(alone.status, 422);
    const res = await call(h, 'POST', `/integrations/${account.id}/sync`, {
      jwt,
      body: { message_ids: [messageId], force_analysis: true },
    });
    assertEquals(res.status, 202);
    const data = (await res.json()).data;
    assertEquals(data.jobs.length, 1);
    const job = ih.jobs.jobs.get(data.jobs[0].job_id);
    assertEquals(job?.type, 'email_analysis');
    assert(job?.idempotency_key.startsWith(`email_analysis:${messageId}:force:`));
    assertEquals((job?.payload as { force?: boolean } | undefined)?.force, true);
    // A message of another account (here: unknown) is not found; nothing is enqueued.
    const other = await activeDemoAccount(ih, { userId: USER_A, status: 'healthy' });
    const unknown = await call(h, 'POST', `/integrations/${other.id}/sync`, {
      jwt,
      body: { message_ids: [messageId], force_analysis: true },
    });
    assertEquals(unknown.status, 404);
  },
);

Deno.test(
  'API-INT-05 / API-INT-03: stale expected_updated_at → 409; disconnect twice is a no-op',
  async () => {
    const { ih, h, jwt } = await setup();
    const account = await activeDemoAccount(ih, { userId: USER_A, status: 'healthy' });
    const stale = await call(h, 'PATCH', `/integrations/${account.id}/data-sources`, {
      jwt,
      key: crypto.randomUUID(),
      body: { data_sources: { draft_replies: false }, expected_updated_at: '2020-01-01T00:00:00Z' },
    });
    assertEquals(stale.status, 409);
    const key = crypto.randomUUID();
    const first = await call(h, 'POST', `/integrations/${account.id}/disconnect`, {
      jwt,
      key,
      body: { confirm: true, purge_content: true },
    });
    assertEquals(first.status, 200);
    const out = (await first.json()).data;
    assertEquals(out.revocation, 'provider_revoked');
    assertEquals(out.account.status, 'disconnected');
    const second = await call(h, 'POST', `/integrations/${account.id}/disconnect`, {
      jwt,
      key: crypto.randomUUID(),
      body: { confirm: true, purge_content: true },
    });
    assertEquals((await second.json()).data.purge_job.job_id, out.purge_job.job_id);
  },
);

Deno.test(
  'API-MAIL-01: the original is fetched on demand, sanitised, no-store; a disabled data source → 403',
  async () => {
    const { ih, h, jwt } = await setup();
    const account = await activeDemoAccount(ih, { userId: USER_A });
    await enqueueInitialSync(ih.runtime, account, {
      resource: 'mail',
      phase: 'first_pass',
      origin: 'test',
    });
    await drain(ih);
    const message = [...ih.store.mails.values()].find(
      (m) => m.from_email === 'ahmet@kuzeylojistik.com',
    );
    assert(message !== undefined);
    const res = await call(h, 'GET', `/mail/${message.id}/original`, { jwt });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Cache-Control'), 'no-store');
    const data = (await res.json()).data;
    assertEquals(data.message_id, message.id);
    assertEquals(data.body.format, 'html_sanitized');
    assert(!data.body.content.includes('<script'));
    assertEquals(data.from.email, 'ahmet@kuzeylojistik.com');
    ih.store.accounts.get(account.id)!.data_source_toggles = { mail_read: false };
    const off = await call(h, 'GET', `/mail/${message.id}/original`, { jwt });
    assertEquals((await off.json()).error.code, 'DATA_SOURCE_DISABLED');
    const other = await call(h, 'GET', `/mail/${crypto.randomUUID()}/original`, { jwt });
    assertEquals(other.status, 404);
  },
);
