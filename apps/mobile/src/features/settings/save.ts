/**
 * Auto-save for settings (SCREEN_AND_FLOW_MAP Part 4 §0.5 rule 1–2): every toggle, radio and picker
 * writes its owner row (`user_preferences`, `notification_preferences`, `profiles`) through
 * PostgREST under RLS, optimistically on the cached bootstrap.
 * - Online failure → the cache reverts and the error toast "Kaydedilemedi. Tekrar dene." appears.
 * - Offline (a *queued* write class, §14.2) → the change stays applied and goes to the app's offline
 *   mutation queue (T-8.23, `own_row`, last write wins per table, encrypted, survives a restart);
 *   it replays in order when the connection returns, and rows show "Bağlantı gelince
 *   kaydedilecek" while a patch of the table is pending.
 */
import { qk } from '@da/api-client';
import type { BootstrapData } from '@da/validation/api/bootstrap';

import { translator } from '../../i18n/translate';
import {
  bindMutationQueue,
  flushMutationQueue,
  onOwnRowReplayed,
  queueMutation,
  resetMutationQueueForTests,
  runOrQueue,
  useQueuedCount,
  type OwnTable,
} from '../../lib/offline/mutations';
import { cachedBootstrap, patchBootstrapCache } from '../../lib/postgrest';
import { isOffline } from '../../lib/query/online-manager';
import { getQueryClient } from '../../lib/query/client';
import { showToast } from '../../providers/ToastHost';
import { applyLocalWidgetPrivacy, refreshWidgetSnapshot } from '../widgets/snapshot';

export type { OwnTable } from '../../lib/offline/mutations';

export interface SaveOptions {
  /** No error toast (the caller reports the failure itself). */
  readonly silent?: boolean;
  /** `keep`: on failure keep the new value and retry later (last write wins, M-SET-60/62). */
  readonly onFailure?: 'revert' | 'keep';
}
export type SaveResult = 'saved' | 'queued' | 'failed';

/** Saves one owner-row patch, applying `apply` to the cached bootstrap first. */
export async function saveOwnRow(
  table: OwnTable,
  patch: Readonly<Record<string, unknown>>,
  apply: (data: BootstrapData) => BootstrapData,
  options: SaveOptions = {},
): Promise<SaveResult> {
  const previous = cachedBootstrap();
  patchBootstrapCache(apply);
  if (isOffline()) {
    queueMutation('own_row', { table, patch });
    return 'queued';
  }
  const result = await runOrQueue('own_row', { table, patch });
  if (result.status !== 'failed') return result.status;
  if (options.onFailure === 'keep') {
    // Device-first settings (theme, language): the local value stays, the write is retried.
    queueMutation('own_row', { table, patch });
    return 'queued';
  }
  if (previous !== undefined) getQueryClient().setQueryData(qk.me.bootstrap(), previous);
  if (options.silent !== true) {
    showToast({ message: translator()('states.error.saveFailed'), kind: 'error' });
  }
  return 'failed';
}

export function saveUserPreferences(
  patch: Partial<BootstrapData['preferences']>,
  options?: SaveOptions,
): Promise<SaveResult> {
  return saveOwnRow(
    'user_preferences',
    patch,
    (data) => ({ ...data, preferences: { ...data.preferences, ...patch } }),
    options,
  );
}

export function saveNotificationPreferences(
  patch: Partial<BootstrapData['notification_preferences']>,
): Promise<SaveResult> {
  const saving = saveOwnRow('notification_preferences', patch, (data) => ({
    ...data,
    notification_preferences: { ...data.notification_preferences, ...patch },
  }));
  if (patch.detail_level === undefined && patch.lock_screen_private === undefined) return saving;
  // Widgets follow the detail level (T-8.25, §11.2): the stored snapshot is re-filtered at once
  // (offline too); once the server has the new level the snapshot is re-fetched.
  void applyLocalWidgetPrivacy().catch(() => undefined);
  return saving.then((result) => {
    if (result === 'saved') void refreshWidgetSnapshot('settings', { force: true });
    return result;
  });
}

/** Replays the queued writes now (settings patches and every other queued kind). */
export function flushPendingSettings(): Promise<void> {
  return flushMutationQueue();
}

// A replayed locale or detail level changes what the widget snapshot may show (T-8.25).
onOwnRowReplayed((table) => {
  if (table !== 'user_preferences') void refreshWidgetSnapshot('settings', { force: true });
});

/** Whether a settings change waits for the connection ("Bağlantı gelince kaydedilecek"). */
export function usePendingSettings(): boolean {
  return useQueuedCount((entry) => entry.kind === 'own_row') > 0;
}

/** Replays pending writes on reconnect and foreground (the app-wide queue binding). */
export function bindSettingsReplay(): void {
  bindMutationQueue();
}

export function resetPendingSettingsForTests(): void {
  resetMutationQueueForTests();
}
