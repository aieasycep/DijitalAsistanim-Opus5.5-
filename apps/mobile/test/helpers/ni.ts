/**
 * Android NI test double: an in-memory `notification-intelligence` module (grant, switch, mode,
 * allowed packages, candidate apps and the signal buffer) plus a Platform switch, since the
 * jest-expo preset renders as iOS.
 */
import { jest } from '@jest/globals';
import { Platform } from 'react-native';

import type {
  NiCandidateApp,
  NiMode,
  NiSignal,
  NotificationIntelligenceNative,
} from '../../src/features/android-ni/native';
import { setNotificationIntelligenceForTests } from '../../src/features/android-ni/native';

export interface FakeNiState {
  granted: boolean;
  enabled: boolean;
  mode: NiMode;
  allowedPackages: string[];
}

/** Every native function as a plain jest mock (no methods, so no unbound-method pitfalls). */
export type FakeNiModule = {
  readonly [K in keyof NotificationIntelligenceNative]: jest.Mock<(...args: never[]) => unknown>;
};

export interface FakeNi {
  readonly module: FakeNiModule;
  readonly state: FakeNiState;
  readonly buffer: { signal: NiSignal; uploaded: boolean }[];
  emit(event: 'onGrantChanged' | 'onSignalsChanged', payload?: unknown): void;
}

export const hash = (n: number): string => n.toString(16).padStart(64, '0');

export function niSignal(n: number, overrides: Partial<NiSignal> = {}): NiSignal {
  return {
    signal_hash: hash(n),
    package: 'trendyol.com',
    app_label: 'Trendyol',
    category: 'cargo',
    tracking_status: 'out_for_delivery',
    posted_at: '2027-01-10T08:30:00.000Z',
    ...overrides,
  };
}

export const CANDIDATE_APPS: readonly NiCandidateApp[] = [
  {
    package: 'trendyol.com',
    label: 'Trendyol',
    seenCount: 12,
    lastSeenAt: '2027-01-10T08:30:00.000Z',
    locked: false,
    lockedGroup: null,
  },
  {
    package: 'com.getir',
    label: 'Getir',
    seenCount: 3,
    lastSeenAt: '2027-01-09T08:30:00.000Z',
    locked: false,
    lockedGroup: null,
  },
  {
    package: 'com.example.notes',
    label: 'Notlar',
    seenCount: 0,
    lastSeenAt: null,
    locked: false,
    lockedGroup: null,
  },
  {
    package: 'com.whatsapp',
    label: 'WhatsApp',
    seenCount: 40,
    lastSeenAt: '2027-01-10T08:00:00.000Z',
    locked: true,
    lockedGroup: 'messaging',
  },
];

export function installFakeNi(initial: Partial<FakeNiState> = {}): FakeNi {
  const state: FakeNiState = {
    granted: false,
    enabled: false,
    mode: 'selected',
    allowedPackages: [],
    ...initial,
  };
  const buffer: { signal: NiSignal; uploaded: boolean }[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const module = {
    isAvailable: jest.fn(() => true),
    isGranted: jest.fn(() => state.granted),
    openSettings: jest.fn(() => true),
    getState: jest.fn(() => ({ ...state, allowedPackages: [...state.allowedPackages] })),
    setEnabled: jest.fn((enabled: boolean) => {
      state.enabled = enabled;
    }),
    setMode: jest.fn((mode: NiMode) => {
      state.mode = mode;
    }),
    setAllowedPackages: jest.fn((packages: readonly string[]) => {
      state.allowedPackages = [...packages];
    }),
    listCandidateApps: jest.fn(() => CANDIDATE_APPS),
    getPendingSignals: jest.fn((limit: number) =>
      buffer
        .filter((e) => !e.uploaded)
        .slice(0, limit)
        .map((e) => e.signal),
    ),
    getRecentSignals: jest.fn((limit: number) =>
      buffer.slice(0, limit).map((e) => ({ ...e.signal, uploaded: e.uploaded })),
    ),
    markUploaded: jest.fn((hashes: readonly string[]) => {
      for (const entry of buffer)
        if (hashes.includes(entry.signal.signal_hash)) entry.uploaded = true;
    }),
    deleteSignal: jest.fn((h: string) => {
      const i = buffer.findIndex((e) => e.signal.signal_hash === h);
      if (i >= 0) buffer.splice(i, 1);
    }),
    clearBuffer: jest.fn(() => {
      buffer.length = 0;
    }),
    disable: jest.fn(() => {
      state.enabled = false;
    }),
    reset: jest.fn(() => {
      buffer.length = 0;
      state.enabled = false;
    }),
    addListener: jest.fn((event: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return {
        remove: () => {
          set.delete(listener);
        },
      };
    }),
  };
  setNotificationIntelligenceForTests(module);
  return {
    module,
    state,
    buffer,
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
}

const ORIGINAL_OS = Platform.OS;

/** Renders the next code as Android (undo with `restorePlatform`). */
export function asAndroid(): void {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true, writable: true });
}

export function restorePlatform(): void {
  Object.defineProperty(Platform, 'OS', { value: ORIGINAL_OS, configurable: true, writable: true });
  setNotificationIntelligenceForTests(undefined);
}
