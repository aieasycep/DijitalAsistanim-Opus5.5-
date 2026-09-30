/**
 * Capture actions (IMPLEMENTATION_PLAN T-5.13; API-CAP-04; SREQ-33/46): selected items become
 * approval payloads — event → `calendar_create`, deadline / payment → `reminder_create`, task →
 * `task_create`, a promise → `commitment_create` — built from the verified item fields plus the
 * user's overrides and the chosen destination, then validated with the action type's
 * `ApprovalPayload` schema. The route proposes them in one batch (`batch_id = capture_id`).
 */
import { APPROVAL_PAYLOAD_SCHEMAS, type ApprovalPayload } from '@da/validation';
import { AppError } from '../../errors.ts';
import type { WritableCalendar } from '../assist/store.ts';
import { clip } from '../copy.ts';
import type { CaptureItemView } from './extract.ts';

export type CaptureActionType =
  'calendar_create' | 'task_create' | 'reminder_create' | 'commitment_create';

const HOUR = 3_600_000;

function iso(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

function localDay(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

export function basePayload(
  item: CaptureItemView,
  type: CaptureActionType,
  ctx: {
    readonly now: Date;
    readonly timeZone: string;
    readonly calendar: WritableCalendar | null;
    readonly captureId: string;
    readonly capturedAt: string;
  },
): Record<string, unknown> {
  const f = item.fields;
  const title = clip(item.title, 200);
  switch (type) {
    case 'calendar_create': {
      const start = iso(f.start_at);
      const target =
        ctx.calendar === null
          ? undefined
          : {
              kind: 'provider',
              connected_account_id: ctx.calendar.connected_account_id,
              calendar_id: ctx.calendar.id,
            };
      const time =
        start === null
          ? undefined
          : f.start_precision === 'datetime'
            ? {
                kind: 'timed',
                start,
                end: iso(f.start_end_at) ?? new Date(Date.parse(start) + HOUR).toISOString(),
                time_zone: ctx.timeZone,
              }
            : {
                kind: 'all_day',
                start_date: localDay(start, ctx.timeZone),
                end_date: localDay(
                  new Date(Date.parse(start) + 24 * HOUR).toISOString(),
                  ctx.timeZone,
                ),
              };
      return {
        action_type: 'calendar_create',
        ...(target === undefined ? {} : { target }),
        title: clip(item.title, 300),
        ...(typeof f.place === 'string' ? { location: clip(f.place, 500) } : {}),
        ...(time === undefined ? {} : { time }),
        attendees: [],
        reminders_minutes: [],
        origin_task_ref: {
          type: 'capture_item',
          id: `${ctx.captureId}:${item.item_id}`.slice(0, 80),
        },
      };
    }
    case 'task_create': {
      const due = iso(f.due_at);
      return {
        action_type: 'task_create',
        target: { kind: 'in_app' },
        title: clip(item.title, 1024),
        ...(due === null
          ? {}
          : f.due_precision === 'datetime'
            ? { due: { kind: 'date_time', at: due, time_zone: ctx.timeZone } }
            : { due: { kind: 'date', date: localDay(due, ctx.timeZone) } }),
      };
    }
    case 'reminder_create': {
      const due = iso(f.due_at) ?? iso(f.start_at);
      const anchor = due === null ? null : Date.parse(due);
      const soon = ctx.now.getTime() + 5 * 60_000;
      const fire = anchor === null ? null : Math.max(soon, anchor - 24 * HOUR);
      return {
        action_type: 'reminder_create',
        destination: { kind: 'in_app', channel: 'push' },
        title,
        preset: 'custom',
        ...(fire === null ? {} : { fire_at: new Date(fire).toISOString() }),
        ...(anchor !== null && fire !== null && fire <= anchor
          ? { anchor_at: new Date(anchor).toISOString() }
          : {}),
        time_zone: ctx.timeZone,
      };
    }
    case 'commitment_create': {
      const due = iso(f.due_at);
      const source = {
        source_type: 'capture',
        source_id: ctx.captureId,
        source_provider: 'in_app',
        source_timestamp: new Date(ctx.capturedAt).toISOString(),
      };
      const quote = item.evidence[0]?.quote ?? item.title;
      return {
        action_type: 'commitment_create',
        text: clip(item.title, 500),
        direction: 'user_owes',
        counterparty: { name: clip(typeof f.name === 'string' ? f.name : item.title, 200) },
        due_at: due,
        due_precision: due === null ? 'none' : f.due_precision === 'datetime' ? 'datetime' : 'date',
        source,
        evidence: { quote: clip(quote, 300), source },
        confidence: item.confidence,
      };
    }
  }
}

/** Item fields + overrides + destination → the validated payload (`VALIDATION_FAILED` otherwise). */
export function capturePayload(
  item: CaptureItemView,
  request: {
    action_type: CaptureActionType;
    overrides?: Record<string, unknown> | undefined;
    destination?: unknown;
  },
  ctx: Parameters<typeof basePayload>[2],
): ApprovalPayload {
  const base = basePayload(item, request.action_type, ctx);
  const destination =
    request.destination === undefined || request.destination === null
      ? {}
      : request.action_type === 'calendar_create' || request.action_type === 'task_create'
        ? { target: request.destination }
        : request.action_type === 'reminder_create'
          ? { destination: request.destination }
          : {};
  const merged = {
    ...base,
    ...destination,
    ...(request.overrides ?? {}),
    action_type: request.action_type,
  };
  const parsed = APPROVAL_PAYLOAD_SCHEMAS[request.action_type].safeParse(merged);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'capture_item_payload', item_id: item.item_id },
      fieldErrors: parsed.error.issues.slice(0, 5).map((i) => ({
        path: `items.${item.item_id}.${i.path.join('.')}`,
        code: 'invalid_value',
        message_key: 'validation.invalid_value',
      })),
    });
  }
  return parsed.data as ApprovalPayload;
}
