/**
 * Android notification signals → `life_events` (API-ANI-01 DB effects, JOB-12 "life events from
 * Android signals", AI_PIPELINE_PLAN §13.8). Deterministic and model-free: every value comes from
 * the structured fields the device extracted, so no raw notification text exists to store.
 *
 * - cargo → `shipment` (tracking status); bank_payment → `payment`, or `subscription` for the
 *   subscription services in {@link SUBSCRIPTION_PACKAGES} (amount + due date); flight → `flight`
 *   (flight_no, gate); reservation → `reservation`; `other` produces nothing.
 * - Provenance: `source_type='android_notification'`, `source_provider='android_device'`,
 *   `source_id` = the signal row, `source_timestamp` = `posted_at` (source line "Telefon
 *   bildirimi", SREQ-03). Evidence items are structured fields only (`<app> · <field>: <value>`).
 * - Dedupe keys come from `lifeEventDedupeKey` with the identity fields of the e-mail path (flight
 *   flight_no + local date, payment payee + due date + amount, subscription service + date,
 *   reservation venue + day), so a signal about a trip or a bill the user also got by mail merges
 *   into that event. Signals carry no tracking number, so a shipment is an *episode* per app: a new
 *   status continues the latest open, non-final shipment of the same package within 10 days;
 *   otherwise it starts a new one.
 * - Merging never degrades a richer row: into a row of another source (e-mail) a signal only fills
 *   empty fields and refreshes the live ones (flight gate, shipment tracking status) when it is
 *   newer; the row keeps its provenance. Android-owned rows take the newer signal's values and
 *   provenance and keep older values the newer signal lacks.
 * - Confidence is structural (the device emits at ≥ 0.6): shipment 0.75; flight 0.80, 0.85 with a
 *   gate; payment / subscription 0.65 + 0.10 each for amount and due date; reservation 0.60 + 0.10
 *   for the date + 0.05 for an amount. A merge keeps the higher value.
 * - Each processed signal is linked through `android_notification_signals.life_event_id`, so a
 *   re-run only sees signals not yet turned into an event (idempotent).
 */
import {
  atLocalTime,
  decimalStringToMinor,
  lifeEventDedupeKey,
  localDate,
  minorToDecimalString,
  type Provider,
  startOfLocalDay,
  type StoredEvidence,
} from '@da/domain';
import type { DbClient } from '../../db/clients.ts';
import { mapDbError } from '../../errors.ts';
import type { CopyLocale } from '../copy.ts';
import { type LifeEventInsert, lifeEventRow } from './classify.ts';
import type { LifeAmount, LifeCandidate, LifeKind } from './types.ts';

export type AniCategory = 'cargo' | 'bank_payment' | 'flight' | 'reservation' | 'other';
export type AniTrackingStatus =
  'created' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';

/** One stored signal (`android_notification_signals`, structured columns only). */
export interface AndroidSignalRow {
  readonly id: string;
  readonly package_name: string;
  readonly app_label: string | null;
  readonly category: AniCategory;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly due_date: string | null;
  readonly tracking_status: AniTrackingStatus | null;
  readonly flight_no: string | null;
  readonly gate: string | null;
  readonly posted_at: string;
}

/** A `life_events` row a signal may merge into. */
export interface ExistingLifeEvent {
  readonly id: string;
  readonly type: LifeKind;
  readonly status: string;
  readonly dedupe_key: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly amount_evidence: readonly StoredEvidence[] | null;
  readonly event_at: string | null;
  readonly due_at: string | null;
  readonly source_type: string;
  readonly source_id: string;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly evidence: readonly StoredEvidence[];
}

/** Fill-in update of a row owned by another source (it keeps its provenance). */
export interface LifeEventPatch {
  readonly payload?: Record<string, unknown>;
  readonly amount?: string;
  readonly currency?: string;
  readonly amount_evidence?: StoredEvidence[];
  readonly event_at?: string;
  readonly due_at?: string;
  readonly evidence?: StoredEvidence[];
  readonly confidence?: number;
}

export const ANDROID_PROVIDER: Provider = 'android_device';
export const ANDROID_SOURCE_TYPE = 'android_notification' as const;
/** Pending signals are read back this far (the ingest window of API-ANI-01). */
export const ANDROID_SIGNAL_WINDOW_MS = 7 * 86_400_000;
/** A shipment status continues an episode updated at most this long before (or after) it. */
export const SHIPMENT_EPISODE_MS = 10 * 86_400_000;
/** Pending signals handled per refresh (newest first). */
export const ANDROID_REFRESH_LIMIT = 500;

/**
 * Subscription services whose `bank_payment` signals are renewals (`subscription`), not bills.
 * Any other package's payment signal is a `payment`.
 */
export const SUBSCRIPTION_PACKAGES: ReadonlySet<string> = new Set([
  'com.netflix.mediaclient',
  'com.spotify.music',
  'com.google.android.apps.youtube.music',
  'com.disney.disneyplus',
  'com.amazon.avod.thirdpartyclient',
  'com.apple.android.music',
  'com.android.vending',
]);

/** Device tracking status → the shipment status vocabulary of `life.generated.shipment`. */
const SHIPMENT_STATUS: Readonly<Record<AniTrackingStatus, string>> = {
  created: 'ordered',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  // "exception" also covers delays, so it is not reported as a failed delivery.
  exception: 'delayed',
};
const FINAL_SHIPMENT = new Set(['delivered', 'delivery_failed']);
/** Payload keys a newer signal may refresh on a row of another source. */
const LIVE_FIELDS: Readonly<Partial<Record<LifeKind, readonly string[]>>> = {
  flight: ['gate'],
  shipment: ['tracking_status'],
};
const PAYLOAD_META = new Set(['status', 'origin', 'dropped_fields', 'cta_url']);

function labelOf(s: AndroidSignalRow): string {
  const label = (s.app_label ?? '').trim();
  return label === '' ? s.package_name : label;
}

function evidence(s: AndroidSignalRow, field: string, value: string): StoredEvidence {
  return {
    quote: `${labelOf(s)} · ${field}: ${value}`.slice(0, 300),
    field,
    locator: `android_notification:${s.id}`,
  };
}

function amountOf(s: AndroidSignalRow): LifeAmount | null {
  if (s.amount === null || s.currency === null) return null;
  let minor: number;
  try {
    minor = Math.abs(decimalStringToMinor(s.amount));
  } catch {
    return null;
  }
  const value = `${minorToDecimalString(minor)} ${s.currency}`;
  return { minor, currency: s.currency, evidence: evidence(s, 'amount', value) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The life candidate of one signal, or null when it carries no identifiable event. */
export function androidCandidate(s: AndroidSignalRow, timeZone: string): LifeCandidate | null {
  const label = labelOf(s);
  const posted = new Date(s.posted_at);
  const postedDay = localDate(posted, timeZone);
  const common = {
    origin: 'android' as const,
    trackingUrl: null,
    ctaUrl: null,
    droppedFields: [] as string[],
  };
  switch (s.category) {
    case 'cargo': {
      if (s.tracking_status === null) return null;
      const delivered = s.tracking_status === 'delivered';
      return {
        ...common,
        type: 'shipment',
        status: SHIPMENT_STATUS[s.tracking_status],
        fields: {
          merchant: label,
          carrier: null,
          tracking_no: null,
          order_ref: null,
          tracking_status: s.tracking_status,
          app_package: s.package_name,
        },
        eventAt: delivered ? posted : null,
        dueAt: null,
        amount: null,
        evidence: [
          evidence(s, 'tracking_status', s.tracking_status),
          ...(delivered ? [evidence(s, 'posted_at', posted.toISOString())] : []),
        ],
        identity: [ANDROID_SOURCE_TYPE, s.package_name, s.id],
        confidence: 0.75,
      };
    }
    case 'flight': {
      if (s.flight_no === null) return null;
      return {
        ...common,
        type: 'flight',
        status: 'confirmed',
        fields: {
          airline: null,
          flight_no: s.flight_no,
          from: null,
          to: null,
          gate: s.gate,
          pnr: null,
          checkin_status: 'unknown',
          app_package: s.package_name,
        },
        eventAt: null,
        dueAt: null,
        amount: null,
        evidence: [
          evidence(s, 'flight_no', s.flight_no),
          ...(s.gate === null ? [] : [evidence(s, 'gate', s.gate)]),
        ],
        identity: [s.flight_no, postedDay],
        confidence: s.gate === null ? 0.8 : 0.85,
      };
    }
    case 'bank_payment': {
      const amount = amountOf(s);
      const due = s.due_date;
      if (amount === null && due === null) return null;
      const upcoming = due !== null && due >= postedDay;
      const ev = [
        ...(amount === null ? [] : [amount.evidence]),
        ...(due === null ? [] : [evidence(s, 'due_date', due)]),
      ];
      const confidence = round(0.65 + (amount === null ? 0 : 0.1) + (due === null ? 0 : 0.1));
      if (SUBSCRIPTION_PACKAGES.has(s.package_name)) {
        return {
          ...common,
          type: 'subscription',
          status: upcoming ? 'renewal_upcoming' : 'unknown',
          fields: { service: label, period: 'unknown', app_package: s.package_name },
          eventAt: due === null ? null : startOfLocalDay(due, timeZone),
          dueAt: null,
          amount,
          evidence: ev,
          identity: [label, due ?? postedDay],
          confidence,
        };
      }
      return {
        ...common,
        type: 'payment',
        status: upcoming ? 'due' : 'unknown',
        fields: { payee: label, app_package: s.package_name },
        eventAt: null,
        dueAt: due === null ? null : atLocalTime(due, '18:00', timeZone),
        amount,
        evidence: ev,
        identity: [label, due ?? postedDay, amount === null ? 'na' : amount.minor],
        confidence,
      };
    }
    case 'reservation': {
      const amount = amountOf(s);
      const due = s.due_date;
      if (amount === null && due === null) return null;
      const at = due === null ? null : startOfLocalDay(due, timeZone);
      return {
        ...common,
        type: 'reservation',
        status: 'confirmed',
        fields: {
          venue: label,
          reservation_type: 'other',
          party_size: null,
          app_package: s.package_name,
        },
        eventAt: at,
        dueAt: null,
        amount,
        evidence: [
          ...(due === null ? [] : [evidence(s, 'due_date', due)]),
          ...(amount === null ? [] : [amount.evidence]),
        ],
        identity: [label, at === null ? `posted:${postedDay}` : Math.trunc(at.getTime() / 1000)],
        confidence: round(0.6 + (due === null ? 0 : 0.1) + (amount === null ? 0 : 0.05)),
      };
    }
    case 'other':
      return null;
  }
}

// ── Merge planning ───────────────────────────────────────────────────────────

interface Entry {
  readonly key: string;
  readonly existing: ExistingLifeEvent | null;
  /** Android-owned: the merged candidate and its provenance (the newest signal). */
  candidate: LifeCandidate;
  sourceId: string;
  sourceTimestamp: string;
  /** Another source owns the row: accumulated fill-in patch. */
  readonly foreign: boolean;
  patch: LifeEventPatch | null;
  dirty: boolean;
}

export interface AndroidLifePlan {
  /** Android-owned rows (new, or refreshed with a newer signal). */
  readonly upserts: LifeEventInsert[];
  /** Rows of another source enriched in place. */
  readonly patches: {
    readonly id: string;
    readonly dedupeKey: string;
    readonly patch: LifeEventPatch;
  }[];
  /** Signal → dedupe key of the event it produced or merged into. */
  readonly links: { readonly signalId: string; readonly dedupeKey: string }[];
  /** Signals without an identifiable event (left unlinked). */
  readonly skipped: number;
}

function existingCandidate(e: ExistingLifeEvent): LifeCandidate {
  const fields: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(e.payload)) {
    if (PAYLOAD_META.has(k)) continue;
    fields[k] = typeof v === 'string' || typeof v === 'number' ? v : null;
  }
  const amountEv = e.amount_evidence?.[0];
  return {
    type: e.type,
    origin: 'android',
    status: typeof e.payload.status === 'string' ? e.payload.status : 'unknown',
    fields,
    eventAt: e.event_at === null ? null : new Date(e.event_at),
    dueAt: e.due_at === null ? null : new Date(e.due_at),
    amount:
      e.amount === null || e.currency === null || amountEv === undefined
        ? null
        : {
            minor: Math.abs(decimalStringToMinor(String(e.amount))),
            currency: e.currency,
            evidence: amountEv,
          },
    trackingUrl: null,
    ctaUrl: null,
    evidence: e.evidence,
    identity: [],
    confidence: Number(e.confidence),
    droppedFields: [],
  };
}

/** `newer` over `older`: newer non-null values win; older values fill the gaps. */
function overlay(older: LifeCandidate, newer: LifeCandidate): LifeCandidate {
  const fields: Record<string, string | number | null> = { ...older.fields };
  for (const [k, v] of Object.entries(newer.fields)) {
    if (v !== null || !(k in fields)) fields[k] = v;
  }
  const byField = new Map<string, StoredEvidence>();
  for (const e of [...newer.evidence, ...older.evidence]) {
    if (!byField.has(e.field)) byField.set(e.field, e);
  }
  return {
    ...newer,
    status: newer.status === 'unknown' ? older.status : newer.status,
    fields,
    eventAt: newer.eventAt ?? older.eventAt,
    dueAt: newer.dueAt ?? older.dueAt,
    amount: newer.amount ?? older.amount,
    evidence: [...byField.values()].slice(0, 5),
    confidence: Math.max(older.confidence, newer.confidence),
  };
}

type MutablePatch = { -readonly [K in keyof LifeEventPatch]: LifeEventPatch[K] };

const empty = (v: unknown) => v === null || v === undefined || v === '';

/** Fill-in patch for a row of another source; null when the signal adds nothing. */
function foreignPatch(
  e: ExistingLifeEvent,
  current: LifeEventPatch | null,
  c: LifeCandidate,
  postedAt: string,
): LifeEventPatch | null {
  const payload: Record<string, unknown> = { ...e.payload, ...(current?.payload ?? {}) };
  const live = LIVE_FIELDS[e.type] ?? [];
  const newer = Date.parse(postedAt) > Date.parse(e.source_timestamp);
  const changed = new Set<string>();
  for (const [k, v] of Object.entries(c.fields)) {
    if (v === null || k === 'app_package') continue;
    if (empty(payload[k]) || (live.includes(k) && newer && payload[k] !== v)) {
      payload[k] = v;
      changed.add(k);
    }
  }
  const next: MutablePatch = { ...(current ?? {}) };
  if (changed.size > 0) next.payload = payload;
  if (e.amount === null && next.amount === undefined && c.amount !== null) {
    next.amount = minorToDecimalString(c.amount.minor);
    next.currency = c.amount.currency;
    next.amount_evidence = [c.amount.evidence];
    changed.add('amount');
  }
  if (e.due_at === null && next.due_at === undefined && c.dueAt !== null) {
    next.due_at = c.dueAt.toISOString();
    changed.add('due_date');
  }
  if (e.event_at === null && next.event_at === undefined && c.eventAt !== null) {
    next.event_at = c.eventAt.toISOString();
    changed.add('due_date');
    changed.add('posted_at');
  }
  if (changed.size === 0) return current;
  const added = c.evidence.filter((ev) => changed.has(ev.field));
  const base = next.evidence ?? [...e.evidence];
  const seen = new Set(base.map((ev) => `${ev.field}|${ev.quote}`));
  next.evidence = [...added.filter((ev) => !seen.has(`${ev.field}|${ev.quote}`)), ...base].slice(
    0,
    5,
  );
  next.confidence = Math.max(Number(e.confidence), next.confidence ?? 0, c.confidence);
  return next;
}

function isAndroid(e: ExistingLifeEvent): boolean {
  return e.source_type === ANDROID_SOURCE_TYPE;
}

/**
 * The shipment episode a signal belongs to, if any: the latest open, non-final episode of the same
 * package that it continues; or, for a signal posted before an episode's last update (a late
 * upload), the earliest episode updated after it.
 */
function episodeOf(
  entries: Iterable<Entry>,
  s: AndroidSignalRow,
  status: string,
): Entry | undefined {
  const posted = Date.parse(s.posted_at);
  let continued: Entry | undefined;
  let late: Entry | undefined;
  for (const entry of entries) {
    if (entry.foreign || entry.candidate.type !== 'shipment') continue;
    if (entry.candidate.fields.app_package !== s.package_name) continue;
    const last = Date.parse(entry.sourceTimestamp);
    if (Math.abs(posted - last) > SHIPMENT_EPISODE_MS) continue;
    if (posted <= last) {
      if (late === undefined || last < Date.parse(late.sourceTimestamp)) late = entry;
      continue;
    }
    const open = entry.existing === null || entry.existing.status === 'open';
    const final = FINAL_SHIPMENT.has(entry.candidate.status) && entry.candidate.status !== status;
    if (!open || final) continue;
    if (continued === undefined || last > Date.parse(continued.sourceTimestamp)) continued = entry;
  }
  return continued ?? late;
}

/**
 * Plans the writes for a batch of signals (oldest first) against the rows they may merge into:
 * the rows with the candidates' dedupe keys and the recent Android shipments of their packages.
 */
export function planAndroidLifeEvents(
  signals: readonly AndroidSignalRow[],
  existing: readonly ExistingLifeEvent[],
  ctx: { readonly userId: string; readonly locale: CopyLocale; readonly timeZone: string },
): AndroidLifePlan {
  const entries = new Map<string, Entry>();
  for (const e of existing) {
    entries.set(e.dedupe_key, {
      key: e.dedupe_key,
      existing: e,
      candidate: existingCandidate(e),
      sourceId: e.source_id,
      sourceTimestamp: e.source_timestamp,
      foreign: !isAndroid(e),
      patch: null,
      dirty: false,
    });
  }
  const links: { signalId: string; dedupeKey: string }[] = [];
  let skipped = 0;
  const ordered = [...signals].sort((a, b) => Date.parse(a.posted_at) - Date.parse(b.posted_at));
  for (const s of ordered) {
    const c = androidCandidate(s, ctx.timeZone);
    if (c === null) {
      skipped++;
      continue;
    }
    const entry =
      c.type === 'shipment'
        ? episodeOf(entries.values(), s, c.status)
        : entries.get(lifeEventDedupeKey(c.type, c.identity));
    if (entry === undefined) {
      const key = lifeEventDedupeKey(c.type, c.identity);
      entries.set(key, {
        key,
        existing: null,
        candidate: c,
        sourceId: s.id,
        sourceTimestamp: s.posted_at,
        foreign: false,
        patch: null,
        dirty: true,
      });
      links.push({ signalId: s.id, dedupeKey: key });
      continue;
    }
    links.push({ signalId: s.id, dedupeKey: entry.key });
    if (entry.foreign) {
      if (entry.existing === null) continue;
      const patch = foreignPatch(entry.existing, entry.patch, c, s.posted_at);
      if (patch !== entry.patch) {
        entry.patch = patch;
        entry.dirty = true;
      }
      continue;
    }
    if (Date.parse(s.posted_at) >= Date.parse(entry.sourceTimestamp)) {
      entry.candidate = overlay(entry.candidate, c);
      entry.sourceId = s.id;
      entry.sourceTimestamp = s.posted_at;
    } else {
      entry.candidate = overlay(c, entry.candidate);
    }
    entry.dirty = true;
  }

  const upserts: LifeEventInsert[] = [];
  const patches: { id: string; dedupeKey: string; patch: LifeEventPatch }[] = [];
  for (const entry of entries.values()) {
    if (!entry.dirty) continue;
    if (entry.foreign) {
      if (entry.patch !== null && entry.existing !== null) {
        patches.push({ id: entry.existing.id, dedupeKey: entry.key, patch: entry.patch });
      }
      continue;
    }
    const row = lifeEventRow(entry.candidate, {
      userId: ctx.userId,
      messageId: entry.sourceId,
      provider: ANDROID_PROVIDER,
      receivedAt: new Date(entry.sourceTimestamp).toISOString(),
      text: '',
      locale: ctx.locale,
      sourceType: ANDROID_SOURCE_TYPE,
    });
    upserts.push({ ...row, dedupe_key: entry.key });
  }
  return { upserts, patches, links, skipped };
}

// ── Store and run ────────────────────────────────────────────────────────────

export interface AndroidLifeStore {
  /** Signals not yet linked to an event, posted since `since` (category ≠ other), newest first. */
  pendingSignals(userId: string, since: Date, limit: number): Promise<AndroidSignalRow[]>;
  eventsByKeys(userId: string, keys: readonly string[]): Promise<ExistingLifeEvent[]>;
  /** Android-sourced shipments of the packages updated since `since` (episode lookup). */
  androidShipments(
    userId: string,
    packages: readonly string[],
    since: Date,
  ): Promise<ExistingLifeEvent[]>;
  upsertEvents(rows: readonly LifeEventInsert[]): Promise<{ id: string; dedupe_key: string }[]>;
  patchEvent(userId: string, id: string, patch: LifeEventPatch): Promise<void>;
  linkSignals(userId: string, lifeEventId: string, signalIds: readonly string[]): Promise<void>;
}

export interface AndroidLifeResult {
  readonly signals: number;
  readonly upserted: number;
  readonly patched: number;
  readonly linked: number;
  readonly skipped: number;
}

/** JOB-12 step: turn the user's pending Android signals into (or merge them with) life events. */
export async function refreshAndroidLifeEvents(
  store: AndroidLifeStore,
  input: {
    readonly userId: string;
    readonly locale: CopyLocale;
    readonly timeZone: string;
    readonly now: Date;
  },
): Promise<AndroidLifeResult> {
  const since = new Date(input.now.getTime() - ANDROID_SIGNAL_WINDOW_MS);
  const signals = await store.pendingSignals(input.userId, since, ANDROID_REFRESH_LIMIT);
  if (signals.length === 0) return { signals: 0, upserted: 0, patched: 0, linked: 0, skipped: 0 };
  const keys = new Set<string>();
  const packages = new Set<string>();
  for (const s of signals) {
    const c = androidCandidate(s, input.timeZone);
    if (c === null) continue;
    if (c.type === 'shipment') packages.add(s.package_name);
    else keys.add(lifeEventDedupeKey(c.type, c.identity));
  }
  const [byKey, shipments] = await Promise.all([
    keys.size === 0 ? [] : store.eventsByKeys(input.userId, [...keys]),
    packages.size === 0
      ? []
      : store.androidShipments(
          input.userId,
          [...packages],
          new Date(since.getTime() - SHIPMENT_EPISODE_MS),
        ),
  ]);
  const existing = new Map<string, ExistingLifeEvent>();
  for (const e of [...byKey, ...shipments]) existing.set(e.dedupe_key, e);
  const plan = planAndroidLifeEvents(signals, [...existing.values()], input);

  const ids = new Map<string, string>();
  for (const e of existing.values()) ids.set(e.dedupe_key, e.id);
  for (const saved of await store.upsertEvents(plan.upserts)) ids.set(saved.dedupe_key, saved.id);
  for (const p of plan.patches) await store.patchEvent(input.userId, p.id, p.patch);
  const byEvent = new Map<string, string[]>();
  for (const link of plan.links) {
    const id = ids.get(link.dedupeKey);
    if (id === undefined) continue;
    byEvent.set(id, [...(byEvent.get(id) ?? []), link.signalId]);
  }
  let linked = 0;
  for (const [id, signalIds] of byEvent) {
    await store.linkSignals(input.userId, id, signalIds);
    linked += signalIds.length;
  }
  return {
    signals: signals.length,
    upserted: plan.upserts.length,
    patched: plan.patches.length,
    linked,
    skipped: plan.skipped,
  };
}

const EVENT_COLUMNS =
  'id,type,status,dedupe_key,payload,amount,currency,amount_evidence,event_at,due_at,source_type,source_id,source_timestamp,confidence,evidence';

function decimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v.toFixed(2) : String(v);
}

function eventRow(r: Record<string, unknown>): ExistingLifeEvent {
  return {
    ...(r as unknown as ExistingLifeEvent),
    amount: decimal(r.amount),
    confidence: Number(r.confidence),
  };
}

/** Service-client store of the worker; every query is scoped by the job's user id. */
export function supabaseAndroidLifeStore(db: DbClient): AndroidLifeStore {
  const check = <T>(r: { data: T | null; error: { code?: string; message: string } | null }) => {
    if (r.error !== null) throw mapDbError(r.error);
    return r.data;
  };
  return {
    async pendingSignals(userId, since, limit) {
      const data = check(
        await db
          .from('android_notification_signals')
          .select(
            'id,package_name,app_label,category,amount,currency,due_date,tracking_status,flight_no,gate,posted_at',
          )
          .eq('user_id', userId)
          .is('life_event_id', null)
          .neq('category', 'other')
          .gte('posted_at', since.toISOString())
          .order('posted_at', { ascending: false })
          .limit(limit),
      );
      return ((data ?? []) as Record<string, unknown>[])
        .map((r) => ({ ...(r as unknown as AndroidSignalRow), amount: decimal(r.amount) }))
        .reverse();
    },
    async eventsByKeys(userId, keys) {
      const out: ExistingLifeEvent[] = [];
      for (let i = 0; i < keys.length; i += 100) {
        const data = check(
          await db
            .from('life_events')
            .select(EVENT_COLUMNS)
            .eq('user_id', userId)
            .in('dedupe_key', keys.slice(i, i + 100)),
        );
        out.push(...((data ?? []) as Record<string, unknown>[]).map(eventRow));
      }
      return out;
    },
    async androidShipments(userId, packages, since) {
      const data = check(
        await db
          .from('life_events')
          .select(EVENT_COLUMNS)
          .eq('user_id', userId)
          .eq('type', 'shipment')
          .eq('source_type', ANDROID_SOURCE_TYPE)
          .in('payload->>app_package', [...packages])
          .gte('source_timestamp', since.toISOString())
          .limit(200),
      );
      return ((data ?? []) as Record<string, unknown>[]).map(eventRow);
    },
    async upsertEvents(rows) {
      if (rows.length === 0) return [];
      const data = check(
        await db
          .from('life_events')
          .upsert([...rows], { onConflict: 'user_id,dedupe_key' })
          .select('id,dedupe_key'),
      );
      return (data ?? []) as { id: string; dedupe_key: string }[];
    },
    async patchEvent(userId, id, patch) {
      check(await db.from('life_events').update(patch).eq('user_id', userId).eq('id', id));
    },
    async linkSignals(userId, lifeEventId, signalIds) {
      for (let i = 0; i < signalIds.length; i += 100) {
        check(
          await db
            .from('android_notification_signals')
            .update({ life_event_id: lifeEventId })
            .eq('user_id', userId)
            .in('id', signalIds.slice(i, i + 100)),
        );
      }
    },
  };
}
