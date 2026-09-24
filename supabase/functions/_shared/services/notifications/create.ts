/**
 * Producing notifications (API_CONTRACTS JOB-18 `NotificationPayload`). Producers enqueue a
 * `notification` job in one of two forms:
 *
 * - **build**: `{user_id, build:{category, dedupe_key, entity, deeplink, template_key, params_public,
 *   params_sensitive, urgency, time_sensitive, vip}}` — the documented contract used by briefings,
 *   insights, billing and account events. `template_key` is `<template>.<variant>` of the `push`
 *   catalog (e.g. `critical_email.reply_needed`, `weekly.ready`).
 * - **trigger**: ids only (`{trigger, …_id}`), resolved against fresh data when the job runs: the
 *   scheduler's meeting-prep, post-meeting, reminder and nudge jobs, approval expiry / failure, trial
 *   ending, briefing delivered and the test pushes.
 *
 * A deferred send (quiet hours, snooze, not yet due) re-enqueues the same payload with the ledger
 * row's `notification_id`.
 */
import {
  NOTIFICATION_CATEGORY_VALUES,
  type NotificationCategory,
  notificationJobKey,
  type PushTemplate,
  SOURCE_TYPE_VALUES,
  URGENCY_VALUES,
} from '@da/domain';
import { z } from 'zod';
import { hasMessage } from '../../i18n/catalog.ts';
import type { EnqueueInput, Json } from '../../jobs/types.ts';
import type { NotificationSpec } from './model.ts';

const Uuid = z.uuid();
const Params = z.record(z.string(), z.union([z.string().max(200), z.number()]));

export const NotificationBuild = z.object({
  category: z.enum(NOTIFICATION_CATEGORY_VALUES),
  dedupe_key: z.string().min(1).max(200),
  entity: z.object({ type: z.enum(SOURCE_TYPE_VALUES), id: Uuid }).nullable(),
  deeplink: z.string().max(200),
  template_key: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .max(80),
  params_public: Params.default({}),
  params_sensitive: z.record(z.string(), z.string().max(300)).default({}),
  urgency: z.enum(URGENCY_VALUES),
  time_sensitive: z.boolean().default(false),
  vip: z.boolean().default(false),
  /** Per-VIP quiet-hours override (`vip_people.bypass_quiet_hours`); defaults to on. */
  vip_bypass_quiet: z.boolean().optional(),
  /** Intended delivery time (e.g. a trial reminder 24 h before expiry). */
  scheduled_for: z.iso.datetime({ offset: true }).optional(),
  /** After this instant the push is stale and is suppressed. */
  valid_until: z.iso.datetime({ offset: true }).optional(),
  /** `life_intel` sourced from an Android notification signal (channel `phone_digest`). */
  from_android_signal: z.boolean().optional(),
});
export type NotificationBuild = z.infer<typeof NotificationBuild>;

export const NOTIFICATION_TRIGGERS = [
  'meeting_prep',
  'post_meeting',
  'reminder',
  'nudge',
  'approval_expiring',
  'approval_result',
  'trial_ending',
  'briefing',
  'user_test',
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

/** `notification` job payload: the documented build form, the trigger forms and the admin test. */
export const NotificationJobPayload = z
  .object({
    user_id: Uuid.optional(),
    notification_id: Uuid.optional(),
    build: NotificationBuild.optional(),
    trigger: z.enum(NOTIFICATION_TRIGGERS).optional(),
    category: z.enum(NOTIFICATION_CATEGORY_VALUES).optional(),
    event_id: Uuid.optional(),
    reminder_id: Uuid.optional(),
    insight_id: Uuid.optional(),
    approval_id: Uuid.optional(),
    briefing_id: Uuid.optional(),
    /** `app_installations.id` for pushes to one installation (test pushes). */
    installation_id: Uuid.nullable().optional(),
    /** Admin test push (`admin_api.notification_send_test`, R-13). */
    kind: z.literal('test').optional(),
    detail_mode: z.literal('generic').optional(),
    bypass_caps: z.boolean().optional(),
    bypass_quiet_hours: z.literal(false).optional(),
    admin_id: Uuid.optional(),
  })
  .superRefine((p, ctx) => {
    const forms = [p.build !== undefined, p.trigger !== undefined, p.kind === 'test'].filter(
      Boolean,
    ).length;
    if (forms !== 1) {
      ctx.addIssue({ code: 'custom', path: [], message: 'exactly_one_payload_form' });
    }
    if (
      p.build !== undefined &&
      !hasMessage(templateKeyPath(p.build.template_key, 'title_only', 'title'))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['build', 'template_key'],
        message: 'unknown_template',
      });
    }
    if (
      p.build !== undefined &&
      p.build.template_key.startsWith('weekly.') &&
      p.build.category !== 'evening'
    ) {
      ctx.addIssue({ code: 'custom', path: ['build', 'category'], message: 'weekly_uses_evening' });
    }
  });
export type NotificationJobPayload = z.infer<typeof NotificationJobPayload>;

const TEMPLATES = new Set<string>([...NOTIFICATION_CATEGORY_VALUES, 'weekly', 'reminder']);

/** `push.<template>.<variant>.<mode>.<part>`. */
export function templateKeyPath(templateKey: string, mode: string, part: 'title' | 'body'): string {
  return `push.${templateKey}.${mode}.${part}`;
}

export function parseTemplateKey(templateKey: string): { template: PushTemplate; variant: string } {
  const [template, variant] = templateKey.split('.');
  if (template === undefined || variant === undefined || !TEMPLATES.has(template)) {
    throw new RangeError(`unknown_template:${templateKey}`);
  }
  return { template: template as PushTemplate, variant };
}

const PRIORITY: Readonly<Record<string, number>> = { urgent: 90, today: 70, normal: 50, low: 20 };

/** The spec of a documented `build` payload. */
export function specFromBuild(build: NotificationBuild): NotificationSpec {
  const { template, variant } = parseTemplateKey(build.template_key);
  return {
    category: build.category,
    dedupeKey: build.dedupe_key,
    template,
    variant,
    entityType: build.entity?.type ?? null,
    entityId: build.entity?.id ?? null,
    deeplink: build.deeplink,
    paramsPublic: build.params_public,
    paramsSensitive: build.params_sensitive,
    urgency: build.urgency,
    kind: 'standard',
    scheduledFor: build.scheduled_for === undefined ? null : new Date(build.scheduled_for),
    validUntil: build.valid_until === undefined ? null : new Date(build.valid_until),
    relevant: true,
    entitled: true,
    vip: build.vip ? { isVip: true, bypassQuietHours: build.vip_bypass_quiet ?? true } : null,
    interruption: build.time_sensitive ? 'time_sensitive' : null,
    minutesToStart: null,
    approvalExpiringSoon: false,
    fromAndroidSignal: build.from_android_signal === true,
    installationRowId: null,
    isTest: false,
    userTest: false,
    sound: true,
    priority: PRIORITY[build.urgency] ?? 50,
  };
}

/** Defaults for trigger-built specs. */
export function baseSpec(
  input: Pick<NotificationSpec, 'category' | 'dedupeKey' | 'template' | 'variant' | 'urgency'> &
    Partial<NotificationSpec>,
): NotificationSpec {
  return {
    entityType: null,
    entityId: null,
    deeplink: null,
    paramsPublic: {},
    paramsSensitive: {},
    kind: 'standard',
    scheduledFor: null,
    validUntil: null,
    relevant: true,
    entitled: true,
    vip: null,
    interruption: null,
    minutesToStart: null,
    approvalExpiringSoon: false,
    fromAndroidSignal: false,
    installationRowId: null,
    isTest: false,
    userTest: false,
    sound: true,
    priority: PRIORITY[input.urgency] ?? 50,
    ...input,
  };
}

/**
 * The `notification` job for a documented build (other modules call this): idempotency key
 * `notif:{user}:{dedupe_key}` (hashed when longer than the 200-char key column).
 */
export function notificationBuildJob(
  userId: string,
  build: NotificationBuild,
  options: { runAfter?: Date; priority?: number } = {},
): EnqueueInput {
  const key = notificationJobKey(userId, build.dedupe_key);
  return {
    type: 'notification',
    idempotencyKey: key.length <= 200 ? key : key.slice(0, 200),
    payload: { user_id: userId, build: build as unknown as Json },
    userId,
    ...(options.runAfter === undefined ? {} : { runAfter: options.runAfter }),
    priority: options.priority ?? 50,
    maxAttempts: 5,
  };
}

/** A trigger job (ids only). */
export function notificationTriggerJob(
  userId: string,
  key: string,
  payload: Record<string, Json>,
  options: { runAfter?: Date; priority?: number } = {},
): EnqueueInput {
  return {
    type: 'notification',
    idempotencyKey: key.slice(0, 200),
    payload: { user_id: userId, ...payload },
    userId,
    ...(options.runAfter === undefined ? {} : { runAfter: options.runAfter }),
    priority: options.priority ?? 50,
    maxAttempts: 5,
  };
}

export function isCategory(value: string): value is NotificationCategory {
  return (NOTIFICATION_CATEGORY_VALUES as readonly string[]).includes(value);
}
