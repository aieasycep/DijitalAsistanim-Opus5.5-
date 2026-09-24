/**
 * Smart Reminder presets in master order (M§29; S-04; API-REM-01; TEST_PLAN §2.7):
 *
 *   before_30m · before_1h · this_evening · tomorrow_morning · smart ("Uygun zamanda") · custom
 *
 * Each resolves to an absolute instant in the user's zone plus a reason (an i18n reference, e.g.
 * `reminder.reason.calendar_slot` → "Takvimine göre: 12:10"). "Bu akşam" is the evening time,
 * "Yarın sabah" the morning briefing time (D-17: 08:00 default). "Uygun zamanda" is the first free
 * slot of ≥15 min inside working hours, before the due time, never in quiet hours.
 */
import {
  type BusyInterval,
  firstFreeSlot,
  type QuietHoursSpec,
  type WorkingHours,
} from '../calendar/slots.ts';
import type { ReminderPreset } from '../entities/content.ts';
import { type MessageRef, messageRef } from '../entities/message.ts';
import {
  addDaysToLocalDate,
  atLocalTime,
  type Instant,
  isWithinQuietHours,
  localDate,
  localTime,
  type LocalTimeString,
  toDate,
} from '../time/zone.ts';

/** The six presets in master order (no `next_week`). */
export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  'before_30m',
  'before_1h',
  'this_evening',
  'tomorrow_morning',
  'smart',
  'custom',
];

export type PresetInvalidReason =
  'in_past' | 'no_anchor' | 'no_free_slot' | 'no_calendar' | 'needs_input';

export interface PresetPrefs {
  /** `user_preferences.evening_time` (default 19:00). */
  readonly eveningTime?: LocalTimeString;
  /** `user_preferences.morning_time` (default 08:00). */
  readonly morningTime?: LocalTimeString;
  readonly workingHours?: WorkingHours;
  readonly quietHours?: QuietHoursSpec | null;
}

export interface PresetContext {
  readonly now: Instant;
  readonly timeZone: string;
  /** The event / deadline the reminder refers to. */
  readonly anchorAt?: Instant | null;
  /** The anchor is a date only (Google Tasks due): `before_*` do not apply. */
  readonly anchorDateOnly?: boolean;
  readonly prefs?: PresetPrefs;
  /** Busy intervals for `smart` (calendar_events + device snapshots). */
  readonly busy?: readonly BusyInterval[];
  /** At least one calendar is connected (`smart` needs it). */
  readonly calendarConnected?: boolean;
  /** Minimum reminder duration hint for `smart` (≥15). */
  readonly durationMinutes?: number;
  /** "Kendin seç" value. */
  readonly customAt?: Instant | null;
}

export interface PresetLabel {
  readonly time: LocalTimeString;
  readonly localDate: string;
  readonly relativeDay: 'today' | 'tomorrow' | 'other';
}

export interface PresetResolution {
  readonly preset: ReminderPreset;
  readonly fireAt: Date | null;
  readonly valid: boolean;
  readonly invalidReason: PresetInvalidReason | null;
  /** UT-REM-02/03: `before_*` rows are hidden (not shown disabled) when past or without a time. */
  readonly hidden: boolean;
  readonly reason: MessageRef | null;
  readonly label: PresetLabel | null;
  /** The chosen time falls in quiet hours (allowed for user choices; meta "· sessiz saatte"). */
  readonly inQuietHours: boolean;
}

const DEFAULT_EVENING = '19:00';
const DEFAULT_MORNING = '08:00';
const EVENING_CUTOFF_MIN = 5;
const MIN_LEAD_MS = 60_000;

function label(at: Date, now: Date, tz: string): PresetLabel {
  const d = localDate(at, tz);
  const today = localDate(now, tz);
  return {
    time: localTime(at, tz),
    localDate: d,
    relativeDay: d === today ? 'today' : d === addDaysToLocalDate(today, 1) ? 'tomorrow' : 'other',
  };
}

function quietFlag(at: Date, ctx: PresetContext): boolean {
  const q =
    ctx.prefs?.quietHours === undefined
      ? { enabled: true, start: '22:30', end: '07:30' }
      : ctx.prefs.quietHours;
  if (!q?.enabled) return false;
  return isWithinQuietHours(q.start, q.end, at, ctx.timeZone, q.days);
}

function ok(
  preset: ReminderPreset,
  at: Date,
  reason: MessageRef,
  ctx: PresetContext,
  now: Date,
): PresetResolution {
  return {
    preset,
    fireAt: at,
    valid: true,
    invalidReason: null,
    hidden: false,
    reason,
    label: label(at, now, ctx.timeZone),
    inQuietHours: quietFlag(at, ctx),
  };
}

function invalid(
  preset: ReminderPreset,
  invalidReason: PresetInvalidReason,
  hidden = false,
  at: Date | null = null,
): PresetResolution {
  return {
    preset,
    fireAt: at,
    valid: false,
    invalidReason,
    hidden,
    reason: null,
    label: null,
    inQuietHours: false,
  };
}

/** `resolvePreset(preset, {now, tz, anchorAt, anchorDateOnly, prefs})`. */
export function resolvePreset(preset: ReminderPreset, ctx: PresetContext): PresetResolution {
  const now = toDate(ctx.now);
  const tz = ctx.timeZone;
  const anchor = ctx.anchorAt ? toDate(ctx.anchorAt) : null;
  switch (preset) {
    case 'before_30m':
    case 'before_1h': {
      const minutes = preset === 'before_30m' ? 30 : 60;
      if (!anchor || ctx.anchorDateOnly) return invalid(preset, 'no_anchor', true);
      const at = new Date(anchor.getTime() - minutes * 60_000);
      if (at.getTime() <= now.getTime() + MIN_LEAD_MS) return invalid(preset, 'in_past', true, at);
      return ok(
        preset,
        at,
        messageRef('reminder.reason.before_anchor', {
          minutes,
          anchor_time: localTime(anchor, tz),
        }),
        ctx,
        now,
      );
    }
    case 'this_evening': {
      const time = ctx.prefs?.eveningTime ?? DEFAULT_EVENING;
      const at = atLocalTime(localDate(now, tz), time, tz);
      if (now.getTime() >= at.getTime() - EVENING_CUTOFF_MIN * 60_000)
        return invalid(preset, 'in_past', false, at);
      return ok(
        preset,
        at,
        messageRef('reminder.reason.evening_time', { time: localTime(at, tz) }),
        ctx,
        now,
      );
    }
    case 'tomorrow_morning': {
      const time = ctx.prefs?.morningTime ?? DEFAULT_MORNING;
      const at = atLocalTime(addDaysToLocalDate(localDate(now, tz), 1), time, tz);
      return ok(
        preset,
        at,
        messageRef('reminder.reason.morning_time', { time: localTime(at, tz) }),
        ctx,
        now,
      );
    }
    case 'smart': {
      if (ctx.calendarConnected === false) return invalid(preset, 'no_calendar');
      const wh = ctx.prefs?.workingHours;
      const before =
        anchor && ctx.anchorDateOnly
          ? atLocalTime(localDate(anchor, tz), wh?.end ?? '18:00', tz)
          : anchor;
      const slot = firstFreeSlot({
        now,
        timeZone: tz,
        busy: ctx.busy ?? [],
        minMinutes: Math.max(15, ctx.durationMinutes ?? 15),
        before,
        horizonDays: before ? 14 : 7,
        bufferMinutes: 0,
        ...(wh ? { workingHours: wh } : {}),
        ...(ctx.prefs?.quietHours !== undefined ? { quietHours: ctx.prefs.quietHours } : {}),
      });
      if (!slot) return invalid(preset, 'no_free_slot');
      const lbl = label(slot.start, now, tz);
      return ok(
        preset,
        slot.start,
        messageRef('reminder.reason.calendar_slot', {
          time: lbl.time,
          day: lbl.relativeDay,
          date: lbl.localDate,
        }),
        ctx,
        now,
      );
    }
    case 'custom': {
      if (!ctx.customAt) return invalid(preset, 'needs_input');
      const at = toDate(ctx.customAt);
      if (at.getTime() <= now.getTime() + MIN_LEAD_MS) return invalid(preset, 'in_past', false, at);
      return ok(
        preset,
        at,
        messageRef('reminder.reason.custom', { time: localTime(at, tz) }),
        ctx,
        now,
      );
    }
  }
}

/** All six presets in master order. */
export function resolveAllPresets(ctx: PresetContext): PresetResolution[] {
  return REMINDER_PRESETS.map((p) => resolvePreset(p, ctx));
}

/**
 * Server re-check of a client-submitted time (API-REM-02): the preset is re-resolved and a
 * difference over 60 s is a `STATE_CONFLICT` carrying the resolved time.
 */
export function verifyPresetTime(
  preset: ReminderPreset,
  submittedFireAt: Instant,
  ctx: PresetContext,
): { readonly ok: true } | { readonly ok: false; readonly resolvedFireAt: Date | null } {
  const r = resolvePreset(preset === 'custom' ? 'custom' : preset, {
    ...ctx,
    customAt: preset === 'custom' ? submittedFireAt : (ctx.customAt ?? null),
  });
  if (!r.valid || !r.fireAt) return { ok: false, resolvedFireAt: r.fireAt };
  return Math.abs(r.fireAt.getTime() - toDate(submittedFireAt).getTime()) <= 60_000
    ? { ok: true }
    : { ok: false, resolvedFireAt: r.fireAt };
}
