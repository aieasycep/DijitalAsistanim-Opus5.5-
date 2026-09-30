/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AdminApiModule from '@/server/admin-api';
import type * as SessionModule from '@/server/session';

import { MAIN_USER_ID } from '../../../e2e/mock-data';
import { THEME_COOKIE } from '@/server/preference-cookies';
import { request } from '@/test/next-stubs';
import {
  NOW,
  contextFor,
  fakeAdminApi,
  harness,
  props,
  renderPage,
  textOf,
  useRole,
} from '@/test/page-harness';
import { TR_MESSAGES } from '@/test/render';

/*
 * Shell layouts (BACKOFFICE_PLAN §2.1, §6.3): the admin layout (skip link, navigation filtered by
 * permission, top bar with the environment, theme from the cookie) and the user detail layout
 * (identity, plan/state badges, the actions menu, the Support Access banner for the viewer's own
 * active grant, tabs, and the not-found state for an unknown user).
 */

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'preview',
    API_PUBLIC_BASE_URL: 'http://127.0.0.1:54321',
    ADMIN_BFF_SECRET: 'x'.repeat(40),
    ADMIN_ORIGIN: 'http://localhost:3100',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_key',
  });
});

vi.mock('next-intl/server', () => import('@/test/next-stubs'));
vi.mock('next/headers', () => import('@/test/next-stubs'));
vi.mock('next/navigation', () => import('@/test/next-stubs'));
vi.mock('next/cache', () => import('@/test/next-stubs'));
vi.mock('@/server/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof AdminApiModule>()),
  adminApi: async (key: string, input?: object) =>
    (await import('@/test/page-harness')).fakeAdminApi(key, input),
}));
vi.mock('@/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  loadAdminContext: async () => (await import('@/test/page-harness')).contextFor(),
}));

const B = TR_MESSAGES.backoffice;

beforeEach(() => {
  useRole('super_admin');
  request.cookies.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('admin layout', () => {
  it('renders the skip link, the permitted navigation, the environment and the page', async () => {
    request.cookies.set(THEME_COOKIE, 'dark');
    const { default: AdminLayout } = await import('@/app/(admin)/layout');
    const root = await renderPage(await AdminLayout({ children: <p>modül</p> }));
    expect(root.querySelector('a[href="#main"]')?.textContent).toBe(B.app.skipToContent);
    expect(root.querySelector('nav')).not.toBeNull();
    expect(root.querySelectorAll('nav a').length).toBeGreaterThan(10);
    expect(textOf(root.querySelector('main#main'))).toBe('modül');
    expect(textOf(root)).toContain(B.shell.envPreview);
  });

  it('shows fewer modules to a support admin', async () => {
    const { default: AdminLayout } = await import('@/app/(admin)/layout');
    const full = (await renderPage(await AdminLayout({ children: null }))).querySelectorAll(
      'nav a',
    ).length;
    useRole('support');
    const limited = (
      await renderPage(await AdminLayout({ children: null }), contextFor('support'))
    ).querySelectorAll('nav a').length;
    expect(limited).toBeLessThan(full);
  });
});

describe('user detail layout', () => {
  async function layout(id = MAIN_USER_ID) {
    const { default: UserLayout } = await import('@/app/(admin)/users/[id]/layout');
    return UserLayout({ children: <p>sekme</p>, params: Promise.resolve({ id }) });
  }

  it('renders identity, badges, the actions menu and the tabs', async () => {
    const root = await renderPage(await layout());
    expect(textOf(root.querySelector('h1'))).toBe(B.userDetail.title);
    expect(root.querySelector('[data-testid="user-actions"]')).not.toBeNull();
    expect(root.querySelector(`a[href="/users/${MAIN_USER_ID}/overview"]`)).not.toBeNull();
    expect(root.querySelector('[data-testid="support-access-banner"]')).toBeNull();
    expect(textOf(root)).toContain('sekme');
  });

  it('shows the Support Access banner for the viewer’s own active grant', async () => {
    // The banner counts down against the clock; pin it to the mock dataset's "now".
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const granted = (await fakeAdminApi('POST /support-access/grants', {
      body: {
        user_id: MAIN_USER_ID,
        scopes: ['pii'],
        duration_minutes: 15,
        reason: 'Destek talebi DA-10240 için gerekli işlem',
        confirm: true,
      },
    })) as { ok: boolean };
    expect(granted.ok).toBe(true);
    const root = await renderPage(await layout());
    expect(root.querySelector('[data-testid="support-access-banner"]')).not.toBeNull();
    expect(textOf(root)).toContain(B.userDetail.supportAccessActive);
  });

  it('shows the not-found state for an unknown user', async () => {
    const root = await renderPage(await layout('0190f5e0-1111-7000-8000-000000009999'));
    expect(textOf(root)).toContain(B.states.notFound);
    expect(root.querySelector('a[href="/users"]')).not.toBeNull();
  });

  it('redirects /users/:id to the overview tab and titles the page', async () => {
    const { default: UserIndex } = await import('@/app/(admin)/users/[id]/page');
    await expect(UserIndex(props({}, { id: MAIN_USER_ID }) as never)).rejects.toMatchObject({
      location: `/users/${MAIN_USER_ID}/overview`,
    });
    const mod = await import('@/app/(admin)/users/[id]/layout');
    expect((await mod.generateMetadata()).title).toBe(B.userDetail.title);
    expect(harness.calls.length).toBeGreaterThanOrEqual(0);
  });
});
