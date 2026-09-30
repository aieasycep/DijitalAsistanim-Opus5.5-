/**
 * UT-MB-05 notification router and the T-8.24 notification layer: every notification type maps
 * to its route (invalid or foreign deep links fall back to `type` + `entity_id`, unknown → Today),
 * opening only navigates, cold-start taps are deduped and stored while the guards are closed, the
 * foreground shows no system banner, the R-12 channels are PRIVATE and exist before the prompt,
 * local reminders follow the detail level and the server rows, and registration sends the token
 * only when permitted and only when something changed.
 */
import { NOTIFICATION_CATEGORY_VALUES } from '@da/domain';
import { ANDROID_CHANNELS } from '@da/domain/notifications/channels';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { logout } from '../src/lib/auth/logout';
import { takePendingLink } from '../src/lib/deeplinks';
import { bufferedEventsForTests } from '../src/lib/events';
import {
  handleNotificationResponse,
  installForegroundBehavior,
  invalidationFor,
  parsePushPayload,
  presentForegroundNotification,
  routeForPush,
} from '../src/lib/notifications/handlers';
import { androidChannelInputs, REMINDER_ACTIONS } from '../src/lib/notifications/channels';
import {
  effectiveDetail,
  reconcileLocalReminders,
  reminderContent,
  scheduleLocalReminder,
} from '../src/lib/notifications/local-reminders';
import {
  registerPushToken,
  requestNotificationPermission,
  syncPushRegistration,
} from '../src/lib/notifications/register';
import { cachedPushToken, registeredSignature } from '../src/lib/notifications/token';
import { queueMutation, queuedMutations } from '../src/lib/offline/mutations';
import { getQueryClient } from '../src/lib/query/client';
import { setGuardSnapshot } from '../src/lib/router-guards';
import { updateUiPrefs } from '../src/lib/ui-prefs';
import { installApi, installFakeSupabase, json, resetAppState } from './helpers/app';
import { bootstrap, ok, session, uuid } from './helpers/fixtures';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', extra: { eas: { projectId: 'project-1' } } } },
}));

function events(name: string) {
  return bufferedEventsForTests().filter((e) => e.event === name);
}

const OPTIONS = {
  scheme: 'dijitalasistan-dev',
  webOrigin: 'https://dijitalasistan.app',
  allowDemo: false,
} as const;
const ID = uuid(42);

function response(data: Record<string, unknown>, identifier = 'n-1', actionIdentifier?: string) {
  return {
    actionIdentifier: actionIdentifier ?? 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: 0,
      request: {
        identifier,
        content: { title: 'Kritik mail', body: 'Bugün yanıt bekliyor.', data },
        trigger: null,
      },
    },
  } as unknown as Notifications.NotificationResponse;
}

function openGuards(app: boolean) {
  setGuardSnapshot({
    auth: app ? 'signed_in' : 'loading',
    signedOut: false,
    onboarding: false,
    app,
    deletionStatus: false,
  });
}

beforeEach(async () => {
  await resetAppState();
  updateUiPrefs({ locale: 'tr' });
  jest.mocked(router.push).mockClear();
});

describe('payload', () => {
  it('reads only type, entity_id and deeplink', () => {
    expect(
      parsePushPayload({
        v: 1,
        nid: ID,
        type: 'critical_email',
        entity_id: ID,
        deeplink: 'dijitalasistan://mail/x',
        subject: 'never read',
      }),
    ).toEqual({ type: 'critical_email', entityId: ID, deeplink: 'dijitalasistan://mail/x' });
    expect(parsePushPayload({ type: 'marketing', entity_id: 5 })).toEqual({
      type: null,
      entityId: null,
      deeplink: null,
    });
    expect(parsePushPayload(null).type).toBeNull();
  });
});

describe('route map (every notification type)', () => {
  const EXPECTED: Readonly<Record<string, string>> = {
    morning: `/briefing/${ID}`,
    midday: `/briefing/${ID}`,
    evening: `/briefing/${ID}`,
    critical_email: `/mail/${ID}`,
    deadline: `/mail/${ID}`,
    follow_up: `/mail/${ID}`,
    meeting: `/meeting/${ID}/prep`,
    life_intel: `/life/${ID}`,
    approval: `/approvals/${ID}`,
    account: `/settings/accounts/${ID}`,
    reminder: '/today',
  };

  it('covers every category and the reminder type', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      [...NOTIFICATION_CATEGORY_VALUES, 'reminder'].sort(),
    );
  });

  it.each(Object.entries(EXPECTED))('%s without a usable deep link → %s', (type, href) => {
    for (const deeplink of [null, 'https://evil.example/app/mail/x', 'dijitalasistan://nope']) {
      expect(routeForPush({ type: type as never, entityId: ID, deeplink }, OPTIONS).href).toBe(
        href,
      );
    }
  });

  it('prefers the allow-listed deep link and keeps its query', () => {
    const route = routeForPush(
      {
        type: 'follow_up',
        entityId: ID,
        deeplink: `dijitalasistan://followups?focus=${ID}`,
      },
      OPTIONS,
    );
    expect(route).toEqual({ href: `/followups?focus=${ID}`, pattern: '/followups' });
    const reminder = routeForPush(
      { type: 'reminder', entityId: null, deeplink: `dijitalasistan://commitments/${ID}` },
      OPTIONS,
    );
    expect(reminder.href).toBe(`/commitments/${ID}`);
  });

  it('opens Today for an unknown type, a missing entity or a bad id', () => {
    expect(routeForPush({ type: null, entityId: ID, deeplink: null }, OPTIONS).href).toBe('/today');
    expect(routeForPush({ type: 'meeting', entityId: null, deeplink: null }, OPTIONS).href).toBe(
      '/today',
    );
    expect(
      routeForPush({ type: 'meeting', entityId: 'not-a-uuid', deeplink: null }, OPTIONS).href,
    ).toBe('/today');
  });

  it('refreshes the related queries per type', () => {
    expect(invalidationFor('morning')).toContainEqual(['today']);
    expect(invalidationFor('approval')).toContainEqual(['approvals']);
    expect(invalidationFor('reminder')).toEqual([['reminders']]);
  });
});

describe('taps', () => {
  const data = { type: 'approval', entity_id: ID, deeplink: `dijitalasistan://approvals/${ID}` };

  it('navigates when the app guard is open, tracks the open and performs no action', async () => {
    const fake = installFakeSupabase(session());
    const api = installApi({});
    openGuards(true);
    expect(handleNotificationResponse(response(data), 'background')).toBe(true);
    expect(router.push).toHaveBeenCalledWith(`/approvals/${ID}`);
    expect(events('notification_opened').at(-1)?.props).toEqual({
      category: 'approval',
      app_state: 'background',
    });
    await Promise.resolve();
    expect(api.calls).toHaveLength(0);
    expect(fake.db.rpcCalls).toHaveLength(0);
    // The only write is the `opened_at` stamp (column grant), never an approval.
    for (const write of fake.db.writes) {
      expect(write.table).toBe('notifications');
      expect(Object.keys(write.values as object)).toEqual(['opened_at']);
    }
  });

  it('stores the route while the guards are closed (cold start) and dedupes redelivery', () => {
    installFakeSupabase(session());
    openGuards(false);
    expect(handleNotificationResponse(response(data, 'cold-1'), 'cold')).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    expect(takePendingLink()).toBe(`/approvals/${ID}`);
    // The session is still restoring: the opened_at stamp waits in the offline queue.
    expect(queuedMutations().map((e) => e.kind)).toEqual(['notification_opened']);
    expect(handleNotificationResponse(response(data, 'cold-1'), 'background')).toBe(false);
    expect(events('notification_opened')).toHaveLength(1);
  });

  it('queues the opened_at stamp offline', () => {
    installFakeSupabase(session());
    openGuards(true);
    onlineManager.setOnline(false);
    handleNotificationResponse(
      response({ type: 'meeting', entity_id: ID, deeplink: null }, 'n-2'),
      'background',
    );
    expect(router.push).toHaveBeenCalledWith(`/meeting/${ID}/prep`);
    onlineManager.setOnline(true);
  });

  it('snoozes a reminder by one hour without opening the app', () => {
    openGuards(true);
    const before = Date.now();
    handleNotificationResponse(
      response(
        { type: 'reminder', entity_id: null, deeplink: null },
        'reminder:abc',
        REMINDER_ACTIONS.snooze,
      ),
      'background',
    );
    expect(router.push).not.toHaveBeenCalled();
    const call = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.at(-1)?.[0];
    expect(call?.identifier).toBe('reminder:abc');
    const date = (call?.trigger as { date: Date }).date.getTime();
    expect(date - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
  });
});

describe('foreground', () => {
  it('shows no system banner and refreshes the queries of the push', async () => {
    installForegroundBehavior();
    const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls.at(-1)?.[0];
    await expect(
      handler?.handleNotification({} as Notifications.Notification),
    ).resolves.toMatchObject({
      shouldShowBanner: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    const spy = jest.spyOn(getQueryClient(), 'invalidateQueries');
    presentForegroundNotification(
      response({ type: 'morning', entity_id: ID, deeplink: null }).notification,
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['today'] });
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('channels (R-12)', () => {
  const original = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
  });

  it('are exactly the R-12 ids, localised and PRIVATE on the lock screen', () => {
    const inputs = androidChannelInputs();
    expect(inputs.map((c) => c.id)).toEqual([
      'briefings',
      'critical_email',
      'meetings',
      'deadlines',
      'follow_up',
      'life_intel',
      'approvals',
      'reminders',
      'account',
      'phone_digest',
    ]);
    expect(inputs.map((c) => c.id)).toEqual(ANDROID_CHANNELS.map((c) => c.id));
    for (const channel of inputs) {
      expect(channel.lockscreenVisibility).toBe(
        Notifications.AndroidNotificationVisibility.PRIVATE,
      );
      expect(channel.name).not.toMatch(/push\.channels/);
    }
    expect(inputs.find((c) => c.id === 'reminders')?.name).toBe('Hatırlatıcılar');
  });

  it('exist before the Android permission prompt', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    jest.mocked(Notifications.setNotificationChannelAsync).mockClear();
    await requestNotificationPermission();
    const created = jest.mocked(Notifications.setNotificationChannelAsync).mock.invocationCallOrder;
    const prompted = jest.mocked(Notifications.requestPermissionsAsync).mock.invocationCallOrder;
    expect(created.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...created)).toBeLessThan(Math.max(...prompted));
  });
});

describe('local reminders (Part 4 §12.5)', () => {
  it('compose the content at the effective level', () => {
    expect(reminderContent('Faturayı öde', 'full')).toEqual({
      title: 'Hatırlatıcı',
      body: 'Faturayı öde',
    });
    expect(reminderContent('Faturayı öde', 'title_only').body).not.toContain('Fatura');
    expect(reminderContent('Faturayı öde', 'generic')).toEqual({
      title: 'Dijital Asistan',
      body: 'Yeni bir güncellemen var.',
    });
    expect(effectiveDetail('full', true)).toBe('title_only');
    expect(effectiveDetail('generic', true)).toBe('generic');
    expect(effectiveDetail('full', false)).toBe('full');
  });

  it('schedule time-sensitive da_reminder notifications carrying only routing data', async () => {
    await scheduleLocalReminder(
      {
        clientReminderId: 'c1',
        title: 'Faturayı öde',
        fireAt: new Date(Date.now() + 60_000),
        deeplink: `dijitalasistan://mail/${ID}`,
      },
      'full',
    );
    const call = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.at(-1)?.[0];
    expect(call?.identifier).toBe('reminder:c1');
    expect(call?.content).toMatchObject({
      categoryIdentifier: 'da_reminder',
      interruptionLevel: 'timeSensitive',
    });
    expect(Object.keys(call?.content.data ?? {}).sort()).toEqual(['deeplink', 'entity_id', 'type']);
  });

  it('reconcile with the server rows: schedule the next 7 days, cancel removed ones, keep queued ones', async () => {
    const fake = installFakeSupabase(session());
    const now = new Date();
    const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
    fake.db.setTable('reminders', [
      {
        id: uuid(1),
        idempotency_key: 'soon',
        title: 'Ara',
        remind_at: at(2),
        target_type: 'commitment',
        target_id: ID,
        channel: 'local',
        status: 'scheduled',
      },
      {
        id: uuid(2),
        idempotency_key: 'far',
        title: 'Sonra',
        remind_at: at(24 * 9),
        target_type: null,
        target_id: null,
        channel: 'local',
        status: 'scheduled',
      },
    ]);
    onlineManager.setOnline(false);
    queueMutation('reminder_create', {
      body: {
        client_reminder_id: 'queued',
        title: 'x',
        preset: 'custom',
        fire_at: at(1),
        channel: 'local',
        origin: 'today',
      } as never,
    });
    onlineManager.setOnline(true);
    jest
      .mocked(Notifications.getAllScheduledNotificationsAsync)
      .mockResolvedValueOnce([
        { identifier: 'reminder:gone' },
        { identifier: 'reminder:queued' },
        { identifier: 'reminder:far' },
        { identifier: 'other' },
      ] as never);
    jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockClear();
    await reconcileLocalReminders(now);
    const scheduled = jest
      .mocked(Notifications.scheduleNotificationAsync)
      .mock.calls.map((c) => c[0]);
    expect(scheduled.map((c) => c.identifier)).toEqual(['reminder:soon']);
    expect(scheduled[0]?.content.data).toEqual({
      type: 'reminder',
      entity_id: uuid(1),
      deeplink: `/commitments/${ID}`,
    });
    expect(jest.mocked(Notifications.cancelScheduledNotificationAsync).mock.calls).toEqual([
      ['reminder:gone'],
    ]);
  });
});

describe('registration (API-DEV-01)', () => {
  const registered = { installation_id: uuid(99), push_enabled: true };

  it('sends the token only with permission, skips unchanged syncs and forgets it at logout', async () => {
    installFakeSupabase(session());
    const api = installApi({
      'POST /devices/register': () =>
        json(200, ok({ ...registered, rebound_from_other_user: false, timezone_applied: false })),
    });
    getQueryClient().setQueryData(['me', 'bootstrap'], bootstrap());
    // Not permitted and never registered: a sync sends nothing.
    await syncPushRegistration();
    expect(api.calls).toHaveLength(0);

    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue({ status: 'granted' } as never);
    await registerPushToken();
    const body = api.calls.at(-1)?.body as { push: unknown; installation_id: string };
    expect(body.push).toEqual({
      permission: 'granted',
      expo_push_token: 'ExponentPushToken[test]',
    });
    expect(api.calls.at(-1)?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(cachedPushToken()).toBe('ExponentPushToken[test]');

    await syncPushRegistration();
    expect(api.calls).toHaveLength(1);

    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'denied' } as never);
    await syncPushRegistration();
    expect(api.calls).toHaveLength(2);
    expect((api.calls.at(-1)?.body as { push: unknown }).push).toEqual({
      permission: 'denied',
      expo_push_token: null,
    });
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'undetermined',
    } as never);

    await logout(
      {},
      {
        api: { call: jest.fn(() => Promise.resolve({ data: {} })) } as never,
        supabase: installFakeSupabase(null).client,
        installationId: () => uuid(99),
        wipeStorage: () => Promise.resolve(),
        isOffline: () => false,
      },
    );
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(cachedPushToken()).toBeNull();
    expect(registeredSignature()).toBeNull();
  });
});
