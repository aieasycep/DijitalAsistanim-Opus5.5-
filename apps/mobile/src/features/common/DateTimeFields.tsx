/**
 * Date and time selection without a native picker dependency (M-REM-02 "Kendin seç", the typed
 * approval editors M-APPR-05 and capture item edits): a horizontal strip of the next days and hour
 * / minute steppers on a 5-minute grid. Every stepper is an `adjustable` control for assistive
 * technology; the value is an instant in the user's zone.
 */
import {
  addDaysToLocalDate,
  atLocalTime,
  localDate,
  localTime,
  minutesOfDay,
  hhmmFromMinutes,
} from '@da/domain';
import { formatDatePattern, toUpper } from '@da/i18n';
import { ChoiceChip, IconButton, Text, useTheme } from '@da/ui';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { cachedBootstrap } from '../../lib/postgrest';

export function userTimeZone(): string {
  return cachedBootstrap()?.preferences.timezone ?? 'Europe/Istanbul';
}

export function useLang(): 'tr' | 'en' {
  return useLocale() === 'en' ? 'en' : 'tr';
}

function Stepper({
  label,
  value,
  onStep,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly onStep: (delta: 1 | -1) => void;
  readonly testID: string;
}) {
  const t = useTranslations('reminder.custom');
  const theme = useTheme();
  return (
    <View
      style={[styles.stepper, { backgroundColor: theme.color.surfaceSunken }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        onStep(event.nativeEvent.actionName === 'increment' ? 1 : -1);
      }}
      testID={testID}
    >
      <IconButton
        icon="expand_less"
        accessibilityLabel={t('increase', { unit: label })}
        onPress={() => {
          onStep(1);
        }}
        testID={`${testID}.up`}
      />
      <Text variant="h2" numeric>
        {value}
      </Text>
      <IconButton
        icon="expand_more"
        accessibilityLabel={t('decrease', { unit: label })}
        onPress={() => {
          onStep(-1);
        }}
        testID={`${testID}.down`}
      />
    </View>
  );
}

export interface DateTimeFieldsProps {
  readonly value: Date;
  readonly onChange: (next: Date) => void;
  /** Days offered from today (default 30). */
  readonly days?: number;
  /** Hide the time steppers (date-only destinations such as Google Tasks). */
  readonly dateOnly?: boolean;
  readonly testID?: string;
}

export function DateTimeFields({
  value,
  onChange,
  days = 30,
  dateOnly = false,
  testID = 'datetime',
}: DateTimeFieldsProps) {
  const t = useTranslations('reminder.custom');
  const common = useTranslations('common');
  const lang = useLang();
  const tz = userTimeZone();
  const today = localDate(now(), tz);
  const selectedDate = localDate(value, tz);
  const minutes = minutesOfDay(localTime(value, tz));
  const set = (date: string, total: number) => {
    const wrapped = ((total % 1440) + 1440) % 1440;
    onChange(atLocalTime(date, hhmmFromMinutes(wrapped), tz));
  };
  const dates = Array.from({ length: days }, (_, i) => addDaysToLocalDate(today, i));
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return (
    <View style={styles.root} testID={testID}>
      <Text variant="kicker" tone="tertiaryStrong">
        {toUpper(t('date'), lang)}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('date')}
      >
        {dates.map((date, index) => {
          const label =
            index === 0
              ? common('time.today')
              : index === 1
                ? common('time.tomorrow')
                : formatDatePattern(`${date}T12:00:00Z`, 'dayMonth', {
                    locale: lang,
                    timeZone: 'UTC',
                  });
          return (
            <ChoiceChip
              key={date}
              label={label}
              selected={date === selectedDate}
              onPress={() => {
                set(date, minutes);
              }}
              accessibilityRole="radio"
              testID={`${testID}.day.${String(index)}`}
            />
          );
        })}
      </ScrollView>
      {dateOnly ? null : (
        <>
          <Text variant="kicker" tone="tertiaryStrong">
            {toUpper(t('time'), lang)}
          </Text>
          <View style={styles.steppers}>
            <Stepper
              label={t('hour')}
              value={hour}
              onStep={(delta) => {
                set(selectedDate, minutes + delta * 60);
              }}
              testID={`${testID}.hour`}
            />
            <Text variant="h2">{':'}</Text>
            <Stepper
              label={t('minute')}
              value={minute}
              onStep={(delta) => {
                const base = Math.floor(minutes / 60) * 60;
                const next = ((((minutes % 60) + delta * 5) % 60) + 60) % 60;
                set(selectedDate, base + next);
              }}
              testID={`${testID}.minute`}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  days: { gap: 8, paddingVertical: 2 },
  steppers: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepper: { alignItems: 'center', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 },
});
