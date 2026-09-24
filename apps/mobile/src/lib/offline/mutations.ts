/**
 * The app's offline mutation queue (T-8.23): the typed kinds of every internal write the specs
 * allow offline (SCREEN_AND_FLOW_MAP §0.5 and Part 4 §14.2, API_CONTRACTS §2.16 "Queueable"), their
 * executors and the singleton wired to the encrypted `da-prefs` store, TanStack's `onlineManager`
 * and the query cache.
 *
 * Queueable here: insight status (RPC-01), insight feedback (RPC-21, deduped by
 * `p_client_mutation_id`), commitment status (RPC-06), owner-row preference patches (last write
 * wins per table), `POST /feedback`, in-app reminders (`POST /reminders`, idempotent on
 * `client_reminder_id`) and their cancel, `mark_briefing_opened`, notification `opened_at`, and the
 * VIP toggle. Approvals, sends, provider writes, purchases, privacy and integrations are never
 * queued: they are blocked before the call (`OFFLINE_BLOCKED`).
 *
 * Replays run on reconnect (`onlineManager`) and on every foreground; after a reconnect replay the
 * persisted queries are refreshed. Logout empties the queue; a queue left by an expired session is
 * replayed only for the same user (the engine discards another user's entries).
 */
import { qk, type ApiInput } from '@da/api-client';
import { onlineManager, type QueryKey } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { translator } from '../../i18n/translate';
import { showToast } from '../../providers/ToastHost';
import { LOGOUT_HOOKS, registerLogoutCleanup } from '../auth/logout';
import { getApiClient } from '../bootstrap';
import { callRpc } from '../data/rpc';
import { track } from '../events';
import {
  cachedBootstrap,
  toDataError,
  updateNotificationPreferences,
  updateProfile,
  updateUserPreferences,
} from '../postgrest';
import { getSupabase } from '../auth/supabase';
import { getQueryClient } from '../query/client';
import { encryptedStorage, isEncryptedStorageOpen } from '../storage';
import {
  createMutationQueue,
  type HandlerMap,
  type QueueEntry,
  type QueueStorage,
  type RunResult,
} from './mutation-queue';

export type OwnTable = 'user_preferences' | 'notification_preferences' | 'profiles';
export type InsightStatus = 'open' | 'done' | 'snoozed' | 'dismissed';
export type InsightFeedbackKind = 'not_important' | 'show_more' | 'make_vip' | 'stop_tracking';
export type CommitmentStatus = 'open' | 'done' | 'snoozed' | 'cancelled';
export type FeedbackBody = NonNullable<ApiInput<'POST /feedback'>['body']>;
export type ReminderCreateBody = NonNullable<ApiInput<'POST /reminders'>['body']>;

/** Arguments of every queueable kind (JSON-serialisable: they are persisted). */
export interface MutationArgs {
  readonly insight_status: {
    readonly insightId: string;
    readonly status: InsightStatus;
    readonly snoozedUntil?: string;
  };
  readonly insight_feedback: {
    readonly insightId: string;
    readonly kind: InsightFeedbackKind;
    readonly clientMutationId: string;
  };
  readonly commitment_status: {
    readonly commitmentId: string;
    readonly status: CommitmentStatus;
    readonly dueAt?: string;
  };
  readonly own_row: {
    readonly table: OwnTable;
    readonly patch: Readonly<Record<string, unknown>>;
  };
  readonly feedback: { readonly body: FeedbackBody };
  readonly reminder_create: { readonly body: ReminderCreateBody };
  readonly reminder_cancel: { readonly id: string; readonly reason: 'user_cancel' | 'undo' };
  readonly briefing_opened: { readonly briefingId: string };
  readonly notification_opened: {
    readonly category: string;
    readonly entityId: string;
    readonly openedAt: string;
  };
  readonly vip_set: { readonly contactId: string; readonly on: boolean };
}

export type MutationKind = keyof MutationArgs;

/** The queue class of every mutation kind (Part 4 §14.6 "queue class map"). */
export const MUTATION_CLASSES: Readonly<Record<MutationKind, 'queued_lww' | 'queued_idempotent'>> =
  {
    insight_status: 'queued_lww',
    insight_feedback: 'queued_idempotent',
    commitment_status: 'queued_lww',
    own_row: 'queued_lww',
    feedback: 'queued_idempotent',
    reminder_create: 'queued_idempotent',
    reminder_cancel: 'queued_idempotent',
    briefing_opened: 'queued_idempotent',
    notification_opened: 'queued_idempotent',
    vip_set: 'queued_lww',
  };

const INSIGHT_ROOTS: readonly QueryKey[] = [
  qk.today.all,
  qk.insights.all,
  qk.flow.all,
  qk.waiting.all,
  qk.followups.all,
];

function updateOwn(table: OwnTable, patch: Readonly<Record<string, unknown>>): Promise<void> {
  switch (table) {
    case 'user_preferences':
      return updateUserPreferences(patch);
    case 'notification_preferences':
      return updateNotificationPreferences(patch);
    case 'profiles':
      return updateProfile(patch);
  }
}

interface DbError {
  readonly message: string;
  readonly code?: string;
}

async function setVip(contactId: string, on: boolean): Promise<void> {
  const table = getSupabase().from('vip_people');
  const { error } = (await (on
    ? table.insert({ contact_id: contactId, origin: 'user', relationship: 'other' } as never)
    : table.delete().eq('contact_id', contactId))) as { error: DbError | null };
  // `23505`: the contact is already a VIP (a replay of the same toggle).
  if (error !== null && error.code !== '23505') throw toDataError(error);
}

/** Server ids of reminders created by a replay, by `client_reminder_id` (for a late "Geri al"). */
const replayedReminders = new Map<string, string>();

export const MUTATION_HANDLERS: HandlerMap<MutationArgs> = {
  insight_status: {
    scope: (a) => `insight:${a.insightId}`,
    coalesceKey: (a) => `insight_status:${a.insightId}`,
    run: (a) =>
      callRpc('set_insight_status', {
        p_insight_id: a.insightId,
        p_status: a.status,
        ...(a.snoozedUntil === undefined ? {} : { p_snoozed_until: a.snoozedUntil }),
      }),
    invalidate: () => INSIGHT_ROOTS,
  },
  insight_feedback: {
    scope: (a) => `insight:${a.insightId}`,
    run: (a) =>
      callRpc('apply_insight_feedback', {
        p_insight_id: a.insightId,
        p_kind: a.kind,
        p_client_mutation_id: a.clientMutationId,
      }),
    invalidate: () => INSIGHT_ROOTS,
  },
  commitment_status: {
    scope: (a) => `commitment:${a.commitmentId}`,
    coalesceKey: (a) => `commitment_status:${a.commitmentId}`,
    run: (a) =>
      callRpc('set_commitment_status', {
        p_commitment_id: a.commitmentId,
        p_status: a.status,
        ...(a.dueAt === undefined ? {} : { p_due_at: a.dueAt }),
      }),
    invalidate: () => [qk.commitments.all, qk.today.all],
  },
  own_row: {
    scope: (a) => `settings:${a.table}`,
    coalesceKey: (a) => `own_row:${a.table}`,
    merge: (queued, next) => ({ table: next.table, patch: { ...queued.patch, ...next.patch } }),
    run: (a) => updateOwn(a.table, a.patch),
    invalidate: () => [qk.me.bootstrap()],
  },
  feedback: {
    scope: () => 'feedback',
    run: async (a, idempotencyKey) =>
      (await getApiClient().call('POST /feedback', { body: a.body }, { idempotencyKey })).data,
    onReplayed: (a) => {
      track('feedback_submitted', {
        type: a.body.type,
        ...(a.body.rating === undefined ? {} : { rating: a.body.rating }),
        queued: true,
        diagnostics: a.body.include_diagnostics,
      });
      showToast({ message: translator()('settings.feedback.sentLater'), kind: 'success' });
    },
  },
  reminder_create: {
    scope: () => 'reminders',
    run: async (a) => (await getApiClient().call('POST /reminders', { body: a.body })).data,
    invalidate: () => [qk.reminders.all],
    onReplayed: (a, result) => {
      const id = (result as { id?: unknown } | null)?.id;
      if (typeof id === 'string') replayedReminders.set(a.body.client_reminder_id, id);
    },
  },
  reminder_cancel: {
    scope: () => 'reminders',
    run: async (a, idempotencyKey) =>
      (
        await getApiClient().call(
          'POST /reminders/:id/cancel',
          { params: { id: a.id }, body: { reason: a.reason } },
          { idempotencyKey },
        )
      ).data,
    invalidate: () => [qk.reminders.all],
  },
  briefing_opened: {
    scope: (a) => `briefing:${a.briefingId}`,
    // First write wins on the server (`coalesce`), so the queued entry is kept as it is.
    coalesceKey: (a) => `briefing_opened:${a.briefingId}`,
    merge: (queued) => queued,
    run: (a) => callRpc('mark_briefing_opened', { p_briefing_id: a.briefingId }),
  },
  notification_opened: {
    scope: () => 'notifications',
    coalesceKey: (a) => `notification_opened:${a.category}:${a.entityId}`,
    merge: (queued) => queued,
    run: async (a) => {
      const since = new Date(Date.parse(a.openedAt) - 48 * 60 * 60 * 1000).toISOString();
      const { error } = (await getSupabase()
        .from('notifications')
        .update({ opened_at: a.openedAt } as never)
        .eq('entity_id', a.entityId)
        .eq('category', a.category as never)
        .gte('sent_at', since)
        .is('opened_at', null)) as { error: DbError | null };
      if (error !== null) throw toDataError(error);
    },
  },
  vip_set: {
    scope: (a) => `vip:${a.contactId}`,
    coalesceKey: (a) => `vip_set:${a.contactId}`,
    run: (a) => setVip(a.contactId, a.on),
    invalidate: (a) => [qk.vip.all, qk.person.detail(a.contactId), qk.today.all, qk.mail.all],
  },
};

export const QUEUE_STORAGE_KEY = 'offline.mutations.v1';

function prefsStorage(): QueueStorage | null {
  if (!isEncryptedStorageOpen()) return null;
  const prefs = encryptedStorage().prefs;
  return {
    read: () => prefs.getString(QUEUE_STORAGE_KEY),
    write: (value) => {
      if (value === null) prefs.remove(QUEUE_STORAGE_KEY);
      else prefs.set(QUEUE_STORAGE_KEY, value);
    },
  };
}

function invalidate(keys: readonly QueryKey[]): void {
  const client = getQueryClient();
  for (const queryKey of keys) void client.invalidateQueries({ queryKey });
}

const queue = createMutationQueue<MutationArgs>(MUTATION_HANDLERS, {
  storage: prefsStorage,
  isOnline: () => onlineManager.isOnline(),
  currentUserId: () => cachedBootstrap()?.profile.id ?? null,
  newId: () => Crypto.randomUUID(),
  invalidate,
  reportDropped: (count) => {
    showToast({ message: translator()('states.offline.replayDropped', { count }), kind: 'error' });
  },
});

export type AppQueueEntry = QueueEntry<MutationKind>;

/** Queues a write for the next replay. */
export function queueMutation<K extends MutationKind>(
  kind: K,
  args: MutationArgs[K],
  options?: { readonly idempotencyKey?: string },
): AppQueueEntry {
  return queue.enqueue(kind, args, options);
}

/** Sends a write now when possible; queues it offline or behind earlier writes of its scope. */
export function runOrQueue<K extends MutationKind>(
  kind: K,
  args: MutationArgs[K],
  options?: { readonly idempotencyKey?: string },
): Promise<RunResult> {
  return queue.runOrQueue(kind, args, options);
}

/** Removes a write that has not been sent yet; false when it already left the queue. */
export function cancelQueuedMutation(entryId: string): boolean {
  return queue.cancel(entryId);
}

export function flushMutationQueue(): Promise<void> {
  return queue.flush();
}

export function queuedMutations(): readonly AppQueueEntry[] {
  return queue.entries() as readonly AppQueueEntry[];
}

/** The server id a replayed reminder got, by its `client_reminder_id`. */
export function replayedReminderId(clientReminderId: string): string | null {
  return replayedReminders.get(clientReminderId) ?? null;
}

/** Number of queued writes matching `filter` (re-renders when the queue changes). */
export function useQueuedCount(filter?: (entry: AppQueueEntry) => boolean): number {
  const count = () =>
    filter === undefined ? queue.entries().length : queuedMutations().filter(filter).length;
  return useSyncExternalStore(queue.subscribe, count, count);
}

// Queues written by earlier builds (T-8.18/T-8.19): adopted once, in their original order.
const LEGACY_SETTINGS_KEY = 'settings.pending_writes';
const LEGACY_FEEDBACK_KEY = 'feedback.outbox';

function parse(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Moves the pre-T-8.23 settings patches and feedback outbox into the queue. */
export function migrateLegacyQueues(): void {
  if (!isEncryptedStorageOpen()) return;
  const prefs = encryptedStorage().prefs;
  const settings = parse(prefs.getString(LEGACY_SETTINGS_KEY));
  if (typeof settings === 'object' && settings !== null) {
    for (const table of ['profiles', 'user_preferences', 'notification_preferences'] as const) {
      const patch = (settings as Record<string, unknown>)[table];
      if (typeof patch === 'object' && patch !== null) {
        queue.enqueue('own_row', { table, patch: patch as Record<string, unknown> });
      }
    }
  }
  prefs.remove(LEGACY_SETTINGS_KEY);
  const outbox = parse(prefs.getString(LEGACY_FEEDBACK_KEY));
  if (Array.isArray(outbox)) {
    for (const item of outbox as { body?: FeedbackBody; idempotencyKey?: string }[]) {
      if (item.body === undefined || typeof item.idempotencyKey !== 'string') continue;
      queue.enqueue('feedback', { body: item.body }, { idempotencyKey: item.idempotencyKey });
    }
  }
  prefs.remove(LEGACY_FEEDBACK_KEY);
}

let unbind: (() => void) | null = null;

/** Replays on reconnect (then refreshes the persisted queries) and on every foreground. */
export function bindMutationQueue(): void {
  if (unbind !== null) return;
  migrateLegacyQueues();
  let wasOnline = onlineManager.isOnline();
  const offOnline = onlineManager.subscribe((online) => {
    const reconnected = online && !wasOnline;
    wasOnline = online;
    if (!online) return;
    void queue.flush().then(() => {
      if (!reconnected) return;
      void getQueryClient().invalidateQueries({
        predicate: (query) => query.meta?.persist === true,
      });
    });
  });
  const foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') void queue.flush();
  });
  unbind = () => {
    offOnline();
    foreground.remove();
  };
  void queue.flush();
}

registerLogoutCleanup(LOGOUT_HOOKS.offlineQueue, () => {
  queue.clear();
  replayedReminders.clear();
});

/** Test seam: an empty queue (the reconnect and foreground binding stays). */
export function resetMutationQueueForTests(): void {
  queue.reset();
  replayedReminders.clear();
}
