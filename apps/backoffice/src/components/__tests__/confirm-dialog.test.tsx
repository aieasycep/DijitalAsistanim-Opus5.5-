/** @vitest-environment jsdom */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog, type ConfirmEnvelope } from '@/components/confirm-dialog';
import { adminContext, axeViolations, renderWithProviders } from '@/test/render';

const REASON = 'Kullanıcı destek talebinde e-posta doğrulaması istedi';

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn(async (_envelope: ConfirmEnvelope) => ({
    ok: true as const,
    data: { done: true },
  }));
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Senkronu başlat"
      effects="Kullanıcının bağlı hesapları için senkron işi kuyruğa alınır."
      confirmLabel="Senkronu başlat"
      requiresReason
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { ...view, onConfirm, onOpenChange, user: userEvent.setup() };
}

describe('ConfirmDialog (BACKOFFICE_PLAN §5.4)', () => {
  it('requires a 10–500 character reason before calling the server', async () => {
    const { onConfirm, user } = setup();
    const dialog = await screen.findByRole('dialog', { name: 'Senkronu başlat' });
    expect(dialog).toHaveTextContent('Ne olacak');
    await user.type(screen.getByLabelText('Gerekçe'), 'kısa');
    await user.click(screen.getByRole('button', { name: 'Senkronu başlat' }));
    expect(await screen.findByText('Gerekçe zorunlu (en az 10 karakter).')).toBeInTheDocument();
    expect(screen.getByLabelText('Gerekçe')).toHaveAttribute('aria-invalid', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason, confirm and one idempotency key for every retry in the dialog', async () => {
    const { onConfirm, onOpenChange, user } = setup();
    onConfirm.mockResolvedValueOnce({
      ok: false,
      error: { messageKey: 'errors.conflict', values: {}, correlationId: 'corr-1' },
    } as never);
    await user.type(await screen.findByLabelText('Gerekçe'), `  ${REASON}  `);
    await user.click(screen.getByRole('button', { name: 'Senkronu başlat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kayıt başka bir yönetici tarafından değiştirildi. Sayfayı yenileyip tekrar dene.',
    );
    await user.click(screen.getByRole('button', { name: 'Senkronu başlat' }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    const [first, second] = onConfirm.mock.calls.map(([envelope]) => envelope);
    expect(first).toMatchObject({ reason: REASON, confirm: true });
    expect(first?.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(await screen.findByText('Kaydedildi.')).toBeInTheDocument();
  });

  it('requires the typed confirmation token (level 3)', async () => {
    const { onConfirm, user } = setup({ typedToken: 'DEVRE DIŞI', tone: 'destructive' });
    await user.type(await screen.findByLabelText('Gerekçe'), REASON);
    await user.type(screen.getByRole('textbox', { name: /Onaylamak için/ }), 'devre dışı');
    await user.click(screen.getByRole('button', { name: 'Senkronu başlat' }));
    expect(await screen.findByText('Yazdığın metin eşleşmiyor.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.clear(screen.getByRole('textbox', { name: /Onaylamak için/ }));
    await user.type(screen.getByRole('textbox', { name: /Onaylamak için/ }), 'DEVRE DIŞI');
    await user.click(screen.getByRole('button', { name: 'Senkronu başlat' }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  it('shows the step-up field when the server asks for it and sends the code', async () => {
    const { onConfirm, user } = setup({ requiresStepUp: true });
    onConfirm.mockResolvedValueOnce({
      ok: false,
      error: { messageKey: 'errors.stepUpRequired', values: {}, stepUpRequired: true },
    } as never);
    // The session's step-up is stale, so the field is there from the start.
    const code = await screen.findByLabelText('Doğrulama kodu');
    await user.type(screen.getByLabelText('Gerekçe'), REASON);
    await user.type(code, '12a3456');
    await user.click(screen.getByRole('button', { name: 'Senkronu başlat' }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
    });
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ stepUpCode: '123456' });
  });

  it('omits the reason field where the route has none', async () => {
    const { onConfirm, user } = setup({ requiresReason: false });
    await screen.findByRole('dialog');
    expect(screen.queryByLabelText('Gerekçe')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Senkronu başlat' }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
    });
    expect(onConfirm.mock.calls[0]?.[0]).not.toHaveProperty('reason');
  });

  it('keeps a fresh step-up session free of the code field', async () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Kurtarma kodlarını yenile"
        confirmLabel="Yenile"
        requiresStepUp
        onConfirm={vi.fn()}
      />,
      {
        admin: adminContext({
          session: {
            idleExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
            absoluteExpiresAt: new Date(Date.now() + 43_200_000).toISOString(),
            stepUpValidUntil: new Date(Date.now() + 300_000).toISOString(),
            serverTime: new Date().toISOString(),
          },
        }),
      },
    );
    await screen.findByRole('dialog');
    expect(screen.queryByLabelText('Doğrulama kodu')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    setup({ typedToken: 'abc123', requiresStepUp: true });
    const dialog = await screen.findByRole('dialog');
    expect(await axeViolations(dialog)).toEqual([]);
  });
});
