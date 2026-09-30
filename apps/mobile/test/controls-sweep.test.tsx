/**
 * "No dead handlers" across the app (IMPLEMENTATION_PLAN quality rules, SCREEN_AND_FLOW_MAP
 * states): every screen route is opened in the real app (router, guards, providers, the recorded
 * API client and the PostgREST double) and every enabled pressable on the first render is pressed
 * in turn. A control may navigate, open a sheet, show a toast or call the API; it must never throw
 * and the app must keep rendering a screen afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from 'expo-router/testing-library';
import type { TestInstance } from 'test-renderer';

import { DEMO_ONLY_ROUTES, SCREEN_ROUTES } from '../src/lib/deeplinks';
import { resetAppState } from './helpers/app';
import { allHosts, classOf, openRoute } from './a11y/harness';

/**
 * Signed-in screens first and the sign-in screen last: pressing "Apple / Google ile devam et"
 * starts a real sign-in attempt whose local sign-out outlives the test's app state.
 */
const ORDER = ['app', 'public', 'onboarding', 'signed_out'] as const;
const ROUTES = SCREEN_ROUTES.filter((pattern) => !DEMO_ONLY_ROUTES.includes(pattern)).sort(
  (a, b) =>
    ORDER.indexOf(classOf(a) as (typeof ORDER)[number]) -
      ORDER.indexOf(classOf(b) as (typeof ORDER)[number]) ||
    Number(a === '/sign-in') - Number(b === '/sign-in'),
);
/** Upper bound per screen, so long lists do not dominate the run. */
const MAX_PRESSES = 30;

function enabledPressables(root: TestInstance): TestInstance[] {
  return allHosts(root).filter((host) => {
    const props = host.props as {
      onPress?: unknown;
      disabled?: boolean;
      accessibilityState?: { disabled?: boolean };
    };
    return (
      typeof props.onPress === 'function' &&
      props.disabled !== true &&
      props.accessibilityState?.disabled !== true
    );
  });
}

function isDetached(error: unknown): boolean {
  return error instanceof Error && /unmounted|detached|No instance found/i.test(error.message);
}

async function flush(): Promise<void> {
  for (let step = 0; step < 3; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(250);
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  await resetAppState();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('every control responds without throwing', () => {
  it.each(ROUTES)('%s', async (pattern) => {
    await openRoute(pattern, { theme: 'light' });
    const root = screen.root;
    expect(root).toBeTruthy();
    if (root === null) return;
    const controls = enabledPressables(root).slice(0, MAX_PRESSES);
    const failures: string[] = [];
    for (const control of controls) {
      try {
        await fireEvent.press(control);
      } catch (error) {
        if (!isDetached(error)) failures.push(`${pattern}: ${String(error)}`);
      }
      await flush();
    }
    expect(failures).toEqual([]);
    expect(screen.root).toBeTruthy();
  });
});
