import { assertEquals } from '@std/assert';
import { createLogger, memorySink } from '../_shared/logging/logger.ts';
import { ADMIN_ID, createTestIssuer, USER_A, userClaims } from '../_shared/testing/jwt.ts';
import { createAdminApi } from '../admin-api/app.ts';
import { publicHarness, WEB_ORIGIN } from './testing.ts';

const log = () => createLogger({ fn: 'public-api', sink: memorySink().sink });

Deno.test(
  'public-api: unknown paths are NOT_FOUND; CORS only for PUBLIC_WEB_URL; admin tokens refused',
  async () => {
    const h = await publicHarness();
    const missing = await h.app.request('/public-api/unknown', {
      headers: { Origin: WEB_ORIGIN },
    });
    assertEquals(missing.status, 404);
    assertEquals(missing.headers.get('Access-Control-Allow-Origin'), WEB_ORIGIN);
    assertEquals((await missing.json()).error.code, 'NOT_FOUND');
    const other = await h.app.request('/public-api/x', {
      headers: { Origin: 'https://evil.example' },
    });
    assertEquals(other.headers.get('Access-Control-Allow-Origin'), null);
    await other.body?.cancel();
    const admin = await h.issuer.sign(
      userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    const refused = await h.app.request('/public-api/x', {
      headers: { Authorization: `Bearer ${admin}` },
    });
    assertEquals(refused.status, 403);
    assertEquals((await refused.json()).error.details.reason, 'admin_identity');
    const user = await h.issuer.sign(userClaims(USER_A));
    const passes = await h.app.request('/public-api/x', {
      headers: { Authorization: `Bearer ${user}` },
    });
    assertEquals(passes.status, 404);
    await passes.body?.cancel();
  },
);

Deno.test(
  'public-api: the CORS preflight allows the web client headers only for the site',
  async () => {
    const h = await publicHarness();
    const preflight = await h.app.request('/public-api/support', {
      method: 'OPTIONS',
      headers: {
        Origin: WEB_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,apikey,x-client-info',
      },
    });
    assertEquals(preflight.status, 204);
    assertEquals(preflight.headers.get('Access-Control-Allow-Origin'), WEB_ORIGIN);
    const allowed = (preflight.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    for (const header of ['content-type', 'apikey', 'x-client-info']) {
      assertEquals(allowed.includes(header), true, header);
    }
    assertEquals(preflight.headers.get('Access-Control-Allow-Credentials'), null);
  },
);

Deno.test(
  'admin-api: routes mounted with adminRoute enforce the gate; unknown paths are NOT_FOUND',
  async () => {
    const issuer = await createTestIssuer();
    const bff = crypto.randomUUID();
    const { app, adminRoute } = createAdminApi({
      auth: {
        verifier: issuer.verifier,
        gate: { authorize: () => Promise.resolve() },
        bffSecret: bff,
      },
      log: log(),
    });
    app.get('/probe', adminRoute('health.read'), (c) => c.json({ data: { ok: true } }));
    const anonymous = await app.request('/admin-api/probe', { headers: { 'x-da-bff': bff } });
    assertEquals(anonymous.status, 401);
    await anonymous.body?.cancel();
    const jwt = await issuer.sign(
      userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    const ok = await app.request('/admin-api/probe', {
      headers: { Authorization: `Bearer ${jwt}`, 'x-da-bff': bff },
    });
    assertEquals(ok.status, 200);
    await ok.body?.cancel();
    const missing = await app.request('/admin-api/users', {
      headers: { Authorization: `Bearer ${jwt}`, 'x-da-bff': bff },
    });
    assertEquals(missing.status, 404);
    assertEquals((await missing.json()).error.code, 'NOT_FOUND');
  },
);
