import { assert, assertEquals } from '@std/assert';
import { AppError } from '../errors.ts';
import { createApp } from '../http/app.ts';
import { sendData } from '../http/respond.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import { jsonResponse, stubFetch } from '../testing/fetch.ts';
import { ADMIN_ID, createTestIssuer, userClaims } from '../testing/jwt.ts';
import { TEST_SUPABASE_URL } from '../testing/env.ts';
import { type AdminGate, mapAdminGateError, requireAdmin, supabaseAdminGate } from './admin.ts';

const BFF = crypto.randomUUID();

async function setup(gate: AdminGate) {
  const issuer = await createTestIssuer();
  const app = createApp({
    fn: 'admin-api',
    logger: createLogger({ fn: 'admin-api', sink: memorySink().sink }),
  });
  app.get(
    '/probe',
    requireAdmin({ verifier: issuer.verifier, gate, bffSecret: BFF }, 'health.run'),
    (c) => sendData(c, { admin: c.get('admin')?.adminId ?? null }),
  );
  return { app, issuer };
}

const allowAll: AdminGate = { authorize: () => Promise.resolve() };

async function errorCode(res: Response): Promise<string> {
  const body = await res.json();
  return `${res.status}:${body.error.code}:${body.error.details?.reason ?? body.error.details?.permission ?? ''}`;
}

Deno.test(
  'admin: aal2 admin identity with the BFF key passes and the SQL gate sees the permission',
  async () => {
    const seen: string[] = [];
    const { app, issuer } = await setup({
      authorize: (_jwt, p) => Promise.resolve(void seen.push(p)),
    });
    const jwt = await issuer.sign(
      userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    const res = await app.request('/admin-api/probe', {
      headers: { Authorization: `Bearer ${jwt}`, 'x-da-bff': BFF },
    });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).data.admin, ADMIN_ID);
    assertEquals(seen, ['health.run']);
  },
);

Deno.test('admin: aal1 tokens are rejected with AAL2_REQUIRED', async () => {
  const { app, issuer } = await setup(allowAll);
  const jwt = await issuer.sign(
    userClaims(ADMIN_ID, { aal: 'aal1', app_metadata: { da_kind: 'admin' } }),
  );
  const res = await app.request('/admin-api/probe', {
    headers: { Authorization: `Bearer ${jwt}`, 'x-da-bff': BFF },
  });
  assertEquals(await errorCode(res), '401:AAL2_REQUIRED:');
});

Deno.test(
  'admin: app users, missing BFF key, forged and browser requests are rejected',
  async () => {
    const { app, issuer } = await setup(allowAll);
    const user = await issuer.sign(userClaims(ADMIN_ID, { aal: 'aal2' }));
    assertEquals(
      await errorCode(
        await app.request('/admin-api/probe', {
          headers: { Authorization: `Bearer ${user}`, 'x-da-bff': BFF },
        }),
      ),
      '403:FORBIDDEN:not_admin',
    );
    const admin = await issuer.sign(
      userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    assertEquals(
      await errorCode(
        await app.request('/admin-api/probe', {
          headers: { Authorization: `Bearer ${admin}`, 'x-da-bff': 'wrong' },
        }),
      ),
      '401:AUTH_REQUIRED:bff_required',
    );
    const attacker = await createTestIssuer();
    const forged = await attacker.sign(
      userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    assertEquals(
      await errorCode(
        await app.request('/admin-api/probe', {
          headers: { Authorization: `Bearer ${forged}`, 'x-da-bff': BFF },
        }),
      ),
      '401:AUTH_REQUIRED:invalid_token',
    );
    assertEquals(
      await errorCode(
        await app.request('/admin-api/probe', {
          headers: {
            Authorization: `Bearer ${admin}`,
            'x-da-bff': BFF,
            Origin: 'https://admin.example',
          },
        }),
      ),
      '403:FORBIDDEN:browser_origin',
    );
  },
);

Deno.test('admin: SQL gate denials map to API codes', async () => {
  const { app, issuer } = await setup({
    authorize: (_jwt, p) => Promise.reject(mapAdminGateError('ADMIN_FORBIDDEN', p)),
  });
  const admin = await issuer.sign(
    userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
  );
  const res = await app.request('/admin-api/probe', {
    headers: { Authorization: `Bearer ${admin}`, 'x-da-bff': BFF },
  });
  assertEquals(await errorCode(res), '403:FORBIDDEN:health.run');
  assertEquals(mapAdminGateError('ADMIN_AAL2_REQUIRED', 'x').code, 'AAL2_REQUIRED');
  assertEquals(mapAdminGateError('ADMIN_SESSION_EXPIRED', 'x').details, {
    reason: 'admin_session_expired',
  });
  assertEquals(mapAdminGateError('ADMIN_GATEWAY_REQUIRED', 'x').details, { reason: 'gateway' });
});

Deno.test(
  'supabase admin gate calls admin_api.authorize with the JWT and the gateway header',
  async () => {
    const stub = stubFetch(() => jsonResponse({}));
    const gate = supabaseAdminGate({
      gatewaySecret: 'gateway-secret-value',
      clientConfig: {
        url: TEST_SUPABASE_URL,
        publishableKey: 'sb_publishable_x',
        secretKey: null,
        fetch: stub.fetch,
      },
    });
    await gate.authorize('admin.jwt.value', 'health.run');
    const call = stub.calls[0];
    assert(call !== undefined);
    assertEquals(call.url, `${TEST_SUPABASE_URL}/rest/v1/rpc/authorize`);
    assertEquals(call.headers.get('Authorization'), 'Bearer admin.jwt.value');
    assertEquals(call.headers.get('x-da-admin-gateway'), 'gateway-secret-value');
    assertEquals(call.headers.get('Content-Profile'), 'admin_api');
    assertEquals(JSON.parse(call.body ?? '{}'), { p_permission: 'health.run' });

    const denied = stubFetch(() =>
      jsonResponse({ code: '42501', message: 'ADMIN_FORBIDDEN' }, 403),
    );
    const deniedGate = supabaseAdminGate({
      gatewaySecret: 'gateway-secret-value',
      clientConfig: {
        url: TEST_SUPABASE_URL,
        publishableKey: 'sb_publishable_x',
        secretKey: null,
        fetch: denied.fetch,
      },
    });
    const error = await deniedGate.authorize('jwt', 'users.read').catch((e: unknown) => e);
    assert(error instanceof AppError);
    assertEquals(error.code, 'FORBIDDEN');
  },
);
