/**
 * Smart Reminders (IMPLEMENTATION_PLAN T-6.06; API-REM-01..03; M§29).
 *
 * - `resolveReminderTimes`: every requested preset → `{fire_at, label, reason_text, valid,
 *   invalid_reason}` with the domain rules (`packages/domain/reminders`) in the user's zone:
 *   anchor − 30 / 60 min, the evening / morning briefing times, "Uygun zamanda" = the first free
 *   slot ≥ the hint (min 15 min) inside working hours, before the anchor and never in quiet hours.
 * - `createReminder`: the row tap is the confirmation (C-08). The server re-resolves the preset and
 *   refuses a time that differs by more than 60 s (`STATE_CONFLICT {resolved_fire_at}`); the row is
 *   idempotent on `client_reminder_id`; a push reminder gets its scheduled ledger row and job.
 * - `cancelReminder`: `scheduled → cancelled`, the pending push job fails with CANCELLED.
 */
import {
  type BusyInterval,
  formatShortDate,
  type PresetResolution,
  type ReminderPreset,
  resolvePreset,
  type SourceType,
  verifyPresetTime,
} from '@da/domain';
import type { Reminder as ReminderView } from '@da/validation';
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';
import { AppError, fieldError, mapDbError } from '../errors.ts';
import { type ServerLocale, translate } from '../i18n/catalog.ts';
import { reminderCategory } from './approvals/execute/reminder-create.ts';

export interface ReminderPrefs {
  readonly timeZone: string;
  readonly morningTime: string;
  readonly eveningTime: string;
  readonly workingHours: { start: string; end: string; days: number[] };
  readonly quietHours: { enabled: boolean; start: string; end: string; days: number[] };
}

export interface ReminderRow {
  readonly id: string;
  readonly title: string;
  readonly preset: string;
  readonly remind_at: string;
  readonly channel: 'push' | 'local' | 'provider_task' | 'apple_reminders';
  readonly status: ReminderView['status'];
  readonly resolution_reason: string | null;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly source_type: SourceType | null;
  readonly source_id: string | null;
  readonly created_at: string;
}

export interface RemindersRepo {
  prefs(userId: string): Promise<ReminderPrefs>;
  /** Busy intervals of the user's selected calendars in [from, to). */
  busy(userId: string, from: Date, to: Date): Promise<BusyInterval[]>;
  hasCalendar(userId: string): Promise<boolean>;
  owns(userId: string, type: SourceType, id: string): Promise<boolean>;
  schedule(
    userId: string,
    row: Record<string, unknown>,
  ): Promise<{ created: boolean; reminder: ReminderRow }>;
  get(userId: string, id: string): Promise<ReminderRow | null>;
  cancel(userId: string, id: string, reason: 'user_cancel' | 'undo'): Promise<ReminderRow>;
}

export type ContractInvalidReason =
  'in_past' | 'after_anchor' | 'in_quiet_hours' | 'no_anchor' | 'no_free_slot';

export interface ResolvedOption {
  readonly preset: ReminderPreset;
  readonly fire_at: string | null;
  readonly label: string;
  readonly reason_text: string | null;
  readonly valid: boolean;
  readonly invalid_reason: ContractInvalidReason | null;
}

const SMART_HORIZON_MS = 14 * 86_400_000;

function presetContext(
  prefs: ReminderPrefs,
  now: Date,
  input: { anchorAt?: Date | null; customAt?: Date | null; durationMinutes?: number },
  busy: readonly BusyInterval[],
  calendarConnected: boolean,
) {
  return {
    now,
    timeZone: prefs.timeZone,
    anchorAt: input.anchorAt ?? null,
    customAt: input.customAt ?? null,
    durationMinutes: Math.max(15, input.durationMinutes ?? 15),
    busy,
    calendarConnected,
    prefs: {
      eveningTime: prefs.eveningTime,
      morningTime: prefs.morningTime,
      workingHours: prefs.workingHours,
      quietHours: prefs.quietHours,
    },
  };
}

function labelOf(r: PresetResolution, locale: ServerLocale, tz: string): string {
  const presetName = translate(locale, `reminder.presets.${r.preset}`);
  if (r.label === null || r.fireAt === null) return presetName;
  if (r.label.relativeDay === 'today') return r.label.time;
  if (r.label.relativeDay === 'tomorrow')
    return `${translate(locale, 'common.time.tomorrow')} ${r.label.time}`;
  return `${formatShortDate(r.fireAt, tz, locale)} ${r.label.time}`;
}

function invalidReason(r: PresetResolution): ContractInvalidReason | null {
  if (r.valid) return null;
  switch (r.invalidReason) {
    case 'in_past':
      return 'in_past';
    case 'no_anchor':
    case 'needs_input':
      return 'no_anchor';
    case 'no_free_slot':
    case 'no_calendar':
      return 'no_free_slot';
    case null:
      return null;
  }
}

export async function resolveReminderTimes(
  repo: RemindersRepo,
  input: {
    userId: string;
    presets: readonly ReminderPreset[];
    anchorAt?: string | undefined;
    customAt?: string | undefined;
    durationMinutes: number;
    now: Date;
    locale: ServerLocale;
  },
): Promise<ResolvedOption[]> {
  const prefs = await repo.prefs(input.userId);
  const anchor = input.anchorAt === undefined ? null : new Date(input.anchorAt);
  const needsCalendar = input.presets.includes('smart');
  const until = anchor ?? new Date(input.now.getTime() + SMART_HORIZON_MS);
  const [busy, calendarConnected] = needsCalendar
    ? await Promise.all([repo.busy(input.userId, input.now, until), repo.hasCalendar(input.userId)])
    : [[], true];
  const ctx = presetContext(
    prefs,
    input.now,
    {
      anchorAt: anchor,
      customAt: input.customAt === undefined ? null : new Date(input.customAt),
      durationMinutes: input.durationMinutes,
    },
    busy,
    calendarConnected,
  );
  return input.presets.map((preset) => {
    const r = resolvePreset(preset, ctx);
    let valid = r.valid;
    let reason = invalidReason(r);
    if (valid && anchor !== null && r.fireAt !== null && r.fireAt.getTime() > anchor.getTime()) {
      valid = false;
      reason = 'after_anchor';
    }
    return {
      preset,
      fire_at: r.fireAt === null ? null : r.fireAt.toISOString(),
      label: labelOf(r, input.locale, prefs.timeZone),
      reason_text:
        preset === 'smart' && r.valid && r.label !== null
          ? translate(input.locale, 'reminder.smart.resolved', { time: r.label.time })
          : null,
      valid,
      invalid_reason: reason,
    };
  });
}

export function toReminderView(row: ReminderRow, timeZone: string): ReminderView {
  const subject =
    row.target_type !== null &&
    row.target_id !== null &&
    row.source_type !== null &&
    row.source_type !== 'user_input'
      ? { type: row.source_type, id: row.source_id ?? row.target_id }
      : row.source_type !== null &&
          row.source_type !== 'user_input' &&
          row.source_id !== null &&
          /^[0-9a-f-]{36}$/i.test(row.source_id)
        ? { type: row.source_type, id: row.source_id }
        : null;
  return {
    id: row.id,
    title: row.title,
    preset: row.preset,
    fire_at: new Date(row.remind_at).toISOString(),
    time_zone: timeZone,
    channel: row.channel === 'push' ? 'push' : 'local',
    status: row.status,
    reason_text: row.resolution_reason,
    subject,
    created_at: new Date(row.created_at).toISOString(),
  };
}

const TARGET_TYPES = new Set([
  'email_thread',
  'commitment',
  'life_event',
  'calendar_event',
  'capture',
  'task',
]);

export interface CreateReminderInput {
  readonly userId: string;
  readonly clientReminderId: string;
  readonly title: string;
  readonly preset: ReminderPreset;
  readonly fireAt: string;
  readonly anchorAt?: string | undefined;
  readonly channel: 'push' | 'local';
  readonly subject?: { type: SourceType; id: string } | undefined;
  readonly origin: string;
  readonly now: Date;
  readonly locale: ServerLocale;
  readonly correlationId: string | null;
}

export async function createReminder(
  repo: RemindersRepo,
  input: CreateReminderInput,
): Promise<{ created: boolean; view: ReminderView }> {
  const prefs = await repo.prefs(input.userId);
  const fireAt = new Date(input.fireAt);
  if (fireAt.getTime() <= input.now.getTime() + 60_000) throw fieldError('fire_at', 'too_soon');
  if (
    input.subject !== undefined &&
    !(await repo.owns(input.userId, input.subject.type, input.subject.id))
  ) {
    throw new AppError('NOT_FOUND', { details: { resource: 'subject' } });
  }
  const anchor = input.anchorAt === undefined ? null : new Date(input.anchorAt);
  const busy =
    input.preset === 'smart'
      ? await repo.busy(
          input.userId,
          input.now,
          anchor ?? new Date(input.now.getTime() + SMART_HORIZON_MS),
        )
      : [];
  const ctx = presetContext(prefs, input.now, { anchorAt: anchor }, busy, true);
  const check = verifyPresetTime(input.preset, fireAt, ctx);
  if (!check.ok) {
    throw new AppError('STATE_CONFLICT', {
      details: {
        reason: 'fire_at_mismatch',
        resolved_fire_at: check.resolvedFireAt === null ? null : check.resolvedFireAt.toISOString(),
      },
    });
  }
  const resolution = resolvePreset(input.preset, { ...ctx, customAt: fireAt });
  const reason =
    input.preset === 'smart' && resolution.label !== null
      ? translate(input.locale, 'reminder.smart.resolved', { time: resolution.label.time })
      : null;
  const subjectType = input.subject?.type ?? null;
  const result = await repo.schedule(input.userId, {
    title: input.title,
    remind_at: fireAt.toISOString(),
    preset: input.preset,
    anchor_at: anchor === null ? null : anchor.toISOString(),
    destination: { kind: 'in_app' },
    origin: input.origin,
    resolution_reason: reason,
    channel: input.channel,
    target_type: subjectType !== null && TARGET_TYPES.has(subjectType) ? subjectType : null,
    target_id:
      subjectType !== null && TARGET_TYPES.has(subjectType) ? (input.subject?.id ?? null) : null,
    idempotency_key: input.clientReminderId,
    source_type: input.subject?.type ?? 'user_input',
    source_id: input.subject?.id ?? input.userId,
    source_timestamp: input.now.toISOString(),
    category: reminderCategory(subjectType),
    correlation_id: input.correlationId,
  });
  return { created: result.created, view: toReminderView(result.reminder, prefs.timeZone) };
}

export async function cancelReminder(
  repo: RemindersRepo,
  input: { userId: string; id: string; reason: 'user_cancel' | 'undo' },
): Promise<ReminderView> {
  const [prefs, row] = await Promise.all([
    repo.prefs(input.userId),
    repo.cancel(input.userId, input.id, input.reason),
  ]);
  return toReminderView(row, prefs.timeZone);
}

// ── Supabase repository ──────────────────────────────────────────────────────

const REMINDER_COLUMNS =
  'id,title,preset,remind_at,channel,status,resolution_reason,target_type,target_id,source_type,source_id,created_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hhmm(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : fallback;
}

const OWNED: Readonly<Partial<Record<SourceType, string>>> = {
  email_message: 'email_messages',
  email_thread: 'email_threads',
  calendar_event: 'calendar_events',
  device_calendar_event: 'calendar_events',
  task: 'tasks',
  capture: 'captures',
  meeting_note: 'meeting_notes',
  post_meeting_note: 'meeting_notes',
  commitment: 'commitments',
  life_event: 'life_events',
  contact: 'contacts',
  briefing: 'briefings',
  assistant_message: 'assistant_messages',
  android_notification: 'android_notification_signals',
};

export function supabaseRemindersRepo(system: DbClient): RemindersRepo {
  const one = async <T>(
    query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  ) => {
    const { data, error } = await query;
    if (error !== null) throw mapDbError(error);
    return (data ?? null) as T | null;
  };
  return {
    async prefs(userId) {
      const [u, n] = await Promise.all([
        one<Record<string, unknown>>(
          system
            .from('user_preferences')
            .select(
              'timezone,morning_time,evening_time,working_hours_start,working_hours_end,work_days',
            )
            .eq('user_id', userId)
            .maybeSingle(),
        ),
        one<Record<string, unknown>>(
          system
            .from('notification_preferences')
            .select('quiet_hours_enabled,quiet_start,quiet_end,quiet_days')
            .eq('user_id', userId)
            .maybeSingle(),
        ),
      ]);
      return {
        timeZone: typeof u?.timezone === 'string' ? u.timezone : 'Europe/Istanbul',
        morningTime: hhmm(u?.morning_time, '08:00'),
        eveningTime: hhmm(u?.evening_time, '19:00'),
        workingHours: {
          start: hhmm(u?.working_hours_start, '09:00'),
          end: hhmm(u?.working_hours_end, '18:00'),
          days: Array.isArray(u?.work_days) ? (u.work_days as number[]) : [1, 2, 3, 4, 5],
        },
        quietHours: {
          enabled: n?.quiet_hours_enabled !== false,
          start: hhmm(n?.quiet_start, '22:30'),
          end: hhmm(n?.quiet_end, '07:30'),
          days: Array.isArray(n?.quiet_days) ? (n.quiet_days as number[]) : [1, 2, 3, 4, 5, 6, 7],
        },
      };
    },
    async busy(userId, from, to) {
      const rows =
        (await one<
          {
            start_at: string;
            end_at: string;
            all_day: boolean;
            status: string;
            calendars: { selected: boolean };
          }[]
        >(
          system
            .from('calendar_events')
            .select('start_at,end_at,all_day,status,calendars!inner(selected)')
            .eq('user_id', userId)
            .eq('calendars.selected', true)
            .neq('status', 'cancelled')
            .is('provider_deleted_at', null)
            .lt('start_at', to.toISOString())
            .gt('end_at', from.toISOString())
            .limit(500),
        )) ?? [];
      return rows.map((r) => ({
        start: r.start_at,
        end: r.end_at,
        allDay: r.all_day,
        cancelled: r.status === 'cancelled',
      }));
    },
    async hasCalendar(userId) {
      const { count, error } = await system
        .from('calendars')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('selected', true);
      if (error !== null) throw mapDbError(error);
      return (count ?? 0) > 0;
    },
    async owns(userId, type, id) {
      const table = OWNED[type];
      if (table === undefined) return type === 'user_input';
      return (
        (await one(
          system.from(table).select('id').eq('id', id).eq('user_id', userId).maybeSingle(),
        )) !== null
      );
    },
    schedule(userId, row) {
      const payload = { ...row };
      if (typeof payload.correlation_id !== 'string' || !UUID_RE.test(payload.correlation_id)) {
        delete payload.correlation_id;
      }
      return rpc<{ created: boolean; reminder: ReminderRow }>(system, DB_FN.scheduleReminder, {
        p_user: userId,
        p_row: payload,
      });
    },
    get(userId, id) {
      return one<ReminderRow>(
        system
          .from('reminders')
          .select(REMINDER_COLUMNS)
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    cancel(userId, id, reason) {
      return rpc<ReminderRow>(system, DB_FN.cancelReminder, {
        p_user: userId,
        p_id: id,
        p_reason: reason,
      });
    },
  };
}
