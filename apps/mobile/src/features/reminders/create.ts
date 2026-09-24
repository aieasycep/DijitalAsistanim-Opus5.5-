/**
 * Reminder writes (M-REM-01): the in-app reminder is confirmed in the sheet (C-08) — a client id,
 * the local notification at once, then `POST /reminders` (API-REM-02, `channel:'local'`); offline
 * the POST waits for the connection (idempotent on `client_reminder_id`). "Geri al" cancels both
 * the local notification and the server row (API-REM-03). Snooze uses the status RPCs.
 */
import { qk, isApiError } from '@da/api-client';
import { reminderCancelMutationOptions, reminderCreateMutationOptions } from '@da/api-client/react';
import { onlineManager } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { translator } from '../../i18n/translate';
import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { rpc } from '../../lib/postgrest';
import { getQueryClient } from '../../lib/query/client';
import { runMutation } from '../../lib/query/run-mutation';
import { showToast } from '../../providers/ToastHost';
import { cancelLocalReminder, scheduleLocalReminder } from './local';

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

function whenOnline(run: () => void): void {
  if (onlineManager.isOnline()) {
    run();
    return;
  }
  const unsubscribe = onlineManager.subscribe((online) => {
    if (!online) return;
    unsubscribe();
    run();
  });
}

async function cancelServer(id: string): Promise<void> {
  await runMutation(reminderCancelMutationOptions(getApiClient()), {
    input: { params: { id }, body: { reason: 'undo' } },
    idempotencyKey: Crypto.randomUUID(),
  });
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
  let serverId: string | null = null;
  let undone = false;
  const post = () => {
    if (undone) return;
    const subject =
      reminder.subject !== null && SUBJECT_TYPES.has(reminder.subject.type)
        ? { subject: { type: reminder.subject.type, id: reminder.subject.id } }
        : {};
    void runMutation(reminderCreateMutationOptions(getApiClient()), {
      body: {
        client_reminder_id: clientId,
        title: reminder.title.slice(0, 200),
        preset: reminder.preset,
        fire_at: reminder.fireAt.toISOString(),
        ...(reminder.anchorAt === null ? {} : { anchor_at: reminder.anchorAt }),
        channel: 'local',
        ...subject,
        origin: reminder.origin,
      } as never,
    })
      .then((created) => {
        serverId = created.id;
        if (undone) void cancelServer(created.id);
        if (reminder.replaces !== undefined && reminder.replaces !== null) {
          void cancelServer(reminder.replaces).catch(() => undefined);
        }
        void getQueryClient().invalidateQueries({ queryKey: qk.reminders.all });
      })
      .catch((error: unknown) => {
        // A replay of the same client id is a success (API-REM-02 idempotency).
        if (isApiError(error) && error.code === 'IDEMPOTENCY_REPLAY') return;
        if (isApiError(error) && (error.kind === 'network' || error.kind === 'offline')) {
          whenOnline(post);
          showToast({ message: t('reminder.toasts.pendingSync'), kind: 'offline' });
          return;
        }
        showToast({ message: t('common.toast.saveFailed'), kind: 'error' });
      });
  };
  whenOnline(post);
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
        if (serverId !== null) void cancelServer(serverId).catch(() => undefined);
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
