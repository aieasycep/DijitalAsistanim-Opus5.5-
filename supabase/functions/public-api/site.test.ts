/**
 * PUB-04 referral resolve, PUB-05 plans and PUB-06 web events (TEST_PLAN EF-PUB-01, CT-05;
 * API_CONTRACTS PUB-04/05/06 tests).
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { publicRoutes } from '@da/validation';
import { publicHarness, send, WEB_ORIGIN } from './testing.ts';

const CODE = '2222222';

Deno.test('PUB-04 resolves an active code with store links and the app deep link', async () => {
  const h = await publicHarness();
  h.repo.codes.add(CODE);
  const res = await send(h, 'GET', `/referrals/${CODE.toLowerCase()}`, {
    headers: { Origin: WEB_ORIGIN },
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'public, max-age=300');
  const body = await res.json();
  assert(publicRoutes['GET /referrals/:code'].response.safeParse(body).success);
  assertEquals(body.data.valid, true);
  assertEquals(body.data.reward_days, 14);
  assertEquals(body.data.deep_link, `dijitalasistan://settings/referral?code=${CODE}`);
  assert(
    body.data.store_urls.android.includes(`&referrer=code%3D${CODE}`),
    'Play Install Referrer',
  );
  assertEquals(body.data.store_urls.ios, `${WEB_ORIGIN}/get?src=referral`);
  const withId = await publicHarness({ iosAppStoreId: '6450000000' });
  withId.repo.codes.add(CODE);
  const ios = (await (await send(withId, 'GET', `/referrals/${CODE}`)).json()).data.store_urls.ios;
  assertEquals(ios, 'https://apps.apple.com/app/id6450000000?ct=referral&mt=8');
});

Deno.test('PUB-04 unknown and malformed codes give the same 200 valid:false shape', async () => {
  const h = await publicHarness();
  const shapes: string[] = [];
  for (const code of ['3333333', 'ABC', 'O0I1L22']) {
    const res = await send(h, 'GET', `/referrals/${code}`);
    assertEquals(res.status, 200);
    const data = (await res.json()).data;
    assertEquals(data.valid, false);
    assertEquals(data.deep_link, 'dijitalasistan://settings/referral?code=');
    assertFalse(data.store_urls.android.includes('referrer'));
    shapes.push(Object.keys(data).sort().join(','));
  }
  assertEquals(new Set(shapes).size, 1);
});

Deno.test('PUB-04 is limited to 60 lookups per minute per IP hash', async () => {
  const h = await publicHarness();
  for (let i = 0; i < 60; i++) {
    const res = await send(h, 'GET', `/referrals/${CODE}`);
    await res.body?.cancel();
  }
  const limited = await send(h, 'GET', `/referrals/${CODE}`);
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error.code, 'RATE_LIMITED');
});

Deno.test('PUB-05 mirrors plan_limits and shows only verified, fresh store prices', async () => {
  const h = await publicHarness();
  const res = await send(h, 'GET', '/plans');
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'public, max-age=300');
  const body = await res.json();
  assert(publicRoutes['GET /plans'].response.safeParse(body).success);
  assertEquals(body.data.free, { mail_accounts: 1, calendars: 1, ai_analyses_per_day: 50 });
  assertEquals(body.data.pro, {
    mail_accounts: 'multiple',
    calendars: 'multiple',
    ai_policy: 'fair_use',
  });
  assertEquals(body.data.pricing, null, 'an unverified price is not shown');
  const pricing = {
    storefront: 'TR',
    currency: 'TRY',
    as_of: '2026-09-01',
    verified: true,
    monthly: { app_store: 199.99, play: 199.99 },
    annual: { app_store: 1499.99, play: 1499.99 },
    intro_offer: null,
  };
  h.repo.pricing = pricing;
  assertEquals((await (await send(h, 'GET', '/plans')).json()).data.pricing, pricing);
  h.repo.pricing = { ...pricing, as_of: '2026-05-01' };
  assertEquals(
    (await (await send(h, 'GET', '/plans')).json()).data.pricing,
    null,
    'older than 90 days',
  );
});

Deno.test('PUB-06 counts allow-listed web events and drops everything else', async () => {
  const h = await publicHarness();
  const event = {
    event: 'web_page_view',
    page: '/',
    locale: 'tr',
    device_class: 'mobile',
    theme: 'light',
    props: {},
  };
  const ok = await send(h, 'POST', '/web-events', { body: event, headers: { Origin: WEB_ORIGIN } });
  assertEquals(ok.status, 204);
  assertEquals(h.repo.counters.size, 1);
  for (const dropped of [
    { ...event, event: 'web_not_in_catalogue' },
    { ...event, event: 'briefing_opened' },
  ]) {
    const res = await send(h, 'POST', '/web-events', { body: dropped });
    assertEquals(res.status, 204);
  }
  assertEquals(h.repo.counters.size, 1, 'unknown and non-web events are dropped silently');
  const withEmail = await send(h, 'POST', '/web-events', {
    body: {
      ...event,
      event: 'web_referral_view',
      page: '/r/[code]',
      props: { valid: true, note: 'a@b.co', code: CODE },
    },
  });
  assertEquals(withEmail.status, 204);
  const keys = [...h.repo.counters.keys()].join('\n');
  assertFalse(keys.includes('a@b.co'));
  assertFalse(keys.includes(CODE));
  assert(keys.includes('"valid",true'));
  const strict = await send(h, 'POST', '/web-events', { body: { ...event, ip: '1.2.3.4' } });
  assertEquals(strict.status, 422);
  await strict.body?.cancel();
});
