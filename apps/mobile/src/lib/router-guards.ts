/**
 * Entry resolver and route guards (M-GL-02, T-8.04). Pure and data-driven:
 * `resolveEntryTarget(ctx)` decides where `/` goes, in the guard order
 *   1. auth (signed out → sign-in or the intro);
 *   2. onboarding step (`profiles.onboarding_step`, the M-GL-02 step table);
 *   3. `min_supported_version` (`bootstrap.config.upgrade_required` → `/update-required`);
 *   4. account state (`disabled`, `deletion_pending`);
 * and `guardFlags(ctx)` gives the `Stack.Protected` guards of the root layout. A step whose screen
 * does not exist in this build (`isScreenAvailable`) resolves without an href, and the entry screen
 * stays on the launch view instead of navigating to a missing route.
 *
 * Root routes are listed per access class below; `test/route-registry.test.ts` fails when a file
 * under `app/` is not in exactly one list, so every new screen is protected by default.
 */
import type { ONBOARDING_STEPS } from '@da/domain/analytics/vocab';
import type { BootstrapData } from '@da/validation/api/bootstrap';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';

/** `profiles.onboarding_step` values that map to a screen (`done` means onboarded). */
export type OnboardingStep = Exclude<
  (typeof ONBOARDING_STEPS)[number],
  'welcome' | 'noise' | 'proactive' | 'control' | 'account' | 'done'
>;

/**
 * The M-GL-02 step table (`null` → connect-mail). URLs of `app/(onboarding)/*` (T-8.06). The VIP
 * step names its group: `/vip` is also M-VIP-01 (`app/vip.tsx`, T-8.16), which Expo Router would
 * pick for the bare URL and the onboarding guard would then reject.
 */
export const ONBOARDING_STEP_ROUTES: Readonly<Record<OnboardingStep, string>> = {
  connect_mail: '/connect-mail',
  connect_calendar: '/connect-calendar',
  permissions: '/permissions',
  personalization: '/personalization',
  briefing_schedule: '/briefing-schedule',
  vip: '/(onboarding)/vip',
  analysis: '/analysis',
  ready: '/ready',
  notifications: '/notifications',
  android_notifications: '/android-notifications',
};

export const WELCOME_ROUTE = '/welcome';
export const SIGN_IN_ROUTE = '/sign-in';
export const UPDATE_REQUIRED_ROUTE = '/update-required';
export const TODAY_ROUTE = '/today';
export const DELETION_STATUS_ROUTE = '/settings/privacy/delete-account';

// ── Root route access classes (names as the root Stack sees them) ───────────────────────────

/** Always reachable (M-GL-02: `+not-found`, `update-required`; plus the entry and callbacks). */
export const PUBLIC_ROOT_SCREENS = [
  'index',
  '+not-found',
  'update-required',
  'auth/callback',
  'integrations/callback',
] as const;
/** Signed out only: `(auth)/*`. */
export const SIGNED_OUT_ROOT_SCREENS = ['(auth)'] as const;
/**
 * The onboarding group (T-8.06): its intro pages need `signed_out`, its steps need
 * `signed_in && !onboardingComplete`; the group layout splits the two.
 */
export const ONBOARDING_ROOT_SCREENS: readonly string[] = ['(onboarding)'];
/** Signed in, onboarded, supported version, active account: `(tabs)` and every detail route. */
export const APP_ROOT_SCREENS: readonly string[] = [
  '(tabs)',
  // T-8.22 paywall (modal)
  'paywall',
  // T-8.09
  'briefing/[id]/index',
  'briefing/[id]/listen',
  'briefings/index',
  'weekly/[id]/index',
  'weekly/[id]/share',
  // T-8.10…T-8.14 flow, mail, commitments, life, plan, meetings
  'mail/index',
  'mail/category/[category]',
  'mail/[id]/index',
  'mail/[id]/reply',
  'waiting',
  'followups',
  'commitments/index',
  'commitments/[id]',
  'life/[id]',
  'event/[id]',
  'plan/proposal/[approvalId]',
  'plan/conflict/[insightId]',
  'meeting/[eventId]/prep',
  'meeting/[eventId]/summary',
  'meeting/[eventId]/post',
  // T-8.15…T-8.18
  'chat/[threadId]',
  'voice',
  'search',
  'memory',
  'person/[id]',
  'vip',
  'capture',
  'approvals/index',
  'approvals/[id]',
  'reminders/new',
];
/** Presentation of root routes that are not plain stack pushes (SCREEN_AND_FLOW_MAP §0.2). */
export const ROOT_SCREEN_OPTIONS: Readonly<
  Record<
    string,
    {
      readonly presentation: 'modal' | 'fullScreenModal' | 'transparentModal' | 'formSheet';
      readonly contentStyle?: { readonly backgroundColor: 'transparent' };
      readonly animation?: 'fade' | 'none';
      readonly gestureEnabled?: boolean;
    }
  >
> = {
  settings: { presentation: 'modal' },
  paywall: { presentation: 'modal' },
  'briefing/[id]/listen': { presentation: 'fullScreenModal' },
  'weekly/[id]/share': { presentation: 'modal' },
  'mail/[id]/reply': { presentation: 'modal' },
  'life/[id]': { presentation: 'transparentModal' },
  'plan/proposal/[approvalId]': { presentation: 'modal' },
  'meeting/[eventId]/summary': { presentation: 'modal' },
  // T-8.15 voice mode, T-8.17 capture modal stack, T-8.18 reminder sheet route.
  voice: { presentation: 'fullScreenModal', gestureEnabled: false },
  capture: { presentation: 'modal' },
  'reminders/new': {
    presentation: 'transparentModal',
    contentStyle: { backgroundColor: 'transparent' },
    animation: 'none',
  },
};
/**
 * The settings stack (`app/settings/_layout.tsx`, T-8.07 accounts + T-8.19…T-8.22): reachable with
 * the app, and — for the deletion status route only — while the account is `deletion_pending`
 * (the settings layout protects every other page with the app guard).
 */
export const SETTINGS_ROOT_SCREENS = ['settings'] as const;
/** Route names inside the settings stack (kept equal to `app/settings/**` by a test). */
export const SETTINGS_SCREENS: readonly string[] = [
  'index',
  'profile',
  'notifications',
  'briefings',
  'appearance',
  'language',
  'help',
  'feedback',
  'about',
  'accounts/index',
  'accounts/[id]',
  'privacy/index',
  'privacy/permissions',
  'privacy/data-sources',
  'privacy/retention',
  'privacy/history',
  'privacy/export',
  'privacy/delete-account',
  'personalization',
  'priority-rules/index',
  'priority-rules/[id]',
  'subscription',
  'referral',
];
/** The one settings page a `deletion_pending` account can reach (M-SET-39 status). */
export const DELETION_STATUS_SCREEN = 'privacy/delete-account';

/** Demo builds only. */
export const DEMO_ROOT_SCREENS = ['demo/setup'] as const;

export interface BootstrapState {
  readonly status: 'pending' | 'error' | 'success';
  readonly data: BootstrapData | undefined;
}

export interface EntryContext {
  readonly auth: AuthStatus;
  /** `useAuthStore.hasSignedInBefore` (MMKV). */
  readonly hasSignedInBefore: boolean;
  /** `useOnboardingStore.introIndex`. */
  readonly introIndex?: number;
  readonly bootstrap: BootstrapState;
  readonly online: boolean;
  readonly isScreenAvailable: (path: string) => boolean;
}

export type EntryTarget =
  | { readonly kind: 'loading' }
  | { readonly kind: 'welcome'; readonly href: string }
  | { readonly kind: 'sign_in'; readonly href: string }
  | {
      readonly kind: 'onboarding_step';
      readonly step: OnboardingStep;
      readonly href: string | null;
    }
  | { readonly kind: 'update_required'; readonly href: string }
  | { readonly kind: 'account_disabled' }
  | { readonly kind: 'deletion_pending'; readonly href: string | null }
  | { readonly kind: 'offline' }
  | { readonly kind: 'bootstrap_error' }
  | { readonly kind: 'today'; readonly href: string };

const STEP_KEYS = Object.keys(ONBOARDING_STEP_ROUTES) as OnboardingStep[];

/** `profiles.onboarding_step` → the step to resume (`null` or an intro value → connect-mail). */
export function onboardingStepOf(step: string | null): OnboardingStep {
  return STEP_KEYS.includes(step as OnboardingStep) ? (step as OnboardingStep) : 'connect_mail';
}

export function isOnboardingComplete(data: BootstrapData): boolean {
  return data.profile.onboarding.completed_at !== null || data.profile.onboarding.step === 'done';
}

export function resolveEntryTarget(ctx: EntryContext): EntryTarget {
  // 1. Auth
  if (ctx.auth === 'loading') return { kind: 'loading' };
  if (ctx.auth === 'signed_out') {
    if (ctx.hasSignedInBefore) return { kind: 'sign_in', href: `${SIGN_IN_ROUTE}?mode=signin` };
    if (ctx.isScreenAvailable(WELCOME_ROUTE)) {
      return { kind: 'welcome', href: `${WELCOME_ROUTE}?page=${String(ctx.introIndex ?? 0)}` };
    }
    return { kind: 'sign_in', href: `${SIGN_IN_ROUTE}?mode=signup` };
  }
  const data = ctx.bootstrap.data;
  if (data === undefined) {
    // Offline, the bootstrap query is paused (`networkMode: 'online'`): nothing will load.
    if (!ctx.online) return { kind: 'offline' };
    return ctx.bootstrap.status === 'pending' ? { kind: 'loading' } : { kind: 'bootstrap_error' };
  }
  // 2. Onboarding step
  if (!isOnboardingComplete(data)) {
    const step = onboardingStepOf(data.profile.onboarding.step);
    const href = ONBOARDING_STEP_ROUTES[step];
    return { kind: 'onboarding_step', step, href: ctx.isScreenAvailable(href) ? href : null };
  }
  // 3. Minimum supported version
  if (data.config.upgrade_required) return { kind: 'update_required', href: UPDATE_REQUIRED_ROUTE };
  // 4. Account state
  if (data.account_state === 'disabled') return { kind: 'account_disabled' };
  if (data.account_state === 'deletion_pending') {
    return {
      kind: 'deletion_pending',
      href: ctx.isScreenAvailable(DELETION_STATUS_ROUTE) ? DELETION_STATUS_ROUTE : null,
    };
  }
  return { kind: 'today', href: TODAY_ROUTE };
}

export interface GuardFlags {
  /** `(auth)/*` */
  readonly signedOut: boolean;
  /** `(onboarding)/*` (the group layout splits intro pages from signed-in steps). */
  readonly onboarding: boolean;
  /** `(tabs)` and every detail route. */
  readonly app: boolean;
  /** The deletion status page (M-SET-39) of a `deletion_pending` account. */
  readonly deletionStatus: boolean;
}

export function guardFlags(ctx: EntryContext): GuardFlags {
  const target = resolveEntryTarget(ctx);
  return {
    signedOut: ctx.auth === 'signed_out',
    onboarding: ctx.auth === 'signed_out' || target.kind === 'onboarding_step',
    app: target.kind === 'today',
    deletionStatus: target.kind === 'deletion_pending' && target.href !== null,
  };
}

/** The `entry_resolved` analytics target of a resolution (null while nothing is decided). */
export function entryAnalyticsTarget(
  target: EntryTarget,
): 'welcome' | 'sign_in' | 'onboarding_step' | 'today' | 'update_required' | null {
  switch (target.kind) {
    case 'welcome':
    case 'sign_in':
    case 'onboarding_step':
    case 'today':
    case 'update_required':
      return target.kind;
    default:
      return null;
  }
}

// ── Snapshot for code outside React (`+native-intent`, API error hooks) ─────────────────────

let snapshot: GuardFlags & { readonly auth: AuthStatus } = {
  auth: 'loading',
  signedOut: false,
  onboarding: false,
  app: false,
  deletionStatus: false,
};

export function setGuardSnapshot(next: GuardFlags & { readonly auth: AuthStatus }): void {
  snapshot = next;
}

export function guardSnapshot(): GuardFlags & { readonly auth: AuthStatus } {
  return snapshot;
}

/** Access class of an allow-listed pattern: callbacks and `/today` style routes need the app. */
export function accessForPattern(pattern: string): 'public' | 'app' {
  if (
    pattern === '/' ||
    pattern === '/auth/callback' ||
    pattern === '/integrations/callback' ||
    pattern === '/oauth/done' ||
    pattern === '/demo/setup'
  ) {
    return 'public';
  }
  return 'app';
}
