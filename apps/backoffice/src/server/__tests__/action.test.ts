import { describe, expect, it, vi } from 'vitest';

import { runAdminMutation, type MutationDeps } from '../action';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const USER = '0190f5e0-1111-7000-8000-00000000abcd';
const KEY = '0190f5e0-2222-7000-8000-000000000001';
const REASON = 'Destek talebi DA-2026-000123 için doğrulama';

function deps(overrides: Partial<MutationDeps> = {}): MutationDeps & {
  call: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
  revalidate: ReturnType<typeof vi.fn>;
  stepUp: ReturnType<typeof vi.fn>;
} {
  return {
    checkOrigin: vi.fn(async () => ({ ok: true as const })),
    call: vi.fn(async () => ({
      ok: true,
      status: 200,
      data: { value: 'yusuf@gmail.com', expires_in_s: 60 },
      meta: {},
      correlationId: 'c',
    })),
    stepUp: vi.fn(async () => ({ ok: true as const })),
    redirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
    revalidate: vi.fn(),
    ...overrides,
  } as never;
}

describe('runAdminMutation (adminAction wrapper, BACKOFFICE_PLAN §2.3)', () => {
  it('returns 403 without calling admin-api when the Origin is missing or foreign', async () => {
    const d = deps({
      checkOrigin: vi.fn(async () => ({ ok: false as const, reason: 'origin_missing' as const })),
    });
    const result = await runAdminMutation(
      {
        route: 'POST /users/:id/reveal',
        params: { id: USER },
        body: { field: 'email' },
        envelope: { reason: REASON, confirm: true },
      },
      d,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CSRF_ORIGIN', status: 403, messageKey: 'errors.csrf' },
    });
    expect(d.call).not.toHaveBeenCalled();
  });

  it('requires a 10–500 character reason where the route contract declares one', async () => {
    const d = deps();
    for (const reason of [undefined, 'kısa', '   dokuz  ', 'x'.repeat(501)]) {
      const result = await runAdminMutation(
        {
          route: 'POST /users/:id/reveal',
          params: { id: USER },
          body: { field: 'email' },
          envelope: { reason, confirm: true },
        },
        d,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'REASON_REQUIRED', messageKey: 'errors.reasonRequired' },
      });
    }
    expect(d.call).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason, confirm and the dialog idempotency key', async () => {
    const d = deps();
    const result = await runAdminMutation(
      {
        route: 'POST /users/:id/reveal',
        params: { id: USER },
        body: { field: 'email' },
        envelope: { reason: `  ${REASON}  `, confirm: true, idempotencyKey: KEY },
        revalidate: '/users',
      },
      d,
    );
    expect(result).toEqual({ ok: true, data: { value: 'yusuf@gmail.com', expires_in_s: 60 } });
    expect(d.call).toHaveBeenCalledWith(
      'POST /users/:id/reveal',
      { params: { id: USER }, body: { field: 'email', reason: REASON, confirm: true } },
      { idempotencyKey: KEY },
    );
    expect(d.revalidate).toHaveBeenCalledWith('/users');
  });

  it('attaches a fresh uuid v7 idempotency key when the envelope has none', async () => {
    const d = deps({
      call: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: { ended_sessions: 1 },
        meta: {},
        correlationId: 'c',
      })) as never,
    });
    await runAdminMutation(
      { route: 'POST /session/logout-all', body: { scope: 'all' }, envelope: { confirm: true } },
      d,
    );
    const options = d.call.mock.calls[0]?.[2] as { idempotencyKey: string };
    expect(options.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('does not ask for a reason where the route has none, but still requires confirm', async () => {
    const d = deps({
      call: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: { ended_sessions: 1 },
        meta: {},
        correlationId: 'c',
      })) as never,
    });
    const missingConfirm = await runAdminMutation(
      { route: 'POST /session/logout-all', body: { scope: 'all' }, envelope: {} },
      d,
    );
    expect(missingConfirm).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const ok = await runAdminMutation(
      { route: 'POST /session/logout-all', body: { scope: 'all' }, envelope: { confirm: true } },
      d,
    );
    expect(ok.ok).toBe(true);
    expect(d.call.mock.calls[0]?.[1]).toEqual({ body: { scope: 'all', confirm: true } });
  });

  it('rejects a malformed envelope', async () => {
    const d = deps();
    const result = await runAdminMutation(
      {
        route: 'POST /users/:id/reveal',
        params: { id: USER },
        envelope: { reason: REASON, confirm: true, idempotencyKey: 'nope' },
      },
      d,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(d.call).not.toHaveBeenCalled();
  });

  it('runs the TOTP step-up first on step-up routes when a code is provided', async () => {
    const order: string[] = [];
    const d = deps({
      stepUp: vi.fn(async () => {
        order.push('step-up');
        return { ok: true as const };
      }),
      call: vi.fn(async () => {
        order.push('call');
        return {
          ok: true,
          status: 200,
          data: { codes: [], generated_at: '' },
          meta: {},
          correlationId: 'c',
        };
      }) as never,
    });
    await runAdminMutation(
      { route: 'POST /me/recovery-codes', envelope: { stepUpCode: '123456' } },
      d,
    );
    expect(order).toEqual(['step-up', 'call']);
  });

  it('maps a step-up refusal so the dialog shows the code field', async () => {
    const d = deps({
      call: vi.fn(async () => ({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          status: 403,
          correlationId: 'corr',
          details: { reason: 'step_up_required' },
        },
      })) as never,
    });
    const result = await runAdminMutation({ route: 'POST /me/recovery-codes', envelope: {} }, d);
    expect(result).toMatchObject({
      ok: false,
      error: { messageKey: 'errors.stepUpRequired', stepUpRequired: true, correlationId: 'corr' },
    });
  });

  it('redirects session failures to /login or /mfa', async () => {
    const d = deps({
      call: vi.fn(async () => ({
        ok: false,
        error: {
          code: 'AUTH_REQUIRED',
          status: 401,
          correlationId: 'corr',
          details: { reason: 'session_revoked' },
        },
      })) as never,
    });
    await expect(
      runAdminMutation(
        { route: 'POST /session/logout-all', body: { scope: 'all' }, envelope: { confirm: true } },
        d,
      ),
    ).rejects.toThrow('redirect:/login?reason=revoked');
  });
});
