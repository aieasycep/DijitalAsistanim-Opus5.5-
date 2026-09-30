/**
 * M-APPR-01 Onay Bekleyenler and M-APPR-02 Onay geçmişi (`/approvals`, `?view=history&status=`).
 * The persistent queue of every write waiting on the user (M§33): BEKLEYEN, İŞLENİYOR,
 * TAMAMLANAMADI (failed in the last 24 h) and BUGÜN TAMAMLANANLAR, each approved individually
 * (no bulk approve). Reads RPC-10 `list_approvals`; in-flight rows are polled (R-19); the list is
 * persisted and readable offline, where every decision is blocked (never queued, M§94).
 */
import type { ApprovalStatus } from '@da/domain';
import { formatDatePattern, formatRelativeDay, toLocalDateString, toUpper } from '@da/i18n';
import { qk } from '@da/api-client';
import {
  AssuranceNote,
  DetailHeader,
  EmptyState,
  ErrorCard,
  FilterChipRow,
  GroupedList,
  ListRow,
  OfflineBanner,
  SectionHeader,
  Text,
  TextAction,
  useTheme,
} from '@da/ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { ListSkeleton } from '../common/ListSkeleton';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import { listApprovals } from './api';
import { ApprovalItem } from './ApprovalItem';
import { countBucket, isInFlight, type ApprovalModel } from './model';
import { useApprovalPresenter } from './present';

const DAY_MS = 86_400_000;
const ACTIVE: readonly ApprovalStatus[] = ['pending', 'approved', 'executing'];
const RECENT: readonly ApprovalStatus[] = ['failed', 'executed'];

export const HISTORY_FILTERS = ['all', 'executed', 'rejected', 'failed', 'expired'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

const HISTORY_STATUSES: Readonly<Record<HistoryFilter, readonly ApprovalStatus[]>> = {
  all: ['executed', 'rejected', 'failed', 'expired'],
  executed: ['executed'],
  rejected: ['rejected'],
  failed: ['failed'],
  expired: ['expired'],
};

export interface ApprovalSections {
  readonly pending: readonly ApprovalModel[];
  readonly inFlight: readonly ApprovalModel[];
  readonly failed: readonly ApprovalModel[];
  readonly doneToday: readonly ApprovalModel[];
}

/** The M-APPR-01 sections (pending by expiry asc nulls last, then newest). */
export function sectionize(
  models: readonly ApprovalModel[],
  at: Date,
  timeZone: string,
): ApprovalSections {
  const today = toLocalDateString(at, timeZone);
  const pending = models
    .filter((m) => m.status === 'pending')
    .sort((a, b) => {
      const ea = a.expiresAt === null ? Infinity : Date.parse(a.expiresAt);
      const eb = b.expiresAt === null ? Infinity : Date.parse(b.expiresAt);
      if (ea !== eb) return ea - eb;
      return b.createdAt.localeCompare(a.createdAt);
    });
  return {
    pending,
    inFlight: models.filter(isInFlight),
    failed: models.filter(
      (m) =>
        m.status === 'failed' &&
        m.failedAt !== null &&
        at.getTime() - Date.parse(m.failedAt) < DAY_MS,
    ),
    doneToday: models.filter(
      (m) =>
        m.status === 'executed' &&
        m.executedAt !== null &&
        toLocalDateString(m.executedAt, timeZone) === today,
    ),
  };
}

async function fetchCenter(): Promise<readonly ApprovalModel[]> {
  const [active, recent] = await Promise.all([
    listApprovals(ACTIVE, null, 100),
    listApprovals(RECENT, null, 50),
  ]);
  return [...active.items, ...recent.items];
}

function isFilter(value: unknown): value is HistoryFilter {
  return (HISTORY_FILTERS as readonly unknown[]).includes(value);
}

export function ApprovalCenterScreen() {
  const params = useLocalSearchParams<{ view?: string; status?: string }>();
  return params.view === 'history' ? (
    <HistoryView initial={isFilter(params.status) ? params.status : 'all'} />
  ) : (
    <PendingView />
  );
}

function Frame({
  children,
  trailing,
  testID,
}: {
  readonly children: React.ReactNode;
  readonly trailing?: React.ReactNode;
  readonly testID: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const common = useTranslations('common');
  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID={testID}
    >
      <DetailHeader
        leading="back"
        onLeadingPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/today');
        }}
        leadingAccessibilityLabel={common('actions.back')}
        {...(trailing === undefined ? {} : { trailing })}
      />
      {children}
    </View>
  );
}

function PendingView() {
  const t = useTranslations('approvals');
  const states = useTranslations('states');
  const common = useTranslations('common');
  const theme = useTheme();
  const router = useRouter();
  const online = useOnline();
  const tz = userTimeZone();
  const query = useQuery({
    queryKey: qk.approvals.pending(),
    queryFn: fetchCenter,
    meta: { persist: true },
    staleTime: 0,
    refetchInterval: (q) => ((q.state.data ?? []).some(isInFlight) ? 1_500 : false),
  });
  const models = query.data ?? [];
  const sections = sectionize(models, now(), tz);
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || query.data === undefined) return;
    viewed.current = true;
    track('approval_center_view', { pending_count_bucket: countBucket(sections.pending.length) });
  }, [query.data, sections.pending.length]);

  const openHistory = () => {
    router.setParams({ view: 'history' });
  };
  const history = (
    <TextAction label={t('tabs.history')} onPress={openHistory} testID="approvals.historyLink" />
  );

  let content;
  if (query.isPending) {
    content = <ListSkeleton rows={2} accessibilityLabel={common('a11y.loading')} />;
  } else if (query.isError && query.data === undefined) {
    content = (
      <ErrorCard
        icon="error"
        tone="neutral"
        title={states('error.action.title')}
        body={states('error.action.body')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="approvals.error"
      />
    );
  }

  const section = (key: string, title: string, rows: readonly ApprovalModel[], count?: string) =>
    rows.length === 0 ? null : (
      <View style={styles.section} key={key} testID={`approvals.section.${key}`}>
        <SectionHeader title={title} {...(count === undefined ? {} : { count })} />
        {rows.map((model) => (
          <ApprovalItem
            key={model.id}
            model={model}
            via="approval_center"
            testID={`approvals.card.${model.id}`}
          />
        ))}
      </View>
    );

  return (
    <Frame trailing={history} testID="screen.approvals">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => {
              void query.refetch();
            }}
            tintColor={theme.color.brand.primary}
          />
        }
      >
        <Text variant="h1" heading>
          {t('pendingTitle')}
        </Text>
        <Text variant="secondary">{t('center.subtitle', { count: sections.pending.length })}</Text>
        {!online ? (
          <OfflineBanner
            message={t('offline.banner')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void query.refetch();
            }}
            testID="approvals.offline"
          />
        ) : null}
        {content ?? (
          <>
            {sections.pending.length === 0 ? (
              <EmptyState
                icon="task_alt"
                tone="neutral"
                title={states('empty.approvals.title')}
                body={states('empty.approvals.body')}
                action={{ label: states('empty.approvals.cta'), onPress: openHistory }}
                testID="approvals.empty"
              />
            ) : (
              section('pending', t('center.pending'), sections.pending)
            )}
            {section('inFlight', t('center.inFlight'), sections.inFlight)}
            {section('failed', t('center.failed'), sections.failed)}
            {section(
              'done',
              t('center.doneToday'),
              sections.doneToday,
              String(sections.doneToday.length),
            )}
          </>
        )}
        <AssuranceNote text={t('center.assurance')} />
      </ScrollView>
    </Frame>
  );
}

function HistoryView({ initial }: { readonly initial: HistoryFilter }) {
  const t = useTranslations('approvals');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const theme = useTheme();
  const router = useRouter();
  const lang = useLang();
  const tz = userTimeZone();
  const present = useApprovalPresenter();
  const params = useLocalSearchParams<{ status?: string }>();
  const filter: HistoryFilter = isFilter(params.status) ? params.status : initial;
  const query = useInfiniteQuery({
    queryKey: qk.approvals.history(filter),
    queryFn: ({ pageParam }) => listApprovals(HISTORY_STATUSES[filter], pageParam, 30),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    meta: { persist: true },
  });
  useEffect(() => {
    track('approval_history_view', { filter });
  }, [filter]);
  const rows = (query.data?.pages ?? []).flatMap((p) => p.items);
  const byDay = new Map<string, ApprovalModel[]>();
  for (const row of rows) {
    const at = row.executedAt ?? row.failedAt ?? row.rejectedAt ?? row.createdAt;
    const day = at === '' ? '' : toLocalDateString(at, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const retentionT = useTranslations('privacy.retention.options');
  const retention = retentionT(cachedBootstrap()?.preferences.retention_policy ?? 'd90');
  let content;
  if (query.isPending)
    content = <ListSkeleton rows={5} accessibilityLabel={common('a11y.loading')} />;
  else if (query.isError && rows.length === 0) {
    content = (
      <ErrorCard
        icon="error"
        tone="neutral"
        title={states('error.action.title')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="approvals.history.error"
      />
    );
  } else if (rows.length === 0) {
    content = (
      <EmptyState
        icon="history"
        tone="neutral"
        title={t('history.emptyTitle')}
        body={t('history.emptyBody', { retention })}
        testID="approvals.history.empty"
      />
    );
  }
  return (
    <Frame testID="screen.approvals.history">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        <Text variant="h1" heading>
          {t('history.title')}
        </Text>
        <FilterChipRow
          items={HISTORY_FILTERS.map((key) => ({ key, label: t(`history.filters.${key}`) }))}
          selectedKey={filter}
          onSelect={(key) => {
            router.setParams({ view: 'history', status: key });
          }}
          semantics="tabs"
          testID="approvals.history.filters"
        />
        {content ??
          [...byDay.entries()].map(([day, items]) => (
            <View key={day} style={styles.section}>
              <SectionHeader
                title={
                  day === ''
                    ? ''
                    : toUpper(
                        formatDatePattern(`${day}T12:00:00Z`, 'weekdayDayMonth', {
                          locale: lang,
                          timeZone: 'UTC',
                        }),
                        lang,
                      )
                }
              />
              <GroupedList>
                {items.map((model) => {
                  const at =
                    model.executedAt ?? model.failedAt ?? model.rejectedAt ?? model.createdAt;
                  const time =
                    at === ''
                      ? ''
                      : formatRelativeDay(at, { locale: lang, now: now().getTime(), timeZone: tz });
                  const status = present.statusLabel(model);
                  return (
                    <ListRow
                      key={model.id}
                      title={model.title}
                      subtitle={[present.typeLabel(model), status, time]
                        .filter(Boolean)
                        .join(' · ')}
                      icon={
                        model.status === 'executed'
                          ? 'check_circle'
                          : model.status === 'failed'
                            ? 'error'
                            : model.status === 'expired'
                              ? 'hourglass_empty'
                              : 'cancel'
                      }
                      trailing={{ kind: 'chevron' }}
                      onPress={() => {
                        router.push(`/approvals/${model.id}`);
                      }}
                      accessibilityLabel={t('history.rowA11y', {
                        status,
                        title: model.title,
                        time,
                      })}
                      testID={`approvals.history.row.${model.id}`}
                    />
                  );
                })}
              </GroupedList>
            </View>
          ))}
        {query.hasNextPage ? (
          <TextAction
            label={common('actions.loadMore')}
            onPress={() => {
              void query.fetchNextPage();
            }}
            testID="approvals.history.more"
          />
        ) : null}
      </ScrollView>
    </Frame>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 14, paddingBottom: 40 },
  section: { gap: 10 },
});
