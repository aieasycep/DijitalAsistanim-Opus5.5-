/**
 * Device calendars (T-8.07, M-ON-07 device path, API-INT-06): EventKit on iOS ("Apple Takvim") and
 * CalendarContract on Android ("Cihaz takvimi") through `expo-calendar`. Access is asked only when
 * the user taps "Bağla"/"İzin Ver"; only the calendars the user selected leave the device, as a
 * minimal normalised snapshot (−1 day … +14 days) with hashed identifiers. The selection is kept
 * locally (encrypted MMKV) and sent with every snapshot; the server applies `max_calendars`.
 * Snapshots are uploaded after the first grant, on app foreground (`useDeviceCalendarSync`), and
 * retried when the connection returns.
 */
import type { ApiClient } from '@da/api-client';
import * as Calendar from 'expo-calendar/legacy';
import * as Crypto from 'expo-crypto';
import { Linking, Platform } from 'react-native';

import { installationId } from '../../lib/auth/first-run-purge';
import { getApiClient } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';

export type DeviceProvider = 'apple_device' | 'android_device';
export type DevicePermission = 'granted' | 'denied' | 'blocked' | 'undetermined';

export interface DeviceCalendarInfo {
  readonly id: string;
  readonly title: string;
  readonly sourceTitle: string;
  readonly color: string | null;
  readonly allowsModifications: boolean;
  readonly isPrimary: boolean;
  /** Holiday / birthday / subscribed calendars start deselected (M-ON-07P). */
  readonly subscribed: boolean;
}

const SELECTION_KEY = 'device_calendar.selection';
const WINDOW_BEFORE_MS = 24 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 3000;

export function deviceProvider(): DeviceProvider {
  return Platform.OS === 'ios' ? 'apple_device' : 'android_device';
}

function permissionOf(response: {
  readonly status: string;
  readonly canAskAgain?: boolean;
}): DevicePermission {
  if (response.status === 'granted') return 'granted';
  if (response.status === 'undetermined') return 'undetermined';
  return response.canAskAgain === false ? 'blocked' : 'denied';
}

export async function devicePermission(): Promise<DevicePermission> {
  return permissionOf(await Calendar.getCalendarPermissionsAsync());
}

/** The OS prompt (only after the in-app explainer). */
export async function requestDevicePermission(): Promise<DevicePermission> {
  return permissionOf(await Calendar.requestCalendarPermissionsAsync());
}

export function openSystemSettings(): void {
  void Linking.openSettings();
}

export async function listDeviceCalendars(): Promise<readonly DeviceCalendarInfo[]> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars.map((calendar) => ({
    id: calendar.id,
    title: calendar.title,
    sourceTitle: calendar.source.name,
    color: calendar.color === '' ? null : calendar.color,
    allowsModifications: calendar.allowsModifications,
    isPrimary: calendar.isPrimary === true,
    subscribed:
      calendar.type === Calendar.CalendarType.SUBSCRIBED ||
      calendar.type === Calendar.CalendarType.BIRTHDAYS,
  }));
}

/** Defaults: Pro → every own calendar; Free → the primary (or first) one (D-30). */
export function defaultSelection(
  calendars: readonly DeviceCalendarInfo[],
  pro: boolean,
): readonly string[] {
  const own = calendars.filter((c) => !c.subscribed);
  if (pro) return own.map((c) => c.id);
  const primary = own.find((c) => c.isPrimary) ?? own[0];
  return primary === undefined ? [] : [primary.id];
}

export function savedSelection(): readonly string[] | null {
  if (!isEncryptedStorageOpen()) return null;
  const raw = encryptedStorage().prefs.getString(SELECTION_KEY);
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

export function saveSelection(ids: readonly string[]): void {
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(SELECTION_KEY, JSON.stringify(ids));
}

async function sha256(value: string): Promise<string> {
  return (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value)).toLowerCase();
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function statusOf(status: string | undefined): 'confirmed' | 'tentative' | 'cancelled' {
  if (status === Calendar.EventStatus.TENTATIVE) return 'tentative';
  if (status === Calendar.EventStatus.CANCELED) return 'cancelled';
  return 'confirmed';
}

function meetingUrlOf(url: string | undefined): string | null {
  return url?.startsWith('https://') === true ? url.slice(0, 2000) : null;
}

/** The API-INT-06 body for the selected calendars (field whitelist; identifiers hashed). */
export async function buildSnapshot(
  selectedIds: readonly string[],
  install: string,
  at: Date = now(),
) {
  const calendars = await listDeviceCalendars();
  const start = new Date(at.getTime() - WINDOW_BEFORE_MS);
  const end = new Date(at.getTime() + WINDOW_AFTER_MS);
  const selected = calendars.filter((c) => selectedIds.includes(c.id));
  const hashes = new Map<string, string>();
  for (const calendar of calendars) hashes.set(calendar.id, await sha256(`cal:${calendar.id}`));
  const events =
    selected.length === 0
      ? []
      : await Calendar.getEventsAsync(
          selected.map((c) => c.id),
          start,
          end,
        );
  const normalised = [];
  for (const event of events.slice(0, MAX_EVENTS)) {
    const calendarHash = hashes.get(event.calendarId);
    if (calendarHash === undefined) continue;
    normalised.push({
      event_key_hash: await sha256(
        `evt:${event.calendarId}:${event.id}:${String(event.startDate)}`,
      ),
      device_calendar_hash: calendarHash,
      title: (event.title === '' ? '—' : event.title).slice(0, 300),
      start_at: iso(event.startDate),
      end_at: iso(event.endDate),
      all_day: event.allDay,
      location: clip(event.location, 300),
      attendee_count: 0,
      organizer_is_self: null,
      meeting_url: meetingUrlOf(event.url),
      status: statusOf(event.status),
      last_modified_at: event.lastModifiedDate === undefined ? null : iso(event.lastModifiedDate),
    });
  }
  const calendarRows = calendars.slice(0, 50).map((calendar) => ({
    device_calendar_hash: hashes.get(calendar.id) ?? '',
    title: calendar.title.slice(0, 120),
    source_title: calendar.sourceTitle.slice(0, 60),
    color: calendar.color === null ? null : calendar.color.slice(0, 9),
    allows_modifications: calendar.allowsModifications,
    selected: selectedIds.includes(calendar.id),
  }));
  const content_hash = await sha256(JSON.stringify({ calendarRows, normalised }));
  return {
    snapshot_id: Crypto.randomUUID(),
    provider: deviceProvider(),
    installation_id: install,
    window: { start: start.toISOString(), end: end.toISOString() },
    snapshot_at: at.toISOString(),
    content_hash,
    calendars: calendarRows,
    events: normalised,
  };
}

let uploading: Promise<string | null> | null = null;

/**
 * Uploads a snapshot of the selected calendars; returns the device account id (or null when
 * nothing could be uploaded: no permission, no selection, no installation id).
 */
export function uploadDeviceSnapshot(api: ApiClient = getApiClient()): Promise<string | null> {
  uploading ??= (async () => {
    try {
      if ((await devicePermission()) !== 'granted') return null;
      const selection = savedSelection();
      const install = installationId();
      if (selection === null || install === null) return null;
      const body = await buildSnapshot(selection, install);
      const response = await api.call(
        'POST /integrations/device-calendar/snapshot',
        { body },
        { idempotencyKey: body.snapshot_id },
      );
      return response.data.connected_account_id;
    } finally {
      uploading = null;
    }
  })();
  return uploading;
}
