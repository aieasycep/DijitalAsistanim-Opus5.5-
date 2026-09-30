/**
 * UT-MB-04 query persistence (T-8.23, CTL-3.13): only successful `meta.persist` queries reach the
 * encrypted `da-cache` store; original mail bodies, search results, signed audio URLs and auth data
 * never do, even when a query opts in by mistake.
 */
import { qk } from '@da/api-client';
import { describe, expect, it } from '@jest/globals';
import { QueryClient, dehydrate } from '@tanstack/react-query';

import { isNeverPersisted, shouldPersistQuery } from '../src/lib/query/persister';

async function clientWith(entries: readonly (readonly [readonly unknown[], unknown, boolean])[]) {
  // No garbage-collection timers: the test process must be able to exit.
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  for (const [queryKey, data, persist] of entries) {
    await client.query({
      queryKey,
      queryFn: () => Promise.resolve(data),
      ...(persist ? { meta: { persist: true } } : {}),
    });
  }
  return client;
}

describe('persisted query cache', () => {
  it('dehydrates only opted-in, allowed queries', async () => {
    const client = await clientWith([
      [qk.me.bootstrap(), { profile: 'cached' }, true],
      [qk.flow.all, { cards: [] }, true],
      [qk.mail.original('m1'), { body: 'Sayın Ahmet Bey, teklif ektedir.' }, true],
      [qk.search.results({ q: 'teklif' }), { hits: ['teklif'] }, true],
      [qk.briefings.audio('b1'), { url: 'https://signed.example/audio' }, true],
      [['auth', 'session'], { access_token: 'eyJ.x.y' }, true],
      [qk.today.all, { today: 'memory only' }, false],
    ]);
    const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });
    expect(state.queries.map((q) => q.queryKey)).toEqual([qk.me.bootstrap(), qk.flow.all]);
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain('Sayın Ahmet Bey');
    expect(serialised).not.toContain('signed.example');
    expect(serialised).not.toContain('eyJ');
    client.clear();
  });

  it('never persists original bodies, search results, audio URLs or auth keys', () => {
    expect(isNeverPersisted(qk.mail.original('x'))).toBe(true);
    expect(isNeverPersisted(qk.search.memory({ q: 'x' }))).toBe(true);
    expect(isNeverPersisted(qk.briefings.audio('x'))).toBe(true);
    expect(isNeverPersisted(qk.mail.message('x'))).toBe(false);
    expect(isNeverPersisted(qk.me.bootstrap())).toBe(false);
  });
});
