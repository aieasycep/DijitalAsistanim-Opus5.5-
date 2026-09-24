/**
 * Proposing side-effect writes (API-APR-01, R-04): the client never inserts `approval_actions`;
 * it sends a strict payload to `POST /approvals` and the server returns the pending `ApprovalView`
 * (exact change, destination, side effects), which opens the inline approval sheet. Used by
 * "Takvime Ekle" (Flow, Email Detail, Life) and "Görev Oluştur" (Email Detail).
 *
 * The destination calendar is `user_preferences.default_write_calendar_id`, else the primary
 * writable selected calendar. A duplicate pending proposal for the same origin answers
 * `STATE_CONFLICT` with the existing approval id: the user is told it is already waiting.
 */
import { isApiError } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import { addMinutes, type Provider, type SourceType } from '@da/domain';
import { useToast } from '@da/ui';
import type { ApprovalView } from '@da/validation/api/approvals';
import { useMutation, type QueryKey } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { unwrapMaybe } from '../../lib/data/rpc';
import { useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { openApprovalSheet, type ApprovalSheetParams } from '../approvals/ApprovalSheet';
import { useOfflineGuard } from './ui';

export interface ProposalSource {
  readonly source_type: SourceType;
  readonly source_id: string | null;
  readonly source_provider: Provider | 'in_app';
  readonly source_timestamp: string;
}

type Origin = 'insight' | 'email_detail' | 'life_event' | 'manual';

interface WritableCalendar {
  readonly id: string;
  readonly connected_account_id: string;
}

async function writableCalendar(preferred: string | null): Promise<WritableCalendar | null> {
  const base = getSupabase()
    .from('calendars')
    .select('id,connected_account_id')
    .eq('can_write', true)
    .eq('selected', true);
  if (preferred !== null) {
    const hit = unwrapMaybe(await base.eq('id', preferred).maybeSingle());
    if (hit !== null) return hit;
  }
  return unwrapMaybe(
    await getSupabase()
      .from('calendars')
      .select('id,connected_account_id')
      .eq('can_write', true)
      .eq('selected', true)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

/** Proposal writes that open the inline approval sheet. */
export function useProposals(sheetOrigin: ApprovalSheetParams['origin']) {
  const client = useApiClient();
  const toast = useToast();
  const router = useRouter();
  const session = useSessionContext();
  const blocked = useOfflineGuard();
  const t = useTranslations('flow.proposal');
  const propose = useMutation(apiMutationOptions(client, 'POST /approvals'));

  const handleError = (error: unknown) => {
    if (isApiError(error) && error.code === 'STATE_CONFLICT') {
      const id = (error.details as { approval_id?: unknown }).approval_id;
      const path = typeof id === 'string' ? `/approvals/${id}` : null;
      toast.show({
        message: t('alreadyPending'),
        ...(path !== null && isScreenAvailable(path)
          ? {
              action: {
                label: t('view'),
                onPress: () => {
                  router.push(path);
                },
              },
            }
          : {}),
      });
      return;
    }
    if (isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED') {
      toast.show({ message: t('proRequired') });
      return;
    }
    if (isApiError(error) && error.code === 'DATA_SOURCE_DISABLED') {
      toast.show({ message: t('sourceOff'), kind: 'error' });
      return;
    }
    toast.show({ message: t('failed'), kind: 'error' });
  };

  const open = (approval: ApprovalView, invalidate: readonly QueryKey[] | undefined) => {
    openApprovalSheet({
      approval,
      origin: sheetOrigin,
      ...(invalidate === undefined ? {} : { invalidate }),
    });
  };

  /** "Takvime Ekle": a timed event (default 30 min ending at a deadline, or 60 min at a start). */
  const proposeEvent = async (input: {
    readonly title: string;
    readonly start: string;
    readonly end?: string;
    readonly origin: Origin;
    readonly originRef: {
      readonly type: 'insight' | 'task' | 'commitment';
      readonly id: string;
    } | null;
    readonly originRefId: string | null;
    readonly source?: ProposalSource;
    readonly invalidate?: readonly QueryKey[];
  }): Promise<void> => {
    if (blocked('approve')) return;
    const calendar = await writableCalendar(
      session.data?.preferences.default_write_calendar_id ?? null,
    ).catch(() => null);
    if (calendar === null) {
      toast.show({ message: t('noCalendar'), kind: 'error' });
      return;
    }
    const end = input.end ?? addMinutes(input.start, 60).toISOString();
    propose.mutate(
      {
        input: {
          body: {
            payload: {
              action_type: 'calendar_create',
              target: {
                kind: 'provider',
                connected_account_id: calendar.connected_account_id,
                calendar_id: calendar.id,
              },
              title: input.title.slice(0, 300),
              time: { kind: 'timed', start: input.start, end, time_zone: session.timeZone },
              attendees: [],
              reminders_minutes: [30],
              ...(input.originRef === null ? {} : { origin_task_ref: input.originRef }),
            },
            origin: input.origin,
            origin_ref_id: input.originRefId,
            ...(input.source === undefined ? {} : { source: input.source }),
          },
        },
      },
      {
        onSuccess: (approval) => {
          open(approval, input.invalidate);
        },
        onError: handleError,
      },
    );
  };

  /** "Görev Oluştur": an in-app task (the Approval Center editor changes the destination). */
  const proposeTask = (input: {
    readonly title: string;
    readonly dueAt: string | null;
    readonly origin: Origin;
    readonly originRefId: string | null;
    readonly source?: ProposalSource;
    readonly invalidate?: readonly QueryKey[];
  }) => {
    if (blocked('approve')) return;
    propose.mutate(
      {
        input: {
          body: {
            payload: {
              action_type: 'task_create',
              target: { kind: 'in_app' },
              title: input.title.slice(0, 1024),
              ...(input.dueAt === null
                ? {}
                : { due: { kind: 'date_time', at: input.dueAt, time_zone: session.timeZone } }),
            },
            origin: input.origin,
            origin_ref_id: input.originRefId,
            ...(input.source === undefined ? {} : { source: input.source }),
          },
        },
      },
      {
        onSuccess: (approval) => {
          open(approval, input.invalidate);
        },
        onError: handleError,
      },
    );
  };

  return { proposeEvent, proposeTask, pending: propose.isPending };
}

/** A 30-minute block ending at a deadline, never starting in the past. */
export function deadlineBlock(dueAt: string, nowMs: number): { start: string; end: string } {
  const due = Date.parse(dueAt);
  const start = Math.max(due - 30 * 60_000, nowMs + 5 * 60_000);
  const end = Math.max(due, start + 15 * 60_000);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
