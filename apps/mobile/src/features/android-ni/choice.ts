/**
 * The user's Android NI choices kept on the device (encrypted MMKV `prefs`, wiped at sign-out):
 * the mode, the category presets, manual app picks, the prominent-disclosure acceptance
 * (`ani.disclosure_accepted_at`, M-ANI-02) and a few flags of the settings flow. `applyChoice`
 * pushes them into the native module; `androidNiRegistration` is the `android_ni` object of
 * `POST /devices/register` (API-DEV-01, the only write path for `app_installations.ni_*`).
 */
import { Platform } from 'react-native';

import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';
import { isNiSupported, niCall, type NiMode } from './native';
import { allowedPackagesFor, DEFAULT_CATEGORIES, type NiCategoryChoice } from './presets';

/** Written by the onboarding step (M-ON-14A) and the settings screen (M-ANI-01). */
export const NI_CHOICE_KEY = 'android_ni.onboarding_choice';
const DISCLOSURE_KEY = 'ani.disclosure_accepted_at';
const RETURNS_KEY = 'ani.returns_without_grant';
const LAPSE_KEY = 'ani.paused_by_lapse';

export interface NiChoice {
  readonly mode: NiMode;
  readonly categories: NiCategoryChoice;
  readonly manual: readonly string[];
}

export const DEFAULT_CHOICE: NiChoice = {
  mode: 'selected',
  categories: DEFAULT_CATEGORIES,
  manual: [],
};

function prefs() {
  return isEncryptedStorageOpen() ? encryptedStorage().prefs : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readChoice(): NiChoice {
  const raw = prefs()?.getString(NI_CHOICE_KEY);
  if (raw === undefined) return DEFAULT_CHOICE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_CHOICE;
    const categories = isRecord(parsed.categories) ? parsed.categories : {};
    const manual = Array.isArray(parsed.manual) ? parsed.manual : [];
    return {
      mode: parsed.mode === 'all' ? 'all' : 'selected',
      categories: {
        shipping: categories.shipping !== false,
        banking: categories.banking !== false,
        airline: categories.airline !== false,
        reservation: categories.reservation === true,
      },
      manual: manual.filter((p): p is string => typeof p === 'string'),
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

/** Stores the choice and applies it to the listener (mode + allowed packages). */
export function applyChoice(choice: NiChoice): void {
  prefs()?.set(NI_CHOICE_KEY, JSON.stringify(choice));
  niCall(undefined, (ni) => {
    ni.setMode(choice.mode);
    ni.setAllowedPackages(allowedPackagesFor(choice.categories, choice.manual));
  });
}

export function disclosureAcceptedAt(): string | null {
  return prefs()?.getString(DISCLOSURE_KEY) ?? null;
}

export function acceptDisclosure(at: Date): void {
  prefs()?.set(DISCLOSURE_KEY, at.toISOString());
}

/** How often the user came back from the system screen without granting access. */
export function returnsWithoutGrant(): number {
  return prefs()?.getNumber(RETURNS_KEY) ?? 0;
}

export function recordReturn(granted: boolean): number {
  const next = granted ? 0 : returnsWithoutGrant() + 1;
  prefs()?.set(RETURNS_KEY, next);
  return next;
}

/** The analysis was switched off because Pro ended; it resumes when Pro returns. */
export function pausedByLapse(): boolean {
  return prefs()?.getBoolean(LAPSE_KEY) ?? false;
}

export function setPausedByLapse(value: boolean): void {
  prefs()?.set(LAPSE_KEY, value);
}

const PACKAGE = /^[a-zA-Z0-9_.]{3,120}$/;

export interface AndroidNiRegistration {
  readonly available: boolean;
  readonly listener_granted: boolean;
  readonly enabled: boolean;
  readonly mode: NiMode;
  readonly allowed_packages: string[];
}

/**
 * The `android_ni` mirror of `POST /devices/register` (Android only; undefined on iOS). In
 * "Tüm uygulamalar" the allowed list is empty; `enabled` is the in-app switch, not the grant.
 */
export function androidNiRegistration(): AndroidNiRegistration | undefined {
  if (Platform.OS !== 'android') return undefined;
  const state = isNiSupported() ? niCall(null, (ni) => ni.getState()) : null;
  if (state === null) {
    return {
      available: false,
      listener_granted: false,
      enabled: false,
      mode: 'selected',
      allowed_packages: [],
    };
  }
  return {
    available: true,
    listener_granted: state.granted,
    enabled: state.enabled,
    mode: state.mode,
    allowed_packages:
      state.mode === 'all'
        ? []
        : state.allowedPackages.filter((p) => PACKAGE.test(p)).slice(0, 200),
  };
}
