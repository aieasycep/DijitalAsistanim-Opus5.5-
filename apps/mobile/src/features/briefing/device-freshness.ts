/**
 * Device-calendar freshness of a briefing (KNOWN_PLATFORM_LIMITATIONS KPL-12). Apple and Android
 * device calendars reach the server only as snapshots this app uploads, so a morning or evening
 * briefing can be generated with device data that is hours old. The server records, in
 * `briefings.source_freshness.device_calendar`, each device source's last sync at generation
 * (stale after `DEVICE_CALENDAR_STALE_MINUTES`) and the fingerprint of the device events in the
 * briefing's schedule window (`@da/domain` `deviceScheduleCanonical`, SHA-256). Here the same
 * fingerprint is computed from the current rows (PostgREST as the user, active device accounts
 * only):
 * - `changed`: the device schedule of the window is different now → "Takvimin bu brifingden sonra
 *   değişti." with "Güncel programı gör" (the briefing itself is never regenerated for this);
 * - `stale`: a source was stale at generation and has not synced since → "{kaynak} · son eşitleme
 *   {saat}. Sonraki değişiklikler uygulamayı açtığında eklenir.";
 * - `none`: nothing to say (no device calendar, or the briefing matches the current schedule).
 */
import {
  deviceScheduleCanonical,
  parseDeviceCalendarFreshness,
  type DeviceCalendarFreshness,
  type DeviceCalendarProvider,
  type DeviceScheduleEvent,
} from '@da/domain/calendar/device-freshness';
import { qk } from '@da/api-client';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { getSupabase } from '../../lib/auth/supabase';
import { toDataError } from '../../lib/postgrest';

export type DeviceFreshnessState =
  | { readonly kind: 'none' }
  | { readonly kind: 'changed' }
  | {
      readonly kind: 'stale';
      readonly provider: DeviceCalendarProvider;
      readonly lastSyncAt: string | null;
    };

export const DEVICE_PROVIDERS: readonly DeviceCalendarProvider[] = [
  'apple_device',
  'android_device',
];

interface Result {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

interface DeviceAccount {
  readonly id: string;
  readonly provider: DeviceCalendarProvider;
  readonly last_successful_sync_at: string | null;
}

/** The fingerprint the server stored, computed from events read now. */
export function deviceScheduleFingerprint(events: readonly DeviceScheduleEvent[]): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    deviceScheduleCanonical(events),
  );
}

/** The active device accounts and their events overlapping the window (same rules as the server). */
export async function fetchDeviceSchedule(
  windowStart: string,
  windowEnd: string,
): Promise<{ accounts: DeviceAccount[]; events: DeviceScheduleEvent[] }> {
  const supabase = getSupabase();
  const accounts = (await supabase
    .from('connected_accounts')
    .select('id, provider, last_successful_sync_at')
    .in('provider', [...DEVICE_PROVIDERS])
    .is('disconnected_at', null)
    .neq('status', 'disconnected')) as unknown as Result;
  if (accounts.error !== null) throw toDataError(accounts.error);
  const rows = (Array.isArray(accounts.data) ? accounts.data : []) as DeviceAccount[];
  if (rows.length === 0) return { accounts: [], events: [] };
  const events = (await supabase
    .from('calendar_events')
    .select('id, start_at, end_at, status')
    .in(
      'connected_account_id',
      rows.map((a) => a.id),
    )
    .is('provider_deleted_at', null)
    .lt('start_at', windowEnd)
    .gt('end_at', windowStart)) as unknown as Result;
  if (events.error !== null) throw toDataError(events.error);
  return {
    accounts: rows,
    events: (Array.isArray(events.data) ? events.data : []) as DeviceScheduleEvent[],
  };
}

/** Compares a briefing's recorded device freshness with the current device schedule. */
export async function evaluateDeviceFreshness(
  stored: DeviceCalendarFreshness,
  generatedAt: string | null,
): Promise<DeviceFreshnessState> {
  const current = await fetchDeviceSchedule(stored.window_start, stored.window_end);
  // Disconnected since: the schedule no longer comes from this device at all.
  if (current.accounts.length === 0) return { kind: 'none' };
  if ((await deviceScheduleFingerprint(current.events)) !== stored.fingerprint) {
    return { kind: 'changed' };
  }
  const stale = stored.sources.find((s) => s.stale);
  if (stale === undefined) return { kind: 'none' };
  const generated = generatedAt === null ? Number.NaN : Date.parse(generatedAt);
  const resynced = current.accounts.some(
    (a) =>
      a.provider === stale.provider &&
      a.last_successful_sync_at !== null &&
      Date.parse(a.last_successful_sync_at) > generated,
  );
  return resynced
    ? { kind: 'none' }
    : { kind: 'stale', provider: stale.provider, lastSyncAt: stale.last_sync_at };
}

export interface FreshnessInput {
  readonly id: string;
  readonly status: string;
  readonly generated_at: string | null;
  readonly source_freshness?: Readonly<Record<string, unknown>> | null;
}

/** `['briefings', id, 'device-freshness']`: re-read with the briefing and on focus. */
export function useDeviceFreshness(briefing: FreshnessInput | null | undefined) {
  const stored =
    briefing === null || briefing === undefined
      ? null
      : parseDeviceCalendarFreshness(briefing.source_freshness?.device_calendar);
  const ready = briefing?.status === 'ready' || briefing?.status === 'delivered';
  return useQuery({
    queryKey: [...qk.briefings.detail(briefing?.id ?? 'none'), 'device-freshness'],
    queryFn: () =>
      stored === null
        ? Promise.resolve<DeviceFreshnessState>({ kind: 'none' })
        : evaluateDeviceFreshness(stored, briefing?.generated_at ?? null),
    enabled: stored !== null && ready,
    staleTime: 30_000,
  });
}
