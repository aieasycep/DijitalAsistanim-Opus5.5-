/**
 * The mobile completion pass (T-8.29 and the actions earlier batches deferred):
 * - Today card actions: deadline "Takvime Ekle" → `POST /approvals` → the one approval sheet
 *   (typed "Düzenle", R-06 5 s delay); commitment "Planla" → `POST /plan/proposals`;
 * - M-SET-61 text size ("En büyük" → the kit typography multiplier, `text_scale_changed`);
 * - M-PAY-01 weekly sub-line from the latest weekly review;
 * - M-CAP-01 "Yapıştır" (clipboard read only after the tap);
 * - offline queue kinds for meeting notes and VIP settings;
 * - M-SET-02 offline sign-out: `pending_session_cleanup` stored, then completed online;
 * - the background device-calendar upload task.
 */
import { typography } from '@da/design-tokens';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import { StyleSheet, type TextStyle } from 'react-native';

import {
  DEVICE_CALENDAR_TASK,
  syncDeviceCalendarTask,
} from '../src/features/integrations/device-calendar-task';
import { storedDestination } from '../src/features/reminders/ReminderSheetScreen';
import { logout } from '../src/lib/auth/logout';
import {
  PENDING_SESSION_CLEANUP_KEY,
  completePendingSessionCleanup,
  storePendingSessionCleanup,
} from '../src/lib/auth/pending-cleanup';
import { queuedMutations, runOrQueue } from '../src/lib/offline/mutations';
import { getUiPrefs } from '../src/lib/ui-prefs';
import { json, resetAppState } from './helpers/app';
import { M3, approvalView } from './helpers/assist';
import { ok, uuid } from './helpers/fixtures';
import { events, openApp, proBootstrap } from './helpers/journeys';
import { emptyTodayOverview, type PostgrestFake } from './helpers/postgrest';

beforeEach(async () => {
  await resetAppState();
});

function priority(overrides: Record<string, unknown>) {
  return {
    id: uuid(40),
    urgency: 'today',
    title: 'Sözleşme taslağı',
    body: null,
    why_important: null,
    decision_tier: 'deterministic_signal',
    entity_type: null,
    entity_id: null,
    due_at: null,
    event_at: null,
    user_corrected: false,
    source: null,
    ...overrides,
  };
}

/** A pending calendar_create card (provider destination, no push side effect). */
function calendarView(origin: string) {
  return approvalView({
    action_type: 'calendar_create',
    type_label_key: 'approvals.types.calendar_create',
    origin,
    side_effects: [],
    destination: {
      target_kind: 'provider',
      provider: 'google',
      account_label: 'ahmet@example.com',
      container_label: 'İş',
    },
  });
}

function todayWith(item: Record<string, unknown>) {
  return (db: PostgrestFake) => {
    db.setRpc('today_overview', (args: Readonly<Record<string, unknown>>) => ({
      data: {
        ...emptyTodayOverview(String(args.p_local_date)),
        hero_count: 1,
        priorities: [item],
      },
      error: null,
    }));
    db.setTable('calendars', [
      { id: uuid(20), connected_account_id: uuid(10), can_write: true, selected: true },
    ]);
  };
}

describe('Today card actions (Annex M-TD-01-B)', () => {
  it('"Takvime Ekle" proposes a calendar_create and opens the one approval sheet', async () => {
    const view = calendarView('insight');
    const { api } = await openApp({
      routes: { 'POST /approvals': () => json(201, ok(view)) },
      setup: todayWith(priority({ kind: 'deadline', due_at: '2026-09-30T15:00:00Z' })),
    });
    await fireEvent.press(await screen.findByText('Takvime Ekle'));
    expect(await screen.findByTestId('sheet.approval')).toBeOnTheScreen();
    const proposal = api.calls.find((c) => c.url.endsWith('/approvals'));
    expect(proposal?.body).toMatchObject({
      payload: { action_type: 'calendar_create', title: 'Sözleşme taslağı' },
      origin: 'insight',
      origin_ref_id: uuid(40),
    });
    // Typed editors for every action type (M-APPR-05) and nothing sent during the R-06 window.
    expect(screen.getByTestId('approvalSheet.edit')).toBeOnTheScreen();
    expect(events('approval_sheet_view').at(-1)?.props).toEqual({
      mode: 'single',
      count: 1,
      origin: 'insight',
    });
    await fireEvent.press(screen.getByTestId('approvalSheet.approve'));
    expect(api.calls.some((c) => c.url.endsWith(`/approvals/${M3.approval}/approve`))).toBe(false);
    expect(events('priority_action').at(-1)?.props).toEqual({
      kind: 'deadline',
      action: 'calendar',
    });
  });

  it('"Planla" on a commitment opens the plan proposal (Pro)', async () => {
    const approval = calendarView('plan_proposal');
    const { api, router } = await openApp({
      data: proBootstrap(),
      routes: {
        'POST /plan/proposals': () =>
          json(
            200,
            ok({
              insight_id: uuid(40),
              slot: { start: '2026-09-26T11:00:00Z', end: '2026-09-26T12:00:00Z' },
              alternatives: [],
              rationale_text: 'Boş zaman.',
              approval,
            }),
          ),
      },
      setup: todayWith(
        priority({ kind: 'commitment', entity_type: 'commitment', entity_id: uuid(45) }),
      ),
    });
    await fireEvent.press(await screen.findByText('Planla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${M3.approval}`);
    });
    expect(api.calls.find((c) => c.url.endsWith('/plan/proposals'))?.body).toMatchObject({
      item: { type: 'commitment', id: uuid(45) },
      duration_minutes: 60,
    });
  });
});

describe('M-SET-61 text size', () => {
  it('"En büyük" scales the type and is device-local', async () => {
    const { db } = await openApp({ path: '/settings/appearance' });
    await fireEvent.press(await screen.findByTestId('appearance.textSize'));
    expect(await screen.findByTestId('sheet.textSize')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('textSize.xl'));
    expect(getUiPrefs().textScale).toBe('xl');
    expect(events('text_scale_changed').at(-1)?.props).toEqual({ scale: 'xlarge' });
    const sample = StyleSheet.flatten(
      screen.getByTestId('textSize.sample').props.style as TextStyle,
    );
    expect(sample.fontSize).toBeCloseTo(typography.body.size * 1.3);
    expect(db.writes.some((w) => JSON.stringify(w.values).includes('text'))).toBe(false);
  });
});

describe('M-PAY-01 weekly sub-line', () => {
  it('uses the latest weekly review aggregate', async () => {
    await openApp({
      path: '/paywall',
      setup: (db) => {
        db.setTable('briefings', [
          {
            kind: 'weekly',
            status: 'ready',
            local_date: '2026-09-20',
            weekly_stats: { mails_analyzed: 684, important_count: 32, time_saved_min: 168 },
          },
        ]);
      },
    });
    expect(await screen.findByText(/^Bu hafta 684 mailden 32'sini öne çıkardık/)).toBeOnTheScreen();
  });
});

describe('M-CAP-01 composer shortcuts', () => {
  it('"Yapıştır" reads the clipboard only after the tap', async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValueOnce('Yarın 10:00 Ayşe ile toplantı');
    await openApp({ data: proBootstrap(), path: '/capture' });
    expect(await screen.findByTestId('capture.paste')).toBeOnTheScreen();
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('capture.paste'));
    expect(await screen.findByDisplayValue('Yarın 10:00 Ayşe ile toplantı')).toBeOnTheScreen();
  });
});

describe('offline queue kinds (T-8.23 follow-ups)', () => {
  it('queues meeting notes and VIP settings offline', async () => {
    onlineManager.setOnline(false);
    const note = await runOrQueue(
      'meeting_note',
      { eventId: uuid(60), body: { client_note_id: uuid(61), body: 'Not', source: 'text' } },
      { idempotencyKey: uuid(61) },
    );
    const vip = await runOrQueue('vip_set', {
      contactId: uuid(90),
      on: true,
      settings: { relationship: 'client', alwaysNotify: true, bypassQuietHours: false },
    });
    expect([note.status, vip.status]).toEqual(['queued', 'queued']);
    expect(queuedMutations().map((e) => e.kind)).toEqual(['meeting_note', 'vip_set']);
    expect(queuedMutations()[0]?.idempotencyKey).toBe(uuid(61));
  });

  it('keeps the reminder default destination as the stored jsonb shape', () => {
    expect(storedDestination({ kind: 'in_app' })).toEqual({ kind: 'in_app' });
    expect(
      storedDestination({
        kind: 'google_tasks',
        accountId: uuid(10),
        email: 'a@b.example',
        listId: 'list-1',
      }),
    ).toEqual({ kind: 'google_tasks', account_id: uuid(10), list_id: 'list-1' });
  });
});

describe('M-SET-02 offline sign-out (pending_session_cleanup)', () => {
  it('keeps the refresh token when signing out offline', async () => {
    const stored: string[] = [];
    await logout(
      {},
      {
        isOffline: () => true,
        installationId: () => null,
        supabase: {
          auth: {
            getSession: () =>
              Promise.resolve({ data: { session: { refresh_token: 'rt-offline' } } }),
            signOut: () => Promise.resolve({ error: null }),
          },
        } as never,
        queryClient: { clear: () => undefined } as never,
        wipeStorage: () => Promise.resolve(),
        unregisterPush: () => Promise.resolve(),
        cancelLocalNotifications: () => Promise.resolve(),
        storePendingCleanup: (token) => {
          stored.push(token);
          return Promise.resolve();
        },
      },
    );
    expect(stored).toEqual(['rt-offline']);
  });

  it('revokes the session and unregisters the device once online, then forgets the token', async () => {
    await storePendingSessionCleanup('rt-offline');
    const calls: string[] = [];
    const fetch = jest.fn((url: string) => {
      calls.push(new URL(url).pathname);
      if (url.includes('/token')) {
        return Promise.resolve(json(200, { access_token: 'a.b.c' }));
      }
      if (url.includes('/devices/unregister')) return Promise.resolve(json(200, ok({})));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const result = await completePendingSessionCleanup({
      fetch: fetch as never,
      installationId: () => uuid(99),
    });
    expect(result).toBe('done');
    expect(calls).toEqual([
      '/auth/v1/token',
      '/functions/v1/api/devices/unregister',
      '/auth/v1/logout',
    ]);
    expect(await SecureStore.getItemAsync(PENDING_SESSION_CLEANUP_KEY)).toBeNull();
    await expect(completePendingSessionCleanup({ fetch: fetch as never })).resolves.toBe('none');
  });
});

describe('background device-calendar upload (T-8.07)', () => {
  it('registers the task with a device calendar and removes it without one', async () => {
    const tasks = jest.requireMock<{ defineTask: jest.Mock; isTaskRegisteredAsync: jest.Mock }>(
      'expo-task-manager',
    );
    const background = jest.requireMock<{
      registerTaskAsync: jest.Mock;
      unregisterTaskAsync: jest.Mock;
    }>('expo-background-task');
    expect(tasks.defineTask).toHaveBeenCalledWith(DEVICE_CALENDAR_TASK, expect.any(Function));
    await act(async () => {
      await syncDeviceCalendarTask(true);
    });
    expect(background.registerTaskAsync).toHaveBeenCalledWith(DEVICE_CALENDAR_TASK, {
      minimumInterval: 15,
    });
    tasks.isTaskRegisteredAsync.mockImplementationOnce(() => Promise.resolve(true));
    await syncDeviceCalendarTask(false);
    expect(background.unregisterTaskAsync).toHaveBeenCalledWith(DEVICE_CALENDAR_TASK);
  });
});
