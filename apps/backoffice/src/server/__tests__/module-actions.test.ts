import { adminRoutes } from '@da/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutateAction } from '@/actions/mutate';
import type * as ActionModule from '@/server/action';
import {
  ADMIN_RESPONSES,
  MODULE_MUTATION_ROUTES,
  auditActions,
  isModuleMutation,
  moduleConfirmations,
} from '../admin-contracts';

/*
 * The module mutation path (BACKOFFICE_PLAN §2.3, T-10.05…T-10.14): one allow-listed server action,
 * confirmation levels derived from the registry, and the audit action catalogue.
 */

const run = vi.hoisted(() => vi.fn(async () => ({ ok: true, data: { ok: true } })));
vi.mock('@/server/action', async (original) => ({
  ...(await original<typeof ActionModule>()),
  runAdminMutation: run,
}));
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const USER = '0190f5e0-1111-7000-8000-00000000abcd';
const ENVELOPE = {
  idempotencyKey: '0190f5e0-9999-7000-8000-000000000001',
  reason: 'Destek talebi için gerekli',
};

beforeEach(() => {
  run.mockClear();
});

describe('module mutation allow-list', () => {
  it('lists only registry mutations with a typed response, never reads, reveals or BFF routes', () => {
    for (const key of MODULE_MUTATION_ROUTES) {
      expect(adminRoutes[key].method, key).not.toBe('GET');
      expect(ADMIN_RESPONSES[key], key).toBe(adminRoutes[key].response);
      expect(['bff', 'aal1'], key).not.toContain(adminRoutes[key].access.require);
      expect(key, key).not.toMatch(/reveal|\/auth\//);
    }
    expect(isModuleMutation('POST /users/:id/force-sync')).toBe(true);
    expect(isModuleMutation('POST /users/:id/reveal')).toBe(false);
    expect(isModuleMutation('GET /users')).toBe(false);
  });

  it('derives the confirmation level of every control from the registry', () => {
    const levels = moduleConfirmations();
    expect(levels['POST /users/:id/disable']).toEqual({
      requiresReason: true,
      requiresConfirm: true,
      requiresStepUp: true,
    });
    expect(levels['POST /jobs/:id/retry']).toEqual({
      requiresReason: true,
      requiresConfirm: true,
      requiresStepUp: false,
    });
    expect(levels['POST /support/tickets/:id/notes']).toEqual({
      requiresReason: false,
      requiresConfirm: false,
      requiresStepUp: false,
    });
    expect(levels['PATCH /flags/:key'].requiresReason).toBe(true);
    expect(levels['POST /support-access/grants'].requiresStepUp).toBe(true);
    expect(Object.keys(levels).sort()).toEqual([...MODULE_MUTATION_ROUTES].sort());
  });

  it('offers every registry audit action plus denials, sorted and unique', () => {
    const actions = auditActions();
    expect(actions).toContain('admin.permission_denied');
    expect(actions).toContain('flag.kill_switch_on');
    expect(actions).toContain('support_access.granted');
    expect([...actions].sort()).toEqual(actions);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe('mutateAction', () => {
  it('forwards an allow-listed route with its params, body and page to re-render', async () => {
    const result = await mutateAction(
      {
        route: 'POST /users/:id/force-sync',
        params: { id: USER },
        body: { resources: ['mail'] },
        revalidate: `/users/${USER}/overview`,
      },
      ENVELOPE,
    );
    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledWith({
      route: 'POST /users/:id/force-sync',
      params: { id: USER },
      body: { resources: ['mail'] },
      envelope: ENVELOPE,
      revalidate: `/users/${USER}/overview`,
    });
  });

  it('takes reason and confirm only from the dialog envelope, never from the body', async () => {
    await mutateAction(
      {
        route: 'POST /jobs/:id/retry',
        params: { id: USER },
        body: { reset_attempts: true, reason: 'x', confirm: true },
      },
      ENVELOPE,
    );
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ body: { reset_attempts: true } }));
  });

  it('refuses routes outside the allow-list, bad param names and non-path revalidation targets', async () => {
    const refusals = await Promise.all([
      mutateAction({ route: 'POST /users/:id/reveal' as never, params: { id: USER } }, ENVELOPE),
      mutateAction({ route: 'POST /auth/attempt' as never }, ENVELOPE),
      mutateAction({ route: 'POST /jobs/:id/retry', params: { 'id]': USER } }, ENVELOPE),
      mutateAction(
        { route: 'POST /jobs/:id/retry', params: { id: USER }, revalidate: 'https://example.com/' },
        ENVELOPE,
      ),
    ]);
    for (const result of refusals) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', status: 422 },
      });
    }
    expect(run).not.toHaveBeenCalled();
  });
});
