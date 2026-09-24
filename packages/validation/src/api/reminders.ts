import { z } from 'zod';
import { EntityRefInput, IsoDateTime, Reminder, ReminderPreset, Uuid } from './common.ts';
import { Success } from './envelope.ts';

// API-REM-01 · POST /reminders/resolve-time
export const ResolveTimeBody = z
  .strictObject({
    presets: z.array(ReminderPreset).min(1).max(6),
    anchor_at: IsoDateTime.optional(),
    custom_at: IsoDateTime.optional(),
    duration_minutes_hint: z.int().min(5).max(240).default(15),
  })
  .superRefine((body, ctx) => {
    const needsAnchor = body.presets.some((p) => p === 'before_30m' || p === 'before_1h');
    if (needsAnchor && body.anchor_at === undefined) {
      ctx.addIssue({ code: 'custom', path: ['anchor_at'], message: 'anchor_required' });
    }
    if (body.presets.includes('custom') && body.custom_at === undefined) {
      ctx.addIssue({ code: 'custom', path: ['custom_at'], message: 'custom_at_required' });
    }
    if (new Set(body.presets).size !== body.presets.length) {
      ctx.addIssue({ code: 'custom', path: ['presets'], message: 'duplicate_preset' });
    }
  });
export const ResolveTimeOption = z.object({
  preset: z.string(),
  fire_at: IsoDateTime.nullable(),
  label: z.string(),
  reason_text: z.string().nullable(),
  valid: z.boolean(),
  invalid_reason: z
    .enum(['in_past', 'after_anchor', 'in_quiet_hours', 'no_anchor', 'no_free_slot'])
    .nullable(),
});
export const ResolveTimeResponse = Success(z.object({ options: z.array(ResolveTimeOption) }));

// API-REM-02 · POST /reminders
export const ReminderOrigin = z.enum([
  'email_detail',
  'today',
  'deadline',
  'meeting',
  'commitment',
  'life_event',
  'followup',
  'assistant',
  'plan',
]);
export const ReminderCreateBody = z
  .strictObject({
    client_reminder_id: Uuid,
    title: z.string().min(1).max(200),
    preset: ReminderPreset,
    fire_at: IsoDateTime,
    anchor_at: IsoDateTime.optional(),
    channel: z.enum(['push', 'local']).default('push'),
    subject: EntityRefInput.optional(),
    origin: ReminderOrigin,
  })
  .superRefine((body, ctx) => {
    if (
      (body.preset === 'before_30m' || body.preset === 'before_1h') &&
      body.anchor_at === undefined
    ) {
      ctx.addIssue({ code: 'custom', path: ['anchor_at'], message: 'anchor_required' });
    }
  });
export const ReminderResponse = Success(Reminder);

// API-REM-03 · POST /reminders/:id/cancel
export const ReminderIdParams = z.strictObject({ id: Uuid });
export const ReminderCancelBody = z.strictObject({
  reason: z.enum(['user_cancel', 'undo']).default('user_cancel'),
});
