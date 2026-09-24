/**
 * "SON SİNYALLER" (M-ANI-01): the extracted signals of this device that are still in the encrypted
 * on-device buffer, merged with the uploaded ones read back under RLS
 * (`android_notification_signals`, own rows). Only structured fields exist on either side. Deletes
 * remove the local entry and the server row (owner delete policy, OWN-D); offline, the server
 * delete is queued and replayed on the next flush.
 */
import { qk } from '@da/api-client';
import { useQuery } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { isOffline } from '../../lib/query/online-manager';
import { getQueryClient } from '../../lib/query/client';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';
import { niCall, type NiCategory, type NiTrackingStatus } from './native';

export interface AniSignalRow {
  readonly hash: string;
  readonly package: string;
  readonly appLabel: string;
  readonly category: NiCategory;
  readonly trackingStatus: NiTrackingStatus | null;
  readonly amount: { readonly value: string; readonly currency: string } | null;
  readonly dueDate: string | null;
  readonly flightNo: string | null;
  readonly gate: string | null;
  readonly postedAt: string;
}

interface ServerRow {
  readonly package_name: string;
  readonly app_label: string | null;
  readonly category: string;
  readonly amount: number | string | null;
  readonly currency: string | null;
  readonly due_date: string | null;
  readonly tracking_status: string | null;
  readonly flight_no: string | null;
  readonly gate: string | null;
  readonly posted_at: string;
  readonly signal_hash: string;
}

const CATEGORIES: readonly NiCategory[] = [
  'cargo',
  'bank_payment',
  'flight',
  'reservation',
  'other',
];
const STATUSES: readonly NiTrackingStatus[] = [
  'created',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
];
const PENDING_DELETES_KEY = 'ani.pending_server_deletes';
export const SIGNAL_LIST_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `bytea` comes back from PostgREST as `\x<hex>`. */
export function hashFromBytea(value: string): string {
  return value.startsWith('\\x') ? value.slice(2) : value;
}

function fromServer(row: ServerRow): AniSignalRow | null {
  const category = CATEGORIES.find((c) => c === row.category);
  if (category === undefined) return null;
  return {
    hash: hashFromBytea(row.signal_hash),
    package: row.package_name,
    appLabel: row.app_label ?? row.package_name,
    category,
    trackingStatus: STATUSES.find((s) => s === row.tracking_status) ?? null,
    amount:
      row.amount === null || row.currency === null
        ? null
        : { value: String(row.amount), currency: row.currency },
    dueDate: row.due_date,
    flightNo: row.flight_no,
    gate: row.gate,
    postedAt: row.posted_at,
  };
}

function localRows(): AniSignalRow[] {
  return niCall([], (ni) => ni.getRecentSignals(50)).map((s) => ({
    hash: s.signal_hash,
    package: s.package,
    appLabel: s.app_label,
    category: s.category,
    trackingStatus: s.tracking_status ?? null,
    amount: s.amount ?? null,
    dueDate: s.due_date ?? null,
    flightNo: s.flight_no ?? null,
    gate: s.gate ?? null,
    postedAt: s.posted_at,
  }));
}

async function serverRows(): Promise<AniSignalRow[]> {
  const { data, error } = (await getSupabase()
    .from('android_notification_signals')
    .select(
      'package_name, app_label, category, amount, currency, due_date, tracking_status, flight_no, gate, posted_at, signal_hash',
    )
    .order('posted_at', { ascending: false })
    .limit(50)) as unknown as { data: ServerRow[] | null; error: unknown };
  if (error !== null && error !== undefined) throw new Error('android_notification_signals');
  return (data ?? []).map(fromServer).filter((r): r is AniSignalRow => r !== null);
}

export interface AniSignals {
  /** Newest first. */
  readonly rows: readonly AniSignalRow[];
  /** The uploaded part could not be read (offline or an error); the device part is shown. */
  readonly partial: boolean;
}

/** Local and uploaded signals, deduplicated by hash, newest first. */
export async function loadAniSignals(): Promise<AniSignals> {
  const local = localRows();
  let remote: AniSignalRow[] = [];
  let partial = false;
  if (isOffline()) partial = true;
  else {
    try {
      remote = await serverRows();
    } catch {
      partial = true;
    }
  }
  const pendingDeletes = readPendingDeletes();
  const byHash = new Map<string, AniSignalRow>();
  for (const row of [...local, ...remote]) {
    const cutOff = pendingDeletes.allUntil;
    if (cutOff !== null && Date.parse(row.postedAt) <= Date.parse(cutOff)) continue;
    if (pendingDeletes.hashes.includes(row.hash)) continue;
    if (!byHash.has(row.hash)) byHash.set(row.hash, row);
  }
  const rows = [...byHash.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  return { rows, partial };
}

export function useAniSignals(enabled: boolean) {
  return useQuery({
    queryKey: qk.ani.signals(),
    queryFn: loadAniSignals,
    enabled,
    staleTime: 15_000,
    networkMode: 'always',
  });
}

/** Signals posted in the 24 h before `now`. */
export function countLast24h(rows: readonly AniSignalRow[], now: Date): number {
  const from = now.getTime() - DAY_MS;
  return rows.filter((r) => Date.parse(r.postedAt) >= from).length;
}

interface PendingDeletes {
  /** "Tümünü sil" not yet applied on the server: every row posted up to this instant. */
  readonly allUntil: string | null;
  readonly hashes: readonly string[];
}

const NO_DELETES: PendingDeletes = { allUntil: null, hashes: [] };

function readPendingDeletes(): PendingDeletes {
  if (!isEncryptedStorageOpen()) return NO_DELETES;
  const raw = encryptedStorage().prefs.getString(PENDING_DELETES_KEY);
  if (raw === undefined) return NO_DELETES;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingDeletes>;
    return {
      allUntil: typeof parsed.allUntil === 'string' ? parsed.allUntil : null,
      hashes: Array.isArray(parsed.hashes)
        ? parsed.hashes.filter((h) => typeof h === 'string')
        : [],
    };
  } catch {
    return NO_DELETES;
  }
}

function writePendingDeletes(next: PendingDeletes): void {
  if (!isEncryptedStorageOpen()) return;
  if (next.allUntil === null && next.hashes.length === 0) {
    encryptedStorage().prefs.remove(PENDING_DELETES_KEY);
  } else {
    encryptedStorage().prefs.set(PENDING_DELETES_KEY, JSON.stringify(next));
  }
}

type DeleteTarget = { readonly hash: string } | { readonly until: string };

async function serverDelete(target: DeleteTarget): Promise<boolean> {
  if (isOffline()) return false;
  try {
    const table = getSupabase().from('android_notification_signals').delete();
    const { error } = (await ('hash' in target
      ? table.eq('signal_hash', `\\x${target.hash}`)
      : table.lte('posted_at', target.until))) as { error: unknown };
    return error === null || error === undefined;
  } catch {
    return false;
  }
}

function refreshSignals(): void {
  void getQueryClient().invalidateQueries({ queryKey: qk.ani.signals() });
}

/** One signal: the device entry now, the server row now or on the next flush. */
export async function deleteSignal(hash: string): Promise<void> {
  niCall(undefined, (ni) => {
    ni.deleteSignal(hash);
  });
  const pending = readPendingDeletes();
  writePendingDeletes({ ...pending, hashes: [...new Set([...pending.hashes, hash])] });
  refreshSignals();
  if (await serverDelete({ hash })) {
    const after = readPendingDeletes();
    writePendingDeletes({ ...after, hashes: after.hashes.filter((h) => h !== hash) });
  }
  refreshSignals();
}

/** "Tümünü sil": the device buffer now, every own server row now or on the next flush. */
export async function deleteAllSignals(at: Date): Promise<void> {
  niCall(undefined, (ni) => {
    ni.clearBuffer();
  });
  const until = at.toISOString();
  writePendingDeletes({ allUntil: until, hashes: [] });
  refreshSignals();
  if (await serverDelete({ until })) writePendingDeletes(NO_DELETES);
  refreshSignals();
}

/** Replays server deletes queued while offline (called before each upload). */
export async function replayPendingDeletes(): Promise<void> {
  const pending = readPendingDeletes();
  let allUntil = pending.allUntil;
  if (allUntil !== null && (await serverDelete({ until: allUntil }))) allUntil = null;
  const left: string[] = [];
  for (const hash of pending.hashes) {
    if (!(await serverDelete({ hash }))) left.push(hash);
  }
  writePendingDeletes({ allUntil, hashes: left });
}
