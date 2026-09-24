/**
 * The admin-api request pipeline (TEST_PLAN EF-ADM-01, BACKOFFICE_PLAN §2.5, §13.2): BFF key, browser
 * Origin, admin identity and aal2, session expiry (idle / absolute / revoked, ended through
 * `session_expire`), permission denial audited through `audit_denied`, the gateway secret, step-up,
 * rate classes, idempotent replay and the PostgREST headers every `admin_api` call carries.
 */
import { assert, assertEquals, assertMatch } from '@std/assert';
import { type AdminRouteKey, adminRoutes } from '@da/validation';
import { adminFixtures } from '../../../../packages/validation/test/fixtures/admin-fixtures.ts';
import type { RouteFixture } from '../../../../packages/validation/test/fixtures/types.ts';
import { userClaims } from '../../_shared/testing/jwt.ts';
import {
  ADMIN_ID,
  ALL_PERMISSIONS,
  BFF,
  contractOf,
  createHarness,
  errorOf,
  fillPath,
  GATEWAY,
  type HarnessOptions,
  queryString,
  SqlError,
} from './harness.ts';

const FIXTURES = adminFixtures as unknown as Record<AdminRouteKey, RouteFixture>;
const USER = '00000000-0000-4000-8000-000000000001';
const SESSIONS = { sessions_list_own: () => [] };
const REVEAL_BODY = {
  field: 'email',
  reason: 'Kullanıcı talebi üzerine inceleme yapıldı.',
  confirm: true,
};

async function me(
  options: HarnessOptions = {},
  init: Parameters<Awaited<ReturnType<typeof createHarness>>['request']>[2] = {},
) {
  const h = await createHarness(options);
  const res = await h.request('GET', '/me/sessions', init);
  return { h, res };
}

/** Sends the registry fixture's valid request of `key`. */
async function sendValid(h: Awaited<ReturnType<typeof createHarness>>, key: AdminRouteKey) {
  const contract = contractOf(key);
  const valid = FIXTURES[key].valid as Record<string, unknown>;
  const path =
    fillPath(contract.path, valid.params as Record<string, unknown>) +
    queryString(valid.query as Record<string, unknown>);
  return await h.request(contract.method, path, {
    ...(contract.request.body === undefined ? {} : { body: valid.body }),
    ...(valid.headers === undefined ? {} : { headers: valid.headers as Record<string, string> }),
  });
}

// ── BFF key, Origin, identity ────────────────────────────────────────────────

Deno.test('pipeline: a missing or wrong BFF key is 401 before anything else', async () => {
  for (const bff of [null, 'wrong-bff-key-value-000000000000']) {
    const h = await createHarness({ sql: SESSIONS });
    const res = await h.request('GET', '/me/sessions', {
      bff: false,
      ...(bff === null ? {} : { headers: { 'x-da-bff': bff } }),
    });
    const err = await errorOf(res);
    assertEquals(
      [err.status, err.code, err.details.reason],
      [401, 'AUTH_REQUIRED', 'bff_required'],
    );
    assertEquals(h.calls.length, 0);
  }
});

Deno.test('pipeline: a browser Origin is refused with 403', async () => {
  const { h, res } = await me(
    { sql: SESSIONS },
    { headers: { Origin: 'https://admin.dijitalasistan.app' } },
  );
  const err = await errorOf(res);
  assertEquals([err.status, err.code, err.details.reason], [403, 'FORBIDDEN', 'browser_origin']);
  assertEquals(h.calls.length, 0);
});

Deno.test('pipeline: aal1 admins get AAL2_REQUIRED on every aal2 route', async () => {
  const h = await createHarness({ sql: SESSIONS });
  const aal1 = await h.token({ aal: 'aal1' });
  const res = await h.request('GET', '/me/sessions', { auth: aal1 });
  const err = await errorOf(res);
  assertEquals([err.status, err.code], [401, 'AAL2_REQUIRED']);
  assertEquals(h.rpc.length, 0);
});

Deno.test(
  'pipeline: aal1 is enough for GET /auth/status (MFA enrolment), without a session',
  async () => {
    const h = await createHarness({
      sql: {
        auth_status: () => ({
          is_admin: true,
          status: 'invited',
          locked: false,
          mfa_verified_factors: 0,
        }),
      },
    });
    const res = await h.request('GET', '/auth/status', { auth: await h.token({ aal: 'aal1' }) });
    assertEquals(res.status, 200);
    assertEquals(h.rpcNames(), ['auth_status']);
  },
);

Deno.test('pipeline: app-user tokens, forged tokens and missing tokens are rejected', async () => {
  const h = await createHarness({ sql: SESSIONS });
  const appUser = await h.issuer.sign(userClaims(ADMIN_ID, { aal: 'aal2' }));
  assertEquals(
    (await errorOf(await h.request('GET', '/me/sessions', { auth: appUser }))).details.reason,
    'not_admin',
  );
  const forged = await (await createHarness()).token();
  const err = await errorOf(await h.request('GET', '/me/sessions', { auth: forged }));
  assertEquals([err.status, err.code], [401, 'AUTH_REQUIRED']);
  const missing = await errorOf(await h.request('GET', '/me/sessions', { auth: false }));
  assertEquals([missing.status, missing.details.reason], [401, 'missing_token']);
  assertEquals(h.rpc.length, 0);
});

// ── Session lifecycle ────────────────────────────────────────────────────────

for (const endReason of ['idle', 'absolute', 'revoked'] as const) {
  Deno.test(
    `pipeline: an ${endReason} session is ended through session_expire and answered 401`,
    async () => {
      const { h, res } = await me({
        sql: {
          ...SESSIONS,
          admin_me: () => {
            throw new SqlError('42501', 'ADMIN_SESSION_EXPIRED');
          },
          session_expire: () => ({ ended: true, end_reason: endReason }),
        },
      });
      const err = await errorOf(res);
      assertEquals(
        [err.status, err.code, err.details.reason, err.details.end_reason],
        [401, 'AUTH_REQUIRED', 'admin_session_expired', endReason],
      );
      assertEquals(h.rpcNames(), ['admin_me', 'session_expire']);
    },
  );
}

Deno.test(
  'pipeline: a session that expires inside a handler call is ended the same way',
  async () => {
    const h = await createHarness({
      sql: {
        users_list: () => {
          throw new SqlError('42501', 'ADMIN_SESSION_EXPIRED');
        },
        session_expire: () => ({ ended: true, end_reason: 'absolute' }),
      },
    });
    const err = await errorOf(await h.request('GET', '/users'));
    assertEquals([err.status, err.details.end_reason], [401, 'absolute']);
    assertEquals(h.rpcNames(), ['admin_me', 'users_list', 'session_expire']);
  },
);

Deno.test(
  'pipeline: background polling never extends the idle window; user activity does',
  async () => {
    const h = await createHarness({ sql: SESSIONS });
    await h.request('GET', '/me/sessions', { headers: { 'x-da-activity': 'background' } });
    await h.request('GET', '/me/sessions');
    await h.request('POST', '/session/heartbeat', {
      body: {},
      headers: { 'x-da-activity': 'background' },
    });
    assertEquals(
      h.rpc.filter((r) => r.fn === 'admin_me').map((r) => r.args.p_activity),
      [false, true, true],
    );
  },
);

Deno.test(
  'pipeline: disabled, locked and aal-downgraded admins are refused by the SQL guard',
  async () => {
    for (const [message, reason] of [
      ['ADMIN_REQUIRED', 'admin_inactive'],
      ['ADMIN_LOCKED', 'locked'],
      ['ADMIN_GATEWAY_REQUIRED', 'gateway'],
    ] as const) {
      const { h, res } = await me({
        sql: {
          admin_me: () => {
            throw new SqlError('42501', message);
          },
        },
      });
      const err = await errorOf(res);
      assertEquals([err.status, err.code, err.details.reason], [403, 'FORBIDDEN', reason]);
      assert(!h.rpcNames().includes('session_expire'));
    }
    const { res } = await me({
      sql: {
        admin_me: () => {
          throw new SqlError('42501', 'ADMIN_AAL2_REQUIRED');
        },
      },
    });
    assertEquals((await errorOf(res)).code, 'AAL2_REQUIRED');
  },
);

// ── Gateway ──────────────────────────────────────────────────────────────────

Deno.test(
  'pipeline: every admin_api call carries the admin JWT and the gateway secret',
  async () => {
    const h = await createHarness({ sql: SESSIONS });
    const jwt = await h.token();
    await h.request('GET', '/me/sessions', { auth: jwt });
    assertEquals(h.rpc.length, 2);
    for (const call of h.rpc) {
      assertEquals(call.schema, 'admin_api');
      assertEquals(call.headers.get('x-da-admin-gateway'), GATEWAY);
      assertEquals(call.headers.get('authorization'), `Bearer ${jwt}`);
    }
  },
);

Deno.test('pipeline: without ADMIN_GATEWAY_SECRET nothing reaches the database', async () => {
  const { h, res } = await me({ sql: SESSIONS, env: { ADMIN_GATEWAY_SECRET: undefined } });
  const err = await errorOf(res);
  assertEquals([err.status, err.code], [503, 'EXTERNAL_CREDENTIAL_REQUIRED']);
  assertEquals(err.details.credential_keys, ['ADMIN_GATEWAY_SECRET']);
  assertEquals(h.calls.length, 0);
});

Deno.test('pipeline: the BFF sign-in routes use the service role, never the gateway', async () => {
  const h = await createHarness({
    sql: { login_preflight: () => ({ allowed: true, send: true, locked: false }) },
  });
  const res = await h.request('POST', '/auth/preflight', {
    auth: false,
    body: { email_hash: 'a'.repeat(64), ip_hash: 'b'.repeat(64) },
  });
  assertEquals(res.status, 200);
  const call = h.rpc.find((r) => r.fn === 'login_preflight');
  assertEquals(call?.headers.get('x-da-admin-gateway'), null);
  assertEquals(call?.headers.get('authorization'), 'Bearer test-secret-key');
});

// ── Permissions and step-up ──────────────────────────────────────────────────

Deno.test('pipeline: a denial inside SQL is audited with the permission SQL names', async () => {
  const h = await createHarness({
    sql: {
      user_reveal_email: () => {
        throw new SqlError('42501', 'ADMIN_FORBIDDEN', 'users.pii.reveal');
      },
    },
  });
  const res = await h.request('POST', `/users/${USER}/reveal`, { body: REVEAL_BODY });
  const err = await errorOf(res);
  assertEquals([err.status, err.details.permission], [403, 'users.pii.reveal']);
  assertEquals(h.rpc.find((r) => r.fn === 'audit_denied')?.args, {
    p_route: 'POST /users/:id/reveal',
    p_permission: 'users.pii.reveal',
  });
});

Deno.test('pipeline: `also` permissions are required on tab reads', async () => {
  const h = await createHarness({
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'integrations.read'),
  });
  const err = await errorOf(await h.request('GET', `/users/${USER}/integrations`));
  assertEquals([err.status, err.details.permission], [403, 'integrations.read']);
  assert(!h.rpcNames().includes('user_integrations'));
});

Deno.test('pipeline: flags.write_ai admins may only touch ai.* and voice.* flags', async () => {
  const flag = {
    key: 'feature.midday',
    enabled: true,
    rollout_percent: 100,
    platforms: [],
    plans: [],
    updated_at: '2026-09-24T08:00:00Z',
  };
  const permissions = [...ALL_PERMISSIONS.filter((p) => p !== 'flags.write'), 'flags.write_ai'];
  const h = await createHarness({
    permissions,
    sql: { flag_get: () => flag, flag_upsert: () => flag },
  });
  const body = { rollout_percent: 50, reason: 'Kullanıcı talebi üzerine inceleme yapıldı.' };
  const refused = await errorOf(await h.request('PATCH', '/flags/feature.midday', { body }));
  assertEquals([refused.status, refused.details.permission], [403, 'flags.write']);
  const ai = { ...flag, key: 'ai.global.enabled' };
  const h2 = await createHarness({
    permissions,
    sql: { flag_get: () => ai, flag_upsert: () => ai },
  });
  assertEquals((await h2.request('PATCH', '/flags/ai.global.enabled', { body })).status, 200);
});

const STEP_UP_KEYS = (Object.keys(adminRoutes) as AdminRouteKey[]).filter(
  (key) => contractOf(key).access.step_up === true,
);

Deno.test('pipeline: every step-up route refuses a session without a fresh step-up', async () => {
  assert(STEP_UP_KEYS.length >= 14);
  for (const key of STEP_UP_KEYS) {
    const h = await createHarness({ stepUpUntil: null });
    const err = await errorOf(await sendValid(h, key));
    assertEquals(
      [err.status, err.code, err.details.reason],
      [403, 'FORBIDDEN', 'step_up_required'],
      key,
    );
    assertEquals(
      h.rpcNames().filter((n) => n !== 'admin_me'),
      [],
      `${key} reached the handler`,
    );
  }
});

Deno.test('pipeline: an expired step-up (older than 10 minutes) is refused too', async () => {
  const h = await createHarness({ stepUpUntil: '2026-09-24T09:59:59Z' });
  const err = await errorOf(await sendValid(h, 'POST /admins/:id/unlock'));
  assertEquals(err.details.reason, 'step_up_required');
});

Deno.test('pipeline: the first recovery-code set needs no step-up; regenerating does', async () => {
  const first = await createHarness({
    stepUpUntil: null,
    recoveryCodesRemaining: 0,
    sql: { recovery_codes_store: () => 10 },
  });
  assertEquals((await first.request('POST', '/me/recovery-codes', { body: {} })).status, 201);
  const again = await createHarness({ stepUpUntil: null, recoveryCodesRemaining: 3 });
  assertEquals(
    (await errorOf(await again.request('POST', '/me/recovery-codes', { body: {} }))).details.reason,
    'step_up_required',
  );
});

// ── Rate classes ─────────────────────────────────────────────────────────────

Deno.test(
  'pipeline: S, M and X classes use their own counters; X refusals are audited',
  async () => {
    const counted = await createHarness({
      sql: {
        command_search: () => ({ results: [] }),
        user_reveal_email: () => ({ value: 'a@b.co' }),
      },
    });
    await counted.request('GET', '/search?q=DA-7K3M9Q');
    await counted.request('POST', `/users/${USER}/reveal`, { body: REVEAL_BODY });
    await counted.request('GET', '/me/sessions');
    assertEquals(counted.rateKeys, [`bo_s:${ADMIN_ID}`, `bo_x:${ADMIN_ID}`]);

    const limited = await createHarness({ rateAllowed: false });
    const res = await limited.request('POST', `/users/${USER}/reveal`, { body: REVEAL_BODY });
    const err = await errorOf(res);
    assertEquals([err.status, err.code], [429, 'RATE_LIMITED']);
    assertMatch(res.headers.get('Retry-After') ?? '', /^\d+$/);
    const audit = limited.rpc.find((r) => r.fn === 'audit_write')?.args ?? {};
    assertEquals([audit.p_action, audit.p_result], ['admin.rate_limited', 'denied']);
    assert(!limited.rpcNames().includes('user_reveal_email'));

    const searchLimited = await createHarness({ rateAllowed: false });
    assertEquals((await searchLimited.request('GET', '/search?q=DA-7K3M9Q')).status, 429);
    assert(
      !searchLimited.rpcNames().includes('audit_write'),
      'only the X class audits its refusals',
    );
  },
);

// ── Idempotency ──────────────────────────────────────────────────────────────

Deno.test(
  'pipeline: a replayed mutation answers the stored result with replayed:true',
  async () => {
    const h = await createHarness({
      sql: { user_mark_internal: () => ({ user_id: USER, is_internal: true }) },
    });
    const key = crypto.randomUUID();
    const body = { internal: true, reason: 'Kullanıcı talebi üzerine inceleme yapıldı.' };
    const first = await h.request('POST', `/users/${USER}/internal`, {
      body,
      headers: { 'Idempotency-Key': key },
    });
    const second = await h.request('POST', `/users/${USER}/internal`, {
      body,
      headers: { 'Idempotency-Key': key },
    });
    assertEquals([first.status, second.status], [200, 200]);
    assertEquals(second.headers.get('Idempotency-Replayed'), 'true');
    const replayed = await second.json();
    assertEquals(replayed.meta.idempotency_replayed, true);
    assertEquals(replayed.data, (await first.json()).data);
    assertEquals(h.rpcNames().filter((n) => n === 'user_mark_internal').length, 1);

    const other = await h.request('POST', `/users/${USER}/internal`, {
      body: { ...body, internal: false },
      headers: { 'Idempotency-Key': key },
    });
    assertEquals((await errorOf(other)).details.reason, 'fingerprint_mismatch');
  },
);

Deno.test('pipeline: one-time secrets and revealed PII are never replayed', async () => {
  const h = await createHarness({
    sql: { user_reveal_email: () => ({ value: 'yunus@gmail.com', expires_in_s: 60 }) },
  });
  const key = crypto.randomUUID();
  const init = { body: REVEAL_BODY, headers: { 'Idempotency-Key': key } };
  assertEquals((await h.request('POST', `/users/${USER}/reveal`, init)).status, 200);
  const again = await errorOf(await h.request('POST', `/users/${USER}/reveal`, init));
  assertEquals(
    [again.status, again.code, again.details.reason],
    [409, 'IDEMPOTENCY_REPLAY', 'not_replayable'],
  );
  const stored = [
    ...(
      h.runtime.idempotency as unknown as { rows: Map<string, { resourceRef: unknown }> }
    ).rows.values(),
  ];
  assert(!JSON.stringify(stored).includes('yunus@gmail.com'), 'the revealed value is never stored');
});

Deno.test('pipeline: mutations need a uuid Idempotency-Key', async () => {
  const h = await createHarness();
  const res = await h.request('POST', `/users/${USER}/internal`, {
    body: { internal: true, reason: 'Kullanıcı talebi üzerine inceleme yapıldı.' },
    headers: { 'Idempotency-Key': 'not-a-uuid' },
  });
  const err = await errorOf(res);
  assertEquals([err.status, err.code], [422, 'VALIDATION_FAILED']);
  assert(!h.rpcNames().includes('user_mark_internal'));
});

// ── Responses ────────────────────────────────────────────────────────────────

Deno.test('pipeline: every response is no-store and carries meta.server_time', async () => {
  const { res } = await me({ sql: SESSIONS });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assertMatch(body.meta.server_time, /^\d{4}-\d{2}-\d{2}T/);
  const denied = await me({ sql: SESSIONS }, { bff: false });
  assertEquals(denied.res.headers.get('Cache-Control'), 'no-store');
});

Deno.test('pipeline: a malformed body is 400 and a wrong content type 415', async () => {
  const h = await createHarness();
  const malformed = await errorOf(
    await h.request('POST', `/users/${USER}/internal`, { rawBody: '{"internal":' }),
  );
  assertEquals([malformed.status, malformed.code], [400, 'BAD_REQUEST']);
  const text = await errorOf(
    await h.request('POST', `/users/${USER}/internal`, {
      rawBody: 'internal=true',
      headers: { 'Content-Type': 'text/plain' },
    }),
  );
  assertEquals([text.status, text.code], [415, 'UNSUPPORTED_MEDIA_TYPE']);
});

Deno.test('pipeline: unknown admin routes are 404 and never reach the database', async () => {
  const h = await createHarness();
  const res = await h.request('GET', '/users/impersonate');
  assertEquals(res.status, 400, 'a non-uuid id is refused by the path contract');
  const missing = await h.app.request('/admin-api/impersonate', { headers: { 'x-da-bff': BFF } });
  assertEquals(missing.status, 404);
  assertEquals(h.rpc.filter((r) => r.fn !== 'admin_me').length, 0);
});
