/**
 * Device executor (Part 3 §0.4.6, API_CONTRACTS §6.7, R-18): approvals whose destination is this
 * device — Apple Calendar / Android CalendarContract events and Apple Reminders — are written here
 * with `expo-calendar`, never by the server. Before writing, the target list is searched for the
 * marker `[da:{approval_id}]` so a retry after a crash never writes twice; the result goes to
 * `POST /approvals/:id/device-execution` with only the sha256 of the device identifier.
 */
import type { ApiClient } from '@da/api-client';
import type { ApprovalPayload, ApprovalView } from '@da/validation/api/approvals';
import * as Calendar from 'expo-calendar/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { installationId } from '../../lib/auth/first-run-purge';

export type DeviceErrorCode =
  'permission_denied' | 'calendar_read_only' | 'not_found' | 'cancelled_by_user' | 'unknown';

export type DeviceWriteOutcome =
  | { readonly status: 'executed'; readonly alreadyExisted: boolean; readonly refHash?: string }
  | { readonly status: 'failed'; readonly errorCode: DeviceErrorCode };

const DAY_MS = 86_400_000;

async function sha256(value: string): Promise<string> {
  return (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value)).toLowerCase();
}

/** The marker written into the notes of every device write. */
export function deviceMarker(approvalId: string): string {
  return `[da:${approvalId}]`;
}

/** The hash a reminder list is proposed with (`reminder_list_hash`). */
export function reminderListHash(listId: string): Promise<string> {
  return sha256(`rem:${listId}`);
}

async function calendarByHash(
  entity: 'event' | 'reminder',
  hash: string,
): Promise<Calendar.Calendar | null> {
  const calendars = await Calendar.getCalendarsAsync(
    entity === 'event' ? Calendar.EntityTypes.EVENT : Calendar.EntityTypes.REMINDER,
  );
  for (const calendar of calendars) {
    const candidate = await sha256(`${entity === 'event' ? 'cal' : 'rem'}:${calendar.id}`);
    if (candidate === hash) return calendar;
  }
  return null;
}

async function eventPermission(): Promise<boolean> {
  const current = await Calendar.getCalendarPermissionsAsync();
  if (current.granted) return true;
  return (await Calendar.requestCalendarPermissionsAsync()).granted;
}

async function reminderPermission(): Promise<boolean> {
  const current = await Calendar.getRemindersPermissionsAsync();
  if (current.granted) return true;
  return (await Calendar.requestRemindersPermissionsAsync()).granted;
}

function timesOf(time: Extract<ApprovalPayload, { action_type: 'calendar_create' }>['time']): {
  start: Date;
  end: Date;
  allDay: boolean;
  timeZone?: string;
} {
  if (time.kind === 'timed') {
    return {
      start: new Date(time.start),
      end: new Date(time.end),
      allDay: false,
      timeZone: time.time_zone,
    };
  }
  return {
    start: new Date(`${time.start_date}T00:00:00`),
    end: new Date(`${time.end_date}T00:00:00`),
    allDay: true,
  };
}

async function writeEvent(
  approvalId: string,
  payload: Extract<ApprovalPayload, { action_type: 'calendar_create' }>,
): Promise<DeviceWriteOutcome> {
  if (payload.target.kind !== 'device') return { status: 'failed', errorCode: 'unknown' };
  if (!(await eventPermission())) return { status: 'failed', errorCode: 'permission_denied' };
  const calendar = await calendarByHash('event', payload.target.device_calendar_hash);
  if (calendar === null) return { status: 'failed', errorCode: 'not_found' };
  if (!calendar.allowsModifications) return { status: 'failed', errorCode: 'calendar_read_only' };
  const marker = deviceMarker(approvalId);
  const { start, end, allDay, timeZone } = timesOf(payload.time);
  const existing = await Calendar.getEventsAsync(
    [calendar.id],
    new Date(start.getTime() - DAY_MS),
    new Date(end.getTime() + DAY_MS),
  );
  const found = existing.find((event) => event.notes.includes(marker));
  if (found !== undefined) {
    return { status: 'executed', alreadyExisted: true, refHash: await sha256(found.id) };
  }
  const notes = [payload.description, marker].filter((p) => p !== undefined && p !== '').join('\n');
  const id = await Calendar.createEventAsync(calendar.id, {
    title: payload.title,
    startDate: start,
    endDate: end,
    allDay,
    notes,
    ...(payload.location === undefined ? {} : { location: payload.location }),
    ...(timeZone === undefined ? {} : { timeZone }),
    alarms: payload.reminders_minutes.map((minutes) => ({ relativeOffset: -minutes })),
  });
  return { status: 'executed', alreadyExisted: false, refHash: await sha256(id) };
}

async function writeReminder(
  approvalId: string,
  listHash: string,
  title: string,
  dueAt: Date | null,
  notes: string | undefined,
): Promise<DeviceWriteOutcome> {
  if (Platform.OS !== 'ios') return { status: 'failed', errorCode: 'not_found' };
  if (!(await reminderPermission())) return { status: 'failed', errorCode: 'permission_denied' };
  const list = await calendarByHash('reminder', listHash);
  if (list === null) return { status: 'failed', errorCode: 'not_found' };
  const marker = deviceMarker(approvalId);
  const existing = await Calendar.getRemindersAsync([list.id], null, null, null);
  const found = existing.find((reminder) => (reminder.notes ?? '').includes(marker));
  if (found?.id !== undefined) {
    return { status: 'executed', alreadyExisted: true, refHash: await sha256(found.id) };
  }
  const id = await Calendar.createReminderAsync(list.id, {
    title,
    notes: [notes, marker].filter((p) => p !== undefined && p !== '').join('\n'),
    ...(dueAt === null ? {} : { dueDate: dueAt, alarms: [{ absoluteDate: dueAt.toISOString() }] }),
  });
  return { status: 'executed', alreadyExisted: false, refHash: await sha256(id) };
}

/** Runs one device instruction set; never throws (failures become a device error code). */
export async function executeOnDevice(
  approvalId: string,
  payload: ApprovalPayload,
): Promise<DeviceWriteOutcome> {
  try {
    switch (payload.action_type) {
      case 'calendar_create':
        return await writeEvent(approvalId, payload);
      case 'reminder_create':
        if (payload.destination.kind !== 'device') break;
        return await writeReminder(
          approvalId,
          payload.destination.reminder_list_hash,
          payload.title,
          new Date(payload.fire_at),
          undefined,
        );
      case 'task_create': {
        if (payload.target.kind !== 'device') break;
        const due =
          payload.due === undefined
            ? null
            : payload.due.kind === 'date'
              ? new Date(`${payload.due.date}T09:00:00`)
              : new Date(payload.due.at);
        return await writeReminder(
          approvalId,
          payload.target.reminder_list_hash,
          payload.title,
          due,
          payload.notes,
        );
      }
      default:
        // Device `calendar_update` needs the device event key, which the instructions do not
        // carry; the server marks it failed and the user re-proposes (KNOWN_PLATFORM_LIMITATIONS).
        break;
    }
    return { status: 'failed', errorCode: 'not_found' };
  } catch {
    return { status: 'failed', errorCode: 'unknown' };
  }
}

/**
 * Executes and reports a device approval. With `token` + `instructions` from the approve
 * response it writes at once; otherwise (approved on another installation) it claims first.
 */
export async function runDeviceApproval(
  api: ApiClient,
  approvalId: string,
  execution: { readonly token: string | null; readonly instructions: ApprovalPayload | null },
): Promise<ApprovalView | null> {
  const installation = installationId();
  if (installation === null) return null;
  let token = execution.token;
  let instructions = execution.instructions;
  if (token === null || instructions === null) {
    const claimed = await api.call('POST /approvals/:id/device-execution', {
      params: { id: approvalId },
      body: { phase: 'claim', installation_id: installation },
    });
    const data = claimed.data;
    if (!('device_token' in data)) return data;
    token = data.device_token;
    instructions = data.instructions;
  }
  const outcome = await executeOnDevice(approvalId, instructions);
  const reported = await api.call('POST /approvals/:id/device-execution', {
    params: { id: approvalId },
    body:
      outcome.status === 'executed'
        ? {
            phase: 'result',
            installation_id: installation,
            device_token: token,
            status: 'executed',
            already_existed: outcome.alreadyExisted,
            ...(outcome.refHash === undefined ? {} : { device_ref_hash: outcome.refHash }),
          }
        : {
            phase: 'result',
            installation_id: installation,
            device_token: token,
            status: 'failed',
            error_code: outcome.errorCode,
          },
  });
  const data = reported.data;
  return 'device_token' in data ? data.approval : data;
}
