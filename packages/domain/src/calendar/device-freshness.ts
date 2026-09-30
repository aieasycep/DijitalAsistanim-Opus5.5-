/**
 * Device-calendar freshness of a briefing (KNOWN_PLATFORM_LIMITATIONS KPL-12). Apple and Android
 * device calendars reach the server only as snapshots the app uploads, so a briefing generated on
 * the server can miss changes made on the phone since the last upload. At generation the briefing
 * records, in `briefings.source_freshness.device_calendar`, each device source's last sync (stale
 * when older than {@link DEVICE_CALENDAR_STALE_MINUTES}) and a fingerprint of the device events in
 * the briefing's schedule window. The app later compares the fingerprint with the current events:
 * a difference is the "Takvimin bu brifingden sonra değişti." banner; a stale source without a
 * newer sync is the stale note. Server (Deno) and app (Hermes) build the fingerprint input with the
 * same function below and hash it with SHA-256 each in their own runtime.
 */

/** A device source older than this at generation makes the briefing's device data stale. */
export const DEVICE_CALENDAR_STALE_MINUTES = 180;

export type DeviceCalendarProvider = 'apple_device' | 'android_device';

/** One device source as recorded at generation. */
export interface DeviceSourceFreshness {
  readonly provider: DeviceCalendarProvider;
  readonly last_sync_at: string | null;
  readonly stale: boolean;
}

/** `briefings.source_freshness.device_calendar` (absent when the user has no device calendar). */
export interface DeviceCalendarFreshness {
  readonly sources: readonly DeviceSourceFreshness[];
  /** The schedule window the fingerprint covers (the briefing's day; tomorrow for evening). */
  readonly window_start: string;
  readonly window_end: string;
  /** SHA-256 hex of {@link deviceScheduleCanonical} over the device events in the window. */
  readonly fingerprint: string;
  readonly event_count: number;
}

/** The event fields the fingerprint covers (titles are left out: only the schedule counts). */
export interface DeviceScheduleEvent {
  readonly id: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly status: string;
}

/** Whether a sync at `lastSyncAt` is too old at `at` (never synced is stale). */
export function isDeviceSyncStale(lastSyncAt: string | null, at: Date): boolean {
  if (lastSyncAt === null) return true;
  const synced = Date.parse(lastSyncAt);
  if (!Number.isFinite(synced)) return true;
  return at.getTime() - synced > DEVICE_CALENDAR_STALE_MINUTES * 60_000;
}

/**
 * The fingerprint input: one line per event, `id|startMs|endMs|status`, sorted, newline-joined.
 * Instants are compared as epoch milliseconds so PostgREST (`+00:00`) and JavaScript (`Z`, `.000`)
 * spellings of the same instant agree.
 */
export function deviceScheduleCanonical(events: readonly DeviceScheduleEvent[]): string {
  return events
    .map(
      (e) =>
        `${e.id}|${String(Date.parse(e.start_at))}|${String(Date.parse(e.end_at))}|${e.status}`,
    )
    .sort()
    .join('\n');
}

/** Reads the stored object defensively (`null` when absent or malformed). */
export function parseDeviceCalendarFreshness(value: unknown): DeviceCalendarFreshness | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.fingerprint !== 'string' ||
    typeof v.window_start !== 'string' ||
    typeof v.window_end !== 'string' ||
    !Array.isArray(v.sources)
  ) {
    return null;
  }
  const sources: DeviceSourceFreshness[] = [];
  for (const raw of v.sources as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (s.provider !== 'apple_device' && s.provider !== 'android_device') continue;
    sources.push({
      provider: s.provider,
      last_sync_at: typeof s.last_sync_at === 'string' ? s.last_sync_at : null,
      stale: s.stale === true,
    });
  }
  return {
    sources,
    window_start: v.window_start,
    window_end: v.window_end,
    fingerprint: v.fingerprint,
    event_count: typeof v.event_count === 'number' ? v.event_count : 0,
  };
}
