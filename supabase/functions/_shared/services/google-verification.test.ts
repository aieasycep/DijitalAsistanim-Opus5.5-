/**
 * KPL-32 Google OAuth verification status and the referral reward switch as `GET /me/bootstrap`
 * reads them (`app_settings` through the api's settings repository).
 */
import { assertEquals } from '@std/assert';
import type { DbClient } from '../db/clients.ts';
import { supabaseAppSettingsRepo } from './account-state.ts';
import { googleOauthVerified } from './google-verification.ts';

const NOW = new Date('2026-09-28T09:00:00Z');

Deno.test('googleOauthVerified: the setting must be true and the CASA letter unexpired', () => {
  assertEquals(googleOauthVerified(false, undefined, NOW), false);
  assertEquals(googleOauthVerified('true', undefined, NOW), false);
  assertEquals(googleOauthVerified(true, undefined, NOW), true);
  assertEquals(googleOauthVerified(true, '', NOW), true);
  assertEquals(googleOauthVerified(true, '2027-09-01', NOW), true);
  assertEquals(googleOauthVerified(true, '2026-09-28', NOW), true, 'valid through the day');
  assertEquals(googleOauthVerified(true, '2026-09-27', NOW), false, 'an expired LOA');
  assertEquals(googleOauthVerified(true, '2026-09-28T08:00:00Z', NOW), false);
  assertEquals(googleOauthVerified(true, 'not-a-date', NOW), false);
});

function settingsClient(rows: { key: string; value: unknown }[]): DbClient {
  const query = {
    select: () => query,
    in: (_column: string, keys: string[]) =>
      Promise.resolve({ data: rows.filter((r) => keys.includes(r.key)), error: null }),
  };
  return { from: () => query } as unknown as DbClient;
}

Deno.test('settings repo: defaults are rewards on and Google unverified', async () => {
  const repo = supabaseAppSettingsRepo(settingsClient([]), { now: () => NOW.getTime() });
  assertEquals(await repo.referralRewardsEnabled(), true);
  assertEquals(await repo.googleOauthVerified(), false);
});

Deno.test('settings repo: reads the switch and the verification with the LOA expiry', async () => {
  const rows = [
    { key: 'referral.rewards_enabled', value: false },
    { key: 'google.oauth_verified', value: true },
  ];
  const valid = supabaseAppSettingsRepo(settingsClient(rows), {
    now: () => NOW.getTime(),
    googleCasaLoaNotAfter: '2027-03-01',
  });
  assertEquals(await valid.referralRewardsEnabled(), false);
  assertEquals(await valid.googleOauthVerified(), true);
  const expired = supabaseAppSettingsRepo(settingsClient(rows), {
    now: () => NOW.getTime(),
    googleCasaLoaNotAfter: '2026-01-01',
  });
  assertEquals(await expired.googleOauthVerified(), false);
});
