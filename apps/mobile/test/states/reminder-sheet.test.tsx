/**
 * T-8.18 · M-REM-01 Smart Reminder sheet variants (SCREEN_AND_FLOW_MAP M-REM-01, M-REM-02 Kendin
 * seç, M-REM-03 destination, C-08 / C-28): presets relative to an anchor (before / past / quiet
 * hours), the custom picker with past and one-year limits, the smart slot's retry after an error,
 * no calendar, the existing reminder line, snooze mode (RPC-01 with the notify switch), and the
 * external destinations: Google Tasks through a `task_create` approval (`POST /approvals`), the
 * stored default destination ("Varsayılan yap"), Apple Reminders denied, and connecting an account.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import * as Calendar from 'expo-calendar/legacy';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { json, resetAppState, type Responder } from '../helpers/app';
import { M3, approvalView } from '../helpers/assist';
import { bootstrap, errorBody, googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import { events, openApp } from '../helpers/journeys';
import type { PostgrestFake } from '../helpers/postgrest';
import { sequence } from './support';

// 09:30 in Istanbul on Thursday 24 September 2026 unless a test moves it.
const mockClock = { now: '2026-09-24T06:30:00Z' };
jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date(mockClock.now),
}));

const TARGET = uuid(1900);
const MS_ACCOUNT = uuid(1901);
const base = `/reminders/new?targetType=email_message&targetId=${TARGET}&title=S%C3%B6zle%C5%9Fme&origin=email_detail`;

function smart(valid: boolean) {
  return {
    options: [
      {
        preset: 'smart',
        fire_at: valid ? '2026-09-24T11:00:00Z' : null,
        label: valid ? 'Bugün' : '',
        reason_text: valid ? 'takvim boşluğu' : null,
        valid,
        invalid_reason: valid ? null : 'no_free_slot',
      },
    ],
  };
}

const reminder = {
  id: M3.reminder,
  title: 'Sözleşme',
  preset: 'custom',
  fire_at: TS,
  time_zone: 'Europe/Istanbul',
  channel: 'local',
  status: 'scheduled',
  reason_text: null,
  subject: null,
  created_at: TS,
};

interface Options {
  readonly path?: string;
  readonly routes?: Readonly<Record<string, Responder>>;
  readonly setup?: (db: PostgrestFake) => void;
  readonly accounts?: readonly unknown[];
}

async function openSheet(options: Options = {}) {
  const opened = await openApp({
    data: bootstrap({ accounts: [...((options.accounts ?? [googleAccount]) as never[])] }),
    path: options.path ?? base,
    ...(options.setup === undefined ? {} : { setup: options.setup }),
    routes: {
      'POST /reminders/resolve-time': () => json(200, ok(smart(true))),
      'POST /reminders': () => json(201, ok(reminder)),
      ...options.routes,
    },
  });
  await screen.findByTestId('reminder.main');
  return opened;
}

beforeEach(async () => {
  mockClock.now = '2026-09-24T06:30:00Z';
  await resetAppState();
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockImplementation(() => Promise.resolve({ status: 'granted', granted: true } as never));
});

describe('M-REM-01 · presets', () => {
  it('resolves the before presets against the anchor and marks quiet hours and past times', async () => {
    // Anchor 23:40 Istanbul: 30 min / 1 h before fall into the 22:30–07:30 quiet hours.
    await openSheet({ path: `${base}&anchorAt=2026-09-24T20:40:00Z` });
    expect(screen.getByTestId('reminder.preset.before_30m')).toBeOnTheScreen();
    expect(await screen.findAllByText(/sessiz saatte/)).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('reminder.preset.before_1h'));
    expect(screen.getByTestId('reminder.submit')).toHaveTextContent(/Hatırlatıcıyı Kur · /);
  });

  it('hides anchored presets that passed and greys out a past evening', async () => {
    mockClock.now = '2026-09-24T16:00:00Z';
    await openSheet({ path: `${base}&anchorAt=2026-09-24T16:20:00Z` });
    expect(screen.queryByTestId('reminder.preset.before_30m')).toBeNull();
    expect(screen.queryByTestId('reminder.preset.before_1h')).toBeNull();
    expect(
      within(screen.getByTestId('reminder.preset.this_evening')).getByText('Geçti'),
    ).toBeOnTheScreen();
  });

  it('retries the smart slot after an error and shows its reason', async () => {
    const { api } = await openSheet({
      routes: {
        'POST /reminders/resolve-time': sequence(
          json(500, errorBody('INTERNAL_ERROR')),
          json(200, ok(smart(true))),
        ),
      },
    });
    expect(await screen.findByText('Şu an hesaplanamadı · Tekrar dene')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reminder.preset.smart'));
    expect(await screen.findByText('takvim boşluğu')).toBeOnTheScreen();
    expect(api.calls.filter((c) => c.url.endsWith('/resolve-time'))).toHaveLength(2);
    expect(events('reminder_smart_resolve').map((e) => e.props.result)).toEqual(['error', 'slot']);
    await fireEvent.press(screen.getByTestId('reminder.preset.smart'));
    await fireEvent.press(screen.getByTestId('reminder.submit'));
    await waitFor(() => {
      expect(
        api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/reminders'))?.body,
      ).toMatchObject({
        preset: 'smart',
        fire_at: '2026-09-24T11:00:00.000Z',
      });
    });
  });

  it('disables the smart preset without a calendar and shows the existing reminder', async () => {
    await openSheet({
      accounts: [{ ...googleAccount, capabilities_granted: ['mail_read'] }],
      setup: (db) => {
        db.setTable('reminders', [
          {
            id: uuid(1902),
            remind_at: '2026-09-25T06:00:00Z',
            target_type: 'email_message',
            target_id: TARGET,
            status: 'scheduled',
          },
        ]);
      },
    });
    expect(screen.getByText('Takvim bağlı değil')).toBeOnTheScreen();
    expect(await screen.findByTestId('reminder.existing')).toBeOnTheScreen();
  });
});

describe('M-REM-02 · Kendin seç', () => {
  it('rejects a past time and schedules a chosen custom time', async () => {
    const { api } = await openSheet();
    await fireEvent.press(screen.getByTestId('reminder.preset.custom'));
    expect(await screen.findByTestId('reminder.custom')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reminder.picker.day.0'));
    for (let i = 0; i < 3; i += 1)
      await fireEvent.press(screen.getByTestId('reminder.picker.hour.down'));
    expect(await screen.findByText('Geçmiş bir zaman seçilemez.')).toBeOnTheScreen();
    expect(screen.getByTestId('reminder.custom.choose')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('reminder.picker.day.3'));
    await fireEvent.press(screen.getByTestId('reminder.picker.minute.up'));
    await fireEvent.press(screen.getByTestId('reminder.custom.choose'));
    expect(events('reminder_custom_pick').at(-1)?.props).toEqual({ lead_bucket: '<1w' });
    await fireEvent.press(await screen.findByTestId('reminder.submit'));
    await waitFor(() => {
      expect(
        api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/reminders'))?.body,
      ).toMatchObject({
        preset: 'custom',
        channel: 'local',
        origin: 'email_detail',
      });
    });
  });

  it('goes back from the picker without choosing', async () => {
    await openSheet();
    await fireEvent.press(screen.getByTestId('reminder.preset.custom'));
    await fireEvent.press(await screen.findByTestId('reminder.back'));
    expect(await screen.findByTestId('reminder.main')).toBeOnTheScreen();
  });
});

describe('snooze mode', () => {
  it('snoozes the insight with RPC-01 and no notification when the switch is off', async () => {
    const { db } = await openSheet({
      path: `/reminders/new?mode=snooze&targetType=insight&targetId=${M3.insight}&title=Fatura&origin=today`,
      setup: (fake) => {
        fake.setRpc('set_insight_status', { ok: true });
      },
    });
    expect(screen.queryByTestId('reminder.preset.before_30m')).toBeNull();
    await fireEvent.press(screen.getByTestId('reminder.notify'));
    await fireEvent.press(screen.getByTestId('reminder.preset.this_evening'));
    expect(screen.getByTestId('reminder.submit')).toHaveTextContent(/^Ertele · /);
    await fireEvent.press(screen.getByTestId('reminder.submit'));
    await waitFor(() => {
      expect(db.rpcCalls.find((c) => c.name === 'set_insight_status')?.args).toMatchObject({
        p_insight_id: M3.insight,
        p_status: 'snoozed',
      });
    });
    expect(events('reminder_created').at(-1)?.props).toEqual({
      preset: 'custom',
      destination: 'in_app',
      mode: 'snooze',
      queued: false,
    });
  });
});

describe('M-REM-03 · destination', () => {
  const microsoft = {
    ...googleAccount,
    id: MS_ACCOUNT,
    provider: 'microsoft' as const,
    account_email: 'ahmet@sirket.example',
  };

  it('sends a Google Tasks reminder as a task_create approval and saves the default', async () => {
    const newId = uuid(1903);
    const { api, db } = await openSheet({
      accounts: [googleAccount, microsoft],
      setup: (fake) => {
        fake.setTable('tasks', [
          { connected_account_id: googleAccount.id, provider_list_id: 'list-1' },
        ]);
      },
      routes: {
        'POST /approvals': () =>
          json(
            201,
            ok(
              approvalView({
                id: newId,
                idempotency_key: `approval:${newId}:v1`,
                action_type: 'task_create',
                type_label_key: 'approvals.types.task_create',
                origin: 'reminder_sheet',
                side_effects: [],
                destination: {
                  target_kind: 'provider',
                  provider: 'google',
                  account_label: 'ahmet@example.com',
                  container_label: null,
                },
              }),
            ),
          ),
      },
    });
    await fireEvent.press(screen.getByTestId('reminder.destination'));
    const list = await screen.findByTestId('reminder.destinations');
    // Microsoft To Do needs a known list: without one nothing is selected.
    await fireEvent.press(within(list).getByTestId(`reminder.dest.${MS_ACCOUNT}`));
    expect(screen.getByTestId('reminder.destinations')).toBeOnTheScreen();
    await fireEvent.press(within(list).getByTestId(`reminder.dest.${googleAccount.id}`));
    expect(
      await screen.findByText('Nereye: Google Görevler · ahmet@example.com'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reminder.destination'));
    await fireEvent.press(await screen.findByTestId('reminder.dest.default'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'user_preferences',
        values: {
          default_reminder_destination: {
            kind: 'google_tasks',
            account_id: googleAccount.id,
            list_id: 'list-1',
          },
        },
      });
    });
    await fireEvent.press(screen.getByTestId('reminder.back'));
    await fireEvent.press(await screen.findByTestId('reminder.preset.tomorrow_morning'));
    expect(screen.getByTestId('reminder.submit')).toHaveTextContent('Onaya Gönder');
    await fireEvent.press(screen.getByTestId('reminder.submit'));
    expect(await screen.findByTestId(`approvalSheet.single.${newId}`)).toBeOnTheScreen();
    expect(api.calls.find((c) => c.url.endsWith('/approvals'))?.body).toMatchObject({
      payload: {
        action_type: 'task_create',
        target: {
          kind: 'provider',
          connected_account_id: googleAccount.id,
          task_list_id: 'list-1',
        },
        title: 'Sözleşme',
        due: { kind: 'date', date: '2026-09-25' },
      },
      origin: 'reminder_sheet',
    });
    expect(events('reminder_destination_select').map((e) => e.props.destination)).toEqual([
      'google_tasks',
    ]);
  });

  it('preselects the stored default destination and blocks external reminders offline', async () => {
    await openSheet({
      setup: (db) => {
        db.setTable('user_preferences', [
          {
            default_reminder_destination: {
              kind: 'google_tasks',
              account_id: googleAccount.id,
              list_id: 'list-1',
            },
          },
        ]);
      },
    });
    expect(
      await screen.findByText('Nereye: Google Görevler · ahmet@example.com'),
    ).toBeOnTheScreen();
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByTestId('reminder.preset.tomorrow_morning'));
    expect(await screen.findAllByText('Bağlantı gerekli')).not.toHaveLength(0);
    expect(screen.getByTestId('reminder.submit')).toBeDisabled();
  });

  it('explains a denied Apple Reminders permission and offers connecting an account', async () => {
    jest
      .mocked(Calendar.requestRemindersPermissionsAsync)
      .mockResolvedValueOnce({ status: 'denied', canAskAgain: false, granted: false } as never);
    const { router } = await openSheet({ accounts: [] });
    await fireEvent.press(screen.getByTestId('reminder.destination'));
    await fireEvent.press(await screen.findByTestId('reminder.dest.apple'));
    expect(await screen.findByText('İzin verilmedi · Ayarlar')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reminder.dest.connect'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/accounts');
    });
  });
});
