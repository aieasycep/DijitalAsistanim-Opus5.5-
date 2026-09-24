/**
 * The deep-link table (T-8.04 acceptance): every route of the `@da/domain` allow-list (the A9 /
 * MASTER_PLAN §9 tree as deep-linkable paths) is resolved through the app's link router in each
 * form it can arrive in, and then through Expo Router's own matcher against the real `app/`
 * directory. The screen registry (`SCREEN_ROUTES`) must equal the files on disk, and every root
 * route must belong to exactly one guard class, so a new screen cannot ship unguarded.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ROUTE_DEFS } from '@da/domain/deeplinks';
import { describe, expect, it } from '@jest/globals';
import { findFocusedRoute } from 'expo-router/build/fork/findFocusedRoute';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { getMockConfig } from 'expo-router/testing-library';

import {
  DEMO_ONLY_ROUTES,
  NOT_FOUND_HREF,
  SCREEN_ROUTES,
  isScreenAvailable,
  resolveIncomingLink,
  type ResolveLinkOptions,
} from '../src/lib/deeplinks';
import {
  APP_ROOT_SCREENS,
  DEMO_ROOT_SCREENS,
  SETTINGS_ROOT_SCREENS,
  ONBOARDING_ROOT_SCREENS,
  ONBOARDING_STEP_ROUTES,
  PUBLIC_ROOT_SCREENS,
  SIGNED_OUT_ROOT_SCREENS,
  accessForPattern,
} from '../src/lib/router-guards';

const APP_DIR = join(__dirname, '..', 'app');
const ID = '00000000-0000-4000-8000-000000000123';
const SAMPLE_PARAMS: Readonly<Record<string, string>> = {
  category: 'important',
  code: 'K7M2P9Q',
};

function samplePath(pattern: string): string {
  return pattern.replace(/:([A-Za-z]+)/g, (_m, name: string) => SAMPLE_PARAMS[name] ?? ID);
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(name)) yield relative(APP_DIR, full).split(sep).join('/');
  }
}

const APP_FILES = [...files(APP_DIR)];

/** `app/(tabs)/today/index.tsx` → `/today`; `app/mail/[id].tsx` → `/mail/:id`. */
function urlPatternOf(file: string): string | null {
  const segments = file.replace(/\.tsx?$/, '').split('/');
  const last = segments.at(-1) ?? '';
  if (last.startsWith('_') || last.startsWith('+')) return null;
  const url = segments
    .filter((s) => !/^\(.+\)$/.test(s) && s !== 'index')
    .map((s) => s.replace(/^\[(.+)\]$/, ':$1'));
  return `/${url.join('/')}`;
}

/** The route name the root Stack sees for a file (a directory with a layout is one route). */
function rootRouteOf(file: string): string | null {
  if (file === '_layout.tsx' || file === '+native-intent.tsx') return null;
  const [first = ''] = file.split('/');
  if (file.includes('/') && APP_FILES.includes(`${first}/_layout.tsx`)) return first;
  return file.replace(/\.tsx?$/, '');
}

const LINK_OPTIONS: ResolveLinkOptions = {
  scheme: 'dijitalasistan-dev',
  webOrigin: 'https://dijitalasistan.app',
  allowDemo: false,
};

const routerConfig = getMockConfig('./app');

function focusedRouteName(path: string): string | undefined {
  const state = getStateFromPath(path, routerConfig as Parameters<typeof getStateFromPath>[1]);
  return state === undefined ? undefined : findFocusedRoute(state)?.name;
}

describe('deep-link table: every allow-listed route (A9)', () => {
  it.each(ROUTE_DEFS.map((def) => [def.pattern, def] as const))('%s', (pattern, def) => {
    const path = samplePath(pattern);
    const forms = [
      `dijitalasistan://${path.slice(1)}`,
      `dijitalasistan-dev://${path.slice(1)}`,
      `https://dijitalasistan.app/app${path}`,
      path,
    ];
    for (const url of forms) {
      const regular = resolveIncomingLink(url, LINK_OPTIONS);
      const demo = resolveIncomingLink(url, { ...LINK_OPTIONS, allowDemo: true });
      if (def.demoOnly === true) {
        expect(regular).toEqual({ kind: 'rejected', reason: 'not_allowed', href: NOT_FOUND_HREF });
        expect(demo).toMatchObject({ kind: 'route', href: path });
      } else if (pattern === '/r/:code') {
        expect(regular).toEqual({ kind: 'referral', code: 'K7M2P9Q', href: '/' });
      } else if (pattern === '/oauth/done') {
        expect(regular).toMatchObject({ kind: 'route', href: '/integrations/callback' });
      } else {
        expect(regular).toEqual({ kind: 'route', href: path, pattern });
      }
    }
  });

  it('keeps allow-listed query keys and drops everything else', () => {
    const link = resolveIncomingLink(
      `dijitalasistan://integrations/callback?provider=google&result=denied&evil=1`,
      LINK_OPTIONS,
    );
    expect(link).toEqual({
      kind: 'route',
      href: '/integrations/callback?provider=google&result=denied',
      pattern: '/integrations/callback',
    });
  });

  it('resolves each route to its screen, or to +not-found until the screen exists', () => {
    for (const def of ROUTE_DEFS) {
      if (def.pattern === '/r/:code' || def.pattern === '/oauth/done') continue;
      const path = samplePath(def.pattern);
      const name = focusedRouteName(path);
      if (isScreenAvailable(path, true)) {
        expect([def.pattern, name]).not.toEqual([def.pattern, '+not-found']);
        expect(name).toBeDefined();
      } else {
        expect([def.pattern, name]).toEqual([def.pattern, '+not-found']);
      }
    }
  });

  it('rejects unknown paths, foreign hosts, other schemes and malformed ids', () => {
    for (const url of [
      'dijitalasistan://nowhere',
      'https://evil.example/app/today',
      'javascript:alert(1)',
      'dijitalasistan://mail/not-a-uuid',
      'dijitalasistan://../today',
    ]) {
      expect(resolveIncomingLink(url, LINK_OPTIONS)).toMatchObject({
        kind: 'rejected',
        href: NOT_FOUND_HREF,
      });
    }
    expect(focusedRouteName(NOT_FOUND_HREF)).toBe('+not-found');
  });

  it('opens the entry resolver for the bare scheme and passes dev-client URLs through', () => {
    for (const url of ['dijitalasistan://', 'dijitalasistan-dev://', '/', '/?utm=x']) {
      expect(resolveIncomingLink(url, LINK_OPTIONS)).toEqual({
        kind: 'route',
        href: '/',
        pattern: '/',
      });
    }
    const dev = 'exp+dijital-asistan://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081';
    expect(resolveIncomingLink(dev, LINK_OPTIONS)).toEqual({ kind: 'passthrough', href: dev });
  });

  it('classifies access: callbacks, the root and the demo route are public, the rest needs the app', () => {
    expect(accessForPattern('/')).toBe('public');
    expect(accessForPattern('/auth/callback')).toBe('public');
    expect(accessForPattern('/integrations/callback')).toBe('public');
    expect(accessForPattern('/today')).toBe('app');
    expect(accessForPattern('/mail/:id')).toBe('app');
  });
});

describe('screen registry', () => {
  it('lists exactly the screens under app/', () => {
    const onDisk = APP_FILES.map(urlPatternOf).filter((p): p is string => p !== null);
    expect([...new Set(onDisk)].sort()).toEqual([...SCREEN_ROUTES].sort());
  });

  it('marks the demo setup route demo-only', () => {
    expect(DEMO_ONLY_ROUTES).toEqual(['/demo/setup']);
    expect(isScreenAvailable('/demo/setup', false)).toBe(false);
    expect(isScreenAvailable('/demo/setup', true)).toBe(true);
    expect(isScreenAvailable('/today?src=push', false)).toBe(true);
    expect(isScreenAvailable('/settings/android-notifications', false)).toBe(false);
  });

  it('has a screen for every onboarding step (T-8.06)', () => {
    for (const route of Object.values(ONBOARDING_STEP_ROUTES)) {
      expect(isScreenAvailable(route, false)).toBe(true);
    }
  });

  it('puts every root route in exactly one guard class', () => {
    const roots = [
      ...new Set(APP_FILES.map(rootRouteOf).filter((r): r is string => r !== null)),
    ].sort();
    const classes: readonly (readonly string[])[] = [
      PUBLIC_ROOT_SCREENS,
      SIGNED_OUT_ROOT_SCREENS,
      ONBOARDING_ROOT_SCREENS,
      APP_ROOT_SCREENS,
      SETTINGS_ROOT_SCREENS,
      DEMO_ROOT_SCREENS,
    ];
    const listed = classes.flat();
    expect([...listed].sort()).toEqual(roots);
    expect(new Set(listed).size).toBe(listed.length);
  });
});
