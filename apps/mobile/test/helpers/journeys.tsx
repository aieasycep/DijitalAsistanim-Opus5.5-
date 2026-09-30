/**
 * Helpers for the onboarding / integrations / Today / briefing screen tests: open the real app as
 * a signed-in user (the guards decide the first route), then navigate like a user or a deep link
 * would, with the API client and PostgREST doubles installed.
 */
import { expect } from '@jest/globals';
import { act, waitFor } from 'expo-router/testing-library';
import { router as appRouter } from 'expo-router';
import type { BootstrapData } from '@da/validation/api/bootstrap';

import { resetOnboardingStoreForTests } from '../../src/features/onboarding/store';
import { bufferedEventsForTests } from '../../src/lib/events';
import { installApi, installFakeSupabase, json, renderApp, type Responder } from './app';
import type { PostgrestFake } from './postgrest';
import { bootstrap, ok, session, uuid } from './fixtures';

export { appRouter };

export function events(name: string) {
  return bufferedEventsForTests().filter((e) => e.event === name);
}

export const PRO_ENTITLEMENT: BootstrapData['entitlement'] = {
  ...bootstrap().entitlement,
  is_active: true,
  source: 'store',
};

export function proBootstrap(overrides: Partial<BootstrapData> = {}): BootstrapData {
  return bootstrap({
    entitlement: PRO_ENTITLEMENT,
    usage: { ...bootstrap().usage, plan: 'pro' },
    ...overrides,
  });
}

export function onboardingBootstrap(
  step: string,
  overrides: Partial<BootstrapData> = {},
): BootstrapData {
  return bootstrap({
    ...overrides,
    profile: {
      ...bootstrap().profile,
      onboarding: { step, completed_at: null },
    },
  });
}

export interface OpenOptions {
  readonly data?: BootstrapData;
  readonly routes?: Readonly<Record<string, Responder>>;
  /** The path to open after the entry resolver settled (a push, like a deep link). */
  readonly path?: string;
  /** The path the entry resolver must reach first. */
  readonly landing?: string;
  /** PostgREST tables and RPC answers, set before the first render. */
  readonly setup?: (db: PostgrestFake) => void;
}

export async function openApp(options: OpenOptions = {}) {
  resetOnboardingStoreForTests();
  const data = options.data ?? bootstrap();
  const fake = installFakeSupabase(session(data.profile.id));
  options.setup?.(fake.db);
  const api = installApi({
    'GET /me/bootstrap': () => json(200, ok(data)),
    ...options.routes,
  });
  const rendered = await renderApp('/');
  const landing = options.landing ?? '/today';
  await waitFor(() => {
    expect(rendered.router.getPathname()).toBe(landing);
  });
  if (options.path !== undefined) {
    const path = options.path;
    await act(async () => {
      appRouter.push(path);
      await Promise.resolve();
    });
  }
  return { fake, api, db: fake.db, router: rendered.router };
}

export const ID = {
  account: uuid(10),
  insight: uuid(40),
  insight2: uuid(41),
  briefing: uuid(50),
  item: uuid(60),
  item2: uuid(61),
  weekly: uuid(70),
  job: uuid(80),
  contact: uuid(90),
  announcement: uuid(95),
} as const;
