import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AdminApiModule from '@/server/admin-api';

import {
  saveTablePrefsAction,
  setDashboardRangeAction,
  setDensityAction,
  setLocaleAction,
  setSidebarCollapsedAction,
  setThemeAction,
  setTimezoneAction,
} from '@/actions/preferences';
import { revealAction } from '@/actions/reveal';
import {
  endSessionAction,
  heartbeatAction,
  logoutAction,
  logoutAllAction,
} from '@/actions/session';
import { NavigationSignal, request } from '@/test/next-stubs';

/*
 * Preference and session server actions (BACKOFFICE_PLAN §3.7 session, §5.5 preferences, §5.3
 * reveal; TEST_PLAN BO-SEC): every action re-checks the Origin, validates its input before
 * calling admin-api, mirrors theme/locale into cookies, merges table preferences, and ends the
 * session locally even when admin-api or Auth is unreachable.
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
vi.mock('next/cache', () => import('@/test/next-stubs'));

type Result =
  { ok: true; data: unknown; meta?: unknown } | { ok: false; error: Record<string, unknown> };
const api = vi.hoisted(() => ({
  replies: new Map<string, Result>(),
  calls: [] as { key: string; input: unknown }[],
}));
vi.mock('@/server/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof AdminApiModule>()),
  adminApi: (key: string, input: unknown) => {
    api.calls.push({ key, input });
    return Promise.resolve(api.replies.get(key) ?? { ok: true, data: {}, meta: {} });
  },
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/server/supabase', () => ({ serverSupabase: () => Promise.resolve({ auth }) }));

const USER = '0190f5e0-1111-7000-8000-00000000abcd';
const REASON = 'Destek talebi DA-10240 için gerekli işlem';
const envelope = (extra: Record<string, unknown> = {}) => ({
  reason: REASON,
  confirm: true,
  idempotencyKey: '0190f5e0-2222-7000-8000-000000000001',
  ...extra,
});
const invalid = { ok: false, error: expect.objectContaining({ code: 'VALIDATION_FAILED' }) };
const csrf = { ok: false, error: expect.objectContaining({ code: 'CSRF_ORIGIN' }) };

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
  request.headers = new Headers({
    origin: 'http://localhost:3100',
    'sec-fetch-site': 'same-origin',
  });
  auth.signOut.mockReset();
  auth.signOut.mockResolvedValue({ error: null });
});

describe('preference actions', () => {
  it('reject invalid values before calling admin-api', async () => {
    expect(await setThemeAction('sepia')).toEqual(invalid);
    expect(await setLocaleAction('de')).toEqual(invalid);
    expect(await setTimezoneAction('Mars/Olympus')).toEqual(invalid);
    expect(await setDensityAction('huge')).toEqual(invalid);
    expect(await setSidebarCollapsedAction('yes')).toEqual(invalid);
    expect(await setDashboardRangeAction('1y')).toEqual(invalid);
    expect(await saveTablePrefsAction('Bad Id', {})).toEqual(invalid);
    expect(await saveTablePrefsAction('users', { pageSize: 30 })).toEqual(invalid);
    expect(api.calls).toEqual([]);
  });

  it('mirror theme and locale into cookies and PATCH the preference', async () => {
    expect(await setThemeAction('dark')).toEqual({ ok: true, data: { saved: true } });
    expect(await setLocaleAction('en')).toEqual({ ok: true, data: { saved: true } });
    expect([...request.cookies.values()]).toEqual(['dark', 'en']);
    expect(api.calls.map((c) => c.input)).toEqual([
      { body: { theme: 'dark' } },
      { body: { locale: 'en' } },
    ]);
  });

  it.each([
    [() => setTimezoneAction('Europe/Istanbul'), { timezone: 'Europe/Istanbul' }],
    [() => setDensityAction('compact'), { density: 'compact' }],
    [() => setSidebarCollapsedAction(true), { sidebar_collapsed: true }],
    [() => setDashboardRangeAction('30d'), { dashboard_range: '30d' }],
  ])('PATCHes %#', async (run, body) => {
    expect(await run()).toEqual({ ok: true, data: { saved: true } });
    expect(api.calls).toEqual([{ key: 'PATCH /preferences', input: { body } }]);
  });

  it('refuse a cross-site call and pass admin-api failures through', async () => {
    request.headers = new Headers({ origin: 'https://evil.example' });
    expect(await setThemeAction('light')).toEqual(csrf);
    expect(await setLocaleAction('tr')).toEqual(csrf);
    expect(await setDensityAction('compact')).toEqual(csrf);
    expect(await saveTablePrefsAction('users', {})).toEqual(csrf);
    request.headers = new Headers({ origin: 'http://localhost:3100' });
    api.replies.set('PATCH /preferences', {
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', status: 503, correlationId: 'corr-9' },
    });
    const failed = await setDensityAction('compact');
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', correlationId: 'corr-9' },
    });
  });

  it('merges one table’s preferences into the stored map', async () => {
    api.replies.set('GET /preferences', {
      ok: true,
      data: {
        table_prefs: { users: { hidden: ['plan'], pageSize: 25 }, jobs: { density: 'compact' } },
      },
    });
    expect(await saveTablePrefsAction('users', { pageSize: 50 })).toEqual({
      ok: true,
      data: { saved: true },
    });
    expect(api.calls.at(-1)).toEqual({
      key: 'PATCH /preferences',
      input: {
        body: {
          table_prefs: {
            users: { hidden: ['plan'], pageSize: 50 },
            jobs: { density: 'compact' },
          },
        },
      },
    });
    api.replies.set('GET /preferences', {
      ok: false,
      error: { code: 'AUTH_REQUIRED', status: 401, correlationId: 'corr-1' },
    });
    expect(await saveTablePrefsAction('users', {})).toMatchObject({ ok: false });
  });
});

describe('session actions', () => {
  it('heartbeat returns the remaining idle time or the redirect for an ended session', async () => {
    api.replies.set('POST /session/heartbeat', {
      ok: true,
      data: { idle_expires_at: '2026-09-24T09:30:00Z' },
      meta: { server_time: '2026-09-24T09:00:00Z' },
    });
    expect(await heartbeatAction()).toEqual({ ok: true, idleRemainingMs: 30 * 60_000 });
    api.replies.set('POST /session/heartbeat', {
      ok: false,
      error: {
        code: 'AUTH_REQUIRED',
        status: 401,
        correlationId: 'c',
        details: { reason: 'idle_timeout' },
      },
    });
    const ended = await heartbeatAction();
    expect(ended.ok).toBe(false);
    expect((ended as { redirectTo: string | null }).redirectTo).toMatch(/^\/login/);
    request.headers = new Headers({ origin: 'https://evil.example' });
    expect(await heartbeatAction()).toEqual({ ok: false, redirectTo: null });
  });

  it('logout ends the session on admin-api and locally, even when Auth is unreachable', async () => {
    auth.signOut.mockRejectedValueOnce(new Error('offline'));
    expect(await redirectOf(logoutAction())).toBe('/login?reason=logged_out');
    expect(api.calls.map((c) => c.key)).toEqual(['POST /session/logout']);
    request.headers = new Headers({ origin: 'https://evil.example' });
    expect(await logoutAction()).toEqual(csrf);
  });

  it('logout-all needs the dialog envelope and signs out everywhere', async () => {
    expect(await logoutAllAction({})).toMatchObject({ ok: false });
    expect(await redirectOf(logoutAllAction(envelope()))).toBe('/login?reason=logged_out');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    auth.signOut.mockRejectedValueOnce(new Error('offline'));
    expect(await redirectOf(logoutAllAction(envelope()))).toBe('/login?reason=logged_out');
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
  });

  it('endSession lands on the matching banner and defaults to idle', async () => {
    expect(await redirectOf(endSessionAction('revoked'))).toBe('/login?reason=revoked');
    expect(await redirectOf(endSessionAction('nonsense'))).toBe('/login?reason=idle');
    request.headers = new Headers({ origin: 'https://evil.example' });
    expect(await endSessionAction('idle')).toEqual(csrf);
  });
});

describe('revealAction (§5.3)', () => {
  it('validates the request and sends the email field for a user reveal', async () => {
    expect(
      await revealAction({ route: 'POST /users/:id/reveal', id: 'x' } as never, envelope()),
    ).toEqual(invalid);
    api.replies.set('POST /users/:id/reveal', {
      ok: true,
      data: { value: 'y***@gmail.com', expires_in_s: 60 },
      meta: {},
    });
    const result = await revealAction({ route: 'POST /users/:id/reveal', id: USER }, envelope());
    expect(result).toMatchObject({ ok: true });
    expect(api.calls.find((c) => c.key === 'POST /users/:id/reveal')?.input).toMatchObject({
      params: { id: USER },
      body: { field: 'email', reason: REASON, confirm: true },
    });
  });
});
