/**
 * M-MAIL-01 · Mail Zekâsı and M-MAIL-02 · category drill-down. One RPC-08 call per day drives
 * every number (categories are mutually exclusive), the six fixed categories route as the audit
 * requires — "Senden cevap bekleyen" → `waiting`, "Senin cevap beklediğin" → `followups` (the
 * prototype's swap is not reproduced) — and zero-count rows still open. Cards show AI one-liners,
 * never raw bodies. Corrections write `ai_feedback` for the thread (`show_more` / `not_important`,
 * undoable); learned preferences are derived server-side only.
 */
import { qk } from '@da/api-client';
import { useApiClient } from '@da/api-client/react';
import type { MailCategory } from '@da/domain';
import { withTrCases } from '@da/i18n';
import {
  Button,
  CardSkeleton,
  CategoryRow,
  EmptyState,
  ErrorCard,
  FilterChipRow,
  GroupedList,
  HeroStat,
  IconButton,
  MailSummaryCard,
  NotFoundState,
  SectionHeader,
  SkeletonGroup,
  Text,
  useTheme,
  useToast,
  type IconName,
} from '@da/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { deadlineBlock, useProposals } from '../actions/proposals';
import { openMenu } from '../actions/sheets';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import { syncAccounts } from '../flow/data';
import {
  DRILL_CATEGORIES,
  isMailCategory,
  latestMessageId,
  mailCategoryOptions,
  mailIntelOptions,
  oneLiner,
  senderOf,
  type MailRowData,
} from './data';

const CATEGORY_ICON: Readonly<Record<MailCategory, IconName>> = {
  important: 'priority_high',
  awaiting_my_reply: 'person',
  awaiting_their_reply: 'schedule_send',
  has_deadline: 'flag',
  informational: 'info',
  low_priority: 'low_priority',
};

const ATTENTION: readonly MailCategory[] = ['important', 'awaiting_my_reply', 'has_deadline'];

/** Category row routing (M-MAIL-01 table; the SECONDARY swap is not reproduced). */
export function categoryRoute(category: MailCategory, account: string): string {
  const query = account === 'all' ? '' : `?account=${account}`;
  switch (category) {
    case 'awaiting_my_reply':
      return '/waiting';
    case 'awaiting_their_reply':
      return '/followups';
    default:
      return `/mail/category/${category}${query}`;
  }
}

function useMailFeedback() {
  const toast = useToast();
  const session = useSessionContext();
  const t = useTranslations('mail.screen');
  const tc = useTranslations('common');
  return (threadId: string, kind: 'show_more' | 'not_important') => {
    const userId = session.data?.profile.id;
    if (userId === undefined) return;
    track('insight_feedback', { kind });
    const id = Crypto.randomUUID();
    const insert = getSupabase()
      .from('ai_feedback')
      .insert({
        id,
        user_id: userId,
        feature: 'email_triage',
        target_type: 'email_thread',
        target_id: threadId,
        rating: kind === 'show_more' ? 1 : -1,
        reason_code: kind,
        client_mutation_id: id,
      });
    void Promise.resolve(insert).then(({ error }) => {
      if (error !== null) toast.show({ message: t('feedbackFailed'), kind: 'error' });
    });
    toast.show({
      message: kind === 'show_more' ? tc('toast.learnedHigher') : tc('toast.learnedLower'),
      kind: 'success',
      action: {
        label: tc('actions.undo'),
        onPress: () => {
          track('correction_undo', { kind });
          void Promise.resolve(getSupabase().from('ai_feedback').delete().eq('id', id));
        },
      },
    });
  };
}

interface MailCardProps {
  readonly row: MailRowData;
  readonly action: 'reply' | 'calendar' | 'open' | 'none';
  readonly correction: 'show_more' | 'not_important';
  readonly onOpened?: () => void;
}

/** One thread as a `MailSummaryCard` (avatar, sender, badge, time, AI one-liner, one action). */
export function MailCard({ row, action, correction, onOpened }: MailCardProps) {
  const t = useTranslations('mail.screen');
  const tc = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const formats = useFormats();
  const blocked = useOfflineGuard();
  const proposals = useProposals('email_detail');
  const feedback = useMailFeedback();
  const sender = senderOf(row);
  const summary = oneLiner(row.ai_summary) ?? row.subject ?? t('noSubject');
  const badge =
    row.urgency === 'urgent'
      ? { label: tc('badges.urgent'), category: 'urgent' as const }
      : row.deadline_at !== null
        ? { label: tc('badges.deadline'), category: 'deadline' as const }
        : undefined;
  const open = async (reply: boolean) => {
    const id = await latestMessageId(row.thread_id).catch(() => null);
    if (id === null) {
      toast.show({ message: t('openFailed'), kind: 'error' });
      return;
    }
    onOpened?.();
    router.push(reply ? `/mail/${id}/reply?mode=reply&origin=mail` : `/mail/${id}`);
  };
  const cardAction =
    action === 'reply'
      ? {
          key: 'reply',
          label: tc('actions.prepareReply'),
          onPress: () => {
            track('mail_card_action', { action: 'reply' });
            if (!blocked('reply')) void open(true);
          },
        }
      : action === 'calendar' && row.deadline_at !== null
        ? {
            key: 'calendar',
            label: tc('actions.addToCalendar'),
            onPress: () => {
              const due = row.deadline_at;
              if (due === null) return;
              track('mail_card_action', { action: 'remind' });
              const block = deadlineBlock(due, now().getTime());
              void proposals.proposeEvent({
                title: row.subject ?? summary,
                start: block.start,
                end: block.end,
                origin: 'email_detail',
                originRef: null,
                originRefId: null,
                source: {
                  source_type: 'email_thread',
                  source_id: row.thread_id,
                  source_provider: row.provider as 'google',
                  source_timestamp: row.last_message_at,
                },
                invalidate: [qk.mail.all],
              });
            },
          }
        : action === 'open'
          ? {
              key: 'open',
              label: tc('actions.open'),
              onPress: () => {
                track('mail_card_action', { action: 'open' });
                void open(false);
              },
            }
          : undefined;
  return (
    <MailSummaryCard
      senderName={sender}
      senderId={row.thread_id}
      time={
        formats.relativeDay(row.last_message_at) === 'today'
          ? formats.time(row.last_message_at)
          : formats.dayMonth(row.last_message_at)
      }
      summary={summary}
      {...(badge === undefined ? {} : { badge })}
      unread={row.has_unread}
      {...(cardAction === undefined ? {} : { action: cardAction })}
      onPress={() => {
        void open(false);
      }}
      onMore={() => {
        openMenu({
          options: [
            {
              key: correction,
              label: correction === 'show_more' ? t('wasImportant') : t('notImportant'),
              icon: correction === 'show_more' ? 'priority_high' : 'low_priority',
              onPress: () => {
                feedback(row.thread_id, correction);
              },
            },
            {
              key: 'open',
              label: tc('actions.open'),
              icon: 'mail',
              onPress: () => {
                void open(false);
              },
            },
          ],
        });
      }}
      moreLabel={tc('a11y.moreOptions')}
      accessibilityLabel={[sender, badge?.label, summary].filter(Boolean).join(', ')}
      testID={`mail.card.${row.thread_id}`}
    />
  );
}

function IntelSkeleton() {
  const t = useTranslations('states.loading');
  return (
    <SkeletonGroup accessibilityLabel={t('label')} testID="mail.loading">
      <View style={{ gap: 12 }}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </View>
    </SkeletonGroup>
  );
}

/** M-MAIL-01 · Mail Zekâsı. */
export function MailIntelScreen() {
  const theme = useTheme();
  const t = useTranslations('mail');
  const ts = useTranslations('states');
  const tc = useTranslations('common');
  const router = useRouter();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const formats = useFormats();
  const session = useSessionContext();
  const back = useBack('/flow');
  const params = useLocalSearchParams<{ date?: string; account?: string }>();
  const date =
    params.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : formats.today();
  const mailAccounts = session.accounts.filter((a) =>
    (a.capabilities_granted as readonly string[]).includes('mail_read'),
  );
  const account =
    params.account !== undefined && mailAccounts.some((a) => a.id === params.account)
      ? params.account
      : 'all';
  const query = useQuery(mailIntelOptions(date, account));
  const data = query.data;
  const unclassified = data?.counts.unclassified ?? 0;

  useEffect(() => {
    if (data === undefined) return;
    track('mail_intel_view', {
      accounts_count: mailAccounts.length,
      has_pending_analysis: unclassified > 0,
    });
  }, [data, mailAccounts.length, unclassified]);

  const refresh = async () => {
    await syncAccounts(client, session.accounts);
    await queryClient.invalidateQueries({ queryKey: qk.mail.all });
  };

  const isToday = date === formats.today();
  const kicker = isToday
    ? t('screen.kickerToday')
    : t('screen.kickerDate', { date: formats.dayMonth(`${date}T12:00:00Z`) });

  let body;
  if (mailAccounts.length === 0) {
    body = (
      <EmptyState
        icon="mail"
        tone="primary"
        title={ts('empty.noAccount.title')}
        body={ts('empty.noAccount.body')}
        {...(isScreenAvailable('/settings/accounts')
          ? {
              action: {
                label: ts('empty.noAccount.cta'),
                onPress: () => {
                  router.push('/settings/accounts');
                },
              },
            }
          : {})}
        testID="mail.noAccount"
      />
    );
  } else if (data === undefined) {
    body = query.isError ? (
      <QueryFailure
        screen={t('intelligence.title')}
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
        testID="mail"
      />
    ) : (
      <IntelSkeleton />
    );
  } else {
    const count = (c: MailCategory) => data.counts[c] ?? 0;
    const analyzed = data.total - unclassified;
    const low = count('low_priority');
    const info = count('informational');
    const attentionWidth = data.total === 0 ? 0 : data.attention / data.total;
    const middleWidth = data.total === 0 ? 0 : (info + count('awaiting_their_reply')) / data.total;
    const pendingWidth = data.total === 0 ? 0 : unclassified / data.total;
    const lowWidth = Math.max(0, 1 - attentionWidth - middleWidth - pendingWidth);
    body = (
      <View style={{ gap: 18 }}>
        {query.isError ? (
          <ErrorCard
            icon="sync_problem"
            tone="neutral"
            title={ts('error.refreshFailed')}
            primaryAction={{
              label: tc('actions.retry'),
              onPress: () => {
                void query.refetch();
              },
            }}
            announceOnMount={false}
          />
        ) : null}
        <View
          accessible
          accessibilityLabel={t('screen.heroA11y', {
            total: data.total,
            attention: data.attention,
          })}
          style={{ gap: 6 }}
          testID="mail.hero"
        >
          <HeroStat value={String(data.total)} label={t('screen.received')} />
          <Text variant="h2">
            {data.total === 0
              ? t('screen.noneToday')
              : t('intelligence.attention', { count: data.attention })}
          </Text>
          <Text variant="secondary" tone="secondary">
            {data.total === 0
              ? t('screen.noneBody')
              : t('screen.readSummary', withTrCases({ analyzed, low, info }))}
          </Text>
          {unclassified > 0 ? (
            <Text variant="meta" tone="tertiaryStrong" testID="mail.pending">
              {t('screen.pending', { analyzed, total: data.total })}
            </Text>
          ) : null}
        </View>
        <View
          style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={{ flex: attentionWidth, backgroundColor: theme.color.brand.primary }} />
          <View style={{ flex: middleWidth, backgroundColor: theme.tone.primary.soft }} />
          <View style={{ flex: lowWidth, backgroundColor: theme.color.surfaceTrack }} />
          <View style={{ flex: pendingWidth, backgroundColor: theme.color.surfaceSunken }} />
        </View>
        <GroupedList testID="mail.categories">
          {(
            [
              'important',
              'awaiting_my_reply',
              'awaiting_their_reply',
              'has_deadline',
              'informational',
              'low_priority',
            ] as const
          ).map((category) => (
            <CategoryRow
              key={category}
              label={t(`categories.${category}`)}
              count={String(count(category))}
              icon={CATEGORY_ICON[category]}
              hot={ATTENTION.includes(category) && count(category) > 0}
              onPress={() => {
                track('mail_category_open', { category });
                router.push(categoryRoute(category, account));
              }}
              accessibilityLabel={t('screen.categoryA11y', {
                label: t(`categories.${category}`),
                count: count(category),
              })}
              testID={`mail.category.${category}`}
            />
          ))}
        </GroupedList>
        {data.rows.length === 0 ? null : (
          <View style={{ gap: 12 }}>
            <SectionHeader title={t('categories.important')} count={String(count('important'))} />
            {data.rows.map((row) => (
              <MailCard
                key={row.thread_id}
                row={row}
                action={
                  row.reply_state === 'awaiting_my_reply'
                    ? 'reply'
                    : row.deadline_at !== null
                      ? 'calendar'
                      : 'open'
                }
                correction="not_important"
              />
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <DetailScreen
      kicker={kicker}
      onLeadingPress={back}
      trailing={
        isScreenAvailable('/search') ? (
          <IconButton
            icon="search"
            accessibilityLabel={tc('actions.search')}
            onPress={() => {
              router.push('/search?types=email');
            }}
          />
        ) : undefined
      }
      onRefresh={refresh}
      updatedAt={query.dataUpdatedAt}
      testID="mail.screen"
    >
      {mailAccounts.length > 1 ? (
        <FilterChipRow
          items={[
            { key: 'all', label: t('screen.allAccounts') },
            ...mailAccounts.map((a) => ({
              key: a.id,
              label: a.data_sources.mail_read
                ? (a.display_name ??
                  a.account_email ??
                  tc(a.provider === 'microsoft' ? 'providers.outlook' : 'providers.gmail'))
                : t('screen.paused', {
                    label:
                      a.display_name ??
                      a.account_email ??
                      tc(a.provider === 'microsoft' ? 'providers.outlook' : 'providers.gmail'),
                  }),
            })),
          ]}
          selectedKey={account}
          onSelect={(key) => {
            router.setParams({ account: key });
          }}
          semantics="radio"
          accessibilityLabel={t('screen.accounts')}
          testID="mail.accounts"
        />
      ) : null}
      {body}
    </DetailScreen>
  );
}

/** M-MAIL-02 · one category, grouped by local day (Bugün / Dün / d MMMM), last 7 days. */
export function MailCategoryScreen() {
  const t = useTranslations('mail');
  const ts = useTranslations('states');
  const tc = useTranslations('common');
  const formats = useFormats();
  const back = useBack('/mail');
  const params = useLocalSearchParams<{ category?: string; account?: string }>();
  const category =
    isMailCategory(params.category) && DRILL_CATEGORIES.includes(params.category)
      ? params.category
      : null;
  const account = params.account ?? 'all';
  const query = useInfiniteQuery({
    ...mailCategoryOptions(category ?? 'important', account, formats.today()),
    enabled: category !== null,
  });

  useEffect(() => {
    if (category !== null) track('mail_category_list_view', { category });
  }, [category]);

  if (category === null) {
    return (
      <DetailScreen onLeadingPress={back} testID="mailCategory.screen">
        <NotFoundState
          variant="route"
          title={ts('notFound.route.title')}
          body={ts('notFound.route.body')}
          backAction={{ label: tc('actions.goBack'), onPress: back }}
          testID="mailCategory.notFound"
        />
      </DetailScreen>
    );
  }

  const pages = query.data?.pages ?? [];
  const total = pages.reduce((sum, page) => sum + page.rows.length, 0);
  const label = t(`categories.${category}`);
  const dayTitle = (date: string) => {
    const at = `${date}T12:00:00Z`;
    const rel = formats.relativeDay(at);
    return rel === 'today'
      ? tc('time.today')
      : rel === 'yesterday'
        ? tc('time.yesterday')
        : formats.dayMonth(at);
  };
  const action = (row: MailRowData): 'reply' | 'calendar' | 'none' =>
    category === 'important'
      ? row.reply_state === 'awaiting_my_reply'
        ? 'reply'
        : 'none'
      : category === 'has_deadline'
        ? 'calendar'
        : 'none';

  return (
    <DetailScreen
      kicker={label}
      onLeadingPress={back}
      onRefresh={() => query.refetch()}
      updatedAt={query.dataUpdatedAt}
      testID="mailCategory.screen"
    >
      <View style={{ gap: 4 }}>
        <Text variant="h1" heading>
          {label}
        </Text>
        <Text variant="secondary" tone="secondary">
          {t('screen.categorySub', { count: total })}
        </Text>
      </View>
      {query.isPending ? (
        <IntelSkeleton />
      ) : query.isError && pages.length === 0 ? (
        <QueryFailure
          screen={label}
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
          testID="mailCategory"
        />
      ) : total === 0 && !query.hasNextPage ? (
        <EmptyState
          icon="mark_email_read"
          tone="success"
          title={t(`screen.empty.${category}`)}
          body={t('screen.emptyBody')}
          testID="mailCategory.empty"
        />
      ) : (
        <View style={{ gap: 12 }}>
          {pages
            .filter((page) => page.rows.length > 0)
            .map((page) => (
              <View key={page.date} style={{ gap: 12 }}>
                <SectionHeader title={dayTitle(page.date)} />
                {page.rows.map((row) => (
                  <MailCard
                    key={row.thread_id}
                    row={row}
                    action={action(row)}
                    correction={category === 'important' ? 'not_important' : 'show_more'}
                    onOpened={() => {
                      track('mail_card_open', { category });
                    }}
                  />
                ))}
              </View>
            ))}
          {query.hasNextPage ? (
            <Button
              label={tc('actions.loadMore')}
              variant="text"
              onPress={() => {
                void query.fetchNextPage();
              }}
              loading={query.isFetchingNextPage}
              testID="mailCategory.more"
            />
          ) : null}
          {query.isError ? (
            <Text variant="meta" tone="tertiaryStrong">
              {ts('offline.blockedReason')}
            </Text>
          ) : null}
        </View>
      )}
    </DetailScreen>
  );
}
