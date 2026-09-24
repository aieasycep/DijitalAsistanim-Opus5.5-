/**
 * UI preferences (SCREEN_AND_FLOW_MAP §0.4 `useUiPrefsStore`, M-GL-01): theme, language, time zone,
 * reduce motion and haptics. Persisted in the encrypted `da-prefs` store for an instant first
 * frame, and overwritten by the server values from `GET /me/bootstrap` (`preferences.theme`,
 * `locale`, `preferences.timezone`, …), which are the cross-device truth. The Appearance and
 * Language settings screens write here and mirror to `user_preferences` / `profiles`.
 */
import type { Locale } from '@da/i18n';
import type { ThemePreference } from '@da/ui';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { useSyncExternalStore } from 'react';

import { isDemoBuild } from './env';
import { encryptedStorage, isEncryptedStorageOpen } from './storage';

export interface UiPrefs {
  readonly theme: ThemePreference;
  /** Explicit language (`profiles.locale` or the demo setup); `null` follows the device. */
  readonly locale: Locale | null;
  /** `user_preferences.timezone`; `null` follows the device. */
  readonly timeZone: string | null;
  readonly reduceMotion: boolean;
  readonly hapticsEnabled: boolean;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: 'system',
  locale: null,
  timeZone: null,
  reduceMotion: false,
  hapticsEnabled: true,
};

const STORAGE_KEY = 'ui.prefs';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const LOCALES: readonly Locale[] = ['tr', 'en'];

let snapshot: UiPrefs = DEFAULT_UI_PREFS;
const listeners = new Set<() => void>();

function sanitize(value: unknown): UiPrefs {
  if (typeof value !== 'object' || value === null) return DEFAULT_UI_PREFS;
  const v = value as Partial<Record<keyof UiPrefs, unknown>>;
  return {
    theme: THEMES.includes(v.theme as ThemePreference)
      ? (v.theme as ThemePreference)
      : DEFAULT_UI_PREFS.theme,
    locale: LOCALES.includes(v.locale as Locale) ? (v.locale as Locale) : null,
    timeZone: typeof v.timeZone === 'string' && v.timeZone !== '' ? v.timeZone : null,
    reduceMotion: v.reduceMotion === true,
    hapticsEnabled: v.hapticsEnabled !== false,
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Loads the persisted preferences (after `openEncryptedStorage`). */
export function loadUiPrefs(): UiPrefs {
  if (!isEncryptedStorageOpen()) return snapshot;
  const raw = encryptedStorage().prefs.getString(STORAGE_KEY);
  let parsed: unknown = undefined;
  if (raw !== undefined) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }
  snapshot = sanitize(parsed);
  emit();
  return snapshot;
}

export function getUiPrefs(): UiPrefs {
  return snapshot;
}

export function updateUiPrefs(patch: Partial<UiPrefs>): UiPrefs {
  const next = sanitize({ ...snapshot, ...patch });
  const changed = (Object.keys(next) as (keyof UiPrefs)[]).some((k) => next[k] !== snapshot[k]);
  if (!changed) return snapshot;
  snapshot = next;
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(STORAGE_KEY, JSON.stringify(next));
  emit();
  return snapshot;
}

/** `tr-TR` → `tr`, `en-US` → `en`. */
export function languageOf(locale: BootstrapData['locale']): Locale {
  return locale === 'en-US' ? 'en' : 'tr';
}

// ── Demo builds: `demo/setup?locale&theme` outranks the demo account's server values ─────────

const DEMO_OVERRIDE_KEY = 'demo.ui_override';

export type DemoUiOverride = Partial<Pick<UiPrefs, 'theme' | 'locale'>>;

function demoUiOverride(): DemoUiOverride {
  if (!isDemoBuild() || !isEncryptedStorageOpen()) return {};
  const raw = encryptedStorage().prefs.getString(DEMO_OVERRIDE_KEY);
  if (raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null) return {};
  const v = value as Record<string, unknown>;
  return {
    ...(THEMES.includes(v.theme as ThemePreference) ? { theme: v.theme as ThemePreference } : {}),
    ...(LOCALES.includes(v.locale as Locale) ? { locale: v.locale as Locale } : {}),
  };
}

/** Demo builds only: pins language and theme over later bootstrap values (R-21 screenshots). */
export function setDemoUiOverride(override: DemoUiOverride): UiPrefs {
  if (!isDemoBuild()) return snapshot;
  if (isEncryptedStorageOpen()) {
    encryptedStorage().prefs.set(DEMO_OVERRIDE_KEY, JSON.stringify(override));
  }
  return updateUiPrefs(override);
}

/** Adopts the server preferences from bootstrap. */
export function applyBootstrapPreferences(data: BootstrapData): UiPrefs {
  return updateUiPrefs({
    theme: data.preferences.theme,
    locale: languageOf(data.locale),
    timeZone: data.preferences.timezone,
    reduceMotion: data.preferences.reduce_motion,
    hapticsEnabled: data.preferences.haptics_enabled,
    ...demoUiOverride(),
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, getUiPrefs, getUiPrefs);
}

export function resetUiPrefsForTests(): void {
  snapshot = DEFAULT_UI_PREFS;
  emit();
}
