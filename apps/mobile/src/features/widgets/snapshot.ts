/**
 * Widget snapshot bridge (T-8.25; SCREEN_AND_FLOW_MAP §11.2–§11.4, API-WDG-01). The widgets never
 * reach the network: the app fetches `GET /widgets/snapshot` (rendered server-side under the
 * effective notification detail level), validates it and writes it through `DaWidgets`, which
 * redraws them.
 *
 * - Triggers: foreground (5-min floor), a Today refetch, a push in the foreground, count-changing
 *   mutations, the `da-background-refresh` task, a detail-level / lock-screen / language /
 *   entitlement change and sign-in (forced, no floor). Non-forced triggers within 30 s of a write
 *   coalesce; an unchanged `etag` does not redraw (`not_modified`), which saves the iOS reload
 *   budget.
 * - Privacy: the local detail level is a ceiling — a snapshot never shows more than the setting the
 *   user last chose on this device, even before a queued offline change reaches the server; a
 *   lowered level re-filters the stored snapshot at once (§11.2 "Offline level changes").
 * - Sign-out and account deletion write `{state:'signed_out'}` (`LOGOUT_HOOKS.widgetSnapshot`); a
 *   fetch still in flight is discarded.
 * - Server links use `dijitalasistan://`; they are rewritten to this build's scheme so a variant's
 *   widget opens its own app.
 */
import { fetchWidgetSnapshot } from '@da/api-client/react';
import { DEEP_LINK_PREFIX, DEEP_LINK_SCHEME } from '@da/domain';
import {
  downgradeWidgetSnapshot,
  signedOutWidgetSnapshot,
  type WidgetSnapshotV1,
} from '@da/validation/widget-snapshot';

import * as DaWidgets from '../../../modules/da-widgets/src';
import { deviceLocale } from '../../i18n/I18nProvider';
import { LOGOUT_HOOKS, registerLogoutCleanup } from '../../lib/auth/logout';
import { registerBackgroundRefreshStep } from '../../lib/background-refresh';
import { getApiClient } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { getClientEnv } from '../../lib/env';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { isOffline } from '../../lib/query/online-manager';
import { getUiPrefs } from '../../lib/ui-prefs';

export type WidgetTrigger =
  'foreground' | 'background' | 'push' | 'approval' | 'login' | 'logout' | 'settings';
export type WidgetRefreshResult = 'ok' | 'not_modified' | 'failed' | 'skipped';

/** Foreground refreshes wait 5 min after the last write (§11.4). */
export const FOREGROUND_FLOOR_MS = 5 * 60_000;
/** Other non-forced triggers within 30 s of a write coalesce into it. */
export const COALESCE_MS = 30_000;

interface BridgeState {
  lastWriteAt: number;
  /** `etag` of the last server snapshot written this session (null after a local write). */
  etag: string | null;
  inflight: Promise<WidgetRefreshResult> | null;
  /** Bumped by sign-out; a fetch that started before it is not written. */
  generation: number;
  inventoryReported: boolean;
}

const initialState = (): BridgeState => ({
  lastWriteAt: 0,
  etag: null,
  inflight: null,
  generation: 0,
  inventoryReported: false,
});

let state = initialState();

export function resetWidgetBridgeForTests(): void {
  state = initialState();
}

function appScheme(): string {
  return getClientEnv().EXPO_PUBLIC_APP_SCHEME;
}

/** Rewrites `dijitalasistan://…` links to this build's scheme (`dijitalasistan-dev://…`). */
export function withAppScheme(snapshot: WidgetSnapshotV1, scheme: string): WidgetSnapshotV1 {
  if (scheme === DEEP_LINK_SCHEME) return snapshot;
  const relink = <T extends { deeplink: string }>(entry: T): T =>
    entry.deeplink.startsWith(DEEP_LINK_PREFIX)
      ? { ...entry, deeplink: `${scheme}://${entry.deeplink.slice(DEEP_LINK_PREFIX.length)}` }
      : entry;
  return {
    ...snapshot,
    briefing: snapshot.briefing === null ? null : relink(snapshot.briefing),
    priorities: snapshot.priorities.map(relink),
    next_meeting: snapshot.next_meeting === null ? null : relink(snapshot.next_meeting),
    later_meetings: snapshot.later_meetings.map(relink),
    follow_up: snapshot.follow_up === null ? null : relink(snapshot.follow_up),
  };
}

/**
 * Caps a snapshot at the detail level and lock-screen privacy the user chose on this device (the
 * optimistic bootstrap cache), so a queued offline change can never be overtaken by the server.
 */
export function applyLocalPrivacy(snapshot: WidgetSnapshotV1): WidgetSnapshotV1 {
  const prefs = cachedBootstrap()?.notification_preferences;
  if (prefs === undefined) return snapshot;
  const capped = downgradeWidgetSnapshot(snapshot, prefs.detail_level);
  return prefs.lock_screen_private && !capped.lock_screen_private
    ? { ...capped, lock_screen_private: true }
    : capped;
}

async function write(snapshot: WidgetSnapshotV1, fromServer: boolean): Promise<void> {
  await DaWidgets.setSnapshot(snapshot, appScheme());
  state.lastWriteAt = now().getTime();
  state.etag = fromServer ? snapshot.etag : null;
}

async function fetchAndWrite(trigger: WidgetTrigger): Promise<WidgetRefreshResult> {
  const generation = state.generation;
  let result: WidgetRefreshResult;
  try {
    const data = await fetchWidgetSnapshot(getApiClient());
    if (generation !== state.generation) return 'skipped';
    const capped = applyLocalPrivacy(data);
    if (capped === data && data.etag === state.etag) {
      state.lastWriteAt = now().getTime();
      result = 'not_modified';
    } else {
      await write(withAppScheme(capped, appScheme()), capped === data);
      result = 'ok';
    }
  } catch {
    result = 'failed';
  }
  track('widget_snapshot_refreshed', { trigger, result });
  return result;
}

function run(trigger: WidgetTrigger, after: Promise<unknown> | null): Promise<WidgetRefreshResult> {
  const promise = (after ?? Promise.resolve())
    .then(() => fetchAndWrite(trigger))
    .finally(() => {
      if (state.inflight === promise) state.inflight = null;
    });
  state.inflight = promise;
  return promise;
}

export interface RefreshOptions {
  /** Privacy, language, entitlement and sign-in changes skip the floors (§11.4). */
  readonly force?: boolean;
  /** A Today refetch while the app is open: only the 30 s coalescing applies. */
  readonly afterRefetch?: boolean;
}

/** Fetches and writes the snapshot unless a floor, the connection or the platform says no. */
export function refreshWidgetSnapshot(
  trigger: WidgetTrigger,
  options: RefreshOptions = {},
): Promise<WidgetRefreshResult> {
  if (!DaWidgets.isWidgetBridgeAvailable() || isOffline()) return Promise.resolve('skipped');
  const force = options.force === true;
  const age = now().getTime() - state.lastWriteAt;
  const floor =
    trigger === 'foreground' && options.afterRefetch !== true ? FOREGROUND_FLOOR_MS : COALESCE_MS;
  if (!force && age < floor) {
    return Promise.resolve('skipped');
  }
  if (state.inflight !== null) {
    // A forced refresh runs after the one in flight, so the widget ends on the new settings.
    return force ? run(trigger, state.inflight) : state.inflight;
  }
  return run(trigger, null);
}

/**
 * A detail-level or lock-screen change (M-SET-20): the stored snapshot is re-filtered at once
 * (lowering needs no network); returns whether anything was rewritten.
 */
export async function applyLocalWidgetPrivacy(): Promise<boolean> {
  if (!DaWidgets.isWidgetBridgeAvailable()) return false;
  const stored = await DaWidgets.getSnapshot();
  if (stored === null) return false;
  const next = applyLocalPrivacy(stored);
  if (next === stored) return false;
  await write(next, false);
  return true;
}

function widgetLocale(): 'tr' | 'en' {
  return (getUiPrefs().locale ?? deviceLocale()) === 'en' ? 'en' : 'tr';
}

/** Sign-out / account deletion (CTL-3.13): the widgets show "Giriş yap" and nothing else. */
export async function clearWidgetSnapshot(): Promise<void> {
  state.generation += 1;
  state.etag = null;
  state.lastWriteAt = 0;
  if (!DaWidgets.isWidgetBridgeAvailable()) return;
  let result: WidgetRefreshResult = 'ok';
  try {
    await DaWidgets.setSnapshot(signedOutWidgetSnapshot(now(), widgetLocale()), appScheme());
  } catch {
    result = 'failed';
  }
  track('widget_snapshot_refreshed', { trigger: 'logout', result });
}

/** `widget_inventory`, once per app session. */
export async function reportWidgetInventory(): Promise<void> {
  if (state.inventoryReported || !DaWidgets.isWidgetBridgeAvailable()) return;
  state.inventoryReported = true;
  try {
    const inventory = await DaWidgets.getInventory();
    if (inventory !== null) {
      track('widget_inventory', {
        ios_families: inventory.ios_families,
        android_kinds: inventory.android_kinds,
      });
    }
  } catch {
    // Best effort.
  }
}

registerLogoutCleanup(LOGOUT_HOOKS.widgetSnapshot, clearWidgetSnapshot);
registerBackgroundRefreshStep('widgets.snapshot', () => refreshWidgetSnapshot('background'));
