import { assert, assertEquals, assertFalse } from '@std/assert';
import { routes } from '@da/validation';
import { USER_A } from '../_shared/testing/jwt.ts';
import { accountRow, call, createHarness, NOW } from './testing.ts';

const INSTALLATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

Deno.test(
  'GET /me/bootstrap returns the contract shape with allow-listed account fields only',
  async () => {
    const h = await createHarness();
    const res = await call(h, 'GET', '/me/bootstrap', {
      jwt: await h.token(USER_A),
      headers: { 'X-DA-Installation-Id': INSTALLATION },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    const parsed = routes['GET /me/bootstrap'].response.safeParse(body);
    assert(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3)));
    const data = body.data;
    assertEquals(data.server_now, NOW.toISOString());
    assertEquals(data.account_state, 'active');
    assertEquals(data.profile.auth_providers, ['apple']);
    assertEquals(data.config.upgrade_required, false);
    assertEquals(data.config.referral_reward_days, 30);
    const account = data.accounts[0];
    assertEquals(account.manual_revoke_url, 'https://myapps.microsoft.com');
    assertEquals(account.data_sources.draft_replies, false);
    assertEquals(account.data_sources.mail_read, true);
    const text = JSON.stringify(data);
    assertFalse(text.includes('provider-internal-id'));
    assertFalse(text.includes('deltatoken'));
    assertFalse(text.includes('Mail.Read'));
    assertEquals(h.touched, [`${USER_A}:${INSTALLATION}`]);
  },
);

Deno.test('bootstrap lists unavailable features instead of pretending they work', async () => {
  const h = await createHarness();
  const data = (
    await (await call(h, 'GET', '/me/bootstrap', { jwt: await h.token(USER_A) })).json()
  ).data;
  const features = Object.fromEntries(
    (data.service_status.unavailable_features as { feature: string; reason: string }[]).map((f) => [
      f.feature,
      f.reason,
    ]),
  );
  assertEquals(features.assistant, 'external_credential_required');
  assertEquals(features.reply_drafts, 'feature_disabled');
  assertEquals(features['integrations.google'], 'external_credential_required');
  assertEquals(features['integrations.microsoft'], 'external_credential_required');
  assertEquals(features.purchases, 'external_credential_required');
  assertEquals(features.push, 'external_credential_required');
  const configured = await createHarness({
    capabilities: {
      aiGenerate: true,
      embeddings: true,
      googleOauth: true,
      microsoftOauth: true,
      purchases: true,
      push: true,
    },
  });
  const ready = (
    await (
      await call(configured, 'GET', '/me/bootstrap', { jwt: await configured.token(USER_A) })
    ).json()
  ).data;
  assertEquals(
    (ready.service_status.unavailable_features as { feature: string }[]).map((f) => f.feature),
    ['reply_drafts'],
  );
});

Deno.test(
  'bootstrap is cacheable: a weak ETag that ignores server_now, and 304 on If-None-Match',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const first = await call(h, 'GET', '/me/bootstrap', { jwt });
    const etag = first.headers.get('ETag');
    assert(etag !== null && etag.startsWith('W/"'));
    assertEquals(first.headers.get('Cache-Control'), 'private, no-cache');
    await first.body?.cancel();
    const again = await call(h, 'GET', '/me/bootstrap', {
      jwt,
      headers: { 'If-None-Match': etag },
    });
    assertEquals(again.status, 304);
    assertEquals(await again.text(), '');
    h.accountRows.push(
      accountRow({
        id: '66666666-6666-4666-8666-666666666666',
        provider: 'google',
        tenant_type: null,
      }),
    );
    const changed = await call(h, 'GET', '/me/bootstrap', {
      jwt,
      headers: { 'If-None-Match': etag },
    });
    assertEquals(changed.status, 200);
    await changed.body?.cancel();
  },
);

Deno.test(
  'a disabled account still gets its bootstrap, with the state and upgrade flag in the body',
  async () => {
    const h = await createHarness();
    h.accounts.set(USER_A, { state: 'active', disabledAt: '2026-09-20T00:00:00Z' });
    const res = await call(h, 'GET', '/me/bootstrap', {
      jwt: await h.token(USER_A),
      headers: { 'X-DA-Client': 'ios/1.1.0' },
    });
    assertEquals(res.status, 200);
    const data = (await res.json()).data;
    assertEquals(data.account_state, 'disabled');
    assertEquals(data.config.upgrade_required, true);
  },
);

Deno.test(
  'GET /me/entitlements returns the entitlement state and the local-day usage',
  async () => {
    const h = await createHarness();
    const res = await call(h, 'GET', '/me/entitlements', { jwt: await h.token(USER_A) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(routes['GET /me/entitlements'].response.safeParse(body).success);
    assertEquals(body.data.entitlement.is_active, false);
    assertEquals(body.data.entitlement.source, 'none');
    assertEquals(body.data.usage.plan, 'free');
    assertEquals(body.data.usage.ai_units, { limit: 20, used: 3, remaining: 17 });
    assertEquals(body.data.usage.limits.captures_per_day, { limit: 5, used: 1, remaining: 4 });
    // Next local midnight in Europe/Istanbul (UTC+3).
    assertEquals(body.data.usage.resets_at, '2026-09-23T21:00:00.000Z');
  },
);
