import { assert, assertEquals } from '@std/assert';
import { encryptToken, loadKeyring } from '../crypto/token-cipher.ts';
import { randomBase64 } from '../testing/env.ts';
import { jsonResponse, stubFetch } from '../testing/fetch.ts';
import { testDb } from '../testing/db.ts';
import { compareSemver, effectiveAccountState, upgradeRequired } from './account-state.ts';
import {
  announcementVisible,
  mapNotificationPreferences,
  unavailableFeatures,
} from './bootstrap.ts';
import { reencryptBatch, supabaseCredentialsRepo } from './credentials.ts';
import { supabaseDevicesRepo } from './devices.ts';
import { buildEntitlementState, nextLocalMidnight } from './entitlements.ts';
import { normalizeFlagMap, supabaseFlagSource } from './flags.ts';
import { memoryCredentials } from '../testing/credentials.ts';

const USER = '11111111-1111-4111-8111-111111111111';

Deno.test('flags: both evaluate_flags shapes normalise; per-user results are cached', async () => {
  assertEquals(normalizeFlagMap({ a: true, b: { enabled: false }, c: 'x', d: null }), {
    a: true,
    b: false,
  });
  const stub = stubFetch(() => jsonResponse({ 'ai.global.enabled': true }));
  const source = supabaseFlagSource(testDb(stub.fetch));
  assertEquals(await source.forUser(USER, 'ios', '1.4.0'), { 'ai.global.enabled': true });
  await source.forUser(USER, 'ios', '1.4.0');
  assertEquals(stub.calls.length, 1);
  assertEquals(stub.calls[0]?.headers.get('Content-Profile'), 'private');
  assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
    p_user: USER,
    p_platform: 'ios',
    p_app_version: '1.4.0',
  });
});

Deno.test('account state and version helpers', () => {
  assertEquals(
    effectiveAccountState({ state: 'active', disabledAt: '2026-01-01T00:00:00Z' }),
    'disabled',
  );
  assertEquals(effectiveAccountState(null), 'active');
  assertEquals(compareSemver('1.10.0', '1.9.9'), 1);
  assertEquals(compareSemver('1.2', '1.2.0'), 0);
  assert(
    upgradeRequired({ platform: 'android', version: '1.1.9' }, { ios: '1.0.0', android: '1.2.0' }),
  );
  assert(!upgradeRequired({ platform: null, version: null }, { ios: '9.0.0', android: '9.0.0' }));
});

Deno.test(
  'entitlements: store and grants mapped without money; expired or revoked grants hidden',
  () => {
    const now = new Date('2026-09-23T07:00:00Z');
    const state = buildEntitlementState(
      {
        is_active: true,
        source: 'grant',
        is_trial: false,
        will_renew: false,
        store_expires_at: null,
        grant_ends_at: '2026-10-01T00:00:00Z',
        active_until: '2026-10-01T00:00:00Z',
      },
      {
        is_active: false,
        store: 'app_store',
        product_id: 'pro_monthly',
        period_type: 'weird',
        will_renew: false,
        expires_at: '2026-09-01T00:00:00Z',
        billing_issue_at: null,
      },
      [
        {
          id: 'g1',
          source: 'referral_referee',
          starts_at: '2026-09-01T00:00:00Z',
          ends_at: '2026-10-01T00:00:00Z',
          revoked_at: null,
        },
        {
          id: 'g2',
          source: 'admin',
          starts_at: '2026-08-01T00:00:00Z',
          ends_at: '2026-09-01T00:00:00Z',
          revoked_at: null,
        },
        {
          id: 'g3',
          source: 'support',
          starts_at: '2026-09-01T00:00:00Z',
          ends_at: '2026-12-01T00:00:00Z',
          revoked_at: '2026-09-02T00:00:00Z',
        },
      ],
      now,
    );
    assertEquals(state.source, 'grant');
    assertEquals(state.store.period_type, 'normal');
    assertEquals(
      state.grants.map((g) => g.id),
      ['g1'],
    );
    assert(!JSON.stringify(state).includes('price'));
    assertEquals(nextLocalMidnight('Europe/Istanbul', now), '2026-09-23T21:00:00.000Z');
    assertEquals(nextLocalMidnight('Not/AZone', now), '2026-09-23T21:00:00.000Z');
  },
);

Deno.test(
  'bootstrap helpers: announcement targeting, quiet-hour defaults and unavailable features',
  () => {
    const now = new Date('2026-09-23T07:00:00Z');
    const row = {
      id: 'a1',
      title_tr: 't',
      title_en: 't',
      body_tr: 'b',
      body_en: 'b',
      audience: 'pro' as const,
      platforms: ['ios'],
      min_app_version: '1.3.0',
      max_app_version: null,
      starts_at: '2026-09-20T00:00:00Z',
      ends_at: '2026-09-30T00:00:00Z',
      cta_deeplink: null,
    };
    assert(announcementVisible(row, { plan: 'pro', platform: 'ios', version: '1.4.0', now }));
    assert(!announcementVisible(row, { plan: 'free', platform: 'ios', version: '1.4.0', now }));
    assert(!announcementVisible(row, { plan: 'pro', platform: 'android', version: '1.4.0', now }));
    assert(!announcementVisible(row, { plan: 'pro', platform: 'ios', version: '1.2.0', now }));
    const prefs = mapNotificationPreferences({ detail_level: 'generic' });
    assertEquals(
      [prefs.meetings_bypass_quiet, prefs.quiet_start, prefs.daily_cap],
      [false, '22:30', 5],
    );
    const off = unavailableFeatures(
      {
        aiGenerate: true,
        embeddings: true,
        ttsPremium: false,
        googleOauth: true,
        microsoftOauth: true,
        purchases: true,
        push: true,
      },
      { 'ai.global.enabled': false, 'voice.tts_premium': true },
    );
    assertEquals(
      off.map((f) => `${f.feature}:${f.reason}`),
      [
        'assistant:feature_disabled',
        'reply_drafts:feature_disabled',
        'semantic_search:feature_disabled',
        'voice_premium:external_credential_required',
      ],
    );
  },
);

Deno.test(
  'devices repository: installation upsert on installation_id; token disable filters',
  async () => {
    const stub = stubFetch((call) => {
      if (call.method === 'POST') return jsonResponse({ id: 'row-1' }, 201);
      if (call.method === 'PATCH') return jsonResponse([{ id: 't1' }, { id: 't2' }]);
      return jsonResponse(null);
    });
    const db = testDb(stub.fetch);
    const repo = supabaseDevicesRepo({ system: db, user: db });
    const id = await repo.upsertInstallation({
      user_id: USER,
      installation_id: 'i-1',
      platform: 'ios',
      os_version: '18',
      app_version: '1.4.0',
      build_number: '1',
      locale: 'tr-TR',
      timezone: 'Europe/Istanbul',
      push_enabled: true,
      device_hash: '\\x00',
      last_seen_at: '2026-09-23T07:00:00Z',
      signed_out_at: null,
    });
    assertEquals(id, 'row-1');
    assert(decodeURIComponent(stub.calls[0]?.url ?? '').includes('on_conflict=installation_id'));
    assertEquals(
      await repo.disableInstallationTokens('row-1', 'replaced', {
        exceptTokenRowId: 't9',
        notUserId: USER,
      }),
      2,
    );
    const patch = decodeURIComponent(stub.calls[1]?.url ?? '');
    assert(
      patch.includes('installation_id=eq.row-1') &&
        patch.includes('status=eq.active') &&
        patch.includes('id=neq.t9') &&
        patch.includes(`user_id=neq.${USER}`),
    );
    assertEquals(JSON.parse(stub.calls[1]?.body ?? '{}'), {
      status: 'disabled',
      disabled_reason: 'replaced',
    });
  },
);

Deno.test(
  'credentials repository: a unique violation on insert becomes an update of the user-level row',
  async () => {
    const stub = stubFetch((call) =>
      call.method === 'POST'
        ? jsonResponse({ code: '23505', message: 'duplicate key', details: null, hint: null }, 409)
        : new Response(null, { status: 204 }),
    );
    const keyring = await loadKeyring({
      token_encryption_keys: { 1: randomBase64(32) },
      TOKEN_ENC_ACTIVE_VERSION: 1,
    });
    const token = await encryptToken(keyring, 'refresh', {
      account: USER,
      provider: 'apple_device',
      kind: 'apple_siwa_refresh',
    });
    await supabaseCredentialsRepo(testDb(stub.fetch)).saveUserCredential(
      USER,
      'apple_device',
      'apple_siwa_refresh',
      token,
    );
    assertEquals(
      stub.calls.map((c) => c.method),
      ['POST', 'PATCH'],
    );
    const update = decodeURIComponent(stub.calls[1]?.url ?? '');
    assert(
      update.includes('connected_account_id=is.null') &&
        update.includes('token_kind=eq.apple_siwa_refresh'),
    );
    assert(JSON.parse(stub.calls[1]?.body ?? '{}').ciphertext.startsWith('\\x'));
  },
);

Deno.test('re-encryption batch moves stale rows to the active key version', async () => {
  const v1 = randomBase64(32);
  const old = await loadKeyring({ token_encryption_keys: { 1: v1 }, TOKEN_ENC_ACTIVE_VERSION: 1 });
  const repo = memoryCredentials();
  const binding = { account: USER, provider: 'google', kind: 'refresh' as const };
  await repo.saveUserCredential(USER, 'google', 'refresh', await encryptToken(old, 'tok', binding));
  const rotated = await loadKeyring({
    token_encryption_keys: { 1: v1, 2: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 2,
  });
  assertEquals(await reencryptBatch(repo, rotated), {
    scanned: 1,
    reencrypted: 1,
    conflicts: 0,
    failed: 0,
  });
});
