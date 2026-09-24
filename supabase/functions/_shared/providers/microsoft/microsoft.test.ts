/**
 * Microsoft adapters against recorded Graph / identity-platform responses (`__fixtures__/graph.json`;
 * no network): TEST_PLAN EF-OAUTH-02, IT-SYNC-GRAPH; API_CONTRACTS OAUTH-02, JOB-03/07, API-INT-03.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import { type ProviderContext, ProviderError } from '@da/domain';
import { sha256Hex } from '../../crypto/hmac.ts';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import graph from './__fixtures__/graph.json' with { type: 'json' };
import { MicrosoftOAuth } from './auth.ts';
import { CONSUMER_TENANT_ID, MICROSOFT_ENDPOINTS, microsoftManualRevokeUrl } from './config.ts';
import { microsoftAuthorizeOutcome } from './errors.ts';
import { GraphClient } from './graph.ts';
import { normalizeGraphMessage, OutlookMailAdapter } from './mail.ts';
import { GraphSubscriptions } from './subscriptions.ts';

const NOW = new Date('2026-09-24T07:30:00.000Z');
const CLIENT_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

function ctx(): ProviderContext {
  return {
    account: {
      connectedAccountId: '66666666-6666-4666-8666-666666666666',
      userId: '11111111-1111-4111-8111-111111111111',
      provider: 'microsoft',
      providerAccountId:
        '7d8e9f00-1111-4222-8333-444455556666:72f988bf-86f1-41af-91ab-2d7cd011db47',
      email: 'yunus@contoso.example',
      tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
      tenantType: 'work',
      capabilitiesGranted: ['mail_read'],
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
    tokens: { get: () => Promise.resolve('graph-token') },
    quota: { acquire: () => Promise.resolve() },
    clock: { now: () => NOW },
    log: { info() {}, warn() {}, error() {} },
    correlationId: 'test',
  };
}

Deno.test(
  'client assertion: PS256 with x5t#S256, iss = sub = client id, aud = token endpoint, 10-minute expiry',
  async () => {
    const { privateKey, publicKey } = await generateKeyPair('PS256', { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const idToken = await new SignJWT({
      oid: '7d8e9f00-1111-4222-8333-444455556666',
      tid: CONSUMER_TENANT_ID,
      preferred_username: 'yunus@outlook.com',
    })
      .setProtectedHeader({ alg: 'PS256' })
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .sign(privateKey);
    const stub = stubFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith('/oauth2/v2.0/token'))
        return jsonResponse({ ...graph.token_response, id_token: idToken });
      if (url.pathname.endsWith('/me')) return jsonResponse(graph.me);
      return new Response('unexpected', { status: 599 });
    });
    const oauth = new MicrosoftOAuth({
      clientId: CLIENT_ID,
      privateKeyPem: pem,
      thumbprintS256: 'q2VKc3vW0yqWZ0pQkO6m3Qm0Vq9YpQ0mPpLkZ4oXyZ0',
      authorityTenant: 'common',
      endpoints: MICROSOFT_ENDPOINTS,
      fetch: stub.fetch,
      now: () => NOW,
    });
    const tokens = await oauth.exchangeCode({
      code: 'M.C1',
      codeVerifier: 'v'.repeat(64),
      redirectUri: 'https://api.example.test/functions/v1/oauth/microsoft/callback',
    });
    const form = new URLSearchParams(stub.calls[0]?.body ?? '');
    assertEquals(
      form.get('client_assertion_type'),
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    assertEquals(form.get('client_secret'), null);
    const assertion = form.get('client_assertion') ?? '';
    const header = decodeProtectedHeader(assertion);
    assertEquals(header.alg, 'PS256');
    assertEquals(header['x5t#S256'], 'q2VKc3vW0yqWZ0pQkO6m3Qm0Vq9YpQ0mPpLkZ4oXyZ0');
    const claims = decodeJwt(assertion);
    assertEquals(
      [claims.iss, claims.sub, claims.aud],
      [CLIENT_ID, CLIENT_ID, 'https://login.microsoftonline.com/common/oauth2/v2.0/token'],
    );
    assertEquals((claims.exp ?? 0) - (claims.nbf ?? 0), 600);
    await jwtVerify(assertion, publicKey, { currentDate: NOW });
    assertEquals(oauth.capabilitiesFromGrantedScope(tokens.grantedScope), [
      'mail_read',
      'calendar_read',
    ]);
    const identity = await oauth.identify(tokens);
    assertEquals(identity.tenantType, 'personal');
    assertEquals(identity.providerAccountId.endsWith(`:${CONSUMER_TENANT_ID}`), true);
    // Rotation: the newest refresh token is what comes back.
    assertEquals(tokens.refreshToken, '0.AXoA-test-graph-refresh');
    assertEquals(oauth.tenantFor(CONSUMER_TENANT_ID), 'consumers');
  },
);

Deno.test(
  'authorize errors: AADSTS90094 → admin_consent_required; consent_required / 65001 → denied',
  () => {
    assertEquals(
      microsoftAuthorizeOutcome(
        'access_denied',
        'AADSTS90094: The grant requires admin permission.',
      ).result,
      'admin_consent_required',
    );
    assertEquals(
      microsoftAuthorizeOutcome('consent_required', 'AADSTS65001: The user has not consented.')
        .result,
      'denied',
    );
    assertEquals(microsoftAuthorizeOutcome('server_error', 'AADSTS50000').result, 'error');
  },
);

Deno.test(
  'token endpoint AADSTS90094 → consent_admin_required; revoke is local-only with the manual page',
  async () => {
    const stub = stubFetch(() => jsonResponse(graph.admin_consent_error, 400));
    const { privateKey } = await generateKeyPair('PS256', { extractable: true });
    const oauth = new MicrosoftOAuth({
      clientId: CLIENT_ID,
      privateKeyPem: await exportPKCS8(privateKey),
      thumbprintS256: 'x',
      authorityTenant: 'common',
      endpoints: MICROSOFT_ENDPOINTS,
      fetch: stub.fetch,
    });
    const err = await assertRejects(
      () => oauth.refresh({ refreshToken: 'r', tenantId: null }),
      ProviderError,
    );
    assertEquals(err.code, 'consent_admin_required');
    assertEquals(await oauth.revoke({ refreshToken: 'r', tenantType: 'work' }), {
      mode: 'local_only',
      userActionUrl: microsoftManualRevokeUrl('work'),
    });
  },
);

Deno.test(
  'Graph delta: immutable ids, @removed → deleted, nextLink paging then the deltaLink cursor, 410 → cursor_invalid',
  async () => {
    let expired = false;
    const stub = stubFetch((call) => {
      assertEquals(call.headers.get('Prefer')?.includes('IdType="ImmutableId"'), true);
      if (expired) return jsonResponse(graph.delta_expired, 410);
      return jsonResponse(
        call.url.includes('skiptoken=page2') ? graph.inbox_delta_page2 : graph.inbox_delta_page1,
      );
    });
    const client = new GraphClient({
      base: MICROSOFT_ENDPOINTS.graph,
      http: { fetch: stub.fetch },
    });
    const mail = new OutlookMailAdapter(client, new GraphSubscriptions(client, null));
    const cursor = {
      kind: 'graph_delta' as const,
      folder: 'inbox' as const,
      value:
        "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=start",
    };
    const first = await mail.changesSince(ctx(), cursor);
    assertEquals(first.deleted, ['AAMkAGI2-immutable-0']);
    assertEquals(first.upserts[0]?.from, {
      address: 'selin.kaya@contoso.example',
      name: 'Selin Kaya',
    });
    assertEquals(first.upserts[0]?.isFlagged, true);
    assertEquals(first.upserts[0]?.providerCategory, 'focused');
    assert((first.upserts[0]?.snippet.length ?? 0) <= 200);
    const second = await mail.changesSince(ctx(), cursor, first.pageToken);
    assertEquals(second.pageToken, null);
    assertEquals(
      second.nextCursor.value,
      "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=final",
    );
    expired = true;
    const err = await assertRejects(() => mail.changesSince(ctx(), cursor), ProviderError);
    assertEquals(err.code, 'cursor_invalid');
    // A foreign nextLink origin is refused (the token never leaves Graph).
    const foreign = await assertRejects(
      () => mail.changesSince(ctx(), cursor, 'https://evil.example.com/steal'),
      ProviderError,
    );
    assertEquals(foreign.code, 'payload_invalid');
  },
);

Deno.test('Graph message normalisation keeps the webLink and headers subset only', () => {
  const m = normalizeGraphMessage(
    graph.inbox_delta_page1.value[0] as Parameters<typeof normalizeGraphMessage>[0],
    'inbox',
    NOW,
  );
  assertEquals(m.webLink, 'https://outlook.office365.com/owa/?ItemID=AAMkAGI2-immutable-1');
  assertEquals(m.providerImportance, 'high');
  assertEquals(m.rfc822MessageId, '<DB7PR01MB1234@contoso.example>');
});

Deno.test(
  'Graph subscription: clientState is random, only its hash is kept; without webhook URLs → external_credential_required',
  async () => {
    const stub = stubFetch((call) => {
      const body = JSON.parse(call.body ?? '{}') as Record<string, string>;
      assertEquals(body.resource, "me/mailFolders('inbox')/messages");
      assertEquals(body.changeType, 'created,updated,deleted');
      assertEquals(body.latestSupportedTlsVersion, 'v1_2');
      assertEquals((body.clientState ?? '').length, 64);
      return jsonResponse(graph.subscription_created, 201);
    });
    const client = new GraphClient({
      base: MICROSOFT_ENDPOINTS.graph,
      http: { fetch: stub.fetch },
    });
    const mail = new OutlookMailAdapter(
      client,
      new GraphSubscriptions(client, {
        notificationUrl: 'https://api.example.test/functions/v1/webhooks-microsoft/notifications',
        lifecycleUrl: 'https://api.example.test/functions/v1/webhooks-microsoft/lifecycle',
      }),
    );
    const handle = await mail.watch(ctx(), 'inbox');
    assertEquals(handle.watchId, '7f105c7d-2dc5-4530-97cd-4e7ae6534c07');
    const sent = JSON.parse(stub.calls[0]?.body ?? '{}') as { clientState: string };
    assertEquals(handle.tokenHash, await sha256Hex(sent.clientState));
    const bare = new OutlookMailAdapter(client, new GraphSubscriptions(client, null));
    const err = await assertRejects(() => bare.watch(ctx(), 'inbox'), ProviderError);
    assertEquals(err.code, 'external_credential_required');
  },
);
