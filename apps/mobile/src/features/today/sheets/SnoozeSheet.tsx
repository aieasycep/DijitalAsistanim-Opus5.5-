/**
 * M-TD-04 "Ertele" (sheet(host) `snooze`): re-surface an insight later without a notification —
 * "Bu akşam · {evening}" (hidden from 30 minutes before the evening briefing), "Yarın sabah ·
 * {morning}" and "Kendin seç" (day and time in the user's time zone; the past is rejected). The
 * write is RPC-01 `set_insight_status(snoozed, p_snoozed_until)` with the R-06 undo.
 */
import { toZonedDate } from '@da/i18n';
import {
  BottomSheet,
  Button,
  ChoiceChip,
  ChipWrap,
  InlineErrorCard,
  OptionRow,
  Text,
} from '@da/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { now } from '../../../lib/clock';
import { cachedBootstrap } from '../../../lib/postgrest';
import { registerSheet, type SheetRenderProps } from '../../../providers/SheetHost';
import { hhmm } from '../../onboarding/schedule';
import { snoozeInsight } from '../actions';
import type { TodayPriority } from '../data';

export const SNOOZE_SHEET = 'snooze';

export interface SnoozeParams {
  readonly item: TodayPriority;
  readonly localDate: string;
}

/** The instant of `time` on the day `dayOffset` days from `at`, in `timeZone`. */
export function zonedAt(at: Date, timeZone: string, dayOffset: number, time: string): Date {
  const zoned = toZonedDate(at, timeZone);
  zoned.setDate(zoned.getDate() + dayOffset);
  const [h = '0', m = '0'] = time.split(':');
  zoned.setHours(Number(h), Number(m), 0, 0);
  return new Date(zoned.getTime());
}

export interface SnoozePresets {
  readonly tonight: Date | null;
  readonly tomorrowMorning: Date;
}

export function snoozePresets(
  at: Date,
  timeZone: string,
  morning: string,
  evening: string,
): SnoozePresets {
  const tonight = zonedAt(at, timeZone, 0, evening);
  return {
    tonight: tonight.getTime() - at.getTime() > 30 * 60_000 ? tonight : null,
    tomorrowMorning: zonedAt(at, timeZone, 1, morning),
  };
}

const CUSTOM_TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00'] as const;

function SnoozeSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<SnoozeParams>) {
  const t = useTranslations('today.snooze');
  const common = useTranslations('common.actions');
  const format = useFormatter();
  const prefs = cachedBootstrap()?.preferences;
  const timeZone = prefs?.timezone ?? 'Europe/Istanbul';
  const current = now();
  const presets = snoozePresets(
    current,
    timeZone,
    hhmm(prefs?.morning_time ?? '08:00'),
    hhmm(prefs?.evening_time ?? '19:00'),
  );
  const [custom, setCustom] = useState(false);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState<string>('09:00');
  const customAt = zonedAt(current, timeZone, day, time);
  const past = customAt.getTime() <= current.getTime();
  const label = (date: Date) =>
    format.dateTime(date, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  const commit = (until: Date, preset: 'tonight' | 'tomorrow_morning' | 'custom') => {
    snoozeInsight(params.item, params.localDate, until, preset, label(until));
    onDismiss();
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      testID="sheet.snooze"
      {...(custom
        ? {
            footer: (
              <Button
                label={common('save')}
                fullWidth
                disabled={past}
                onPress={() => {
                  commit(customAt, 'custom');
                }}
                testID="snooze.customSave"
              />
            ),
          }
        : {})}
    >
      {custom ? (
        <View style={styles.custom}>
          <Text variant="label">{t('day')}</Text>
          <ChipWrap>
            {[0, 1, 2, 3, 4, 5, 6].map((offset) => (
              <ChoiceChip
                key={offset}
                label={format.dateTime(zonedAt(current, timeZone, offset, '12:00'), {
                  weekday: 'short',
                  day: 'numeric',
                })}
                selected={day === offset}
                onPress={() => {
                  setDay(offset);
                }}
                testID={`snooze.day.${String(offset)}`}
              />
            ))}
          </ChipWrap>
          <Text variant="label">{t('time')}</Text>
          <ChipWrap>
            {CUSTOM_TIMES.map((value) => (
              <ChoiceChip
                key={value}
                label={value}
                selected={time === value}
                onPress={() => {
                  setTime(value);
                }}
                testID={`snooze.time.${value}`}
              />
            ))}
          </ChipWrap>
          {past ? (
            <InlineErrorCard icon="error" tone="warning" title={t('past')} testID="snooze.past" />
          ) : null}
        </View>
      ) : (
        <View>
          {presets.tonight === null ? null : (
            <OptionRow
              label={t('tonight', { time: hhmm(prefs?.evening_time ?? '19:00') })}
              icon="bedtime"
              role="button"
              onPress={() => {
                if (presets.tonight !== null) commit(presets.tonight, 'tonight');
              }}
              testID="snooze.tonight"
            />
          )}
          <OptionRow
            label={t('tomorrowMorning', { time: hhmm(prefs?.morning_time ?? '08:00') })}
            icon="wb_twilight"
            role="button"
            onPress={() => {
              commit(presets.tomorrowMorning, 'tomorrow_morning');
            }}
            testID="snooze.tomorrow"
          />
          <OptionRow
            label={t('custom')}
            icon="schedule"
            role="button"
            onPress={() => {
              setCustom(true);
            }}
            testID="snooze.custom"
          />
        </View>
      )}
    </BottomSheet>
  );
}

registerSheet<SnoozeParams>(SNOOZE_SHEET, (props) => <SnoozeSheet {...props} />, {
  analyticsKey: 'snooze',
});

const styles = StyleSheet.create({ custom: { gap: 10 } });
