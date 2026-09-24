/**
 * M-PLAN-01 · Plan · Gün and M-PLAN-02 · Plan · Hafta (one tab route, segment state). Day: the
 * week strip, the TAKVİM ZEKÂSI card (highest-priority open signal: conflict > schedule suggestion
 * > prep > back-to-back > leave-by), the "TÜM GÜN" strip and one timeline merging events, tasks,
 * commitments, life events, deadlines, dashed AI proposals ("Önerilen · henüz gerçek değil") and
 * labelled free gaps. Week: the density chart (RPC-18) and Calendar Intelligence insights with at
 * most two actions each. Every calendar change is a proposal → approval (never a direct write);
 * advanced planning is Pro and the server answers 402 otherwise.
 */
import { isApiError, qk } from '@da/api-client';
import { useApiClient } from '@da/api-client/react';
import { addDaysToLocalDate, localDateDiffDays, zonedWallTimeToInstant } from '@da/domain';
import { withTrCases } from '@da/i18n';
import {
  BottomSheet,
  Button,
  CalendarIntelCard,
  ChipWrap,
  DayChip,
  DayStrip,
  EmptyState,
  GapBlock,
  GroupedList,
  HeaderPill,
  IconButton,
  MetaChip,
  OptionRow,
  RootHeader,
  SectionHeader,
  SegmentedControl,
  SuggestedSurface,
  Text,
  TimelineBlock,
  TimelineBlockRow,
  TimelineSkeleton,
  WeekDensityChart,
  useTheme,
  useToast,
  type IconName,
  type TimelineBlockKind,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, useScrollToTop, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { hasCapability } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { useInsightActions } from '../actions/insights';
import { ProGate } from '../actions/ProGate';
import { openReminder, openSource } from '../actions/sheets';
import { OfflineNotice, QueryFailure, useOfflineGuard } from '../actions/ui';
import { syncAccounts } from '../flow/data';
import {
  bySeverity,
  computeGaps,
  createProposal,
  dayRange,
  planRangeOptions,
  signalsOptions,
  topDaySignal,
  weekDays,
  weekDensityOptions,
  weekStartOf,
  type Gap,
  type PlanItemRow,
  type SignalRow,
} from './data';

type PlanView = 'day' | 'week';

const SIGNAL_ICON: Readonly<Record<SignalRow['signal'], IconName>> = {
  conflict: 'error',
  schedule_suggestion: 'event_available',
  prep_needed: 'self_improvement',
  back_to_back: 'event_busy',
  leave_by: 'directions_car',
  deadline: 'flag',
};

const SIGNAL_TONE: Readonly<
  Record<SignalRow['signal'], 'critical' | 'brand' | 'warning' | 'info'>
> = {
  conflict: 'critical',
  schedule_suggestion: 'brand',
  prep_needed: 'brand',
  back_to_back: 'warning',
  leave_by: 'info',
  deadline: 'warning',
};

type AnalyticsSignal =
  'conflict' | 'back_to_back' | 'prep_slot' | 'dense_day' | 'free_gap' | 'travel_stated';

function analyticsSignal(signal: SignalRow['signal']): AnalyticsSignal {
  switch (signal) {
    case 'conflict':
      return 'conflict';
    case 'back_to_back':
      return 'back_to_back';
    case 'prep_needed':
      return 'prep_slot';
    case 'leave_by':
      return 'travel_stated';
    case 'deadline':
      return 'dense_day';
    case 'schedule_suggestion':
      return 'free_gap';
  }
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Proposal flows shared by the day and week views (Pro; 402 → gate). */
function useProposalActions(onGate: () => void) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations('plan.screen');
  const blocked = useOfflineGuard();
  const session = useSessionContext();
  return async (input: Parameters<typeof createProposal>[2]) => {
    if (!session.isPro) {
      onGate();
      return;
    }
    if (blocked('approve')) return;
    try {
      const id = await createProposal(client, queryClient, input);
      router.push(`/plan/proposal/${id}` as Href);
    } catch (error) {
      if (isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED') {
        onGate();
        return;
      }
      toast.show({
        message:
          isApiError(error) && error.code === 'STATE_CONFLICT'
            ? t('noFreeSlot')
            : t('proposalFailed'),
        kind: isApiError(error) && error.code === 'STATE_CONFLICT' ? 'neutral' : 'error',
      });
    }
  };
}

function SignalCard({
  signal,
  onGate,
  testID,
}: {
  readonly signal: SignalRow;
  readonly onGate: () => void;
  readonly testID?: string;
}) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const router = useRouter();
  const formats = useFormats();
  const propose = useProposalActions(onGate);
  const insights = useInsightActions([qk.plan.all]);
  const act = (action: 'open' | 'resolve' | 'propose' | 'dismiss' | 'place_prep') => {
    track('calendar_insight_action', { signal: analyticsSignal(signal.signal), action });
  };
  const keep = {
    key: 'keep',
    label: t('screen.keep'),
    onPress: () => {
      act('dismiss');
      insights.setStatus({
        id: signal.id,
        to: 'dismissed',
        via: 'button',
        message: t('screen.kept'),
      });
    },
  };
  const start = now().getTime() + 5 * 60_000;
  const week = start + 7 * 86_400_000;
  let actions;
  switch (signal.signal) {
    case 'conflict':
      actions = [
        {
          key: 'options',
          label: t('conflict.options'),
          onPress: () => {
            act('resolve');
            router.push(`/plan/conflict/${signal.id}` as Href);
          },
        },
        keep,
      ];
      break;
    case 'schedule_suggestion':
      actions = [
        {
          key: 'plan',
          label: tc('actions.schedule'),
          onPress: () => {
            act('propose');
            void propose({
              item: { type: 'insight', id: signal.id },
              durationMinutes: 60,
              window: { from: new Date(start).toISOString(), to: new Date(week).toISOString() },
            });
          },
        },
        {
          key: 'other',
          label: t('proposal.otherTime'),
          onPress: () => {
            act('propose');
            const after =
              signal.at === null ? start : Math.max(start, Date.parse(signal.at) + 60 * 60_000);
            void propose({
              item: { type: 'insight', id: signal.id },
              durationMinutes: 60,
              window: {
                from: new Date(after).toISOString(),
                to: new Date(after + 7 * 86_400_000).toISOString(),
              },
            });
          },
        },
      ];
      break;
    case 'prep_needed':
      actions = [
        {
          key: 'place',
          label: t('screen.placePrep'),
          onPress: () => {
            act('place_prep');
            const end = signal.at === null ? week : Date.parse(signal.at);
            void propose({
              item: { type: 'insight', id: signal.id },
              title: t('screen.prepTitle', { title: signal.title }),
              durationMinutes: 30,
              window: {
                from: new Date(start).toISOString(),
                to: new Date(Math.max(end, start + 3_600_000)).toISOString(),
              },
            });
          },
        },
        {
          key: 'open',
          label: t('screen.openPrep'),
          onPress: () => {
            act('open');
            router.push(`/meeting/${signal.entityId}/prep?origin=plan` as Href);
          },
        },
      ];
      break;
    case 'leave_by':
      actions = [
        {
          key: 'remind',
          label:
            signal.at === null
              ? tc('actions.remind')
              : t('screen.remindAt', withTrCases({ time: formats.time(signal.at) }, ['time'])),
          onPress: () => {
            act('open');
            openReminder({ title: signal.title, origin: 'plan', anchorAt: signal.at });
          },
        },
        {
          key: 'source',
          label: tc('actions.openSource'),
          onPress: () => {
            openSource({ targetType: 'insight', targetId: signal.id, origin: 'plan' });
          },
        },
      ];
      break;
    case 'deadline':
      actions = [
        {
          key: 'source',
          label: tc('actions.openSource'),
          onPress: () => {
            act('open');
            if (signal.sourceType === 'email_message')
              router.push(`/mail/${signal.sourceId}` as Href);
            else openSource({ targetType: 'insight', targetId: signal.id, origin: 'plan' });
          },
        },
      ];
      break;
    case 'back_to_back':
      actions = [keep];
      break;
  }
  return (
    <CalendarIntelCard
      icon={SIGNAL_ICON[signal.signal]}
      iconTone={SIGNAL_TONE[signal.signal]}
      title={signal.title}
      {...(signal.body === null ? {} : { body: signal.body })}
      actions={actions}
      testID={testID ?? `plan.signal.${signal.signal}`}
    />
  );
}

function blockKind(item: PlanItemRow): TimelineBlockKind {
  switch (item.item_type) {
    case 'task':
      return 'task';
    case 'commitment':
      return 'commitment';
    case 'life_event':
      return 'life';
    case 'deadline':
      return 'deadline';
    default:
      return 'event';
  }
}

function TaskSheet({
  item,
  onClose,
  onGate,
}: {
  readonly item: PlanItemRow | null;
  readonly onClose: () => void;
  readonly onGate: () => void;
}) {
  const t = useTranslations('plan.screen');
  const tc = useTranslations('common');
  const formats = useFormats();
  const propose = useProposalActions(onGate);
  const online = useOnline();
  const due = item?.start_at ?? null;
  return (
    <BottomSheet
      visible={item !== null}
      onDismiss={onClose}
      title={item?.title ?? ''}
      subtitle={due === null ? t('task.noDue') : t('task.due', { date: formats.weekdayDate(due) })}
      testID="plan.taskSheet"
    >
      <GroupedList>
        <OptionRow
          role="button"
          icon="event_available"
          label={t('task.place')}
          disabled={!online}
          onPress={() => {
            if (item === null) return;
            track('task_sheet_action', { action: 'plan' });
            onClose();
            const from = now().getTime() + 5 * 60_000;
            const to =
              due === null ? from + 7 * 86_400_000 : Math.max(Date.parse(due), from + 3_600_000);
            void propose({
              item: { type: 'task', id: item.id },
              durationMinutes: 60,
              window: {
                from: new Date(from).toISOString(),
                to: new Date(Math.min(to, from + 14 * 86_400_000)).toISOString(),
              },
            });
          }}
          testID="plan.task.place"
        />
        <OptionRow
          role="button"
          icon="notifications"
          label={tc('actions.remind')}
          onPress={() => {
            if (item === null) return;
            track('task_sheet_action', { action: 'remind' });
            onClose();
            openReminder({ title: item.title ?? '', origin: 'plan', anchorAt: due });
          }}
          testID="plan.task.remind"
        />
      </GroupedList>
    </BottomSheet>
  );
}

function GapSheet({
  gap,
  tasks,
  onClose,
  onGate,
}: {
  readonly gap: Gap | null;
  readonly tasks: readonly PlanItemRow[];
  readonly onClose: () => void;
  readonly onGate: () => void;
}) {
  const t = useTranslations('plan.screen');
  const formats = useFormats();
  const online = useOnline();
  const propose = useProposalActions(onGate);
  if (gap === null) return <BottomSheet visible={false} onDismiss={onClose} />;
  const window = { from: gap.start, to: gap.end };
  return (
    <BottomSheet
      visible
      onDismiss={onClose}
      title={t('gap.title', {
        range: formats.range(gap.start, gap.end),
        duration: formats.duration(gap.minutes),
      })}
      testID="plan.gapSheet"
    >
      <GroupedList>
        <OptionRow
          role="button"
          icon="self_improvement"
          label={t('gap.focus')}
          subtitle={t('gap.focusMeta')}
          twoLine
          disabled={!online}
          onPress={() => {
            track('plan_gap_action', { action: 'focus' });
            onClose();
            void propose({
              title: t('gap.focusTitle'),
              durationMinutes: Math.min(gap.minutes, 120),
              window,
            });
          }}
          testID="plan.gap.focus"
        />
        {tasks.slice(0, 3).map((task) => (
          <OptionRow
            key={task.id}
            role="button"
            icon="task_alt"
            label={t('gap.task', { title: task.title ?? '' })}
            {...(task.start_at === null
              ? {}
              : { subtitle: t('task.due', { date: formats.dayMonth(task.start_at) }) })}
            twoLine
            disabled={!online}
            onPress={() => {
              track('plan_gap_action', { action: 'task' });
              onClose();
              void propose({
                item: {
                  type: task.item_type === 'commitment' ? 'commitment' : 'task',
                  id: task.id,
                },
                durationMinutes: Math.min(gap.minutes, 60),
                window,
              });
            }}
            testID={`plan.gap.task.${task.id}`}
          />
        ))}
        <OptionRow
          role="button"
          icon="notifications"
          label={t('gap.remind')}
          subtitle={t('gap.remindMeta')}
          twoLine
          disabled={!online}
          onPress={() => {
            track('plan_gap_action', { action: 'remind' });
            onClose();
            openReminder({ title: t('gap.focusTitle'), origin: 'plan', anchorAt: gap.start });
          }}
          testID="plan.gap.remind"
        />
      </GroupedList>
    </BottomSheet>
  );
}

function DayView({
  date,
  onGate,
  gated,
}: {
  readonly date: string;
  readonly onGate: () => void;
  readonly gated: boolean;
}) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const ts = useTranslations('states');
  const router = useRouter();
  const formats = useFormats();
  const session = useSessionContext();
  const propose = useProposalActions(onGate);
  const range = dayRange(date, formats.timeZone);
  const timeline = useQuery(planRangeOptions(range.from, range.to));
  const signals = useQuery(signalsOptions(range.from, range.to));
  const [gap, setGap] = useState<Gap | null>(null);
  const [task, setTask] = useState<PlanItemRow | null>(null);
  const items = timeline.data ?? [];
  const isToday = date === formats.today();
  const nowMs = now().getTime();
  const prefs = session.data?.preferences;
  const gaps = computeGaps({
    date,
    timeZone: formats.timeZone,
    items,
    workStart: prefs?.working_hours_start ?? '09:00',
    workEnd: prefs?.working_hours_end ?? '18:00',
    workDays: prefs?.work_days ?? [1, 2, 3, 4, 5],
    nowMs: isToday ? nowMs : 0,
  });
  const allDay = items.filter((i) => i.all_day === true || i.start_at === null);
  const timed = items
    .filter((i) => i.all_day !== true && i.start_at !== null)
    .sort((a, b) => Date.parse(a.start_at ?? '') - Date.parse(b.start_at ?? ''));
  const top = topDaySignal(signals.data ?? []);
  const calendarConnected = hasCapability(session.data, 'calendar_read');
  const candidates = items.filter(
    (i) => i.item_type === 'task' || (i.item_type === 'commitment' && i.direction === 'user_owes'),
  );

  const open = (item: PlanItemRow) => {
    const itemType =
      item.item_type === 'proposal'
        ? 'proposal'
        : item.item_type === 'task'
          ? 'task'
          : item.item_type === 'commitment'
            ? 'commitment'
            : 'event';
    track('plan_item_opened', { item_type: itemType });
    switch (item.item_type) {
      case 'event':
        router.push(
          (item.attendee_count ?? 0) >= 2 && session.isPro
            ? `/meeting/${item.id}/prep?origin=plan`
            : `/event/${item.id}?origin=plan_day`,
        );
        return;
      case 'proposal':
        router.push(`/plan/proposal/${item.id}` as Href);
        return;
      case 'life_event':
        router.push(`/life/${item.id}` as Href);
        return;
      case 'commitment':
        router.push(`/commitments/${item.id}` as Href);
        return;
      case 'task':
        track('task_sheet_opened', { provider: item.source?.provider ?? 'google' });
        setTask(item);
        return;
      case 'deadline':
        if (item.source?.source_type === 'email_message' && item.source.source_id !== null) {
          router.push(`/mail/${item.source.source_id}` as Href);
        } else if (item.insight_id !== null && item.insight_id !== undefined) {
          openSource({ targetType: 'insight', targetId: item.insight_id, origin: 'plan' });
        }
        return;
    }
  };

  const meta = (item: PlanItemRow): string => {
    const start = item.start_at ?? '';
    const end = item.end_at ?? start;
    const minutes = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
    switch (item.item_type) {
      case 'event':
        return [
          formats.range(start, end),
          formats.duration(minutes),
          item.is_online === true ? t('screen.online') : null,
          item.created_by_assistant === true ? t('screen.addedByAssistant') : null,
        ]
          .filter((p): p is string => p !== null)
          .join(' · ');
      case 'task':
        return t('screen.taskMeta');
      case 'commitment':
        return t('screen.commitmentMeta');
      case 'deadline':
        return `${t('screen.deadlineMeta')} · ${formats.time(start)}`;
      default:
        return formats.time(start);
    }
  };

  const rows: ReactNode[] = [];
  let nowPlaced = !isToday;
  const pushNow = () => {
    rows.push(
      <TimelineBlockRow key="now" time={formats.time(nowMs)} nowAt={0} testID="plan.now" />,
    );
    nowPlaced = true;
  };
  const entries: (
    { at: number; kind: 'item'; item: PlanItemRow } | { at: number; kind: 'gap'; gap: Gap }
  )[] = [
    ...timed.map((item) => ({ at: Date.parse(item.start_at ?? ''), kind: 'item' as const, item })),
    ...gaps.map((g) => ({ at: Date.parse(g.start), kind: 'gap' as const, gap: g })),
  ].sort((a, b) => a.at - b.at);
  let lastEnd = 0;
  for (const entry of entries) {
    if (!nowPlaced && entry.at > nowMs) pushNow();
    if (entry.kind === 'gap') {
      const g = entry.gap;
      rows.push(
        <TimelineBlockRow key={`gap-${g.start}`} time={formats.time(g.start)}>
          <GapBlock
            label={t('screen.gapLabel', { duration: formats.duration(g.minutes) })}
            {...(g.minutes >= 90 ? { meta: t('screen.gapFocus') } : {})}
            onPress={() => {
              track('plan_gap_opened', {
                minutes_bucket:
                  g.minutes < 30
                    ? '<30'
                    : g.minutes < 60
                      ? '30-60'
                      : g.minutes <= 120
                        ? '60-120'
                        : '>120',
              });
              setGap(g);
            }}
          />
        </TimelineBlockRow>,
      );
      continue;
    }
    const item = entry.item;
    const overlap = entry.at < lastEnd;
    lastEnd = Math.max(lastEnd, Date.parse(item.end_at ?? item.start_at ?? ''));
    if (item.item_type === 'proposal') {
      const status = item.approval_status;
      rows.push(
        <TimelineBlockRow key={item.id} time={formats.time(item.start_at ?? '')}>
          <SuggestedSurface
            title={item.title ?? ''}
            meta={t('screen.proposalMeta', {
              duration: formats.duration(
                Math.round(
                  (Date.parse(item.end_at ?? '') - Date.parse(item.start_at ?? '')) / 60_000,
                ),
              ),
            })}
            proposedLabel={t('proposal.kicker')}
            state={
              status === 'executing' || status === 'approved'
                ? 'executing'
                : status === 'failed'
                  ? 'failed'
                  : 'pendingApproval'
            }
            pendingLabel={t('screen.awaitingApproval')}
            {...(status === 'failed'
              ? {
                  failure: {
                    message: t('screen.addFailed'),
                    retryLabel: tc('actions.retry'),
                    onRetry: () => {
                      open(item);
                    },
                  },
                }
              : {})}
            onPress={() => {
              open(item);
            }}
            accessibilityLabel={t('screen.proposalA11y', { title: item.title ?? '' })}
            testID={`plan.proposal.${item.id}`}
          />
        </TimelineBlockRow>,
      );
      continue;
    }
    rows.push(
      <TimelineBlockRow key={item.id} time={formats.time(item.start_at ?? '')}>
        <TimelineBlock
          kind={blockKind(item)}
          title={item.title ?? ''}
          meta={meta(item)}
          overlap={overlap}
          onPress={() => {
            open(item);
          }}
          accessibilityLabel={[
            formats.time(item.start_at ?? ''),
            item.title,
            meta(item),
            overlap ? t('screen.conflictLabel') : null,
          ]
            .filter(Boolean)
            .join(', ')}
          testID={`plan.item.${item.item_type}.${item.id}`}
        />
      </TimelineBlockRow>,
    );
  }
  if (!nowPlaced) pushNow();

  const focusProposal = () => {
    const start = localAt(date, prefs?.working_hours_start ?? '09:00', formats.timeZone, nowMs);
    const end = localAt(date, prefs?.working_hours_end ?? '18:00', formats.timeZone, 0);
    void propose({
      title: t('screen.gap.focusTitle'),
      durationMinutes: 90,
      window: {
        from: new Date(start).toISOString(),
        to: new Date(Math.max(end, start + 3_600_000)).toISOString(),
      },
    });
  };

  if (timeline.data === undefined) {
    return timeline.isError ? (
      <QueryFailure
        screen={t('title')}
        error={timeline.error}
        onRetry={() => {
          void timeline.refetch();
        }}
        testID="plan"
      />
    ) : (
      <TimelineSkeleton accessibilityLabel={ts('loading.label')} testID="plan.loading" />
    );
  }

  return (
    <View style={styles.stack}>
      {top === null ? null : gated ? (
        <ProGate
          feature="advanced_planning"
          kicker={t('screen.gateKicker')}
          title={t('screen.gateTitle')}
          body={t('screen.gateBody')}
          surface="inline"
        />
      ) : (
        <View style={{ gap: 6 }}>
          <SectionHeader title={t('calendarIntel')} />
          <SignalCard signal={top} onGate={onGate} testID="plan.intel" />
        </View>
      )}
      {allDay.length === 0 ? null : (
        <View style={{ gap: 6 }}>
          <SectionHeader title={t('screen.allDay')} />
          <ChipWrap>
            {allDay.map((item) => (
              <MetaChip
                key={item.id}
                label={item.title ?? ''}
                icon={
                  item.item_type === 'task'
                    ? 'task_alt'
                    : item.item_type === 'commitment'
                      ? 'handshake'
                      : 'event'
                }
                onPress={() => {
                  open(item);
                }}
              />
            ))}
          </ChipWrap>
        </View>
      )}
      {!calendarConnected ? (
        <EmptyState
          icon="calendar_today"
          tone="primary"
          title={ts('empty.noCalendar.title')}
          body={ts('empty.noCalendar.body')}
          {...(isScreenAvailable('/settings/accounts')
            ? {
                action: {
                  label: ts('empty.noCalendar.cta'),
                  onPress: () => {
                    router.push('/settings/accounts');
                  },
                },
              }
            : {})}
          testID="plan.noCalendar"
        />
      ) : timed.length === 0 ? (
        <EmptyState
          icon="self_improvement"
          tone="primary"
          title={
            isToday
              ? ts('empty.plan.title')
              : t('screen.emptyDay', { day: formats.weekday(`${date}T12:00:00Z`) })
          }
          body={ts('empty.plan.body')}
          action={{ label: ts('empty.plan.cta'), onPress: focusProposal }}
          testID="plan.empty"
        />
      ) : (
        <View testID="plan.timeline">{rows}</View>
      )}
      <GapSheet
        gap={gap}
        tasks={candidates}
        onClose={() => {
          setGap(null);
        }}
        onGate={onGate}
      />
      <TaskSheet
        item={task}
        onClose={() => {
          setTask(null);
        }}
        onGate={onGate}
      />
    </View>
  );
}

/** A local wall-clock time on a date as epoch ms, never before `notBefore`. */
function localAt(date: string, time: string, timeZone: string, notBefore: number): number {
  return Math.max(notBefore, zonedWallTimeToInstant(date, time.slice(0, 5), timeZone).getTime());
}

function WeekView({
  date,
  onDay,
  onWeek,
  onGate,
}: {
  readonly date: string;
  readonly onDay: (date: string) => void;
  readonly onWeek: (direction: 'prev' | 'next') => void;
  readonly onGate: () => void;
}) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const ts = useTranslations('states');
  const formats = useFormats();
  const weekStart = weekStartOf(date);
  const range = {
    from: dayRange(weekStart, formats.timeZone).from,
    to: dayRange(addDaysToLocalDate(weekStart, 6), formats.timeZone).to,
  };
  const density = useQuery(weekDensityOptions(weekStart));
  const signals = useQuery(signalsOptions(range.from, range.to));
  const [expanded, setExpanded] = useState(false);
  const ranked = bySeverity(signals.data ?? []);
  const shown = expanded ? ranked : ranked.slice(0, 6);
  const days = density.data ?? [];
  const events = days.reduce((sum, d) => sum + d.event_count, 0);
  const busiest = [...days].sort((a, b) => b.meeting_minutes - a.meeting_minutes)[0];

  useEffect(() => {
    for (const s of ranked.slice(0, 6))
      track('calendar_insight_shown', { signal: analyticsSignal(s.signal) });
    // Once per loaded week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals.data]);

  if (density.data === undefined) {
    return density.isError ? (
      <QueryFailure
        screen={t('segments.week')}
        error={density.error}
        onRetry={() => {
          void density.refetch();
        }}
        testID="plan.week"
      />
    ) : (
      <TimelineSkeleton accessibilityLabel={ts('loading.label')} testID="plan.week.loading" />
    );
  }

  const label = (iso: string) => `${iso}T12:00:00Z`;
  return (
    <View style={styles.stack}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton
          icon="arrow_back"
          accessibilityLabel={t('screen.prevWeek')}
          onPress={() => {
            onWeek('prev');
          }}
        />
        <IconButton
          icon="arrow_forward"
          accessibilityLabel={t('screen.nextWeek')}
          onPress={() => {
            onWeek('next');
          }}
        />
      </View>
      <WeekDensityChart
        kicker={t('screen.densityKicker', {
          range: `${formats.dayMonth(label(weekStart))} – ${formats.dayMonth(label(addDaysToLocalDate(weekStart, 6)))}`,
        })}
        summary={tc('units.events', { count: events })}
        days={days.map((d) => ({
          key: d.local_date,
          label: formats.weekdayShort(label(d.local_date)),
          meetingMinutes: d.meeting_minutes,
          focusMinutes: d.focus_minutes,
          hot: d.is_hot,
          today: d.is_today,
          accessibilityLabel: t('screen.dayA11y', {
            day: formats.weekdayDate(label(d.local_date)),
            meeting: formats.duration(d.meeting_minutes),
            focus: formats.duration(d.focus_minutes),
          }),
        }))}
        onDayPress={onDay}
        legend={{
          meeting: t('screen.legendMeeting'),
          focus: t('screen.legendFocus'),
          busy: t('density.busy'),
        }}
        accessibilityLabel={
          busiest === undefined || busiest.meeting_minutes === 0
            ? t('screen.weekEmpty')
            : t('screen.weekA11y', {
                count: events,
                day: formats.weekday(label(busiest.local_date)),
              })
        }
        testID="plan.density"
      />
      {events === 0 ? (
        <Text variant="secondary" tone="secondary">
          {t('screen.weekEmpty')}
        </Text>
      ) : null}
      <SectionHeader title={t('calendarIntel')} />
      {ranked.length === 0 ? (
        <Text variant="secondary" tone="secondary" testID="plan.week.balanced">
          {t('screen.balanced')}
        </Text>
      ) : (
        <View style={{ gap: 12 }}>
          {shown.map((s) => (
            <SignalCard key={s.id} signal={s} onGate={onGate} testID={`plan.week.signal.${s.id}`} />
          ))}
          {ranked.length > 6 && !expanded ? (
            <Button
              label={t('screen.moreSignals', { count: ranked.length - 6 })}
              variant="text"
              onPress={() => {
                setExpanded(true);
              }}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

export function PlanScreen() {
  const theme = useTheme();
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const ts = useTranslations('states');
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const formats = useFormats();
  const session = useSessionContext();
  const online = useOnline();
  const params = useLocalSearchParams<{ view?: string; date?: string }>();
  const [view, setView] = useState<PlanView>(params.view === 'week' ? 'week' : 'day');
  const [date, setDate] = useState<string>(isDate(params.date) ? params.date : formats.today());
  const [gated, setGated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const today = formats.today();
  const relativeDay = Math.max(-7, Math.min(30, localDateDiffDays(today, date)));
  const weekOffset = Math.max(
    -4,
    Math.min(12, Math.round(localDateDiffDays(weekStartOf(today), weekStartOf(date)) / 7)),
  );

  useEffect(() => {
    track(
      'plan_viewed',
      view === 'day' ? { view, relative_day: relativeDay } : { view, week_offset: weekOffset },
    );
  }, [view, relativeDay, weekOffset]);

  const pickDate = (next: string, method: 'strip_tap' | 'swipe' | 'today_button') => {
    track('plan_date_changed', { method });
    setDate(next);
    router.setParams({ date: next });
  };
  const switchView = (key: string) => {
    const next: PlanView = key === 'week' ? 'week' : 'day';
    setView(next);
    router.setParams({ view: next });
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (online) await syncAccounts(client, session.accounts);
      await queryClient.invalidateQueries({ queryKey: qk.plan.all });
      track('plan_refreshed', { result: 'ok' });
    } catch {
      track('plan_refreshed', { result: 'error' });
      toast.show({ message: ts('error.refreshFailed'), kind: 'error' });
    } finally {
      setRefreshing(false);
    }
  };
  const gate = () => {
    setGated(true);
  };
  const days = weekDays(date);
  const counts = useQuery({
    ...planRangeOptions(
      dayRange(days[0] ?? date, formats.timeZone).from,
      dayRange(days[6] ?? date, formats.timeZone).to,
    ),
    enabled: view === 'day',
  });
  const dotFor = (day: string) => {
    const range = dayRange(day, formats.timeZone);
    const inDay = (counts.data ?? []).filter(
      (i) => i.start_at !== null && i.start_at >= range.from && i.start_at < range.to,
    );
    if (inDay.some((i) => i.item_type === 'proposal')) return 'proposal' as const;
    return inDay.length > 0 ? ('events' as const) : ('none' as const);
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.color.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void refresh();
          }}
          tintColor={theme.color.brand.primary}
          colors={[theme.color.brand.primary]}
        />
      }
      testID="plan.screen"
    >
      <RootHeader
        kicker={formats.weekdayDate(`${date}T12:00:00Z`)}
        title={t('title')}
        trailing={
          weekStartOf(date) === weekStartOf(today) ? undefined : (
            <HeaderPill
              label={tc('time.today')}
              icon="today"
              tint="neutral"
              onPress={() => {
                pickDate(today, 'today_button');
              }}
            />
          )
        }
        {...(isScreenAvailable('/settings')
          ? {
              avatar: {
                name:
                  session.data?.profile.display_name ?? session.data?.profile.email ?? t('title'),
                accessibilityLabel: t('screen.profile'),
                onPress: () => {
                  router.push('/settings');
                },
              },
            }
          : {})}
      />
      <View style={[styles.stack, { paddingHorizontal: theme.layout.screenX }]}>
        <SegmentedControl
          options={[
            { key: 'day', label: t('segments.day') },
            { key: 'week', label: t('segments.week') },
          ]}
          selectedKey={view}
          onChange={switchView}
          semantics="tabs"
          testID="plan.segments"
        />
        {online ? null : <OfflineNotice onRefresh={refresh} />}
        {view === 'day' ? (
          <>
            <DayStrip accessibilityLabel={t('screen.strip')} testID="plan.strip">
              {days.map((day) => (
                <DayChip
                  key={day}
                  weekday={formats.weekdayShort(`${day}T12:00:00Z`)}
                  day={String(Number(day.slice(8, 10)))}
                  today={day === today}
                  selected={day === date}
                  dot={dotFor(day)}
                  onPress={() => {
                    pickDate(day, 'strip_tap');
                  }}
                  accessibilityLabel={[
                    formats.weekdayDate(`${day}T12:00:00Z`),
                    day === date ? tc('a11y.selected') : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  testID={`plan.day.${day}`}
                />
              ))}
            </DayStrip>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Button
                label={t('screen.prevWeek')}
                variant="text"
                size="xs"
                onPress={() => {
                  pickDate(addDaysToLocalDate(date, -7), 'swipe');
                }}
              />
              <Button
                label={t('screen.nextWeek')}
                variant="text"
                size="xs"
                onPress={() => {
                  pickDate(addDaysToLocalDate(date, 7), 'swipe');
                }}
              />
            </View>
            <DayView date={date} onGate={gate} gated={gated} />
          </>
        ) : (
          <>
            {gated ? (
              <ProGate
                feature="advanced_planning"
                kicker={t('screen.gateKicker')}
                title={t('screen.gateTitle')}
                body={t('screen.gateBody')}
                surface="inline"
              />
            ) : null}
            <WeekView
              date={date}
              onDay={(day) => {
                setDate(day);
                switchView('day');
              }}
              onWeek={(direction) => {
                track('plan_week_paged', { direction });
                pickDate(addDaysToLocalDate(date, direction === 'next' ? 7 : -7), 'swipe');
              }}
              onGate={gate}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  stack: { gap: 14 },
});
