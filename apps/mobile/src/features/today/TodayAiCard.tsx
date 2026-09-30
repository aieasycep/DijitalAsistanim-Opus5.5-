/**
 * DEV-68 · the Today AI card (design 03, M§8 "AI insight cards"): at most one `AiCard` between the
 * hero and ÖNCELİKLERİN, fed by today's open calendar conflict or schedule suggestion from RPC-04
 * `today_overview` — the same insight is then not repeated as a priority card. Its actions are the
 * Plan flows: a conflict opens `plan/conflict/{insightId}` (API-PLAN-03 options) and "Böyle Kalsın"
 * dismisses it through RPC-01 with the R-06 undo; a schedule suggestion opens its linked proposal
 * (`plan/proposal/{approvalId}`) or asks `POST /plan/proposals {item:{type:'insight'}}` for one
 * (Pro; Free gets the gate, offline is blocked) and "Önemli değil" is RPC-21 feedback.
 */
import { useApiClient } from '@da/api-client/react';
import { AiCard, useToast } from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOfflineGuard } from '../actions/ui';
import { createProposal } from '../plan/data';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { applyFeedback, keepInsight } from './actions';
import type { TodayPriority } from './data';

const AI_KINDS: ReadonlySet<string> = new Set(['conflict', 'schedule_suggestion']);
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** The one priority the AI card shows: the highest-ranked conflict or schedule suggestion. */
export function aiInsightOf(priorities: readonly TodayPriority[]): TodayPriority | null {
  return priorities.find((p) => AI_KINDS.has(p.kind)) ?? null;
}

function proposalIdOf(item: TodayPriority): string | null {
  return item.entity_type === 'approval_action' && item.entity_id !== null ? item.entity_id : null;
}

export function TodayAiCard({
  item,
  localDate,
}: {
  readonly item: TodayPriority;
  readonly localDate: string;
}) {
  const t = useTranslations('today');
  const plan = useTranslations('plan');
  const common = useTranslations('common');
  const flow = useTranslations('flow');
  const router = useRouter();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const blocked = useOfflineGuard();
  const [proposing, setProposing] = useState(false);

  const open = (href: string) => {
    track('priority_opened', { kind: item.kind });
    track('priority_action', { kind: item.kind, action: 'open' });
    router.push(href);
  };

  const propose = async () => {
    const linked = proposalIdOf(item);
    if (linked !== null) {
      open(`/plan/proposal/${linked}`);
      return;
    }
    if (!isPro()) {
      openProGate('advanced_planning');
      return;
    }
    if (blocked('approve')) return;
    track('priority_action', { kind: item.kind, action: 'calendar' });
    const from = now().getTime() + 5 * 60_000;
    setProposing(true);
    try {
      const id = await createProposal(client, queryClient, {
        item: { type: 'insight', id: item.id },
        durationMinutes: 60,
        window: { from: new Date(from).toISOString(), to: new Date(from + WEEK_MS).toISOString() },
      });
      router.push(`/plan/proposal/${id}` as Href);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENTITLEMENT_REQUIRED') {
        openProGate('advanced_planning');
        return;
      }
      toast.show({
        message: code === 'STATE_CONFLICT' ? flow('proposal.noSlot') : flow('proposal.failed'),
        kind: code === 'STATE_CONFLICT' ? 'neutral' : 'error',
      });
    } finally {
      setProposing(false);
    }
  };

  const conflictRoute = `/plan/conflict/${item.id}`;
  const primary =
    item.kind === 'conflict'
      ? isScreenAvailable(conflictRoute)
        ? {
            label: plan('conflict.options'),
            icon: 'event_busy' as const,
            onPress: () => {
              open(conflictRoute);
            },
          }
        : undefined
      : isScreenAvailable('/plan/proposal/:id')
        ? {
            label: common('actions.schedule'),
            icon: 'event_available' as const,
            loading: proposing,
            onPress: () => {
              void propose();
            },
          }
        : undefined;
  const secondary =
    item.kind === 'conflict'
      ? {
          label: plan('screen.keep'),
          onPress: () => {
            track('priority_action', { kind: item.kind, action: 'dismiss' });
            keepInsight(item, localDate);
          },
        }
      : {
          label: t('notImportant'),
          onPress: () => {
            track('priority_action', { kind: item.kind, action: 'dismiss' });
            void applyFeedback(item, localDate, 'not_important', true);
          },
        };

  return (
    <AiCard
      kicker={t('sections.calendarIntel')}
      title={item.title}
      {...(item.body === null ? {} : { body: item.body })}
      {...(primary === undefined ? {} : { primaryAction: primary })}
      secondaryAction={secondary}
      testID="today.aiCard"
    />
  );
}
