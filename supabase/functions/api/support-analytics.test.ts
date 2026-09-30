import { assert, assertEquals, assertFalse } from '@std/assert';
import { USER_A } from '../_shared/testing/jwt.ts';
import { call, createHarness, NOW } from './testing.ts';
import { RATING_ONLY_MESSAGE } from './routes/support.ts';

const SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const recent = new Date(NOW.getTime() - 60_000).toISOString();

Deno.test(
  'POST /analytics/events: catalogue events accepted; e-mail props, unknown names and stale events dropped',
  async () => {
    const h = await createHarness();
    const res = await call(h, 'POST', '/analytics/events', {
      jwt: await h.token(USER_A),
      headers: { 'X-DA-Installation-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      body: {
        session_id: SESSION,
        events: [
          { name: 'auth_screen_viewed', ts: recent, props: { mode: 'sign_in', unknown_prop: 'x' } },
          { name: 'auth_screen_viewed', ts: recent, props: { mode: 'yunus@example.com' } },
          {
            name: 'auth_screen_viewed',
            ts: recent,
            props: { mode: 'sign_in', note: 'https://evil.example' },
          },
          { name: 'totally_unknown_event', ts: recent },
          { name: 'auth_screen_viewed', ts: '2026-09-20T07:00:00Z', props: { mode: 'sign_in' } },
        ],
      },
    });
    assertEquals(res.status, 202);
    assertEquals((await res.json()).data, { accepted: 1, dropped: 4 });
    assertEquals(h.analytics.rows.length, 1);
    const row = h.analytics.rows[0];
    assertEquals(row?.event_name, 'auth_screen_viewed');
    assertEquals(row?.props, { mode: 'sign_in' });
    assertEquals(row?.platform, 'ios');
    assertEquals(row?.app_version, '1.4.0');
    assertEquals(row?.installation_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assertFalse(JSON.stringify(h.analytics.rows).includes('example.com'));
  },
);

Deno.test('analytics opt-out accepts nothing; an oversized batch is 422', async () => {
  const h = await createHarness();
  h.analytics.optOut.add(USER_A);
  const jwt = await h.token(USER_A);
  const res = await call(h, 'POST', '/analytics/events', {
    jwt,
    body: {
      session_id: SESSION,
      events: [{ name: 'auth_screen_viewed', ts: recent, props: { mode: 'sign_in' } }],
    },
  });
  assertEquals((await res.json()).data, { accepted: 0, dropped: 1 });
  assertEquals(h.analytics.rows.length, 0);
  const tooMany = await call(h, 'POST', '/analytics/events', {
    jwt,
    body: {
      session_id: SESSION,
      events: Array.from({ length: 101 }, () => ({ name: 'auth_screen_viewed', ts: recent })),
    },
  });
  assertEquals(tooMany.status, 422);
  await tooMany.body?.cancel();
});

const ticket = {
  category: 'sync',
  subject: 'Senkron sorunu',
  message: 'Gmail hesabım dün akşamdan beri güncellenmiyor.',
};

Deno.test(
  'POST /support/tickets creates a ticket (201) and the 6th in an hour is 429',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    for (let i = 1; i <= 5; i++) {
      const res = await call(h, 'POST', '/support/tickets', {
        jwt,
        key: crypto.randomUUID(),
        body: ticket,
      });
      assertEquals(res.status, 201);
      const data = (await res.json()).data;
      assertEquals(data.status, 'open');
      assert(/^DA-\d{6}$/.test(data.reference));
    }
    assertEquals(h.support.tickets[0]?.contact_email, 'yunus@example.com');
    assertEquals(h.support.tickets[0]?.platform, 'ios');
    const limited = await call(h, 'POST', '/support/tickets', {
      jwt,
      key: crypto.randomUUID(),
      body: ticket,
    });
    assertEquals(limited.status, 429);
    assert(Number(limited.headers.get('Retry-After')) > 0);
    assertEquals((await limited.json()).error.code, 'RATE_LIMITED');
    assertEquals(h.support.tickets.length, 5);
  },
);

Deno.test('support ticket validation: short message is 422', async () => {
  const h = await createHarness();
  const res = await call(h, 'POST', '/support/tickets', {
    jwt: await h.token(USER_A),
    key: crypto.randomUUID(),
    body: { ...ticket, message: 'kısa' },
  });
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.field_errors[0].path, 'message');
});

Deno.test(
  'POST /feedback: empty feedback is 422; rating-only is stored with the marker; diagnostics only with consent',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const empty = await call(h, 'POST', '/feedback', {
      jwt,
      key: crypto.randomUUID(),
      body: { type: 'general', message: '   ' },
    });
    assertEquals(empty.status, 422);
    assertEquals((await empty.json()).error.field_errors[0].path, 'message');
    const rating = await call(h, 'POST', '/feedback', {
      jwt,
      key: crypto.randomUUID(),
      body: { type: 'general', rating: 5 },
    });
    assertEquals(rating.status, 201);
    await rating.body?.cancel();
    assertEquals(h.support.feedback[0]?.message, RATING_ONLY_MESSAGE);
    assertEquals(h.support.feedback[0]?.diagnostics, {});
    const withDiagnostics = await call(h, 'POST', '/feedback', {
      jwt,
      key: crypto.randomUUID(),
      body: { type: 'bug', message: 'Brifing sesi kesiliyor.', include_diagnostics: true },
    });
    assertEquals(withDiagnostics.status, 201);
    await withDiagnostics.body?.cancel();
    assertEquals(h.support.feedback[1]?.diagnostics, {
      app_version: '1.4.0',
      platform: 'ios',
      build: '812',
    });
    assertEquals(h.support.feedback[1]?.diagnostics_consent, true);
  },
);
