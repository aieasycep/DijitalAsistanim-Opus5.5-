import { describe, expect, it, vi } from 'vitest';

/*
 * `next build` without runtime secrets (T-10 contract gap 13): during static generation the admin
 * shell's first admin-api read must hit the dynamic request API (`headers()`, which bails out of
 * prerendering) before any server-only environment value is read, so the build logs no
 * "Invalid environment" error. At request time the environment is still validated.
 */

const nextHeaders = vi.hoisted(() => ({ headers: vi.fn(), cookies: vi.fn() }));
const env = vi.hoisted(() => ({
  serverEnv: vi.fn(() => {
    throw new Error('Invalid environment: API_PUBLIC_BASE_URL');
  }),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('@/env', () => env);

const { adminApi } = await import('../admin-api');

describe('admin-api reads during next build', () => {
  it('bails out on the request API before the environment is read', async () => {
    nextHeaders.headers.mockRejectedValueOnce(new Error('DYNAMIC_SERVER_USAGE'));
    await expect(adminApi('GET /me')).rejects.toThrow('DYNAMIC_SERVER_USAGE');
    expect(env.serverEnv).not.toHaveBeenCalled();
  });

  it('still validates the environment at request time', async () => {
    nextHeaders.headers.mockResolvedValueOnce(new Headers());
    await expect(adminApi('GET /me')).rejects.toThrow('Invalid environment');
    expect(env.serverEnv).toHaveBeenCalledTimes(1);
  });
});
