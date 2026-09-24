/** @vitest-environment jsdom */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GrantProButton } from '@/components/entitlement-actions';
import { JobActions } from '@/components/job-actions';
import { RegenerateBriefing } from '@/components/regenerate-briefing';
import { RouteMetaProvider } from '@/components/route-meta';
import { moduleConfirmations } from '@/server/admin-contracts';
import { adminContext, axeViolations, renderWithProviders } from '@/test/render';

/*
 * Module controls (T-10.15): permission-gated rendering, disabled-with-reason controls and the
 * action wrapper (reason from the dialog, idempotency key, toast, refresh of the current page).
 */

const refresh = vi.fn();
const mutate = vi.hoisted(() => ({
  mutateAction: vi.fn(async () => ({ ok: true, data: { id: 'x', status: 'queued' } })),
}));
vi.mock('@/actions/mutate', () => mutate);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(),
}));

const JOB = '0190f5e0-4444-7000-8000-000000000001';
const USER = '0190f5e0-1111-7000-8000-00000000abcd';
const REASON = 'Sağlayıcı kesintisi sonrası kontrollü tekrar';

afterEach(() => {
  vi.clearAllMocks();
});

function renderControl(ui: ReactElement, permissions: string[]) {
  const view = renderWithProviders(
    <RouteMetaProvider value={moduleConfirmations()}>{ui}</RouteMetaProvider>,
    {
      admin: adminContext({ permissions: permissions as never }),
    },
  );
  return { ...view, user: userEvent.setup({ delay: null }) };
}

describe('module controls', () => {
  it('retries a dead-letter job through the action wrapper with the dialog reason', async () => {
    const { user } = renderControl(
      <JobActions jobId={JOB} type="gmail_sync" status="dead_letter" />,
      ['jobs.retry', 'jobs.cancel'],
    );
    await user.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    const dialog = await screen.findByRole('dialog', { name: 'İşi tekrar dene' });
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(within(dialog).getByRole('checkbox', { name: 'Deneme sayacını sıfırla' }));
    await user.type(within(dialog).getByLabelText('Gerekçe'), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(mutate.mutateAction).toHaveBeenCalledWith(
      {
        route: 'POST /jobs/:id/retry',
        params: { id: JOB },
        body: { reset_attempts: true },
        revalidate: '/jobs',
      },
      expect.objectContaining({
        reason: REASON,
        confirm: true,
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('İş kuyruğa alındı.', { selector: 'div' })).toBeInTheDocument();
  });

  it('shows a disabled control with its reason instead of a dead button', () => {
    renderControl(<JobActions jobId={JOB} type="gmail_sync" status="running" />, [
      'jobs.retry',
      'jobs.cancel',
    ]);
    expect(screen.getByRole('button', { name: /İptal et/ })).toBeDisabled();
    expect(screen.getByText('Çalışan iş iptal edilemez.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tekrar dene/ })).toBeDisabled();
    expect(
      screen.getByText('Yalnızca başarısız veya ölü mektup işler tekrar denenebilir.'),
    ).toBeInTheDocument();
  });

  it('renders nothing the admin may not do (cosmetic layer; admin-api re-checks)', () => {
    renderControl(
      <>
        <JobActions jobId={JOB} type="gmail_sync" status="dead_letter" />
        <RegenerateBriefing briefingId={JOB} status="failed" localDate="2026-09-24" />
        <GrantProButton userId={USER} grants={[]} />
      </>,
      ['jobs.read', 'briefings.read'],
    );
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('limits the grant dialog to 1 or 7 days from Support for entitlements.grant_limited', async () => {
    const { user } = renderControl(<GrantProButton userId={USER} grants={[]} />, [
      'entitlements.grant_limited',
    ]);
    await user.click(screen.getByTestId('grant-pro'));
    const dialog = await screen.findByRole('dialog', { name: 'Geçici Pro tanımla' });
    const durations = within(dialog).getByRole('group', { name: 'Süre' });
    expect(
      within(durations)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['1', '7']);
    const sources = within(dialog).getByRole('group', { name: 'Kaynak' });
    expect(
      within(sources)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['support']);
    expect(
      within(dialog).getByText(
        'Destek rolü yalnızca 1 veya 7 günlük, Destek kaynaklı erişim tanımlayabilir.',
      ),
    ).toBeInTheDocument();
  });

  it('offers every duration and source with entitlements.grant', async () => {
    const { user } = renderControl(<GrantProButton userId={USER} grants={[]} />, [
      'entitlements.grant',
    ]);
    await user.click(screen.getByTestId('grant-pro'));
    const dialog = await screen.findByRole('dialog', { name: 'Geçici Pro tanımla' });
    const durations = within(dialog).getByRole('group', { name: 'Süre' });
    expect(within(durations).getAllByRole('radio')).toHaveLength(4);
    expect(
      within(within(dialog).getByRole('group', { name: 'Kaynak' })).getAllByRole('radio'),
    ).toHaveLength(3);
  });
});
