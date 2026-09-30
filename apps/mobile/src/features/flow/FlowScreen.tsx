/**
 * M-FLOW-01 · Akış: the attention feed over every source (M§13), not an inbox clone. RPC-05
 * `flow_feed` pages with the filters Tümü / Önemli / Mail / Takvim / Takip / Kişisel (applied
 * server-side), header counts from its `meta`, the Mail Zekâsı digest row (RPC-08), one card
 * template (source · badge · title · AI summary · one action) for the 9 card types plus the
 * follow-up and commitment variants, swipe right "Tamamlandı" / left "Ertele" · "Önemli değil"
 * with undo, a visible "···" menu mirroring every swipe verb, and pull-to-refresh that syncs the
 * healthy accounts. Free users see the Takip Pro gate; the server never produces commitment cards
 * for them. Rendering is a FlashList.
 */
import { qk } from '@da/api-client';
import { apiMutationOptions, callRoute, useApiClient } from '@da/api-client/react';
import {
  AttentionCard,
  EmptyState,
  ErrorCard,
  FeedSkeleton,
  FilterChipRow,
  GroupedList,
  HeaderPill,
  ListRow,
  MetaLine,
  ReconnectCard,
  RootHeader,
  SwipeableRow,
  SyncDelayedCard,
  SyncLine,
  useTheme,
  useToast,
  type A11yAction,
  type SyncPhase,
} from '@da/ui';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, useScrollToTop, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { hasCapability } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';
import { useInsightActions } from '../actions/insights';
import { ProGate } from '../actions/ProGate';
import { deadlineBlock, useProposals } from '../actions/proposals';
import { openMenu, openReminder, openSnooze, openSource } from '../actions/sheets';
import { OfflineNotice, QueryFailure, useOfflineGuard } from '../actions/ui';
import { latestMessageId, threadIdOfMessage } from '../mail/data';
import { cardModel, entityId, type CardModel } from './cards';
import {
  FLOW_FILTERS,
  flowFeedOptions,
  isFlowFilter,
  mailDigestOptions,
  syncAccounts,
  type FlowFilter,
  type FlowItemRow,
} from './data';

const LAST_FILTER_KEY = 'flow.lastFilter';
const SYNC_DELAY_MS = 15 * 60_000;

function storedFilter(): FlowFilter {
  if (!isEncryptedStorageOpen()) return 'all';
  const value = encryptedStorage().prefs.getString(LAST_FILTER_KEY);
  return isFlowFilter(value) ? value : 'all';
}

function storeFilter(filter: FlowFilter): void {
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(LAST_FILTER_KEY, filter);
}

type ActionName =
  | 'reply'
  | 'remind'
  | 'prepare'
  | 'calendar'
  | 'followup_draft'
  | 'open'
  | 'done'
  | 'snooze'
  | 'dismiss';

function analyticsAction(primary: CardModel['primary']): ActionName {
  switch (primary) {
    case 'reply':
      return 'reply';
    case 'calendar':
    case 'plan':
      return 'calendar';
    case 'prepare':
      return 'prepare';
    case 'remind':
      return 'remind';
    case 'followup_draft':
      return 'followup_draft';
    default:
      return 'open';
  }
}

export function FlowScreen() {
  const theme = useTheme();
  const t = useTranslations('flow');
  const tc = useTranslations('common');
  const ts = useTranslations('states');
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const client = useApiClient();
  const session = useSessionContext();
  const formats = useFormats();
  const blocked = useOfflineGuard();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<FlowFilter>(() =>
    isFlowFilter(params.filter) ? params.filter : storedFilter(),
  );
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle');
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenCards, setHiddenCards] = useState<readonly string[]>([]);
  const listRef = useRef(null);
  useScrollToTop(listRef);

  const followupsGated = filter === 'followup' && !session.isPro;
  const feed = useInfiniteQuery({ ...flowFeedOptions(filter), enabled: !followupsGated });
  const digest = useQuery({
    ...mailDigestOptions(formats.today()),
    enabled: filter === 'all' || filter === 'mail',
  });
  const insights = useInsightActions([qk.flow.all]);
  const proposals = useProposals();
  const followupDraft = useMutation(apiMutationOptions(client, 'POST /followups/:threadId/draft'));

  useEffect(() => {
    track('flow_view', { filter });
  }, [filter]);

  const selectFilter = (key: string) => {
    if (!isFlowFilter(key) || key === filter) return;
    setFilter(key);
    storeFilter(key);
    router.setParams({ filter: key });
    track('flow_filter_select', { filter: key });
  };

  const items = (feed.data?.pages ?? []).flatMap((page) => page.items);
  const meta = feed.data?.pages[0]?.meta;
  const isToday = (at: string) => formats.relativeDay(at) === 'today';

  const refresh = async () => {
    setRefreshing(true);
    setSyncPhase('syncing');
    try {
      if (!online) {
        track('flow_refresh', { result: 'offline' });
        toast.show({ message: ts('offline.stillOffline'), kind: 'offline' });
        return;
      }
      await syncAccounts(client, meta?.accounts ?? session.accounts);
      await Promise.all([feed.refetch(), digest.refetch()]);
      track('flow_refresh', { result: 'ok' });
      setSyncPhase('done');
    } catch {
      track('flow_refresh', { result: 'error' });
      toast.show({ message: ts('error.refreshFailed'), kind: 'error' });
    } finally {
      setRefreshing(false);
      setSyncPhase((phase) => (phase === 'syncing' ? 'idle' : phase));
    }
  };

  // ── card actions ───────────────────────────────────────────────────────────────────────

  const openMail = async (item: FlowItemRow, reply: boolean) => {
    const direct = entityId(item, 'email_message');
    const thread = entityId(item, 'email_thread');
    const id = direct ?? (thread === null ? null : await latestMessageId(thread).catch(() => null));
    if (id === null) {
      openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
      return;
    }
    router.push(reply ? `/mail/${id}/reply?mode=reply&origin=flow` : `/mail/${id}`);
  };

  const tap = (item: FlowItemRow, model: CardModel) => {
    track('flow_card_open', { card_type: item.card_type });
    switch (model.tap) {
      case 'mail':
        void openMail(item, false);
        return;
      case 'event': {
        const id = entityId(item, 'calendar_event') ?? entityId(item, 'device_calendar_event');
        if (id !== null) router.push(`/event/${id}?origin=flow` as Href);
        else openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
        return;
      }
      case 'prep': {
        const id = entityId(item, 'calendar_event') ?? entityId(item, 'device_calendar_event');
        if (id !== null) router.push(`/meeting/${id}/prep?origin=flow` as Href);
        return;
      }
      case 'followups':
        router.push(`/followups?focus=${item.id}` as Href);
        return;
      case 'commitment': {
        const id = entityId(item, 'commitment');
        if (id !== null) router.push(`/commitments/${id}` as Href);
        return;
      }
      case 'life': {
        const id = entityId(item, 'life_event');
        if (id !== null) router.push(`/life/${id}` as Href);
        else openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
        return;
      }
      case 'source': {
        const capture = entityId(item, 'capture');
        const path = capture === null ? null : `/capture/${capture}`;
        if (path !== null && isScreenAvailable(path)) router.push(path);
        else openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
        return;
      }
    }
  };

  const draftFollowUp = async (item: FlowItemRow) => {
    if (blocked('reply')) return;
    const message = entityId(item, 'email_message');
    const threadId =
      entityId(item, 'email_thread') ??
      (message === null ? null : await threadIdOfMessage(message).catch(() => null));
    if (threadId === null) {
      toast.show({ message: t('actions.failed'), kind: 'error' });
      return;
    }
    followupDraft.mutate(
      { input: { params: { threadId }, body: { tone: 'short' } } },
      {
        onSuccess: (draft) => {
          track('follow_up_draft_created', { tone: draft.tone, result: 'ok' });
          router.push(
            `/mail/${draft.email_message_id}/reply?mode=follow_up&draftId=${draft.id}&origin=flow` as Href,
          );
        },
        onError: () => {
          track('follow_up_draft_created', { tone: 'short', result: 'error' });
          toast.show({ message: t('actions.failed'), kind: 'error' });
        },
      },
    );
  };

  const planCommitment = async (item: FlowItemRow) => {
    if (blocked('approve')) return;
    const id = entityId(item, 'commitment');
    if (id === null) return;
    const from = now().getTime() + 5 * 60_000;
    const due = item.due_at === null ? Number.POSITIVE_INFINITY : Date.parse(item.due_at);
    const to = Math.min(due, from + 7 * 24 * 60 * 60_000);
    try {
      const proposal = await callRoute(client, 'POST /plan/proposals', {
        body: {
          item: { type: 'commitment', id },
          duration_minutes: 60,
          window: {
            from: new Date(from).toISOString(),
            to: new Date(Math.max(to, from + 3_600_000)).toISOString(),
          },
        },
      });
      router.push(`/plan/proposal/${proposal.approval.id}` as Href);
    } catch (error) {
      const code = (error as { code?: string }).code;
      toast.show({
        message:
          code === 'STATE_CONFLICT'
            ? t('proposal.noSlot')
            : code === 'ENTITLEMENT_REQUIRED'
              ? t('proposal.proRequired')
              : t('proposal.failed'),
        kind: code === 'STATE_CONFLICT' ? 'neutral' : 'error',
      });
    }
  };

  const primary = (item: FlowItemRow, model: CardModel) => {
    track('flow_card_action', {
      card_type: item.card_type,
      action: analyticsAction(model.primary),
    });
    switch (model.primary) {
      case 'reply':
        if (blocked('reply')) return;
        void openMail(item, true);
        return;
      case 'calendar': {
        if (item.due_at === null) return;
        const block = deadlineBlock(item.due_at, now().getTime());
        void proposals.proposeEvent({
          title: item.title,
          start: block.start,
          end: block.end,
          origin: 'insight',
          originRef: { type: 'insight', id: item.id },
          originRefId: item.id,
          ...(item.source.source_id === null
            ? {}
            : {
                source: {
                  source_type: item.source.source_type as never,
                  source_id: item.source.source_id,
                  source_provider: (item.source.provider ?? 'in_app') as never,
                  source_timestamp: item.source.source_timestamp ?? item.created_at,
                },
              }),
          invalidate: [qk.flow.all],
        });
        return;
      }
      case 'prepare':
        if (blocked('assistant')) return;
        tap(item, model);
        return;
      case 'remind':
        openReminder({
          title: item.title,
          origin: item.card_type === 'payment' ? 'life_event' : 'deadline',
          anchorAt: item.due_at,
        });
        return;
      case 'followup_draft':
        void draftFollowUp(item);
        return;
      case 'plan':
        void planCommitment(item);
        return;
      default:
        tap(item, model);
    }
  };

  const primaryLabel = (model: CardModel): string => {
    switch (model.primary) {
      case 'reply':
        return tc('actions.prepareReply');
      case 'calendar':
        return tc('actions.addToCalendar');
      case 'open':
        return tc('actions.open');
      case 'prepare':
        return tc('actions.prepare');
      case 'open_event':
        return t('card.openEvent');
      case 'remind':
        return tc('actions.remind');
      case 'followup_draft':
        return t('card.followUpDraft');
      case 'plan':
        return tc('actions.schedule');
      case 'review':
        return t('card.review');
      case 'check':
        return t('card.check');
    }
  };

  const complete = (item: FlowItemRow, via: 'swipe' | 'button' | 'a11y') => {
    if (via === 'swipe')
      track('flow_swipe', { direction: 'right', action: 'done', card_type: item.card_type });
    insights.setStatus({ id: item.id, to: 'done', via, message: tc('actions.markDone') });
  };
  const snooze = (item: FlowItemRow, via: 'swipe' | 'button' | 'a11y') => {
    if (via === 'swipe')
      track('flow_swipe', { direction: 'left', action: 'snooze', card_type: item.card_type });
    openSnooze({ target: 'insight', id: item.id, roots: [qk.flow.all], via });
  };
  const notImportant = (item: FlowItemRow, security: boolean, via: 'swipe' | 'button' | 'a11y') => {
    if (via === 'swipe') {
      track('flow_swipe', {
        direction: 'left',
        action: 'not_important',
        card_type: item.card_type,
      });
    }
    if (security) {
      insights.dismissOnly(item.id, t('card.dismissed'), via);
      return;
    }
    insights.sendFeedback({
      id: item.id,
      kind: 'not_important',
      message: tc('toast.learnedLower'),
    });
  };
  const more = (item: FlowItemRow, model: CardModel) => {
    openMenu({
      options: [
        {
          key: 'done',
          label: t('swipe.done'),
          icon: 'check_circle',
          onPress: () => {
            complete(item, 'button');
          },
        },
        {
          key: 'snooze',
          label: t('swipe.snooze'),
          icon: 'schedule',
          onPress: () => {
            snooze(item, 'button');
          },
        },
        {
          key: 'dismiss',
          label: t('swipe.notImportant'),
          icon: 'low_priority',
          onPress: () => {
            notImportant(item, model.security, 'button');
          },
        },
        ...(model.security
          ? []
          : [
              {
                key: 'show_more',
                label: t('card.showMore'),
                icon: 'priority_high' as const,
                onPress: () => {
                  insights.sendFeedback({
                    id: item.id,
                    kind: 'show_more',
                    keep: true,
                    message: tc('toast.learnedHigher'),
                  });
                },
              },
            ]),
        {
          key: 'why',
          label: t('card.why'),
          icon: 'info',
          onPress: () => {
            openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
          },
        },
      ],
    });
  };

  const renderCard = (item: FlowItemRow) => {
    const model = cardModel(item, session.isPro, isToday);
    const sourceName =
      model.source === null
        ? tc(`badges.${model.badge?.key ?? 'personal'}`)
        : tc(`providers.${model.source}`);
    const badgeLabel = model.badge === null ? undefined : tc(`badges.${model.badge.key}`);
    const time = isToday(model.at) ? formats.time(model.at) : formats.dayMonth(model.at);
    const verbs: A11yAction[] = [
      {
        key: 'primary',
        label: primaryLabel(model),
        onPress: () => {
          primary(item, model);
        },
      },
      {
        key: 'why',
        label: t('card.why'),
        onPress: () => {
          openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
        },
      },
    ];
    return (
      <SwipeableRow
        right={{
          key: 'complete',
          label: t('swipe.done'),
          icon: 'check_circle',
          onAction: () => {
            complete(item, 'swipe');
          },
        }}
        left={[
          {
            key: 'snooze',
            label: t('swipe.snooze'),
            icon: 'schedule',
            onAction: () => {
              snooze(item, 'swipe');
            },
          },
          {
            key: 'dismiss',
            label: t('swipe.notImportant'),
            icon: 'low_priority',
            onAction: () => {
              notImportant(item, model.security, 'swipe');
            },
          },
        ]}
        testID={`flow.row.${item.id}`}
      >
        {(swipeVerbs) => (
          <AttentionCard
            title={item.title}
            {...(item.body === null || item.body === ''
              ? { summaryUnavailable: t('card.noSummary') }
              : { summary: item.body })}
            sourceName={sourceName}
            sourceIcon={model.icon}
            tileTone={model.security ? 'critical' : 'neutral'}
            {...(badgeLabel === undefined || model.badge === null
              ? {}
              : { badge: { label: badgeLabel, category: model.badge.category } })}
            time={time}
            action={{
              key: 'primary',
              label: primaryLabel(model),
              onPress: () => {
                primary(item, model);
              },
              ...(model.primary === 'followup_draft' && followupDraft.isPending
                ? { loading: true }
                : {}),
            }}
            onPress={() => {
              tap(item, model);
            }}
            onMore={() => {
              more(item, model);
            }}
            moreLabel={tc('a11y.moreOptions')}
            a11yActions={[...swipeVerbs, ...verbs.slice(1)]}
            accessibilityLabel={[
              badgeLabel,
              sourceName,
              time,
              item.title,
              item.body ?? t('card.noSummary'),
            ]
              .filter((p): p is string => p !== undefined && p !== '')
              .join(', ')}
            testID={`flow.card.${item.card_type}`}
          />
        )}
      </SwipeableRow>
    );
  };

  // ── header ────────────────────────────────────────────────────────────────────────────

  const failingAccounts = (meta?.accounts ?? []).filter(
    (a) => a.status === 'needs_reauth' && !hiddenCards.includes(`reauth:${a.id}`),
  );
  const delayed = (meta?.accounts ?? []).some(
    (a) =>
      a.status === 'healthy' &&
      a.last_success_at !== null &&
      now().getTime() - Date.parse(a.last_success_at) > SYNC_DELAY_MS,
  );
  const pausedCount = session.accounts.filter((a) => !a.data_sources.mail_read).length;
  const hide = (key: string) => {
    setHiddenCards((keys) => [...keys, key]);
  };

  const header: ReactNode = (
    <View style={styles.header}>
      <RootHeader
        kicker={formats.weekdayDate(now())}
        title={t('title')}
        trailing={
          isScreenAvailable('/capture') ? (
            <HeaderPill
              label={tc('actions.add')}
              icon="add_a_photo"
              tint="brand"
              onPress={() => {
                router.push('/capture');
              }}
            />
          ) : undefined
        }
        {...(isScreenAvailable('/settings')
          ? {
              avatar: {
                name:
                  session.data?.profile.display_name ?? session.data?.profile.email ?? t('title'),
                accessibilityLabel: t('header.profile'),
                onPress: () => {
                  router.push('/settings');
                },
              },
            }
          : {})}
      />
      <SyncLine
        phase={syncPhase}
        doneLabel={ts('loading.refreshed', { time: formats.time(now()) })}
        onDoneHidden={() => {
          setSyncPhase('idle');
        }}
      />
      <FilterChipRow
        items={FLOW_FILTERS.map((key) => ({ key, label: t(`filters.${key}`) }))}
        selectedKey={filter}
        onSelect={selectFilter}
        semantics="tabs"
        accessibilityLabel={t('title')}
        testID="flow.filters"
      />
      <View style={[styles.stack, { paddingHorizontal: theme.layout.screenX }]}>
        {meta === undefined ? null : (
          <MetaLine
            parts={[
              t('meta.topics', { count: meta.total }),
              t('meta.important', { count: meta.important }),
              ...(meta.last_analysis_at === null
                ? []
                : [t('meta.lastAnalysis', { time: formats.time(meta.last_analysis_at) })]),
              ...(pausedCount > 0 ? [t('meta.paused', { count: pausedCount })] : []),
            ]}
            testID="flow.meta"
          />
        )}
        {online ? null : <OfflineNotice updatedAt={feed.dataUpdatedAt} onRefresh={refresh} />}
        {failingAccounts.map((account) =>
          isScreenAvailable(`/settings/accounts/${account.id}`) ? (
            <ReconnectCard
              key={account.id}
              title={ts('error.oauthExpired.title', {
                service:
                  account.provider === 'microsoft'
                    ? tc('providers.outlook')
                    : tc('providers.gmail'),
              })}
              body={ts('error.oauthExpired.bodyMail', {
                identityProvider:
                  account.provider === 'microsoft'
                    ? tc('providers.microsoft')
                    : tc('providers.google'),
              })}
              reconnectAction={{
                label: ts('error.oauthExpired.cta'),
                onPress: () => {
                  router.push(`/settings/accounts/${account.id}` as Href);
                },
              }}
              laterAction={{
                label: ts('error.oauthExpired.later'),
                onPress: () => {
                  hide(`reauth:${account.id}`);
                },
              }}
            />
          ) : (
            <ErrorCard
              key={account.id}
              icon="link_off"
              tone="critical"
              title={ts('error.oauthExpired.title', {
                service:
                  account.provider === 'microsoft'
                    ? tc('providers.outlook')
                    : tc('providers.gmail'),
              })}
              body={ts('error.oauthExpired.bodyMail', {
                identityProvider:
                  account.provider === 'microsoft'
                    ? tc('providers.microsoft')
                    : tc('providers.google'),
              })}
              secondaryAction={{
                label: ts('error.oauthExpired.later'),
                onPress: () => {
                  hide(`reauth:${account.id}`);
                },
              }}
              testID="flow.reauth"
            />
          ),
        )}
        {delayed &&
        !hiddenCards.includes('delayed') &&
        meta?.last_analysis_at !== null &&
        meta?.last_analysis_at !== undefined ? (
          <SyncDelayedCard
            title={ts('error.syncDelayed.title')}
            body={ts('error.syncDelayed.body', {
              time: formats.time(meta.last_analysis_at),
              minutes: Math.round((now().getTime() - Date.parse(meta.last_analysis_at)) / 60_000),
            })}
            primaryAction={{
              label: ts('error.syncDelayed.cta'),
              onPress: () => {
                void refresh();
              },
            }}
            secondaryAction={{
              label: ts('error.syncDelayed.dismiss'),
              onPress: () => {
                hide('delayed');
              },
            }}
            testID="flow.syncDelayed"
          />
        ) : null}
        {feed.isError && items.length > 0 ? (
          <ErrorCard
            icon="sync_problem"
            tone="neutral"
            title={ts('error.refreshFailed')}
            primaryAction={{
              label: tc('actions.retry'),
              onPress: () => {
                void feed.refetch();
              },
            }}
            announceOnMount={false}
          />
        ) : null}
        {(filter === 'all' || filter === 'mail') && digest.data !== undefined ? (
          <GroupedList>
            <ListRow
              title={t('digest.label', {
                total: digest.data.total,
                attention: digest.data.attention,
              })}
              subtitle={t('digest.kicker')}
              icon="mail"
              trailing={{ kind: 'chevron' }}
              onPress={() => {
                router.push('/mail');
              }}
              testID="flow.digest"
            />
          </GroupedList>
        ) : null}
      </View>
    </View>
  );

  // ── body ──────────────────────────────────────────────────────────────────────────────

  let empty: ReactNode = null;
  if (followupsGated) {
    const count = session.data?.counts.open_followups ?? 0;
    empty = (
      <ProGate
        feature="followups"
        kicker={t('gate.kicker')}
        title={count > 0 ? t('gate.titleCount', { count }) : t('gate.title')}
        body={t('gate.body')}
        surface="inline"
      />
    );
  } else if (feed.isPending) {
    empty = <FeedSkeleton accessibilityLabel={ts('loading.label')} testID="flow.loading" />;
  } else if (feed.isError && items.length === 0) {
    empty = (
      <QueryFailure
        screen={t('title')}
        error={feed.error}
        onRetry={() => {
          void feed.refetch();
        }}
        retrying={feed.isFetching}
        testID="flow"
      />
    );
  } else if (items.length === 0) {
    empty = <FlowEmpty filter={filter} analyzed={digest.data?.total ?? 0} />;
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.color.bg }]} testID="flow.screen">
      <FlashList
        ref={listRef}
        data={empty === null ? items : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={{ paddingHorizontal: theme.layout.screenX, paddingBottom: theme.layout.cardGap }}
          >
            {renderCard(item)}
          </View>
        )}
        ListHeaderComponent={
          <View>
            {header}
            {empty === null ? null : (
              <View style={{ paddingHorizontal: theme.layout.screenX, paddingTop: 16 }}>
                {empty}
              </View>
            )}
          </View>
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.3}
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
        contentContainerStyle={{ paddingBottom: 24 }}
        testID="flow.list"
      />
    </View>
  );
}

function FlowEmpty({
  filter,
  analyzed,
}: {
  readonly filter: FlowFilter;
  readonly analyzed: number;
}) {
  const t = useTranslations('flow.feed.empty');
  const ts = useTranslations('states.empty');
  const router = useRouter();
  const session = useSessionContext();
  const go = (path: string) => () => {
    router.push(path);
  };
  if (session.accounts.length === 0) {
    const route = '/settings/accounts';
    return (
      <EmptyState
        icon="mail"
        tone="primary"
        title={ts('noAccount.title')}
        body={ts('noAccount.body')}
        {...(isScreenAvailable(route)
          ? { action: { label: ts('noAccount.cta'), onPress: go(route) } }
          : {})}
        testID="flow.empty.noAccount"
      />
    );
  }
  switch (filter) {
    case 'all':
      return (
        <EmptyState
          icon="check_circle"
          tone="success"
          title={t('all.title')}
          body={t('all.body')}
          action={{ label: t('openMail'), onPress: go('/mail') }}
          testID="flow.empty.all"
        />
      );
    case 'important':
      return (
        <EmptyState
          icon="priority_high"
          tone="neutral"
          title={t('important.title')}
          body={t('important.body')}
          {...(isScreenAvailable('/settings/priority-rules')
            ? { action: { label: t('important.cta'), onPress: go('/settings/priority-rules') } }
            : {})}
          testID="flow.empty.important"
        />
      );
    case 'mail':
      return (
        <EmptyState
          icon="mark_email_read"
          tone="success"
          title={t('mail.title')}
          {...(analyzed > 0 ? { body: t('mail.body', { count: analyzed }) } : {})}
          action={{ label: t('openMail'), onPress: go('/mail') }}
          testID="flow.empty.mail"
        />
      );
    case 'calendar':
      return hasCapability(session.data, 'calendar_read') ? (
        <EmptyState
          icon="event_available"
          tone="primary"
          title={t('calendar.title')}
          body={t('calendar.body')}
          action={{ label: t('calendar.cta'), onPress: go('/plan') }}
          testID="flow.empty.calendar"
        />
      ) : (
        <EmptyState
          icon="calendar_today"
          tone="primary"
          title={t('calendarNone.title')}
          body={t('calendarNone.body')}
          {...(isScreenAvailable('/settings/accounts')
            ? { action: { label: t('calendarNone.cta'), onPress: go('/settings/accounts') } }
            : {})}
          testID="flow.empty.calendarNone"
        />
      );
    case 'followup':
      return (
        <EmptyState
          icon="mark_email_read"
          tone="success"
          title={ts('followups.title')}
          body={ts('followups.body')}
          action={{ label: t('followup.cta'), onPress: go('/commitments') }}
          testID="flow.empty.followup"
        />
      );
    case 'personal':
      return (
        <EmptyState
          icon="package_2"
          tone="neutral"
          title={t('personal.title')}
          body={t('personal.body')}
          testID="flow.empty.personal"
        />
      );
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: 12, paddingBottom: 12 },
  stack: { gap: 12 },
});
