/**
 * Internal, idempotent insight and commitment writes (SCREEN_AND_FLOW_MAP Part 2 §0.4): swipe /
 * button "Tamamlandı", "Kapat", "Ertele", "Önemli değil", "Takip etme". Each one removes the item
 * from the cached lists optimistically, runs its RPC (RPC-01 `set_insight_status`, RPC-21
 * `apply_insight_feedback`, RPC-06 `set_commitment_status`) and shows a 5 s undo toast. Offline,
 * TanStack pauses the mutation and replays it on reconnect (queued, never an approval); a failure
 * rolls the cache back with "İşlem tamamlanamadı · Tekrar dene". Undo restores the previous
 * status through the same RPC (RPC-22 `revert_insight_feedback` for feedback).
 */
import type { ItemStatus } from '@da/domain';
import { useToast } from '@da/ui';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useTranslations } from 'use-intl';

import { callRpc } from '../../lib/data/rpc';
import { track } from '../../lib/events';

type Snapshot = readonly (readonly [QueryKey, unknown])[];

function withoutId(value: unknown, id: string): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item: unknown) => (item as { id?: unknown } | null)?.id !== id)
      .map((item: unknown) => withoutId(item, id));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = withoutId(inner, id);
    return out;
  }
  return value;
}

/**
 * Removes the item with `id` from every cached query under the given roots (lists, infinite
 * pages, grouped objects) and returns a function that restores the snapshot.
 */
export function removeFromCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  roots: readonly QueryKey[],
  id: string,
): () => void {
  const snapshot: [QueryKey, unknown][] = [];
  for (const root of roots) {
    for (const [key, data] of queryClient.getQueriesData({ queryKey: root })) {
      if (data === undefined) continue;
      snapshot.push([key, data]);
      queryClient.setQueryData(key, withoutId(data, id));
    }
  }
  const frozen: Snapshot = snapshot;
  return () => {
    for (const [key, data] of frozen) queryClient.setQueryData(key, data);
  };
}

export type ActionVia = 'swipe' | 'button' | 'a11y';

export interface StatusChange {
  readonly id: string;
  readonly to: Extract<ItemStatus, 'done' | 'dismissed' | 'snoozed'>;
  readonly via: ActionVia;
  readonly snoozedUntil?: string;
  /** Toast text ("Tamamlandı", "Kapatıldı", "Ertelendi · …"). */
  readonly message: string;
  readonly onUndone?: () => void;
}

export type FeedbackKind = 'not_important' | 'show_more' | 'stop_tracking';

export interface FeedbackChange {
  readonly id: string;
  readonly kind: FeedbackKind;
  readonly message: string;
  /** `show_more` keeps the item in the list. */
  readonly keep?: boolean;
}

/** Insight status and feedback writes with optimistic removal and undo. */
export function useInsightActions(roots: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations('flow.actions');
  const tc = useTranslations('common.actions');

  const refresh = () => {
    for (const root of roots) void queryClient.invalidateQueries({ queryKey: root });
  };

  const status = useMutation({
    mutationFn: (v: { id: string; status: ItemStatus; until?: string }) =>
      callRpc('set_insight_status', {
        p_insight_id: v.id,
        p_status: v.status,
        ...(v.until === undefined ? {} : { p_snoozed_until: v.until }),
      }),
  });

  const feedback = useMutation({
    mutationFn: (v: { id: string; kind: FeedbackKind; clientId: string }) =>
      callRpc('apply_insight_feedback', {
        p_insight_id: v.id,
        p_kind: v.kind,
        p_client_mutation_id: v.clientId,
      }),
  });

  const failed = (restore: () => void) => {
    restore();
    toast.show({ message: t('failed'), kind: 'error' });
  };

  const setStatus = (change: StatusChange) => {
    const restore = removeFromCaches(queryClient, roots, change.id);
    track('insight_status_change', { from: 'open', to: change.to, via: change.via });
    status.mutate(
      {
        id: change.id,
        status: change.to,
        ...(change.snoozedUntil === undefined ? {} : { until: change.snoozedUntil }),
      },
      {
        onError: () => {
          failed(restore);
        },
      },
    );
    toast.show({
      message: change.message,
      kind: 'success',
      action: {
        label: tc('undo'),
        onPress: () => {
          track('toast_action_tapped', { action: 'undo', origin: 'flow' });
          restore();
          void callRpc('set_insight_status', { p_insight_id: change.id, p_status: 'open' })
            .then(refresh)
            .catch(() => {
              toast.show({ message: t('failed'), kind: 'error' });
            });
          change.onUndone?.();
        },
      },
    });
  };

  /** Dismiss without a learning signal (security cards: "Önemli değil" never teaches). */
  const dismissOnly = (id: string, message: string, via: ActionVia) => {
    setStatus({ id, to: 'dismissed', via, message });
  };

  const sendFeedback = (change: FeedbackChange) => {
    const restore =
      change.keep === true ? () => undefined : removeFromCaches(queryClient, roots, change.id);
    track('insight_feedback', { kind: change.kind });
    const result = feedback.mutateAsync({
      id: change.id,
      kind: change.kind,
      clientId: Crypto.randomUUID(),
    });
    result.catch(() => {
      failed(restore);
    });
    toast.show({
      message: change.message,
      kind: 'success',
      action: {
        label: tc('undo'),
        onPress: () => {
          track('correction_undo', { kind: change.kind });
          restore();
          void result
            .then(async (data) => {
              const id = (data as { feedback_id?: unknown } | null)?.feedback_id;
              if (typeof id === 'string')
                await callRpc('revert_insight_feedback', { p_feedback_id: id });
              refresh();
            })
            .catch(() => undefined);
        },
      },
    });
  };

  return { setStatus, dismissOnly, sendFeedback, refresh };
}

/** RPC-06 with undo; `reopen` restores `open`. */
export function useCommitmentActions(roots: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations('flow.actions');
  const tc = useTranslations('common.actions');
  const mutation = useMutation({
    mutationFn: (v: {
      id: string;
      status: 'open' | 'done' | 'snoozed' | 'cancelled';
      due?: string;
    }) =>
      callRpc('set_commitment_status', {
        p_commitment_id: v.id,
        p_status: v.status,
        ...(v.due === undefined ? {} : { p_due_at: v.due }),
      }),
  });
  const refresh = () => {
    for (const root of roots) void queryClient.invalidateQueries({ queryKey: root });
  };
  const change = (input: {
    readonly id: string;
    readonly status: 'done' | 'snoozed' | 'open' | 'cancelled';
    readonly due?: string;
    readonly message: string;
    readonly remove?: boolean;
    readonly undoTo?: 'open' | 'done';
  }) => {
    const restore =
      input.remove === false ? () => undefined : removeFromCaches(queryClient, roots, input.id);
    mutation.mutate(
      {
        id: input.id,
        status: input.status,
        ...(input.due === undefined ? {} : { due: input.due }),
      },
      {
        onSuccess: refresh,
        onError: () => {
          restore();
          toast.show({ message: t('failed'), kind: 'error' });
        },
      },
    );
    toast.show({
      message: input.message,
      kind: 'success',
      action: {
        label: tc('undo'),
        onPress: () => {
          restore();
          void callRpc('set_commitment_status', {
            p_commitment_id: input.id,
            p_status: input.undoTo ?? 'open',
          })
            .then(refresh)
            .catch(() => {
              toast.show({ message: t('failed'), kind: 'error' });
            });
        },
      },
    });
  };
  return { change, refresh, pending: mutation.isPending };
}
