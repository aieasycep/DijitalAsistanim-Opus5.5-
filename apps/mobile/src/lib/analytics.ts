/**
 * Analytics delivery (T-8.28; API-ANL-01, SCREEN_AND_FLOW_MAP §0.9 and Part 4 §15, R-21,
 * SECURITY_AND_PRIVACY_PLAN §4.9). `track()` (`events.ts`) validates every event against the
 * `@da/domain` catalogue; this batcher is its sink:
 * - each event is validated again (only catalogue names, only content-free props: closed enums,
 *   booleans, bounded integers, screen ids, route patterns) and gets the common `is_pro` prop;
 * - events wait in a persisted buffer (encrypted `da-prefs`, at most 500, 24 h) and are sent as
 *   `POST /analytics/events {session_id, events}` in batches of at most 50: after 20 events, every
 *   30 s while in the foreground, and when the app goes to the background;
 * - `user_preferences.analytics_opt_out` stops everything: nothing is buffered or sent, and what
 *   was buffered is discarded. Builds with `EXPO_PUBLIC_ANALYTICS_ENABLED=false` never register the
 *   sink (events stay in `events.ts`'s bounded memory buffer and are never sent);
 * - network and server failures keep the batch for the next flush; a rejected batch is dropped.
 * App lifecycle events come from here: `app_opened {source}` and `app_backgrounded {session_s}`.
 */
import type { ApiClient } from '@da/api-client';
import {
  ANALYTICS_BATCH_MAX,
  analyticsEventsMutationOptions,
  type AnalyticsBatchBody,
} from '@da/api-client/react';
import { validateAnalyticsEvent } from '@da/domain/analytics/index';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { AppState, type AppStateStatus } from 'react-native';

import { LOGOUT_HOOKS, registerLogoutCleanup } from './auth/logout';
import { getApiClient } from './bootstrap';
import { getClientEnv } from './env';
import { setAnalyticsSink, track, type TrackedEvent } from './events';
import { classifyReplayError } from './offline/mutation-queue';
import { cachedBootstrap } from './postgrest';
import { runMutation } from './query/run-mutation';
import { isOffline } from './query/online-manager';
import { encryptedStorage, isEncryptedStorageOpen } from './storage';

export const ANALYTICS_FLUSH_AT = 20;
export const ANALYTICS_FLUSH_INTERVAL_MS = 30_000;
export const ANALYTICS_BUFFER_MAX = 500;
export const ANALYTICS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A new analytics session starts after this long in the background. */
export const ANALYTICS_SESSION_IDLE_MS = 30 * 60 * 1000;
export const ANALYTICS_STORAGE_KEY = 'analytics.buffer.v1';

export type BatchItem = AnalyticsBatchBody['events'][number];

export interface BufferedItem {
  readonly name: string;
  readonly ts: string;
  readonly screen?: string;
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

export interface AnalyticsStorage {
  read(): string | undefined;
  write(value: string | null): void;
}

export interface AnalyticsDeps {
  readonly send: (body: AnalyticsBatchBody) => Promise<unknown>;
  readonly storage: () => AnalyticsStorage | null;
  readonly isOnline: () => boolean;
  /** `true` opted out, `false` opted in, `null` unknown (not signed in yet: keep, do not send). */
  readonly optedOut: () => boolean | null;
  readonly isPro: () => boolean | null;
  readonly newId: () => string;
  readonly now?: () => number;
}

/** Validates one tracked event into a batch item; `null` when it is not allowed. */
export function toBatchItem(event: TrackedEvent, isPro: boolean | null): BufferedItem | null {
  const withCommon =
    isPro === null || 'is_pro' in event.props ? event.props : { ...event.props, is_pro: isPro };
  const result = validateAnalyticsEvent(event.event, withCommon);
  if (!result.ok) return null;
  const { screen, ...props } = result.props;
  return {
    name: result.event,
    ts: event.occurredAt,
    ...(typeof screen === 'string' ? { screen } : {}),
    props,
  };
}

function isItem(value: unknown): value is BufferedItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === 'string' && typeof item.ts === 'string';
}

export function createAnalyticsBatcher(deps: AnalyticsDeps) {
  const now = deps.now ?? Date.now;
  let memory: BufferedItem[] = [];
  let loaded = false;
  let sessionId = deps.newId();
  let sending: Promise<void> | null = null;

  function read(): BufferedItem[] {
    const storage = deps.storage();
    if (storage === null || loaded) return memory;
    loaded = true;
    const raw = storage.read();
    if (raw === undefined) return memory;
    try {
      const value: unknown = JSON.parse(raw);
      const persisted = Array.isArray(value) ? value.filter(isItem) : [];
      memory = [...persisted, ...memory];
    } catch {
      // A corrupt buffer is dropped.
    }
    return memory;
  }

  function write(items: readonly BufferedItem[]): void {
    const cutoff = now() - ANALYTICS_MAX_AGE_MS;
    memory = items
      .filter((item) => {
        const at = Date.parse(item.ts);
        return !Number.isFinite(at) || at >= cutoff;
      })
      .slice(-ANALYTICS_BUFFER_MAX);
    deps.storage()?.write(memory.length === 0 ? null : JSON.stringify(memory));
  }

  /** Empties the buffer (opt-out, logout). */
  function clear(): void {
    loaded = deps.storage() !== null;
    write([]);
  }

  function sink(event: TrackedEvent): void {
    if (deps.optedOut() === true) {
      if (read().length > 0) clear();
      return;
    }
    const item = toBatchItem(event, deps.isPro());
    if (item === null) return;
    write([...read(), item]);
    if (memory.length >= ANALYTICS_FLUSH_AT) void flush();
  }

  async function sendAll(): Promise<void> {
    for (;;) {
      if (!deps.isOnline()) return;
      const optedOut = deps.optedOut();
      if (optedOut === null) return;
      if (optedOut) {
        clear();
        return;
      }
      const batch = read().slice(0, ANALYTICS_BATCH_MAX);
      if (batch.length === 0) return;
      try {
        await deps.send({ session_id: sessionId, events: batch });
      } catch (error) {
        const outcome = classifyReplayError(error);
        if (outcome !== 'terminal') return;
      }
      // Delivered, or rejected as a whole: either way this batch leaves the buffer.
      write(read().slice(batch.length));
    }
  }

  /** Sends everything buffered (concurrent calls share one run). */
  function flush(): Promise<void> {
    sending ??= sendAll().finally(() => {
      sending = null;
    });
    return sending;
  }

  function newSession(): void {
    sessionId = deps.newId();
  }

  return {
    sink,
    flush,
    clear,
    newSession,
    pending: (): readonly BufferedItem[] => read(),
    sessionId: () => sessionId,
  };
}

export type AnalyticsBatcher = ReturnType<typeof createAnalyticsBatcher>;

function prefsStorage(): AnalyticsStorage | null {
  if (!isEncryptedStorageOpen()) return null;
  const prefs = encryptedStorage().prefs;
  return {
    read: () => prefs.getString(ANALYTICS_STORAGE_KEY),
    write: (value) => {
      if (value === null) prefs.remove(ANALYTICS_STORAGE_KEY);
      else prefs.set(ANALYTICS_STORAGE_KEY, value);
    },
  };
}

/** The app batcher over the real API client, the preference store and the cached bootstrap. */
export function createAppAnalyticsBatcher(api: () => ApiClient = getApiClient): AnalyticsBatcher {
  return createAnalyticsBatcher({
    send: (body) => runMutation(analyticsEventsMutationOptions(api()), body),
    storage: prefsStorage,
    isOnline: () => !isOffline(),
    optedOut: () => {
      const data = cachedBootstrap();
      return data === undefined ? null : data.preferences.analytics_opt_out;
    },
    isPro: () => cachedBootstrap()?.entitlement.is_active ?? null,
    newId: () => Crypto.randomUUID(),
  });
}

let active: { readonly batcher: AnalyticsBatcher; readonly stop: () => void } | null = null;

/**
 * Starts delivery once per process (after the encrypted store opened): registers the sink, sends
 * `app_opened`, flushes every 30 s in the foreground and on backgrounding.
 */
export function startAnalytics(): AnalyticsBatcher | null {
  if (active !== null) return active.batcher;
  if (!getClientEnv().EXPO_PUBLIC_ANALYTICS_ENABLED) return null;
  const batcher = createAppAnalyticsBatcher();
  setAnalyticsSink(batcher.sink);
  let foregroundAt = Date.now();
  let backgroundAt: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const startTimer = () => {
    timer ??= setInterval(() => {
      void batcher.flush();
    }, ANALYTICS_FLUSH_INTERVAL_MS);
  };
  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const coldFromPush = Notifications.getLastNotificationResponse() !== null;
  track('app_opened', { source: coldFromPush ? 'push' : 'cold' });
  startTimer();
  const onChange = (state: AppStateStatus) => {
    if (state === 'active') {
      if (backgroundAt === null) return;
      if (Date.now() - backgroundAt > ANALYTICS_SESSION_IDLE_MS) batcher.newSession();
      backgroundAt = null;
      foregroundAt = Date.now();
      track('app_opened', { source: 'warm' });
      startTimer();
      return;
    }
    if (state === 'background' && backgroundAt === null) {
      backgroundAt = Date.now();
      track('app_backgrounded', {
        session_s: Math.min(86_400, Math.max(0, Math.round((backgroundAt - foregroundAt) / 1000))),
      });
      stopTimer();
      void batcher.flush();
    }
  };
  const subscription = AppState.addEventListener('change', onChange);
  active = {
    batcher,
    stop: () => {
      subscription.remove();
      stopTimer();
      setAnalyticsSink(null);
    },
  };
  return batcher;
}

registerLogoutCleanup(LOGOUT_HOOKS.analyticsBuffer, () => {
  active?.batcher.clear();
});

/** Test seam. */
export function stopAnalyticsForTests(): void {
  active?.stop();
  active = null;
}
