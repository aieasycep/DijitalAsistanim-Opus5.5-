/**
 * Locked NI denylist parity (API-ANI-01, C-11): the server list covers what the device bundles
 * (`PackageRules.kt`, `presets.ts`) with the same groups and the same security-token rule, and
 * every package of the seeded `feature.android_ni` payload.
 */
import { assert, assertEquals } from '@std/assert';
import {
  flagPayloadDenylist,
  isLockedPackage,
  LOCKED_PACKAGES,
  lockedGroup,
  OWN_PACKAGE,
  SECURITY_SEGMENT,
} from './denylist.ts';

const ROOT = new URL('../../../../../', import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const KOTLIN = read(
  'apps/mobile/modules/notification-intelligence/android/src/main/java/expo/modules/notificationintelligence/PackageRules.kt',
);
const PRESETS = read('apps/mobile/src/features/android-ni/presets.ts');
const SEED = read('supabase/migrations/20260924001000_ops_product.sql');

Deno.test('denylist parity: PackageRules.LOCKED packages and groups', () => {
  const pairs = [...KOTLIN.matchAll(/"([a-zA-Z0-9_.]+)" to LockedGroup\.([A-Z_]+)/g)];
  assert(pairs.length >= 20, 'PackageRules.LOCKED parsed');
  for (const [, pkg, group] of pairs) {
    assertEquals(LOCKED_PACKAGES[pkg as string], group?.toLowerCase(), pkg);
  }
});

Deno.test('denylist parity: the security-token rule equals PackageRules.SECURITY_SEGMENT', () => {
  const block = /SECURITY_SEGMENT = Regex\(([\s\S]*?)\)\n/.exec(KOTLIN)?.[1] ?? '';
  const source = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
  assertEquals(source, SECURITY_SEGMENT.source);
});

Deno.test('denylist parity: presets.ts LOCKED_PACKAGES (M-ANI-04 groups)', () => {
  const block = /LOCKED_PACKAGES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(PRESETS)?.[1] ?? '';
  const pairs = [...block.matchAll(/'([a-zA-Z0-9_.]+)':\s*'([a-z_]+)'/g)];
  assert(pairs.length >= 20, 'presets LOCKED_PACKAGES parsed');
  for (const [, pkg, group] of pairs) assertEquals(LOCKED_PACKAGES[pkg as string], group, pkg);
});

Deno.test(
  'denylist parity: every package of the seeded feature.android_ni payload is locked',
  () => {
    const row = /'feature\.android_ni'[\s\S]*?'(\{"denylist"[\s\S]*?\})'\)/.exec(SEED)?.[1] ?? '';
    const denylist = flagPayloadDenylist(JSON.parse(row));
    assert(denylist.size >= 25, 'seed payload parsed');
    for (const pkg of denylist) assert(isLockedPackage(pkg), pkg);
  },
);

Deno.test('lockedGroup: own package variants, security tokens, runtime payload, free apps', () => {
  assertEquals(lockedGroup(OWN_PACKAGE), 'own_app');
  assertEquals(lockedGroup(`${OWN_PACKAGE}.preview`), 'own_app');
  assertEquals(lockedGroup('com.google.android.gms'), 'google_play_services');
  assertEquals(lockedGroup('tr.gov.turkiye.edevlet.kapisi'), 'e_devlet');
  assertEquals(lockedGroup('com.example.Authenticator'), 'authenticator');
  assertEquals(lockedGroup('com.acme.passwords'), 'authenticator');
  assertEquals(lockedGroup('com.acme.bank', new Set(['com.acme.bank'])), 'flag_payload');
  assertEquals(lockedGroup('com.trendyol.go'), null);
  assertEquals(lockedGroup('com.turkishairlines.mobile'), null);
  assertEquals(flagPayloadDenylist({ denylist: ['ok.pkg', 'bad pkg', 3] }), new Set(['ok.pkg']));
  assertEquals(flagPayloadDenylist(null).size, 0);
});
