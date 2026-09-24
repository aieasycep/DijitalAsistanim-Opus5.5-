/**
 * Connectivity as the offline banner shows it (M-GL-09, T-8.23): offline only after NetInfo has
 * reported no connection for 2 s (a short blip never flashes the banner), a reconnect moment for
 * the "Güncel · {HH:mm}" confirmation, the "Son analiz" time from the bootstrap accounts, and the
 * "Yenile" re-check (NetInfo refresh, then the active queries refetch).
 */
import NetInfo from '@react-native-community/netinfo';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

export const OFFLINE_DEBOUNCE_MS = 2_000;
export const RECONNECT_FLASH_MS = 2_000;

export interface Connectivity {
  /** Offline for at least 2 s. */
  readonly offline: boolean;
  /** When the connection came back after the banner was shown (for the reconnect flash). */
  readonly reconnectedAt: number | null;
}

let state: Connectivity = { offline: false, reconnectedAt: null };
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: Connectivity): void {
  state = next;
  for (const listener of listeners) listener();
}

function onOnlineChange(online: boolean): void {
  if (online) {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!state.offline) return;
    const at = Date.now();
    publish({ offline: false, reconnectedAt: at });
    // The flash lasts ~1.9 s (line 400 ms + "Güncel" 1.5 s); later screens do not replay it.
    setTimeout(() => {
      if (state.reconnectedAt === at) publish({ offline: state.offline, reconnectedAt: null });
    }, RECONNECT_FLASH_MS);
    return;
  }
  if (state.offline || timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    publish({ offline: true, reconnectedAt: state.reconnectedAt });
  }, OFFLINE_DEBOUNCE_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (unsubscribe === null) {
    unsubscribe = onlineManager.subscribe(onOnlineChange);
    onOnlineChange(onlineManager.isOnline());
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    unsubscribe?.();
    unsubscribe = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

function snapshot(): Connectivity {
  return state;
}

/** The debounced connectivity state (re-renders on change). */
export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam. */
export function resetConnectivityForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  state = { offline: false, reconnectedAt: null };
}

/** The last successful analysis: the newest `last_sync_at` of the connected accounts. */
export function lastAnalysisAt(data: BootstrapData | undefined): number | null {
  let latest: number | null = null;
  for (const account of data?.accounts ?? []) {
    const at = account.last_sync_at === null ? NaN : Date.parse(account.last_sync_at);
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/** "Yenile": asks NetInfo again; online → the active queries refetch. Resolves the result. */
export async function recheckConnection(client: QueryClient): Promise<'online' | 'still_offline'> {
  const fresh = await NetInfo.refresh().catch(() => null);
  const online = fresh === null ? onlineManager.isOnline() : fresh.isConnected !== false;
  if (!online) return 'still_offline';
  onlineManager.setOnline(true);
  await client.refetchQueries({ type: 'active' }).catch(() => undefined);
  return 'online';
}
