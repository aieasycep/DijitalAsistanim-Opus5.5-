/**
 * Category presets of "Seçili uygulamalar" (D-27, M-ANI-01 `KATEGORİLER`) and the locked
 * denylist shown on M-ANI-04. A category switch adds its package list to
 * `ni_allowed_packages`; manual picks from the app picker are added on top.
 *
 * Bootstrap does not carry a package catalogue or the `feature.android_ni` flag payload (its
 * `flags` are booleans), so the preset lists are bundled here. The package IDs must be verified
 * against Google Play before each release (SCREEN_AND_FLOW_MAP §9 "Presets"). The server rejects
 * any package on the flag-payload denylist in `POST /android-notifications/signals`.
 */
import type { NiCategory, NiLockedGroup } from './native';

export type NiPresetKey = 'shipping' | 'banking' | 'airline' | 'reservation';

export interface NiPreset {
  readonly key: NiPresetKey;
  /** Analytics `category` of `android_ni_category_toggled`. */
  readonly event: NiCategory;
  /** Default of the switch (M-ANI-01: Kargo, Banka, Havayolu on; Rezervasyon off). */
  readonly on: boolean;
  readonly packages: readonly string[];
}

export const NI_PRESETS: readonly NiPreset[] = [
  {
    key: 'shipping',
    event: 'cargo',
    on: true,
    packages: ['trendyol.com', 'com.pozitron.hepsiburada', 'com.amazon.mShop.android.shopping'],
  },
  {
    key: 'banking',
    event: 'bank_payment',
    on: true,
    packages: [
      'com.garanti.cepsubesi',
      'com.pozitron.iscep',
      'com.akbank.android.apps.akbank_direkt',
      'com.ykb.android',
      'com.ziraat.ziraatmobil',
    ],
  },
  {
    key: 'airline',
    event: 'flight',
    on: true,
    packages: ['com.turkishairlines.mobile', 'com.pozitron.pegasus'],
  },
  {
    key: 'reservation',
    event: 'reservation',
    on: false,
    packages: ['com.booking', 'com.airbnb.android', 'com.inovel.app.yemeksepeti'],
  },
];

export type NiCategoryChoice = Readonly<Record<NiPresetKey, boolean>>;

export const DEFAULT_CATEGORIES: NiCategoryChoice = {
  shipping: true,
  banking: true,
  airline: true,
  reservation: false,
};

/** The union of the enabled presets and the manual picks, minus locked packages. */
export function allowedPackagesFor(
  categories: NiCategoryChoice,
  manual: readonly string[],
): readonly string[] {
  const set = new Set<string>();
  for (const preset of NI_PRESETS) {
    if (categories[preset.key]) for (const pkg of preset.packages) set.add(pkg);
  }
  for (const pkg of manual) set.add(pkg);
  return [...set].filter((pkg) => !isLockedPackage(pkg)).sort();
}

/**
 * The bundled locked denylist, grouped as on M-ANI-04. It mirrors `PackageRules.LOCKED` in the
 * Kotlin module (a test keeps the two equal); the module also excludes security apps by package
 * token and this app's own package.
 */
export const LOCKED_PACKAGES: Readonly<Record<string, NiLockedGroup>> = {
  'com.google.android.apps.authenticator2': 'authenticator',
  'com.azure.authenticator': 'authenticator',
  'com.authy.authy': 'authenticator',
  'com.duosecurity.duomobile': 'authenticator',
  'com.okta.android.auth': 'authenticator',
  'com.twofasapp': 'authenticator',
  'com.beemdevelopment.aegis': 'authenticator',
  'com.x8bit.bitwarden': 'password_manager',
  'com.agilebits.onepassword': 'password_manager',
  'com.lastpass.lpandroid': 'password_manager',
  'com.proton.pass': 'password_manager',
  'tr.gov.turkiye.edevlet.kapisi': 'e_devlet',
  'com.whatsapp': 'messaging',
  'com.whatsapp.w4b': 'messaging',
  'org.telegram.messenger': 'messaging',
  'com.turkcell.bip': 'messaging',
  'com.google.android.apps.messaging': 'messaging',
  'com.samsung.android.messaging': 'messaging',
  'com.android.mms': 'messaging',
  'org.thoughtcrime.securesms': 'messaging',
  'com.facebook.orca': 'messaging',
  'com.google.android.gms': 'google_play_services',
};

/** M-ANI-04 group order. */
export const LOCKED_GROUPS: readonly NiLockedGroup[] = [
  'authenticator',
  'password_manager',
  'e_devlet',
  'messaging',
  'google_play_services',
  'own_app',
];

export function isLockedPackage(pkg: string): boolean {
  return LOCKED_PACKAGES[pkg] !== undefined;
}

/** The bundled packages of one group (`own_app` is this build's package, resolved natively). */
export function lockedPackagesOf(group: NiLockedGroup): readonly string[] {
  return Object.entries(LOCKED_PACKAGES)
    .filter(([, g]) => g === group)
    .map(([pkg]) => pkg);
}
