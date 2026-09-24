/**
 * Insight actions on Today (M-TD-01, §0.5): "Tamamlandı" and "Ertele" go through RPC-01
 * `set_insight_status` with the R-06 client undo — the card leaves at once, the toast offers
 * "Geri al" for 5 seconds, and only then is the write sent (undo cancels it; nothing reaches the
 * server). "Önemli değil" and the correction options go through RPC-21 `apply_insight_feedback`
 * right away; their "Geri al" calls RPC-22 `revert_insight_feedback`. Offline, both go to the
 * persisted offline mutation queue (T-8.23) and replay on reconnect (RPC-01 is idempotent, RPC-21
 * dedupes on `p_client_mutation_id`); "Geri al" on a queued write removes it from the queue.
 */
import { qk } from '@da/api-client';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { translator } from '../../i18n/translate';
import { track } from '../../lib/events';
import { cancelQueuedMutation, queueMutation, runOrQueue } from '../../lib/offline/mutations';
import { entitlementFeatureOf, rpc } from '../../lib/postgrest';
import { getQueryClient } from '../../lib/query/client';
import { showToast } from '../../providers/ToastHost';
import { openProGate } from '../pro-gate/ProGate';
import type { TodayData, TodayPriority } from './data';

/** R-06: the client undo window. */
export const UNDO_WINDOW_MS = 5_000;

export type FeedbackKind = 'not_important' | 'show_more' | 'make_vip' | 'stop_tracking';

function hide(client: QueryClient, localDate: string, id: string): TodayData | undefined {
  const key = qk.today.day(localDate);
  const snapshot = client.getQueryData<TodayData>(key);
  client.setQueryData<TodayData>(key, (data) =>
    data === undefined
      ? data
      : {
          ...data,
          overview: {
            ...data.overview,
            priorities: data.overview.priorities.filter((p) => p.id !== id),
            hero_count: Math.max(0, data.overview.hero_count - 1),
          },
        },
  );
  return snapshot;
}

function restore(client: QueryClient, localDate: string, snapshot: TodayData | undefined): void {
  if (snapshot !== undefined) client.setQueryData(qk.today.day(localDate), snapshot);
}

interface DelayedStatus {
  readonly item: TodayPriority;
  readonly localDate: string;
  readonly status: 'done' | 'snoozed';
  readonly snoozedUntil?: string;
  readonly message: string;
  readonly undoAction: 'done' | 'snooze';
}

function delayedStatus(change: DelayedStatus, client: QueryClient = getQueryClient()): void {
  const t = translator();
  const snapshot = hide(client, change.localDate, change.item.id);
  let undone = false;
  const commit = () => {
    if (undone) return;
    void runOrQueue('insight_status', {
      insightId: change.item.id,
      status: change.status,
      ...(change.snoozedUntil === undefined ? {} : { snoozedUntil: change.snoozedUntil }),
    }).then((result) => {
      if (result.status !== 'failed') return;
      restore(client, change.localDate, snapshot);
      showToast({ message: t('common.toast.saveFailed'), kind: 'error' });
    });
  };
  const timer = setTimeout(commit, UNDO_WINDOW_MS);
  showToast({
    message: onlineManager.isOnline() ? change.message : t('today.toasts.offlineQueued'),
    kind: onlineManager.isOnline() ? 'success' : 'offline',
    durationMs: UNDO_WINDOW_MS,
    action: {
      label: t('common.actions.undo'),
      onPress: () => {
        undone = true;
        clearTimeout(timer);
        restore(client, change.localDate, snapshot);
        track('priority_undo', { action: change.undoAction });
      },
    },
  });
}

export function completeInsight(
  item: TodayPriority,
  localDate: string,
  via: 'button' | 'swipe' | 'a11y',
): void {
  track('priority_complete', { kind: item.kind, via });
  delayedStatus({
    item,
    localDate,
    status: 'done',
    message: translator()('common.toast.completed'),
    undoAction: 'done',
  });
}

export function snoozeInsight(
  item: TodayPriority,
  localDate: string,
  until: Date,
  preset: 'tonight' | 'tomorrow_morning' | 'custom',
  label: string,
): void {
  track('priority_snoozed', { preset, entity: 'insight' });
  delayedStatus({
    item,
    localDate,
    status: 'snoozed',
    snoozedUntil: until.toISOString(),
    message: translator()('today.toasts.snoozed', { when: label }),
    undoAction: 'snooze',
  });
}

/** RPC-21 now, with an undo that calls RPC-22. Returns false when the call failed. */
export async function applyFeedback(
  item: TodayPriority,
  localDate: string,
  kind: FeedbackKind,
  learningOn: boolean,
  names: { readonly person?: string } = {},
  client: QueryClient = getQueryClient(),
): Promise<boolean> {
  const t = translator();
  const dismisses = kind === 'not_important' || kind === 'stop_tracking';
  const snapshot = dismisses ? hide(client, localDate, item.id) : undefined;
  if (!onlineManager.isOnline()) {
    // Queued (RPC-21 dedupes on the client mutation id); "Geri al" drops it from the queue.
    const entry = queueMutation('insight_feedback', {
      insightId: item.id,
      kind,
      clientMutationId: Crypto.randomUUID(),
    });
    track('priority_feedback', { kind: item.kind, feedback: kind, learning_on: learningOn });
    showToast({
      message: t('today.toasts.offlineQueued'),
      kind: 'offline',
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: t('common.actions.undo'),
        onPress: () => {
          track('priority_undo', { action: 'feedback' });
          if (cancelQueuedMutation(entry.id)) restore(client, localDate, snapshot);
        },
      },
    });
    return true;
  }
  let feedbackId: string | null = null;
  try {
    const result = (await rpc('apply_insight_feedback', {
      p_insight_id: item.id,
      p_kind: kind,
      p_client_mutation_id: Crypto.randomUUID(),
    })) as { feedback_id?: string } | null;
    feedbackId = result?.feedback_id ?? null;
  } catch (error) {
    if (dismisses) restore(client, localDate, snapshot);
    if (entitlementFeatureOf(error) !== null) openProGate('vip');
    else showToast({ message: t('common.toast.saveFailed'), kind: 'error' });
    return false;
  }
  track('priority_feedback', { kind: item.kind, feedback: kind, learning_on: learningOn });
  const message = !learningOn
    ? t('today.toasts.learningOff')
    : kind === 'not_important'
      ? t('common.toast.learnedLower')
      : kind === 'show_more'
        ? t('common.toast.learnedHigher')
        : kind === 'make_vip'
          ? t('common.toast.vipAdded', { name: names.person ?? '' })
          : t('today.toasts.stopTracking');
  showToast({
    message,
    icon: 'psychology',
    durationMs: UNDO_WINDOW_MS,
    ...(feedbackId === null
      ? {}
      : {
          action: {
            label: t('common.actions.undo'),
            onPress: () => {
              track('priority_feedback_undone', { feedback: kind });
              track('priority_undo', { action: 'feedback' });
              void rpc('revert_insight_feedback', { p_feedback_id: feedbackId })
                .then(() => {
                  restore(client, localDate, snapshot);
                  void client.invalidateQueries({ queryKey: qk.today.all });
                })
                .catch(() => {
                  showToast({ message: t('common.toast.saveFailed'), kind: 'error' });
                });
            },
          },
        }),
  });
  void client.invalidateQueries({ queryKey: qk.insights.all });
  return true;
}
