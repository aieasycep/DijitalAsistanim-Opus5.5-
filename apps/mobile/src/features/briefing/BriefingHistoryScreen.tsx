/**
 * M-BR-07 briefing history (`/briefings`): past briefings within the retention window, grouped by
 * local date ("BUGÜN", "DÜN", "{22 EYLÜL SALI}"), 30 per page with infinite scroll (disabled
 * offline), including skipped middays ("Değişiklik yoktu"). A row opens `briefing/{id}` or
 * `weekly/{id}`.
 */
import { formatDatePattern, toLocalDateString, toUpper } from '@da/i18n';
import {
  DetailHeader,
  EmptyState,
  ErrorCard,
  GroupedList,
  ListRow,
  SectionHeader,
  Text,
  useTheme,
  type IconName,
} from '@da/ui';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFormatter, useLocale, useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { useBriefingHistory, type HistoryRow } from './data';
import { ListSkeleton } from '../common/ListSkeleton';

const ICONS: Readonly<Record<HistoryRow['kind'], IconName>> = {
  morning: 'wb_twilight',
  midday: 'wb_sunny',
  evening: 'bedtime',
  weekly: 'auto_awesome',
};

export interface HistoryGroup {
  readonly date: string;
  readonly rows: readonly HistoryRow[];
}

export function groupByDate(rows: readonly HistoryRow[]): readonly HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.date === row.local_date)
      groups[groups.length - 1] = { date: last.date, rows: [...last.rows, row] };
    else groups.push({ date: row.local_date, rows: [row] });
  }
  return groups;
}

export function BriefingHistoryScreen() {
  const t = useTranslations('briefing.history');
  const kinds = useTranslations('briefing.kinds');
  const common = useTranslations('common');
  const format = useFormatter();
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const query = useBriefingHistory();
  const rows = (query.data?.pages ?? []).flat();
  const groups = groupByDate(rows);
  const lang = locale === 'en' ? 'en' : 'tr';
  const timeZone = cachedBootstrap()?.preferences.timezone ?? 'Europe/Istanbul';
  const today = toLocalDateString(now(), timeZone);
  const yesterday = toLocalDateString(new Date(now().getTime() - 86_400_000), timeZone);

  useEffect(() => {
    track('briefing_history_opened');
  }, []);

  const label = (date: string) =>
    date === today
      ? t('today')
      : date === yesterday
        ? t('yesterday')
        : formatDatePattern(`${date}T12:00:00Z`, 'weekdayDayMonth', { locale: lang, timeZone });

  const header = (
    <View style={styles.header}>
      <Text variant="kicker" tone="tertiaryStrong">
        {toUpper(t('kicker'), lang)}
      </Text>
    </View>
  );

  let content;
  if (query.isPending) {
    content = <ListSkeleton rows={6} accessibilityLabel={common('a11y.loading')} />;
  } else if (query.isError && rows.length === 0) {
    content = (
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={t('loadFailed')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="history.error"
      />
    );
  } else if (rows.length === 0) {
    const morning = cachedBootstrap()?.preferences.morning_time.slice(0, 5) ?? '08:00';
    content = (
      <EmptyState
        icon="wb_twilight"
        tone="primary"
        title={t('emptyTitle')}
        body={t('emptyBody', { time: morning, time_loc: morning })}
        testID="history.empty"
      />
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.history"
    >
      <DetailHeader
        leading="back"
        onLeadingPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/today');
        }}
        leadingAccessibilityLabel={common('actions.back')}
      />
      {content !== undefined ? (
        <View style={[styles.state, { paddingHorizontal: theme.layout.screenX }]}>
          {header}
          {content}
        </View>
      ) : (
        <FlashList
          data={groups}
          keyExtractor={(group) => group.date}
          contentContainerStyle={[styles.list, { paddingHorizontal: theme.layout.screenX }]}
          ListHeaderComponent={header}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => {
                void query.refetch();
              }}
              tintColor={theme.color.brand.primary}
            />
          }
          onEndReached={() => {
            if (online && query.hasNextPage && !query.isFetchingNextPage)
              void query.fetchNextPage();
          }}
          renderItem={({ item: group }) => (
            <View style={styles.group}>
              <SectionHeader title={label(group.date)} />
              <GroupedList>
                {group.rows.map((row) => {
                  const skipped = row.kind === 'midday' && row.status === 'skipped';
                  const time =
                    row.generated_at === null
                      ? ''
                      : format.dateTime(new Date(row.generated_at), {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                  const meta = [skipped ? t('noChange') : (row.headline ?? ''), time]
                    .filter((p) => p !== '')
                    .join(' · ');
                  return (
                    <ListRow
                      key={row.id}
                      title={kinds(row.kind)}
                      {...(meta === '' ? {} : { subtitle: meta })}
                      icon={ICONS[row.kind]}
                      trailing={{ kind: 'chevron' }}
                      onPress={() => {
                        track('briefing_opened', { kind: row.kind, via: 'history' });
                        router.push(
                          row.kind === 'weekly'
                            ? `/weekly/${row.id}?source=history`
                            : `/briefing/${row.id}?via=history`,
                        );
                      }}
                      accessibilityLabel={[kinds(row.kind), label(group.date), meta]
                        .filter((p) => p !== '')
                        .join(', ')}
                      testID={`history.row.${row.id}`}
                    />
                  );
                })}
              </GroupedList>
            </View>
          )}
          testID="history.list"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingVertical: 8 },
  // FlashList (T-8.28) takes padding only; groups space themselves with their bottom margin.
  list: { paddingBottom: 32 },
  group: { gap: 8, marginBottom: 16 },
  state: { gap: 12 },
});
