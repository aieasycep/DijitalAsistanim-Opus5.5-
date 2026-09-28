/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AdminApiModule from '@/server/admin-api';
import type * as SessionModule from '@/server/session';

import { accessDenied, permissionsOf, type RouteKey } from '../../../e2e/mock-admin';
import {
  DEAD_JOB_ID,
  FAILED_EXPORT_ID,
  MAIN_USER_ID,
  TICKET_ID,
  uid,
  type Role,
} from '../../../e2e/mock-data';
import { NOW, contextFor, harness, props, renderPage, textOf, useRole } from '@/test/page-harness';
import { TR_MESSAGES } from '@/test/render';

/*
 * Every module page of BACKOFFICE_PLAN §6 rendered on the server against the contract mock of
 * admin-api: the data state for a role that may read it, the forbidden state for a role that may
 * not (admin-api decides; the page still sends its primary read, §4.5), and the error state with
 * the correlation id when the primary read fails.
 */

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'development',
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

const B = TR_MESSAGES.backoffice as unknown as Record<string, Record<string, unknown>>;
const STATES = TR_MESSAGES.backoffice.states;

type Page = (p: ReturnType<typeof props>) => Promise<unknown>;
interface Module {
  readonly name: string;
  readonly load: () => Promise<{ default: unknown }>;
  readonly primary: RouteKey;
  readonly title: string | null;
  readonly params?: Record<string, string>;
  readonly search?: Record<string, string>;
}

const title = (ns: string): string => {
  const value = B[ns]?.title;
  return typeof value === 'string' ? value : '';
};

const MODULES: readonly Module[] = [
  {
    name: 'dashboard',
    load: () => import('@/app/(admin)/dashboard/page'),
    primary: 'GET /dashboard/metrics',
    title: title('dashboard'),
  },
  {
    name: 'users',
    load: () => import('@/app/(admin)/users/page'),
    primary: 'GET /users',
    title: title('users'),
  },
  {
    name: 'briefings',
    load: () => import('@/app/(admin)/briefings/page'),
    primary: 'GET /briefings',
    title: title('briefings'),
  },
  {
    name: 'support',
    load: () => import('@/app/(admin)/support/page'),
    primary: 'GET /support/tickets',
    title: title('support'),
  },
  {
    name: 'support ticket',
    load: () => import('@/app/(admin)/support/[id]/page'),
    primary: 'GET /support/tickets/:id',
    title: null,
    params: { id: TICKET_ID },
  },
  {
    name: 'integrations',
    load: () => import('@/app/(admin)/integrations/page'),
    primary: 'GET /integrations',
    title: title('integrations'),
  },
  {
    name: 'jobs',
    load: () => import('@/app/(admin)/jobs/page'),
    primary: 'GET /jobs',
    title: title('jobs'),
  },
  {
    name: 'job detail',
    load: () => import('@/app/(admin)/jobs/[id]/page'),
    primary: 'GET /jobs/:id',
    title: null,
    params: { id: DEAD_JOB_ID },
  },
  {
    name: 'notifications',
    load: () => import('@/app/(admin)/notifications/page'),
    primary: 'GET /notifications',
    title: title('notifications'),
  },
  {
    name: 'ai',
    load: () => import('@/app/(admin)/ai/page'),
    primary: 'GET /ai/metrics',
    title: title('ai'),
  },
  {
    name: 'ai models',
    load: () => import('@/app/(admin)/ai/models/page'),
    primary: 'GET /ai/models',
    title: null,
  },
  {
    name: 'ai prompts',
    load: () => import('@/app/(admin)/ai/prompts/page'),
    primary: 'GET /ai/prompts',
    title: title('prompts'),
  },
  {
    name: 'ai prompt',
    load: () => import('@/app/(admin)/ai/prompts/[key]/page'),
    primary: 'GET /ai/prompts/:key',
    title: null,
    params: { key: 'briefing_morning' },
    search: { from: '2', to: '3', v: '3' },
  },
  {
    name: 'ai feedback',
    load: () => import('@/app/(admin)/ai/feedback/page'),
    primary: 'GET /ai/feedback',
    title: title('aiFeedback'),
  },
  {
    name: 'subscriptions',
    load: () => import('@/app/(admin)/subscriptions/page'),
    primary: 'GET /subscriptions/metrics',
    title: title('subscriptions'),
  },
  {
    name: 'referrals',
    load: () => import('@/app/(admin)/referrals/page'),
    primary: 'GET /referrals/metrics',
    title: title('referrals'),
  },
  {
    name: 'feedback',
    load: () => import('@/app/(admin)/feedback/page'),
    primary: 'GET /feedback',
    title: title('feedback'),
  },
  {
    name: 'flags',
    load: () => import('@/app/(admin)/flags/page'),
    primary: 'GET /flags',
    title: title('flags'),
  },
  {
    name: 'announcements',
    load: () => import('@/app/(admin)/announcements/page'),
    primary: 'GET /announcements',
    title: title('announcements'),
  },
  {
    name: 'data requests',
    load: () => import('@/app/(admin)/data-requests/page'),
    primary: 'GET /data-requests',
    title: title('dataRequests'),
  },
  {
    name: 'audit',
    load: () => import('@/app/(admin)/audit/page'),
    primary: 'GET /audit',
    title: title('audit'),
  },
  {
    name: 'health',
    load: () => import('@/app/(admin)/health/page'),
    primary: 'GET /health/summary',
    title: title('health'),
  },
  {
    name: 'admins',
    load: () => import('@/app/(admin)/admins/page'),
    primary: 'GET /admins',
    title: title('admins'),
  },
  {
    name: 'settings security',
    load: () => import('@/app/(admin)/settings/page'),
    primary: 'GET /me/sessions',
    title: title('settings'),
    search: { tab: 'security' },
  },
  {
    name: 'settings system',
    load: () => import('@/app/(admin)/settings/page'),
    primary: 'GET /settings',
    title: title('settings'),
    search: { tab: 'system' },
  },
  {
    name: 'referrals list',
    load: () => import('@/app/(admin)/referrals/page'),
    primary: 'GET /referrals',
    title: title('referrals'),
    search: { tab: 'list' },
  },
  {
    name: 'referrals flagged',
    load: () => import('@/app/(admin)/referrals/page'),
    primary: 'GET /referrals',
    title: title('referrals'),
    search: { tab: 'flagged' },
  },
  {
    name: 'ai requests',
    load: () => import('@/app/(admin)/ai/page'),
    primary: 'GET /ai/requests',
    title: title('ai'),
    search: { tab: 'requests' },
  },
  {
    name: 'ai prompts search',
    load: () => import('@/app/(admin)/ai/prompts/page'),
    primary: 'GET /ai/prompts',
    title: title('prompts'),
    search: { q: 'briefing' },
  },
  {
    name: 'announcement detail',
    load: () => import('@/app/(admin)/announcements/page'),
    primary: 'GET /announcements/:id',
    title: title('announcements'),
    search: { id: uid('cccc', 1) },
  },
  {
    name: 'announcement new',
    load: () => import('@/app/(admin)/announcements/page'),
    primary: 'GET /announcements',
    title: title('announcements'),
    search: { new: '1' },
  },
  {
    name: 'audit entry',
    load: () => import('@/app/(admin)/audit/page'),
    primary: 'GET /audit/:id',
    title: title('audit'),
    search: { id: uid('eeee', 1) },
  },
  {
    name: 'audit verify',
    load: () => import('@/app/(admin)/audit/page'),
    primary: 'GET /audit/verify-chain',
    title: title('audit'),
    search: { verify: '24h' },
  },
  {
    name: 'data request detail',
    load: () => import('@/app/(admin)/data-requests/page'),
    primary: 'GET /data-requests/:kind/:id',
    title: title('dataRequests'),
    search: { request: FAILED_EXPORT_ID },
  },
  {
    name: 'history deletions',
    load: () => import('@/app/(admin)/data-requests/page'),
    primary: 'GET /data-requests',
    title: title('dataRequests'),
    search: { tab: 'history_deletion' },
  },
  {
    name: 'account deletions',
    load: () => import('@/app/(admin)/data-requests/page'),
    primary: 'GET /data-requests',
    title: title('dataRequests'),
    search: { tab: 'account_deletion' },
  },
  {
    name: 'flag detail',
    load: () => import('@/app/(admin)/flags/page'),
    primary: 'GET /flags/:key',
    title: title('flags'),
    search: {
      flag: 'feature.voice',
      eval_user: MAIN_USER_ID,
      eval_platform: 'ios',
      eval_version: '1.4.0',
    },
  },
  {
    name: 'archived flags',
    load: () => import('@/app/(admin)/flags/page'),
    primary: 'GET /flags',
    title: title('flags'),
    search: { archived: '1' },
  },
  {
    name: 'integration detail',
    load: () => import('@/app/(admin)/integrations/page'),
    primary: 'GET /integrations/:accountId',
    title: title('integrations'),
    search: { account: uid('3333', 1) },
  },
  {
    name: 'health versions',
    load: () => import('@/app/(admin)/health/page'),
    primary: 'GET /health/app-versions',
    title: title('health'),
    search: { tab: 'versions', platform: 'ios', old: '1' },
  },
  {
    name: 'health cron',
    load: () => import('@/app/(admin)/health/page'),
    primary: 'GET /health/cron',
    title: title('health'),
    search: { tab: 'cron' },
  },
  {
    name: 'subscribers',
    load: () => import('@/app/(admin)/subscriptions/page'),
    primary: 'GET /subscriptions',
    title: title('subscriptions'),
    search: { tab: 'subscribers' },
  },
  {
    name: 'subscription events',
    load: () => import('@/app/(admin)/subscriptions/page'),
    primary: 'GET /subscriptions/events',
    title: title('subscriptions'),
    search: { tab: 'events', event: 'evt_0001', environment: 'SANDBOX' },
  },
  {
    name: 'grants',
    load: () => import('@/app/(admin)/subscriptions/page'),
    primary: 'GET /entitlement-grants',
    title: title('subscriptions'),
    search: { tab: 'grants' },
  },
  {
    name: 'trials',
    load: () => import('@/app/(admin)/subscriptions/page'),
    primary: 'GET /subscriptions/trial-stream',
    title: title('subscriptions'),
    search: { tab: 'trials', range: '30d' },
  },
  {
    name: 'dashboard 30d',
    load: () => import('@/app/(admin)/dashboard/page'),
    primary: 'GET /dashboard/metrics',
    title: title('dashboard'),
    search: { range: '30d' },
  },
  {
    name: 'user integrations',
    load: () => import('@/app/(admin)/users/[id]/integrations/page'),
    primary: 'GET /users/:id/integrations',
    title: null,
    params: { id: MAIN_USER_ID },
  },
  {
    name: 'user briefings',
    load: () => import('@/app/(admin)/users/[id]/briefings/page'),
    primary: 'GET /users/:id/briefings',
    title: null,
    params: { id: MAIN_USER_ID },
  },
  {
    name: 'user usage',
    load: () => import('@/app/(admin)/users/[id]/usage/page'),
    primary: 'GET /users/:id/usage',
    title: null,
    params: { id: MAIN_USER_ID },
  },
  {
    name: 'user referrals',
    load: () => import('@/app/(admin)/users/[id]/referrals/page'),
    primary: 'GET /users/:id/referrals',
    title: null,
    params: { id: MAIN_USER_ID },
  },
  {
    name: 'user audit',
    load: () => import('@/app/(admin)/users/[id]/audit/page'),
    primary: 'GET /users/:id/audit',
    title: null,
    params: { id: MAIN_USER_ID },
  },
  {
    name: 'user overview',
    load: () => import('@/app/(admin)/users/[id]/overview/page'),
    primary: 'GET /users/:id',
    title: null,
    params: { id: MAIN_USER_ID },
  },
  {
    name: 'user subscription',
    load: () => import('@/app/(admin)/users/[id]/subscription/page'),
    primary: 'GET /users/:id/subscription',
    title: null,
    params: { id: MAIN_USER_ID },
  },
  {
    name: 'user support',
    load: () => import('@/app/(admin)/users/[id]/support/page'),
    primary: 'GET /users/:id/support',
    title: null,
    params: { id: MAIN_USER_ID },
  },
];

async function render(module: Module, role: Role) {
  const { default: Page } = (await module.load()) as { default: Page };
  const element = await Page(props(module.search ?? {}, module.params ?? {}));
  return renderPage(element as never, contextFor(role));
}

function deniedFor(module: Module, role: Role): boolean {
  return (
    accessDenied({
      key: module.primary,
      params: module.params ?? {},
      query: {},
      body: {},
      now: NOW,
      permissions: permissionsOf(role),
    }) !== null
  );
}

beforeEach(() => {
  useRole('super_admin');
});

describe.each(MODULES)('$name page', (module) => {
  it('renders the data state for super_admin and sends the primary read', async () => {
    const root = await render(module, 'super_admin');
    if (module.title !== null) expect(textOf(root.querySelector('h1'))).toBe(module.title);
    expect(textOf(root)).not.toContain(STATES.error);
    expect(textOf(root)).not.toContain(STATES.forbidden);
    expect(harness.calls.map((c) => c.key)).toContain(module.primary);
  });

  it('shows the error state with the correlation id when the primary read fails', async () => {
    harness.failures.set(module.primary, { status: 503, code: 'SERVICE_UNAVAILABLE' });
    const root = await render(module, 'super_admin');
    const text = textOf(root);
    expect(text).toContain(STATES.error);
    expect(text).toMatch(/corr-\d{8}/);
  });

  it.each(['support', 'finance', 'readonly'] as const)(
    'as %s: forbidden when admin-api refuses the read, data otherwise',
    async (role) => {
      useRole(role);
      const root = await render(module, role);
      const text = textOf(root);
      // Tables answer a refused row read with the aggregates-only notice (§4.5).
      if (deniedFor(module, role)) {
        expect(text.includes(STATES.forbidden) || text.includes(STATES.aggregatesOnly)).toBe(true);
      } else expect(text).not.toContain(STATES.error);
    },
  );
});

describe('prompt eval gate (AI_PIPELINE_PLAN §5.4)', () => {
  const PROMPTS = B.prompts as { eval: Record<string, string>; actions: Record<string, string> };
  const promptPage = (key: string, version: string): Module => ({
    name: `prompt ${key}`,
    load: () => import('@/app/(admin)/ai/prompts/[key]/page'),
    primary: 'GET /ai/prompts/:key',
    title: null,
    params: { key },
    search: { version },
  });

  it('shows the last run per target and offers a new run to prompts.write', async () => {
    const root = await render(promptPage('post_meeting', '2'), 'super_admin');
    const report = root.querySelector('[data-testid="prompt-eval-report"]');
    expect(textOf(report)).toContain(PROMPTS.eval.title);
    expect(textOf(report)).toContain(PROMPTS.eval.passed);
    expect(textOf(report)).toContain('sha256:5f0c2a91d4e7b836');
    expect(textOf(report)).toContain('anthropic · mock-primary');
    expect(root.querySelector('[data-testid="prompt-eval"]')).not.toBeNull();
    expect(harness.calls.map((c) => c.key)).toContain('GET /ai/prompts/:key/versions/:v');
  });

  it('says a version was never evaluated and hides the run without prompts.write', async () => {
    useRole('readonly');
    const root = await render(promptPage('post_meeting', '1'), 'readonly');
    const report = root.querySelector('[data-testid="prompt-eval-report"]');
    expect(textOf(report)).toContain(PROMPTS.eval.never);
    expect(root.querySelector('[data-testid="prompt-eval"]')).toBeNull();
  });

  it('has no eval section or run for a key without a golden set', async () => {
    const root = await render(promptPage('briefing_morning', '3'), 'super_admin');
    expect(root.querySelector('[data-testid="prompt-version"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="prompt-eval-report"]')).toBeNull();
    expect(root.querySelector('[data-testid="prompt-eval"]')).toBeNull();
  });
});
