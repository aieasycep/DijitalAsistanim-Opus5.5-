/** @vitest-environment jsdom */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionWatcher } from '@/components/session-watcher';
import { renderWithProviders } from '@/test/render';

const actions = vi.hoisted(() => ({
  heartbeatAction: vi.fn(async () => ({ ok: true as const, idleRemainingMs: 30 * 60_000 })),
  endSessionAction: vi.fn(async () => ({ ok: true as const, data: undefined as never })),
  logoutAction: vi.fn(async () => ({ ok: true as const, data: undefined as never })),
}));
const replace = vi.fn();

vi.mock('@/actions/session', () => actions);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            session: { idle_remaining_ms: 29 * MIN, absolute_remaining_ms: 11 * 60 * MIN },
          }),
          { status: 200 },
        ),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('SessionWatcher (BACKOFFICE_PLAN §3.7)', () => {
  it('warns at T−2 min and signs out at the idle deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    renderWithProviders(
      <SessionWatcher idleRemainingMs={30 * MIN} absoluteRemainingMs={12 * 60 * MIN} />,
    );
    await advance(27 * MIN);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await advance(1 * MIN + 30_000);
    const dialog = screen.getByRole('dialog', { name: 'Oturumun kapanmak üzere' });
    expect(dialog).toHaveTextContent('Hareketsizlik nedeniyle oturumun 2 dakika içinde kapanacak.');
    expect(screen.getByRole('timer')).toHaveTextContent('Kalan süre: 01:30');
    await advance(2 * MIN);
    expect(actions.endSessionAction).toHaveBeenCalledWith('idle');
    expect(actions.endSessionAction).toHaveBeenCalledOnce();
  });

  it('"Oturumu sürdür" sends a heartbeat and moves the deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    renderWithProviders(
      <SessionWatcher idleRemainingMs={3 * MIN} absoluteRemainingMs={12 * 60 * MIN} />,
    );
    await advance(1 * MIN + 10_000);
    fireEvent.click(screen.getByRole('button', { name: 'Oturumu sürdür' }));
    await advance(1_000);
    expect(actions.heartbeatAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await advance(20 * MIN);
    expect(actions.endSessionAction).not.toHaveBeenCalled();
  });

  it('admin input sends at most one heartbeat a minute', async () => {
    renderWithProviders(
      <SessionWatcher idleRemainingMs={30 * MIN} absoluteRemainingMs={12 * 60 * MIN} />,
    );
    fireEvent.keyDown(window, { key: 'a' });
    expect(actions.heartbeatAction).not.toHaveBeenCalled();
    await advance(61_000);
    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: 'b' });
    await advance(0);
    expect(actions.heartbeatAction).toHaveBeenCalledOnce();
  });

  it('uses the absolute deadline and ends with reason "expired" (the 12 h cap cannot be extended)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    renderWithProviders(
      <SessionWatcher idleRemainingMs={30 * MIN} absoluteRemainingMs={3 * MIN} />,
    );
    await advance(1 * MIN + 30_000);
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Oturum süren (12 saat) 2 dakika içinde doluyor.',
    );
    expect(screen.queryByRole('button', { name: 'Oturumu sürdür' })).not.toBeInTheDocument();
    await advance(2 * MIN);
    expect(actions.endSessionAction).toHaveBeenCalledWith('expired');
  });

  it('the background probe never extends the session and reports a revoked one', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', reason: 'revoked' } }), {
          status: 401,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <SessionWatcher idleRemainingMs={30 * MIN} absoluteRemainingMs={12 * 60 * MIN} />,
    );
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/me',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(actions.heartbeatAction).not.toHaveBeenCalled();
    await advance(1_000);
    expect(actions.endSessionAction).toHaveBeenCalledWith('revoked');
  });
});
