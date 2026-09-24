/**
 * User reminders (API-REM-02, JOB-18): a `push` reminder fires at the time the user chose — inside
 * quiet hours too (R-13 exception a) — as "Hatırlatıcı" / "{metin}" in `full` and "Şimdi
 * hatırlatmamı istediğin bir konu var." below it, on channel `reminders`, iOS time-sensitive. A
 * `local` reminder is scheduled by the device (`expo-notifications`), so the server sends nothing and
 * only records it as delivered. The reminder row becomes `delivered` or `failed` with the push.
 */
import { reminderKey, routes, toDeepLink } from '@da/domain';
import { baseSpec } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export async function reminderTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const id = ctx.payload.reminder_id;
  if (id === undefined) return skip('missing_reminder');
  const reminder = await ctx.repo.reminder(ctx.userId, id);
  if (reminder === null || reminder.status !== 'scheduled') return skip('not_scheduled');
  if (reminder.channel !== 'push') {
    return skip('device_local', (at) =>
      ctx.repo.setReminderStatus(ctx.userId, reminder.id, 'delivered', at));
  }
  return {
    kind: 'spec',
    spec: baseSpec({
      category: reminder.notification_category ?? 'deadline',
      dedupeKey: reminderKey(reminder.id),
      template: 'reminder',
      variant: 'local',
      urgency: 'today',
      kind: 'user_reminder',
      entityType: 'reminder',
      entityId: reminder.id,
      deeplink: toDeepLink(routes.today()),
      paramsSensitive: { text: reminder.title },
      scheduledFor: new Date(reminder.remind_at),
      priority: 80,
    }),
    onSent: (at) => ctx.repo.setReminderStatus(ctx.userId, reminder.id, 'delivered', at),
    onDropped: (_reason, at) => ctx.repo.setReminderStatus(ctx.userId, reminder.id, 'failed', at),
  };
}
