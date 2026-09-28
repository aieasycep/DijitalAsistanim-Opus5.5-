/**
 * Device-calendar refresh before a briefing and the freshness a briefing records
 * (KNOWN_PLATFORM_LIMITATIONS KPL-11, KPL-12).
 *
 * Apple and Android device calendars reach the server only as snapshots the app uploads. When a
 * scheduled morning or evening briefing is about to be generated and a device source has not
 * synced for {@link DEVICE_REFRESH_AFTER_MINUTES}, the `briefing` job sends a background push
 * (`notification` job with `payload.kind = 'device_refresh'`, no new job type — CANONICAL_REGISTRY)
 * to the installation that owns the device calendar and generates the briefing
 * {@link DEVICE_REFRESH_WAIT_MS} later, once. The push is data-only (`_contentAvailable`, no title
 * or body, `priority: normal`): it displays nothing, so it writes no `notifications` ledger row and
 * is exempt from quiet hours and caps. Delivery is best effort on both platforms (iOS throttles
 * background pushes; Android defers them in Doze), so the briefing never waits longer than the one
 * delay and always records what it used: `source_freshness.device_calendar` with each device
 * source's last sync (stale after `DEVICE_CALENDAR_STALE_MINUTES`) and the fingerprint of the
 * device events in its schedule window, from which the app derives the stale note and the
 * "Takvimin bu brifingden sonra değişti." banner.
 */
import {
  type BriefingKind,
  type DeviceCalendarFreshness,
  type DeviceCalendarProvider,
  type DeviceScheduleEvent,
  deviceScheduleCanonical,
  isDeviceSyncStale,
} from '@da/domain';
import { toHex } from '../../crypto/encoding.ts';
import type { EnqueueInput } from '../../jobs/types.ts';

/** A device source older than this is asked to refresh before a briefing. */
export const DEVICE_REFRESH_AFTER_MINUTES = 30;
/** How long the briefing waits for the refreshed snapshot (once). */
export const DEVICE_REFRESH_WAIT_MS = 3 * 60_000;
/** The briefings whose schedule section reads device calendars. */
export const DEVICE_REFRESH_KINDS: ReadonlySet<BriefingKind> = new Set(['morning', 'evening']);
/** A refresh push that arrives after this is useless (Expo `ttl`, seconds). */
export const DEVICE_REFRESH_TTL_S = 15 * 60;

/** One connected device calendar and the installation that uploads it. */
export interface DeviceSource {
  readonly accountId: string;
  readonly provider: DeviceCalendarProvider;
  /** `app_installations.id` of the uploading installation (null: signed out or unknown). */
  readonly installationRowId: string | null;
  readonly lastSyncAt: string | null;
}

export interface DeviceSchedule {
  readonly sources: readonly DeviceSource[];
  /** Device events (active device accounts) overlapping the window, deleted ones excluded. */
  readonly events: readonly DeviceScheduleEvent[];
}

/** The schedule window of a briefing: its day, or tomorrow for the evening briefing. */
export interface ScheduleWindow {
  readonly from: Date;
  readonly to: Date;
}

export function needsRefresh(source: DeviceSource, now: Date): boolean {
  if (source.lastSyncAt === null) return true;
  const synced = Date.parse(source.lastSyncAt);
  return !Number.isFinite(synced) || now.getTime() - synced > DEVICE_REFRESH_AFTER_MINUTES * 60_000;
}

/** Installations to nudge: one per installation whose device source is not fresh. */
export function refreshTargets(schedule: DeviceSchedule, now: Date): string[] {
  const out = new Set<string>();
  for (const source of schedule.sources) {
    if (source.installationRowId !== null && needsRefresh(source, now)) {
      out.add(source.installationRowId);
    }
  }
  return [...out].sort();
}

/**
 * The `notification` job of one refresh push: `device_refresh:{installation}:{kind}:{local_date}`,
 * so each installation gets at most one per briefing kind and day (two a day at most).
 */
export function deviceRefreshJob(
  userId: string,
  installationRowId: string,
  kind: BriefingKind,
  localDate: string,
): EnqueueInput {
  return {
    type: 'notification',
    idempotencyKey: `device_refresh:${installationRowId}:${kind}:${localDate}`,
    payload: { user_id: userId, kind: 'device_refresh', installation_id: installationRowId },
    userId,
    priority: 10,
    maxAttempts: 3,
  };
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  );
}

/** `source_freshness.device_calendar` at generation; `null` without a device calendar. */
export async function deviceCalendarFreshness(
  schedule: DeviceSchedule,
  window: ScheduleWindow,
  now: Date,
): Promise<DeviceCalendarFreshness | null> {
  if (schedule.sources.length === 0) return null;
  return {
    sources: schedule.sources.map((s) => ({
      provider: s.provider,
      last_sync_at: s.lastSyncAt,
      stale: isDeviceSyncStale(s.lastSyncAt, now),
    })),
    window_start: window.from.toISOString(),
    window_end: window.to.toISOString(),
    fingerprint: await sha256Hex(deviceScheduleCanonical(schedule.events)),
    event_count: schedule.events.length,
  };
}
