/**
 * Auto-save for settings (SCREEN_AND_FLOW_MAP Part 4 §0.5 rule 1–2): every toggle, radio and picker
 * writes its owner row (`user_preferences`, `notification_preferences`, `profiles`) through
 * PostgREST under RLS, optimistically on the cached bootstrap.
 * - Online failure → the cache reverts and the error toast "Kaydedilemedi. Tekrar dene." appears.
 * - Offline (a *queued* write class, §14.2) → the change stays applied, is merged into the pending
 *   patch of its table (encrypted MMKV, survives a restart) and is replayed in order when the
 *   connection returns; rows show "Bağlantı gelince kaydedilecek" while a patch is pending.
 */
import { qk } from '@da/api-client';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { translator } from '../../i18n/translate';
import {
  cachedBootstrap,
  patchBootstrapCache,
  updateNotificationPreferences,
  updateProfile,
  updateUserPreferences,
} from '../../lib/postgrest';
import { isOffline } from '../../lib/query/online-manager';
import { getQueryClient } from '../../lib/query/client';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';
import { showToast } from '../../providers/ToastHost';
import { applyLocalWidgetPrivacy, refreshWidgetSnapshot } from '../widgets/snapshot';
import { flushFeedbackOutbox } from './outbox';

export type OwnTable = 'user_preferences' | 'notification_preferences' | 'profiles';

export interface SaveOptions {
  /** No error toast (the caller reports the failure itself). */
  readonly silent?: boolean;
  /** `keep`: on failure keep the new value and retry later (last write wins, M-SET-60/62). */
  readonly onFailure?: 'revert' | 'keep';
}
export type SaveResult = 'saved' | 'queued' | 'failed';

type Pending = Partial<Record<OwnTable, Readonly<Record<string, unknown>>>>;

const PENDING_KEY = 'settings.pending_writes';
let pending: Pending = {};
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded || !isEncryptedStorageOpen()) return;
  loaded = true;
  const raw = encryptedStorage().prefs.getString(PENDING_KEY);
  if (raw === undefined) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null) pending = value;
  } catch {
    pending = {};
  }
}

function publish(next: Pending): void {
  pending = next;
  if (isEncryptedStorageOpen()) {
    if (Object.keys(next).length === 0) encryptedStorage().prefs.remove(PENDING_KEY);
    else encryptedStorage().prefs.set(PENDING_KEY, JSON.stringify(next));
  }
  for (const listener of listeners) listener();
}

function write(table: OwnTable, patch: Readonly<Record<string, unknown>>): Promise<void> {
  switch (table) {
    case 'user_preferences':
      return updateUserPreferences(patch);
    case 'notification_preferences':
      return updateNotificationPreferences(patch);
    case 'profiles':
      return updateProfile(patch);
  }
}

function enqueue(table: OwnTable, patch: Readonly<Record<string, unknown>>): void {
  load();
  publish({ ...pending, [table]: { ...(pending[table] ?? {}), ...patch } });
}

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
    enqueue(table, patch);
    return 'queued';
  }
  try {
    await write(table, patch);
    return 'saved';
  } catch {
    if (options.onFailure === 'keep') {
      // Device-first settings (theme, language): the local value stays, the write is retried.
      enqueue(table, patch);
      return 'queued';
    }
    if (previous !== undefined) getQueryClient().setQueryData(qk.me.bootstrap(), previous);
    if (options.silent !== true) {
      showToast({ message: translator()('states.error.saveFailed'), kind: 'error' });
    }
    return 'failed';
  }
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

/** Replays the pending patches in table order; a failed table stays pending. */
export async function flushPendingSettings(): Promise<void> {
  load();
  let widgetInputs = false;
  for (const table of ['profiles', 'user_preferences', 'notification_preferences'] as const) {
    const patch = pending[table];
    if (patch === undefined || isOffline()) continue;
    try {
      await write(table, patch);
      const rest = { ...pending };
      Reflect.deleteProperty(rest, table);
      publish(rest);
      if (table !== 'user_preferences') widgetInputs = true;
    } catch {
      // Kept for the next reconnect.
    }
  }
  // A replayed locale or detail level changes what the widget snapshot may show (T-8.25).
  if (widgetInputs) void refreshWidgetSnapshot('settings', { force: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hasPending(): boolean {
  load();
  return Object.keys(pending).length > 0;
}

/** Whether a settings change waits for the connection ("Bağlantı gelince kaydedilecek"). */
export function usePendingSettings(): boolean {
  return useSyncExternalStore(subscribe, hasPending, hasPending);
}

let unsubscribeOnline: (() => void) | null = null;

/** Replays pending settings when the connection returns and on every foreground. */
export function bindSettingsReplay(): void {
  if (unsubscribeOnline !== null) return;
  const offOnline = onlineManager.subscribe((online) => {
    if (!online) return;
    void flushPendingSettings();
    void flushFeedbackOutbox();
  });
  const foreground = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    if (hasPending()) void flushPendingSettings();
    void flushFeedbackOutbox();
  });
  unsubscribeOnline = () => {
    offOnline();
    foreground.remove();
  };
}

export function resetPendingSettingsForTests(): void {
  pending = {};
  loaded = false;
  unsubscribeOnline?.();
  unsubscribeOnline = null;
}
