/**
 * THR-02 Session theft and THR-03 account takeover (SECURITY_AND_PRIVACY_PLAN §2, CTL-3.1, CTL-3.8;
 * TEST_PLAN TST-EF-21; R-08, R-16). Every surface verifies the bearer itself:
 * - `api` accepts only a valid, unexpired user JWT from our issuer; forged, tampered, expired and
 *   foreign-audience tokens are 401, and dedicated admin identities are 403 `admin_identity`;
 * - `public-api` refuses an admin bearer outright;
 * - `admin-api` needs the BFF key, an admin identity from `app_metadata` (never `user_metadata`)
 *   and `aal2`;
 * - destructive privacy actions need a fresh sign-in (≤10 minutes).
 */
import { assertEquals } from '@std/assert';
import { DELETE_CONFIRM_TOKENS } from '@da/validation';
import { createTestIssuer, USER_A, userClaims } from '../../_shared/testing/jwt.ts';
import { createApiApp } from '../../api/app.ts';
import { call, createHarness, NOW } from '../../api/testing.ts';
import { memoryObjectStore, memoryPrivacyRepo } from '../../_shared/testing/privacy.ts';
import { publicHarness, send } from '../../public-api/testing.ts';
import { createHarness as adminHarness } from '../../admin-api/tests/harness.ts';

const INSTALLATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function errorOf(res: Response): Promise<{ status: number; code: string; reason?: string }> {
  const body = await res.json();
  return { status: res.status, code: body.error?.code, reason: body.error?.details?.reason };
}

function bootstrap(h: Awaited<ReturnType<typeof createHarness>>, jwt: string | null) {
  return call(h, 'GET', '/me/bootstrap', {
    jwt,
    headers: { 'X-DA-Installation-Id': INSTALLATION },
  });
}

Deno.test(
  'THR-02: api rejects missing, forged, tampered, expired and wrong-audience tokens; the genuine one passes',
  async () => {
    const h = await createHarness();
    const genuine = await h.token(USER_A);
    assertEquals((await bootstrap(h, genuine)).status, 200);

    const missing = await errorOf(await bootstrap(h, null));
    assertEquals([missing.status, missing.code], [401, 'AUTH_REQUIRED']);

    // Same claims, signed by an attacker's key with the victim's key id.
    const attacker = await createTestIssuer('test-key');
    const forged = await errorOf(await bootstrap(h, await attacker.sign(userClaims(USER_A))));
    assertEquals([forged.status, forged.code], [401, 'AUTH_REQUIRED']);

    // Payload swapped to another user with the original signature.
    const [header, , signature] = genuine.split('.');
    const payload = btoa(JSON.stringify({ ...userClaims('22222222-2222-4222-8222-222222222222') }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const tampered = await errorOf(await bootstrap(h, `${header}.${payload}.${signature}`));
    assertEquals([tampered.status, tampered.code], [401, 'AUTH_REQUIRED']);

    const expired = await h.issuer.sign(userClaims(USER_A), {
      issuedAt: Math.floor(Date.now() / 1000) - 7200,
      expiresInSeconds: 3600,
    });
    assertEquals((await errorOf(await bootstrap(h, expired))).status, 401);

    const noneAlg = `${btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=+$/, '')}.${payload}.`;
    assertEquals((await errorOf(await bootstrap(h, noneAlg))).status, 401);

    assertEquals(h.touched, [`${USER_A}:${INSTALLATION}`], 'only the genuine call reached a repo');
  },
);

Deno.test(
  'THR-02 / R-08: a dedicated admin identity is refused by api (403) and by public-api',
  async () => {
    const h = await createHarness();
    const adminJwt = await h.token(USER_A, {
      aal: 'aal2',
      app_metadata: { da_kind: 'admin', provider: 'email' },
    });
    const api = await errorOf(await bootstrap(h, adminJwt));
    assertEquals([api.status, api.code, api.reason], [403, 'FORBIDDEN', 'admin_identity']);
    assertEquals(h.touched, []);

    const p = await publicHarness();
    const token = await p.issuer.sign(
      userClaims(USER_A, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    const res = await send(p, 'GET', '/site/config', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pub = await errorOf(res);
    assertEquals([pub.status, pub.code, pub.reason], [403, 'FORBIDDEN', 'admin_identity']);
  },
);

Deno.test(
  'THR-02 / THR-06: admin-api needs the BFF key, an app_metadata admin identity and aal2 — user_metadata cannot forge it',
  async () => {
    const h = await adminHarness();
    const noBff = await errorOf(await h.request('GET', '/me', { bff: false }));
    assertEquals([noBff.status, noBff.reason], [401, 'bff_required']);

    const aal1 = await errorOf(
      await h.request('GET', '/me', { auth: await h.token({ aal: 'aal1' }) }),
    );
    assertEquals([aal1.status, aal1.code], [401, 'AAL2_REQUIRED']);

    // An app user who wrote `da_kind` / `admin_role` into their editable user_metadata.
    const spoofed = await h.issuer.sign(
      userClaims(USER_A, {
        aal: 'aal2',
        user_metadata: { da_kind: 'admin', admin_role: 'super_admin' },
        admin_role: 'super_admin',
      }),
    );
    const spoof = await errorOf(await h.request('GET', '/me', { auth: spoofed }));
    assertEquals([spoof.status, spoof.reason], [403, 'not_admin']);

    // A genuine aal2 admin token minted by another project key is not accepted either.
    const other = await createTestIssuer();
    const foreign = await other.sign(
      userClaims(USER_A, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    assertEquals((await errorOf(await h.request('GET', '/me', { auth: foreign }))).status, 401);
    assertEquals(h.rpc.length, 0, 'nothing reached the database');
  },
);

Deno.test(
  'THR-03 / R-16: history and account deletion refuse a session without a sign-in in the last 10 minutes',
  async () => {
    const base = await createHarness();
    const deps = {
      ...base.deps,
      privacy: {
        repo: memoryPrivacyRepo(),
        store: memoryObjectStore(),
        authAdmin: { signOutOthers: () => Promise.resolve(true) },
      },
    };
    const h = { ...base, deps, app: createApiApp(deps) };
    const stale = {
      amr: [{ method: 'otp', timestamp: Math.floor(NOW.getTime() / 1000) - 3600 }],
    };
    for (const [path, body] of [
      ['/privacy/delete-history', { scope: { type: 'all_analysis' }, confirm: true }],
      [
        '/privacy/delete-account',
        { confirm_text: DELETE_CONFIRM_TOKENS.tr, acknowledge_subscription: true },
      ],
    ] as const) {
      const res = await call(h, 'POST', path, {
        jwt: await h.token(USER_A, stale),
        key: crypto.randomUUID(),
        body,
      });
      const err = await errorOf(res);
      assertEquals([err.status, err.code], [401, 'REAUTH_REQUIRED'], path);
    }
    // A validly signed token that carries no sign-in method timestamp is treated the same way.
    const bare = await call(h, 'POST', '/privacy/delete-account', {
      jwt: await h.token(USER_A),
      key: crypto.randomUUID(),
      body: { confirm_text: DELETE_CONFIRM_TOKENS.tr, acknowledge_subscription: true },
    });
    assertEquals((await errorOf(bare)).code, 'REAUTH_REQUIRED');
  },
);
