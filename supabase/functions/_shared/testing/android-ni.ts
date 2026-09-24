/**
 * In-memory Android NI stores for tests: the API-ANI-01 ingest repository (unique
 * `(user_id, signal_hash)`, installations, the flag payload denylist) and the life-event store of
 * the `insight_refresh` step, over the same signal rows and a {@link MemoryIntel}'s `lifeEvents`.
 */
import type {
  AniInstallation,
  AniSignalInsert,
  AniSignalsRepo,
} from '../services/android-ni/ingest.ts';
import type {
  AndroidLifeStore,
  AndroidSignalRow,
  ExistingLifeEvent,
} from '../services/life/android.ts';
import type { MemoryIntel } from './intel.ts';

export interface StoredSignal extends AniSignalInsert {
  readonly id: string;
  life_event_id: string | null;
}

export class MemoryAndroidNi {
  readonly installations = new Map<string, AniInstallation>();
  readonly signals: StoredSignal[] = [];
  readonly touched: { id: string; at: string }[] = [];
  flagDenylist = new Set<string>();
  /** `life_events.status` overrides by id (every other row is `open`). */
  readonly statuses = new Map<string, string>();

  addInstallation(installationId: string, row: Partial<AniInstallation> & { user_id: string }) {
    const full: AniInstallation = {
      id: crypto.randomUUID(),
      platform: 'android',
      ni_listener_granted: true,
      ...row,
    };
    this.installations.set(installationId, full);
    return full;
  }

  repo(): AniSignalsRepo {
    return {
      installation: (id) => Promise.resolve(this.installations.get(id) ?? null),
      flagDenylist: () => Promise.resolve(this.flagDenylist),
      insertSignals: (rows) => {
        let inserted = 0;
        for (const r of rows) {
          if (this.signals.some((s) => s.user_id === r.user_id && s.signal_hash === r.signal_hash))
            continue;
          this.signals.push({ ...r, id: crypto.randomUUID(), life_event_id: null });
          inserted++;
        }
        return Promise.resolve(inserted);
      },
      touchInstallation: (id, at) => Promise.resolve(void this.touched.push({ id, at })),
    };
  }

  lifeStore(mem: MemoryIntel): AndroidLifeStore {
    const existing = (l: MemoryIntel['lifeEvents'][number]): ExistingLifeEvent => ({
      id: l.id,
      type: l.type,
      status: this.statuses.get(l.id) ?? 'open',
      dedupe_key: l.dedupe_key,
      payload: l.payload,
      amount: l.amount,
      currency: l.currency,
      amount_evidence: l.amount_evidence,
      event_at: l.event_at,
      due_at: l.due_at,
      source_type: l.source_type,
      source_id: l.source_id,
      source_timestamp: l.source_timestamp,
      confidence: l.confidence,
      evidence: l.evidence,
    });
    return {
      pendingSignals: (userId, since, limit) =>
        Promise.resolve(
          this.signals
            .filter(
              (s) =>
                s.user_id === userId &&
                s.life_event_id === null &&
                s.category !== 'other' &&
                Date.parse(s.posted_at) >= since.getTime(),
            )
            .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at))
            .slice(0, limit)
            .reverse()
            .map((s): AndroidSignalRow => ({
              id: s.id,
              package_name: s.package_name,
              app_label: s.app_label,
              category: s.category,
              amount: s.amount,
              currency: s.currency,
              due_date: s.due_date,
              tracking_status: s.tracking_status ?? null,
              flight_no: s.flight_no,
              gate: s.gate,
              posted_at: s.posted_at,
            })),
        ),
      eventsByKeys: (userId, keys) =>
        Promise.resolve(
          mem.lifeEvents
            .filter((l) => l.user_id === userId && keys.includes(l.dedupe_key))
            .map(existing),
        ),
      androidShipments: (userId, packages, since) =>
        Promise.resolve(
          mem.lifeEvents
            .filter(
              (l) =>
                l.user_id === userId &&
                l.type === 'shipment' &&
                l.source_type === 'android_notification' &&
                packages.includes(String(l.payload.app_package)) &&
                Date.parse(l.source_timestamp) >= since.getTime(),
            )
            .map(existing),
        ),
      upsertEvents: (rows) => mem.mailStore().upsertLifeEvents(rows),
      patchEvent: (userId, id, patch) => {
        const row = mem.lifeEvents.find((l) => l.user_id === userId && l.id === id);
        if (row !== undefined) Object.assign(row, patch);
        return Promise.resolve();
      },
      linkSignals: (userId, lifeEventId, signalIds) => {
        for (const s of this.signals) {
          if (s.user_id === userId && signalIds.includes(s.id)) s.life_event_id = lifeEventId;
        }
        return Promise.resolve();
      },
    };
  }
}
