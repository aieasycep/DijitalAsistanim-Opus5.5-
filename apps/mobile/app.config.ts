/**
 * Expo app config (INTEGRATION_PLAN §0.5 and §12.1, M§108, M§109, M§112).
 *
 * Everything is derived from `APP_ENV` (development | preview | e2e | production):
 * - iOS bundle ID / Android package: `IOS_BUNDLE_IDENTIFIER` / `ANDROID_PACKAGE` (default
 *   `com.dijitalasistan.app`) plus `.dev`, `.preview` or `.e2e`; production has no suffix.
 * - URL scheme: `EXPO_PUBLIC_APP_SCHEME` (default `dijitalasistan`) plus `-dev`, `-preview` or
 *   `-e2e`, appended once, so the base value from `.env.example` and the per-profile value from
 *   `eas.json` resolve to the same scheme.
 * - App Group: `IOS_APP_GROUP` (default `group.<IOS_BUNDLE_IDENTIFIER>`) plus the same suffix.
 *
 * Build-time and server-only keys are read here only; nothing below reaches the JS bundle except the
 * EAS project ID. The config refuses to build when a production build enables demo mode without
 * `ALLOW_DEMO_IN_PRODUCTION=true` (§13.1), ships the RevenueCat Test Store key, or carries an
 * EXPO_PUBLIC_* variable outside the §15 allow-list or with a secret-shaped value.
 *
 * The `da-share` local module (T-8.17) enforces App Group parity and the Android `singleTask`
 * launch mode, and the share extension is declared in `appExtensions` for EAS credentials. The
 * `notification-intelligence` local module (T-8.26) adds the Android notification listener service
 * and the launcher `<queries>`. The widget target and the `da-widgets` plugin arrive with T-8.25.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';
import {
  AndroidConfig,
  withAndroidManifest,
  withEntitlementsPlist,
  type ConfigPlugin,
} from 'expo/config-plugins';

import nativeColors from '@da/design-tokens/native.json';
import captureTr from '@da/i18n/messages/tr/capture.json';
import { CLIENT_SECRET_SHAPES, ENV_KEYS, parseBuildEnv, type AppEnv } from '@da/validation/env';

import { createWithDaShare } from './modules/da-share/plugin/withDaShare.ts';
import { createWithNotificationIntelligence } from './modules/notification-intelligence/plugin/withNotificationIntelligence.ts';
import { IOS_PERMISSION_STRINGS } from './src/i18n/native-strings.ts';
import { DEFAULT_WEB_URL, variantIdentifier, variantScheme } from './src/lib/variant.ts';

type Env = Readonly<Record<string, string | undefined>>;

const withDaShare = createWithDaShare({
  AndroidConfig,
  withAndroidManifest,
  withEntitlementsPlist,
});

/** T-8.26: the notification listener service and the launcher `<queries>` (Android only). */
const withNotificationIntelligence = createWithNotificationIntelligence({ withAndroidManifest });

/** M§108 production identifiers; every variant derives from these unless env overrides them. */
export const DEFAULT_IDENTIFIERS = {
  bundleId: 'com.dijitalasistan.app',
  scheme: 'dijitalasistan',
  webUrl: DEFAULT_WEB_URL,
} as const;

const VARIANT_NAME: Readonly<Record<AppEnv, string>> = {
  development: 'Dijital Asistan Dev',
  preview: 'Dijital Asistan Preview',
  e2e: 'Dijital Asistan E2E',
  production: 'Dijital Asistan',
};

export interface AppVariant {
  readonly appEnv: AppEnv;
  readonly name: string;
  readonly iosBundleId: string;
  readonly androidPackage: string;
  readonly scheme: string;
  readonly appGroup: string;
  readonly webHost: string;
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/;
const EXPO_PUBLIC_ALLOW_LIST: ReadonlySet<string> = new Set(ENV_KEYS.expo_client);

function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function isTrue(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function fail(message: string): never {
  throw new Error(`[app.config] ${message}`);
}

function parseHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host !== '' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves the identifiers of one build variant (INTEGRATION_PLAN §0.5). */
export function resolveVariant(env: Env): AppVariant {
  const build = parseBuildEnv(env);
  const appEnv = build.APP_ENV;
  const dotted = (base: string) => variantIdentifier(base, appEnv);

  const schemeBase = isSet(env.EXPO_PUBLIC_APP_SCHEME)
    ? env.EXPO_PUBLIC_APP_SCHEME.trim()
    : DEFAULT_IDENTIFIERS.scheme;
  const scheme = variantScheme(schemeBase, appEnv);
  if (!SCHEME_PATTERN.test(scheme)) fail('EXPO_PUBLIC_APP_SCHEME is not a valid URL scheme.');

  const appGroupBase = isSet(env.IOS_APP_GROUP)
    ? build.IOS_APP_GROUP
    : `group.${build.IOS_BUNDLE_IDENTIFIER}`;
  const webUrl = parseHttpsUrl(
    isSet(env.EXPO_PUBLIC_WEB_URL) ? env.EXPO_PUBLIC_WEB_URL.trim() : DEFAULT_IDENTIFIERS.webUrl,
  );
  if (webUrl === undefined) {
    fail('EXPO_PUBLIC_WEB_URL must be an https URL (universal links and app links).');
  }

  return {
    appEnv,
    name: VARIANT_NAME[appEnv],
    iosBundleId: dotted(build.IOS_BUNDLE_IDENTIFIER),
    androidPackage: dotted(build.ANDROID_PACKAGE),
    scheme,
    appGroup: dotted(appGroupBase),
    webHost: webUrl.host,
  };
}

/** Build-time guards; each message names keys only, never values. */
export function assertBuildEnv(env: Env, appEnv: AppEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('EXPO_PUBLIC_')) continue;
    if (!EXPO_PUBLIC_ALLOW_LIST.has(key)) {
      fail(`${key} is not an allow-listed client-safe variable (INTEGRATION_PLAN §15).`);
    }
    if (isSet(value) && CLIENT_SECRET_SHAPES.some((shape) => shape.test(value.trim()))) {
      fail(`${key} holds a secret-shaped value; only publishable keys may ship in the app.`);
    }
  }
  if (isSet(env.APPLE_TEAM_ID) && !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID.trim())) {
    fail('APPLE_TEAM_ID must be the 10-character Apple team ID.');
  }
  if (isSet(env.EXPO_PUBLIC_APP_ENV) && env.EXPO_PUBLIC_APP_ENV.trim() !== appEnv) {
    fail(`EXPO_PUBLIC_APP_ENV must equal APP_ENV (${appEnv}).`);
  }
  if (appEnv !== 'production') return;
  if (isTrue(env.EXPO_PUBLIC_DEMO_MODE) && !isTrue(env.ALLOW_DEMO_IN_PRODUCTION)) {
    fail(
      'EXPO_PUBLIC_DEMO_MODE=true is refused for APP_ENV=production unless ALLOW_DEMO_IN_PRODUCTION=true (INTEGRATION_PLAN §13.1).',
    );
  }
  if (isSet(env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY)) {
    fail('EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY is for non-production profiles only.');
  }
}

const color = {
  bg: nativeColors.colors.bg,
  brand: nativeColors.colors['brand.primary'].light,
} as const;

const FONT_FILES = [
  'geist/400Regular/Geist_400Regular.ttf',
  'geist/500Medium/Geist_500Medium.ttf',
  'geist/600SemiBold/Geist_600SemiBold.ttf',
  'geist/700Bold/Geist_700Bold.ttf',
  'lora/400Regular/Lora_400Regular.ttf',
  'lora/500Medium/Lora_500Medium.ttf',
  'lora/600SemiBold/Lora_600SemiBold.ttf',
  'lora/400Regular_Italic/Lora_400Regular_Italic.ttf',
].map((file) => `./node_modules/@expo-google-fonts/${file}`);

/** Required-reason API declarations for the app target (§12.1; App Group sharing is `1C8F.1`). */
const PRIVACY_API_REASONS = [
  {
    NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
    NSPrivacyAccessedAPITypeReasons: ['CA92.1', '1C8F.1'],
  },
  {
    NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
    NSPrivacyAccessedAPITypeReasons: ['C617.1'],
  },
  {
    NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
    NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
  },
  {
    NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
    NSPrivacyAccessedAPITypeReasons: ['E174.1'],
  },
];

const ANDROID_PERMISSIONS = [
  'POST_NOTIFICATIONS',
  'READ_CALENDAR',
  'WRITE_CALENDAR',
  'RECORD_AUDIO',
  'CAMERA',
  'SCHEDULE_EXACT_ALARM',
  'RECEIVE_BOOT_COMPLETED',
  'WAKE_LOCK',
];

/** Never requested (§12.8): media, location, contacts, exact-alarm bypass, package queries, ad ID. */
export const ANDROID_BLOCKED_PERMISSIONS = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.QUERY_ALL_PACKAGES',
  'com.google.android.gms.permission.AD_ID',
];

/**
 * `expo-share-intent` options (INTEGRATION_PLAN §12.4). The plugin derives the extension's Xcode
 * target from its display name; "Dijital Asistan" would produce the production app's own target
 * (`DijitalAsistan`) and overwrite its files, so the extension uses the capture title
 * "Dijital Asistan'a Ekle" (target `DijitalAsistanaEkle`, bundle `<bundle>.share-extension`).
 */
export const SHARE_EXTENSION_NAME = captureTr.title;

/** The Xcode target `expo-share-intent` derives from the extension name ("DijitalAsistanaEkle"). */
export const SHARE_EXTENSION_TARGET = SHARE_EXTENSION_NAME.replace(/[^a-zA-Z0-9]/g, '');

/** EAS `appExtensions` entry of the share extension (bundle `<bundle>.share-extension`, T-8.01). */
export function shareAppExtension(variant: AppVariant) {
  return {
    targetName: SHARE_EXTENSION_TARGET,
    bundleIdentifier: `${variant.iosBundleId}.share-extension`,
    entitlements: { [APP_GROUPS_ENTITLEMENT]: [variant.appGroup] },
  };
}

function shareIntentOptions(variant: AppVariant) {
  return {
    iosActivationRules:
      'SUBQUERY (extensionItems, $extensionItem, SUBQUERY ($extensionItem.attachments, $attachment, ' +
      'ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image" || ' +
      'ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "com.adobe.pdf" || ' +
      'ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url" || ' +
      'ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.plain-text").@count >= 1).@count >= 1',
    iosAppGroupIdentifier: variant.appGroup,
    iosShareExtensionName: SHARE_EXTENSION_NAME,
    androidIntentFilters: ['text/*', 'image/*', 'application/pdf'],
    androidMultiIntentFilters: ['image/*', 'application/pdf'],
    androidMainActivityAttributes: { 'android:launchMode': 'singleTask' },
  };
}

type PluginEntry = string | [string, Record<string, unknown>];

function plugins(variant: AppVariant, env: Env): PluginEntry[] {
  const tr = IOS_PERMISSION_STRINGS.tr;
  const googleIosUrlScheme = env.GOOGLE_IOS_URL_SCHEME?.trim();
  const sentry: Record<string, unknown> = {
    project: isSet(env.SENTRY_PROJECT) ? env.SENTRY_PROJECT : 'da-mobile',
    // Source maps and debug symbols are uploaded by CI only (ADR-39).
    disableAutoUpload: true,
  };
  if (isSet(env.SENTRY_ORG)) sentry.organization = env.SENTRY_ORG;

  return [
    'expo-router',
    ['expo-localization', { supportedLocales: { ios: ['tr', 'en'], android: ['tr', 'en'] } }],
    'expo-secure-store',
    'expo-apple-authentication',
    'expo-background-task',
    [
      'expo-build-properties',
      {
        useHermesV1: true,
        android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 24 },
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: color.brand,
        // Channels (§9.3) are created at first launch, before the permission prompt.
        defaultChannel: 'briefings',
        mode: variant.appEnv === 'development' ? 'development' : 'production',
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission: tr.NSCalendarsFullAccessUsageDescription,
        remindersPermission: tr.NSRemindersFullAccessUsageDescription,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: tr.NSPhotoLibraryUsageDescription,
        cameraPermission: tr.NSCameraUsageDescription,
        microphonePermission: tr.NSMicrophoneUsageDescription,
      },
    ],
    ['expo-audio', { microphonePermission: tr.NSMicrophoneUsageDescription }],
    [
      'expo-speech-recognition',
      {
        microphonePermission: tr.NSMicrophoneUsageDescription,
        speechRecognitionPermission: tr.NSSpeechRecognitionUsageDescription,
      },
    ],
    ['expo-local-authentication', { faceIDPermission: tr.NSFaceIDUsageDescription }],
    // The reversed iOS client ID is an external credential (§15 GOOGLE_IOS_URL_SCHEME); without
    // it native Google sign-in on iOS reports "Harici kimlik bilgisi gerekli".
    ...(isSet(googleIosUrlScheme)
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: googleIosUrlScheme },
          ] satisfies PluginEntry,
        ]
      : []),
    ['expo-share-intent', shareIntentOptions(variant)],
    '@bacons/apple-targets',
    ['@sentry/react-native/expo', sentry],
    ['expo-font', { fonts: FONT_FILES }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        imageWidth: 96,
        resizeMode: 'contain',
        backgroundColor: color.bg.light,
        dark: { image: './assets/splash.png', backgroundColor: color.bg.dark },
      },
    ],
  ];
}

const APP_GROUPS_ENTITLEMENT = 'com.apple.security.application-groups';

/**
 * `expo-share-intent` prepends its App Group to the list `ios.entitlements` already produced, so
 * the group would appear twice. Registered before the plugin list, this mod runs after them.
 */
const withUniqueAppGroups: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults[APP_GROUPS_ENTITLEMENT];
    if (Array.isArray(groups)) mod.modResults[APP_GROUPS_ENTITLEMENT] = [...new Set(groups)];
    return mod;
  });

/** The full config for one environment; `app.config.ts` evaluates it with `process.env`. */
export function buildAppConfig(base: Partial<ExpoConfig>, env: Env): ExpoConfig {
  const variant = resolveVariant(env);
  assertBuildEnv(env, variant.appEnv);
  const projectId = isSet(env.EXPO_PUBLIC_EAS_PROJECT_ID)
    ? env.EXPO_PUBLIC_EAS_PROJECT_ID.trim()
    : undefined;

  const withShare = (config: ExpoConfig) =>
    withNotificationIntelligence(withDaShare(config, { appGroup: variant.appGroup }));
  return withShare(
    withUniqueAppGroups({
      ...base,
      name: variant.name,
      slug: 'dijital-asistan',
      ...(isSet(env.EXPO_OWNER) ? { owner: env.EXPO_OWNER } : {}),
      version: '1.0.0',
      scheme: variant.scheme,
      orientation: 'portrait',
      userInterfaceStyle: 'automatic',
      icon: './assets/icon.png',
      platforms: ['ios', 'android'],
      runtimeVersion: { policy: 'fingerprint' },
      ...(projectId === undefined ? {} : { updates: { url: `https://u.expo.dev/${projectId}` } }),
      locales: {
        tr: { ios: IOS_PERMISSION_STRINGS.tr },
        en: { ios: IOS_PERMISSION_STRINGS.en },
      },
      ios: {
        bundleIdentifier: variant.iosBundleId,
        ...(isSet(env.APPLE_TEAM_ID) ? { appleTeamId: env.APPLE_TEAM_ID.trim() } : {}),
        deploymentTarget: '16.4',
        supportsTablet: false,
        usesAppleSignIn: true,
        associatedDomains: [`applinks:${variant.webHost}`, `webcredentials:${variant.webHost}`],
        entitlements: {
          [APP_GROUPS_ENTITLEMENT]: [variant.appGroup],
          'com.apple.developer.usernotifications.time-sensitive': true,
        },
        infoPlist: {
          CFBundleDevelopmentRegion: 'tr',
          UIBackgroundModes: ['remote-notification', 'processing', 'audio'],
          BGTaskSchedulerPermittedIdentifiers: ['com.expo.modules.backgroundtask.processing'],
          ITSAppUsesNonExemptEncryption: false,
          ...IOS_PERMISSION_STRINGS.tr,
        },
        privacyManifests: {
          NSPrivacyTracking: false,
          NSPrivacyAccessedAPITypes: PRIVACY_API_REASONS,
        },
      },
      android: {
        package: variant.androidPackage,
        allowBackup: false,
        ...(isSet(env.GOOGLE_SERVICES_JSON)
          ? { googleServicesFile: env.GOOGLE_SERVICES_JSON }
          : {}),
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          monochromeImage: './assets/adaptive-icon.png',
          backgroundColor: color.brand,
        },
        permissions: ANDROID_PERMISSIONS,
        blockedPermissions: ANDROID_BLOCKED_PERMISSIONS,
        intentFilters: [
          {
            action: 'VIEW',
            autoVerify: true,
            category: ['BROWSABLE', 'DEFAULT'],
            data: [
              { scheme: 'https', host: variant.webHost, pathPrefix: '/app' },
              { scheme: 'https', host: variant.webHost, pathPrefix: '/r' },
            ],
          },
        ],
      },
      plugins: plugins(variant, env),
      experiments: { reactCompiler: true },
      extra: {
        eas: {
          ...(projectId === undefined ? {} : { projectId }),
          build: { experimental: { ios: { appExtensions: [shareAppExtension(variant)] } } },
        },
      },
    }),
  );
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return buildAppConfig(config, process.env);
}
