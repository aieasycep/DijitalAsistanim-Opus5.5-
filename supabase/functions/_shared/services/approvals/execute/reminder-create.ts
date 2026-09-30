/**
 * `reminder_create` execution (IMPLEMENTATION_PLAN T-6.04): an in-app `reminders` row with key
 * `approval:{id}` through `schedule_reminder` — the device schedules it (`local`) or the server
 * pushes it at `fire_at` (`push`). Apple Reminders targets run on the device (T-6.05). A retry
 * finds the existing row and schedules nothing twice.
 */
import type { SourceType } from '@da/domain';
import type { Json } from '../../../jobs/types.ts';
import type { ApprovalOriginValue } from '../model.ts';
import { insightRefresh } from './common.ts';
import { type ExecEnv, ExecutionFailure, type ExecOutcome } from './model.ts';

const REMINDER_ORIGIN: Readonly<Partial<Record<ApprovalOriginValue, string>>> = {
  email_detail: 'email_detail',
  follow_up: 'followup',
  assistant: 'assistant',
  voice: 'assistant',
  plan_proposal: 'plan',
  conflict_resolution: 'plan',
  life_event: 'life_event',
  commitment_detection: 'commitment',
  post_meeting: 'meeting',
};

/** reminders.target_type for a subject type (DB §4.3 check list). */
const TARGET_TYPE: Readonly<Partial<Record<SourceType, string>>> = {
  email_thread: 'email_thread',
  commitment: 'commitment',
  life_event: 'life_event',
  calendar_event: 'calendar_event',
  device_calendar_event: 'calendar_event',
  capture: 'capture',
  task: 'task',
};

/** Push category from the subject (API-REM-02). */
export function reminderCategory(
  subject: SourceType | null,
): 'deadline' | 'follow_up' | 'meeting' | 'life_intel' {
  switch (subject) {
    case 'calendar_event':
    case 'device_calendar_event':
      return 'meeting';
    case 'life_event':
      return 'life_intel';
    case 'email_thread':
    case 'email_message':
      return 'follow_up';
    default:
      return 'deadline';
  }
}

export async function executeReminderCreate(env: ExecEnv): Promise<ExecOutcome> {
  const approval = env.approval;
  const payload = approval.payload;
  if (payload.action_type !== 'reminder_create' || payload.destination.kind !== 'in_app') {
    throw new ExecutionFailure('PROVIDER_REJECTED', false, null, 'not_a_server_target');
  }
  const subjectType = payload.subject?.type ?? null;
  const row: Record<string, Json> = {
    title: payload.title,
    remind_at: new Date(payload.fire_at).toISOString(),
    preset: payload.preset,
    anchor_at: payload.anchor_at === undefined ? null : new Date(payload.anchor_at).toISOString(),
    destination: { kind: 'in_app' },
    origin: REMINDER_ORIGIN[approval.origin] ?? 'today',
    resolution_reason: payload.reason_text ?? null,
    channel: payload.destination.channel,
    target_type: subjectType === null ? null : (TARGET_TYPE[subjectType] ?? null),
    target_id: payload.subject?.id ?? null,
    idempotency_key: `approval:${approval.id}`,
    approval_action_id: approval.id,
    source_type: payload.subject?.type ?? approval.source_type,
    source_id: payload.subject?.id ?? approval.source_id,
    source_provider: approval.source_provider,
    source_timestamp: approval.source_timestamp,
    confidence: approval.confidence,
    category: reminderCategory(subjectType),
    correlation_id: env.correlationId,
  };
  const reminder = await env.repo.scheduleReminder(approval.user_id, row);
  return {
    providerRef: `reminder:${reminder.id}`,
    result: { target: 'in_app', reminder_id: reminder.id, already_existed: !reminder.created },
    followUps: [insightRefresh(approval.user_id, 'all')],
  };
}
