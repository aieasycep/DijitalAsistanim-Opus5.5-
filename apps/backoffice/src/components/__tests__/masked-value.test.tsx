/** @vitest-environment jsdom */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaskedValue } from '@/components/masked-value';
import { adminContext, axeViolations, renderWithProviders } from '@/test/render';

const REASON = 'Destek talebi DA-2026-000123 doğrulaması';

afterEach(() => {
  vi.useRealTimers();
});

describe('MaskedValue + RevealButton (BACKOFFICE_PLAN §5.5)', () => {
  it('shows only the mask and no reveal control without the permission', () => {
    renderWithProviders(
      <MaskedValue
        masked="yu***@gmail.com"
        label="E-posta"
        reveal={{ permission: 'users.pii.reveal', reveal: vi.fn() }}
      />,
    );
    expect(screen.getByText('yu***@gmail.com')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'E-posta değerini göster' }),
    ).not.toBeInTheDocument();
  });

  it('reveals after a reason, for 60 seconds, then masks again', async () => {
    const reveal = vi.fn(async () => ({
      ok: true as const,
      data: { value: 'yusuf@gmail.com', expires_in_s: 60 },
    }));
    renderWithProviders(
      <MaskedValue
        masked="yu***@gmail.com"
        label="E-posta"
        reveal={{ permission: 'users.pii.reveal', reveal }}
      />,
      { admin: adminContext({ permissions: ['users.read', 'users.pii.reveal'] }) },
    );
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'E-posta değerini göster' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bilgiyi göster' });
    expect(dialog).toHaveTextContent('60 saniye');
    await user.type(screen.getByLabelText('Gerekçe'), REASON);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(screen.getByRole('button', { name: 'Göster' }));
    expect(await screen.findByText('yusuf@gmail.com')).toBeInTheDocument();
    expect(reveal).toHaveBeenCalledWith(expect.objectContaining({ reason: REASON, confirm: true }));
    expect(screen.getByRole('status')).toHaveTextContent('60 sn sonra yeniden maskelenecek');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => {
      expect(screen.queryByText('yusuf@gmail.com')).not.toBeInTheDocument();
    });
    expect(screen.getByText('yu***@gmail.com')).toBeInTheDocument();
  });

  it('can be hidden before the time is up', async () => {
    const reveal = vi.fn(async () => ({
      ok: true as const,
      data: { value: 'yusuf@gmail.com', expires_in_s: 60 },
    }));
    renderWithProviders(
      <MaskedValue
        masked="yu***@gmail.com"
        label="E-posta"
        reveal={{ permission: 'users.pii.reveal', reveal }}
      />,
      { admin: adminContext({ permissions: ['users.pii.reveal'] }) },
    );
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'E-posta değerini göster' }));
    await user.type(await screen.findByLabelText('Gerekçe'), REASON);
    await user.click(screen.getByRole('button', { name: 'Göster' }));
    await user.click(await screen.findByRole('button', { name: 'Gizle' }));
    expect(screen.getByText('yu***@gmail.com')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(
      <MaskedValue
        masked="yu***@gmail.com"
        label="E-posta"
        reveal={{ permission: 'users.pii.reveal', reveal: vi.fn() }}
      />,
      { admin: adminContext({ permissions: ['users.pii.reveal'] }) },
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
