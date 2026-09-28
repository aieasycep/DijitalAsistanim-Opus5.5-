/**
 * Logic modules behind the screens (TEST_PLAN §16 mobile 75/65/75): the connect-outcome presenter
 * (M-ON-06 / M-SET-11 errors, `integration_connect_result`), the provider handoff helpers
 * (allow-listed https, tel/maps/calendar URLs) and the approval decision flows (M-APPR-01: offline
 * block, scope upgrade via API-INT-02 with `resume.approval_id`, error → toast, SREQ-45 outcome
 * toasts). Toasts, sheets, analytics and the API layer are observed through their module seams.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiError } from '@da/api-client';
import { onlineManager } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

import {
  calendarDayUrl,
  gmailUrl,
  isAllowedHttps,
  isHttpsUrl,
  isJoinableMeetingUrl,
  mailProviderUrl,
  mapsUrl,
  openInBrowser,
  openWithOs,
  telUrl,
} from '../src/features/actions/handoff';
import * as ApprovalApi from '../src/features/approvals/api';
import {
  approveNow,
  blockOffline,
  handleDecisionError,
  rejectNow,
  toastOutcome,
  upgradeScope,
} from '../src/features/approvals/decide';
import { fromApprovalView, type ApprovalModel } from '../src/features/approvals/model';
import * as Connect from '../src/features/integrations/connect';
import { presentConnectOutcome, type OutcomeContext } from '../src/features/integrations/present';
import * as ProGate from '../src/features/pro-gate/ProGate';
import { bufferedEventsForTests, resetAnalyticsForTests } from '../src/lib/events';
import { sheets } from '../src/providers/SheetHost';
import * as ToastHost from '../src/providers/ToastHost';
import { approvalView } from './helpers/assist';

const toasts = () =>
  (ToastHost.showToast as jest.MockedFunction<typeof ToastHost.showToast>).mock.calls.map(
    ([toast]) => toast,
  );
const events = (name: string) =>
  bufferedEventsForTests()
    .filter((e) => e.event === name)
    .map((e) => e.props);

beforeEach(() => {
  jest.restoreAllMocks();
  resetAnalyticsForTests();
  jest.spyOn(ToastHost, 'showToast').mockImplementation(() => undefined);
  jest.spyOn(ProGate, 'openProGate').mockImplementation(() => undefined);
  onlineManager.setOnline(true);
});

describe('presentConnectOutcome (M-ON-06 / M-SET-11)', () => {
  const settings: OutcomeContext = {
    provider: 'google',
    capability: 'mail_read',
    returnTo: 'settings_accounts',
  };
  const onboarding: OutcomeContext = {
    provider: 'microsoft',
    capability: 'calendar_read',
    returnTo: 'onboarding',
  };
  const completed = (result: string) =>
    ({ kind: 'completed', result, accountId: null, missing: [], resumeApprovalId: null }) as never;

  it.each([
    ['success', 'success', 0],
    ['partial', 'partial', 1],
    ['account_mismatch', 'error', 1],
    ['already_linked', 'error', 1],
  ])('completed %s → %s', (result, expected, toastCount) => {
    expect(presentConnectOutcome(completed(result), settings)).toBe(expected);
    expect(toasts()).toHaveLength(toastCount);
  });

  it('a plan limit opens the multi-account Pro gate', () => {
    expect(presentConnectOutcome(completed('plan_limit'), settings)).toBe('pro_required');
    expect(ProGate.openProGate).toHaveBeenCalledWith('multi_account');
  });

  it('a calendar partial grant uses the generic copy; cancel and onboarding denial stay silent', () => {
    presentConnectOutcome(completed('partial'), onboarding);
    expect(presentConnectOutcome({ kind: 'already_granted' }, settings)).toBe('success');
    expect(presentConnectOutcome({ kind: 'cancelled' }, settings)).toBe('cancelled');
    expect(presentConnectOutcome({ kind: 'denied' }, onboarding)).toBe('cancelled');
    expect(toasts()).toHaveLength(1);
    expect(presentConnectOutcome({ kind: 'denied' }, settings)).toBe('cancelled');
    expect(toasts()).toHaveLength(2);
  });

  it('admin consent opens its sheet with the tenant URL', () => {
    const open = jest.spyOn(sheets, 'open').mockReturnValue('sheet');
    const url = 'https://login.microsoftonline.com/common/adminconsent?client_id=x';
    expect(
      presentConnectOutcome({ kind: 'admin_consent_required', adminConsentUrl: url }, onboarding),
    ).toBe('admin_consent_required');
    expect(open).toHaveBeenCalledWith(expect.any(String), { url });
  });

  it.each([
    [{ kind: 'failed', reason: 'error', code: 'EXTERNAL_CREDENTIAL_REQUIRED' }, 'not_configured'],
    [{ kind: 'failed', reason: 'error', code: 'CONDITIONAL_ACCESS' }, 'error'],
    [{ kind: 'failed', reason: 'expired_state', code: null }, 'error'],
    [{ kind: 'failed', reason: 'error', code: null }, 'error'],
    [{ kind: 'rejected' }, 'error'],
    [{ kind: 'no_pending' }, 'error'],
  ])('failure %o → %s with an error toast', (outcome, expected) => {
    expect(presentConnectOutcome(outcome as never, settings)).toBe(expected);
    expect(toasts()[0]).toMatchObject({ kind: 'error' });
  });

  it.each([
    [
      new ApiError({
        code: 'ENTITLEMENT_REQUIRED',
        kind: 'server',
        status: 402,
        details: { feature: 'multi_account' },
      }),
      'pro_required',
    ],
    [
      new ApiError({ code: 'EXTERNAL_CREDENTIAL_REQUIRED', kind: 'server', status: 503 }),
      'not_configured',
    ],
    [new ApiError({ code: 'OFFLINE_BLOCKED', kind: 'network', status: null }), 'error'],
    [new Error('boom'), 'error'],
  ])('start failure %# is mapped and tracked', (error, expected) => {
    expect(presentConnectOutcome({ kind: 'start_failed', error } as never, settings)).toBe(
      expected,
    );
    expect(events('integration_connect_result').at(-1)).toEqual({
      provider: 'google',
      capability: 'mail_read',
      result: expected,
    });
  });
});

describe('provider handoff (M-MAIL-04, M-EVT-01)', () => {
  it('accepts only allow-listed https hosts without credentials', () => {
    const hosts = ['outlook.office.com', '*.sharepoint.com'];
    expect(isAllowedHttps('https://outlook.office.com/mail/x', hosts)).toBe(true);
    expect(isAllowedHttps('https://acme.sharepoint.com/doc', hosts)).toBe(true);
    expect(isAllowedHttps('http://outlook.office.com/', hosts)).toBe(false);
    expect(isAllowedHttps('https://user:pw@outlook.office.com/', hosts)).toBe(false);
    expect(isAllowedHttps('https://evil.example/', hosts)).toBe(false);
    expect(isAllowedHttps(null, hosts)).toBe(false);
    expect(isAllowedHttps('', hosts)).toBe(false);
    expect(isHttpsUrl('https://track.example/1')).toBe(true);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
    expect(isJoinableMeetingUrl('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(isJoinableMeetingUrl('https://example.com/meet')).toBe(false);
    expect(isJoinableMeetingUrl(null)).toBe(false);
  });

  it('opens https pages in the in-app browser and hands other URLs to the OS', async () => {
    const browse = jest
      .spyOn(WebBrowser, 'openBrowserAsync')
      .mockResolvedValue({ type: 'opened' } as never);
    expect(await openInBrowser('https://example.com/')).toBe(true);
    expect(await openInBrowser('http://example.com/')).toBe(false);
    browse.mockRejectedValueOnce(new Error('no browser'));
    expect(await openInBrowser('https://example.com/')).toBe(false);
    const can = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    expect(await openWithOs('tel:+905551112233')).toBe(true);
    can.mockResolvedValueOnce(false);
    expect(await openWithOs('geo:0,0?q=x')).toBe(false);
    can.mockRejectedValueOnce(new Error('x'));
    expect(await openWithOs('geo:0,0?q=x')).toBe(false);
  });

  it('builds dial, maps, mail and calendar URLs', () => {
    expect(telUrl('+90 (555) 111 22 33')).toBe('tel:+905551112233');
    expect(telUrl('12')).toBeNull();
    expect(telUrl(null)).toBeNull();
    expect(mapsUrl(' Kadıköy ')).toBe(
      Platform.OS === 'ios'
        ? 'https://maps.apple.com/?q=Kad%C4%B1k%C3%B6y'
        : 'geo:0,0?q=Kad%C4%B1k%C3%B6y',
    );
    expect(gmailUrl(null, null)).toBe('https://mail.google.com/mail/');
    expect(gmailUrl('a@b.co', 't1')).toBe('https://mail.google.com/mail/?authuser=a%40b.co#all/t1');
    const input = {
      webLink: 'https://outlook.office.com/mail/1',
      accountEmail: 'a@b.co',
      providerThreadId: null,
    };
    expect(mailProviderUrl({ ...input, provider: 'microsoft' })).toBe(
      'https://outlook.office.com/mail/1',
    );
    expect(
      mailProviderUrl({ ...input, provider: 'microsoft', webLink: 'https://evil.example' }),
    ).toBeNull();
    expect(mailProviderUrl({ ...input, provider: 'google' })).toContain('mail.google.com');
    expect(mailProviderUrl({ ...input, provider: 'demo' })).toBeNull();
    const start = '2026-09-24T07:00:00Z';
    expect(calendarDayUrl('google', start, '2026-09-24')).toBe(
      'https://calendar.google.com/calendar/r/day/2026/9/24',
    );
    expect(calendarDayUrl('microsoft', start, '2026-09-24')).toContain('outlook.office.com');
    expect(calendarDayUrl('demo', start, '2026-09-24')).toBeNull();
    const apple = calendarDayUrl('apple_device', start, '2026-09-24');
    const android = calendarDayUrl('android_device', start, '2026-09-24');
    expect(Platform.OS === 'ios' ? apple : android).toMatch(/^(calshow:|content:)/);
    expect(Platform.OS === 'ios' ? android : apple).toBeNull();
  });
});

describe('approval decisions (M-APPR-01, SREQ-45)', () => {
  function model(overrides: Record<string, unknown> = {}): ApprovalModel {
    return { ...fromApprovalView(approvalView() as never), ...overrides };
  }

  it('blocks decisions offline without calling the API', async () => {
    const approve = jest.spyOn(ApprovalApi, 'approve');
    onlineManager.setOnline(false);
    expect(await approveNow(model(), 'approval_center')).toBe(false);
    expect(await rejectNow(model(), 'user_reject', 'approval_center')).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect(events('offline_blocked_action')).toEqual([{ action: 'approve' }, { action: 'reject' }]);
    blockOffline('approve');
    expect(toasts().every((t) => t.kind === 'offline')).toBe(true);
  });

  it('approves, tracks the decision and a retry of a failed approval', async () => {
    jest.spyOn(ApprovalApi, 'approve').mockResolvedValue({ ok: true } as never);
    expect(await approveNow(model({ status: 'failed' }), 'approval_center')).toBe(true);
    expect(events('approval_decided')[0]).toMatchObject({
      decision: 'approved',
      via: 'approval_center',
    });
    expect(events('approval_retry')).toHaveLength(1);
  });

  it('routes a scope-gated approval through the upgrade flow instead of approving', async () => {
    const start = jest.spyOn(Connect, 'startUpgrade').mockResolvedValue(undefined as never);
    const approve = jest.spyOn(ApprovalApi, 'approve');
    const gated = model({
      scopeState: 'upgrade_required',
      upgradeAccountId: 'acc-1',
      upgradeCapability: 'calendar_write',
    });
    expect(await approveNow(gated, 'approval_center')).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    await upgradeScope('apr-1', 'acc-1', 'calendar_write', 'microsoft');
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        provider: 'microsoft',
        capability: 'calendar_write',
        resumeApprovalId: 'apr-1',
      }),
    );
    expect(events('scope_upgrade_view')).toEqual([
      { capability: 'calendar_write', provider: 'microsoft' },
    ]);
    await upgradeScope(null, 'acc-1', 'mail_send', 'google');
    expect(start.mock.calls.at(-1)?.[0]).not.toHaveProperty('resumeApprovalId');
  });

  it.each([
    [{ kind: 'offline' }, 'offline'],
    [{ kind: 'conflict', expired: true }, 'neutral'],
    [{ kind: 'conflict', expired: false }, 'neutral'],
    [{ kind: 'not_found' }, 'error'],
    [{ kind: 'failed' }, 'error'],
  ])('maps decision error %o to a %s toast', (error, kind) => {
    jest.spyOn(ApprovalApi, 'invalidateApprovals').mockImplementation(() => undefined);
    handleDecisionError('apr-1', error as never);
    expect(toasts().at(-1)?.kind).toBe(kind);
  });

  it('opens the Pro gate for entitlement errors', () => {
    handleDecisionError('apr-1', { kind: 'entitlement', feature: 'advanced_planning' } as never);
    handleDecisionError('apr-1', { kind: 'entitlement', feature: 'universal_capture' } as never);
    expect((ProGate.openProGate as jest.Mock).mock.calls).toEqual([
      ['advanced_planning'],
      ['capture'],
    ]);
  });

  it('a failed approve or reject shows the mapped error', async () => {
    jest
      .spyOn(ApprovalApi, 'approve')
      .mockResolvedValue({ ok: false, error: { kind: 'failed' } } as never);
    jest
      .spyOn(ApprovalApi, 'reject')
      .mockResolvedValue({ ok: false, error: { kind: 'failed' } } as never);
    expect(await approveNow(model(), 'approval_center')).toBe(false);
    expect(await rejectNow(model(), 'user_cancel', 'approval_center')).toBe(false);
    expect(toasts().map((t) => t.kind)).toEqual(['error', 'error']);
  });

  it('rejects with the learning toast only for user_reject', async () => {
    jest.spyOn(ApprovalApi, 'reject').mockResolvedValue({ ok: true } as never);
    expect(await rejectNow(model({ origin: 'assistant' }), 'user_reject', 'approval_center')).toBe(
      true,
    );
    expect(await rejectNow(model(), 'user_cancel', 'approval_center')).toBe(true);
    expect(events('approval_decided').map((e) => e.decision)).toEqual(['rejected', 'cancelled']);
    expect(toasts()).toHaveLength(1);
  });

  it('summarises outcomes: executed copy only after execution, batch summaries otherwise', () => {
    toastOutcome([model({ status: 'executed' })]);
    toastOutcome([model({ status: 'executed' }), model({ status: 'failed' })]);
    toastOutcome([model({ status: 'executed' }), model({ status: 'executed' })]);
    toastOutcome([model({ status: 'rejected' })]);
    expect(toasts().map((t) => t.kind)).toEqual(['success', 'error', 'success']);
  });
});
