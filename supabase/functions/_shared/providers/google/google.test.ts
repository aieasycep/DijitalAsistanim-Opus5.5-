/**
 * Google adapters against recorded responses (`__fixtures__/*.json`; no network): TEST_PLAN
 * EF-OAUTH-01, IT-SYNC-GMAIL, IT-SYNC-GCAL; API_CONTRACTS OAUTH-01, JOB-01/02/04/05, API-INT-03.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { type ProviderContext, ProviderError } from '@da/domain';
import { sha256 } from '../../crypto/hmac.ts';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import gmailFixture from './__fixtures__/gmail.json' with { type: 'json' };
import oauthFixture from './__fixtures__/oauth.json' with { type: 'json' };
import calendarFixture from './__fixtures__/calendar.json' with { type: 'json' };
import tasksFixture from './__fixtures__/tasks.json' with { type: 'json' };
import { GoogleOAuth } from './auth.ts';
import { GoogleCalendarAdapter, normalizeGoogleEvent } from './calendar.ts';
import { GOOGLE_ENDPOINTS } from './config.ts';
import { GmailAdapter, normalizeGmailMessage } from './gmail.ts';
import { GoogleTasksAdapter, normalizeGoogleTask } from './tasks.ts';

const NOW = new Date('2026-09-24T07:30:00.000Z');

function ctx(): ProviderContext {
  return {
    account: {
      connectedAccountId: '55555555-5555-4555-8555-555555555555',
      userId: '11111111-1111-4111-8111-111111111111',
      provider: 'google',
      providerAccountId: '1098765432109876543',
      email: 'yunus@gmail.com',
      tenantId: null,
      tenantType: null,
      capabilitiesGranted: ['mail_read', 'calendar_read', 'tasks_read'],
      dataSourceToggles: {
        mail_read: true,
        attachments_analyze: true,
        deadline_detect: true,
        draft_replies: true,
        calendar_read: true,
        schedule_suggest: true,
        calendar_write_with_approval: true,
        tasks_read: true,
      },
    },
    tokens: { get: () => Promise.resolve('ya29.test-access-token') },
    quota: { acquire: () => Promise.resolve() },
    clock: { now: () => NOW },
    log: { info() {}, warn() {}, error() {} },
    correlationId: 'test',
  };
}

Deno.test('Gmail metadata → the stored header subset with deterministic triage signals', () => {
  const m = normalizeGmailMessage(gmailFixture.messages['18f0a1'], NOW);
  assertEquals(m.subject, 'Revize teklif');
  assertEquals(m.from, { address: 'ahmet@kuzeylojistik.com', name: 'Ahmet Yılmaz' });
  assertEquals(m.folder, 'inbox');
  assertEquals(m.providerCategory, 'primary');
  assertEquals(m.isRead, false);
  assertEquals(m.receivedAt, '2026-09-24T05:42:00.000Z');
  assertEquals(m.headers.authentication, {
    dkim: 'pass',
    spf: 'pass',
    dmarc: 'pass',
    dkimDomain: 'kuzeylojistik.com',
  });
  assertEquals(m.snippet.includes('&#39;'), false);
  assert(m.snippet.length <= 200);
  const promo = normalizeGmailMessage(gmailFixture.messages['18f0a2'], NOW);
  assertEquals(promo.headers.listUnsubscribe, true);
  assertEquals(promo.headers.precedence, 'bulk');
  assertEquals(promo.providerCategory, 'promotions');
  const sent = normalizeGmailMessage(gmailFixture.messages['18f0b1'], NOW);
  assertEquals(sent.folder, 'sent');
  assertEquals(sent.inReplyTo, '<CAK1234@mail.kuzeylojistik.com>');
  assertEquals(sent.references, ['<CAK1234@mail.kuzeylojistik.com>']);
});

Deno.test(
  'Gmail history: added ids need metadata, deletes and label changes, the new history id',
  async () => {
    const stub = stubFetch((call) => {
      const url = new URL(call.url);
      assertEquals(call.headers.get('Authorization'), 'Bearer ya29.test-access-token');
      if (url.pathname.endsWith('/history')) {
        assertEquals(url.searchParams.get('startHistoryId'), '987650');
        assertEquals(url.searchParams.getAll('historyTypes').length, 4);
        return jsonResponse(gmailFixture.history);
      }
      return new Response('unexpected', { status: 599 });
    });
    const gmail = new GmailAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: stub.fetch },
      pubsubTopic: null,
    });
    const set = await gmail.changesSince(ctx(), { kind: 'gmail_history', value: '987650' });
    assertEquals(set.needsMetadata, ['18f0c9']);
    assertEquals(set.deleted, ['18f0a2']);
    assertEquals(set.labelChanges, [
      { providerMessageId: '18f0a1', labels: ['INBOX', 'CATEGORY_PERSONAL'], isRead: true },
    ]);
    assertEquals(set.nextCursor, { kind: 'gmail_history', value: '987700' });
  },
);

Deno.test('Gmail history 404 → cursor_invalid (the engine re-syncs 7 days)', async () => {
  const stub = stubFetch(() => jsonResponse(gmailFixture.history_expired, 404));
  const gmail = new GmailAdapter({
    endpoints: GOOGLE_ENDPOINTS,
    http: { fetch: stub.fetch },
    pubsubTopic: null,
  });
  const err = await assertRejects(
    () => gmail.changesSince(ctx(), { kind: 'gmail_history', value: '1' }),
    ProviderError,
  );
  assertEquals(err.code, 'cursor_invalid');
});

Deno.test(
  'Gmail body (API-MAIL-01 input): html preferred, attachments listed, nothing cached',
  async () => {
    const stub = stubFetch((call) => {
      assertEquals(new URL(call.url).searchParams.get('format'), 'full');
      return jsonResponse(gmailFixture.full_message);
    });
    const gmail = new GmailAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: stub.fetch },
      pubsubTopic: null,
    });
    const body = await gmail.getMessageBody(ctx(), '18f0a1', { maxBytes: 512 * 1024 });
    assert(body.html?.includes('Revize teklifimizi'));
    assertEquals(body.attachments, [
      {
        providerAttachmentId: 'ANGjdJ8-att-1',
        filename: 'Teklif_v2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 182044,
        inline: false,
      },
    ]);
  },
);

Deno.test(
  'Gmail watch without a Pub/Sub topic → external_credential_required (poll fallback)',
  async () => {
    const gmail = new GmailAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: stubFetch(() => jsonResponse({})).fetch },
      pubsubTopic: null,
    });
    const err = await assertRejects(() => gmail.watch(ctx(), ''), ProviderError);
    assertEquals(err.code, 'external_credential_required');
  },
);

Deno.test(
  'Google Calendar: allow-listed Meet link kept, phishing join URL dropped, all-day dates, approval marker',
  () => {
    const [meeting, phish, allDay] = calendarFixture.events_full.items.map((e) =>
      normalizeGoogleEvent(e, 'yunus@gmail.com'),
    );
    assertEquals(meeting?.conferenceUrl, 'https://meet.google.com/abc-defg-hij');
    assertEquals(meeting?.userIsOrganizer, true);
    assertEquals(meeting?.daApprovalId, '8a4f1c9e-1111-4222-8333-944455556666');
    assertEquals(meeting?.descriptionSnippet, 'Revize teklif ve 2026 bütçe kalemleri.');
    assertEquals(phish?.conferenceUrl, null);
    assertEquals(allDay?.allDay, true);
    assertEquals(allDay?.start, { date: '2026-09-26' });
    assertEquals(allDay?.transparency, 'free');
  },
);

Deno.test('Google Calendar: incremental cancelled → deleted id; 410 → cursor_invalid', async () => {
  let gone = false;
  const stub = stubFetch((call) => {
    const url = new URL(call.url);
    assertEquals(url.searchParams.get('singleEvents'), 'true');
    if (gone) return jsonResponse(calendarFixture.sync_token_gone, 410);
    assertEquals(url.searchParams.get('syncToken'), 'CPDAlvWDx70CEPDAlvWDx70CGAU=');
    return jsonResponse(calendarFixture.events_delta);
  });
  const cal = new GoogleCalendarAdapter({
    endpoints: GOOGLE_ENDPOINTS,
    http: { fetch: stub.fetch },
    webhook: null,
  });
  const set = await cal.changesSince(ctx(), 'yunus@gmail.com', {
    kind: 'gcal_sync_token',
    value: 'CPDAlvWDx70CEPDAlvWDx70CGAU=',
  });
  assertEquals(set.deleted, ['evt-mehmet-0924']);
  assertEquals(
    set.upserts.map((e) => e.title),
    ['Selin ile sözleşme'],
  );
  assertEquals(set.nextCursor?.value, 'CPDAlvWDx70CEPDAlvWDx70CGAY=');
  gone = true;
  const err = await assertRejects(
    () => cal.changesSince(ctx(), 'yunus@gmail.com', { kind: 'gcal_sync_token', value: 'old' }),
    ProviderError,
  );
  assertEquals(err.code, 'cursor_invalid');
});

Deno.test(
  'Google Calendar list: holidays are typed; only owned calendars are writable',
  async () => {
    const cal = new GoogleCalendarAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: stubFetch(() => jsonResponse(calendarFixture.calendar_list)).fetch },
      webhook: null,
    });
    const list = await cal.listCalendars(ctx());
    assertEquals(
      list.map((c) => [c.kind, c.canWrite]),
      [
        ['default', true],
        ['holidays', false],
        ['other', false],
      ],
    );
  },
);

Deno.test(
  'Google Calendar channel: the token is HMAC(channel id) and only its hash is kept',
  async () => {
    const stub = stubFetch((call) => {
      const body = JSON.parse(call.body ?? '{}') as {
        id: string;
        token: string;
        type: string;
        address: string;
      };
      assertEquals(body.type, 'web_hook');
      assertEquals(body.address, 'https://api.example.test/functions/v1/webhooks-google/calendar');
      return jsonResponse({ id: body.id, resourceId: 'res-1', expiration: '1790839200000' });
    });
    const cal = new GoogleCalendarAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: stub.fetch },
      webhook: {
        address: 'https://api.example.test/functions/v1/webhooks-google/calendar',
        hmacSecret: 'secret-secret-secret-secret-secret-00',
      },
      newId: () => '0c1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    });
    const handle = await cal.watch(ctx(), 'yunus@gmail.com');
    assertEquals(handle.watchId, '0c1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b');
    assertEquals(handle.providerResourceId, 'res-1');
    const sent = JSON.parse(stub.calls[0]?.body ?? '{}') as { token: string };
    const expected = [...(await sha256(sent.token))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    assertEquals(handle.tokenHash, expected);
  },
);

Deno.test('Google Tasks: date-only due, deleted ids, completed kept', async () => {
  const task = normalizeGoogleTask(
    tasksFixture.tasks.items[0] as Parameters<typeof normalizeGoogleTask>[0],
    'MDE2NzQ0',
  );
  assertEquals(task.due, { date: '2026-09-24' });
  const stub = stubFetch((call) => {
    const url = new URL(call.url);
    assertEquals(url.searchParams.get('showDeleted'), 'true');
    assertEquals(url.searchParams.get('updatedMin'), '2026-09-23T23:59:00.000Z');
    return jsonResponse(tasksFixture.tasks);
  });
  const tasks = new GoogleTasksAdapter({
    endpoints: GOOGLE_ENDPOINTS,
    http: { fetch: stub.fetch },
  });
  const set = await tasks.changesSince(ctx(), 'MDE2NzQ0', {
    kind: 'gtasks_updated_min',
    value: '2026-09-24T00:00:00.000Z',
  });
  assertEquals(set.deleted, ['t3']);
  assertEquals(
    set.upserts.map((t) => t.status),
    ['open', 'completed'],
  );
});

Deno.test(
  'Google OAuth: code exchange, verified id_token with nonce, revoke (400 invalid_token counts as revoked)',
  async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: 'g1', alg: 'RS256', use: 'sig' }],
    });
    const clientId = '1234567890-abc.apps.googleusercontent.com';
    const nonce = 'n'.repeat(43);
    const idToken = await new SignJWT({
      sub: '1098765432109876543',
      email: 'Yunus@Gmail.com',
      email_verified: true,
      nonce,
      name: 'Yunus',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'g1' })
      .setIssuer('https://accounts.google.com')
      .setAudience(clientId)
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 3600)
      .sign(privateKey);
    const stub = stubFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === '/token') {
        const form = new URLSearchParams(call.body ?? '');
        assertEquals(form.get('grant_type'), 'authorization_code');
        assertEquals(form.get('code_verifier'), 'v'.repeat(64));
        return jsonResponse({ ...oauthFixture.token_response, id_token: idToken });
      }
      if (url.pathname === '/revoke') return jsonResponse(oauthFixture.revoke_invalid_token, 400);
      return new Response('unexpected', { status: 599 });
    });
    const oauth = new GoogleOAuth({
      clientId,
      clientSecret: 's',
      endpoints: GOOGLE_ENDPOINTS,
      jwks,
      fetch: stub.fetch,
      now: () => NOW,
    });
    const tokens = await oauth.exchangeCode({
      code: '4/0AX',
      codeVerifier: 'v'.repeat(64),
      redirectUri: 'https://api.example.test/functions/v1/oauth/google/callback',
    });
    assertEquals(tokens.refreshToken, '1//test-refresh-token');
    assertEquals(oauth.capabilitiesFromGrantedScope(tokens.grantedScope), [
      'mail_read',
      'calendar_read',
    ]);
    const identity = await oauth.identify(tokens, { expectedNonceHash: await sha256(nonce) });
    assertEquals(identity.providerAccountId, '1098765432109876543');
    assertEquals(identity.email, 'yunus@gmail.com');
    const otherHash = await sha256('other');
    const wrong = await assertRejects(
      () => oauth.identify(tokens, { expectedNonceHash: otherHash }),
      ProviderError,
    );
    assertEquals(wrong.code, 'payload_invalid');
    assertEquals(await oauth.revoke({ refreshToken: '1//test-refresh-token' }), {
      mode: 'provider_revoked',
    });
    const revokeCall = stub.calls.find((c) => c.url.endsWith('/revoke'));
    assertEquals(new URLSearchParams(revokeCall?.body ?? '').get('token'), '1//test-refresh-token');
  },
);

Deno.test('Google OAuth refresh invalid_grant → auth_invalid_grant (needs_reauth)', async () => {
  const stub = stubFetch(() => jsonResponse(oauthFixture.invalid_grant, 400));
  const oauth = new GoogleOAuth({
    clientId: 'c',
    clientSecret: 's',
    endpoints: GOOGLE_ENDPOINTS,
    jwks: createLocalJWKSet({ keys: [] }),
    fetch: stub.fetch,
  });
  const err = await assertRejects(() => oauth.refresh({ refreshToken: 'x' }), ProviderError);
  assertEquals(err.code, 'auth_invalid_grant');
});
