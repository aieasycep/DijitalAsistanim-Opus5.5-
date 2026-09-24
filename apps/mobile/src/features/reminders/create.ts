/**
 * Reminder writes (M-REM-01): the in-app reminder is confirmed in the sheet (C-08) — a client id,
 * the local notification at once, then `POST /reminders` (API-REM-02, `channel:'local'`) through
 * the offline mutation queue (T-8.23): offline, the POST waits in the persisted queue and replays
 * on reconnect, idempotent on `client_reminder_id`. "Geri al" cancels the local notification and
 * either removes the still-queued POST (nothing reaches the server) or cancels the server row
 * (API-REM-03). Snooze uses the status RPCs.
 */
import { qk } from '@da/api-client';
import { onlineManager } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { translator } from '../../i18n/translate';
import { track } from '../../lib/events';
import {
  cancelLocalReminder,
  scheduleLocalReminder,
} from '../../lib/notifications/local-reminders';
import {
  cancelQueuedMutation,
  queueMutation,
  replayedReminderId,
  runOrQueue,
  type ReminderCreateBody,
} from '../../lib/offline/mutations';
import { rpc } from '../../lib/postgrest';
import { getQueryClient } from '../../lib/query/client';
import { showToast } from '../../providers/ToastHost';

export const REMINDER_UNDO_MS = 5_000;

export type ReminderPresetKey =
  'before_30m' | 'before_1h' | 'this_evening' | 'tomorrow_morning' | 'smart' | 'custom';

export type ReminderOrigin =
  | 'email_detail'
  | 'today'
  | 'deadline'
  | 'meeting'
  | 'commitment'
  | 'life_event'
  | 'followup'
  | 'assistant'
  | 'plan';

const SUBJECT_TYPES = new Set([
  'email_message',
  'email_thread',
  'calendar_event',
  'device_calendar_event',
  'task',
  'capture',
  'commitment',
  'life_event',
  'contact',
]);

export interface InAppReminder {
  readonly title: string;
  readonly preset: ReminderPresetKey;
  readonly fireAt: Date;
  readonly anchorAt: string | null;
  readonly timeLabel: string;
  readonly origin: ReminderOrigin;
  readonly subject: { readonly type: string; readonly id: string } | null;
  readonly deeplink: string | null;
  readonly mode: 'remind' | 'snooze';
  /** An existing scheduled reminder for the same target, replaced after success. */
  readonly replaces?: string | null;
}

function cancelServer(id: string): void {
  void runOrQueue('reminder_cancel', { id, reason: 'undo' }).catch(() => undefined);
}

/** Creates an in-app reminder; resolves once the local notification is scheduled. */
export async function createInAppReminder(reminder: InAppReminder): Promise<void> {
  const t = translator();
  const clientId = Crypto.randomUUID();
  const queued = !onlineManager.isOnline();
  await scheduleLocalReminder({
    clientReminderId: clientId,
    title: reminder.title,
    fireAt: reminder.fireAt,
    timeLabel: reminder.timeLabel,
    deeplink: reminder.deeplink,
  }).catch(() => undefined);
  const subject =
    reminder.subject !== null && SUBJECT_TYPES.has(reminder.subject.type)
      ? { subject: { type: reminder.subject.type, id: reminder.subject.id } }
      : {};
  const body = {
    client_reminder_id: clientId,
    title: reminder.title.slice(0, 200),
    preset: reminder.preset,
    fire_at: reminder.fireAt.toISOString(),
    ...(reminder.anchorAt === null ? {} : { anchor_at: reminder.anchorAt }),
    channel: 'local',
    ...subject,
    origin: reminder.origin,
  } as ReminderCreateBody;

  let serverId: string | null = null;
  let entryId: string | null = null;
  let undone = false;
  const replaces = reminder.replaces ?? null;
  void runOrQueue('reminder_create', { body }).then((result) => {
    if (result.status === 'saved') {
      serverId = (result.result as { id?: string } | null)?.id ?? null;
      if (undone && serverId !== null) cancelServer(serverId);
      if (!undone && replaces !== null) cancelServer(replaces);
      return;
    }
    if (result.status === 'queued') {
      entryId = result.entryId;
      // The replaced reminder is cancelled after the create, in the same (FIFO) scope.
      if (replaces !== null) queueMutation('reminder_cancel', { id: replaces, reason: 'undo' });
      if (!queued) showToast({ message: t('reminder.toasts.pendingSync'), kind: 'offline' });
      return;
    }
    showToast({ message: t('common.toast.saveFailed'), kind: 'error' });
  });
  track('reminder_created', {
    preset: reminder.preset,
    destination: 'in_app',
    mode: reminder.mode,
    queued,
  });
  showToast({
    message: queued
      ? t('reminder.toasts.queued', { when: reminder.timeLabel })
      : t('reminder.set', { when: reminder.timeLabel }),
    kind: queued ? 'offline' : 'success',
    durationMs: REMINDER_UNDO_MS,
    action: {
      label: t('common.actions.undo'),
      onPress: () => {
        undone = true;
        track('reminder_undo');
        void cancelLocalReminder(clientId).catch(() => undefined);
        // Still queued: drop it, so nothing reaches the server.
        if (entryId !== null && cancelQueuedMutation(entryId)) return;
        const id = serverId ?? replayedReminderId(clientId);
        if (id !== null) cancelServer(id);
        void getQueryClient().invalidateQueries({ queryKey: qk.reminders.all });
      },
    },
  });
}

export interface SnoozeRequest {
  readonly targetType: 'insight' | 'commitment';
  readonly targetId: string;
  readonly until: Date;
  readonly timeLabel: string;
  readonly notify: InAppReminder | null;
}

/** "Ertele · {time}": the status RPC, plus a reminder when "Zamanı gelince bildir" is on. */
export async function snooze(request: SnoozeRequest): Promise<boolean> {
  const t = translator();
  try {
    if (request.targetType === 'insight') {
      await rpc('set_insight_status', {
        p_insight_id: request.targetId,
        p_status: 'snoozed',
        p_snoozed_until: request.until.toISOString(),
      });
    } else {
      await rpc('set_commitment_status', {
        p_commitment_id: request.targetId,
        p_status: 'snoozed',
        p_due_at: request.until.toISOString(),
      });
    }
  } catch {
    showToast({ message: t('common.toast.saveFailed'), kind: 'error' });
    return false;
  }
  void getQueryClient().invalidateQueries({ queryKey: qk.today.all });
  void getQueryClient().invalidateQueries({ queryKey: qk.insights.all });
  if (request.notify !== null) {
    await createInAppReminder(request.notify);
    return true;
  }
  track('reminder_created', {
    preset: 'custom',
    destination: 'in_app',
    mode: 'snooze',
    queued: false,
  });
  showToast({
    message: t('reminder.toasts.snoozed', { when: request.timeLabel }),
    kind: 'success',
    durationMs: REMINDER_UNDO_MS,
    action: {
      label: t('common.actions.undo'),
      onPress: () => {
        track('reminder_undo');
        const revert =
          request.targetType === 'insight'
            ? rpc('set_insight_status', { p_insight_id: request.targetId, p_status: 'open' })
            : rpc('set_commitment_status', {
                p_commitment_id: request.targetId,
                p_status: 'open',
              });
        void revert
          .then(() => getQueryClient().invalidateQueries({ queryKey: qk.today.all }))
          .catch(() => {
            showToast({ message: t('common.toast.saveFailed'), kind: 'error' });
          });
      },
    },
  });
  return true;
}
