/**
 * M-COMMIT-01 · Taahhütlerin and M-COMMIT-02 · Taahhüt detayı (Pro, M§18). "Tamamlandı" and
 * "Ertele" are RPC-06 `set_commitment_status` with undo; "Kaynağı Gör" opens the exact source;
 * ambiguous detections are `commitment_create` approvals confirmed in place ("Evet, takip et" =
 * approve with `approved_via:'in_place'`, "Hayır" = reject `user_reject`). "Bu bir söz değil"
 * cancels and records the correction (RPC-17). Ungrounded due dates read "Kaynakta
 * kesinleşmiyor.".
 */
import { isApiError, qk } from '@da/api-client';
import { apiMutationOptions, callRoute, useApiClient } from '@da/api-client/react';
import type { CommitmentDirection } from '@da/domain';
import {
  Accordion,
  BottomSheet,
  Button,
  CommitmentCard,
  EmptyState,
  FeedSkeleton,
  GroupedList,
  IconButton,
  KeyValueGrid,
  ListRow,
  SectionHeader,
  SegmentedControl,
  SourceLine,
  StatusPill,
  Text,
  TextField,
  useToast,
  type StatusTone,
} from '@da/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { callRpc } from '../../lib/data/rpc';
import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useCommitmentActions } from '../actions/insights';
import { ProGate } from '../actions/ProGate';
import { openMenu, openSnooze, openSource } from '../actions/sheets';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import { threadIdOfMessage } from '../mail/data';
import {
  commitmentOptions,
  commitmentsOptions,
  displayStatus,
  proposalsOptions,
  sourceRoute,
  type CommitmentItem,
  type CommitmentProposal,
  type DisplayStatus,
} from './data';

const TONE: Readonly<Record<DisplayStatus, StatusTone>> = {
  overdue: 'critical',
  today: 'warning',
  open: 'neutral',
  snoozed: 'neutral',
  done: 'success',
  cancelled: 'neutral',
};

function useCommitmentText() {
  const t = useTranslations('commitments');
  const tc = useTranslations('common');
  const formats = useFormats();
  const due = (item: Pick<CommitmentItem, 'dueAt' | 'dueDateOnly'>): string => {
    if (item.dueAt === null) return tc('provenance.notConfirmed');
    const rel = formats.relativeDay(item.dueAt);
    const day =
      rel === 'today'
        ? tc('time.today')
        : rel === 'tomorrow'
          ? tc('time.tomorrow')
          : formats.dayMonth(item.dueAt);
    return item.dueDateOnly ? day : `${day} ${formats.time(item.dueAt)}`;
  };
  const source = (item: Pick<CommitmentItem, 'sourceType' | 'sourceTimestamp'>): string => {
    const kind =
      item.sourceType === 'email_message' || item.sourceType === 'email_thread'
        ? t('screen.source.mail')
        : item.sourceType === 'meeting_note' || item.sourceType === 'post_meeting_note'
          ? t('screen.source.meeting')
          : t('screen.source.document');
    return `${kind} · ${formats.dayMonth(item.sourceTimestamp)}`;
  };
  const status = (s: DisplayStatus): string => t(`screen.status.${s}`);
  return { due, source, status };
}

function useOpenCommitmentSource() {
  const router = useRouter();
  return (item: Pick<CommitmentItem, 'sourceType' | 'sourceId' | 'id'>) => {
    track('commitment_action', { action: 'source' });
    const route = sourceRoute(item);
    if (route !== null && isScreenAvailable(route)) router.push(route);
    else openSource({ targetType: 'commitment', targetId: item.id, origin: 'commitment' });
  };
}

function ProposalCard({ proposal }: { readonly proposal: CommitmentProposal }) {
  const t = useTranslations('commitments');
  const tc = useTranslations('common');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const blocked = useOfflineGuard();
  const text = useCommitmentText();
  const approve = useMutation(apiMutationOptions(client, 'POST /approvals/:id/approve'));
  const reject = useMutation(apiMutationOptions(client, 'POST /approvals/:id/reject'));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.commitments.all });
  };
  return (
    <View
      accessibilityHint={t('screen.proposalA11y')}
      testID={`commitments.proposal.${proposal.id}`}
    >
      <CommitmentCard
        status={{ label: t('screen.pending'), tone: 'warning' }}
        quote={proposal.quote ?? proposal.text}
        details={[
          { key: 'what', label: t('fields.commitment'), value: proposal.text },
          ...(proposal.counterparty === null
            ? []
            : [{ key: 'who', label: t('fields.to'), value: proposal.counterparty }]),
          {
            key: 'due',
            label: t('fields.due'),
            value: text.due({ dueAt: proposal.dueAt, dueDateOnly: false }),
          },
        ]}
        sourceAction={{
          label: tc('actions.viewSource'),
          onPress: () => {
            openSource({
              targetType: 'approval_action',
              targetId: proposal.id,
              origin: 'commitment',
            });
          },
        }}
        confirmation={{
          kicker: t('screen.isPromise'),
          confirm: {
            label: t('screen.confirm'),
            loading: approve.isPending,
            onPress: () => {
              if (blocked('approve')) return;
              approve.mutate(
                {
                  input: {
                    params: { id: proposal.id },
                    body: {
                      idempotency_key: proposal.idempotencyKey,
                      payload_version: proposal.payloadVersion,
                      approved_via: 'in_place',
                    },
                  },
                  idempotencyKey: proposal.idempotencyKey,
                },
                {
                  onSuccess: () => {
                    track('commitment_confirm', { decision: 'confirmed' });
                    refresh();
                  },
                  onError: () => {
                    toast.show({ message: t('screen.actionFailed'), kind: 'error' });
                  },
                },
              );
            },
          },
          reject: {
            label: t('screen.reject'),
            loading: reject.isPending,
            onPress: () => {
              if (blocked('reject')) return;
              reject.mutate(
                {
                  input: {
                    params: { id: proposal.id },
                    body: { reason: 'user_reject', learn: true },
                  },
                },
                {
                  onSuccess: () => {
                    track('commitment_confirm', { decision: 'rejected' });
                    refresh();
                  },
                  onError: () => {
                    toast.show({ message: t('screen.actionFailed'), kind: 'error' });
                  },
                },
              );
            },
          },
        }}
      />
    </View>
  );
}

function ItemCard({
  item,
  direction,
}: {
  readonly item: CommitmentItem;
  readonly direction: CommitmentDirection;
}) {
  const t = useTranslations('commitments');
  const tc = useTranslations('common');
  const router = useRouter();
  const formats = useFormats();
  const text = useCommitmentText();
  const openItemSource = useOpenCommitmentSource();
  const actions = useCommitmentActions([qk.commitments.all, qk.flow.all]);
  const client = useApiClient();
  const toast = useToast();
  const blocked = useOfflineGuard();
  const status = displayStatus(item, formats.timeZone);
  const done = status === 'done';
  const followUp =
    direction === 'they_owe' && item.sourceType === 'email_message'
      ? async () => {
          track('commitment_action', { action: 'followup_draft' });
          if (blocked('reply')) return;
          try {
            const threadId = await threadIdOfMessage(item.sourceId);
            if (threadId === null) throw new Error('thread_missing');
            const draft = await callRoute(client, 'POST /followups/:threadId/draft', {
              params: { threadId },
              body: { tone: 'short' },
            });
            router.push(
              `/mail/${draft.email_message_id}/reply?mode=follow_up&draftId=${draft.id}&origin=commitments` as Href,
            );
          } catch {
            toast.show({ message: t('screen.actionFailed'), kind: 'error' });
          }
        }
      : null;
  return (
    <CommitmentCard
      status={{ label: text.status(status), tone: TONE[status] }}
      {...(item.dueAt === null ? {} : { date: text.due(item) })}
      quote={item.quote ?? item.text}
      details={[
        { key: 'what', label: t('fields.commitment'), value: item.text },
        ...(item.counterparty === null
          ? []
          : [
              {
                key: 'who',
                label: direction === 'user_owes' ? t('fields.to') : t('fields.from'),
                value: item.counterparty,
              },
            ]),
        { key: 'source', label: t('fields.source'), value: text.source(item) },
        ...(item.confidence < 0.8
          ? [{ key: 'confidence', label: t('fields.confidence'), value: tc('provenance.notSure') }]
          : []),
      ]}
      {...(done
        ? { done: true }
        : {
            completeAction: {
              label: t('actions.done'),
              onPress: () => {
                track('commitment_action', { action: 'done' });
                actions.change({
                  id: item.id,
                  status: 'done',
                  message: tc('actions.markDone'),
                  remove: false,
                });
              },
            },
            snoozeAction:
              followUp === null
                ? {
                    label: t('actions.snooze'),
                    onPress: () => {
                      track('commitment_action', { action: 'snooze' });
                      openSnooze({
                        target: 'commitment',
                        id: item.id,
                        roots: [qk.commitments.all, qk.flow.all],
                      });
                    },
                  }
                : {
                    label: t('screen.followUpDraft'),
                    onPress: () => {
                      void followUp();
                    },
                  },
          })}
      sourceAction={{
        label: t('actions.viewSource'),
        onPress: () => {
          openItemSource(item);
        },
      }}
      a11yActions={[
        {
          key: 'open',
          label: tc('actions.details'),
          onPress: () => {
            router.push(`/commitments/${item.id}` as Href);
          },
        },
      ]}
      testID={`commitments.card.${item.id}`}
    />
  );
}

/** M-COMMIT-01. */
export function CommitmentsScreen() {
  const t = useTranslations('commitments');
  const tc = useTranslations('common');
  const formats = useFormats();
  const session = useSessionContext();
  const back = useBack('/flow');
  const params = useLocalSearchParams<{ direction?: string }>();
  const [direction, setDirection] = useState<CommitmentDirection>(
    params.direction === 'they_owe' ? 'they_owe' : 'user_owes',
  );
  const [doneOpen, setDoneOpen] = useState(false);
  const lists = useQuery(commitmentsOptions(direction, session.isPro));
  const proposals = useQuery(proposalsOptions(session.isPro));

  useEffect(() => {
    if (session.isPro) track('commitment_view', { direction });
  }, [direction, session.isPro]);

  if (!session.isPro) {
    return (
      <DetailScreen onLeadingPress={back} testID="commitments.screen">
        <ProGate
          feature="commitments"
          kicker={t('screen.gateKicker')}
          title={t('screen.gateTitle')}
          body={t('screen.gateBody')}
          surface="screen"
          onDismissed={back}
        />
      </DetailScreen>
    );
  }

  const active = lists.data?.active ?? [];
  const groups: readonly DisplayStatus[] = ['overdue', 'today', 'open', 'snoozed'];
  const statusOf = (item: CommitmentItem) => displayStatus(item, formats.timeZone);
  const open = active.filter((i) => statusOf(i) !== 'snoozed').length;
  const overdue = active.filter((i) => statusOf(i) === 'overdue').length;
  const mine = (proposals.data ?? []).filter((p) => p.direction === direction);

  return (
    <DetailScreen
      onLeadingPress={back}
      onRefresh={() => Promise.all([lists.refetch(), proposals.refetch()])}
      updatedAt={lists.dataUpdatedAt}
      testID="commitments.screen"
    >
      <View style={{ gap: 4 }}>
        <Text variant="h1" heading>
          {t('screen.title')}
        </Text>
        {lists.data === undefined ? null : (
          <Text variant="secondary" tone="secondary">
            {direction === 'user_owes'
              ? t('screen.subMine', { open, overdue })
              : t('screen.subTheirs', { count: open })}
          </Text>
        )}
      </View>
      <SegmentedControl
        options={[
          { key: 'user_owes', label: t('screen.mine') },
          { key: 'they_owe', label: t('screen.theirs') },
        ]}
        selectedKey={direction}
        onChange={(key) => {
          setDirection(key === 'they_owe' ? 'they_owe' : 'user_owes');
        }}
        semantics="tabs"
        testID="commitments.direction"
      />
      {mine.length === 0 ? null : (
        <View style={{ gap: 12 }}>
          <SectionHeader title={t('screen.awaitingConfirmation')} count={String(mine.length)} />
          {mine.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </View>
      )}
      {lists.isPending ? (
        <FeedSkeleton accessibilityLabel={tc('a11y.loading')} testID="commitments.loading" />
      ) : lists.isError && lists.data === undefined ? (
        <QueryFailure
          screen={t('screen.title')}
          error={lists.error}
          onRetry={() => {
            void lists.refetch();
          }}
          testID="commitments"
        />
      ) : active.length === 0 && mine.length === 0 ? (
        <EmptyState
          icon="handshake"
          tone="primary"
          title={direction === 'user_owes' ? t('screen.emptyMine') : t('screen.emptyTheirs')}
          {...(direction === 'user_owes' ? { body: t('screen.emptyMineBody') } : {})}
          testID="commitments.empty"
        />
      ) : (
        groups.map((group) => {
          const items = active.filter((i) => statusOf(i) === group);
          if (items.length === 0) return null;
          return (
            <View key={group} style={{ gap: 12 }} testID={`commitments.group.${group}`}>
              <SectionHeader title={t(`screen.status.${group}`)} count={String(items.length)} />
              {items.map((item) => (
                <ItemCard key={item.id} item={item} direction={direction} />
              ))}
            </View>
          );
        })
      )}
      {(lists.data?.done.length ?? 0) === 0 ? null : (
        <Accordion
          title={t('screen.doneSection')}
          icon="check_circle"
          expanded={doneOpen}
          onToggle={() => {
            setDoneOpen((v) => !v);
          }}
          testID="commitments.done"
        >
          <View style={{ gap: 12 }}>
            {(lists.data?.done ?? []).map((item) => (
              <ItemCard key={item.id} item={item} direction={direction} />
            ))}
          </View>
        </Accordion>
      )}
    </DetailScreen>
  );
}

function EditSheet({
  item,
  visible,
  onDismiss,
}: {
  readonly item: CommitmentItem;
  readonly visible: boolean;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations('commitments');
  const tc = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState(item.text);
  const [saving, setSaving] = useState(false);
  const save = async (field: 'text' | 'due_at', value: string | null) => {
    setSaving(true);
    try {
      await callRpc('submit_ai_correction', {
        p_target_type: 'commitment',
        p_target_id: item.id,
        p_kind: field === 'text' ? 'other' : 'date',
        p_field: field,
        p_corrected: value,
      });
      track('commitment_edit', { fields_changed_count: 1 });
      track('ai_correction', {
        target: 'commitment',
        kind: field === 'text' ? 'inaccurate' : 'wrong_date',
      });
      toast.show({ message: t('screen.updated'), kind: 'success' });
      await queryClient.invalidateQueries({ queryKey: qk.commitments.all });
      onDismiss();
    } catch {
      toast.show({ message: tc('toast.saveFailed'), kind: 'error' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('screen.editTitle')}
      dismissible={!saving}
      footer={
        <View style={{ gap: 8 }}>
          <Button
            label={tc('actions.save')}
            onPress={() => {
              void save('text', text.trim());
            }}
            disabled={text.trim() === '' || text.trim() === item.text}
            loading={saving}
            fullWidth
            testID="commitment.edit.save"
          />
          {item.dueAt === null ? null : (
            <Button
              label={t('screen.removeDue')}
              variant="text"
              onPress={() => {
                void save('due_at', null);
              }}
              fullWidth
            />
          )}
        </View>
      }
      testID="commitment.edit"
    >
      <TextField
        label={t('fields.commitment')}
        value={text}
        onChangeText={setText}
        maxLength={120}
        {...(text.trim() === '' ? { error: t('screen.textRequired') } : {})}
        testID="commitment.edit.text"
      />
    </BottomSheet>
  );
}

/** M-COMMIT-02. */
export function CommitmentDetailScreen() {
  const t = useTranslations('commitments');
  const tc = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const formats = useFormats();
  const session = useSessionContext();
  const back = useBack('/commitments');
  const blocked = useOfflineGuard();
  const text = useCommitmentText();
  const openItemSource = useOpenCommitmentSource();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery(commitmentOptions(id, session.isPro));
  const actions = useCommitmentActions([qk.commitments.all, qk.flow.all]);
  const [editing, setEditing] = useState(false);
  const cancelReminder = useMutation(apiMutationOptions(client, 'POST /reminders/:id/cancel'));
  const item = query.data?.item;

  const shownStatus = item === undefined ? null : item.status;
  const shownDirection = item?.direction;
  useEffect(() => {
    if (shownStatus !== null && shownDirection !== undefined) {
      track('commitment_detail_view', { direction: shownDirection, status: shownStatus });
    }
  }, [shownStatus, shownDirection]);

  if (!session.isPro) {
    return (
      <DetailScreen onLeadingPress={back} testID="commitment.screen">
        <ProGate
          feature="commitments"
          kicker={t('screen.gateKicker')}
          title={t('screen.gateTitle')}
          body={t('screen.gateBody')}
          surface="screen"
          onDismissed={back}
        />
      </DetailScreen>
    );
  }

  if (item === undefined) {
    return (
      <DetailScreen kicker={t('screen.kicker')} onLeadingPress={back} testID="commitment.screen">
        {query.isError ? (
          <QueryFailure
            screen={t('screen.title')}
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
            notFound={{ title: t('screen.gone'), backLabel: t('screen.backToList'), onBack: back }}
            testID="commitment"
          />
        ) : (
          <FeedSkeleton accessibilityLabel={tc('a11y.loading')} testID="commitment.loading" />
        )}
      </DetailScreen>
    );
  }

  const status = displayStatus(item, formats.timeZone);
  const recentlyDone =
    item.status === 'done' &&
    item.completedAt !== null &&
    now().getTime() - Date.parse(item.completedAt) < 30 * 86_400_000;
  const plan = async () => {
    if (blocked('approve')) return;
    const from = now().getTime() + 5 * 60_000;
    const due = item.dueAt === null ? from + 7 * 86_400_000 : Date.parse(item.dueAt);
    try {
      const proposal = await callRoute(client, 'POST /plan/proposals', {
        body: {
          item: { type: 'commitment', id: item.id },
          duration_minutes: 60,
          window: {
            from: new Date(from).toISOString(),
            to: new Date(
              Math.max(Math.min(due, from + 14 * 86_400_000), from + 3_600_000),
            ).toISOString(),
          },
        },
      });
      router.push(`/plan/proposal/${proposal.approval.id}` as Href);
    } catch (error) {
      toast.show({
        message:
          isApiError(error) && error.code === 'STATE_CONFLICT'
            ? t('screen.noSlot')
            : t('screen.actionFailed'),
        kind: 'error',
      });
    }
  };
  const notACommitment = async () => {
    try {
      await callRpc('set_commitment_status', { p_commitment_id: item.id, p_status: 'cancelled' });
      await callRpc('submit_ai_correction', {
        p_target_type: 'commitment',
        p_target_id: item.id,
        p_kind: 'not_commitment',
        p_field: 'status',
        p_corrected: 'cancelled',
      });
      track('ai_correction', { target: 'commitment', kind: 'not_a_commitment' });
      await queryClient.invalidateQueries({ queryKey: qk.commitments.all });
      back();
    } catch {
      toast.show({ message: t('screen.actionFailed'), kind: 'error' });
    }
  };

  return (
    <DetailScreen
      kicker={t('screen.kicker')}
      onLeadingPress={back}
      onRefresh={() => query.refetch()}
      updatedAt={query.dataUpdatedAt}
      trailing={
        <IconButton
          icon="more_horiz"
          accessibilityLabel={tc('a11y.moreOptions')}
          onPress={() => {
            openMenu({
              options: [
                {
                  key: 'edit',
                  label: tc('actions.edit'),
                  icon: 'edit',
                  onPress: () => {
                    setEditing(true);
                  },
                },
                {
                  key: 'not',
                  label: t('actions.notACommitment'),
                  icon: 'remove_circle',
                  onPress: () => {
                    void notACommitment();
                  },
                },
                {
                  key: 'why',
                  label: tc('actions.viewSource'),
                  icon: 'info',
                  onPress: () => {
                    openSource({
                      targetType: 'commitment',
                      targetId: item.id,
                      origin: 'commitment',
                    });
                  },
                },
              ],
            });
          }}
          testID="commitment.more"
        />
      }
      testID="commitment.screen"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StatusPill label={text.status(status)} tone={TONE[status]} />
        {item.corrected ? (
          <StatusPill label={t('screen.corrected')} tone="primary" caps={false} />
        ) : null}
      </View>
      <Text
        variant="editorialQuote"
        accessibilityLabel={t('screen.quoteA11y', { quote: item.quote ?? item.text })}
      >
        {t('screen.quote', { quote: item.quote ?? item.text })}
      </Text>
      <KeyValueGrid
        labelWidth={52}
        items={[
          { key: 'what', label: t('fields.commitment'), value: item.text },
          ...(item.counterparty === null
            ? []
            : [
                {
                  key: 'who',
                  label: item.direction === 'user_owes' ? t('fields.to') : t('fields.from'),
                  value: item.counterparty,
                  ...(item.contactId !== null && isScreenAvailable(`/person/${item.contactId}`)
                    ? {
                        onPress: () => {
                          router.push(`/person/${item.contactId ?? ''}` as Href);
                        },
                      }
                    : {}),
                },
              ]),
          { key: 'due', label: t('fields.due'), value: text.due(item) },
          {
            key: 'source',
            label: t('fields.source'),
            value: text.source(item),
            onPress: () => {
              openItemSource(item);
            },
          },
          {
            key: 'confidence',
            label: t('fields.confidence'),
            value:
              item.confidence < 0.8
                ? tc('provenance.notSure')
                : tc('provenance.confidence', { percent: Math.round(item.confidence * 100) }),
          },
        ]}
        testID="commitment.fields"
      />
      {(query.data?.reminders.length ?? 0) === 0 ? null : (
        <View style={{ gap: 8 }}>
          <SectionHeader title={t('fields.reminders')} />
          <GroupedList>
            {(query.data?.reminders ?? []).map((r) => (
              <ListRow
                key={r.id}
                title={r.title}
                subtitle={`${formats.dayMonth(r.remind_at)} ${formats.time(r.remind_at)}`}
                icon="notifications"
                trailing={{ kind: 'link', text: tc('actions.cancel') }}
                onPress={() => {
                  if (blocked('sync')) return;
                  cancelReminder.mutate(
                    { input: { params: { id: r.id }, body: { reason: 'user_cancel' } } },
                    {
                      onSuccess: () => {
                        void query.refetch();
                      },
                      onError: () => {
                        toast.show({ message: t('screen.actionFailed'), kind: 'error' });
                      },
                    },
                  );
                }}
              />
            ))}
          </GroupedList>
        </View>
      )}
      <View style={{ gap: 8 }}>
        {item.status === 'done' ? (
          recentlyDone ? (
            <Button
              label={t('screen.reopen')}
              variant="tonal"
              onPress={() => {
                track('commitment_action', { action: 'reopen' });
                actions.change({
                  id: item.id,
                  status: 'open',
                  message: t('screen.reopened'),
                  remove: false,
                  undoTo: 'done',
                });
              }}
              fullWidth
              testID="commitment.reopen"
            />
          ) : null
        ) : (
          <>
            <Button
              label={t('actions.done')}
              onPress={() => {
                track('commitment_action', { action: 'done' });
                actions.change({
                  id: item.id,
                  status: 'done',
                  message: tc('actions.markDone'),
                  remove: false,
                });
              }}
              fullWidth
              testID="commitment.done"
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                label={t('actions.snooze')}
                variant="neutralTonal"
                flex
                onPress={() => {
                  track('commitment_action', { action: 'snooze' });
                  openSnooze({
                    target: 'commitment',
                    id: item.id,
                    roots: [qk.commitments.all, qk.flow.all],
                  });
                }}
              />
              <Button
                label={t('actions.plan')}
                variant="tonal"
                flex
                onPress={() => {
                  void plan();
                }}
                testID="commitment.plan"
              />
            </View>
          </>
        )}
      </View>
      <SourceLine
        icon={item.sourceType.startsWith('email') ? 'mail' : 'description'}
        parts={[t('fields.source'), text.source(item)]}
        onPress={() => {
          openSource({ targetType: 'commitment', targetId: item.id, origin: 'commitment' });
        }}
      />
      <EditSheet
        item={item}
        visible={editing}
        onDismiss={() => {
          setEditing(false);
        }}
      />
    </DetailScreen>
  );
}
