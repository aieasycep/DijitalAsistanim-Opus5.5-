/** @vitest-environment jsdom */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiFeedbackTable } from '@/app/(admin)/ai/feedback/feedback-table';
import { JobsTable } from '@/app/(admin)/jobs/jobs-table';
import { BackupFactorControls } from '@/app/(admin)/settings/backup-factor';
import { TicketsTable } from '@/app/(admin)/support/tickets-table';
import { PushTestPreview } from '@/app/(admin)/users/[id]/push-test-preview';
import { UserIdentity } from '@/app/(admin)/users/[id]/user-identity';
import { DataTable } from '@/components/data-table/data-table';
import { RouteMetaProvider } from '@/components/route-meta';
import { slotRoles } from '@/lib/ai-features';
import { moduleConfirmations } from '@/server/admin-contracts';
import { adminContext, axeViolations, renderWithProviders } from '@/test/render';

/*
 * Backoffice contract gaps (BACKOFFICE_PLAN §3.3, §5.3, §5.5, §6.4, §6.6, §6.8, §6.10, §6.12): row
 * selection and the live Jobs view, the masked identity with per-field reveals, ticket user links,
 * the AI feedback comment badge, the push-test quiet-hours preview and the backup MFA factor.
 */

const refresh = vi.fn();
const mutate = vi.hoisted(() => ({
  mutateAction: vi.fn(async () => ({ ok: true, data: { retried: 1, skipped: [] } })),
}));
const reveal = vi.hoisted(() => ({
  revealAction: vi.fn(async () => ({ ok: true, data: { value: 'Yusuf Demir', expires_in_s: 60 } })),
}));
const factors = vi.hoisted(() => ({
  startBackupFactorAction: vi.fn(async () => ({
    ok: true,
    data: { factorId: 'f2', qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: 'JBSWY3DP' },
  })),
  confirmBackupFactorAction: vi.fn(async () => ({ ok: true, data: { verified_factors: 2 } })),
}));
vi.mock('@/actions/mutate', () => mutate);
vi.mock('@/actions/reveal', () => reveal);
vi.mock('@/actions/mfa-factors', () => factors);
vi.mock('@/actions/preferences', () => ({
  saveTablePrefsAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(),
}));

const USER = '0190f5e0-1111-7000-8000-00000000abcd';
const REASON = 'Seçilen işler kesinti sonrası yeniden deneniyor';
const TS = '2026-09-24T08:00:00Z';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderAs(ui: ReactElement, permissions: string[]) {
  const view = renderWithProviders(
    <RouteMetaProvider value={moduleConfirmations()}>{ui}</RouteMetaProvider>,
    { admin: adminContext({ permissions: permissions as never }) },
  );
  return { ...view, user: userEvent.setup({ delay: null }) };
}

const job = (n: number, status: string) => ({
  id: `0190f5e0-4444-7000-8000-00000000000${String(n)}`,
  type: 'gmail_sync' as const,
  status: status as 'failed',
  attempts: 5,
  max_attempts: 5,
  last_error_code: 'UPSTREAM_TIMEOUT',
  run_after: TS,
  created_at: TS,
  correlation_id: null,
  user_id: null,
});

describe('DataTable row selection (§5.3)', () => {
  it('selects the selectable rows of the page from the header checkbox', async () => {
    const onChange = vi.fn();
    const rows = [
      { id: 'a', name: 'A', ok: true },
      { id: 'b', name: 'B', ok: false },
    ];
    const { user } = renderAs(
      <DataTable
        tableId="t"
        caption="Tablo"
        columns={[{ id: 'name', header: 'Ad', cell: (r: (typeof rows)[number]) => r.name }]}
        rows={rows}
        total={2}
        getRowId={(r) => r.id}
        selection={{
          selected: new Set(),
          onChange,
          isSelectable: (r) => r.ok,
          rowLabel: (r) => `${r.name} seç`,
          pageLabel: 'Bu sayfadakileri seç',
        }}
      />,
      [],
    );
    expect(screen.getByRole('checkbox', { name: 'B seç' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Bu sayfadakileri seç' }));
    expect(onChange).toHaveBeenCalledWith(new Set(['a']));
  });
});

describe('Jobs (§6.6)', () => {
  const data = {
    rows: [job(1, 'failed'), job(2, 'running')],
    total: 2,
    totalIsEstimate: false,
    status: 'ready' as const,
  };

  it('bulk-retries the selected failed jobs with a reason (L2)', async () => {
    const { user } = renderAs(
      <JobsTable data={data} deadOnly={false} listQuery={{ page: 1 }} canRetry />,
      ['jobs.read', 'jobs.retry'],
    );
    const boxes = screen.getAllByRole('checkbox', { name: '0190f5e0 işini seç' });
    expect(boxes[1]).toBeDisabled();
    const first = boxes[0];
    if (first === undefined) throw new Error('no job checkbox');
    await user.click(first);
    const bar = screen.getByTestId('jobs-selection');
    expect(within(bar).getByText('1 seçildi')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Seçilenleri tekrar dene…' }));
    const dialog = await screen.findByRole('dialog');
    expect(await axeViolations(dialog)).toEqual([]);
    await user.type(within(dialog).getByLabelText('Gerekçe'), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() => {
      expect(mutate.mutateAction).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'POST /jobs/retry-bulk',
          body: { job_ids: [job(1, 'failed').id] },
        }),
        expect.objectContaining({ reason: REASON }),
      );
    });
  });

  it('hides the selection without jobs.retry', () => {
    renderAs(<JobsTable data={data} deadOnly={false} listQuery={{ page: 1 }} canRetry={false} />, [
      'jobs.read',
    ]);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('polls /api/admin/jobs every 10 s while "Canlı (10 sn)" is on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        rows: [job(3, 'queued')],
        total: 1,
        total_is_estimate: false,
        server_time: TS,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { user } = renderAs(
      <JobsTable
        data={data}
        deadOnly={false}
        listQuery={{ page: 1, 'filter[status]': 'failed' }}
        canRetry={false}
      />,
      ['jobs.read'],
    );
    await user.click(screen.getByRole('button', { name: 'Canlı (10 sn)' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0]?.[0] as string).toBe(
      '/api/admin/jobs?page=1&filter%5Bstatus%5D=failed',
    );
    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(2);
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Canlı (10 sn)' }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('User identity (§5.5)', () => {
  it('shows the masked name and email, each with its own audited reveal', async () => {
    const { user } = renderAs(
      <UserIdentity userId={USER} emailMasked="yu***@gmail.com" nameMasked="Y*** D." />,
      ['users.read', 'users.pii.reveal'],
    );
    expect(screen.getByTestId('user-name')).toHaveTextContent('Y*** D.');
    expect(screen.getByTestId('user-email')).toHaveTextContent('yu***@gmail.com');
    await user.click(screen.getByRole('button', { name: /Ad/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Gerekçe'), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Göster' }));
    await waitFor(() => {
      expect(reveal.revealAction).toHaveBeenCalledWith(
        { route: 'POST /users/:id/reveal', id: USER, field: 'display_name' },
        expect.objectContaining({ reason: REASON }),
      );
    });
    expect(await screen.findByText('Yusuf Demir')).toBeInTheDocument();
  });

  it('offers no reveal without users.pii.reveal', () => {
    renderAs(<UserIdentity userId={USER} emailMasked="yu***@gmail.com" nameMasked={null} />, [
      'users.read',
    ]);
    expect(screen.queryByTestId('user-name')).toBeNull();
    expect(screen.queryByRole('button', { name: /Göster|göster/ })).toBeNull();
  });
});

describe('Support tickets and AI feedback rows', () => {
  it('links a matched ticket user by short id and marks web forms', () => {
    const row = {
      id: '0190f5e0-8282-7000-8000-000000000001',
      reference: 'DA-10240',
      category: 'sync' as const,
      status: 'open' as const,
      subject: 'Senkron',
      platform: 'ios' as const,
      app_version: '1.4.1',
      assignee: null,
      created_at: TS,
      contact_email_masked: 'yu***@gmail.com',
      user_id: USER,
    };
    renderAs(
      <TicketsTable
        data={{
          rows: [row, { ...row, id: row.id.replace('0001', '0002'), user_id: null }],
          total: 2,
          totalIsEstimate: false,
          status: 'ready',
        }}
      />,
      ['support.read'],
    );
    expect(screen.getByTestId(`ticket-user-${row.id}`)).toHaveAttribute(
      'href',
      `/users/${USER}/overview`,
    );
    expect(screen.getAllByText('Web formu · eşleşme yok').length).toBeGreaterThan(0);
  });

  it('shows "Yorum var · gizli" only when a comment exists', () => {
    const base = {
      feature: 'reply_draft' as const,
      model: 'm',
      prompt_version: '3',
      rating: -1 as const,
      reason_code: null,
      created_at: TS,
    };
    renderAs(
      <AiFeedbackTable
        data={{
          rows: [
            { ...base, id: '0190f5e0-1414-7000-8000-000000000001', has_comment: true },
            { ...base, id: '0190f5e0-1414-7000-8000-000000000002', has_comment: false },
          ],
          total: 2,
          totalIsEstimate: false,
          status: 'ready',
        }}
      />,
      ['ai_feedback.read', 'ai_feedback.reveal'],
    );
    expect(screen.getAllByText('Yorum var · gizli')).toHaveLength(1);
    expect(
      screen.getByTestId('feedback-no-comment-0190f5e0-1414-7000-8000-000000000002'),
    ).toHaveTextContent('Yorum yok');
  });
});

describe('Push test preview (§6.8, R-13)', () => {
  it('states the quiet-hours deferral with the local end time', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        timezone: 'Europe/Istanbul',
        local_time: '23:40',
        in_quiet_hours: true,
        quiet_hours_end_local: '08:00',
        deferred_until: TS,
        active_devices: 2,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAs(<PushTestPreview userId={USER} installationId={null} />, ['push.test']);
    expect(await screen.findByTestId('push-test-preview')).toHaveTextContent(
      'Kullanıcının yerel saati 23:40, sessiz saatler içinde. Test bildirimi sessiz saatler bittiğinde (08:00) gönderilecek.',
    );
    expect(fetchMock.mock.calls[0]?.[0] as string).toBe(
      `/api/admin/notifications/test-push/preview?user_id=${USER}`,
    );
  });

  it('says the push goes right away outside quiet hours, and fails honestly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          timezone: 'Europe/Istanbul',
          local_time: '14:05',
          in_quiet_hours: false,
          quiet_hours_end_local: null,
          deferred_until: null,
          active_devices: 1,
        }),
      ),
    );
    const view = renderAs(<PushTestPreview userId={USER} installationId="i1" />, ['push.test']);
    expect(await screen.findByTestId('push-test-preview')).toHaveTextContent(
      'Kullanıcının yerel saati 14:05 (Europe/Istanbul). Test bildirimi hemen gönderilir.',
    );
    view.unmount();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 502 })),
    );
    renderAs(<PushTestPreview userId={USER} installationId={null} />, ['push.test']);
    expect(await screen.findByText(/önizlemesi yüklenemedi/)).toBeInTheDocument();
  });
});

describe('Backup MFA factor (§3.3)', () => {
  it('adds a backup device: QR, code, confirmation', async () => {
    const { user } = renderAs(
      <BackupFactorControls factors={[{ id: 'f1', name: 'Birincil', createdAt: TS }]} />,
      [],
    );
    expect(screen.getByRole('button', { name: /Kaldır/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Yedek cihaz ekle' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yedek cihaz ekle' });
    expect(within(dialog).getByText('Kodu elle gir: JBSWY3DP')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Doğrulama kodu'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Doğrula' }));
    await waitFor(() => {
      expect(factors.confirmBackupFactorAction).toHaveBeenCalledWith({
        factorId: 'f2',
        code: '123456',
      });
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('stops at two devices and allows removal while another remains', () => {
    renderAs(
      <BackupFactorControls
        factors={[
          { id: 'f1', name: 'Birincil', createdAt: TS },
          { id: 'f2', name: null, createdAt: TS },
        ]}
      />,
      [],
    );
    expect(screen.queryByRole('button', { name: 'Yedek cihaz ekle' })).toBeNull();
    expect(screen.getByText('En fazla 2 kimlik doğrulayıcı eklenebilir.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Kaldır' })[0]).toBeEnabled();
    expect(screen.getByText('Cihaz 2')).toBeInTheDocument();
  });
});

describe('Model slots (§6.10)', () => {
  it('lists the M§57 slots plus the extra roles present in the rows', () => {
    expect(slotRoles([{ role: 'classifier' }])).toEqual([
      'classifier',
      'reasoning',
      'embedding',
      'stt',
      'tts',
    ]);
    expect(slotRoles([{ role: 'assistant' }, { role: 'probe' }]).slice(-2)).toEqual([
      'assistant',
      'probe',
    ]);
  });
});
