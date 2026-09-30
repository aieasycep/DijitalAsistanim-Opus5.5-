/** @vitest-environment jsdom */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeLoginStep } from '@/server/auth-flow';
import { NavigationSignal, request, router } from '@/test/next-stubs';
import { props, renderPage, textOf } from '@/test/page-harness';
import { TR_MESSAGES, renderWithProviders } from '@/test/render';

/*
 * Sign-in screens (BACKOFFICE_PLAN §3.2–§3.5; TEST_PLAN BO-AUTH): `/login` (reasons, the code step
 * from the sealed cookie, an expired step), `/mfa` (enrol, challenge, complete, unavailable, stale
 * factors), `/invite`, `/forbidden`, and the client flows over the actions (errors shown with
 * `role=alert`, recovery codes copy / download / confirm, recovery-code redemption).
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

vi.mock('next-intl/server', () => import('@/test/next-stubs'));
vi.mock('next/headers', () => import('@/test/next-stubs'));
vi.mock('next/navigation', () => import('@/test/next-stubs'));

const actions = vi.hoisted(() => ({
  requestCodeAction: vi.fn(),
  resendCodeAction: vi.fn(),
  verifyCodeAction: vi.fn(),
  verifyMfaAction: vi.fn(),
  retryRecoveryCodesAction: vi.fn(),
  redeemRecoveryCodeAction: vi.fn(),
  acceptInviteAction: vi.fn(),
}));
vi.mock('@/actions/auth', () => actions);

const mfa = vi.hoisted(() => ({
  getClaims: vi.fn(),
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
}));
vi.mock('@/server/supabase', () => ({
  serverSupabase: () =>
    Promise.resolve({
      auth: {
        getClaims: mfa.getClaims,
        mfa: { listFactors: mfa.listFactors, unenroll: mfa.unenroll, enroll: mfa.enroll },
      },
    }),
}));

const AUTH = TR_MESSAGES.backoffice.auth;
const FACTOR = '0190f5e0-0000-7000-8000-00000000f001';

beforeEach(() => {
  document.body.replaceChildren();
  request.cookies.clear();
  for (const fn of Object.values(actions)) fn.mockReset();
  for (const fn of Object.values(mfa)) fn.mockReset();
});

describe('/login', () => {
  it('shows the reason banner and the email form', async () => {
    const { default: LoginPage } = await import('@/app/(auth)/login/page');
    const root = await renderPage(await LoginPage(props({ reason: 'idle', next: '/jobs' })));
    expect(textOf(root.querySelector('h1'))).toBe(AUTH.title);
    expect(textOf(root.querySelector('[role="status"]'))).toBe(AUTH.reasons.idle);
    expect(root.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe('/jobs');
    expect(root.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('shows the code step with the masked address, or the expired notice without a step', async () => {
    const { default: LoginPage } = await import('@/app/(auth)/login/page');
    const expired = await renderPage(await LoginPage(props({ step: 'code' })));
    expect(textOf(expired.querySelector('[role="alert"]'))).toBe(AUTH.stepExpired);
    await writeLoginStep({
      email: 'ayse.operasyon@dijitalasistan.app',
      sentAt: Date.now(),
      next: '/dashboard',
    });
    const root = await renderPage(await LoginPage(props({ step: 'code' })));
    expect(root.querySelector('input[name="code"]')).not.toBeNull();
    expect(textOf(root)).not.toContain('ayse.operasyon@');
    expect(textOf(root)).toContain('@dijitalasistan.app');
  });

  it('EmailForm submits through the action and shows its error', async () => {
    actions.requestCodeAction.mockResolvedValue({
      status: 'error',
      messageKey: 'auth.unavailable',
    });
    const { EmailForm } = await import('@/app/(auth)/login/login-forms');
    renderWithProviders(<EmailForm next="/dashboard" />);
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText(AUTH.email), 'ops@dijitalasistan.app');
    await user.click(screen.getByRole('button', { name: AUTH.sendCode }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH.unavailable);
    const data = actions.requestCodeAction.mock.calls[0]?.[1] as FormData;
    expect(data.get('email')).toBe('ops@dijitalasistan.app');
    expect(screen.getByLabelText(AUTH.email)).toHaveAttribute('aria-invalid', 'true');
  });

  it('CodeForm verifies, counts down the resend and shows the resend notice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    actions.verifyCodeAction.mockResolvedValue({ status: 'error', messageKey: 'auth.codeInvalid' });
    actions.resendCodeAction.mockResolvedValue({
      status: 'notice',
      messageKey: 'auth.resendIn',
      values: { seconds: 5 },
    });
    const { CodeForm } = await import('@/app/(auth)/login/login-forms');
    renderWithProviders(
      <CodeForm maskedEmail="o***@dijitalasistan.app" resendAt={Date.now() + 2_000} />,
    );
    const resend = screen.getByRole('button', { name: AUTH.resend });
    expect(resend).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: AUTH.resend })).toBeEnabled();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText(AUTH.code), '123456');
    await user.click(screen.getByRole('button', { name: AUTH.verify }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH.codeInvalid);
    await user.click(screen.getByRole('button', { name: AUTH.resend }));
    await waitFor(() => {
      expect(actions.resendCodeAction).toHaveBeenCalled();
    });
    vi.useRealTimers();
  });
});

describe('/mfa', () => {
  async function mfaPage(query: Record<string, string> = {}) {
    const { default: MfaPage } = await import('@/app/(auth)/mfa/page');
    return MfaPage(props(query));
  }

  it('sends a visitor without a session back to /login', async () => {
    mfa.getClaims.mockResolvedValue({ data: null });
    await expect(mfaPage()).rejects.toMatchObject({ kind: 'redirect', location: '/login' });
  });

  it('challenges a verified factor at aal1 and completes at aal2', async () => {
    mfa.getClaims.mockResolvedValue({ data: { claims: { aal: 'aal1' } } });
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: FACTOR }], all: [] }, error: null });
    const root = await renderPage(await mfaPage({ next: '/audit' }));
    expect(textOf(root.querySelector('h1'))).toBe(AUTH.mfaTitle);
    expect(root.querySelector<HTMLInputElement>('input[name="factorId"]')?.value).toBe(FACTOR);
    expect(root.querySelector<HTMLInputElement>('input[name="mode"]')?.value).toBe('challenge');
    mfa.getClaims.mockResolvedValue({ data: { claims: { aal: 'aal2' } } });
    const done = await renderPage(await mfaPage());
    expect(done.querySelector('form')).toBeNull();
  });

  it('removes stale factors and enrols a new TOTP with its QR code', async () => {
    mfa.getClaims.mockResolvedValue({ data: { claims: { aal: 'aal1' } } });
    mfa.listFactors.mockResolvedValue({
      data: { totp: [], all: [{ id: 'stale', factor_type: 'totp', status: 'unverified' }] },
      error: null,
    });
    mfa.enroll.mockResolvedValue({
      data: {
        id: FACTOR,
        totp: { qr_code: 'data:image/svg+xml;base64,PHN2Zy8+', secret: 'JBSWY3DP' },
      },
      error: null,
    });
    const root = await renderPage(await mfaPage({ recovered: '1' }));
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'stale' });
    expect(textOf(root.querySelector('h1'))).toBe(AUTH.mfaEnrollTitle);
    expect(root.querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml');
    expect(textOf(root)).toContain('JBSWY3DP');
    expect(textOf(root)).toContain(AUTH.recovery.used);
  });

  it('shows the unavailable notice when Auth cannot list or enrol factors', async () => {
    mfa.getClaims.mockResolvedValue({ data: { claims: { aal: 'aal1' } } });
    mfa.listFactors.mockResolvedValue({ data: null, error: { status: 500 } });
    expect(textOf(await renderPage(await mfaPage()))).toContain(AUTH.unavailable);
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
    mfa.enroll.mockResolvedValue({ data: null, error: { status: 500 } });
    expect(textOf(await renderPage(await mfaPage()))).toContain(AUTH.unavailable);
  });
});

describe('MfaFlow (client)', () => {
  async function flow(mode: 'challenge' | 'enroll' = 'challenge') {
    const { MfaFlow } = await import('@/app/(auth)/mfa/mfa-forms');
    const view =
      mode === 'challenge'
        ? renderWithProviders(<MfaFlow mode="challenge" factorId={FACTOR} next="/audit" />)
        : renderWithProviders(
            <MfaFlow
              mode="enroll"
              factorId={FACTOR}
              qrCode="data:image/svg+xml;base64,PHN2Zy8+"
              secret="JBSWY3DP"
              next="/audit"
              recovered={false}
            />,
          );
    return { ...view, user: userEvent.setup({ delay: null }) };
  }

  it('shows the recovery codes after enrolment; continue needs the saved confirmation', async () => {
    actions.verifyMfaAction.mockResolvedValue({
      status: 'codes',
      codes: ['AAAA-BBBB-CC', 'DDDD-EEEE-FF'],
      next: '/audit',
    });
    const push = vi.spyOn(router, 'push');
    const createObjectURL = vi.fn(() => 'blob:codes');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { user } = await flow('enroll');
    await user.type(screen.getByLabelText(AUTH.mfaCode), '654321');
    await user.click(screen.getByRole('button', { name: AUTH.verify }));
    const list = await screen.findByRole('list', { name: AUTH.codes.listLabel });
    expect(list).toHaveTextContent('AAAA-BBBB-CC');
    await user.click(screen.getByRole('button', { name: AUTH.codes.copy }));
    expect(await navigator.clipboard.readText()).toBe('AAAA-BBBB-CC\nDDDD-EEEE-FF');
    expect(await screen.findByText(AUTH.codes.copied)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: AUTH.codes.download }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    const next = screen.getByRole('button', { name: AUTH.codes.continue });
    expect(next).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: AUTH.codes.saved }));
    await user.click(next);
    expect(push).toHaveBeenCalledWith('/audit');
  });

  it('offers a retry when issuing the codes failed', async () => {
    actions.verifyMfaAction.mockResolvedValue({ status: 'error', messageKey: 'auth.codes.failed' });
    actions.retryRecoveryCodesAction.mockResolvedValue({
      status: 'codes',
      codes: ['AAAA-BBBB-CC'],
      next: '/audit',
    });
    const { user } = await flow();
    await user.type(screen.getByLabelText(AUTH.mfaCode), '654321');
    await user.click(screen.getByRole('button', { name: AUTH.verify }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH.codes.failed);
    await user.click(screen.getByRole('button', { name: AUTH.codes.retry }));
    expect(await screen.findByRole('list', { name: AUTH.codes.listLabel })).toHaveTextContent(
      'AAAA-BBBB-CC',
    );
  });

  it('switches to recovery-code redemption and back', async () => {
    actions.redeemRecoveryCodeAction.mockResolvedValue({
      status: 'error',
      messageKey: 'auth.recovery.invalid',
    });
    const { user } = await flow();
    await user.click(screen.getByRole('button', { name: AUTH.mfaLost }));
    expect(screen.getByRole('heading', { name: AUTH.recovery.title })).toBeInTheDocument();
    await user.type(screen.getByLabelText(AUTH.recovery.label), 'AAAA-BBBB-CC');
    await user.click(screen.getByRole('button', { name: AUTH.recovery.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH.recovery.invalid);
    await user.click(screen.getByRole('button', { name: AUTH.recovery.back }));
    expect(screen.getByRole('heading', { name: AUTH.mfaTitle })).toBeInTheDocument();
  });

  it('redirects a completed session and reports an unavailable service', async () => {
    const replace = vi.spyOn(router, 'replace');
    const { MfaFlow } = await import('@/app/(auth)/mfa/mfa-forms');
    const view = renderWithProviders(<MfaFlow mode="complete" next="/flags" />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/flags');
    });
    view.unmount();
    renderWithProviders(<MfaFlow mode="unavailable" next="/flags" />);
    expect(screen.getByRole('alert')).toHaveTextContent(AUTH.unavailable);
  });
});

describe('/invite, /forbidden, / and the auth layout', () => {
  it('renders the button-only invitation page for a well-formed token only', async () => {
    const { default: InvitePage } = await import('@/app/(auth)/invite/page');
    const ok = await renderPage(await InvitePage(props({ token: 'A'.repeat(43) })));
    expect(textOf(ok.querySelector('h1'))).toBe(AUTH.invite.title);
    expect(ok.querySelector<HTMLInputElement>('input[name="token"]')?.value).toBe('A'.repeat(43));
    const bad = await renderPage(await InvitePage(props({ token: 'x' })));
    expect(bad.querySelector('input[name="token"]')).toBeNull();
    expect(textOf(bad)).toContain(AUTH.invite.invalid);
  });

  it('InviteForm submits the token and shows an expired invitation', async () => {
    actions.acceptInviteAction.mockResolvedValue({
      status: 'error',
      messageKey: 'auth.invite.expired',
    });
    const { InviteForm } = await import('@/app/(auth)/invite/invite-form');
    renderWithProviders(<InviteForm token={'A'.repeat(43)} />);
    fireEvent.click(screen.getByRole('button', { name: AUTH.invite.accept }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH.invite.expired);
    expect((actions.acceptInviteAction.mock.calls[0]?.[1] as FormData).get('token')).toBe(
      'A'.repeat(43),
    );
  });

  it('forbidden page links back to the dashboard; / redirects there', async () => {
    const { default: ForbiddenPage } = await import('@/app/(auth)/forbidden/page');
    const root = await renderPage(await ForbiddenPage());
    expect(root.querySelector('a[href="/dashboard"]')).not.toBeNull();
    const { default: Home } = await import('@/app/page');
    expect(() => Home()).toThrow(NavigationSignal);
    const { default: AuthLayout } = await import('@/app/(auth)/layout');
    const shell = await renderPage(await AuthLayout({ children: <p>kart</p> }));
    expect(textOf(shell.querySelector('main'))).toContain(TR_MESSAGES.backoffice.app.name);
    expect(textOf(shell.querySelector('main'))).toContain('kart');
  });

  it('metadata titles come from the catalog', async () => {
    const login = await import('@/app/(auth)/login/page');
    const mfaMod = await import('@/app/(auth)/mfa/page');
    const invite = await import('@/app/(auth)/invite/page');
    expect((await login.generateMetadata()).title).toBe(AUTH.title);
    expect((await mfaMod.generateMetadata()).title).toBe(AUTH.mfaTitle);
    expect((await invite.generateMetadata()).title).toBe(AUTH.invite.title);
  });
});
