/**
 * M-GL-02 entry resolver truth table and the guard order of T-8.04:
 * auth → onboarding step → min_supported_version → account disabled.
 */
import { describe, expect, it } from '@jest/globals';

import {
  ONBOARDING_STEP_ROUTES,
  entryAnalyticsTarget,
  guardFlags,
  onboardingStepOf,
  resolveEntryTarget,
  type EntryContext,
} from '../src/lib/router-guards';
import { bootstrap } from './helpers/fixtures';

const none = () => false;
const all = () => true;

function ctx(overrides: Partial<EntryContext> = {}): EntryContext {
  return {
    auth: 'signed_in',
    hasSignedInBefore: true,
    bootstrap: { status: 'success', data: bootstrap() },
    online: true,
    isScreenAvailable: none,
    ...overrides,
  };
}

function notOnboarded(step: string | null) {
  return bootstrap({
    profile: {
      ...bootstrap().profile,
      onboarding: { step, completed_at: null },
    },
  });
}

describe('resolveEntryTarget', () => {
  it('waits while the session restores', () => {
    expect(resolveEntryTarget(ctx({ auth: 'loading' }))).toEqual({ kind: 'loading' });
  });

  it('1. auth: returning users sign in, first runs get the intro or sign-up', () => {
    expect(resolveEntryTarget(ctx({ auth: 'signed_out' }))).toEqual({
      kind: 'sign_in',
      href: '/sign-in?mode=signin',
    });
    expect(resolveEntryTarget(ctx({ auth: 'signed_out', hasSignedInBefore: false }))).toEqual({
      kind: 'sign_in',
      href: '/sign-in?mode=signup',
    });
    const withIntro = ctx({
      auth: 'signed_out',
      hasSignedInBefore: false,
      introIndex: 2,
      isScreenAvailable: (p) => p === '/welcome',
    });
    expect(resolveEntryTarget(withIntro)).toEqual({ kind: 'welcome', href: '/welcome?page=2' });
  });

  it('waits for bootstrap, then reports offline or failure without a cached copy', () => {
    const pending = ctx({ bootstrap: { status: 'pending', data: undefined } });
    expect(resolveEntryTarget(pending)).toEqual({ kind: 'loading' });
    const failed = ctx({ bootstrap: { status: 'error', data: undefined } });
    expect(resolveEntryTarget(failed)).toEqual({ kind: 'bootstrap_error' });
    expect(resolveEntryTarget({ ...failed, online: false })).toEqual({ kind: 'offline' });
    // Offline the query is paused, never settles: the offline state shows at once.
    expect(resolveEntryTarget({ ...pending, online: false })).toEqual({ kind: 'offline' });
  });

  it('proceeds with a cached bootstrap even when the refresh failed', () => {
    const cached = ctx({ bootstrap: { status: 'error', data: bootstrap() } });
    expect(resolveEntryTarget(cached)).toEqual({ kind: 'today', href: '/today' });
  });

  it.each(Object.entries(ONBOARDING_STEP_ROUTES))(
    '2. onboarding: step %s resumes at %s when the screen exists',
    (step, route) => {
      const data = notOnboarded(step);
      const available = ctx({ bootstrap: { status: 'success', data }, isScreenAvailable: all });
      expect(resolveEntryTarget(available)).toEqual({ kind: 'onboarding_step', step, href: route });
      const missing = ctx({ bootstrap: { status: 'success', data } });
      expect(resolveEntryTarget(missing)).toEqual({ kind: 'onboarding_step', step, href: null });
    },
  );

  it('2. onboarding: no step yet (or an intro step) starts at connect-mail', () => {
    expect(onboardingStepOf(null)).toBe('connect_mail');
    expect(onboardingStepOf('welcome')).toBe('connect_mail');
    expect(onboardingStepOf('vip')).toBe('vip');
    const data = notOnboarded(null);
    expect(
      resolveEntryTarget(ctx({ bootstrap: { status: 'success', data }, isScreenAvailable: all })),
    ).toEqual({ kind: 'onboarding_step', step: 'connect_mail', href: '/connect-mail' });
  });

  it('orders the guards: onboarding before the version gate, the version gate before the account state', () => {
    const upgrade = { ...bootstrap().config, upgrade_required: true };
    const onboardingAndUpgrade = bootstrap({
      ...notOnboarded('permissions'),
      config: upgrade,
      account_state: 'disabled',
    });
    expect(
      resolveEntryTarget(ctx({ bootstrap: { status: 'success', data: onboardingAndUpgrade } }))
        .kind,
    ).toBe('onboarding_step');
    const upgradeAndDisabled = bootstrap({ config: upgrade, account_state: 'disabled' });
    expect(
      resolveEntryTarget(ctx({ bootstrap: { status: 'success', data: upgradeAndDisabled } })),
    ).toEqual({ kind: 'update_required', href: '/update-required' });
  });

  it('4. account state: disabled and pending deletion never reach the app', () => {
    const disabled = ctx({
      bootstrap: { status: 'success', data: bootstrap({ account_state: 'disabled' }) },
    });
    expect(resolveEntryTarget(disabled)).toEqual({ kind: 'account_disabled' });
    const deletion = bootstrap({ account_state: 'deletion_pending' });
    expect(resolveEntryTarget(ctx({ bootstrap: { status: 'success', data: deletion } }))).toEqual({
      kind: 'deletion_pending',
      href: null,
    });
    expect(
      resolveEntryTarget(
        ctx({ bootstrap: { status: 'success', data: deletion }, isScreenAvailable: all }),
      ),
    ).toEqual({ kind: 'deletion_pending', href: '/settings/privacy/delete-account' });
  });

  it('lands onboarded, supported, active users on Today', () => {
    expect(resolveEntryTarget(ctx())).toEqual({ kind: 'today', href: '/today' });
  });
});

describe('guardFlags', () => {
  it('opens (auth) only signed out and the app only for the Today target', () => {
    expect(guardFlags(ctx({ auth: 'signed_out' }))).toEqual({
      signedOut: true,
      onboarding: true,
      app: false,
    });
    expect(guardFlags(ctx())).toEqual({ signedOut: false, onboarding: false, app: true });
    const onboarding = ctx({ bootstrap: { status: 'success', data: notOnboarded('vip') } });
    expect(guardFlags(onboarding)).toEqual({ signedOut: false, onboarding: true, app: false });
    const upgrade = bootstrap({ config: { ...bootstrap().config, upgrade_required: true } });
    expect(guardFlags(ctx({ bootstrap: { status: 'success', data: upgrade } })).app).toBe(false);
    expect(guardFlags(ctx({ auth: 'loading' }))).toEqual({
      signedOut: false,
      onboarding: false,
      app: false,
    });
  });
});

describe('entryAnalyticsTarget', () => {
  it('maps resolved targets to the entry_resolved vocabulary', () => {
    expect(entryAnalyticsTarget({ kind: 'today', href: '/today' })).toBe('today');
    expect(entryAnalyticsTarget({ kind: 'sign_in', href: '/sign-in' })).toBe('sign_in');
    expect(entryAnalyticsTarget({ kind: 'loading' })).toBeNull();
    expect(entryAnalyticsTarget({ kind: 'account_disabled' })).toBeNull();
  });
});
