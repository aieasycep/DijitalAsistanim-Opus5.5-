/**
 * T-8.06 onboarding (SCREEN_AND_FLOW_MAP M-ON-01…15) on the real routes: intro pager and its
 * redirect routes, the post-auth steps in the M§34 / C-01 order with resume, the connect-mail
 * explainer → OAuth → client-bound completion (R-07), skip/gating (C-17), personalization,
 * schedule rules, the VIP gate and Pro list, First Analysis progress (R-19 polling), Aha, the
 * notification step and the completion handoff.
 */
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { nextStep } from '../src/features/onboarding/steps';
import { DEFAULT_TIMES, roundToFive, validateTime } from '../src/features/onboarding/schedule';
import { getOnboardingState, updateOnboardingState } from '../src/features/onboarding/store';
import { installApi, installFakeSupabase, json, renderApp, resetAppState } from './helpers/app';
import { errorBody, googleAccount, ok, uuid } from './helpers/fixtures';
import {
  ID,
  appRouter,
  events,
  onboardingBootstrap,
  openApp,
  proBootstrap,
} from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const CODE = 'C'.repeat(43);

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.account,
    provider: 'google',
    account_email: 'ahmet@example.com',
    display_label: null,
    status: 'healthy',
    status_reason: null,
    capabilities_granted: ['mail_read'],
    granted_scopes: [],
    data_source_toggles: googleAccount.data_sources,
    last_sync_at: '2026-09-24T07:40:00Z',
    last_error_code: null,
    updated_at: '2026-09-24T07:40:00Z',
    created_at: '2026-09-24T07:00:00Z',
    ...overrides,
  };
}

beforeEach(async () => {
  await resetAppState();
  jest.mocked(WebBrowser.openAuthSessionAsync).mockClear();
});

describe('steps (C-01 order, C-17 zero-source path)', () => {
  it('follows the M§34 order and skips VIP, analysis and Aha without sources', () => {
    const ctx = { skippedAllSources: false, hasMail: true, platform: 'ios' as const };
    expect(nextStep('connect_mail', ctx)).toBe('connect_calendar');
    expect(nextStep('briefing_schedule', ctx)).toBe('vip');
    expect(nextStep('vip', ctx)).toBe('analysis');
    expect(nextStep('ready', ctx)).toBe('notifications');
    expect(nextStep('notifications', ctx)).toBe('done');
    expect(nextStep('notifications', { ...ctx, platform: 'android' })).toBe(
      'android_notifications',
    );
    const none = { ...ctx, skippedAllSources: true, hasMail: false };
    expect(nextStep('briefing_schedule', none)).toBe('notifications');
    expect(nextStep('briefing_schedule', { ...ctx, hasMail: false })).toBe('analysis');
  });

  it('validates briefing times: ranges, 60-minute order and the 5-minute grid', () => {
    expect(validateTime('morning', '08:30', DEFAULT_TIMES)).toBeNull();
    expect(validateTime('morning', '04:55', DEFAULT_TIMES)).toEqual({
      kind: 'range',
      field: 'morning',
    });
    expect(validateTime('midday', '12:30', { ...DEFAULT_TIMES, morning: '11:55' })).toEqual({
      kind: 'order',
      first: 'morning',
      second: 'midday',
    });
    expect(validateTime('evening', '16:30', { ...DEFAULT_TIMES, midday: '15:55' })).toEqual({
      kind: 'order',
      first: 'midday',
      second: 'evening',
    });
    expect(validateTime('weekend', '12:05', DEFAULT_TIMES)).toEqual({
      kind: 'range',
      field: 'weekend',
    });
    expect(roundToFive('08:02')).toBe('08:00');
    expect(roundToFive('08:03')).toBe('08:05');
  });
});

describe('intro pager (M-ON-01…04)', () => {
  it('opens the welcome page for a first launch and pages with "Başlayalım"', async () => {
    installFakeSupabase(null);
    installApi({});
    const { router } = await renderApp('/');
    expect(await screen.findByText('Başlayalım')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
    expect(screen.getByLabelText('Tanıtım, sayfa 1 / 4')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('intro.start'));
    expect(await screen.findByLabelText('Tanıtım, sayfa 2 / 4')).toBeOnTheScreen();
    expect(screen.getByLabelText('Örnek: 127 mail 3 önemli konuya iner.')).toBeOnTheScreen();
    expect(events('onboarding_step_viewed').map((e) => e.props.step)).toEqual(['welcome', 'noise']);
    await fireEvent.press(screen.getByTestId('intro.skip'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/sign-in');
    });
    expect(events('onboarding_skipped').at(-1)?.props).toEqual({ step: 'noise' });
  });

  it('keeps the plan §9 intro paths as redirects to their page', async () => {
    installFakeSupabase(null);
    installApi({});
    const { router } = await renderApp('/');
    await screen.findByTestId('intro.pager');
    await act(async () => {
      appRouter.replace('/control');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(router.getPathname()).toBe('/welcome');
    });
    expect(await screen.findByLabelText('Tanıtım, sayfa 4 / 4')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Hesap Oluştur' })).toBeOnTheScreen();
  });
});

describe('connect mail (M-ON-06) and the OAuth return (R-07)', () => {
  it('resumes at connect-mail, gates "Devam" on a connected mail and offers "Şimdilik geç"', async () => {
    const { db } = await openApp({
      data: onboardingBootstrap('connect_mail', { accounts: [] }),
      landing: '/connect-mail',
    });
    expect(await screen.findByText('Dijital hayatını bağla.')).toBeOnTheScreen();
    expect(await screen.findByLabelText(/^Gmail, Bağla/)).toBeOnTheScreen();
    expect(screen.getByTestId('connectMail.continue')).toBeDisabled();
    expect(db.writes.find((w) => w.table === 'profiles')?.values).toEqual({
      onboarding_step: 'connect_mail',
    });
    await fireEvent.press(screen.getByTestId('connectMail.skip'));
    expect(await screen.findByText('Takvimini bağla.')).toBeOnTheScreen();
    expect(events('onboarding_skipped').at(-1)?.props).toEqual({ step: 'connect_mail' });
  });

  it('maps connected_accounts status to the row pill', async () => {
    await openApp({
      data: onboardingBootstrap('connect_mail'),
      landing: '/connect-mail',
      setup: (db) => {
        db.setTable('connected_accounts', [
          accountRow(),
          accountRow({
            id: uuid(11),
            provider: 'microsoft',
            status: 'needs_reauth',
            account_email: 'a@corp.example',
          }),
        ]);
      },
    });
    expect(
      await screen.findByLabelText(/^Gmail, ahmet@example.com · İlk analiz bekliyor, Bağlandı/),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Outlook, .*Yenile/)).toBeOnTheScreen();
    expect(screen.getByTestId('connectMail.continue')).toBeEnabled();
  });

  it('connects Gmail: explainer → start with the nonce hash → auth session → completion with the nonce', async () => {
    const stateId = uuid(33);
    const { api } = await openApp({
      data: onboardingBootstrap('connect_mail', { accounts: [] }),
      landing: '/connect-mail',
      routes: {
        'POST /integrations/google/start': () =>
          json(
            200,
            ok({
              state_id: stateId,
              auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x',
              state_expires_at: '2026-09-24T08:10:00Z',
              callback_url: 'dijitalasistan://integrations/callback',
              requested_scopes: ['gmail.readonly'],
            }),
          ),
        'POST /integrations/oauth/complete': () =>
          json(
            200,
            ok({
              result: 'success',
              account: { ...googleAccount, capabilities_granted: ['mail_read'] },
              granted: ['mail_read'],
              missing: [],
              resume: null,
              jobs: [],
            }),
          ),
      },
    });
    jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementationOnce(async () => {
      // The pending entry exists while the browser is open.
      const raw = await SecureStore.getItemAsync('da.oauth.pending');
      expect(raw).not.toBeNull();
      return {
        type: 'success',
        url: `dijitalasistan-dev://integrations/callback?result=pending_confirmation&provider=google&state_id=${stateId}&completion_code=${CODE}`,
      };
    });
    await fireEvent.press(await screen.findByTestId('connectMail.row.google'));
    expect(await screen.findByText('Mail erişimine neden ihtiyacımız var?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Google ile Bağlan' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/integrations/oauth/complete'))).toBe(true);
    });
    const start = api.calls.find((c) => c.url.endsWith('/integrations/google/start'));
    const complete = api.calls.find((c) => c.url.endsWith('/integrations/oauth/complete'));
    const startBody = start?.body as { capabilities: string[]; device_nonce_hash: string };
    const completeBody = complete?.body as { completion_code: string; device_nonce: string };
    expect(startBody.capabilities).toEqual(['mail_read']);
    expect(startBody.device_nonce_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(completeBody.completion_code).toBe(CODE);
    expect(completeBody.device_nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createHash('sha256').update(completeBody.device_nonce).digest('hex')).toBe(
      startBody.device_nonce_hash,
    );
    expect(complete?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(await SecureStore.getItemAsync('da.oauth.pending')).toBeNull();
    expect(events('integration_connect_result').at(-1)?.props).toEqual({
      provider: 'google',
      capability: 'mail_read',
      result: 'success',
    });
  });

  it('opens the multi_account gate for a second mail account on Free', async () => {
    await openApp({
      data: onboardingBootstrap('connect_mail'),
      landing: '/connect-mail',
      setup: (db) => {
        db.setTable('connected_accounts', [accountRow()]);
      },
    });
    await screen.findByLabelText(/^Gmail, .*Bağlandı/);
    await fireEvent.press(screen.getByTestId('connectMail.row.microsoft'));
    expect(await screen.findByTestId('gate.sheet.multi_account')).toBeOnTheScreen();
    expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({ feature: 'multi_account' });
  });
});

describe('personalization, schedule and VIP (M-ON-09…11)', () => {
  it('selects all seven areas with "Hepsi" and saves interest_categories', async () => {
    const { db, router } = await openApp({
      data: onboardingBootstrap('personalization', {
        preferences: { ...onboardingBootstrap('x').preferences, interest_categories: [] },
      }),
      landing: '/personalization',
    });
    expect(await screen.findByText('Senin için neler önemli?')).toBeOnTheScreen();
    expect(screen.getByTestId('personalization.continue')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('personalization.all'));
    expect(screen.getByRole('button', { name: 'Devam · 7 seçili' })).toBeEnabled();
    await fireEvent.press(screen.getByTestId('personalization.work'));
    expect(screen.getByRole('button', { name: 'Devam · 6 seçili' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('personalization.continue'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/briefing-schedule');
    });
    const write = db.writes.find(
      (w) =>
        w.table === 'user_preferences' &&
        typeof w.values === 'object' &&
        w.values !== null &&
        'interest_categories' in w.values,
    );
    expect((write?.values as { interest_categories: string[] }).interest_categories).toHaveLength(
      6,
    );
    expect(events('personalization_saved').at(-1)?.props).toEqual({ count: 6, all: false });
  });

  it('shows midday and evening locked on Free and opens the gate', async () => {
    await openApp({
      data: onboardingBootstrap('briefing_schedule'),
      landing: '/briefing-schedule',
    });
    expect(await screen.findByText('Günün ritmi')).toBeOnTheScreen();
    expect(screen.getByLabelText('Öğle nabzı, 13:00, Pro özelliği')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('schedule.midday.time'));
    expect(await screen.findByTestId('gate.sheet.midday')).toBeOnTheScreen();
  });

  it('shows the VIP gate to Free users without calling the Pro-only RPC', async () => {
    const { db } = await openApp({ data: onboardingBootstrap('vip'), landing: '/vip' });
    expect(await screen.findByTestId('gate.vip')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Atla ve devam et' })).toBeOnTheScreen();
    expect(db.rpcCalls.some((c) => c.name === 'vip_suggestions')).toBe(false);
  });

  it('lists Pro suggestions and inserts the selected VIPs', async () => {
    const data = proBootstrap({
      profile: { ...proBootstrap().profile, onboarding: { step: 'vip', completed_at: null } },
    });
    const { db, router } = await openApp({
      data,
      landing: '/vip',
      routes: {
        'POST /onboarding/first-analysis': () =>
          json(
            202,
            ok({
              job: { job_id: ID.job, status: 'queued', poll_after_ms: 1500 },
              already_running: false,
            }),
          ),
      },
      setup: (fakeDb) => {
        fakeDb.setRpc('vip_suggestions', [
          {
            contact_id: ID.contact,
            display_name: 'Selin Kaya',
            primary_email: 'selin@example.com',
            organization: null,
            exchanges_30d: 14,
          },
        ]);
      },
    });
    await fireEvent.press(await screen.findByTestId(`vip.row.${ID.contact}`));
    await fireEvent.press(screen.getByRole('button', { name: 'Devam (1)' }));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/analysis');
    });
    const insert = db.writes.find((w) => w.table === 'vip_people');
    expect(insert?.values).toEqual([
      {
        user_id: data.profile.id,
        contact_id: ID.contact,
        relationship: 'other',
        origin: 'onboarding',
      },
    ]);
    expect(events('vip_selected').at(-1)?.props).toEqual({
      count: 1,
      from_suggestions: 1,
      manual: 0,
    });
  });
});

describe('First Analysis and Aha (M-ON-12, M-ON-13)', () => {
  function progress(status: string, overrides: Record<string, unknown> = {}) {
    return {
      status,
      partial: false,
      steps: [
        { key: 'scan_mail', status: status === 'completed' ? 'done' : 'running', count: 127 },
        { key: 'classify', status: status === 'completed' ? 'done' : 'pending', count: null },
        { key: 'open_loops', status: status === 'completed' ? 'done' : 'pending', count: null },
      ],
      counts: {
        mails_found: 127,
        potential_important: 4,
        upcoming_events: 0,
        possible_followups: 2,
      },
      top_items: [
        {
          insight_id: ID.insight,
          kind: 'deadline',
          title: 'Başvuru bugün 17:00',
          time_label: null,
        },
        {
          insight_id: ID.insight2,
          kind: 'follow_up',
          title: 'Teklife cevap yok',
          time_label: null,
        },
      ],
      total_items: 5,
      briefing_id: ID.briefing,
      ...overrides,
    };
  }

  it('starts the job once, shows real progress, then the Aha findings and continues', async () => {
    let status = 'running';
    const { api, router } = await openApp({
      data: onboardingBootstrap('analysis'),
      landing: '/analysis',
      routes: {
        'POST /onboarding/first-analysis': () =>
          json(
            202,
            ok({
              job: { job_id: ID.job, status: 'queued', poll_after_ms: 1500 },
              already_running: false,
            }),
          ),
        [`GET /onboarding/first-analysis/${ID.job}`]: () => json(200, ok(progress(status))),
      },
    });
    expect(await screen.findByText('127 mail bulundu')).toBeOnTheScreen();
    expect(
      screen.getByText('Genelde 20–40 saniye sürer. Mail içeriğinin tamamı saklanmaz.'),
    ).toBeOnTheScreen();
    const starts = api.calls.filter((c) => c.url.endsWith('/onboarding/first-analysis'));
    expect(starts).toHaveLength(1);
    expect(starts[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(getOnboardingState().analysisJobId).toBe(ID.job);
    status = 'completed';
    await waitFor(
      () => {
        expect(router.getPathname()).toBe('/ready');
      },
      { timeout: 8000 },
    );
    expect(await screen.findByText('Son 72 saatte bilmen gereken 5 şey bulduk.')).toBeOnTheScreen();
    expect(screen.getByText('Başvuru bugün 17:00')).toBeOnTheScreen();
    expect(screen.getByText('+ 3 konu daha')).toBeOnTheScreen();
    expect(events('first_analysis_completed').at(-1)?.props).toMatchObject({
      mail_bucket: '51-200',
      important_count: 4,
    });
    expect(events('aha_viewed').at(-1)?.props).toEqual({ findings_count: 5, has_briefing: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Brifingimi Gör' }));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/notifications');
    });
  });

  it('shows the zero variant when nothing was found', async () => {
    updateOnboardingState({ analysisJobId: ID.job });
    await openApp({
      data: onboardingBootstrap('ready'),
      landing: '/ready',
      routes: {
        [`GET /onboarding/first-analysis/${ID.job}`]: () =>
          json(
            200,
            ok(progress('completed', { top_items: [], total_items: 0, briefing_id: null })),
          ),
      },
    });
    expect(await screen.findByText('Son 72 saatte acil bir şey yok.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
  });

  it('offers a new attempt after a failure', async () => {
    await openApp({
      data: onboardingBootstrap('analysis'),
      landing: '/analysis',
      routes: {
        'POST /onboarding/first-analysis': () =>
          json(
            202,
            ok({
              job: { job_id: ID.job, status: 'queued', poll_after_ms: 1500 },
              already_running: false,
            }),
          ),
        [`GET /onboarding/first-analysis/${ID.job}`]: () => json(200, ok(progress('failed'))),
      },
    });
    expect(await screen.findByText('İlk analiz tamamlanamadı.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar Dene' }));
    await waitFor(() => {
      expect(getOnboardingState().analysisAttempt).toBe(2);
    });
    expect(events('first_analysis_retry')).toHaveLength(1);
  });

  it('continues without analysis when the server reports no sources (STATE_CONFLICT)', async () => {
    await openApp({
      data: onboardingBootstrap('analysis'),
      landing: '/notifications',
      routes: { 'POST /onboarding/first-analysis': () => json(409, errorBody('STATE_CONFLICT')) },
    });
    expect(getOnboardingState().skippedAllSources).toBe(true);
  });
});

describe('notifications and completion (M-ON-14, M-ON-15)', () => {
  it('asks after the pre-prompt, registers the token and completes onboarding on iOS', async () => {
    updateOnboardingState({ firstBriefingId: ID.briefing });
    const { api, db, router } = await openApp({
      data: onboardingBootstrap('notifications'),
      landing: '/notifications',
      routes: {
        'POST /devices/register': () =>
          json(
            200,
            ok({
              installation_id: uuid(99),
              push_enabled: true,
              rebound_from_other_user: false,
              timezone_applied: false,
            }),
          ),
      },
    });
    expect(await screen.findByText('Sadece önemli olduğunda haber veririz.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Bildirimleri Aç' }));
    await waitFor(() => {
      expect(router.getPathname()).toMatch(/^\/(today|briefing)/);
    });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    expect(api.calls.some((c) => c.url.endsWith('/devices/register'))).toBe(true);
    const done = db.writes.find(
      (w) =>
        w.table === 'profiles' &&
        (w.values as { onboarding_step?: string }).onboarding_step === 'done',
    );
    expect(done).toBeDefined();
    expect(events('notification_permission_result').at(-1)?.props).toEqual({
      status: 'granted',
      context: 'onboarding',
    });
    expect(events('onboarding_completed')).toHaveLength(1);
  });

  it('records the single deferral with "Daha sonra"', async () => {
    const { db } = await openApp({
      data: onboardingBootstrap('notifications'),
      landing: '/notifications',
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Daha sonra' }));
    await waitFor(() => {
      expect(db.writes.some((w) => w.table === 'notification_preferences')).toBe(true);
    });
    expect(db.writes.find((w) => w.table === 'notification_preferences')?.values).toEqual({
      prompt_deferred_count: 1,
    });
    expect(events('notification_prompt_deferred')).toHaveLength(1);
  });
});
