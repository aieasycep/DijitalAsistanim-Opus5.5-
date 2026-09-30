/**
 * M-WAIT-01 · Senden Beklenenler (people waiting on the user, M§17 type 2) and M-FUP-01 · Senin
 * Cevap Beklediklerin (sent mails with no reply, M§17 type 1, Pro). Cards carry the fastest path
 * ("Yanıt Hazırla" / "Takip Mesajı Hazırla" → the reply modal, `email_send` approval downstream),
 * "Yarın Hatırlat" (reminder sheet with the confirm tap, C-28), "Kapat" and swipes with undo;
 * "Bu kişiyi takip etme" is RPC-21 `stop_tracking` (the server derives any learned preference).
 * Deadlines render only when grounded (`due_at`), expectations only when the insight has a body.
 */
import { qk } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import { waitBadge } from '@da/domain';
import {
  EmptyState,
  FeedSkeleton,
  FollowUpCard,
  HintRow,
  SectionHeader,
  SwipeableRow,
  Text,
  WaitingCard,
  useToast,
} from '@da/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { ageParts, daysBetween, useFormats, useSessionContext } from '../../lib/data/session';
import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { useInsightActions } from '../actions/insights';
import { ProGate } from '../actions/ProGate';
import { openMenu, openReminder, openSnooze, openSource } from '../actions/sheets';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import {
  followupsOptions,
  groupOf,
  sortWaiting,
  waitingOptions,
  type PersonItem,
  type UrgencyGroup,
} from './data';

function countBucket(n: number): '0' | '1' | '2-5' | '6-20' | '20+' {
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '20+';
}

const GROUP_TONE: Readonly<Record<UrgencyGroup, 'critical' | 'warning' | 'neutral'>> = {
  urgent: 'critical',
  today: 'warning',
  later: 'neutral',
};

function useAgeLabel() {
  const tc = useTranslations('common.time');
  return (since: string) => {
    const age = ageParts(since, now());
    return age.unit === 'minutes'
      ? tc('minutesShort', { count: age.count })
      : age.unit === 'hours'
        ? tc('hoursShort', { count: age.count })
        : tc('days', { count: age.count });
  };
}

/** M-WAIT-01 · Senden Beklenenler. */
export function WaitingScreen() {
  const t = useTranslations('waiting');
  const tc = useTranslations('common');
  const router = useRouter();
  const formats = useFormats();
  const back = useBack('/flow');
  const blocked = useOfflineGuard();
  const ageLabel = useAgeLabel();
  const query = useQuery(waitingOptions());
  const insights = useInsightActions([qk.waiting.all, qk.flow.all]);
  const items = sortWaiting(query.data ?? []);

  const size = query.data?.length;
  useEffect(() => {
    if (size !== undefined) track('waiting_view', { count_bucket: countBucket(size) });
  }, [size]);

  const reply = (item: PersonItem) => {
    track('waiting_action', { action: 'reply' });
    if (blocked('reply') || item.messageId === null) return;
    router.push(`/mail/${item.messageId}/reply?mode=reply&origin=waiting` as Href);
  };
  const openMail = (item: PersonItem) => {
    track('waiting_action', { action: 'open' });
    if (item.messageId !== null) router.push(`/mail/${item.messageId}` as Href);
  };
  const done = (item: PersonItem, via: 'swipe' | 'button' | 'a11y') => {
    track('waiting_action', { action: 'done' });
    insights.setStatus({ id: item.id, to: 'done', via, message: t('screen.done') });
  };

  const card = (item: PersonItem) => {
    const group = groupOf(item.urgency);
    const due =
      item.dueAt === null
        ? undefined
        : {
            label: t('screen.dueBy', {
              when:
                formats.relativeDay(item.dueAt) === 'today'
                  ? `${tc('time.today')} ${formats.time(item.dueAt)}`
                  : `${formats.dayMonth(item.dueAt)} ${formats.time(item.dueAt)}`,
            }),
            tone: GROUP_TONE[group],
          };
    return (
      <SwipeableRow
        key={item.id}
        right={{
          key: 'complete',
          label: tc('actions.markDone'),
          icon: 'check_circle',
          onAction: () => {
            done(item, 'swipe');
          },
        }}
        left={[
          {
            key: 'snooze',
            label: tc('actions.snooze'),
            icon: 'schedule',
            onAction: () => {
              track('waiting_action', { action: 'snooze' });
              openSnooze({
                target: 'insight',
                id: item.id,
                roots: [qk.waiting.all, qk.flow.all],
                via: 'swipe',
              });
            },
          },
          {
            key: 'dismiss',
            label: t('screen.notImportant'),
            icon: 'low_priority',
            onAction: () => {
              track('waiting_action', { action: 'dismiss' });
              insights.sendFeedback({
                id: item.id,
                kind: 'not_important',
                message: tc('toast.learnedLower'),
              });
            },
          },
        ]}
        testID={`waiting.row.${item.id}`}
      >
        {(verbs) => (
          <WaitingCard
            personName={item.person}
            personId={item.personEmail ?? item.id}
            waitMeta={ageLabel(item.since)}
            topic={item.topic ?? item.title}
            {...(item.body === null || item.body === '' ? {} : { expectation: item.body })}
            {...(due === undefined ? {} : { deadline: due })}
            action={{
              label: t('actions.prepareReply'),
              onPress: () => {
                reply(item);
              },
            }}
            onPress={() => {
              openMail(item);
            }}
            onMore={() => {
              openMenu({
                options: [
                  {
                    key: 'open',
                    label: t('actions.openMail'),
                    icon: 'mail',
                    onPress: () => {
                      openMail(item);
                    },
                  },
                  {
                    key: 'remind',
                    label: t('actions.remind'),
                    icon: 'notifications',
                    onPress: () => {
                      track('waiting_action', { action: 'remind' });
                      openReminder({
                        title: item.topic ?? item.title,
                        origin: 'email_detail',
                        anchorAt: item.dueAt,
                        ...(item.messageId === null
                          ? {}
                          : { subject: { type: 'email_message', id: item.messageId } }),
                      });
                    },
                  },
                  {
                    key: 'noReply',
                    label: t('screen.noReplyNeeded'),
                    icon: 'check_circle',
                    onPress: () => {
                      done(item, 'button');
                    },
                  },
                  {
                    key: 'why',
                    label: tc('actions.viewSource'),
                    icon: 'info',
                    onPress: () => {
                      openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
                    },
                  },
                ],
              });
            }}
            moreLabel={tc('a11y.moreOptions')}
            a11yActions={verbs}
            testID={`waiting.card.${item.id}`}
          />
        )}
      </SwipeableRow>
    );
  };

  const groups: readonly UrgencyGroup[] = ['urgent', 'today', 'later'];
  return (
    <DetailScreen
      onLeadingPress={back}
      onRefresh={() => query.refetch()}
      updatedAt={query.dataUpdatedAt}
      testID="waiting.screen"
    >
      <View style={{ gap: 4 }}>
        <Text variant="h1" heading>
          {t('title')}
        </Text>
        {items.length > 0 ? (
          <Text variant="secondary" tone="secondary">
            {t('screen.sub', { count: items.length })}
          </Text>
        ) : null}
      </View>
      {query.isPending ? (
        <FeedSkeleton accessibilityLabel={tc('a11y.loading')} testID="waiting.loading" />
      ) : query.isError && query.data === undefined ? (
        <QueryFailure
          screen={t('title')}
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
          testID="waiting"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="mark_email_read"
          tone="success"
          title={t('screen.emptyTitle')}
          body={t('screen.emptyBody')}
          action={{
            label: t('screen.openMail'),
            onPress: () => {
              router.push('/mail');
            },
          }}
          testID="waiting.empty"
        />
      ) : (
        groups.map((group) => {
          const inGroup = items.filter((i) => groupOf(i.urgency) === group);
          if (inGroup.length === 0) return null;
          return (
            <View key={group} style={{ gap: 12 }} testID={`waiting.group.${group}`}>
              <SectionHeader
                title={t(`screen.groups.${group}`)}
                variant="dot"
                tone={GROUP_TONE[group]}
                count={String(inGroup.length)}
              />
              {inGroup.map(card)}
            </View>
          );
        })
      )}
    </DetailScreen>
  );
}

/** M-FUP-01 · Senin Cevap Beklediklerin (Pro). */
export function FollowupsScreen() {
  const t = useTranslations('followups');
  const tc = useTranslations('common');
  const ts = useTranslations('states.empty');
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const formats = useFormats();
  const session = useSessionContext();
  const back = useBack('/flow');
  const blocked = useOfflineGuard();
  const params = useLocalSearchParams<{ focus?: string }>();
  const query = useQuery(followupsOptions(session.isPro));
  const insights = useInsightActions([qk.followups.all, qk.flow.all]);
  const draft = useMutation(apiMutationOptions(client, 'POST /followups/:threadId/draft'));
  const items = [...(query.data ?? [])].sort((a, b) => {
    if (a.id === params.focus) return -1;
    if (b.id === params.focus) return 1;
    return Date.parse(a.since) - Date.parse(b.since);
  });

  useEffect(() => {
    if (session.isPro) track('followup_view');
  }, [session.isPro]);

  if (!session.isPro) {
    const count = session.data?.counts.open_followups ?? 0;
    return (
      <DetailScreen onLeadingPress={back} testID="followups.screen">
        <ProGate
          feature="followups"
          kicker={t('screen.gateKicker')}
          title={count > 0 ? t('screen.gateCount', { count }) : t('screen.gateTitle')}
          body={t('screen.gateBody')}
          surface="screen"
          onDismissed={back}
        />
      </DetailScreen>
    );
  }

  const startDraft = (item: PersonItem) => {
    track('follow_up_actioned', { action: 'draft' });
    if (blocked('reply') || item.threadId === null) return;
    draft.mutate(
      { input: { params: { threadId: item.threadId }, body: { tone: 'short' } } },
      {
        onSuccess: (next) => {
          track('follow_up_draft_created', { tone: next.tone, result: 'ok' });
          router.push(
            `/mail/${next.email_message_id}/reply?mode=follow_up&draftId=${next.id}&origin=followups` as Href,
          );
        },
        onError: () => {
          track('follow_up_draft_created', { tone: 'short', result: 'error' });
          toast.show({ message: t('screen.draftFailed'), kind: 'error' });
        },
      },
    );
  };

  const oldest = items.reduce(
    (max, i) => Math.max(max, daysBetween(i.since, now(), formats.timeZone)),
    0,
  );

  return (
    <DetailScreen
      onLeadingPress={back}
      onRefresh={() => queryClient.invalidateQueries({ queryKey: qk.followups.all })}
      updatedAt={query.dataUpdatedAt}
      testID="followups.screen"
    >
      <View style={{ gap: 4 }}>
        <Text variant="h1" heading>
          {t('awaitingThemTitle')}
        </Text>
        {items.length > 0 ? (
          <Text variant="secondary" tone="secondary">
            {t('screen.sub', { count: items.length, days: oldest })}
          </Text>
        ) : null}
      </View>
      {query.isPending ? (
        <FeedSkeleton accessibilityLabel={tc('a11y.loading')} testID="followups.loading" />
      ) : query.isError && query.data === undefined ? (
        <QueryFailure
          screen={t('awaitingThemTitle')}
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
          testID="followups"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="mark_email_read"
          tone="success"
          title={ts('followups.title')}
          body={ts('followups.body')}
          action={{
            label: t('screen.seeCommitments'),
            onPress: () => {
              router.push('/commitments');
            },
          }}
          testID="followups.empty"
        />
      ) : (
        <View style={{ gap: 12 }}>
          {items.map((item) => {
            const days = daysBetween(item.since, now(), formats.timeZone);
            const badge = waitBadge(days);
            return (
              <SwipeableRow
                key={item.id}
                right={{
                  key: 'close',
                  label: t('actions.close'),
                  icon: 'check_circle',
                  onAction: () => {
                    track('follow_up_actioned', { action: 'close' });
                    insights.setStatus({
                      id: item.id,
                      to: 'done',
                      via: 'swipe',
                      message: t('screen.closed'),
                    });
                  },
                }}
                left={[
                  {
                    key: 'snooze',
                    label: tc('actions.snooze'),
                    icon: 'schedule',
                    onAction: () => {
                      track('follow_up_actioned', { action: 'snooze' });
                      openSnooze({
                        target: 'insight',
                        id: item.id,
                        roots: [qk.followups.all, qk.flow.all],
                        via: 'swipe',
                      });
                    },
                  },
                  {
                    key: 'dismiss',
                    label: t('screen.notImportant'),
                    icon: 'low_priority',
                    onAction: () => {
                      track('follow_up_actioned', { action: 'dismiss' });
                      insights.sendFeedback({
                        id: item.id,
                        kind: 'not_important',
                        message: tc('toast.learnedLower'),
                      });
                    },
                  },
                ]}
                testID={`followups.row.${item.id}`}
              >
                {(verbs) => (
                  <FollowUpCard
                    personName={item.person}
                    personId={item.personEmail ?? item.id}
                    topic={item.topic ?? item.title}
                    waitLabel={t('screen.days', { count: days })}
                    waitTone={
                      badge === 'coral' ? 'critical' : badge === 'amber' ? 'warning' : 'neutral'
                    }
                    status={item.body ?? t('noReply')}
                    source={{
                      icon: 'mail',
                      parts: [
                        t('screen.sentAt', {
                          when: `${formats.dayMonth(item.since)} ${formats.time(item.since)}`,
                        }),
                        item.provider === 'microsoft'
                          ? tc('providers.outlook')
                          : tc('providers.gmail'),
                      ],
                      onPress: () => {
                        openSource({ targetType: 'insight', targetId: item.id, origin: 'flow' });
                      },
                      accessibilityHint: tc('actions.viewSource'),
                    }}
                    draftAction={{
                      label: t('screen.draft'),
                      onPress: () => {
                        startDraft(item);
                      },
                      loading:
                        draft.isPending && draft.variables.input.params.threadId === item.threadId,
                    }}
                    remindAction={{
                      label: t('screen.remindTomorrow'),
                      onPress: () => {
                        track('follow_up_actioned', { action: 'remind_tomorrow' });
                        openReminder({
                          title: item.topic ?? item.title,
                          origin: 'followup',
                          preset: 'tomorrow_morning',
                          ...(item.messageId === null
                            ? {}
                            : { subject: { type: 'email_message', id: item.messageId } }),
                        });
                      },
                    }}
                    closeAction={{
                      label: t('actions.close'),
                      onPress: () => {
                        track('follow_up_actioned', { action: 'close' });
                        insights.setStatus({
                          id: item.id,
                          to: 'done',
                          via: 'button',
                          message: t('screen.closed'),
                        });
                      },
                    }}
                    onPress={() => {
                      if (item.messageId !== null) router.push(`/mail/${item.messageId}` as Href);
                    }}
                    onMore={() => {
                      openMenu({
                        options: [
                          {
                            key: 'stop',
                            label: t('screen.stopTracking'),
                            icon: 'person_remove',
                            onPress: () => {
                              track('follow_up_actioned', { action: 'stop_tracking' });
                              insights.sendFeedback({
                                id: item.id,
                                kind: 'stop_tracking',
                                message: t('screen.stopped', { name: item.person }),
                              });
                            },
                          },
                          {
                            key: 'why',
                            label: tc('actions.viewSource'),
                            icon: 'info',
                            onPress: () => {
                              openSource({
                                targetType: 'insight',
                                targetId: item.id,
                                origin: 'flow',
                              });
                            },
                          },
                        ],
                      });
                    }}
                    moreLabel={tc('a11y.moreOptions')}
                    a11yActions={verbs}
                    testID={`followups.card.${item.id}`}
                  />
                )}
              </SwipeableRow>
            );
          })}
          <HintRow text={t('screen.hint')} />
        </View>
      )}
    </DetailScreen>
  );
}
