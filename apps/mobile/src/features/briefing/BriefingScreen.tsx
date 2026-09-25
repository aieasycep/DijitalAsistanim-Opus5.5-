/**
 * `briefing/[id]` (M-BR-01 morning, M-BR-03 midday, M-BR-04 evening; a weekly id redirects to
 * `weekly/[id]`). A snapshot with a live overlay (D-12): rows whose linked item is done show
 * "Tamamlandı". Morning: the six M§9 sections in fixed order (D-09), empty ones hidden,
 * provenance footer, "Bu brifing faydalı mıydı?" (`ai_feedback`), the single notification re-ask
 * (D-29) and the sticky "Brifingi Dinle" (Pro; gate on Free). Midday: the delta rows or the
 * no-delta state (D-14). Evening: the M§11 sections (D-10), open rows complete in place, and
 * "Yarına Hazırım" → confirmation (M-BR-04C). Opening marks it opened (RPC-07). Generating polls
 * every 5 s; a failed briefing offers "Tekrar Dene" (API-BRF-04); a missing one explains retention.
 */
import { qk } from '@da/api-client';
import { audioMinutes, formatDatePattern, toUpper } from '@da/i18n';
import {
  Button,
  ChecklistRow,
  DetailHeader,
  EditorialParagraph,
  EmptyState,
  ErrorCard,
  FeedbackActions,
  GradientHeader,
  GroupedList,
  IconButton,
  InkCallout,
  ListRow,
  NotFoundState,
  OverlappingSheet,
  ProvenanceFooter,
  SectionHeader,
  SkeletonBlock,
  SkeletonGroup,
  StickyCTABar,
  Text,
  useTheme,
  type FeedbackValue,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFormatter, useLocale, useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { cachedBootstrap, rpc, updateNotificationPreferences } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { sheets } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { ContextualGate, isPro, openProGate } from '../pro-gate/ProGate';
import {
  registerPushToken,
  requestNotificationPermission,
  currentNotificationPermission,
} from '../onboarding/push';
import { INSIGHT_WHY_SHEET } from '../today/sheets/WhySheet';
import { routeForEntity, routeForSource } from '../today/sources';
import { markOpened, useBriefing, type BriefingDetail, type BriefingItem } from './data';
import { EVENING_READY_SHEET } from './EveningReadySheet';

export const MORNING_SECTIONS = [
  'priorities',
  'schedule',
  'awaiting_me',
  'awaiting_them',
  'deadlines',
  'life',
] as const;
export const EVENING_SECTIONS = ['completed', 'carry_over', 'follow_up', 'tomorrow_first'] as const;
const LOW_CONFIDENCE = 0.7;
type Via = 'today' | 'push' | 'widget' | 'history' | 'onboarding';

function viaOf(value: string | undefined): Via {
  return value === 'push' || value === 'widget' || value === 'history' || value === 'onboarding'
    ? value
    : 'today';
}

function openItem(item: BriefingItem, router: ReturnType<typeof useRouter>, section: string): void {
  const route =
    routeForEntity(item.entity_type, item.entity_id) ??
    routeForSource(item.source_type, item.source_id);
  track('briefing_item_opened', {
    section,
    entity_type: item.entity_type ?? 'insight',
  });
  if (route !== null) router.push(route);
  else sheets.open(INSIGHT_WHY_SHEET, { targetType: 'briefing_item', targetId: item.id });
}

function ItemRows({
  items,
  section,
}: {
  readonly items: readonly BriefingItem[];
  readonly section: string;
}) {
  const t = useTranslations('briefing.row');
  const router = useRouter();
  return (
    <GroupedList testID={`briefing.section.${section}`}>
      {items.map((item) => {
        const meta = item.meta ?? '';
        const uncertain = item.confidence < LOW_CONFIDENCE;
        const subtitle =
          item.done_at !== null ? t('done') : uncertain ? t('notSure', { meta }) : meta;
        return (
          <ListRow
            key={item.id}
            title={item.title}
            {...(subtitle === '' ? {} : { subtitle })}
            icon={item.done_at !== null ? 'check_circle' : 'chevron_right'}
            iconStyle="bare"
            trailing={{ kind: 'chevron' }}
            onPress={() => {
              openItem(item, router, section);
            }}
            accessibilityLabel={[item.title, meta, item.done_at !== null ? t('done') : '']
              .filter((p) => p !== '')
              .join(', ')}
            testID={`briefing.item.${item.id}`}
          />
        );
      })}
    </GroupedList>
  );
}

function FeedbackRow({ briefingId }: { readonly briefingId: string }) {
  const t = useTranslations('briefing.feedback');
  const [value, setValue] = useState<FeedbackValue>(null);
  const send = (rating: 1 | -1) => {
    setValue(rating === 1 ? 'positive' : 'negative');
    track('briefing_feedback', { rating: rating === 1 ? 'up' : 'down' });
    void (
      getSupabase()
        .from('ai_feedback')
        .insert({
          target_type: 'briefing',
          target_id: briefingId,
          rating,
          reason_code: rating === 1 ? 'helpful' : 'inaccurate',
        } as never) as unknown as Promise<{ error: unknown }>
    ).then(({ error }) => {
      showToast(
        error === null ? { message: t('thanks') } : { message: t('failed'), kind: 'error' },
      );
    });
  };
  return (
    <FeedbackActions
      prompt={t('question')}
      positiveLabel={t('helpful')}
      negativeLabel={t('inaccurate')}
      value={value}
      disabled={value !== null}
      onPositive={() => {
        send(1);
      }}
      onNegative={() => {
        send(-1);
      }}
      testID="briefing.feedback"
    />
  );
}

/** D-29: the one re-ask of the notification permission, on the first briefing after "Daha sonra". */
function ReaskBanner() {
  const t = useTranslations('briefing.reask');
  const query = useQuery({
    queryKey: ['notification-prefs', 'reask'],
    queryFn: async () => {
      const permission = await currentNotificationPermission();
      if (permission === 'granted') return false;
      const { data } = (await getSupabase()
        .from('notification_preferences')
        .select('prompt_deferred_count')
        .maybeSingle()) as { data: { prompt_deferred_count: number } | null };
      return data?.prompt_deferred_count === 1;
    },
    staleTime: Infinity,
  });
  const [hidden, setHidden] = useState(false);
  if (query.data !== true || hidden) return null;
  return (
    <InkCallout variant="banner" icon="notifications" title={t('title')} testID="briefing.reask">
      <View style={styles.row}>
        <Button
          label={t('allow')}
          size="sm"
          onPress={() => {
            void requestNotificationPermission().then(async (status) => {
              track('notification_reprompt_result', {
                status:
                  status === 'granted' ? 'granted' : status === 'blocked' ? 'blocked' : 'denied',
              });
              if (status === 'granted') await registerPushToken();
              setHidden(true);
            });
          }}
          testID="briefing.reask.allow"
        />
        <Button
          label={t('no')}
          size="sm"
          variant="ghost"
          onPress={() => {
            void updateNotificationPreferences({ prompt_deferred_count: 2 }).catch(() => undefined);
            setHidden(true);
          }}
          testID="briefing.reask.no"
        />
      </View>
    </InkCallout>
  );
}

function sectionsOf(items: readonly BriefingItem[], order: readonly string[]) {
  return order
    .map((section) => ({ section, items: items.filter((i) => i.section === section) }))
    .filter((s) => s.items.length > 0);
}

function MorningView({ detail }: { readonly detail: BriefingDetail }) {
  const t = useTranslations('briefing');
  const today = useTranslations('today.greeting');
  const common = useTranslations('common');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const theme = useTheme();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const { briefing, items } = detail;
  const lang = locale === 'en' ? 'en' : 'tr';
  const timeZone = cachedBootstrap()?.preferences.timezone;
  const name = cachedBootstrap()?.profile.display_name?.trim().split(/\s+/)[0] ?? '';
  const sections = sectionsOf(items, MORNING_SECTIONS);
  const audioSeconds = briefing.audio_duration_s;
  const minutes = audioSeconds === null ? null : audioMinutes(audioSeconds);
  const provenance = briefing.provenance ?? {};
  const mailCount = typeof provenance.mail_count === 'number' ? provenance.mail_count : null;
  const calendarCount =
    typeof provenance.calendar_count === 'number' ? provenance.calendar_count : null;
  const hours = typeof provenance.lookback_hours === 'number' ? provenance.lookback_hours : null;
  const pro = isPro();
  const date = formatDatePattern(`${briefing.local_date}T12:00:00Z`, 'dayMonth', {
    locale: lang,
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  const readToEnd = useRef(false);
  return (
    <View style={styles.fill}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        onScroll={(event) => {
          const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
          if (
            !readToEnd.current &&
            layoutMeasurement.height + contentOffset.y >= contentSize.height - 40
          ) {
            readToEnd.current = true;
            track('briefing_read_to_end', { kind: briefing.kind });
          }
        }}
        scrollEventThrottle={250}
      >
        <GradientHeader
          gradient="dawn"
          kicker={toUpper(t('kicker', { kind: t('kinds.morning'), date }), lang)}
          title={name === '' ? today('morningNoName') : today('morning', { name })}
          {...(briefing.headline === null ? {} : { subtitle: briefing.headline })}
          top={
            <IconButton
              icon="arrow_back"
              variant="onGradient"
              accessibilityLabel={common('actions.back')}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/today');
              }}
            />
          }
          testID="briefing.header"
        />
        <OverlappingSheet>
          <View style={[styles.sheet, { paddingHorizontal: theme.layout.screenX }]}>
            <ReaskBanner />
            {briefing.narrative === null ? null : (
              <EditorialParagraph spans={[{ key: 'n', text: briefing.narrative }]} />
            )}
            {sections.length === 0 ? (
              <EmptyState
                icon="check_circle"
                tone="success"
                title={t('calm.title')}
                body={t('calm.body')}
                testID="briefing.calm"
              />
            ) : (
              sections.map(({ section, items: rows }) => (
                <View key={section} style={styles.section}>
                  <SectionHeader
                    title={t(`sections.${section as (typeof MORNING_SECTIONS)[number]}`)}
                  />
                  <ItemRows items={rows} section={section} />
                </View>
              ))
            )}
            {mailCount === null || briefing.generated_at === null ? null : (
              <ProvenanceFooter
                text={t('provenance', {
                  emails: mailCount,
                  events: calendarCount ?? 0,
                  hours: hours ?? 72,
                  time: format.dateTime(new Date(briefing.generated_at), {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              />
            )}
            <FeedbackRow briefingId={briefing.id} />
          </View>
        </OverlappingSheet>
      </ScrollView>
      <StickyCTABar
        fade
        style={{
          paddingBottom: Math.max(insets.bottom, 12),
          paddingHorizontal: theme.layout.screenX,
        }}
      >
        <Button
          label={minutes === null ? t('audio.listenShort') : t('audio.listenLong', { minutes })}
          variant="ink"
          icon={pro ? 'headphones' : 'lock'}
          fullWidth
          disabled={!online}
          onPress={() => {
            if (!pro) {
              openProGate('voice_briefing');
              return;
            }
            router.push(`/briefing/${briefing.id}/listen?autoplay=1`);
          }}
          testID="briefing.listen"
        />
      </StickyCTABar>
    </View>
  );
}

function MiddayView({ detail }: { readonly detail: BriefingDetail }) {
  const t = useTranslations('briefing');
  const common = useTranslations('common');
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { briefing, items } = detail;
  const delta = items.filter((i) => i.section === 'midday_delta');
  const rest = items.filter((i) => i.section === 'rest_of_day' || i.section === 'schedule');
  const noDelta = briefing.status === 'skipped' || delta.length === 0;
  useEffect(() => {
    if (noDelta) track('midday_no_delta_viewed');
  }, [noDelta]);
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  };
  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <DetailHeader
        leading="close"
        onLeadingPress={close}
        leadingAccessibilityLabel={common('actions.close')}
        kicker={t('kinds.midday')}
      />
      <ScrollView
        contentContainerStyle={[
          styles.sheet,
          { paddingHorizontal: theme.layout.screenX, paddingBottom: 120 },
        ]}
      >
        <Text variant="kicker" tone="accent">
          {t('midday.kicker')}
        </Text>
        <Text variant="h1" heading testID="briefing.midday.title">
          {noDelta ? t('midday.allGood') : t('midday.title', { count: delta.length })}
        </Text>
        {noDelta ? (
          <Text variant="body" tone="secondary">
            {t('midday.noChange')}
          </Text>
        ) : (
          <View style={styles.section}>
            <SectionHeader title={t('sections.midday_delta')} />
            <ItemRows items={delta} section="midday_delta" />
          </View>
        )}
        {rest.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeader title={t('midday.restOfDay')} />
            <ItemRows items={rest} section="schedule" />
          </View>
        )}
      </ScrollView>
      <StickyCTABar
        style={{
          paddingBottom: Math.max(insets.bottom, 12),
          paddingHorizontal: theme.layout.screenX,
        }}
      >
        <Button
          label={common('actions.ok')}
          variant="ink"
          fullWidth
          onPress={close}
          testID="briefing.midday.ok"
        />
      </StickyCTABar>
    </View>
  );
}

function EveningView({ detail }: { readonly detail: BriefingDetail }) {
  const t = useTranslations('briefing');
  const common = useTranslations('common');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { briefing, items } = detail;
  const lang = locale === 'en' ? 'en' : 'tr';
  const [completed, setCompleted] = useState<readonly string[]>([]);
  const isDone = (item: BriefingItem) => item.done_at !== null || completed.includes(item.id);
  const carry = items.filter((i) => i.section === 'carry_over' && !isDone(i));
  const sections = sectionsOf(items, EVENING_SECTIONS);
  const timeZone = cachedBootstrap()?.preferences.timezone;
  const date = formatDatePattern(`${briefing.local_date}T12:00:00Z`, 'dayMonth', {
    locale: lang,
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  const complete = (item: BriefingItem) => {
    if (item.insight_id === null) return;
    const insightId = item.insight_id;
    setCompleted((c) => [...c, item.id]);
    track('evening_item_completed', { entity_type: 'insight' });
    void rpc('set_insight_status', { p_insight_id: insightId, p_status: 'done' })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: qk.today.all });
        showToast({
          message: common('toast.completed'),
          action: {
            label: common('actions.undo'),
            onPress: () => {
              setCompleted((c) => c.filter((id) => id !== item.id));
              void rpc('set_insight_status', { p_insight_id: insightId, p_status: 'open' }).catch(
                () => undefined,
              );
            },
          },
        });
      })
      .catch(() => {
        setCompleted((c) => c.filter((id) => id !== item.id));
        showToast({ message: common('toast.saveFailed'), kind: 'error' });
      });
  };
  const confirmedAt = briefing.evening_ready_at;
  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <GradientHeader
          gradient="dusk"
          kicker={toUpper(t('kicker', { kind: t('kinds.evening'), date }), lang)}
          title={
            carry.length === 0
              ? t('evening.allClosed')
              : t('evening.title', { count: carry.length })
          }
          top={
            <IconButton
              icon="arrow_back"
              variant="onGradient"
              accessibilityLabel={common('actions.back')}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/today');
              }}
            />
          }
          testID="briefing.header"
        />
        <OverlappingSheet>
          <View style={[styles.sheet, { paddingHorizontal: theme.layout.screenX }]}>
            {sections.map(({ section, items: rows }) => (
              <View key={section} style={styles.section}>
                <SectionHeader
                  title={t(`sections.${section as (typeof EVENING_SECTIONS)[number]}`)}
                  {...(section === 'tomorrow_first' ? {} : { count: String(rows.length) })}
                />
                <GroupedList testID={`briefing.section.${section}`}>
                  {rows.map((item) => (
                    <ChecklistRow
                      key={item.id}
                      label={item.title}
                      state={isDone(item) ? 'done' : section === 'follow_up' ? 'followUp' : 'open'}
                      {...(item.meta === null ? {} : { meta: item.meta })}
                      {...(!isDone(item) && item.insight_id !== null && section === 'carry_over'
                        ? {
                            onToggle: () => {
                              complete(item);
                            },
                            toggleActionLabel: common('actions.markDone'),
                          }
                        : {})}
                      testID={`briefing.item.${item.id}`}
                    />
                  ))}
                </GroupedList>
              </View>
            ))}
          </View>
        </OverlappingSheet>
      </ScrollView>
      <StickyCTABar
        style={{
          paddingBottom: Math.max(insets.bottom, 12),
          paddingHorizontal: theme.layout.screenX,
        }}
      >
        {confirmedAt === null ? (
          <Button
            label={t('evening.ready')}
            icon="bedtime"
            fullWidth
            onPress={() => {
              track('evening_ready_opened');
              sheets.open(EVENING_READY_SHEET, { briefingId: briefing.id, items: carry });
            }}
            testID="briefing.eveningReady"
          />
        ) : (
          <Text variant="body" tone="secondary" align="center" testID="briefing.eveningConfirmed">
            {t('evening.confirmedRow', {
              time: format.dateTime(new Date(confirmedAt), { hour: '2-digit', minute: '2-digit' }),
            })}
          </Text>
        )}
      </StickyCTABar>
    </View>
  );
}

export function BriefingScreen() {
  const t = useTranslations('briefing');
  const common = useTranslations('common');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; via?: string; src?: string }>();
  const id = params.id;
  const query = useBriefing(id);
  const detail = query.data;
  const opened = useRef(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (detail === undefined || detail === null || opened.current) return;
    if (detail.briefing.status !== 'ready' && detail.briefing.status !== 'delivered') return;
    opened.current = true;
    track('briefing_opened', { kind: detail.briefing.kind, via: viaOf(params.via ?? params.src) });
    void markOpened(detail.briefing.id).catch(() => undefined);
  }, [detail, params.via, params.src]);

  const goToday = () => {
    router.replace('/today');
  };
  const frame = (content: ReactNode) => (
    <View
      style={[styles.fill, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.briefing"
    >
      <DetailHeader
        leading="back"
        onLeadingPress={() => {
          if (router.canGoBack()) router.back();
          else goToday();
        }}
        leadingAccessibilityLabel={common('actions.back')}
      />
      <View style={[styles.state, { paddingHorizontal: theme.layout.screenX }]}>{content}</View>
    </View>
  );

  if (query.isPending) {
    return frame(
      <SkeletonGroup accessibilityLabel={common('a11y.loading')} testID="briefing.loading">
        <SkeletonBlock height={22} width="85%" />
        <SkeletonBlock height={22} width="55%" />
        <SkeletonBlock height={120} />
      </SkeletonGroup>,
    );
  }
  if (query.isError && detail === undefined) {
    return frame(
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={t('errors.loadFailed')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="briefing.error"
      />,
    );
  }
  if (detail === undefined || detail === null) {
    return frame(
      <NotFoundState
        variant="entity"
        title={t('errors.goneTitle')}
        body={t('errors.goneBody')}
        backAction={{ label: common('actions.backToToday'), onPress: goToday }}
        testID="briefing.notFound"
      />,
    );
  }
  const { briefing } = detail;
  if (briefing.kind === 'weekly') return <Redirect href={`/weekly/${briefing.id}`} />;
  if ((briefing.kind === 'midday' || briefing.kind === 'evening') && !isPro()) {
    return frame(<ContextualGate feature={briefing.kind} testID="briefing.gate" />);
  }
  if (briefing.status === 'scheduled' || briefing.status === 'generating') {
    return frame(
      <SkeletonGroup accessibilityLabel={t('generating')} testID="briefing.generating">
        <Text variant="h2">{t('generating')}</Text>
        <SkeletonBlock height={22} width="85%" />
        <SkeletonBlock height={22} width="60%" />
      </SkeletonGroup>,
    );
  }
  if (briefing.status === 'failed') {
    return frame(
      <ErrorCard
        icon="error"
        tone="neutral"
        title={t('errors.failedTitle')}
        body={t('errors.failedBody')}
        primaryAction={{
          label: common('actions.retry'),
          loading: retrying,
          onPress: () => {
            setRetrying(true);
            void getApiClient()
              .call('POST /briefings/:id/retry', { params: { id: briefing.id }, body: {} })
              .then(() => query.refetch())
              .catch(() => {
                showToast({ message: common('toast.saveFailed'), kind: 'error' });
              })
              .finally(() => {
                setRetrying(false);
              });
          },
        }}
        secondaryAction={{ label: common('actions.backToToday'), onPress: goToday }}
        testID="briefing.failed"
      />,
    );
  }
  const body =
    briefing.kind === 'midday' ? (
      <MiddayView detail={detail} />
    ) : briefing.kind === 'evening' ? (
      <EveningView detail={detail} />
    ) : (
      <MorningView detail={detail} />
    );
  return (
    <View style={[styles.fill, { backgroundColor: theme.color.bg }]} testID="screen.briefing">
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { gap: 22 },
  section: { gap: 8 },
  state: { flex: 1, justifyContent: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
});
