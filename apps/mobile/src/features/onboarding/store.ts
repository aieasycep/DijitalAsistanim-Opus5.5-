/**
 * `useOnboardingStore` (SCREEN_AND_FLOW_MAP §0.4): device-local onboarding state in the encrypted
 * preference store — the intro page, whether every source was skipped (C-17 path), the First
 * Analysis job and attempt, when onboarding started and which steps were skipped. The server keeps
 * the resumable step (`profiles.onboarding_step`); this store only holds what the device needs.
 */
import { useSyncExternalStore } from 'react';

import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';

export interface OnboardingState {
  readonly introIndex: number;
  readonly skippedAllSources: boolean;
  readonly analysisJobId: string | null;
  readonly analysisAttempt: number;
  readonly startedAt: string | null;
  readonly skippedSteps: readonly string[];
  /** The first briefing created by the analysis (opened after onboarding, D-05). */
  readonly firstBriefingId: string | null;
}

const KEY = 'onboarding.state';

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  introIndex: 0,
  skippedAllSources: false,
  analysisJobId: null,
  analysisAttempt: 1,
  startedAt: null,
  skippedSteps: [],
  firstBriefingId: null,
};

let snapshot: OnboardingState | null = null;
const listeners = new Set<() => void>();

function load(): OnboardingState {
  if (!isEncryptedStorageOpen()) return INITIAL_ONBOARDING_STATE;
  const raw = encryptedStorage().prefs.getString(KEY);
  if (raw === undefined) return INITIAL_ONBOARDING_STATE;
  try {
    return { ...INITIAL_ONBOARDING_STATE, ...(JSON.parse(raw) as Partial<OnboardingState>) };
  } catch {
    return INITIAL_ONBOARDING_STATE;
  }
}

export function getOnboardingState(): OnboardingState {
  snapshot ??= load();
  return snapshot;
}

export function updateOnboardingState(patch: Partial<OnboardingState>): OnboardingState {
  const next = { ...getOnboardingState(), ...patch };
  snapshot = next;
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
  return next;
}

/** Records a skipped step once (for `onboarding_completed.skipped_count`). */
export function markStepSkipped(step: string): void {
  const state = getOnboardingState();
  if (!state.skippedSteps.includes(step)) {
    updateOnboardingState({ skippedSteps: [...state.skippedSteps, step] });
  }
}

export function resetOnboardingState(): void {
  snapshot = INITIAL_ONBOARDING_STATE;
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.remove(KEY);
  for (const listener of listeners) listener();
}

/** Test seam: forget the in-memory copy (the next read loads from storage). */
export function resetOnboardingStoreForTests(): void {
  snapshot = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOnboardingState(): OnboardingState {
  return useSyncExternalStore(subscribe, getOnboardingState, getOnboardingState);
}
