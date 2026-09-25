/**
 * The network card actions of Today (Annex M-TD-01-B), the same flows as the Flow cards:
 * - deadline "Takvime Ekle": a 30-minute `calendar_create` block ending at the deadline, proposed
 *   with `POST /approvals` (origin `insight`) and approved in the inline approval sheet;
 * - follow-up "Takip Mesajı Hazırla" (Pro): `POST /followups/:threadId/draft` → the reply screen in
 *   follow-up mode;
 * - commitment "Planla" (Pro, advanced planning): `POST /plan/proposals {item:{type:'commitment'}}`
 *   → `plan/proposal/{approvalId}`.
 * Offline, each is blocked with the write toast (never queued); Free users get the Pro gate.
 */
import { qk } from '@da/api-client';
import { apiMutationOptions, callRoute, useApiClient } from '@da/api-client/react';
import type { Provider, SourceType } from '@da/domain';
import { useToast } from '@da/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { deadlineBlock, useProposals, type ProposalSource } from '../actions/proposals';
import { useOfflineGuard } from '../actions/ui';
import { threadIdOfMessage } from '../mail/data';
import { isPro, openProGate } from '../pro-gate/ProGate';
import type { TodayPriority } from './data';
import type { CardIntent } from './intents';

const WEEK_MS = 7 * 24 * 60 * 60_000;

function sourceOf(item: TodayPriority): ProposalSource | undefined {
  const source = item.source;
  const id = source?.source_id ?? null;
  const type = source?.source_type ?? null;
  if (id === null || type === null || source === null) return undefined;
  return {
    source_type: type as SourceType,
    source_id: id,
    source_provider: (source.provider ?? 'in_app') as Provider | 'in_app',
    source_timestamp: source.source_timestamp ?? now().toISOString(),
  };
}

async function threadOf(item: TodayPriority): Promise<string | null> {
  if (item.entity_type === 'email_thread' && item.entity_id !== null) return item.entity_id;
  const message =
    item.entity_type === 'email_message'
      ? item.entity_id
      : item.source?.source_type === 'email_message'
        ? item.source.source_id
        : null;
  return message === null ? null : threadIdOfMessage(message).catch(() => null);
}

export function useCardIntents(): (action: CardIntent, item: TodayPriority) => void {
  const client = useApiClient();
  const router = useRouter();
  const toast = useToast();
  const blocked = useOfflineGuard();
  const proposals = useProposals();
  const t = useTranslations('flow');
  const followupDraft = useMutation(apiMutationOptions(client, 'POST /followups/:threadId/draft'));

  const addToCalendar = (item: TodayPriority) => {
    if (item.due_at === null) return;
    const block = deadlineBlock(item.due_at, now().getTime());
    const source = sourceOf(item);
    void proposals.proposeEvent({
      title: item.title,
      start: block.start,
      end: block.end,
      origin: 'insight',
      originRef: { type: 'insight', id: item.id },
      originRefId: item.id,
      ...(source === undefined ? {} : { source }),
      invalidate: [qk.today.all],
    });
  };

  const draftFollowUp = async (item: TodayPriority) => {
    if (!isPro()) {
      openProGate('followups');
      return;
    }
    if (blocked('reply')) return;
    const threadId = await threadOf(item);
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
            `/mail/${draft.email_message_id}/reply?mode=follow_up&draftId=${draft.id}&origin=today` as Href,
          );
        },
        onError: () => {
          track('follow_up_draft_created', { tone: 'short', result: 'error' });
          toast.show({ message: t('actions.failed'), kind: 'error' });
        },
      },
    );
  };

  const planCommitment = async (item: TodayPriority) => {
    if (!isPro()) {
      openProGate('advanced_planning');
      return;
    }
    if (blocked('approve') || item.entity_id === null) return;
    const from = now().getTime() + 5 * 60_000;
    const due = item.due_at === null ? Number.POSITIVE_INFINITY : Date.parse(item.due_at);
    const to = Math.max(Math.min(due, from + WEEK_MS), from + 60 * 60_000);
    try {
      const proposal = await callRoute(client, 'POST /plan/proposals', {
        body: {
          item: { type: 'commitment', id: item.entity_id },
          duration_minutes: 60,
          window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
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

  return (action, item) => {
    track('priority_action', {
      kind: item.kind,
      action: action === 'plan' ? 'calendar' : action,
    });
    switch (action) {
      case 'calendar':
        addToCalendar(item);
        return;
      case 'followup_draft':
        void draftFollowUp(item);
        return;
      case 'plan':
        void planCommitment(item);
        return;
    }
  };
}
