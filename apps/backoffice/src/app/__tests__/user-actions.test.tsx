/** @vitest-environment jsdom */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserActions } from '@/app/(admin)/users/[id]/user-actions';
import { RouteMetaProvider } from '@/components/route-meta';
import { confirmToken } from '@/lib/formatters';
import { moduleConfirmations } from '@/server/admin-contracts';
import { TR_MESSAGES, adminContext, renderWithProviders } from '@/test/render';

/*
 * "İşlemler" on the user detail (BACKOFFICE_PLAN §6.3; TEST_PLAN BO-USR): every item appears only
 * with its permission and opens its L2/L3 dialog (reason, typed confirmation for destructive and
 * content-access actions); nothing is sent before confirmation, and the body the dialog sends is
 * the one admin-api expects.
 */

const nav = vi.hoisted(() => ({ search: new URLSearchParams(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: nav.refresh }),
  usePathname: () => '/users/x/overview',
  useSearchParams: () => nav.search,
}));
const mutate = vi.hoisted(() => ({ mutateAction: vi.fn() }));
vi.mock('@/actions/mutate', () => mutate);

const USER = '0190f5e0-1111-7000-8000-00000000abcd';
const DEVICE = '0190f5e0-6666-7000-8000-000000000001';
const TICKET = '0190f5e0-8888-7000-8000-000000000001';
const REASON = 'Destek talebi DA-10240 için gerekli işlem';
const A = TR_MESSAGES.backoffice.userDetail.actions;
const C = TR_MESSAGES.backoffice.confirm;
/** "Onaylamak için <token> yaz" — the typed-confirmation label (rich text). */
const TYPED = /^Onaylamak için /;
const ALL = [
  'users.force_sync',
  'entitlements.grant',
  'subscriptions.resync',
  'push.test',
  'support.access',
  'users.mark_internal',
  'users.disable',
];

const devices = [
  {
    installation_id: DEVICE,
    platform: 'ios',
    app_version: '1.4.0',
    push_enabled: true,
    token_masked: 'ExponentPushToken[••••AB12]',
    last_seen_at: '2026-09-24T08:00:00Z',
  },
];
const tickets = [{ id: TICKET, reference: 'DA-10240', subject: 'Senkron durdu' }];

afterEach(() => {
  vi.clearAllMocks();
  nav.search = new URLSearchParams();
});

function renderActions(
  action: string | null,
  options: {
    status?: 'active' | 'disabled';
    permissions?: string[];
    devices?: typeof devices | null;
    hasActiveGrant?: boolean;
  } = {},
) {
  nav.search = new URLSearchParams(action === null ? '' : `action=${action}`);
  const view = renderWithProviders(
    <RouteMetaProvider value={moduleConfirmations()}>
      <UserActions
        userId={USER}
        status={options.status ?? 'active'}
        devices={(options.devices === undefined ? devices : options.devices) as never}
        tickets={tickets as never}
        hasActiveGrant={options.hasActiveGrant ?? false}
      />
    </RouteMetaProvider>,
    { admin: adminContext({ permissions: (options.permissions ?? ALL) as never }) },
  );
  return { ...view, user: userEvent.setup({ delay: null }) };
}

async function confirm(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  button: string,
  typed?: string,
) {
  const dialog = await screen.findByRole('dialog', { name: title });
  await user.type(within(dialog).getByLabelText(C.reason), REASON);
  if (typed !== undefined) await user.type(within(dialog).getByLabelText(TYPED), typed);
  // L3 routes ask for a fresh TOTP (step-up) when none is valid (§3.6).
  const stepUp = within(dialog).queryByLabelText(C.stepUp);
  if (stepUp !== null) await user.type(stepUp, '123456');
  await user.click(within(dialog).getByRole('button', { name: button }));
  return dialog;
}

function lastRequest() {
  return mutate.mutateAction.mock.calls.at(-1)?.[0] as {
    route: string;
    params?: object;
    body?: object;
  };
}

describe('UserActions', () => {
  it('renders nothing without any action permission', () => {
    renderActions(null, { permissions: ['users.read'] });
    expect(screen.queryByTestId('user-actions')).toBeNull();
  });

  it('lists only permitted items and sends "Geçici Pro" to the subscription tab', async () => {
    const { user } = renderActions(null, {
      permissions: ['entitlements.grant_limited', 'push.test'],
    });
    await user.click(screen.getByTestId('user-actions'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([A.grant.menu, A.pushTest.menu]);
    await user.click(within(menu).getByRole('menuitem', { name: A.grant.menu }));
    expect(nav.push).toHaveBeenCalledWith(`/users/${USER}/subscription?action=grant`);
  });

  it('force sync sends only the chosen resources and needs at least one', async () => {
    mutate.mutateAction.mockResolvedValue({ ok: true, data: { jobs: [{}, {}] } });
    const { user } = renderActions('force-sync');
    const dialog = await screen.findByRole('dialog', { name: A.forceSync.title });
    for (const name of ['E-posta', 'Takvim', 'Görevler']) {
      await user.click(within(dialog).getByRole('checkbox', { name }));
    }
    await user.type(within(dialog).getByLabelText(C.reason), REASON);
    await user.click(within(dialog).getByRole('button', { name: A.forceSync.confirm }));
    expect(await within(dialog).findByText(A.forceSync.noResource)).toBeInTheDocument();
    expect(mutate.mutateAction).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Takvim' }));
    await user.click(within(dialog).getByRole('button', { name: A.forceSync.confirm }));
    await waitFor(() => {
      expect(lastRequest()).toMatchObject({
        route: 'POST /users/:id/force-sync',
        params: { id: USER },
        body: { resources: ['calendar'] },
      });
    });
    expect(
      await screen.findByText('2 iş kuyruğa alındı.', { selector: 'div' }),
    ).toBeInTheDocument();
  });

  it('a push test targets one device and reports quiet-hours deferral', async () => {
    mutate.mutateAction.mockResolvedValue({
      ok: true,
      data: { deferred_until: '2026-09-24T20:00:00Z', id: 'x' },
    });
    const { user } = renderActions('push-test');
    const dialog = await screen.findByRole('dialog', { name: A.pushTest.title });
    await user.click(within(dialog).getByRole('radio', { name: /iOS · 1\.4\.0/ }));
    await user.type(within(dialog).getByLabelText(C.reason), REASON);
    await user.click(within(dialog).getByRole('button', { name: A.pushTest.confirm }));
    await waitFor(() => {
      expect(lastRequest()).toMatchObject({
        route: 'POST /notifications/test-push',
        body: { user_id: USER, installation_id: DEVICE },
      });
    });
    expect(await screen.findByText(/sessiz saatlerde/, { selector: 'div' })).toBeInTheDocument();
  });

  it('a push test without an active device is blocked; an unknown device list goes to all', async () => {
    const { unmount } = renderActions('push-test', { devices: [] });
    const dialog = await screen.findByRole('dialog', { name: A.pushTest.title });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(A.pushTest.noDevice);
    unmount();
    mutate.mutateAction.mockResolvedValue({ ok: true, data: { deferred_until: null, id: 'x' } });
    const second = renderActions('push-test', { devices: null });
    await confirm(second.user, A.pushTest.title, A.pushTest.confirm);
    await waitFor(() => {
      expect(lastRequest().body).toEqual({ user_id: USER });
    });
    expect(await screen.findByText(A.pushTest.queued, { selector: 'div' })).toBeInTheDocument();
  });

  it('support access needs the typed token and sends scopes, duration and ticket', async () => {
    mutate.mutateAction.mockResolvedValue({ ok: true, data: { id: 'grant' } });
    const { user } = renderActions('support-access');
    const dialog = await screen.findByRole('dialog', { name: A.supportAccess.title });
    await user.click(within(dialog).getByRole('radio', { name: '30 dk' }));
    await confirm(user, A.supportAccess.title, A.supportAccess.confirm, 'wrong');
    expect(await within(dialog).findByText(C.typedMismatch)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(TYPED));
    await user.type(within(dialog).getByLabelText(TYPED), confirmToken(USER));
    await user.click(within(dialog).getByRole('button', { name: A.supportAccess.confirm }));
    expect(mutate.mutateAction.mock.calls.at(-1)?.[1]).toMatchObject({ stepUpCode: '123456' });
    await waitFor(() => {
      expect(lastRequest()).toMatchObject({
        route: 'POST /support-access/grants',
        body: { user_id: USER, scopes: ['pii'], duration_minutes: 30, ticket_id: TICKET },
      });
    });
  });

  it('hides "Destek erişimi" while a grant is active', async () => {
    const { user } = renderActions(null, { hasActiveGrant: true });
    await user.click(screen.getByTestId('user-actions'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: A.supportAccess.menu })).toBeNull();
  });

  it('marks or unmarks the account as internal', async () => {
    mutate.mutateAction.mockResolvedValue({ ok: true, data: { internal: false } });
    const { user } = renderActions('internal');
    const dialog = await screen.findByRole('dialog', { name: A.internal.title });
    await user.click(within(dialog).getByRole('radio', { name: A.internal.unmark }));
    await confirm(user, A.internal.title, A.internal.confirm);
    await waitFor(() => {
      expect(lastRequest()).toMatchObject({
        route: 'POST /users/:id/internal',
        body: { internal: false },
      });
    });
    expect(await screen.findByText(A.internal.unmarked, { selector: 'div' })).toBeInTheDocument();
  });

  it.each([
    ['active', 'POST /users/:id/disable', A.disable],
    ['disabled', 'POST /users/:id/restore', A.restore],
  ] as const)('a %s account gets %s behind the typed token', async (status, route, copy) => {
    mutate.mutateAction.mockResolvedValue({ ok: true, data: { status: 'x' } });
    const { user } = renderActions('disable', { status });
    await confirm(user, copy.title, copy.confirm, confirmToken(USER));
    await waitFor(() => {
      expect(lastRequest()).toMatchObject({ route, params: { id: USER } });
    });
    expect(await screen.findByText(copy.done, { selector: 'div' })).toBeInTheDocument();
  });

  it('re-syncs the subscription', async () => {
    mutate.mutateAction.mockResolvedValue({ ok: true, data: { job: {} } });
    const { user } = renderActions('resync');
    await confirm(user, A.resync.title, A.resync.confirm);
    await waitFor(() => {
      expect(lastRequest()).toMatchObject({
        route: 'POST /subscriptions/:userId/sync',
        params: { userId: USER },
      });
    });
  });
});
