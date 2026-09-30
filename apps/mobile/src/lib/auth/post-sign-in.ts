/**
 * Post-auth pipeline (SCREEN_AND_FLOW_MAP M-ON-05, shared by every method):
 *   1. `POST /devices/register` (installation, platform, versions, locale, time zone, the current
 *      push permission without a token; the server applies the time zone when
 *      `timezone_mode='auto'`);
 *   2. `GET /me/bootstrap` (fresh, not from cache);
 *   3. hooks registered by later features, in registration order: RevenueCat `Purchases.logIn`
 *      (T-8.22; Sentry gets no user id, SECURITY_AND_PRIVACY_PLAN CTL-3.14), the pending referral
 *      code `POST /referrals/apply` (T-8.22), the first-sign-in `profiles` locale/terms write (T-8.06);
 *   4. the device remembers the method (`hasSignedInBefore`).
 * Every step is best effort: a failure never undoes the sign-in. The result tells the caller
 * whether to show the new-account notice (M-ON-05N: sign-in mode created a brand-new profile).
 */
import { qk, type ApiClient } from '@da/api-client';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import type { QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { getApiClient } from '../bootstrap';
import { deviceRegisterBody } from '../device';
import { getQueryClient } from '../query/client';
import { bootstrapQueryOptions } from '@da/api-client/react';
import { installationId } from './first-run-purge';
import { rememberSignIn } from './memory';
import type { AuthMethod } from './result';
import type { AuthMode } from './email-otp';

export interface PostSignInContext {
  readonly userId: string;
  readonly method: AuthMethod;
  readonly mode: AuthMode;
  readonly isNewUser: boolean;
}

export type PostSignInHook = (ctx: PostSignInContext) => Promise<void> | void;

const hooks = new Map<string, PostSignInHook>();

/** Registers a step that runs after every successful sign-in; returns the unregister function. */
export function registerPostSignInHook(name: string, hook: PostSignInHook): () => void {
  hooks.set(name, hook);
  return () => {
    hooks.delete(name);
  };
}

export interface PostSignInDeps {
  readonly api?: ApiClient;
  readonly queryClient?: QueryClient;
  readonly installationId?: () => string | null;
}

export interface PostSignInResult {
  readonly bootstrap: BootstrapData | null;
  /** M-ON-05N: sign-in mode, but the profile was just created and never onboarded. */
  readonly showNewAccountNotice: boolean;
  readonly failedSteps: readonly string[];
}

/** A profile younger than 60 s with no onboarding step is a new account (M-ON-05N). */
export function isFreshProfile(data: BootstrapData, now: number = Date.now()): boolean {
  const created = Date.parse(data.profile.created_at);
  return (
    data.profile.onboarding.step === null &&
    data.profile.onboarding.completed_at === null &&
    Number.isFinite(created) &&
    now - created < 60_000
  );
}

export async function runPostSignIn(
  ctx: PostSignInContext,
  deps: PostSignInDeps = {},
): Promise<PostSignInResult> {
  const api = deps.api ?? getApiClient();
  const queryClient = deps.queryClient ?? getQueryClient();
  const failedSteps: string[] = [];
  rememberSignIn(ctx.method);

  const install = (deps.installationId ?? installationId)();
  if (install === null) failedSteps.push('devices_register');
  else {
    try {
      await api.call(
        'POST /devices/register',
        { body: await deviceRegisterBody(install) },
        { idempotencyKey: Crypto.randomUUID() },
      );
    } catch {
      failedSteps.push('devices_register');
    }
  }

  let bootstrap: BootstrapData | null = null;
  try {
    await queryClient.invalidateQueries({ queryKey: qk.me.bootstrap(), refetchType: 'none' });
    bootstrap = await queryClient.query({ ...bootstrapQueryOptions(api), staleTime: 0 });
  } catch {
    failedSteps.push('bootstrap');
  }

  for (const [name, hook] of hooks) {
    try {
      await hook(ctx);
    } catch {
      failedSteps.push(name);
    }
  }

  return {
    bootstrap,
    showNewAccountNotice:
      ctx.mode === 'signin' && (ctx.isNewUser || (bootstrap !== null && isFreshProfile(bootstrap))),
    failedSteps,
  };
}
