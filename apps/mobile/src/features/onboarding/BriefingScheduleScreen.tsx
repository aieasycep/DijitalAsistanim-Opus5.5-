/**
 * M-ON-10 briefing schedule ("Günün ritmi", step 3 / 4): local times for the morning, midday and
 * evening briefings and the weekend behaviour, evaluated by the server scheduler in
 * `user_preferences.timezone` (DST-safe, M§96). Free users see midday and evening with a lock and a
 * "· Pro" suffix (visible, not hidden); tapping them opens the gate. The calendar-based hint is not
 * shown (it needs three weekday first-event samples, which the client does not have here; D-07).
 */
import { useBootstrap } from '@da/api-client/react';
import { Button, GroupedList, ListRow, SectionHeader, Text, TimeChip } from '@da/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { patchBootstrapCache, updateUserPreferences } from '../../lib/postgrest';
import { sheets } from '../../providers/SheetHost';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { mailAccounts, useAccounts } from '../integrations/accounts';
import { OnboardingFrame } from './OnboardingFrame';
import { DEFAULT_TIMES, hhmm, type ScheduleField, type ScheduleTimes } from './schedule';
import { enterStep, nextStep, routeOf, stepContext } from './steps';
import { TIME_PICKER_SHEET } from './TimePickerSheet';

export function BriefingScheduleScreen() {
  const t = useTranslations('onboarding.schedule');
  const onb = useTranslations('onboarding');
  const common = useTranslations('common');
  const router = useRouter();
  const bootstrap = useBootstrap();
  const accounts = useAccounts();
  const prefs = bootstrap.data?.preferences;
  const initial: ScheduleTimes =
    prefs === undefined
      ? DEFAULT_TIMES
      : {
          morning: hhmm(prefs.morning_time),
          midday: hhmm(prefs.midday_time),
          evening: hhmm(prefs.evening_time),
          weekend: hhmm(prefs.weekend_morning_time),
        };
  const [times, setTimes] = useState<ScheduleTimes | null>(null);
  const [weekendOnly, setWeekendOnly] = useState<boolean | null>(null);
  const current = times ?? initial;
  const weekend = weekendOnly ?? prefs?.weekend_morning_only ?? true;
  const pro = isPro();

  useEffect(() => {
    enterStep('briefing_schedule');
  }, []);

  const pick = (field: ScheduleField) => {
    sheets.open(TIME_PICKER_SHEET, {
      field,
      times: current,
      onSave: (value: string) => {
        setTimes({ ...current, [field]: value });
      },
    });
  };

  const save = () => {
    const changed = (Object.keys(initial) as ScheduleField[]).filter(
      (key) => initial[key] !== current[key],
    ).length;
    track('briefing_schedule_saved', {
      morning: current.morning,
      midday: current.midday,
      evening: current.evening,
      weekend_enabled: weekend,
      changed_fields: changed + (weekend === (prefs?.weekend_morning_only ?? true) ? 0 : 1),
    });
    const patch = {
      morning_time: current.morning,
      midday_time: current.midday,
      evening_time: current.evening,
      weekend_morning_time: current.weekend,
      weekend_morning_only: weekend,
    };
    patchBootstrapCache((data) => ({ ...data, preferences: { ...data.preferences, ...patch } }));
    void updateUserPreferences(patch).catch(() => undefined);
    const next = nextStep('briefing_schedule', stepContext(mailAccounts(accounts.data).length > 0));
    router.push(next === 'done' ? '/today' : routeOf(next));
  };

  const row = (field: 'morning' | 'midday' | 'evening') => {
    const locked = field !== 'morning' && !pro;
    const title = t(`${field}Title`);
    const meta = t(`${field}Meta`);
    return (
      <ListRow
        key={field}
        title={title}
        subtitle={locked ? t('proSuffix', { meta }) : meta}
        density="twoLineTrailing"
        trailing={{
          kind: 'custom',
          node: (
            <TimeChip
              value={current[field]}
              locked={locked}
              onPress={() => {
                if (locked) openProGate(field === 'midday' ? 'midday' : 'evening');
                else pick(field);
              }}
              accessibilityLabel={
                locked
                  ? t('rowA11yLocked', { title, time: current[field] })
                  : t('rowA11y', { title, time: current[field] })
              }
              testID={`schedule.${field}.time`}
            />
          ),
        }}
        testID={`schedule.${field}`}
      />
    );
  };

  return (
    <OnboardingFrame
      kicker={onb('steps.schedule')}
      title={t('title')}
      subtitle={t('body')}
      onBack={() => {
        router.back();
      }}
      testID="onboarding.schedule"
      footer={
        <Button
          label={common('actions.continue')}
          fullWidth
          onPress={save}
          testID="schedule.continue"
        />
      }
    >
      <GroupedList>{(['morning', 'midday', 'evening'] as const).map(row)}</GroupedList>
      <SectionHeader title={t('weekend')} />
      <GroupedList>
        <ListRow
          title={t('weekendOnlyTitle')}
          subtitle={t('weekendMeta', { time: current.weekend })}
          trailing={{ kind: 'switch', value: weekend }}
          onPress={() => {
            setWeekendOnly(!weekend);
          }}
          testID="schedule.weekend"
        />
        {weekend ? (
          <ListRow
            title={t('weekendTime')}
            trailing={{ kind: 'value', text: current.weekend, chevron: true }}
            onPress={() => {
              pick('weekend');
            }}
            testID="schedule.weekendTime"
          />
        ) : null}
      </GroupedList>
      <View style={styles.note}>
        <Text variant="secondary" tone="tertiaryStrong">
          {t('timezone', { zone: prefs?.timezone ?? '' })}
        </Text>
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({ note: { marginTop: 4 } });
