/**
 * T-8.19 settings: the hub (M-SET-01: live values, identity lines, every row navigates, the Android
 * NI row absent on iOS — UT-MB-11), sign-out, profile, notifications (category round-trips, Pro
 * gates, detail/lock-screen, quiet hours R-13, test push, R-14 promise), briefing schedule
 * validation, appearance, language, help (FAQ search + "Ayara git" + ticket), feedback (success only
 * after 201, offline queue) and about. Every write is asserted against the PostgREST double.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import type * as Clock from '../src/lib/clock';
import { resetPendingSettingsForTests } from '../src/features/settings/save';
import { resetFeedbackOutboxForTests } from '../src/features/settings/outbox';
import { briefingValue } from '../src/features/settings/HubScreen';
import { heroKindOf } from '../src/features/subscription/state';
import { getUiPrefs } from '../src/lib/ui-prefs';
import { SETTINGS_SCREENS } from '../src/lib/router-guards';
import { json, resetAppState } from './helpers/app';
import type { PostgrestFake } from './helpers/postgrest';
import { bootstrap, errorBody, ok, uuid } from './helpers/fixtures';
import { appRouter, events, openApp, PRO_ENTITLEMENT, proBootstrap } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

jest.mock('../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../src/lib/clock'),
  now: () => new Date('2027-01-10T09:00:00Z'),
}));

beforeEach(async () => {
  await resetAppState();
  resetPendingSettingsForTests();
  resetFeedbackOutboxForTests();
});

function countsSetup(db: PostgrestFake) {
  db.setTable('priority_rules', [
    { id: uuid(301), enabled: true, deleted_at: null },
    { id: uuid(302), enabled: true, deleted_at: null },
  ]);
  db.setTable('vip_people', [{ id: uuid(311) }]);
  db.setTable('learned_preferences', [{ id: uuid(321), enabled: true, deleted_at: null }]);
}

describe('settings stack registry', () => {
  it('lists every page under app/settings in the protected settings stack', () => {
    const dir = join(__dirname, '..', 'app', 'settings');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((name) => {
        const full = join(d, name);
        return statSync(full).isDirectory() ? walk(full) : [relative(dir, full)];
      });
    const names = walk(dir)
      .filter((f) => !f.startsWith('_'))
      .map((f) =>
        f
          .replace(/\.tsx$/, '')
          .split('\\')
          .join('/'),
      );
    expect([...names].sort()).toEqual([...SETTINGS_SCREENS].sort());
  });
});

describe('M-SET-01 hub', () => {
  it('shows live values and opens every row', async () => {
    const { router } = await openApp({ path: '/settings?from=today', setup: countsSetup });
    await screen.findByTestId('screen.settings');
    expect(events('settings_opened')[0]?.props).toMatchObject({ from: 'today' });
    await waitFor(() => {
      expect(screen.getByText('2 kural')).toBeTruthy();
    });
    expect(screen.getByText('Ücretsiz plan')).toBeTruthy();
    expect(screen.getByText('08:00')).toBeTruthy();
    // Free: VIP opens the Pro gate; the Android NI row does not exist on iOS (UT-MB-11).
    expect(screen.queryByTestId('hub.row.androidNi')).toBeNull();
    await fireEvent.press(screen.getByTestId('hub.row.vip'));
    expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({ feature: 'vip' });

    const rows: readonly [string, string][] = [
      ['hub.row.briefings', '/settings/briefings'],
      ['hub.row.notifications', '/settings/notifications'],
      ['hub.row.rules', '/settings/priority-rules'],
      ['hub.row.personalization', '/settings/personalization'],
      ['hub.row.subscription', '/settings/subscription'],
      ['hub.row.accounts', '/settings/accounts'],
      ['hub.row.privacy', '/settings/privacy'],
      ['hub.row.referral', '/settings/referral'],
      ['hub.row.deleteAccount', '/settings/privacy/delete-account'],
      ['hub.row.appearance', '/settings/appearance'],
      ['hub.row.language', '/settings/language'],
      ['hub.row.help', '/settings/help'],
      ['hub.row.feedback', '/settings/feedback'],
      ['hub.row.about', '/settings/about'],
      ['hub.identity', '/settings/profile'],
    ];
    for (const [testID, path] of rows) {
      await fireEvent.press(await screen.findByTestId(testID));
      await waitFor(() => {
        expect(router.getPathname()).toBe(path);
      });
      await act(async () => {
        appRouter.back();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(router.getPathname()).toBe('/settings');
      });
    }
    expect(events('settings_row_tapped')).toHaveLength(rows.length + 1);
  });

  it('describes Pro, trial, grant and billing-issue identities', () => {
    const base = bootstrap().entitlement;
    expect(heroKindOf(base)).toBe('free');
    expect(
      heroKindOf({ ...base, store: { ...base.store, active: true, period_type: 'trial' } }),
    ).toBe('trial');
    expect(
      heroKindOf({ ...base, store: { ...base.store, active: true, billing_issue: true } }),
    ).toBe('billing_issue');
    expect(
      heroKindOf({
        ...base,
        is_active: true,
        source: 'grant',
        grants: [
          {
            id: uuid(5),
            source: 'referral_referee',
            starts_at: '2027-01-01T00:00:00Z',
            ends_at: '2027-01-15T00:00:00Z',
          },
        ],
      }),
    ).toBe('grant');
    const prefs = bootstrap().preferences;
    expect(briefingValue(prefs, false)).toBe(prefs.morning_time);
    expect(briefingValue(prefs, true)).toContain(' · ');
  });

  it('signs out from the confirmation sheet', async () => {
    const { fake } = await openApp({ path: '/settings' });
    await fireEvent.press(await screen.findByTestId('hub.signOut'));
    await fireEvent.press(await screen.findByTestId('signOut.confirm'));
    await waitFor(() => {
      expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });
    expect(events('sign_out').at(-1)?.props).toMatchObject({ scope: 'this' });
  });
});

describe('M-SET-03 profile', () => {
  it('rejects an empty name and saves a trimmed one', async () => {
    const { db } = await openApp({ path: '/settings/profile' });
    const field = await screen.findByTestId('profile.name');
    await fireEvent.changeText(field, '   ');
    await fireEvent(field, 'blur');
    expect(await screen.findByText('Ad boş olamaz.')).toBeTruthy();
    await fireEvent.changeText(field, '  Ayşe Kaya ');
    await fireEvent(field, 'blur');
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'profiles')?.values).toEqual({
        display_name: 'Ayşe Kaya',
      });
    });
    expect(events('profile_name_changed')).toHaveLength(1);
  });
});

describe('M-SET-20 notifications', () => {
  it('round-trips category switches and gates Pro rows for Free users', async () => {
    const { db } = await openApp({ path: '/settings/notifications' });
    await fireEvent.press(await screen.findByTestId('notifications.meeting'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'notification_preferences',
        values: { meeting: !bootstrap().notification_preferences.meeting },
      });
    });
    await fireEvent.press(screen.getByTestId('notifications.follow_up'));
    expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({ feature: 'followups' });
    expect(
      screen.getByText(
        'Sadece önemli olduğunda haber veririz. Kritik mail uyarıları dışında günde en fazla 5 bildirim gönderilir.',
      ),
    ).toBeTruthy();
  });

  it('asks before full content while the lock screen is private', async () => {
    const { db } = await openApp({ path: '/settings/notifications' });
    await fireEvent.press(await screen.findByTestId('notifications.detail.full'));
    await fireEvent.press(await screen.findByTestId('fullDetail.apply'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({
        detail_level: 'full',
        lock_screen_private: false,
      });
    });
    expect(events('notification_detail_changed').at(-1)?.props).toMatchObject({ mode: 'full' });
  });

  it('sends a test notification and reports a quiet-hours deferral truthfully', async () => {
    const { api } = await openApp({
      path: '/settings/notifications',
      routes: {
        'POST /notifications/test': () =>
          json(
            202,
            ok({
              notification_id: uuid(7),
              job: { job_id: uuid(8), status: 'queued', poll_after_ms: 1000 },
              deferred_until: '2027-01-10T04:30:00Z',
            }),
          ),
      },
    });
    await fireEvent.press(await screen.findByTestId('notifications.test'));
    expect(
      await screen.findByText('Sessiz saatlerde olduğun için test bildirimi gönderilmedi.'),
    ).toBeTruthy();
    const call = api.calls.find((c) => c.url.endsWith('/notifications/test'));
    expect(call?.body).toEqual({
      installation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      category: 'critical_email',
    });
  });

  it('saves quiet hours with the VIP bypass (R-13) and rejects an empty window', async () => {
    const { db } = await openApp({
      data: proBootstrap(),
      path: '/settings/notifications?sheet=quiet-hours',
    });
    expect(await screen.findByTestId('sheet.quietHours')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('quietHours.day.7'));
    await fireEvent.press(screen.getByTestId('quietHours.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'notification_preferences',
        values: { quiet_hours_enabled: true, vip_bypass_quiet: true },
      });
    });
    expect(events('quiet_hours_changed').at(-1)?.props).toMatchObject({ vip_bypass: true });
  });
});

describe('M-SET-23 briefing settings', () => {
  it('validates the order of the slots and the silent days', async () => {
    const data = proBootstrap();
    const { db } = await openApp({ data, path: '/settings/briefings' });
    await fireEvent.press(await screen.findByTestId('briefings.midday.time'));
    for (let i = 0; i < 5; i += 1) await fireEvent.press(screen.getByTestId('time.hour.down'));
    await fireEvent.press(screen.getByTestId('time.done'));
    expect(
      await screen.findByText('Öğle nabzı sabah brifinginden en az 1 saat sonra olmalı.'),
    ).toBeTruthy();
    expect(db.writes.filter((w) => w.table === 'user_preferences')).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('briefings.silent.6'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({
        briefing_weekdays: data.preferences.briefing_weekdays.filter((d) => d !== 6),
      });
    });
    expect(events('silent_days_changed').at(-1)?.props).toMatchObject({ count: 1 });
  });
});

describe('M-SET-60 / M-SET-62 appearance and language', () => {
  it('applies the theme at once and mirrors it to user_preferences', async () => {
    const { db } = await openApp({ path: '/settings/appearance' });
    await fireEvent.press(await screen.findByTestId('appearance.theme.dark'));
    expect(getUiPrefs().theme).toBe('dark');
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'user_preferences',
        values: { theme: 'dark' },
      });
    });
  });

  it('switches the language at once and writes profiles.locale', async () => {
    const { db } = await openApp({ path: '/settings/language' });
    await fireEvent.press(await screen.findByTestId('language.en'));
    expect(getUiPrefs().locale).toBe('en');
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'profiles')?.values).toEqual({ locale: 'en-US' });
    });
    expect(await screen.findByText('REGION')).toBeTruthy();
  });
});

describe('offline settings writes', () => {
  it('queues a change offline and replays it on reconnect', async () => {
    const { db } = await openApp({ path: '/settings/notifications' });
    await screen.findByTestId('notifications.meeting');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByTestId('notifications.meeting'));
    expect(await screen.findByTestId('notifications.queued')).toBeTruthy();
    expect(db.writes).toHaveLength(0);
    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(db.writes.at(-1)?.table).toBe('notification_preferences');
    });
  });
});

describe('M-SET-70 / M-SET-71 help and support', () => {
  it('searches the FAQ with Turkish folding and opens the linked setting', async () => {
    await openApp({ path: '/settings/help' });
    await fireEvent.changeText(await screen.findByTestId('help.search'), 'DIŞA AKTAR');
    await fireEvent.press(await screen.findByText('Verilerimi nasıl dışa aktarırım?'));
    await fireEvent.press(await screen.findByTestId('help.faq.export.go'));
    expect(await screen.findByTestId('screen.privacy.export')).toBeTruthy();
    expect(events('help_faq_action').at(-1)?.props).toMatchObject({ key: 'export' });
  });

  it('creates a ticket and shows success only after 201', async () => {
    const { api } = await openApp({
      path: '/settings/help?contact=sync',
      routes: {
        'POST /support/tickets': () =>
          json(201, ok({ id: uuid(9), reference: 'DA-7K3M9Q', status: 'open' })),
      },
    });
    expect(await screen.findByTestId('sheet.contact')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('contact.send'));
    expect(await screen.findByText('Mesajın en az 20 karakter olmalı.')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByTestId('contact.message'),
      'Takvimim iki gündür güncellenmiyor, yardım eder misiniz?',
    );
    await fireEvent.press(screen.getByTestId('contact.send'));
    expect(await screen.findByTestId('contact.success')).toBeTruthy();
    const call = api.calls.find((c) => c.url.endsWith('/support/tickets'));
    expect(call?.body).toMatchObject({ category: 'sync', include_diagnostics: true });
    expect(call?.headers['idempotency-key']).toBeDefined();
  });
});

describe('M-SET-72 feedback', () => {
  it('requires a message, then shows success only after 201', async () => {
    const { api } = await openApp({
      path: '/settings/feedback?type=bug',
      routes: { 'POST /feedback': () => json(201, ok({ id: uuid(10) })) },
    });
    await fireEvent.press(await screen.findByTestId('feedback.send'));
    expect(await screen.findByText('Mesaj alanı boş olamaz.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('feedback.star.4'));
    await fireEvent.changeText(
      screen.getByTestId('feedback.message'),
      'Brifing bazen geç geliyor.',
    );
    await fireEvent.press(screen.getByTestId('feedback.send'));
    expect(await screen.findByTestId('feedback.success')).toBeTruthy();
    expect(api.calls.find((c) => c.url.endsWith('/feedback'))?.body).toMatchObject({
      type: 'bug',
      rating: 4,
      message: 'Brifing bazen geç geliyor.',
    });
    // The store review card is always there, whatever the rating (no review gating).
    expect(screen.getByTestId('feedback.review')).toBeTruthy();
  });

  it('queues offline instead of claiming success and sends on reconnect', async () => {
    const { api } = await openApp({
      path: '/settings/feedback',
      routes: { 'POST /feedback': () => json(201, ok({ id: uuid(11) })) },
    });
    await screen.findByTestId('feedback.send');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.changeText(screen.getByTestId('feedback.message'), 'Çevrimdışı not.');
    await fireEvent.press(screen.getByTestId('feedback.send'));
    expect(await screen.findByTestId('feedback.queued')).toBeTruthy();
    expect(api.calls.filter((c) => c.url.endsWith('/feedback'))).toHaveLength(0);
    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.calls.filter((c) => c.url.endsWith('/feedback'))).toHaveLength(1);
    });
  });

  it('reports a rate limit without a success state', async () => {
    await openApp({
      path: '/settings/feedback',
      routes: { 'POST /feedback': () => json(429, errorBody('RATE_LIMITED')) },
    });
    await fireEvent.changeText(await screen.findByTestId('feedback.message'), 'Deneme');
    await fireEvent.press(screen.getByTestId('feedback.send'));
    await waitFor(() => {
      expect(events('feedback_failed').at(-1)?.props).toMatchObject({ code: 'RATE_LIMITED' });
    });
    expect(screen.queryByTestId('feedback.success')).toBeNull();
  });
});

describe('M-SET-73 about', () => {
  it('shows the version, the runtime year and the licenses sheet', async () => {
    await openApp({ path: '/settings/about', data: { ...bootstrap(), demo_mode: true } });
    expect(await screen.findByText('Sürüm 1.0.0 (42)')).toBeTruthy();
    expect(screen.getByText('© 2027 Dijital Asistan')).toBeTruthy();
    expect(screen.getByTestId('about.demo')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('about.licenses'));
    expect(await screen.findByTestId('sheet.licenses')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('licenses.search'), 'react-native-purchases');
    expect(await screen.findByTestId('licenses.row.react-native-purchases')).toBeTruthy();
    expect(events('licenses_viewed')).toHaveLength(1);
  });
});

describe('Pro users', () => {
  it('see their plan on the hub', async () => {
    await openApp({
      path: '/settings',
      data: proBootstrap({
        entitlement: {
          ...PRO_ENTITLEMENT,
          store: { ...PRO_ENTITLEMENT.store, active: true, product_id: 'da_pro_monthly' },
        },
      }),
    });
    expect(await screen.findByText('Pro · Aylık')).toBeTruthy();
  });
});
