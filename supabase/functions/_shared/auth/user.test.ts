import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { AppError } from '../errors.ts';
import { createApp } from '../http/app.ts';
import { sendData } from '../http/respond.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import { createTestIssuer, USER_A, userClaims } from '../testing/jwt.ts';
import {
  authenticateUser,
  chainVerifiers,
  requireRecentAuth,
  requireUser,
  supabaseClaimsVerifier,
  type TokenVerifier,
  VerifierUnavailableError,
} from './user.ts';
import type { DbClient } from '../db/clients.ts';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await assertRejects(() => promise);
  assert(error instanceof AppError);
  return `${error.code}:${String((error.details as { reason?: string } | undefined)?.reason ?? '')}`;
}

Deno.test('a valid access token yields {userId, aal, sessionId}', async () => {
  const issuer = await createTestIssuer();
  const jwt = await issuer.sign(userClaims(USER_A, { aal: 'aal2' }));
  const auth = await authenticateUser(issuer.verifier, `Bearer ${jwt}`);
  assertEquals(auth.userId, USER_A);
  assertEquals(auth.aal, 'aal2');
  assertEquals(auth.sessionId, '44444444-4444-4444-8444-444444444444');
});

Deno.test('forged tokens (signed by another key) are rejected', async () => {
  const issuer = await createTestIssuer();
  const attacker = await createTestIssuer();
  const forged = await attacker.sign(userClaims());
  assertEquals(
    await codeOf(authenticateUser(issuer.verifier, `Bearer ${forged}`)),
    'AUTH_REQUIRED:invalid_token',
  );
});

Deno.test('expired tokens are rejected', async () => {
  const issuer = await createTestIssuer();
  const expired = await issuer.sign(userClaims(), {
    issuedAt: Math.floor(Date.now() / 1000) - 7200,
    expiresInSeconds: 60,
  });
  assertEquals(
    await codeOf(authenticateUser(issuer.verifier, `Bearer ${expired}`)),
    'AUTH_REQUIRED:token_expired',
  );
});

Deno.test('tampered payloads are rejected', async () => {
  const issuer = await createTestIssuer();
  const [h, , s] = (await issuer.sign(userClaims())).split('.');
  const payload = btoa(
    JSON.stringify({ ...userClaims(), sub: '99999999-9999-4999-8999-999999999999' }),
  ).replace(/=+$/, '');
  assertEquals(
    await codeOf(authenticateUser(issuer.verifier, `Bearer ${h}.${payload}.${s}`)),
    'AUTH_REQUIRED:invalid_token',
  );
});

Deno.test(
  'admin identities, anonymous sessions and non-authenticated roles are rejected by user auth',
  async () => {
    const issuer = await createTestIssuer();
    const admin = await issuer.sign(
      userClaims(USER_A, { app_metadata: { da_kind: 'admin' }, aal: 'aal2' }),
    );
    assertEquals(
      await codeOf(authenticateUser(issuer.verifier, `Bearer ${admin}`)),
      'FORBIDDEN:admin_identity',
    );
    const anon = await issuer.sign(userClaims(USER_A, { is_anonymous: true }));
    assertEquals(
      await codeOf(authenticateUser(issuer.verifier, `Bearer ${anon}`)),
      'AUTH_REQUIRED:anonymous_session',
    );
    const service = await issuer.sign(userClaims(USER_A, { role: 'service_role' }));
    assertEquals(
      await codeOf(authenticateUser(issuer.verifier, `Bearer ${service}`)),
      'AUTH_REQUIRED:invalid_role',
    );
  },
);

Deno.test('missing or malformed Authorization headers are rejected', async () => {
  const issuer = await createTestIssuer();
  assertEquals(
    await codeOf(authenticateUser(issuer.verifier, undefined)),
    'AUTH_REQUIRED:missing_token',
  );
  assertEquals(
    await codeOf(authenticateUser(issuer.verifier, 'Basic abc')),
    'AUTH_REQUIRED:missing_token',
  );
});

Deno.test('the jose fallback is used only when getClaims is unavailable', async () => {
  const issuer = await createTestIssuer();
  const jwt = await issuer.sign(userClaims());
  const down: TokenVerifier = { verify: () => Promise.reject(new VerifierUnavailableError()) };
  const denies: TokenVerifier = { verify: () => Promise.reject(new AppError('AUTH_REQUIRED')) };
  assertEquals((await chainVerifiers(down, issuer.verifier).verify(jwt)).sub, USER_A);
  await assertRejects(() => chainVerifiers(denies, issuer.verifier).verify(jwt), AppError);
  const both = chainVerifiers(down, down);
  const error = await assertRejects(() => both.verify(jwt));
  assertEquals((error as AppError).code, 'SERVICE_UNAVAILABLE');
});

Deno.test(
  'supabase getClaims: invalid token → AUTH_REQUIRED, fetch failure → fallback signal',
  async () => {
    const client = (result: unknown, throws = false) =>
      ({
        auth: {
          getClaims: () =>
            throws ? Promise.reject(new TypeError('network')) : Promise.resolve(result),
        },
      }) as unknown as DbClient;
    const ok = await supabaseClaimsVerifier(
      client({ data: { claims: userClaims() }, error: null }),
    ).verify('x.y.z');
    assertEquals(ok.sub, USER_A);
    await assertRejects(
      () =>
        supabaseClaimsVerifier(
          client({ data: null, error: { name: 'AuthInvalidJwtError', message: 'invalid' } }),
        ).verify('x'),
      AppError,
    );
    await assertRejects(
      () =>
        supabaseClaimsVerifier(
          client({ data: null, error: { name: 'AuthRetryableFetchError', status: 0 } }),
        ).verify('x'),
      VerifierUnavailableError,
    );
    await assertRejects(
      () => supabaseClaimsVerifier(client(null, true)).verify('x'),
      VerifierUnavailableError,
    );
  },
);

Deno.test(
  'requireUser middleware sets the identity and a peppered user hash for logs',
  async () => {
    const issuer = await createTestIssuer();
    const mem = memorySink();
    const app = createApp({ fn: 'api', logger: createLogger({ fn: 'api', sink: mem.sink }) });
    app.get(
      '/whoami',
      requireUser(issuer.verifier, { userHash: () => Promise.resolve('hash-of-user') }),
      (c) => sendData(c, { id: c.get('auth')?.userId ?? null }),
    );
    const unauthorized = await app.request('/api/whoami');
    assertEquals(unauthorized.status, 401);
    await unauthorized.body?.cancel();
    const res = await app.request('/api/whoami', {
      headers: { Authorization: `Bearer ${await issuer.sign(userClaims())}` },
    });
    assertEquals((await res.json()).data.id, USER_A);
    const log = mem.records().find((r) => r.msg === 'request' && r.status === 200);
    assertEquals(log?.user_hash, 'hash-of-user');
    assert(!mem.lines.some((l) => l.includes(USER_A)));
  },
);

Deno.test('recent-auth gate uses the latest amr timestamp', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const base = { userId: USER_A, aal: 'aal1' as const, sessionId: null, jwt: 'x' };
  requireRecentAuth(
    {
      ...base,
      claims: { sub: USER_A, amr: [{ method: 'otp', timestamp: now.getTime() / 1000 - 60 }] },
    },
    600,
    now,
  );
  const error = assertThrows(() =>
    requireRecentAuth(
      {
        ...base,
        claims: { sub: USER_A, amr: [{ method: 'otp', timestamp: now.getTime() / 1000 - 3600 }] },
      },
      600,
      now,
    ),
  );
  assertEquals((error as AppError).code, 'REAUTH_REQUIRED');
});
