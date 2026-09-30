/**
 * T-8.29 screen-level checks over the rendered host tree (the same rules as the kit's contract
 * test, applied to whole screens): every pressable has a role and a label (or text), declared hit
 * targets reach 44 pt with their `hitSlop`, every screen has a header, text keeps Dynamic Type
 * (`allowFontScaling={false}` only inside the kit's fixed-size share card), images are labelled or
 * hidden, and a dark render paints no white or light-only colour.
 */
import { color, palette } from '@da/design-tokens';
import { expect, jest } from '@jest/globals';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { router as appRouter } from 'expo-router';
import { act, waitFor } from 'expo-router/testing-library';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { getQueryClient } from '../../src/lib/query/client';
import { updateUiPrefs, type UiPrefs } from '../../src/lib/ui-prefs';
import { installApi, installFakeSupabase, json, renderApp } from '../helpers/app';
import { bootstrap, ok, session, uuid } from '../helpers/fixtures';

export const MIN_TARGET = 44;

/** Sample values for route params (the deep-link table uses the same ones). */
const SAMPLE_PARAMS: Readonly<Record<string, string>> = { category: 'important' };

export function samplePath(pattern: string): string {
  return pattern.replace(/:([A-Za-z]+)/g, (_m, name: string) => SAMPLE_PARAMS[name] ?? uuid(123));
}

export function styleOf(host: TestInstance): ViewStyle & TextStyle {
  return StyleSheet.flatten([host.props.style as StyleProp<ViewStyle & TextStyle>]);
}

export function allHosts(root: TestInstance): TestInstance[] {
  const out: TestInstance[] = [root];
  for (const child of root.children) {
    if (typeof child !== 'string') out.push(...allHosts(child));
  }
  return out;
}

/** `Type#testID(label)`, or `Type#<nearest ancestor testID>` for hosts without one. */
export function describeHost(host: TestInstance): string {
  const id: unknown = host.props.testID;
  const label: unknown = host.props.accessibilityLabel;
  let anchor = typeof id === 'string' ? id : '';
  let node: TestInstance | null = host.parent;
  while (anchor === '' && node !== null) {
    const parentId: unknown = node.props.testID;
    if (typeof parentId === 'string') anchor = `<${parentId}>`;
    node = node.parent;
  }
  return `${host.type}#${anchor}${typeof label === 'string' ? `(${label})` : ''}`;
}

/** Hidden from assistive technology (itself or an ancestor). */
function hiddenFromA11y(host: TestInstance): boolean {
  let node: TestInstance | null = host;
  while (node !== null) {
    const p = node.props;
    if (
      p.accessibilityElementsHidden === true ||
      p.importantForAccessibility === 'no-hide-descendants' ||
      p['aria-hidden'] === true
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function insideTestId(host: TestInstance, prefixes: readonly string[]): boolean {
  let node: TestInstance | null = host;
  while (node !== null) {
    const id: unknown = node.props.testID;
    if (typeof id === 'string' && prefixes.some((p) => id.startsWith(p))) return true;
    node = node.parent;
  }
  return false;
}

function isInteractive(host: TestInstance): boolean {
  if (host.type === 'RCTScrollView' || host.type === 'ScrollView') return false;
  return (
    typeof host.props.onClick === 'function' || typeof host.props.onResponderRelease === 'function'
  );
}

function textOf(host: TestInstance): string {
  return allHosts(host)
    .filter((h) => h.type === 'Text')
    .flatMap((h) => h.children.filter((c): c is string => typeof c === 'string'))
    .join('')
    .trim();
}

export interface A11yReport {
  readonly unlabeled: string[];
  readonly smallTargets: string[];
  readonly headers: number;
  readonly fixedFontScaling: string[];
  readonly unlabeledImages: string[];
}

/** testIDs of kit components drawn at a fixed pixel size on purpose (image exports). */
const FIXED_SIZE_TEST_IDS = ['ui.shareCardTemplate'];

export function a11yReport(root: TestInstance): A11yReport {
  const hosts = allHosts(root);
  const unlabeled: string[] = [];
  const smallTargets: string[] = [];
  const fixedFontScaling: string[] = [];
  const unlabeledImages: string[] = [];
  let headers = 0;
  for (const host of hosts) {
    const p = host.props;
    const role: unknown = p.accessibilityRole ?? p.role;
    if (role === 'header' && !hiddenFromA11y(host)) headers += 1;
    if (host.type === 'Text' && p.allowFontScaling === false) {
      if (!insideTestId(host, FIXED_SIZE_TEST_IDS)) fixedFontScaling.push(describeHost(host));
    }
    if (host.type === 'Image' || host.type === 'RCTImageView') {
      const labelled = typeof p.accessibilityLabel === 'string' && p.accessibilityLabel !== '';
      if (!labelled && p.accessible === true && !hiddenFromA11y(host)) {
        unlabeledImages.push(describeHost(host));
      }
    }
    if (!isInteractive(host) || hiddenFromA11y(host) || p.accessible === false) continue;
    const label: unknown = p.accessibilityLabel;
    const hasLabel = (typeof label === 'string' && label.trim() !== '') || textOf(host) !== '';
    if (role === undefined || role === 'none' || !hasLabel) unlabeled.push(describeHost(host));
    const style = styleOf(host);
    const slop = (p.hitSlop ?? {}) as {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    };
    const height = typeof style.height === 'number' ? style.height : style.minHeight;
    const width = typeof style.width === 'number' ? style.width : style.minWidth;
    if (typeof height === 'number' && height + (slop.top ?? 0) + (slop.bottom ?? 0) < MIN_TARGET) {
      smallTargets.push(`${describeHost(host)} h=${String(height)}`);
    }
    if (typeof width === 'number' && width + (slop.left ?? 0) + (slop.right ?? 0) < MIN_TARGET) {
      smallTargets.push(`${describeHost(host)} w=${String(width)}`);
    }
  }
  return { unlabeled, smallTargets, headers, fixedFontScaling, unlabeledImages };
}

// ── Dark theme ────────────────────────────────────────────────────────────────────────────────

function strings(value: unknown, out: Set<string>): Set<string> {
  if (typeof value === 'string') out.add(value.toUpperCase());
  else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value as Record<string, unknown>)) strings(v, out);
  }
  return out;
}

const DARK_VALUES = strings(color.dark, new Set());
/** Values that only the light scheme uses: seeing one in a dark render means a light hard-code. */
export const LIGHT_ONLY = new Set(
  [...strings(color.light, new Set())].filter((v) => !DARK_VALUES.has(v)),
);
const WHITE = new Set([
  palette.warm.white.toUpperCase(),
  'WHITE',
  'RGB(255, 255, 255)',
  'RGBA(255, 255, 255, 1)',
]);

/** Kit subtrees that paint white in dark on purpose (on-gradient contexts; kit contract test). */
const WHITE_ALLOWED_TEST_IDS = [
  'ui.iconButton.play',
  'ui.transportControls.play',
  'ui.miniPlayer',
  'ui.voiceOrb',
  'ui.button.inverse',
  'ui.fullPlayer',
  'ui.waveform',
  'ui.scrubber',
  'ui.shareCardTemplate',
  'ui.pageDots',
  // Kit components allowed above, rendered under the app's own testIDs: the VoiceOrb and the
  // inverse CTAs of the dawn-gradient intro and "hazır" screens.
  'voice.orb',
  'intro.start',
  'intro.dots',
  'ready.continue',
];

const COLOR_KEYS = ['backgroundColor', 'color', 'borderColor', 'borderTopColor', 'tintColor'];

export function lightColoursInDark(root: TestInstance): string[] {
  const out: string[] = [];
  for (const host of allHosts(root)) {
    const style = styleOf(host) as Record<string, unknown>;
    for (const key of COLOR_KEYS) {
      const value = style[key];
      if (typeof value !== 'string') continue;
      const upper = value.trim().toUpperCase();
      const white = key === 'backgroundColor' && WHITE.has(upper);
      if ((white || LIGHT_ONLY.has(upper)) && !insideTestId(host, WHITE_ALLOWED_TEST_IDS)) {
        out.push(`${describeHost(host)} ${key}=${value}`);
      }
    }
  }
  return out;
}

// ── Route classes ─────────────────────────────────────────────────────────────────────────────

export type RouteClass = 'app' | 'signed_out' | 'onboarding' | 'public' | 'demo';

const SIGNED_OUT = ['/sign-in', '/email-otp', '/welcome', '/noise', '/proactive', '/control'];
const PUBLIC = ['/', '/update-required', '/auth/callback', '/integrations/callback'];

/** Onboarding step routes → `profiles.onboarding_step`. */
export const ONBOARDING_STEPS: Readonly<Record<string, string>> = {
  '/connect-mail': 'connect_mail',
  '/connect-calendar': 'connect_calendar',
  '/permissions': 'permissions',
  '/personalization': 'personalization',
  '/briefing-schedule': 'briefing_schedule',
  '/analysis': 'analysis',
  '/ready': 'ready',
  '/notifications': 'notifications',
  '/android-notifications': 'android_notifications',
};

export function classOf(pattern: string): RouteClass {
  if (pattern === '/demo/setup') return 'demo';
  if (SIGNED_OUT.includes(pattern)) return 'signed_out';
  if (PUBLIC.includes(pattern)) return 'public';
  if (pattern in ONBOARDING_STEPS) return 'onboarding';
  return 'app';
}

/** A signed-in, onboarded user in the dark theme (the server preference wins at bootstrap). */
export function darkBootstrap(overrides: Partial<BootstrapData> = {}): BootstrapData {
  const base = bootstrap(overrides);
  return { ...base, preferences: { ...base.preferences, theme: 'dark' } };
}

// ── Opening a route ───────────────────────────────────────────────────────────────────────────

export async function settle(): Promise<void> {
  const client = getQueryClient();
  // `renderRouter` runs on Jest's fake timers: advance them until the screen's reads (and their
  // retries on missing rows) are done, at least one second and at most ten.
  for (let step = 0; step < 40; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(250);
      await Promise.resolve();
    });
    if (step >= 3 && client.isFetching() + client.isMutating() === 0) break;
  }
}

/** Routes that redirect on this platform (the test renders iOS). */
const REDIRECTS: Readonly<Record<string, string>> = {
  // M-ANI-01 is Android only; iOS returns to the settings hub.
  '/settings/android-notifications': '/settings',
  // The Android-only onboarding step resumes at the first step on iOS.
  '/android-notifications': '/connect-mail',
  // M-ON-02…04 keep their plan paths and open the intro pager on their page.
  '/noise': '/welcome',
  '/proactive': '/welcome',
  '/control': '/welcome',
};

/** Opens a route as the right kind of user (signed out, onboarding, onboarded) with the prefs. */
export async function openRoute(
  pattern: string,
  prefs: Partial<UiPrefs> = { theme: 'dark' },
): Promise<void> {
  const path = samplePath(pattern);
  const kind = classOf(pattern);
  if (kind === 'signed_out') {
    installFakeSupabase(null);
    installApi({});
  } else {
    const base = darkBootstrap();
    const data =
      kind === 'onboarding'
        ? {
            ...base,
            profile: {
              ...base.profile,
              onboarding: { step: ONBOARDING_STEPS[pattern] ?? 'connect_mail', completed_at: null },
            },
          }
        : base;
    installFakeSupabase(session(data.profile.id));
    installApi({ 'GET /me/bootstrap': () => json(200, ok(data)) });
  }
  updateUiPrefs(prefs);
  const direct = kind === 'app' || kind === 'public';
  const { router } = await renderApp(direct ? path : '/');
  if (!direct) {
    // Guarded groups exist only once the session is known: land first, then navigate.
    await waitFor(() => {
      expect(router.getPathname()).not.toBe('/');
    });
    if (router.getPathname() !== path) {
      await act(async () => {
        appRouter.push(path);
        await Promise.resolve();
      });
    }
  }
  if (kind !== 'public') {
    await waitFor(() => {
      expect(router.getPathname()).toBe(REDIRECTS[pattern] ?? path);
    });
  }
  await settle();
}
