/**
 * OAUTH-03 demo consent page (INTEGRATION_PLAN §13.2; TEST_PLAN E2E-M-03, IT-OAUTH-12): the page
 * lists every requested capability with its provider scope, "İzin Ver" grants the ticked subset
 * (→ `partial`), "Reddet" returns `error=access_denied` (→ the app's denied state).
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert';
import { toBase64Url } from '../_shared/crypto/encoding.ts';
import { sha256Hex } from '../_shared/crypto/hmac.ts';
import { completeOAuth, startConnect } from '../_shared/services/integrations/connect.ts';
import {
  demoConsent,
  integrationHarness,
  type IntegrationHarness,
} from '../_shared/testing/integrations.ts';
import { USER_A } from '../_shared/testing/jwt.ts';
import { createOAuthApp, demoConsentPage, demoScopeName } from './app.ts';

async function start(
  h: IntegrationHarness,
  capabilities: ('mail_read' | 'calendar_read' | 'tasks_read')[] = ['mail_read', 'calendar_read'],
) {
  const deviceNonce = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const out = await startConnect(h.runtime, {
    userId: USER_A,
    provider: 'demo',
    capabilities,
    deviceNonceHash: await sha256Hex(deviceNonce),
    locale: 'tr-TR',
  });
  const app = createOAuthApp({ runtime: h.runtime, demoEnabled: true, log: h.runtime.log });
  return { app, authUrl: new URL(out.data.auth_url), deviceNonce };
}

async function follow(app: ReturnType<typeof createOAuthApp>, res: Response): Promise<URL> {
  assertEquals(res.status, 302);
  const next = new URL(res.headers.get('Location') ?? '');
  assert(next.pathname.endsWith('/oauth/demo/callback'), next.pathname);
  const cb = await app.request(`/oauth/demo/callback${next.search}`);
  assertEquals(cb.status, 302);
  return new URL(cb.headers.get('Location') ?? '');
}

Deno.test(
  'GET /demo/authorize renders the consent page: requested scopes, İzin Ver, Reddet',
  async () => {
    const h = await integrationHarness();
    const { app, authUrl } = await start(h);
    const page = await app.request(`/oauth/demo/authorize${authUrl.search}`);
    assertEquals(page.status, 200);
    assertEquals(page.headers.get('Cache-Control'), 'no-store');
    assertEquals(page.headers.get('Referrer-Policy'), 'no-referrer');
    assertStringIncludes(page.headers.get('Content-Security-Policy') ?? '', "default-src 'none'");
    const html = await page.text();
    assertStringIncludes(html, '<html lang="tr">');
    assertStringIncludes(html, 'Demo hesabı bağla');
    assertStringIncludes(html, 'value="mail_read" checked');
    assertStringIncludes(html, 'value="calendar_read" checked');
    assertFalse(html.includes('value="tasks_read"'));
    assertStringIncludes(html, '<span>Mailleri okuma</span><code>gmail.readonly</code>');
    assertStringIncludes(html, '>İzin Ver</button>');
    assertStringIncludes(html, '>Reddet</button>');
    assertFalse(html.includes('<script'));
    assertStringIncludes(html, `name="state" value="${authUrl.searchParams.get('state') ?? ''}"`);

    const en = await app.request(`/oauth/demo/authorize${authUrl.search}`, {
      headers: { 'Accept-Language': 'en-US' },
    });
    const enHtml = await en.text();
    assertStringIncludes(enHtml, '<html lang="en">');
    assertStringIncludes(enHtml, '>Deny</button>');
    // Unknown or malformed state → the localized 400 page.
    const bad = await app.request(
      `/oauth/demo/authorize?state=${'A'.repeat(43)}&code_challenge=${'B'.repeat(43)}`,
    );
    assertEquals(bad.status, 400);
    assertEquals((await app.request('/oauth/demo/authorize?state=x')).status, 400);
  },
);

Deno.test('İzin Ver with gmail.readonly unticked → partial account without mail_read', async () => {
  const h = await integrationHarness();
  const { app, authUrl, deviceNonce } = await start(h);
  const res = await demoConsent(app, authUrl, { capabilities: ['calendar_read', 'tasks_write'] });
  const link = await follow(app, res);
  assertEquals(link.searchParams.get('result'), 'pending_confirmation');
  const done = await completeOAuth(h.runtime, {
    userId: USER_A,
    completionCode: link.searchParams.get('completion_code') ?? '',
    deviceNonce,
    correlationId: crypto.randomUUID(),
  });
  assertEquals(done.account?.status, 'partial');
  // Never more than requested: the extra `tasks_write` in the form is ignored.
  assertEquals(done.account?.capabilities_granted, ['calendar_read']);
});

Deno.test('Reddet → access_denied → the denied result, no account', async () => {
  const h = await integrationHarness();
  const { app, authUrl } = await start(h);
  const res = await demoConsent(app, authUrl, { decision: 'deny' });
  assertEquals(res.status, 302);
  assertEquals(
    new URL(res.headers.get('Location') ?? '').searchParams.get('error'),
    'access_denied',
  );
  const link = await follow(app, res);
  assertEquals(link.searchParams.get('result'), 'denied');
  assertEquals(link.searchParams.get('completion_code'), null);
  assertEquals(h.store.accounts.size, 0);
});

Deno.test('POST /demo/authorize refuses a bad decision or state; demo off → 404', async () => {
  const h = await integrationHarness();
  const { app, authUrl } = await start(h);
  const post = (target: ReturnType<typeof createOAuthApp>, body: string) =>
    target.request('/oauth/demo/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  const state = authUrl.searchParams.get('state') ?? '';
  const challenge = authUrl.searchParams.get('code_challenge') ?? '';
  assertEquals(
    (await post(app, `state=${state}&code_challenge=${challenge}&decision=maybe`)).status,
    400,
  );
  assertEquals(
    (await post(app, `state=${'C'.repeat(43)}&code_challenge=${challenge}&decision=allow`)).status,
    400,
  );
  assertEquals((await post(app, '')).status, 400);
  const off = createOAuthApp({ runtime: h.runtime, demoEnabled: false, log: h.runtime.log });
  assertEquals(
    (await post(off, `state=${state}&code_challenge=${challenge}&decision=allow`)).status,
    404,
  );
  assertEquals((await off.request(`/oauth/demo/authorize${authUrl.search}`)).status, 404);
});

Deno.test('consent page helpers: provider scope names per flavour; markup is escaped', async () => {
  assertEquals(demoScopeName('google', 'mail_read'), 'gmail.readonly');
  assertEquals(demoScopeName('google', 'calendar_write'), 'calendar.events.owned');
  assertEquals(demoScopeName('microsoft', 'mail_send'), 'Mail.Send');
  const page = demoConsentPage({
    locale: 'en-US',
    state: '"><img src=x>',
    codeChallenge: 'c',
    flavor: 'microsoft',
    capabilities: ['tasks_read'],
  });
  const html = await page.text();
  assertStringIncludes(html, 'value="&quot;&gt;&lt;img src=x&gt;"');
  assertStringIncludes(html, '<span>Read tasks</span><code>Tasks.Read</code>');
});
