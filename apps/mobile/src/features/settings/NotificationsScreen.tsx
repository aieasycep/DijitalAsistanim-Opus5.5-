/**
 * M-SET-20 "Bildirimler" (`/settings/notifications`) and M-SET-21 quiet hours (sheet,
 * `?sheet=quiet-hours`): the real OS permission (banner + request/settings handoff), the smart
 * filter, the per-category switches of `notification_preferences` (+ `weekly_enabled`), the detail
 * level with a preview rendered from the push catalogue, lock-screen privacy (R-12), quiet hours
 * with the VIP bypass (R-13, default 22:30–07:30) and the daily-cap promise (R-14). Every control
 * auto-saves (queued offline); "Test bildirimi gönder" calls `POST /notifications/test` (blocked
 * offline) and reports the server decision truthfully.
 */
import { isApiError } from '@da/api-client';
import { notificationTestMutationOptions } from '@da/api-client/react';
import type { NotificationDetail } from '@da/domain';
import { androidChannelFor } from '@da/domain/notifications/channels';
import {
  BottomSheet,
  Button,
  ChoiceChip,
  ListRow,
  NotificationPreview,
  PermissionCard,
  Text,
  TimeChip,
} from '@da/ui';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { useBootstrap } from '@da/api-client/react';
import { useMutation } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { installationId } from '../../lib/auth/first-run-purge';
import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import {
  currentNotificationPermission,
  registerPushToken,
  requestNotificationPermission,
  type OsPermission,
} from '../onboarding/push';
import { isPro, openProGate, type GateFeature } from '../pro-gate/ProGate';
import { saveNotificationPreferences, saveUserPreferences, usePendingSettings } from './save';
import { TimeSheet } from './TimeSheet';
import { Caption, SettingsGroup, SettingsPage } from './ui';

type NotificationPrefs = BootstrapData['notification_preferences'];
type CategoryKey =
  | 'morning'
  | 'midday'
  | 'evening'
  | 'critical_email'
  | 'meeting'
  | 'deadline'
  | 'follow_up'
  | 'approval'
  | 'life_intel'
  | 'account';

const PRO_CATEGORIES: Readonly<Partial<Record<CategoryKey, GateFeature>>> = {
  midday: 'midday',
  evening: 'evening',
  follow_up: 'followups',
};
const DETAILS: readonly NotificationDetail[] = ['full', 'title_only', 'generic'];
/** ISO weekday → `common.weekdays` key. */
export const WEEKDAYS = [
  [1, 'mon'],
  [2, 'tue'],
  [3, 'wed'],
  [4, 'thu'],
  [5, 'fri'],
  [6, 'sat'],
  [7, 'sun'],
] as const;

interface PermissionState {
  readonly status: OsPermission | 'provisional';
  /** iOS `allowsPreviews` (0 never, 1 always, 2 when unlocked). */
  readonly previews: number | null;
}

async function readPermission(): Promise<PermissionState> {
  const status = await currentNotificationPermission();
  try {
    const settings = await Notifications.getPermissionsAsync();
    const ios = settings.ios as { allowsPreviews?: number; status?: number } | undefined;
    return {
      status: ios?.status === 3 ? 'provisional' : status,
      previews: typeof ios?.allowsPreviews === 'number' ? ios.allowsPreviews : null,
    };
  } catch {
    return { status, previews: null };
  }
}

/** Android channels (R-12) the user blocked in the system settings (importance NONE). */
async function blockedAndroidChannels(): Promise<readonly string[]> {
  if (Platform.OS !== 'android') return [];
  try {
    const channels = await Notifications.getNotificationChannelsAsync();
    return channels
      .filter((c) => c.importance === Notifications.AndroidImportance.NONE)
      .map((c) => c.id);
  } catch {
    return [];
  }
}

/** The effective level the server renders: lock-screen privacy caps it at `title_only`. */
export function effectiveDetail(prefs: NotificationPrefs): NotificationDetail {
  return prefs.lock_screen_private && prefs.detail_level === 'full'
    ? 'title_only'
    : prefs.detail_level;
}

export function QuietHoursSheet({
  visible,
  prefs,
  pro,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly prefs: NotificationPrefs;
  readonly pro: boolean;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const [enabled, setEnabled] = useState(prefs.quiet_hours_enabled);
  const [start, setStart] = useState(prefs.quiet_start);
  const [end, setEnd] = useState(prefs.quiet_end);
  const [days, setDays] = useState<readonly number[]>(
    prefs.quiet_days.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : prefs.quiet_days,
  );
  const [vip, setVip] = useState(prefs.vip_bypass_quiet);
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [saving, setSaving] = useState(false);
  const invalid = enabled && start === end;
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('notifications.settings.quietHours.title')}
      testID="sheet.quietHours"
      footer={
        <View style={styles.buttons}>
          <Button
            label={t('common.actions.save')}
            variant="ink"
            fullWidth
            loading={saving}
            disabled={invalid}
            onPress={() => {
              setSaving(true);
              track('quiet_hours_changed', {
                enabled,
                days_count: days.length,
                vip_bypass: vip,
              });
              void saveNotificationPreferences({
                quiet_hours_enabled: enabled,
                quiet_start: start,
                quiet_end: end,
                quiet_days: [...days].sort(),
                vip_bypass_quiet: vip,
              }).then((result) => {
                setSaving(false);
                if (result !== 'failed') onDismiss();
              });
            }}
            testID="quietHours.save"
          />
          <Button
            label={t('common.actions.nevermind')}
            variant="text"
            fullWidth
            onPress={onDismiss}
          />
        </View>
      }
    >
      <ListRow
        title={t('notifications.settings.quietHours.toggle')}
        trailing={{ kind: 'switch', value: enabled }}
        onPress={() => {
          setEnabled(!enabled);
        }}
        testID="quietHours.enabled"
      />
      {enabled ? (
        <>
          <View style={styles.timeRow}>
            <Text variant="rowTitle">{t('notifications.settings.quietHours.start')}</Text>
            <TimeChip
              value={start}
              accessibilityLabel={t('settings.time.chipA11y', {
                title: t('notifications.settings.quietHours.start'),
                time: start,
              })}
              onPress={() => {
                setPicker('start');
              }}
              testID="quietHours.start"
            />
          </View>
          <View style={styles.timeRow}>
            <Text variant="rowTitle">{t('notifications.settings.quietHours.end')}</Text>
            <TimeChip
              value={end}
              accessibilityLabel={t('settings.time.chipA11y', {
                title: t('notifications.settings.quietHours.end'),
                time: end,
              })}
              onPress={() => {
                setPicker('end');
              }}
              testID="quietHours.end"
            />
          </View>
          <View style={styles.chips} accessibilityRole="none">
            {WEEKDAYS.map(([day, key]) => {
              const selected = days.includes(day);
              return (
                <ChoiceChip
                  key={key}
                  label={t(`common.weekdays.short.${key}`)}
                  selected={selected}
                  accessibilityLabel={`${t(`common.weekdays.long.${key}`)}${selected ? `, ${t('common.a11y.selected')}` : ''}`}
                  onPress={() => {
                    setDays(selected ? days.filter((d) => d !== day) : [...days, day]);
                  }}
                  testID={`quietHours.day.${String(day)}`}
                />
              );
            })}
          </View>
          {invalid ? (
            <Text variant="bodySm" tone="critical" testID="quietHours.invalid">
              {t('settings.quietHours.sameTime')}
            </Text>
          ) : null}
        </>
      ) : null}
      <Text variant="kicker" tone="secondary">
        {t('notifications.settings.quietHours.bypassSection')}
      </Text>
      {pro ? (
        <ListRow
          title={t('notifications.settings.quietHours.vip.title')}
          subtitle={t('notifications.settings.quietHours.vip.meta')}
          trailing={{ kind: 'switch', value: vip }}
          onPress={() => {
            setVip(!vip);
          }}
          testID="quietHours.vip"
        />
      ) : (
        <ListRow
          title={t('notifications.settings.quietHours.vip.title')}
          subtitle={t('notifications.settings.quietHours.vip.meta')}
          trailing={{ kind: 'value', text: t('common.badges.pro') }}
          onPress={() => {
            openProGate('vip');
          }}
          testID="quietHours.vip"
        />
      )}
      <ListRow
        title={t('notifications.settings.quietHours.ownReminders.title')}
        subtitle={t('notifications.settings.quietHours.ownReminders.meta')}
      />
      <Caption>{t('notifications.settings.quietHours.note')}</Caption>
      {picker === null ? null : (
        <TimeSheet
          key={picker}
          visible
          title={
            picker === 'start'
              ? t('notifications.settings.quietHours.start')
              : t('notifications.settings.quietHours.end')
          }
          value={picker === 'start' ? start : end}
          onDone={(value) => {
            if (picker === 'start') setStart(value);
            else setEnd(value);
            setPicker(null);
          }}
          onDismiss={() => {
            setPicker(null);
          }}
        />
      )}
    </BottomSheet>
  );
}

export function NotificationsScreen() {
  const t = useTranslations();
  const router = useRouter();
  const online = useOnline();
  const pending = usePendingSettings();
  const params = useLocalSearchParams<{ sheet?: string }>();
  const bootstrap = useBootstrap();
  const data = bootstrap.data;
  const pro = data?.entitlement.is_active ?? isPro();
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [blocked, setBlocked] = useState<readonly string[]>([]);
  const [quietOpen, setQuietOpen] = useState(params.sheet === 'quiet-hours');
  const [fullConfirm, setFullConfirm] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const test = useMutation(notificationTestMutationOptions(getApiClient()));

  const refreshPermission = useCallback(() => {
    let alive = true;
    void readPermission().then((value) => {
      if (alive) setPermission(value);
    });
    void blockedAndroidChannels().then((ids) => {
      if (alive) setBlocked(ids);
    });
    return () => {
      alive = false;
    };
  }, []);
  useFocusEffect(refreshPermission);
  useEffect(() => {
    // Re-read after returning from the system settings (AppState active).
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPermission();
    });
    return () => {
      sub.remove();
    };
  }, [refreshPermission]);

  if (data === undefined) {
    return (
      <SettingsPage
        title={t('notifications.settings.title')}
        testID="screen.settings.notifications"
      />
    );
  }
  const prefs = data.notification_preferences;
  const userPrefs = data.preferences;

  const toggle = (category: CategoryKey) => {
    const next = !prefs[category];
    track('notification_pref_changed', { category, enabled: next });
    void saveNotificationPreferences({ [category]: next });
  };

  const categoryRow = (category: CategoryKey) => {
    const title = t(`notifications.settings.categories.${category}.title`);
    const meta = t(`notifications.settings.categories.${category}.meta`);
    const gate = PRO_CATEGORIES[category];
    if (gate !== undefined && !pro) {
      return (
        <ListRow
          key={category}
          title={title}
          subtitle={meta}
          trailing={{ kind: 'value', text: t('common.badges.pro') }}
          accessibilityLabel={t('settings.hub.lockedA11y', { title })}
          onPress={() => {
            openProGate(gate);
          }}
          testID={`notifications.${category}`}
        />
      );
    }
    if (Platform.OS === 'android' && blocked.includes(androidChannelFor(category))) {
      // R-12: the user turned this channel off in Android settings; only Android can turn it on.
      return (
        <ListRow
          key={category}
          title={title}
          subtitle={t('notifications.settings.channelBlocked')}
          trailing={{ kind: 'link', text: t('common.actions.openSettings') }}
          onPress={() => {
            void Linking.openSettings();
          }}
          testID={`notifications.${category}`}
        />
      );
    }
    const slotOff =
      (category === 'morning' && !userPrefs.morning_enabled) ||
      (category === 'midday' && !userPrefs.midday_enabled) ||
      (category === 'evening' && !userPrefs.evening_enabled);
    if (slotOff) {
      return (
        <ListRow
          key={category}
          title={title}
          subtitle={t('notifications.settings.briefingOff')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            router.push('/settings/briefings');
          }}
          testID={`notifications.${category}`}
        />
      );
    }
    return (
      <ListRow
        key={category}
        title={title}
        subtitle={meta}
        trailing={{ kind: 'switch', value: prefs[category] }}
        onPress={() => {
          toggle(category);
        }}
        testID={`notifications.${category}`}
      />
    );
  };

  const setDetail = (mode: NotificationDetail, unlock = false) => {
    track('notification_detail_changed', { mode });
    if (unlock) track('lock_screen_private_changed', { enabled: false });
    void saveNotificationPreferences(
      unlock ? { detail_level: mode, lock_screen_private: false } : { detail_level: mode },
    );
  };

  const promise = `${t('notifications.promise')} ${t('notifications.dailyCap', { dailyCap: prefs.daily_cap })}`;
  const previewMode = effectiveDetail(prefs);
  const sample = {
    sender: t('notifications.settings.preview.sender'),
    subject: t('notifications.settings.preview.subject'),
    expectedAction: t('notifications.settings.preview.action'),
  };
  const previewTitle = t(`push.critical_email.reply_needed.${previewMode}.title`, sample);
  const previewBody = t(`push.critical_email.reply_needed.${previewMode}.body`, sample);

  const sendTest = () => {
    const install = installationId();
    if (install === null) {
      showToast({ message: t('notifications.settings.test.noPermission'), kind: 'error' });
      return;
    }
    test.mutate(
      {
        body: { installation_id: install, category: 'critical_email' },
        idempotencyKey: Crypto.randomUUID(),
      },
      {
        onSuccess: (result) => {
          track('notification_test_sent', { mode: previewMode, category: 'critical_email' });
          if (result.deferred_until === null) {
            showToast({ message: t('notifications.settings.test.sent'), kind: 'success' });
          } else {
            track('notification_test_blocked', { reason: 'quiet_hours' });
            showToast({ message: t('notifications.settings.test.suppressedQuiet') });
          }
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'RATE_LIMITED') {
            track('notification_test_blocked', { reason: 'rate_limited' });
            showToast({ message: t('settings.notificationTest.rateLimited'), kind: 'error' });
          } else if (isApiError(error) && error.code === 'STATE_CONFLICT') {
            track('notification_test_blocked', { reason: 'no_device' });
            showToast({ message: t('notifications.settings.test.noPermission'), kind: 'error' });
          } else {
            showToast({ message: t('states.error.action.title'), kind: 'error' });
          }
        },
      },
    );
  };

  const banner = (() => {
    if (permission === null || permission.status === 'granted') return null;
    if (permission.status === 'provisional') {
      return (
        <PermissionCard
          icon="notifications_off"
          title={t('notifications.settings.permission.provisionalTitle')}
          primaryAction={{
            label: t('notifications.settings.permission.provisionalCta'),
            onPress: () => {
              void Linking.openSettings();
            },
          }}
          testID="notifications.banner"
        />
      );
    }
    if (permission.status === 'undetermined') {
      return (
        <PermissionCard
          icon="notifications_off"
          title={t('notifications.settings.permission.undeterminedTitle')}
          primaryAction={{
            label: t('notifications.settings.permission.allowCta'),
            loading: requesting,
            onPress: () => {
              setRequesting(true);
              void requestNotificationPermission()
                .then(async (result) => {
                  track('notification_permission_prompted', {
                    result: result === 'undetermined' ? 'denied' : result,
                  });
                  if (result === 'granted') await registerPushToken();
                  refreshPermission();
                })
                .finally(() => {
                  setRequesting(false);
                });
            },
          }}
          testID="notifications.banner"
        />
      );
    }
    return (
      <PermissionCard
        icon="notifications_off"
        title={t('notifications.settings.permission.deniedTitle')}
        body={t('notifications.settings.permission.deniedBody')}
        primaryAction={{
          label: t('common.actions.openSettings'),
          onPress: () => {
            void Linking.openSettings();
          },
        }}
        testID="notifications.banner"
      />
    );
  })();

  return (
    <SettingsPage title={t('notifications.settings.title')} testID="screen.settings.notifications">
      {banner}
      {permission !== null && permission.status !== 'granted' ? (
        <Caption>{t('settings.notificationsScreen.noPermissionCaption')}</Caption>
      ) : null}
      {pending ? (
        <Caption testID="notifications.queued">{t('states.offline.queued')}</Caption>
      ) : null}
      <SettingsGroup>
        <ListRow
          title={t('notifications.settings.smartFilter.title')}
          subtitle={t('notifications.settings.smartFilter.meta')}
          trailing={{ kind: 'switch', value: prefs.smart_filter }}
          onPress={() => {
            track('notification_smart_filter_changed', { enabled: !prefs.smart_filter });
            void saveNotificationPreferences({ smart_filter: !prefs.smart_filter });
          }}
          testID="notifications.smartFilter"
        />
      </SettingsGroup>
      <SettingsGroup title={t('notifications.settings.sections.briefings')}>
        {categoryRow('morning')}
        {categoryRow('midday')}
        {categoryRow('evening')}
        <ListRow
          title={t('notifications.settings.categories.weekly.title')}
          subtitle={t('notifications.settings.categories.weekly.meta')}
          trailing={{ kind: 'switch', value: userPrefs.weekly_enabled }}
          onPress={() => {
            track('notification_pref_changed', {
              category: 'evening',
              enabled: !userPrefs.weekly_enabled,
            });
            void saveUserPreferences({ weekly_enabled: !userPrefs.weekly_enabled });
          }}
          testID="notifications.weekly"
        />
      </SettingsGroup>
      <SettingsGroup title={t('notifications.settings.sections.instant')}>
        {categoryRow('critical_email')}
        {categoryRow('meeting')}
        {categoryRow('deadline')}
        {categoryRow('follow_up')}
        {categoryRow('approval')}
      </SettingsGroup>
      <SettingsGroup title={t('notifications.settings.sections.lifeIntel')}>
        {categoryRow('life_intel')}
      </SettingsGroup>
      <SettingsGroup title={t('notifications.settings.sections.account')}>
        {categoryRow('account')}
      </SettingsGroup>
      <SettingsGroup title={t('notifications.settings.sections.detail')}>
        {DETAILS.map((mode) => (
          <ListRow
            key={mode}
            title={t(`notifications.settings.detail.${mode}.title`)}
            subtitle={t(`notifications.settings.detail.${mode}.meta`)}
            trailing={{ kind: 'radio', selected: prefs.detail_level === mode }}
            onPress={() => {
              if (mode === prefs.detail_level) return;
              if (mode === 'full' && prefs.lock_screen_private) setFullConfirm(true);
              else setDetail(mode);
            }}
            testID={`notifications.detail.${mode}`}
          />
        ))}
      </SettingsGroup>
      {prefs.detail_level === 'full' && !prefs.lock_screen_private ? (
        <Caption>{t('notifications.settings.lockScreen.fullVisibleNote')}</Caption>
      ) : null}
      <NotificationPreview
        items={[
          {
            key: 'sample',
            appName: t('common.app.name'),
            time: t('common.time.now'),
            body: `${previewTitle}\n${previewBody}`,
          },
        ]}
        accessibilityLabel={`${previewTitle}. ${previewBody}`}
        testID="notifications.preview"
      />
      <Button
        label={t('notifications.settings.test.cta')}
        variant="tonal"
        loading={test.isPending}
        disabled={!online}
        {...(online ? {} : { accessibilityHint: t('states.offline.blockedReason') })}
        onPress={sendTest}
        testID="notifications.test"
      />
      <SettingsGroup title={t('notifications.settings.sections.lockScreen')}>
        <ListRow
          title={t('notifications.settings.lockScreen.toggle')}
          subtitle={t('notifications.settings.lockScreen.meta')}
          trailing={{ kind: 'switch', value: prefs.lock_screen_private }}
          onPress={() => {
            track('lock_screen_private_changed', { enabled: !prefs.lock_screen_private });
            void saveNotificationPreferences({ lock_screen_private: !prefs.lock_screen_private });
          }}
          testID="notifications.lockScreen"
        />
        {Platform.OS === 'ios' && typeof permission?.previews === 'number' ? (
          <ListRow
            title={t('notifications.settings.lockScreen.iosPreviews')}
            subtitle={t('notifications.settings.lockScreen.iosCaption')}
            trailing={{
              kind: 'value',
              text:
                permission.previews === 1
                  ? t('notifications.settings.lockScreen.previewAlways')
                  : permission.previews === 2
                    ? t('notifications.settings.lockScreen.previewUnlocked')
                    : t('notifications.settings.lockScreen.previewNever'),
              chevron: true,
            }}
            onPress={() => {
              void Linking.openSettings();
            }}
            accessibilityHint={t('notifications.settings.lockScreen.changeInSettings')}
            testID="notifications.iosPreviews"
          />
        ) : null}
      </SettingsGroup>
      {Platform.OS === 'android' ? (
        <Caption testID="notifications.androidChannels">
          {t('settings.notificationsScreen.androidChannels')}
        </Caption>
      ) : null}
      <SettingsGroup title={t('notifications.settings.sections.quietHours')}>
        <ListRow
          title={t('notifications.settings.quietHours.title')}
          trailing={{
            kind: 'value',
            text: prefs.quiet_hours_enabled
              ? t('notifications.settings.quietHours.range', {
                  start: prefs.quiet_start,
                  end: prefs.quiet_end,
                })
              : t('notifications.settings.quietHours.off'),
            chevron: true,
          }}
          onPress={() => {
            setQuietOpen(true);
          }}
          testID="notifications.quietHours"
        />
      </SettingsGroup>
      <Caption testID="notifications.promise">{promise}</Caption>

      {quietOpen ? (
        <QuietHoursSheet
          visible
          prefs={prefs}
          pro={pro}
          onDismiss={() => {
            setQuietOpen(false);
          }}
        />
      ) : null}
      <BottomSheet
        visible={fullConfirm}
        onDismiss={() => {
          setFullConfirm(false);
        }}
        title={t('notifications.settings.lockScreen.fullNeedsOff')}
        testID="sheet.fullDetail"
        footer={
          <View style={styles.buttons}>
            <Button
              label={t('notifications.settings.lockScreen.applyCta')}
              variant="ink"
              fullWidth
              onPress={() => {
                setFullConfirm(false);
                setDetail('full', true);
              }}
              testID="fullDetail.apply"
            />
            <Button
              label={t('common.actions.nevermind')}
              variant="text"
              fullWidth
              onPress={() => {
                setFullConfirm(false);
              }}
            />
          </View>
        }
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 8 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
});
