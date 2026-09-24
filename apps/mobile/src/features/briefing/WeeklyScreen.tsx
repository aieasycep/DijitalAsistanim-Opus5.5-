/**
 * M-BR-05 weekly review ("Haftan nasıl geçti?", `weekly/[id]`): the ISO week (Mon–Sun, D-25),
 * the narrative, the aggregate rows from `briefings.weekly_stats` (zero rows omitted; the deadline
 * phrasing depends on how many were surfaced in time, D-07; the prep clause only for Pro), the time
 * saved (formula v1, versioned server-side), the people you were most in touch with (in-app only,
 * never on the share card) and the share CTA. Opening marks it opened (RPC-07).
 */
import { formatDuration, toUpper } from '@da/i18n';
import {
  Button,
  DetailHeader,
  EditorialParagraph,
  EditorialStatRow,
  ErrorCard,
  GroupedList,
  HighlightCard,
  ListRow,
  NotFoundState,
  SectionHeader,
  SkeletonBlock,
  SkeletonGroup,
  StickyCTABar,
  Text,
  TextAction,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFormatter, useLocale, useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { isPro } from '../pro-gate/ProGate';
import { markOpened, useBriefing } from './data';

export interface WeeklyStats {
  readonly mails_analyzed: number;
  readonly important_count: number;
  readonly meetings: number;
  readonly meetings_with_prep: number;
  readonly followups: number;
  readonly followups_answered: number;
  readonly deadlines: number;
  readonly deadlines_surfaced_on_time: number;
  readonly time_saved_min: number;
  readonly unopened_mails: number;
  readonly prep_notes: number;
  readonly followup_drafts: number;
  readonly top_contacts: readonly { readonly contact_id: string; readonly count: number }[];
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function readWeeklyStats(raw: Readonly<Record<string, unknown>> | null): WeeklyStats {
  const stats = raw ?? {};
  const basis = (
    typeof stats.time_saved_basis === 'object' && stats.time_saved_basis !== null
      ? stats.time_saved_basis
      : {}
  ) as Record<string, unknown>;
  const contacts = Array.isArray(stats.top_contacts) ? stats.top_contacts : [];
  return {
    mails_analyzed: num(stats.mails_analyzed),
    important_count: num(stats.important_count),
    meetings: num(stats.meetings),
    meetings_with_prep: num(stats.meetings_with_prep),
    followups: num(stats.followups),
    followups_answered: num(stats.followups_answered),
    deadlines: num(stats.deadlines),
    deadlines_surfaced_on_time: num(stats.deadlines_surfaced_on_time),
    time_saved_min: num(stats.time_saved_min),
    unopened_mails: num(basis.unopened_mails),
    prep_notes: num(basis.prep_notes),
    followup_drafts: num(basis.followup_drafts),
    top_contacts: contacts.flatMap((c: unknown) => {
      if (typeof c !== 'object' || c === null) return [];
      const row = c as Record<string, unknown>;
      return typeof row.contact_id === 'string'
        ? [{ contact_id: row.contact_id, count: num(row.count) }]
        : [];
    }),
  };
}

/** The ISO week (Monday…Sunday) that ends on or contains `localDate`. */
export function isoWeek(localDate: string): { readonly start: Date; readonly end: Date } {
  const day = new Date(`${localDate}T12:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7;
  const start = new Date(day.getTime() - weekday * 86_400_000);
  return { start, end: new Date(start.getTime() + 6 * 86_400_000) };
}

export function WeeklyScreen() {
  const t = useTranslations('briefing.weekly');
  const common = useTranslations('common');
  const format = useFormatter();
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const params = useLocalSearchParams<{ id: string; source?: string }>();
  const query = useBriefing(params.id);
  const detail = query.data;
  const stats = readWeeklyStats(detail?.briefing.weekly_stats ?? null);
  const contactIds = stats.top_contacts.map((c) => c.contact_id);
  const people = useQuery({
    queryKey: ['weekly', params.id, 'people'],
    enabled: contactIds.length > 0,
    queryFn: async () => {
      const { data } = (await getSupabase()
        .from('contacts')
        .select('id, display_name')
        .in('id', contactIds)) as { data: { id: string; display_name: string }[] | null };
      return data ?? [];
    },
  });
  const opened = useRef(false);
  const lang = locale === 'en' ? 'en' : 'tr';

  useEffect(() => {
    if (detail === undefined || detail === null || opened.current) return;
    opened.current = true;
    const source = params.source;
    track('weekly_open', {
      source:
        source === 'push' || source === 'widget' || source === 'history' || source === 'deeplink'
          ? source
          : 'today',
    });
    void markOpened(detail.briefing.id).catch(() => undefined);
  }, [detail, params.source]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  };
  const frame = (content: ReactNode) => (
    <View
      style={[styles.root, { backgroundColor: theme.color.bgEditorial, paddingTop: insets.top }]}
      testID="screen.weekly"
    >
      <DetailHeader
        leading="close"
        onLeadingPress={close}
        leadingAccessibilityLabel={common('actions.close')}
      />
      {content}
    </View>
  );

  if (query.isPending) {
    return frame(
      <View style={{ paddingHorizontal: theme.layout.screenX }}>
        <SkeletonGroup accessibilityLabel={common('a11y.loading')}>
          <SkeletonBlock height={38} width="70%" />
          <SkeletonBlock height={18} />
          <SkeletonBlock height={18} width="80%" />
        </SkeletonGroup>
      </View>,
    );
  }
  if (query.isError && detail === undefined) {
    return frame(
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
        testID="weekly.error"
      />,
    );
  }
  if (detail === undefined || detail === null) {
    return frame(
      <NotFoundState
        variant="entity"
        title={t('goneTitle')}
        body={t('goneBody')}
        backAction={{
          label: common('actions.backToToday'),
          onPress: () => {
            router.replace('/today');
          },
        }}
        testID="weekly.notFound"
      />,
    );
  }

  const week = isoWeek(detail.briefing.local_date);
  const range = `${format.dateTime(week.start, { day: 'numeric', timeZone: 'UTC' })}–${format.dateTime(week.end, { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
  const pro = isPro();
  const statRows = [
    stats.mails_analyzed > 0
      ? { key: 'mails', value: String(stats.mails_analyzed), label: t('stats.mails') }
      : null,
    stats.important_count > 0
      ? {
          key: 'important',
          value: String(stats.important_count),
          label: t('stats.important'),
          highlighted: true,
        }
      : null,
    stats.meetings > 0
      ? {
          key: 'meetings',
          value: String(stats.meetings),
          label:
            pro && stats.meetings_with_prep > 0
              ? t('stats.meetingsWithPrep', { prep: stats.meetings_with_prep })
              : t('stats.meetings'),
        }
      : null,
    stats.followups > 0
      ? {
          key: 'followups',
          value: String(stats.followups),
          label: t('stats.followups', { answered: stats.followups_answered }),
        }
      : null,
    stats.deadlines > 0
      ? {
          key: 'deadlines',
          value: String(stats.deadlines),
          label:
            stats.deadlines_surfaced_on_time >= stats.deadlines
              ? t('stats.deadlinesAll')
              : t('stats.deadlinesSome', { onTime: stats.deadlines_surfaced_on_time }),
        }
      : null,
  ].filter(
    (row): row is { key: string; value: string; label: string; highlighted?: boolean } =>
      row !== null,
  );
  const names = new Map((people.data ?? []).map((p) => [p.id, p.display_name]));

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bgEditorial, paddingTop: insets.top }]}
      testID="screen.weekly"
    >
      <DetailHeader
        leading="close"
        onLeadingPress={close}
        leadingAccessibilityLabel={common('actions.close')}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: theme.layout.screenX, paddingBottom: 120 + insets.bottom },
        ]}
      >
        <Text variant="kicker" tone="tertiaryStrong">
          {toUpper(range, lang)}
        </Text>
        <Text variant="editorialKicker">{t('kicker')}</Text>
        <Text variant="editorialDisplay" heading>
          {t('title')}
        </Text>
        {detail.briefing.narrative === null ? null : (
          <EditorialParagraph spans={[{ key: 'n', text: detail.briefing.narrative }]} />
        )}
        <View testID="weekly.stats">
          {statRows.map((row, index) => (
            <EditorialStatRow
              key={row.key}
              value={row.value}
              label={row.label}
              first={index === 0}
              {...(row.highlighted === true ? { highlighted: true } : {})}
            />
          ))}
        </View>
        {stats.time_saved_min > 0 ? (
          <HighlightCard
            kicker={t('timeSavedKicker')}
            figure={formatDuration(stats.time_saved_min, lang)}
            note={t('timeSavedNote', {
              mails: stats.unopened_mails,
              prep: stats.prep_notes,
              drafts: stats.followup_drafts,
            })}
            testID="weekly.timeSaved"
          />
        ) : null}
        {stats.top_contacts.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeader title={t('topContacts')} />
            <GroupedList testID="weekly.people">
              {stats.top_contacts.map((contact) => {
                const route = `/person/${contact.contact_id}`;
                return (
                  <ListRow
                    key={contact.contact_id}
                    title={names.get(contact.contact_id) ?? t('personUnknown')}
                    subtitle={t('personMeta', { count: contact.count })}
                    icon="person"
                    {...(isScreenAvailable(route)
                      ? {
                          trailing: { kind: 'chevron' as const },
                          onPress: () => {
                            track('weekly_person_opened');
                            router.push(route);
                          },
                        }
                      : {})}
                  />
                );
              })}
            </GroupedList>
          </View>
        )}
        <TextAction
          label={t('briefingsLink')}
          onPress={() => {
            router.push('/briefings');
          }}
          testID="weekly.history"
        />
      </ScrollView>
      <StickyCTABar
        fade
        style={{
          paddingBottom: Math.max(insets.bottom, 12),
          paddingHorizontal: theme.layout.screenX,
        }}
      >
        <Button
          label={t('shareCta')}
          icon="ios_share"
          fullWidth
          disabled={!online}
          onPress={() => {
            track('weekly_share_opened');
            router.push(`/weekly/${detail.briefing.id}/share`);
          }}
          testID="weekly.share"
        />
      </StickyCTABar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 16 },
  section: { gap: 8 },
});
