/** @vitest-environment jsdom */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/admin/[...path]/route';
import { SupportAccessBanner } from '@/app/(admin)/users/[id]/support-access-banner';
import { RouteMetaProvider } from '@/components/route-meta';
import { moduleConfirmations } from '@/server/admin-contracts';
import { TR_MESSAGES, renderWithProviders } from '@/test/render';

/*
 * The BFF read route (`/api/admin/*`: palette search, session poll, Support Access content;
 * BACKOFFICE_PLAN §2.3, §9) and the Support Access banner (R-09): cross-site reads refused,
 * admin-api failures mapped without leaking detail, content fetched one entity at a time and
 * dropped after 60 s, the banner gone (and the page refreshed) when the grant expires.
 */

type Result =
  { ok: true; data: unknown; meta?: unknown } | { ok: false; error: Record<string, unknown> };
const api = vi.hoisted(() => ({ replies: new Map<string, Result>(), calls: [] as unknown[][] }));
vi.mock('@/server/admin-api', () => ({
  adminApi: (...args: unknown[]) => {
    api.calls.push(args);
    return Promise.resolve(api.replies.get(args[0] as string) ?? { ok: true, data: {}, meta: {} });
  },
}));
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: nav.refresh }),
  usePathname: () => '/users/x/overview',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/actions/mutate', () => ({ mutateAction: vi.fn() }));

const USER = '0190f5e0-1111-7000-8000-00000000abcd';
const GRANT = '0190f5e0-ffff-7000-8000-000000000009';
const S = TR_MESSAGES.backoffice.supportAccess;

function get(path: string, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) {
  const url = new URL(`http://localhost:3100/api/admin/${path}`);
  return GET(new NextRequest(url, { headers }), {
    params: Promise.resolve({ path: url.pathname.replace('/api/admin/', '').split('/') }),
  });
}

beforeEach(() => {
  api.replies.clear();
  api.calls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GET /api/admin/*', () => {
  it('refuses a cross-site read and unknown paths', async () => {
    expect((await get('me', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get('nope')).status).toBe(404);
    expect(api.calls).toEqual([]);
  });

  it('palette search is background activity and returns results only', async () => {
    api.replies.set('GET /search', {
      ok: true,
      data: { results: [{ id: 'x' }], total: 1 },
      meta: {},
    });
    const response = await get('search?q=yusuf');
    expect(await response.json()).toEqual({ results: [{ id: 'x' }] });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(api.calls[0]).toEqual([
      'GET /search',
      { query: { q: 'yusuf' } },
      { activity: 'background' },
    ]);
  });

  it('the session poll reports the remaining idle and absolute time', async () => {
    api.replies.set('GET /me', {
      ok: true,
      data: {
        session: {
          idle_expires_at: '2026-09-24T09:30:00Z',
          absolute_expires_at: '2026-09-24T21:00:00Z',
        },
      },
      meta: { server_time: '2026-09-24T09:00:00Z' },
    });
    expect(await (await get('me')).json()).toEqual({
      session: { idle_remaining_ms: 30 * 60_000, absolute_remaining_ms: 12 * 3_600_000 },
    });
  });

  it('reads one Support Access entity as user activity and maps failures', async () => {
    api.replies.set('GET /support-access/grants/:id/content/:scope', {
      ok: true,
      data: { value: 'y***@gmail.com', expires_in_s: 60 },
    });
    const ok = await get(
      `support-access/grants/${GRANT}/content/pii?entity_type=user&entity_id=${USER}`,
    );
    expect(await ok.json()).toEqual({ value: 'y***@gmail.com', expires_in_s: 60 });
    expect(api.calls[0]?.[1]).toEqual({
      params: { id: GRANT, scope: 'pii' },
      query: { entity_type: 'user', entity_id: USER },
    });
    expect(api.calls[0]?.[2]).toEqual({ activity: 'user' });

    const failures: [Record<string, unknown>, number][] = [
      [{ code: 'REQUEST_INVALID', status: 0 }, 422],
      [{ code: 'NETWORK_ERROR', status: 0 }, 502],
      [{ code: 'FORBIDDEN', status: 403 }, 403],
    ];
    for (const [error, status] of failures) {
      api.replies.set('GET /support-access/grants/:id/content/:scope', {
        ok: false,
        error: { ...error, correlationId: 'corr-7' },
      });
      const response = await get(`support-access/grants/${GRANT}/content/pii`);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: { code: error.code, correlation_id: 'corr-7' },
      });
    }
    api.replies.set('GET /me', {
      ok: false,
      error: {
        code: 'AUTH_REQUIRED',
        status: 401,
        correlationId: 'c',
        details: { reason: 'idle_timeout' },
      },
    });
    const expired = (await (await get('me')).json()) as { error: { reason: string } };
    expect(expired.error.reason).toBe('idle');
    api.replies.set('GET /search', {
      ok: false,
      error: { code: 'RATE_LIMITED', status: 429, correlationId: 'c' },
    });
    expect((await get('search?q=a')).status).toBe(429);
  });
});

describe('SupportAccessBanner (R-09)', () => {
  const grant = (expiresInMs: number) => ({
    id: GRANT,
    admin: { id: '0190f5e0-0000-7000-8000-000000000001', display_name: 'Ayşe' },
    scopes: ['pii', 'email_metadata'],
    reason: 'DA-10240',
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    revoked_at: null,
    active: true,
    reveal_count: 0,
  });

  function renderBanner(expiresInMs = 90_000) {
    const view = renderWithProviders(
      <RouteMetaProvider value={moduleConfirmations()}>
        <SupportAccessBanner userId={USER} grant={grant(expiresInMs) as never} />
      </RouteMetaProvider>,
    );
    return {
      ...view,
      user: userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime }),
    };
  }

  it('shows the countdown and scopes, then shows fetched content for 60 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = vi.fn((_url: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ value: 'Yusuf Demir', expires_in_s: 60 }), { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const { user } = renderBanner(10 * 60_000);
    const banner = screen.getByTestId('support-access-banner');
    expect(screen.getByRole('timer').textContent).toMatch(/\d+:\d{2}/);
    expect(banner).toHaveTextContent(S.active);
    await user.click(screen.getByRole('button', { name: S.view }));
    expect(await screen.findByText('Yusuf Demir')).toBeInTheDocument();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `/api/admin/support-access/grants/${GRANT}/content/pii?entity_type=user&entity_id=${USER}`,
    );
    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });
    expect(screen.queryByText('Yusuf Demir')).toBeNull();
  });

  it('rejects a malformed entity id and maps 403 and network failures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const { user } = renderBanner();
    const entity = screen.getByLabelText(/^Kayıt kimliği/);
    await user.clear(entity);
    await user.type(entity, 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: S.view }));
    expect(await screen.findByText(S.entityInvalid)).toBeInTheDocument();
    await user.clear(entity);
    await user.type(entity, USER);
    await user.click(screen.getByRole('button', { name: S.view }));
    expect(await screen.findByText(S.viewForbidden)).toBeInTheDocument();
    // "Göster" stays disabled until the previous read has settled.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: S.view })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: S.view }));
    expect(await screen.findByText(S.viewFailed)).toBeInTheDocument();
  });

  it('disappears and refreshes the page when the grant expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderBanner(2_000);
    expect(screen.getByTestId('support-access-banner')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(nav.refresh).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('support-access-banner')).toBeNull();
  });
});
