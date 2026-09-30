/**
 * M-PLAN-04 · Saati Değiştir: real free slots only (SREQ-19) from `GET /plan/free-slots` for one
 * of the next 7 days — no free-form time picker, so a proposal can never double-book. The slot
 * closest to the original time is marked "Önerilen".
 */
import { freeSlotsQueryOptions, useApiClient } from '@da/api-client/react';
import { addDaysToLocalDate } from '@da/domain';
import {
  Button,
  ChipWrap,
  ChoiceChip,
  EmptyState,
  GroupedList,
  HintRow,
  OptionRow,
  SkeletonBlock,
  Text,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { useFormats } from '../../lib/data/session';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { QueryFailure } from '../actions/ui';
import { dayRange } from './data';

export interface FreeSlotListProps {
  readonly durationMinutes: number;
  /** The original start (recommendation anchor). */
  readonly originalStart: string | null;
  readonly origin: 'proposal' | 'reminder' | 'task' | 'gap';
  readonly busy?: boolean;
  readonly onPick: (slot: {
    readonly start: string;
    readonly end: string;
    readonly recommended: boolean;
    readonly dayOffset: number;
  }) => void;
  readonly onCancel: () => void;
}

export function FreeSlotList({
  durationMinutes,
  originalStart,
  origin,
  busy = false,
  onPick,
  onCancel,
}: FreeSlotListProps) {
  const t = useTranslations('plan.proposal');
  const tc = useTranslations('common');
  const client = useApiClient();
  const formats = useFormats();
  const online = useOnline();
  const today = formats.today();
  const [day, setDay] = useState(originalStart === null ? today : formats.localDate(originalStart));
  const range = dayRange(day, formats.timeZone);
  const minutes = Math.max(15, Math.min(480, Math.round(durationMinutes)));
  const slots = useQuery({
    ...freeSlotsQueryOptions(client, { from: range.from, to: range.to, minMinutes: minutes }),
    enabled: online,
  });
  useEffect(() => {
    track('free_slot_picker_opened', { origin });
  }, [origin]);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToLocalDate(today, i));
  const anchor = originalStart === null ? 0 : Date.parse(originalStart);
  const list = (slots.data?.slots ?? []).filter((s) => Date.parse(s.start) > now().getTime());
  const recommended = list.reduce<string | null>((best, s) => {
    if (best === null) return s.start;
    return Math.abs(Date.parse(s.start) - anchor) < Math.abs(Date.parse(best) - anchor)
      ? s.start
      : best;
  }, null);
  const endOf = (start: string) => new Date(Date.parse(start) + minutes * 60_000).toISOString();
  return (
    <View style={{ gap: 12 }} testID="freeSlots">
      <Text variant="sheetTitle" heading>
        {t('changeTime')}
      </Text>
      <Text variant="secondary" tone="secondary">
        {t('freeOnly')}
      </Text>
      <ChipWrap>
        {days.map((d) => (
          <ChoiceChip
            key={d}
            label={d === today ? tc('time.today') : formats.weekdayShort(`${d}T12:00:00Z`)}
            selected={d === day}
            onPress={() => {
              setDay(d);
            }}
          />
        ))}
      </ChipWrap>
      {!online ? (
        <HintRow text={t('offline')} />
      ) : slots.isPending ? (
        <View style={{ gap: 8 }}>
          <SkeletonBlock height={44} />
          <SkeletonBlock height={44} />
          <SkeletonBlock height={44} />
        </View>
      ) : slots.isError ? (
        <QueryFailure
          screen={t('changeTime')}
          error={slots.error}
          onRetry={() => {
            void slots.refetch();
          }}
          testID="freeSlots"
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon="event_busy"
          tone="neutral"
          title={t('noSlotDay', { duration: formats.duration(minutes) })}
        />
      ) : (
        <GroupedList>
          {list.map((slot) => (
            <OptionRow
              key={slot.start}
              role="radio"
              icon="schedule"
              label={formats.range(slot.start, endOf(slot.start))}
              meta={t('inGap', { duration: formats.duration(slot.minutes) })}
              recommended={slot.start === recommended}
              ai={slot.start === recommended}
              selected={false}
              disabled={busy}
              onPress={() => {
                const recommendedPick = slot.start === recommended;
                track('free_slot_selected', {
                  day_offset: Math.max(0, days.indexOf(day)),
                  recommended: recommendedPick,
                });
                onPick({
                  start: slot.start,
                  end: endOf(slot.start),
                  recommended: recommendedPick,
                  dayOffset: Math.max(0, days.indexOf(day)),
                });
              }}
              testID={`freeSlots.slot.${slot.start}`}
            />
          ))}
        </GroupedList>
      )}
      <Button label={tc('actions.nevermind')} variant="text" onPress={onCancel} fullWidth />
    </View>
  );
}
