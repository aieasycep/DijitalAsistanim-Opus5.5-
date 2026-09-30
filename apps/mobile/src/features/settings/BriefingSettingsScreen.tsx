/**
 * M-SET-23 "Brifing" (`/settings/briefings`): per-slot enablement and times (Pro slots locked for
 * Free users → gate), the weekly summary, the weekend mode, the silent days (the complement of
 * `briefing_weekdays`) and the timezone (M-SET-25 sheet: automatic from the device or a manual IANA
 * zone). Times are validated (≥ 60 min apart in order morning < midday < evening) and warn when a
 * slot falls inside quiet hours (R-13). The server's `scheduler_tick()` reads these every minute.
 */
import { useBootstrap } from '@da/api-client/react';
import {
  BottomSheet,
  ChoiceChip,
  ListRow,
  SearchField,
  Switch,
  Text,
  TimeChip,
  useTheme,
} from '@da/ui';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { deviceTimeZone } from '../../i18n/I18nProvider';
import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { updateUiPrefs } from '../../lib/ui-prefs';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { WEEKDAYS } from './NotificationsScreen';
import { saveUserPreferences, usePendingSettings } from './save';
import { TimeSheet, toMinutes } from './TimeSheet';
import { allZones, cityOf, zoneLabel } from './timezones';
import { Caption, SettingsGroup, SettingsPage } from './ui';

type Prefs = BootstrapData['preferences'];
type Slot = 'morning' | 'midday' | 'evening';
type TimeField = 'morning_time' | 'midday_time' | 'evening_time' | 'weekend_morning_time';

const MIN_GAP = 60;

export type ScheduleError = 'middayAfterMorning' | 'eveningAfterMidday' | null;

/** Order and ≥ 60 min gaps between the enabled slots. */
export function scheduleError(
  prefs: Pick<Prefs, `${Slot}_time` | `${Slot}_enabled`>,
): ScheduleError {
  const morning = toMinutes(prefs.morning_time);
  const midday = toMinutes(prefs.midday_time);
  const evening = toMinutes(prefs.evening_time);
  if (prefs.midday_enabled && midday - morning < MIN_GAP) return 'middayAfterMorning';
  if (prefs.evening_enabled && evening - (prefs.midday_enabled ? midday : morning) < MIN_GAP) {
    return 'eveningAfterMidday';
  }
  return null;
}

/** Whether a local time falls inside the quiet-hours window (which may cross midnight). */
export function insideQuietHours(
  time: string,
  quiet: Pick<
    BootstrapData['notification_preferences'],
    'quiet_hours_enabled' | 'quiet_start' | 'quiet_end'
  >,
): boolean {
  if (!quiet.quiet_hours_enabled) return false;
  const t = toMinutes(time);
  const start = toMinutes(quiet.quiet_start);
  const end = toMinutes(quiet.quiet_end);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

function timeBucket(
  time: string,
): 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' {
  const hour = Math.floor(toMinutes(time) / 60);
  if (hour < 7) return 'early_morning';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export function TimezoneSheet({
  visible,
  prefs,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly prefs: Prefs;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const theme = useTheme();
  const [manual, setManual] = useState(prefs.timezone_mode === 'manual');
  const [query, setQuery] = useState('');
  const at = now();
  const device = deviceTimeZone();
  const folded = query.trim().toLocaleLowerCase('tr-TR');
  const zones = allZones().filter(
    (zone) => folded === '' || zone.toLocaleLowerCase('tr-TR').replace(/_/g, ' ').includes(folded),
  );
  const choose = (mode: 'auto' | 'manual', zone: string) => {
    track('timezone_changed', { mode });
    updateUiPrefs({ timeZone: zone });
    void saveUserPreferences({ timezone_mode: mode, timezone: zone }).then(onDismiss);
  };
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('settings.briefings.timezone')}
      testID="sheet.timezone"
    >
      <ListRow
        title={t('settings.briefings.timezoneSheet.auto')}
        subtitle={t('settings.briefings.timezoneSheet.current', { zone: zoneLabel(device, at) })}
        trailing={{ kind: 'radio', selected: !manual }}
        onPress={() => {
          setManual(false);
          choose('auto', device);
        }}
        testID="timezone.auto"
      />
      <ListRow
        title={t('settings.briefings.timezoneSheet.manual')}
        trailing={{ kind: 'radio', selected: manual }}
        onPress={() => {
          setManual(true);
        }}
        testID="timezone.manual"
      />
      {manual ? (
        <View style={styles.zones}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder={t('settings.briefings.timezoneSheet.searchHint')}
            accessibilityLabel={t('settings.briefings.timezoneSheet.searchHint')}
            testID="timezone.search"
          />
          {zones.length === 0 ? (
            <Text variant="body" tone="secondary" testID="timezone.empty">
              {t('settings.briefings.timezoneSheet.empty')}
            </Text>
          ) : (
            <FlatList
              data={zones}
              keyExtractor={(zone) => zone}
              style={{ maxHeight: 320, backgroundColor: theme.color.surface }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <ListRow
                  title={cityOf(item)}
                  trailing={{
                    kind: 'value',
                    text: zoneLabel(item, at).replace(`${cityOf(item)} `, ''),
                  }}
                  onPress={() => {
                    choose('manual', item);
                  }}
                  testID={`timezone.zone.${item}`}
                />
              )}
            />
          )}
        </View>
      ) : null}
    </BottomSheet>
  );
}

export function BriefingSettingsScreen() {
  const t = useTranslations();
  const pending = usePendingSettings();
  const bootstrap = useBootstrap();
  const data = bootstrap.data;
  const pro = data?.entitlement.is_active ?? isPro();
  const [picker, setPicker] = useState<TimeField | null>(null);
  const [error, setError] = useState<{ field: TimeField; message: string } | null>(null);
  const [daysError, setDaysError] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);

  if (data === undefined) {
    return (
      <SettingsPage title={t('settings.briefings.title')} testID="screen.settings.briefings" />
    );
  }
  const prefs = data.preferences;
  const quiet = data.notification_preferences;

  const saveTime = (field: TimeField, value: string) => {
    const next = { ...prefs, [field]: value };
    const problem = field === 'weekend_morning_time' ? null : scheduleError(next);
    if (problem !== null) {
      setError({
        field,
        message:
          problem === 'middayAfterMorning'
            ? t('settings.briefingsScreen.middayAfterMorning')
            : t('settings.briefingsScreen.eveningAfterMidday'),
      });
      return;
    }
    setError(null);
    const kind =
      field === 'weekend_morning_time' ? 'morning' : (field.replace('_time', '') as Slot);
    track('briefing_schedule_changed', {
      kind,
      enabled:
        field === 'weekend_morning_time' ? prefs.weekend_morning_only : prefs[`${kind}_enabled`],
      time_bucket: timeBucket(value),
    });
    void saveUserPreferences({ [field]: value });
  };

  const slotRow = (slot: Slot, icon: 'wb_twilight' | 'wb_sunny' | 'bedtime') => {
    const title = t(`settings.briefings.rows.${slot}.title`);
    const locked = slot !== 'morning' && !pro;
    const enabled = prefs[`${slot}_enabled`];
    const field: TimeField = `${slot}_time`;
    const time = prefs[field];
    return (
      <View key={slot} style={styles.slot}>
        <ListRow
          icon={icon}
          title={title}
          subtitle={t(`settings.briefings.rows.${slot}.meta`)}
          trailing={
            locked
              ? { kind: 'value', text: t('common.badges.pro') }
              : {
                  kind: 'custom',
                  node: (
                    <View style={styles.trailing}>
                      <TimeChip
                        value={time}
                        accessibilityLabel={t('settings.time.chipA11y', { title, time })}
                        onPress={() => {
                          setPicker(field);
                        }}
                        testID={`briefings.${slot}.time`}
                      />
                      <Switch
                        value={enabled}
                        accessibilityLabel={title}
                        onValueChange={(next) => {
                          track('briefing_schedule_changed', {
                            kind: slot,
                            enabled: next,
                            time_bucket: timeBucket(time),
                          });
                          void saveUserPreferences({ [`${slot}_enabled`]: next });
                        }}
                        testID={`briefings.${slot}.switch`}
                      />
                    </View>
                  ),
                }
          }
          {...(locked
            ? {
                onPress: () => {
                  openProGate(slot === 'midday' ? 'midday' : 'evening');
                },
                accessibilityLabel: t('settings.hub.lockedA11y', { title }),
              }
            : {})}
          testID={`briefings.${slot}`}
        />
        {error?.field === field ? (
          <Text variant="bodySm" tone="critical" testID={`briefings.${slot}.error`}>
            {error.message}
          </Text>
        ) : !locked && enabled && insideQuietHours(time, quiet) ? (
          <Text variant="bodySm" tone="warning" testID={`briefings.${slot}.quiet`}>
            {t('settings.briefingsScreen.insideQuietHours')}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <SettingsPage
      title={t('settings.briefings.title')}
      subtitle={t('settings.briefings.subtitle')}
      testID="screen.settings.briefings"
    >
      {pending ? <Caption>{t('states.offline.queued')}</Caption> : null}
      <SettingsGroup>
        {slotRow('morning', 'wb_twilight')}
        {slotRow('midday', 'wb_sunny')}
        {slotRow('evening', 'bedtime')}
        <ListRow
          icon="date_range"
          title={t('settings.briefings.rows.weekly.title')}
          subtitle={t('settings.briefings.rows.weekly.meta', { time: prefs.weekly_time })}
          trailing={{ kind: 'switch', value: prefs.weekly_enabled }}
          onPress={() => {
            track('briefing_schedule_changed', {
              kind: 'weekly',
              enabled: !prefs.weekly_enabled,
              time_bucket: timeBucket(prefs.weekly_time),
            });
            void saveUserPreferences({ weekly_enabled: !prefs.weekly_enabled });
          }}
          testID="briefings.weekly"
        />
        <ListRow
          icon="weekend"
          title={t('settings.briefings.rows.weekend.title')}
          subtitle={t('settings.briefings.rows.weekend.meta', {
            time: prefs.weekend_morning_time,
          })}
          trailing={{ kind: 'switch', value: prefs.weekend_morning_only }}
          onPress={() => {
            track('weekend_mode_changed', { enabled: !prefs.weekend_morning_only });
            void saveUserPreferences({ weekend_morning_only: !prefs.weekend_morning_only });
          }}
          testID="briefings.weekend"
        />
        {prefs.weekend_morning_only ? (
          <View style={styles.weekendTime}>
            <Text variant="rowTitle">{t('settings.briefingsScreen.weekendTime')}</Text>
            <TimeChip
              value={prefs.weekend_morning_time}
              accessibilityLabel={t('settings.time.chipA11y', {
                title: t('settings.briefingsScreen.weekendTime'),
                time: prefs.weekend_morning_time,
              })}
              onPress={() => {
                setPicker('weekend_morning_time');
              }}
              testID="briefings.weekend.time"
            />
          </View>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t('settings.briefings.silentDays')}>
        <View style={styles.chips}>
          {WEEKDAYS.map(([day, key]) => {
            const silent = !prefs.briefing_weekdays.includes(day);
            return (
              <ChoiceChip
                key={key}
                label={t(`common.weekdays.short.${key}`)}
                selected={silent}
                accessibilityLabel={`${t(`common.weekdays.long.${key}`)}${silent ? `, ${t('common.a11y.selected')}` : ''}`}
                onPress={() => {
                  const weekdays = silent
                    ? [...prefs.briefing_weekdays, day].sort()
                    : prefs.briefing_weekdays.filter((d) => d !== day);
                  if (weekdays.length === 0) {
                    setDaysError(true);
                    return;
                  }
                  setDaysError(false);
                  track('silent_days_changed', { count: 7 - weekdays.length });
                  void saveUserPreferences({ briefing_weekdays: weekdays });
                }}
                testID={`briefings.silent.${String(day)}`}
              />
            );
          })}
        </View>
      </SettingsGroup>
      <Caption>{t('settings.briefings.silentDaysHelp')}</Caption>
      {daysError ? (
        <Text variant="bodySm" tone="critical" testID="briefings.silent.error">
          {t('settings.briefingsScreen.allSilent')}
        </Text>
      ) : null}

      <SettingsGroup title={t('settings.briefings.timezone')}>
        <ListRow
          title={t('settings.briefings.timezone')}
          trailing={{
            kind: 'value',
            text:
              prefs.timezone_mode === 'auto'
                ? t('settings.briefings.timezoneAuto', { zone: zoneLabel(prefs.timezone, now()) })
                : zoneLabel(prefs.timezone, now()),
            chevron: true,
          }}
          onPress={() => {
            setTzOpen(true);
          }}
          testID="briefings.timezone"
        />
      </SettingsGroup>

      {picker === null ? null : (
        <TimeSheet
          key={picker}
          visible
          title={
            picker === 'weekend_morning_time'
              ? t('settings.briefingsScreen.weekendTime')
              : t(`settings.briefings.rows.${picker.replace('_time', '') as Slot}.title`)
          }
          value={prefs[picker]}
          onDone={(value) => {
            const field = picker;
            setPicker(null);
            saveTime(field, value);
          }}
          onDismiss={() => {
            setPicker(null);
          }}
        />
      )}
      {tzOpen ? (
        <TimezoneSheet
          visible
          prefs={prefs}
          onDismiss={() => {
            setTzOpen(false);
          }}
        />
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  slot: { gap: 4 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weekendTime: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  zones: { gap: 8 },
});
