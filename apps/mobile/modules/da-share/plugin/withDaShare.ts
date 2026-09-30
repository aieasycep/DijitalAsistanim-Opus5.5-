/**
 * `da-share` config plugin (T-8.17, INTEGRATION_PLAN §12.4, M§28). `expo-share-intent` creates the
 * iOS share extension (target `DijitalAsistanaEkle`) and the Android SEND / SEND_MULTIPLE intent
 * filters; this plugin enforces the two invariants the share flow depends on:
 * - App Group parity: the app's entitlements carry exactly the App Group the extension writes to
 *   (`expo-share-intent` `iosAppGroupIdentifier`); a mismatch fails the build instead of shipping an
 *   extension whose payload the app can never read;
 * - Android `singleTask` on the main activity, so a share arriving while the app runs is delivered
 *   to the existing task (`onNewIntent`) instead of a second activity.
 */
import type * as ConfigPlugins from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';

/**
 * The config-plugin helpers, passed in by `app.config.ts`: Node loads this file natively as an
 * ES module, where `expo/config-plugins` (a CommonJS re-export without an `exports` map) cannot
 * be imported by name.
 */
export type DaShareMods = Pick<
  typeof ConfigPlugins,
  'AndroidConfig' | 'withAndroidManifest' | 'withEntitlementsPlist'
>;

export interface DaShareOptions {
  /** The variant's App Group (`group.<bundleId>` + suffix). */
  readonly appGroup: string;
}

const APP_GROUPS = 'com.apple.security.application-groups';

export function createWithDaShare(mods: DaShareMods): ConfigPlugin<DaShareOptions> {
  const { AndroidConfig, withAndroidManifest, withEntitlementsPlist } = mods;
  return (config, options) => {
    if (!/^group\.[A-Za-z0-9.-]+$/.test(options.appGroup)) {
      throw new Error(`[da-share] invalid App Group: ${options.appGroup}`);
    }
    const shareIntent = (config.plugins ?? []).find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-share-intent',
    );
    const shareGroup =
      Array.isArray(shareIntent) && typeof shareIntent[1] === 'object' && shareIntent[1] !== null
        ? (shareIntent[1] as { iosAppGroupIdentifier?: unknown }).iosAppGroupIdentifier
        : undefined;
    if (shareGroup !== undefined && shareGroup !== options.appGroup) {
      throw new Error('[da-share] the share extension App Group must equal the app App Group.');
    }
    let next = withEntitlementsPlist(config, (mod) => {
      const current = mod.modResults[APP_GROUPS];
      const groups = Array.isArray(current) ? (current as string[]) : [];
      mod.modResults[APP_GROUPS] = groups.includes(options.appGroup)
        ? groups
        : [...groups, options.appGroup];
      return mod;
    });
    next = withAndroidManifest(next, (mod) => {
      const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
      activity.$['android:launchMode'] = 'singleTask';
      return mod;
    });
    return next;
  };
}
