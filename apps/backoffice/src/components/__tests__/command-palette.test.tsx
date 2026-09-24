/** @vitest-environment jsdom */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPaletteProvider, searchable } from '@/components/command-palette';
import { SessionActionsProvider } from '@/components/session-actions';
import { visibleNavigation } from '@/lib/navigation';
import { axeViolations, renderWithProviders } from '@/test/render';

const push = vi.fn();
const sessionActions = vi.hoisted(() => ({
  logoutAction: vi.fn(),
  logoutAllAction: vi.fn(),
  heartbeatAction: vi.fn(),
  endSessionAction: vi.fn(),
}));
const preferenceActions = vi.hoisted(() => ({
  setThemeAction: vi.fn(async () => ({ ok: true, data: { saved: true } })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/actions/session', () => sessionActions);
vi.mock('@/actions/preferences', () => preferenceActions);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderPalette(canSearch = true) {
  const groups = visibleNavigation(['dashboard.read', 'users.read', 'search.global']);
  const view = renderWithProviders(
    <SessionActionsProvider>
      <CommandPaletteProvider groups={groups} canSearch={canSearch} theme="light">
        <p>içerik</p>
      </CommandPaletteProvider>
    </SessionActionsProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe('command palette (BACKOFFICE_PLAN §6.25)', () => {
  it('opens with Ctrl+K and lists pages and commands', async () => {
    const { user } = renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Komut paleti' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pano' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tema: Koyu' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tüm oturumlardan çık' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Pano' }));
    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('asks for 3 characters, searches through the read proxy and copies IDs of unbuilt modules', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                type: 'user',
                id: '0190f5e0-1111-7000-8000-00000000abcd',
                label: 'yu***@gmail.com',
                route: '/users/0190f5e0-1111-7000-8000-00000000abcd',
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { user } = renderPalette();
    // user-event installs its own clipboard stub in setup(); observe it.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox');
    await user.type(input, 'yu');
    expect(await screen.findByText('Aramak için en az 3 karakter yaz.')).toBeInTheDocument();
    await user.type(input, 'suf');
    const result = await screen.findByRole('option', { name: /yu\*\*\*@gmail\.com/ });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/search?q=yusuf',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(result).toHaveTextContent('Kimliği kopyala');
    await user.click(result);
    expect(writeText).toHaveBeenCalledWith('0190f5e0-1111-7000-8000-00000000abcd');
    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByText('Kimlik kopyalandı.')).toBeInTheDocument();
  });

  it('never executes a destructive command directly: it opens the confirmation', async () => {
    const { user } = renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    await user.click(await screen.findByRole('option', { name: 'Tüm oturumlardan çık' }));
    expect(await screen.findByRole('dialog', { name: 'Tüm oturumlardan çık' })).toBeInTheDocument();
    expect(sessionActions.logoutAllAction).not.toHaveBeenCalled();
  });

  it('does not search without search.global and reports failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    const { user } = renderPalette(true);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('combobox'), 'abcdef');
    expect(await screen.findByText('Arama yapılamadı. Tekrar dene.')).toBeInTheDocument();
  });

  it('routes queries: ≥ 3 characters or an exact uuid', () => {
    expect(searchable('ab')).toBe(false);
    expect(searchable('abc')).toBe(true);
    expect(searchable('0190f5e0-1111-7000-8000-00000000abcd')).toBe(true);
  });

  it('has no axe violations when open', async () => {
    const { user } = renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Komut paleti' });
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveFocus();
    });
    expect(await axeViolations(dialog)).toEqual([]);
  });
});
