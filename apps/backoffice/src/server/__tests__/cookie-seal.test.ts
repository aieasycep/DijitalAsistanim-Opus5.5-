import { describe, expect, it } from 'vitest';

import {
  AUTH_COOKIE,
  applyJarWrites,
  chunkWrites,
  openJar,
  readChunks,
  seal,
  sealJar,
  sealingKey,
  unseal,
} from '../cookie-seal';

const SECRET = 'a-test-bff-secret-that-is-at-least-32-characters';

describe('sealed auth cookies (BACKOFFICE_PLAN §3.8)', () => {
  it('round-trips a value and binds it to its purpose', async () => {
    const key = await sealingKey(SECRET);
    const sealed = await seal(key, 'session-json', AUTH_COOKIE);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('session-json');
    expect(await unseal(key, sealed, AUTH_COOKIE)).toBe('session-json');
    expect(await unseal(key, sealed, '__Host-da_admin_login')).toBeNull();
  });

  it('treats a tampered, truncated or foreign cookie as no session', async () => {
    const key = await sealingKey(SECRET);
    const other = await sealingKey('another-secret-with-at-least-32-characters!!');
    const sealed = await seal(key, 'x', AUTH_COOKIE);
    const flipped = `${sealed.slice(0, -2)}${sealed.endsWith('A') ? 'B' : 'A'}${sealed.slice(-1)}`;
    expect(await unseal(key, flipped, AUTH_COOKIE)).toBeNull();
    expect(await unseal(key, sealed.slice(0, 10), AUTH_COOKIE)).toBeNull();
    expect(await unseal(other, sealed, AUTH_COOKIE)).toBeNull();
    expect(await unseal(key, 'plain-supabase-cookie', AUTH_COOKIE)).toBeNull();
    expect(await openJar(key, [{ name: AUTH_COOKIE, value: flipped }])).toEqual({});
  });

  it('stores the whole jar sealed, chunked under __Host-da_admin.N when large', async () => {
    const key = await sealingKey(SECRET);
    const jar = { [AUTH_COOKIE]: 'base64-'.padEnd(6000, 'x') };
    const sealed = await sealJar(key, jar);
    const writes = chunkWrites(AUTH_COOKIE, sealed, []);
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.map((w) => w.name)).toEqual(writes.map((_, i) => `${AUTH_COOKIE}.${String(i)}`));
    for (const write of writes) {
      expect(write.options).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 43_200,
      });
      expect(write.value.length).toBeLessThanOrEqual(3_800);
    }
    const cookies = writes.map(({ name, value }) => ({ name, value }));
    expect(readChunks(cookies, AUTH_COOKIE)).toBe(sealed);
    expect(await openJar(key, cookies)).toEqual(jar);
  });

  it('deletes stale chunks and clears everything for an empty jar', async () => {
    const key = await sealingKey(SECRET);
    const small = await sealJar(key, { a: '1' });
    const writes = chunkWrites(AUTH_COOKIE, small, [`${AUTH_COOKIE}.0`, `${AUTH_COOKIE}.1`]);
    expect(writes).toEqual([
      expect.objectContaining({ name: AUTH_COOKIE, value: small }),
      expect.objectContaining({
        name: `${AUTH_COOKIE}.0`,
        value: '',
        options: expect.objectContaining({ maxAge: 0 }),
      }),
      expect.objectContaining({
        name: `${AUTH_COOKIE}.1`,
        value: '',
        options: expect.objectContaining({ maxAge: 0 }),
      }),
    ]);
    expect(await sealJar(key, {})).toBe('');
    expect(chunkWrites(AUTH_COOKIE, '', [AUTH_COOKIE]).every((w) => w.options.maxAge === 0)).toBe(
      true,
    );
  });

  it('applies @supabase/ssr setAll writes to the jar (empty value or maxAge 0 deletes)', () => {
    const jar = applyJarWrites({ a: '1', b: '2' }, [
      { name: 'a', value: '', options: {} },
      { name: 'b', value: 'x', options: { maxAge: 0 } },
      { name: 'c', value: '3' },
    ]);
    expect(jar).toEqual({ c: '3' });
  });
});
