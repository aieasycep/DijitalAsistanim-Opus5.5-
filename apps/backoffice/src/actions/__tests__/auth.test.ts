import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptInviteAction,
  redeemRecoveryCodeAction,
  requestCodeAction,
  resendCodeAction,
  retryRecoveryCodesAction,
  verifyCodeAction,
  verifyMfaAction,
  type AuthFormState,
} from '@/actions/auth';
import { LOGIN_COOKIE } from '@/server/cookie-seal';
import { writeLoginStep, writeMfaFailures } from '@/server/auth-flow';
import { NavigationSignal, request } from '@/test/next-stubs';

/*
 * Admin sign-in actions (BACKOFFICE_PLAN §3.2–§3.5, R-08; TEST_PLAN BO-AUTH): Origin re-check,
 * generic copy, preflight throttling/lockout, the sealed login-step cookie, email OTP → admin
 * gate → TOTP (5 failures end the sign-in) → session start → recovery codes, recovery-code
 * redemption and invitation acceptance. admin-api and Supabase Auth are scripted stand-ins.
 */

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'development',
    API_PUBLIC_BASE_URL: 'http://127.0.0.1:54321',
    ADMIN_BFF_SECRET: 'x'.repeat(40),
    ADMIN_ORIGIN: 'http://localhost:3100',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_key',
  });
});

vi.mock('next/headers', () => import('@/test/next-stubs'));
vi.mock('next/navigation', () => import('@/test/next-stubs'));

type Result = { ok: true; data: unknown } | { ok: false; error: Record<string, unknown> };
const api = vi.hoisted(() => ({
  replies: new Map<string, Result[]>(),
  calls: [] as { key: string; input: unknown; options: unknown }[],
}));
vi.mock('@/server/admin-api', () => ({
  adminApi: (key: string, input: unknown, options: unknown) => {
    api.calls.push({ key, input, options });
    const queue = api.replies.get(key);
    const reply = queue === undefined ? undefined : queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(reply ?? { ok: true, data: {} });
  },
}));

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  getClaims: vi.fn(),
  getSession: vi.fn(),
  mfa: { challengeAndVerify: vi.fn(), listFactors: vi.fn() },
}));
vi.mock('@/server/supabase', () => ({ serverSupabase: () => Promise.resolve({ auth }) }));

const FACTOR = '0190f5e0-0000-7000-8000-00000000f001';
const ORIGIN = 'http://localhost:3100';

function reply(key: string, ...results: Result[]) {
  api.replies.set(key, results);
}
const fail = (code: string, status: number, extra: Record<string, unknown> = {}): Result => ({
  ok: false,
  error: { code, status, correlationId: 'corr-1', ...extra },
});
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const idle: AuthFormState = { status: 'idle' };
const keys = () => api.calls.map((c) => c.key);

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof NavigationSignal) return error.location;
    throw error;
  }
}

beforeEach(() => {
  api.replies.clear();
  api.calls.length = 0;
  request.cookies.clear();
  request.headers = new Headers({ origin: ORIGIN, 'sec-fetch-site': 'same-origin' });
  for (const fn of [
    auth.signInWithOtp,
    auth.verifyOtp,
    auth.signOut,
    auth.getClaims,
    auth.getSession,
  ]) {
    fn.mockReset();
  }
  auth.mfa.challengeAndVerify.mockReset();
  // A challenge tries the admin's verified TOTP factors (§3.3 backup device), this one first.
  auth.mfa.listFactors.mockReset();
  auth.mfa.listFactors.mockResolvedValue({
    data: { totp: [{ id: FACTOR }], all: [] },
    error: null,
  });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.getClaims.mockResolvedValue({ data: { claims: { email: 'ops@dijitalasistan.app' } } });
  reply('POST /auth/preflight', { ok: true, data: { allowed: true, locked: false } });
});

describe('requestCodeAction (step 1)', () => {
  it('refuses a cross-site post before doing anything', async () => {
    request.headers = new Headers({
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    });
    const state = await requestCodeAction(idle, form({ email: 'ops@dijitalasistan.app' }));
    expect(state).toEqual({ status: 'error', messageKey: 'errors.csrf' });
    expect(api.calls).toEqual([]);
  });

  it('rejects a malformed address locally', async () => {
    expect(await requestCodeAction(idle, form({ email: 'nope' }))).toEqual({
      status: 'error',
      messageKey: 'auth.emailInvalid',
    });
  });

  it.each([
    [{ ok: true, data: { allowed: false, locked: true } }, { messageKey: 'auth.locked' }],
    [
      { ok: true, data: { allowed: false, locked: false, retry_after: 300 } },
      { messageKey: 'auth.tooMany', values: { minutes: 5 } },
    ],
    [
      fail('RATE_LIMITED', 429, { retryAfter: 30 }),
      { messageKey: 'auth.tooMany', values: { minutes: 1 } },
    ],
    [fail('SERVICE_UNAVAILABLE', 503), { messageKey: 'auth.unavailable' }],
  ] as const)('maps the preflight answer %# to generic copy', async (preflight, expected) => {
    reply('POST /auth/preflight', preflight);
    const state = await requestCodeAction(idle, form({ email: 'ops@dijitalasistan.app' }));
    expect(state).toEqual({ status: 'error', ...expected });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('sends the code with hashed subjects, seals the login step and moves to the code step', async () => {
    const to = await redirectOf(
      requestCodeAction(
        idle,
        form({ email: ' OPS@dijitalasistan.app ', next: '/jobs?status=dead' }),
      ),
    );
    expect(to).toBe('/login?step=code');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ops@dijitalasistan.app',
      options: { shouldCreateUser: false },
    });
    const body = api.calls[0]?.input as { body: { email_hash: string; ip_hash: string } };
    expect(body.body.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(request.cookies.get(LOGIN_COOKIE)).toMatch(/.{20,}/);
    expect(request.cookies.get(LOGIN_COOKIE)).not.toContain('ops@');
  });

  it('reports an Auth outage but treats a 4xx from Auth as sent (no account enumeration)', async () => {
    auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 500 } });
    expect(await requestCodeAction(idle, form({ email: 'ops@dijitalasistan.app' }))).toEqual({
      status: 'error',
      messageKey: 'auth.unavailable',
    });
    auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 422 } });
    expect(await redirectOf(requestCodeAction(idle, form({ email: 'x@dijitalasistan.app' })))).toBe(
      '/login?step=code',
    );
  });
});

describe('resendCodeAction', () => {
  it('needs a login step, enforces the 60 s cooldown, then sends again', async () => {
    expect(await resendCodeAction(idle)).toEqual({
      status: 'error',
      messageKey: 'auth.stepExpired',
    });
    await writeLoginStep({
      email: 'ops@dijitalasistan.app',
      sentAt: Date.now() - 20_000,
      next: '/dashboard',
    });
    const notice = await resendCodeAction(idle);
    expect(notice).toMatchObject({ status: 'notice', messageKey: 'auth.resendIn' });
    expect(
      (notice as unknown as { values: { seconds: number } }).values.seconds,
    ).toBeGreaterThanOrEqual(39);
    await writeLoginStep({
      email: 'ops@dijitalasistan.app',
      sentAt: Date.now() - 61_000,
      next: '/dashboard',
    });
    expect(await redirectOf(resendCodeAction(idle))).toBe('/login?step=code');
  });
});

describe('verifyCodeAction (step 2)', () => {
  const session = { access_token: 'aal1-token' };

  beforeEach(async () => {
    await writeLoginStep({ email: 'ops@dijitalasistan.app', sentAt: Date.now(), next: '/jobs' });
  });

  it('checks the step and the code format first', async () => {
    expect(await verifyCodeAction(idle, form({ code: '12' }))).toEqual({
      status: 'error',
      messageKey: 'auth.codeFormat',
    });
    request.cookies.clear();
    expect(await verifyCodeAction(idle, form({ code: '123456' }))).toEqual({
      status: 'error',
      messageKey: 'auth.stepExpired',
    });
  });

  it('records a failed attempt for a wrong code and reports an outage separately', async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { status: 403 } });
    expect(await verifyCodeAction(idle, form({ code: '123456' }))).toEqual({
      status: 'error',
      messageKey: 'auth.codeInvalid',
    });
    expect(api.calls.find((c) => c.key === 'POST /auth/attempt')?.input).toMatchObject({
      body: { kind: 'email_otp', success: false },
    });
    auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { status: 503 } });
    expect(await verifyCodeAction(idle, form({ code: '123456' }))).toEqual({
      status: 'error',
      messageKey: 'auth.unavailable',
    });
  });

  it.each([
    [{ ok: true, data: { is_admin: false, status: 'active' } }, 'auth.notAdmin'],
    [{ ok: true, data: { is_admin: true, status: 'disabled' } }, 'auth.notAdmin'],
    [fail('FORBIDDEN', 403), 'auth.notAdmin'],
    [fail('NETWORK_ERROR', 0), 'auth.unavailable'],
  ] as const)('signs a non-admin out (%#)', async (status, messageKey) => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { session }, error: null });
    reply('GET /auth/status', status);
    expect(await verifyCodeAction(idle, form({ code: '123456' }))).toEqual({
      status: 'error',
      messageKey,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(request.cookies.get(LOGIN_COOKIE)).toBe('');
  });

  it('continues to /mfa with the original destination', async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { session }, error: null });
    reply('GET /auth/status', { ok: true, data: { is_admin: true, status: 'active' } });
    expect(await redirectOf(verifyCodeAction(idle, form({ code: '123456' })))).toBe(
      '/mfa?next=%2Fjobs',
    );
    expect(api.calls.find((c) => c.key === 'GET /auth/status')?.options).toEqual({
      token: 'aal1-token',
    });
    await writeLoginStep({
      email: 'ops@dijitalasistan.app',
      sentAt: Date.now(),
      next: '/dashboard',
    });
    auth.verifyOtp.mockResolvedValueOnce({ data: { session }, error: null });
    expect(await redirectOf(verifyCodeAction(idle, form({ code: '123456' })))).toBe('/mfa');
  });
});

describe('verifyMfaAction (step 3)', () => {
  const mfaForm = (extra: Record<string, string> = {}) =>
    form({ code: '654321', factorId: FACTOR, next: '/audit', ...extra });

  it('validates the code and the factor id', async () => {
    expect(await verifyMfaAction(idle, form({ code: 'abc', factorId: FACTOR }))).toMatchObject({
      messageKey: 'auth.codeFormat',
    });
    expect(await verifyMfaAction(idle, form({ code: '654321', factorId: 'x' }))).toMatchObject({
      messageKey: 'auth.mfaInvalid',
    });
  });

  it('counts failures and ends the sign-in on the fifth', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 422 } });
    expect(await verifyMfaAction(idle, mfaForm())).toMatchObject({ messageKey: 'auth.mfaInvalid' });
    await writeMfaFailures(4);
    expect(await redirectOf(verifyMfaAction(idle, mfaForm()))).toBe('/login?reason=mfa_failed');
    expect(auth.signOut).toHaveBeenCalled();
    auth.mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    expect(await verifyMfaAction(idle, mfaForm())).toMatchObject({
      messageKey: 'auth.unavailable',
    });
  });

  it('starts the admin session, mirrors preferences and redirects', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: { access_token: 'aal2' }, error: null });
    reply('GET /preferences', { ok: true, data: { theme: 'dark', locale: 'en' } });
    reply('GET /me', { ok: true, data: { admin: { recovery_codes_remaining: 7 } } });
    expect(await redirectOf(verifyMfaAction(idle, mfaForm()))).toBe('/audit');
    expect(keys()).toEqual(
      expect.arrayContaining(['POST /session/start', 'GET /preferences', 'GET /me']),
    );
    expect([...request.cookies.values()]).toEqual(expect.arrayContaining(['dark', 'en']));
  });

  it('issues recovery codes after enrolment (fresh step-up first)', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: { access_token: 'aal2' }, error: null });
    reply('POST /me/recovery-codes', { ok: true, data: { codes: ['AAAA-BBBB-CC'] } });
    const state = await verifyMfaAction(idle, mfaForm({ mode: 'enroll' }));
    expect(state).toEqual({ status: 'codes', codes: ['AAAA-BBBB-CC'], next: '/audit' });
    expect(keys().indexOf('POST /session/step-up')).toBeLessThan(
      keys().indexOf('POST /me/recovery-codes'),
    );
    reply('POST /session/step-up', fail('FORBIDDEN', 403));
    expect(await verifyMfaAction(idle, mfaForm({ mode: 'enroll' }))).toMatchObject({
      messageKey: 'auth.codes.failed',
    });
  });

  it('refuses a non-admin at session start and reports other failures as unavailable', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: { access_token: 'aal2' }, error: null });
    reply('POST /session/start', fail('FORBIDDEN', 403));
    expect(await redirectOf(verifyMfaAction(idle, mfaForm()))).toBe('/login?reason=not_admin');
    reply('POST /session/start', fail('INTERNAL_ERROR', 500));
    expect(await verifyMfaAction(idle, mfaForm())).toMatchObject({
      messageKey: 'auth.unavailable',
    });
  });
});

describe('recovery codes', () => {
  it('retry needs a session and returns fresh codes', async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await redirectOf(retryRecoveryCodesAction(idle, form({})))).toBe('/login');
    auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } } });
    reply('POST /me/recovery-codes', { ok: true, data: { codes: ['AAAA-BBBB-CC'] } });
    expect(await retryRecoveryCodesAction(idle, form({ next: '/flags' }))).toEqual({
      status: 'codes',
      codes: ['AAAA-BBBB-CC'],
      next: '/flags',
    });
  });

  it.each([
    [
      fail('RATE_LIMITED', 429, { retryAfter: 600 }),
      { messageKey: 'auth.tooMany', values: { minutes: 10 } },
    ],
    [fail('NETWORK_ERROR', 0), { messageKey: 'auth.unavailable' }],
    [fail('VALIDATION_FAILED', 422), { messageKey: 'auth.recovery.invalid' }],
  ] as const)('redeem maps admin-api errors (%#)', async (result, expected) => {
    reply('POST /auth/recovery-code/redeem', result);
    expect(await redeemRecoveryCodeAction(idle, form({ code: 'aaaa bbbb cc' }))).toEqual({
      status: 'error',
      ...expected,
    });
  });

  it('redeem validates the format, sends the normalised code and re-enrols', async () => {
    expect(await redeemRecoveryCodeAction(idle, form({ code: '1' }))).toMatchObject({
      messageKey: 'auth.recovery.invalid',
    });
    expect(
      await redirectOf(
        redeemRecoveryCodeAction(idle, form({ code: 'aaaa-bbbb-cc', next: '/jobs' })),
      ),
    ).toBe('/mfa?recovered=1&next=%2Fjobs');
    expect(api.calls.at(-1)?.input).toEqual({ body: { code: 'AAAA-BBBB-CC' } });
    reply('POST /auth/recovery-code/redeem', fail('AUTH_REQUIRED', 401));
    expect(await redirectOf(redeemRecoveryCodeAction(idle, form({ code: 'AAAABBBBCC' })))).toBe(
      '/login',
    );
  });
});

describe('acceptInviteAction (§3.5)', () => {
  const TOKEN = 'A'.repeat(43);

  it.each([
    [fail('NETWORK_ERROR', 0), 'auth.unavailable'],
    [fail('STATE_CONFLICT', 409), 'auth.invite.expired'],
    [fail('NOT_FOUND', 404, { details: { reason: 'expired' } }), 'auth.invite.expired'],
    [fail('NOT_FOUND', 404), 'auth.invite.invalid'],
  ] as const)('maps a failed redemption (%#)', async (result, messageKey) => {
    reply('POST /auth/invite/redeem', result);
    expect(await acceptInviteAction(idle, form({ token: TOKEN }))).toEqual({
      status: 'error',
      messageKey,
    });
  });

  it('rejects a malformed token and continues with an email code on success', async () => {
    expect(await acceptInviteAction(idle, form({ token: 'short' }))).toMatchObject({
      messageKey: 'auth.invite.invalid',
    });
    reply('POST /auth/invite/redeem', {
      ok: true,
      data: { email: 'new.admin@dijitalasistan.app' },
    });
    expect(await redirectOf(acceptInviteAction(idle, form({ token: TOKEN })))).toBe(
      '/login?step=code',
    );
    expect(auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new.admin@dijitalasistan.app' }),
    );
  });
});

/*
 * ZAP 10202 "Absence of Anti-CSRF Tokens" on the login form (security-nightly): the sign-in forms
 * carry no token because every sign-in action re-checks the Origin itself (the proxy checks it
 * first) and the auth cookies are `SameSite=Strict`. A foreign or missing Origin must be refused
 * by the action alone, even when no `Sec-Fetch-Site` header is sent (older browsers, scripted
 * clients), before any admin-api or Supabase Auth call.
 */
describe('Origin re-check on every sign-in action (CSRF without a form token)', () => {
  const actions: readonly [string, () => Promise<AuthFormState>][] = [
    ['requestCodeAction', () => requestCodeAction(idle, form({ email: 'ops@dijitalasistan.app' }))],
    ['resendCodeAction', () => resendCodeAction(idle)],
    ['verifyCodeAction', () => verifyCodeAction(idle, form({ code: '123456' }))],
    ['verifyMfaAction', () => verifyMfaAction(idle, form({ code: '123456' }))],
    ['retryRecoveryCodesAction', () => retryRecoveryCodesAction(idle, form({ next: '/' }))],
    [
      'redeemRecoveryCodeAction',
      () => redeemRecoveryCodeAction(idle, form({ code: 'ABCD-EFGH-IJKL' })),
    ],
    ['acceptInviteAction', () => acceptInviteAction(idle, form({ token: 'x'.repeat(43) }))],
  ];
  const origins: readonly [string, Headers][] = [
    ['a foreign Origin', new Headers({ origin: 'https://evil.example' })],
    ['a look-alike Origin', new Headers({ origin: 'http://localhost:3100.evil.example' })],
    ['an opaque Origin', new Headers({ origin: 'null' })],
    ['no Origin', new Headers()],
  ];
  const cases = actions.flatMap(([name, run]) =>
    origins.map(([label, headers]) => [name, label, run, headers] as const),
  );

  it.each(cases)('%s refuses %s', async (_name, _label, run, headers) => {
    request.headers = headers;
    await writeLoginStep({ email: 'ops@dijitalasistan.app', sentAt: Date.now(), next: '/' });
    expect(await run()).toEqual({ status: 'error', messageKey: 'errors.csrf' });
    expect(api.calls).toEqual([]);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
});
