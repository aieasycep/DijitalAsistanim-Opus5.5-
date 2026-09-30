/**
 * M-ON-15 onboarding completion handoff (no UI): `PATCH profiles {onboarding_step:'done',
 * onboarding_completed_at}`, then Today with the first briefing pushed on top so Back lands on
 * Today (D-05). The cached bootstrap is marked complete first, which is what the guards read, so a
 * failed or offline PATCH still lets the user in; a failed write is retried when the connection
 * returns (the server value wins on the next bootstrap refresh).
 */
import { qk } from '@da/api-client';
import type { router as appRouter } from 'expo-router';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { queueMutation } from '../../lib/offline/mutations';
import { cachedBootstrap, patchBootstrapCache, updateProfile } from '../../lib/postgrest';
import { getQueryClient } from '../../lib/query/client';
import { getOnboardingState, resetOnboardingState } from './store';

export interface CompleteOptions {
  readonly briefingId?: string | null;
}

export async function completeOnboarding(
  router: Pick<typeof appRouter, 'replace' | 'push'>,
  options: CompleteOptions = {},
): Promise<void> {
  const at = now();
  const state = getOnboardingState();
  const accounts = cachedBootstrap()?.accounts ?? [];
  const started = state.startedAt === null ? at.getTime() : Date.parse(state.startedAt);
  track('onboarding_completed', {
    mail_connected: accounts.some((a) => a.capabilities_granted.includes('mail_read')),
    calendar_connected: accounts.some((a) => a.capabilities_granted.includes('calendar_read')),
    skipped_count: state.skippedSteps.length,
    duration_s: Math.max(0, Math.min(86_400, Math.round((at.getTime() - started) / 1000))),
  });
  patchBootstrapCache((data) => ({
    ...data,
    profile: {
      ...data.profile,
      onboarding: { step: 'done', completed_at: at.toISOString() },
    },
  }));
  const patch = { onboarding_step: 'done', onboarding_completed_at: at.toISOString() } as const;
  // Offline or failed: the offline mutation queue (T-8.23) replays it (last write wins).
  await updateProfile(patch).catch(() => {
    queueMutation('own_row', { table: 'profiles', patch });
  });
  resetOnboardingState();
  void getQueryClient().invalidateQueries({ queryKey: qk.today.all });
  // The guard change that opens `(tabs)` lands in the same commit; navigate on the next tick.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  router.replace('/today');
  const briefing = options.briefingId ?? null;
  if (briefing !== null) router.push(`/briefing/${briefing}?via=onboarding`);
}
