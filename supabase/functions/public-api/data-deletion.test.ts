/**
 * PUB-02 / PUB-03 / PUB-07 web data deletion (TEST_PLAN EF-PUB-01: neutral responses, OTP, rate
 * limits, status token; T-9.04 acceptance: no account enumeration, a deletion request is created).
 */
import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert';
import { publicRoutes } from '@da/validation';
import { publicHarness, send } from './testing.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const VERIFY = {
  email: 'deniz@example.com',
  code: '123456',
  kind: 'account',
  confirmation: 'SİL',
  locale: 'tr',
};

async function setup() {
  const h = await publicHarness();
  h.repo.users.set('deniz@example.com', { user_id: USER, is_admin: false });
  h.repo.users.set('boss@admin.example', { user_id: ADMIN, is_admin: true });
  h.otp.codes.set('deniz@example.com', { code: '123456', userId: USER });
  return h;
}

Deno.test('PUB-02 answers the same padded 202 for known, unknown and admin addresses', async () => {
  const h = await setup();
  const bodies: unknown[] = [];
  for (const email of ['deniz@example.com', 'nobody@example.com', 'boss@admin.example']) {
    const res = await send(h, 'POST', '/data-deletion/start', { body: { email, locale: 'tr' } });
    assertEquals(res.status, 202);
    const body = await res.json();
    assert(publicRoutes['POST /data-deletion/start'].response.safeParse(body).success);
    bodies.push(body.data);
  }
  assertEquals(bodies, Array(3).fill({ status: 'code_sent_if_account_exists' }));
  assertEquals(h.otp.sent, ['deniz@example.com'], 'only an existing non-admin account gets a code');
  assertEquals(h.slept, [400, 400, 400], 'every answer is padded to at least 400 ms');
  const honeypot = await send(h, 'POST', '/data-deletion/start', {
    body: { email: 'deniz@example.com', locale: 'tr', website: 'x' },
  });
  assertEquals(honeypot.status, 202);
  await honeypot.body?.cancel();
  assertEquals(h.otp.sent.length, 1);
});

Deno.test('PUB-02 limits code requests per e-mail hash (3/h)', async () => {
  const h = await setup();
  for (let i = 0; i < 3; i++) {
    const res = await send(h, 'POST', '/data-deletion/start', {
      body: { email: 'deniz@example.com', locale: 'en' },
      headers: { 'X-Forwarded-For': `198.51.100.${i}` },
    });
    assertEquals(res.status, 202);
    await res.body?.cancel();
  }
  const limited = await send(h, 'POST', '/data-deletion/start', {
    body: { email: 'Deniz@Example.com', locale: 'en' },
  });
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error.code, 'RATE_LIMITED');
});

Deno.test(
  'PUB-03 wrong codes are OTP_INVALID for every address and lock after 5 failures',
  async () => {
    const h = await setup();
    for (const email of ['deniz@example.com', 'nobody@example.com']) {
      const res = await send(h, 'POST', '/data-deletion/verify', {
        body: { ...VERIFY, email, code: '000000' },
      });
      assertEquals(res.status, 422);
      const error = (await res.json()).error;
      assertEquals(error.code, 'OTP_INVALID');
      assertEquals(error.details, undefined);
    }
    for (let i = 0; i < 3; i++) {
      const res = await send(h, 'POST', '/data-deletion/verify', {
        body: { ...VERIFY, code: '000000' },
      });
      assertEquals(res.status, 422);
      await res.body?.cancel();
    }
    const locked = await send(h, 'POST', '/data-deletion/verify', {
      body: { ...VERIFY, code: '000000' },
    });
    assertEquals(locked.status, 429);
    assertEquals((await locked.json()).error.code, 'OTP_LOCKED');
    assertEquals(locked.headers.get('Retry-After'), '3600');
    const stillLocked = await send(h, 'POST', '/data-deletion/verify', { body: VERIFY });
    assertEquals(stillLocked.status, 429, 'even the right code waits for the lock');
    await stillLocked.body?.cancel();
    assertEquals(h.repo.requests.size, 0);
  },
);

Deno.test(
  'PUB-03 creates one queued account deletion request, revokes sessions and returns a status token',
  async () => {
    const h = await setup();
    h.repo.subscribed.add(USER);
    const res = await send(h, 'POST', '/data-deletion/verify', { body: VERIFY });
    assertEquals(res.status, 202);
    const body = await res.json();
    assert(publicRoutes['POST /data-deletion/verify'].response.safeParse(body).success);
    const data = body.data;
    assertEquals(data.status, 'queued');
    assertMatch(data.reference, /^DEL-[0-9A-F]{8}$/);
    assertEquals(data.subscription_notice, { active: true });
    assertEquals(h.otp.revoked, [`session-${USER}`]);
    assertEquals(h.pokes.length, 1);
    const stored = h.repo.requests.get(data.request_id);
    assertEquals(stored?.user_id, USER);
    assertFalse(
      JSON.stringify(stored).includes(data.status_token),
      'only the token hash is stored',
    );

    const again = await send(h, 'POST', '/data-deletion/verify', {
      body: { ...VERIFY, confirmation: 'DELETE' },
    });
    const second = (await again.json()).data;
    assertEquals(second.request_id, data.request_id, 'one active request per user');
    assertEquals(h.repo.requests.size, 1);

    const oldToken = await send(
      h,
      'GET',
      `/data-deletion/${data.request_id}/status?token=${data.status_token}`,
    );
    assertEquals(oldToken.status, 404, 'the rotated token no longer reads the status');
    await oldToken.body?.cancel();
    const status = await send(
      h,
      'GET',
      `/data-deletion/${data.request_id}/status?token=${second.status_token}`,
    );
    assertEquals(status.status, 200);
    const statusBody = await status.json();
    assert(
      publicRoutes['GET /data-deletion/:requestId/status'].response.safeParse(statusBody).success,
    );
    assertEquals(statusBody.data.status, 'queued');
    assertEquals(statusBody.data.reference, data.reference);
    const text = JSON.stringify(statusBody);
    assertFalse(text.includes(USER));
    assertFalse(text.includes('deniz'));
  },
);

Deno.test(
  'PUB-03 refuses history deletion, a wrong confirmation and admin identities',
  async () => {
    const h = await setup();
    const history = await send(h, 'POST', '/data-deletion/verify', {
      body: { ...VERIFY, kind: 'history' },
    });
    assertEquals(history.status, 422);
    assertEquals((await history.json()).error.field_errors[0].path, 'kind');
    const confirmation = await send(h, 'POST', '/data-deletion/verify', {
      body: { ...VERIFY, confirmation: 'SIL?' },
    });
    assertEquals(confirmation.status, 422);
    await confirmation.body?.cancel();
    h.otp.codes.set('boss@admin.example', { code: '654321', userId: ADMIN, isAdmin: true });
    const admin = await send(h, 'POST', '/data-deletion/verify', {
      body: { ...VERIFY, email: 'boss@admin.example', code: '654321' },
    });
    assertEquals(admin.status, 422);
    assertEquals((await admin.json()).error.code, 'OTP_INVALID');
    assertEquals(h.otp.revoked, [`session-${ADMIN}`], 'the admin session is revoked at once');
    assertEquals(h.repo.requests.size, 0);
  },
);

Deno.test('PUB-07 answers the same 404 for an unknown id and a wrong token', async () => {
  const h = await setup();
  const created = (await (await send(h, 'POST', '/data-deletion/verify', { body: VERIFY })).json())
    .data;
  const wrongToken = 'A'.repeat(43);
  const wrong = await send(
    h,
    'GET',
    `/data-deletion/${created.request_id}/status?token=${wrongToken}`,
  );
  const unknown = await send(
    h,
    'GET',
    `/data-deletion/${crypto.randomUUID()}/status?token=${created.status_token}`,
  );
  assertEquals(wrong.status, 404);
  assertEquals(unknown.status, 404);
  const a = (await wrong.json()).error;
  const b = (await unknown.json()).error;
  assertEquals([a.code, a.message], [b.code, b.message]);
  const row = h.repo.requests.get(created.request_id);
  if (row !== undefined) {
    row.status = 'completed';
    row.completed_at = '2026-09-24T12:00:00Z';
    row.steps = {
      provider_revoke: { google: 'revoked', microsoft: 'local_only' },
      storage_purged: true,
      db_purged: true,
      auth_user_deleted: true,
    };
  }
  const done = await send(
    h,
    'GET',
    `/data-deletion/${created.request_id}/status?token=${created.status_token}`,
  );
  const data = (await done.json()).data;
  assertEquals(data.status, 'completed');
  assertEquals(data.steps_public, {
    provider_revoke: 'done',
    storage_purged: 'done',
    db_purged: 'done',
    auth_user_deleted: 'done',
  });
});
