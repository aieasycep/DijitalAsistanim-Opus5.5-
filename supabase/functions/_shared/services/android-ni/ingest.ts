/**
 * API-ANI-01 ingest (AI_PIPELINE_PLAN §13.8, INTEGRATION_PLAN "Upload contract"): the per-signal
 * checks after schema validation and the service-client writes.
 *
 * - A package on the locked denylist ({@link lockedGroup}, plus the `feature.android_ni` payload)
 *   and a `posted_at` outside the 7-day window are rejected and counted; the rest of the batch is
 *   stored.
 * - Rows go to `android_notification_signals` deduplicated on `(user_id, signal_hash)`; a hash the
 *   user already has is a duplicate. `expires_at = least(retention, posted_at + 30 d)` is set by the
 *   table's `set_expires_at` trigger.
 * - Only the structured fields of the schema are written; there is no text column to fill.
 */
import { type AniSignal, aniSignalFresh } from '@da/validation';
import type { DbClient } from '../../db/clients.ts';
import { mapDbError } from '../../errors.ts';
import { flagPayloadDenylist, isLockedPackage } from './denylist.ts';

export interface AniSignalInsert {
  readonly user_id: string;
  /** `app_installations.id` of the uploading device. */
  readonly installation_id: string;
  readonly package_name: string;
  readonly app_label: string;
  readonly category: AniSignal['category'];
  readonly amount: string | null;
  readonly currency: string | null;
  readonly due_date: string | null;
  readonly tracking_status: AniSignal['tracking_status'] | null;
  readonly flight_no: string | null;
  readonly gate: string | null;
  readonly posted_at: string;
  /** `bytea` input form: `\x` + the lower-case hex digest. */
  readonly signal_hash: string;
}

export interface AniInstallation {
  readonly id: string;
  readonly user_id: string;
  readonly platform: 'ios' | 'android';
  readonly ni_listener_granted: boolean | null;
}

export interface AniSignalsRepo {
  /** The `app_installations` row of a client installation id. */
  installation(installationId: string): Promise<AniInstallation | null>;
  /** The `denylist` of the `feature.android_ni` flag payload. */
  flagDenylist(): Promise<ReadonlySet<string>>;
  /** Inserts the rows, skipping `(user_id, signal_hash)` duplicates; returns how many were new. */
  insertSignals(rows: readonly AniSignalInsert[]): Promise<number>;
  /** `app_installations.ni_last_signal_at` (support visibility). */
  touchInstallation(installationRowId: string, at: string): Promise<void>;
}

export interface Partitioned {
  readonly rows: AniSignalInsert[];
  readonly rejected: number;
}

/** Splits a validated batch into insertable rows and rejected signals (denylist, 7-day window). */
export function partitionSignals(
  signals: readonly AniSignal[],
  input: {
    readonly userId: string;
    readonly installationRowId: string;
    readonly now: Date;
    readonly denylist: ReadonlySet<string>;
  },
): Partitioned {
  const rows: AniSignalInsert[] = [];
  let rejected = 0;
  for (const s of signals) {
    if (isLockedPackage(s.package, input.denylist) || !aniSignalFresh(s, input.now)) {
      rejected++;
      continue;
    }
    rows.push({
      user_id: input.userId,
      installation_id: input.installationRowId,
      package_name: s.package,
      app_label: s.app_label.trim(),
      category: s.category,
      amount: s.amount?.value ?? null,
      currency: s.amount?.currency ?? null,
      due_date: s.due_date ?? null,
      tracking_status: s.tracking_status ?? null,
      flight_no: s.flight_no ?? null,
      gate: s.gate ?? null,
      posted_at: new Date(Date.parse(s.posted_at)).toISOString(),
      signal_hash: `\\x${s.signal_hash}`,
    });
  }
  return { rows, rejected };
}

/** Service-client repository; every call is scoped by the verified user id of the request. */
export function supabaseAniSignalsRepo(
  system: DbClient,
  options: { ttlMs?: number; now?: () => number } = {},
): AniSignalsRepo {
  const ttl = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let cached: { at: number; list: ReadonlySet<string> } | null = null;
  return {
    async installation(installationId) {
      const { data, error } = await system
        .from('app_installations')
        .select('id,user_id,platform,ni_listener_granted')
        .eq('installation_id', installationId)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data ?? null) as AniInstallation | null;
    },
    async flagDenylist() {
      if (cached !== null && now() - cached.at < ttl) return cached.list;
      const { data, error } = await system
        .from('feature_flags')
        .select('payload')
        .eq('key', 'feature.android_ni')
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      const list = flagPayloadDenylist((data as { payload?: unknown } | null)?.payload);
      cached = { at: now(), list };
      return list;
    },
    async insertSignals(rows) {
      if (rows.length === 0) return 0;
      const { data, error } = await system
        .from('android_notification_signals')
        .upsert([...rows], { onConflict: 'user_id,signal_hash', ignoreDuplicates: true })
        .select('id');
      if (error !== null) throw mapDbError(error);
      return (data ?? []).length;
    },
    async touchInstallation(installationRowId, at) {
      const { error } = await system
        .from('app_installations')
        .update({ ni_last_signal_at: at })
        .eq('id', installationRowId);
      if (error !== null) throw mapDbError(error);
    },
  };
}
