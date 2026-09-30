/**
 * KPL-32 `google_oauth` probe detail: while the OAuth app is unverified the probe counts Gmail users
 * against Google's 100-user cap (degraded at 80, down at 95); verified (and an unexpired CASA
 * letter) it is healthy; discovery failures and a missing credential keep their meaning.
 */
import { assertEquals } from '@std/assert';
import { testEnv } from '../../_shared/testing/env.ts';
import { stubFetch } from '../../_shared/testing/fetch.ts';
import { googleOauthProbe } from './google_oauth.ts';
import type { HealthData, ProbeContext, ProbeResult } from './types.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const GOOGLE = {
  GOOGLE_OAUTH_CLIENT_ID:
    '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.dijitalasistan.app/functions/v1/oauth/google/callback',
};

function ctx(
  google: { setting: unknown; gmailUsers: number } | Error,
  env: Record<string, string | undefined> = GOOGLE,
  discovery = 200,
): ProbeContext {
  const stub = stubFetch(() => new Response('{}', { status: discovery }));
  return {
    raw: testEnv(env),
    data: {
      googleOauth: () =>
        google instanceof Error ? Promise.reject(google) : Promise.resolve(google),
    } as unknown as HealthData,
    fetch: stub.fetch,
    now: () => NOW,
    timeoutMs: 4000,
    demo: { enabled: false, allowed: false } as never,
    baseUrl: null,
  };
}

async function probe(c: ProbeContext): Promise<ProbeResult> {
  return (await googleOauthProbe(c)) as ProbeResult;
}

Deno.test(
  'KPL-32: unverified with few Gmail users is healthy with the unverified detail',
  async () => {
    const r = await probe(ctx({ setting: false, gmailUsers: 12 }));
    assertEquals([r.status, r.detailCode], ['healthy', 'google_unverified']);
    assertEquals(r.detail, { verified: false, gmail_users: 12, cap: 100 });
  },
);

Deno.test('KPL-32: the 100-user cap turns the probe degraded at 80 and down at 95', async () => {
  const near = await probe(ctx({ setting: false, gmailUsers: 80 }));
  assertEquals([near.status, near.detailCode], ['degraded', 'google_unverified_cap_near']);
  const reached = await probe(ctx({ setting: false, gmailUsers: 97 }));
  assertEquals([reached.status, reached.detailCode], ['down', 'google_unverified_cap_reached']);
});

Deno.test(
  'KPL-32: verified with a valid CASA letter is healthy; an expired letter is not',
  async () => {
    const ok = await probe(
      ctx(
        { setting: true, gmailUsers: 500 },
        { ...GOOGLE, GOOGLE_CASA_LOA_NOT_AFTER: '2027-06-30' },
      ),
    );
    assertEquals([ok.status, ok.detailCode, ok.detail], ['healthy', null, { verified: true }]);
    const expired = await probe(
      ctx(
        { setting: true, gmailUsers: 500 },
        { ...GOOGLE, GOOGLE_CASA_LOA_NOT_AFTER: '2026-06-30' },
      ),
    );
    assertEquals([expired.status, expired.detailCode], ['down', 'google_unverified_cap_reached']);
  },
);

Deno.test(
  'google_oauth: discovery failure, unreadable status and a missing credential',
  async () => {
    const failed = await probe(ctx({ setting: false, gmailUsers: 0 }, GOOGLE, 503));
    assertEquals([failed.status, failed.detailCode], ['degraded', 'discovery_failed']);
    const unknown = await probe(ctx(new Error('db down')));
    assertEquals([unknown.status, unknown.detailCode], ['unknown', 'verification_unknown']);
    const missing = await probe(ctx({ setting: true, gmailUsers: 0 }, {}));
    assertEquals(missing.status, 'external_credential_required');
  },
);
