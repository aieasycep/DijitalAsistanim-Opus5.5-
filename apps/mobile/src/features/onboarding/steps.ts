/**
 * The post-auth onboarding order (M§34 as resolved in C-01, D-01…D-05): connect mail → connect
 * calendar → permissions → personalization → briefing schedule → VIP → First Analysis → Aha →
 * notifications → Android notification access (Android only) → Today. With zero sources the VIP,
 * analysis and Aha steps are skipped (C-17, D-03); VIP also needs a mail account. Each step writes
 * `profiles.onboarding_step` on entry so the entry resolver resumes there (M-GL-02); the cached
 * bootstrap is updated first so the guards agree immediately.
 */
import type { Href } from 'expo-router';
import { Platform } from 'react-native';

import { track } from '../../lib/events';
import { patchBootstrapCache, updateProfile } from '../../lib/postgrest';
import { now } from '../../lib/clock';
import { ONBOARDING_STEP_ROUTES, type OnboardingStep } from '../../lib/router-guards';
import { getOnboardingState, markStepSkipped, updateOnboardingState } from './store';

export const STEP_ORDER: readonly OnboardingStep[] = [
  'connect_mail',
  'connect_calendar',
  'permissions',
  'personalization',
  'briefing_schedule',
  'vip',
  'analysis',
  'ready',
  'notifications',
  'android_notifications',
];

export interface StepContext {
  readonly skippedAllSources: boolean;
  readonly hasMail: boolean;
  readonly platform: 'ios' | 'android';
}

function applies(step: OnboardingStep, ctx: StepContext): boolean {
  switch (step) {
    case 'vip':
      return !ctx.skippedAllSources && ctx.hasMail;
    case 'analysis':
    case 'ready':
      return !ctx.skippedAllSources;
    case 'android_notifications':
      return ctx.platform === 'android';
    default:
      return true;
  }
}

/** The step after `from` for this context, or `done`. */
export function nextStep(from: OnboardingStep, ctx: StepContext): OnboardingStep | 'done' {
  const index = STEP_ORDER.indexOf(from);
  for (const step of STEP_ORDER.slice(index + 1)) {
    if (applies(step, ctx)) return step;
  }
  return 'done';
}

export function routeOf(step: OnboardingStep): Href {
  return ONBOARDING_STEP_ROUTES[step];
}

export function stepContext(hasMail: boolean): StepContext {
  return {
    skippedAllSources: getOnboardingState().skippedAllSources,
    hasMail,
    platform: Platform.OS === 'android' ? 'android' : 'ios',
  };
}

/**
 * Called when a step screen mounts: records the resumable step (optimistic cache + PATCH; a failure
 * is retried by the next step's write) and the `onboarding_step_viewed` event.
 */
export function enterStep(step: OnboardingStep): void {
  if (getOnboardingState().startedAt === null) {
    updateOnboardingState({ startedAt: now().toISOString() });
  }
  track('onboarding_step_viewed', { step });
  patchBootstrapCache((data) =>
    data.profile.onboarding.step === step
      ? data
      : { ...data, profile: { ...data.profile, onboarding: { ...data.profile.onboarding, step } } },
  );
  void updateProfile({ onboarding_step: step }).catch(() => undefined);
}

/** "Şimdilik geç" / "Atla" on a step. */
export function skipStep(step: OnboardingStep): void {
  track('onboarding_skipped', { step });
  markStepSkipped(step);
}
