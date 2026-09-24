import { describe, expect, it, vi } from 'vitest';

import { createSupabaseClient, type AuthStorage, type EmptyDatabase } from '../src/index.ts';

function memoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => Promise.resolve(map.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
      return Promise.resolve();
    }),
  } satisfies AuthStorage;
  return { map, storage };
}

const options = (storage: AuthStorage) => ({
  url: 'https://api.dijitalasistan.app',
  publishableKey: 'sb_publishable_abc123',
  storage,
  autoRefreshToken: false,
  fetch: () => Promise.reject(new Error('no network in tests')),
});

describe('createSupabaseClient', () => {
  it('reads and clears the session only through the injected storage', async () => {
    const { map, storage } = memoryStorage();
    const session = {
      access_token: 'a.b.c',
      refresh_token: 'r',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated' },
    };
    map.set('da.auth.session', JSON.stringify(session));
    const supabase = createSupabaseClient<EmptyDatabase>(options(storage));
    const { data } = await supabase.auth.getSession();
    expect(data.session?.access_token).toBe('a.b.c');
    expect(storage.getItem).toHaveBeenCalledWith('da.auth.session');

    await supabase.auth.signOut({ scope: 'local' });
    expect(map.has('da.auth.session')).toBe(false);
  });

  it('uses the configured storage key and PKCE', async () => {
    const { storage } = memoryStorage();
    const supabase = createSupabaseClient<EmptyDatabase>({
      ...options(storage),
      storageKey: 'custom.key',
    });
    const { data } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo: 'dijitalasistan://auth/callback', skipBrowserRedirect: true },
    });
    const url = new URL(data.url ?? '');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    expect(url.searchParams.get('redirect_to')).toBe('dijitalasistan://auth/callback');
    // The PKCE verifier is persisted through the injected storage, under the configured key.
    expect(storage.setItem).toHaveBeenCalledWith('custom.key-code-verifier', expect.any(String));
  });

  it('refuses a secret key', () => {
    const { storage } = memoryStorage();
    expect(() =>
      createSupabaseClient<EmptyDatabase>({ ...options(storage), publishableKey: 'sb_secret_x' }),
    ).toThrow(/secret key/);
  });
});
