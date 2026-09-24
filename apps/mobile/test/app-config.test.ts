import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import type { ExpoConfig } from 'expo/config';

import {
  ANDROID_BLOCKED_PERMISSIONS,
  DEFAULT_IDENTIFIERS,
  SHARE_EXTENSION_NAME,
  buildAppConfig,
} from '../app.config';

type Env = Record<string, string | undefined>;

const APP_ROOT = join(__dirname, '..');
const REPO_ROOT = join(APP_ROOT, '..', '..');

const config = (env: Env): ExpoConfig => buildAppConfig({}, env);

function pluginNames(expo: ExpoConfig): string[] {
  return (expo.plugins ?? []).map((entry) =>
    typeof entry === 'string' ? entry : String(entry[0]),
  );
}

function pluginOptions(expo: ExpoConfig, name: string): Record<string, unknown> {
  const entry = (expo.plugins ?? []).find((p) => Array.isArray(p) && p[0] === name);
  if (!Array.isArray(entry)) throw new Error(`plugin ${name} has no options`);
  return entry[1] as Record<string, unknown>;
}

/** `.env.example`-style KEY=value lines (comments and blanks skipped). */
function parseEnvFile(path: string): Env {
  const env: Env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined) env[match[1]] = match[2];
  }
  return env;
}

interface EasProfile {
  extends?: string;
  env?: Env;
}
interface EasJson {
  build: Record<string, EasProfile | undefined>;
}

function easProfileEnv(profile: string): Env {
  const eas = JSON.parse(readFileSync(join(APP_ROOT, 'eas.json'), 'utf8')) as EasJson;
  const chain: Env[] = [];
  for (let name: string | undefined = profile; name !== undefined;) {
    const entry: EasProfile | undefined = eas.build[name];
    if (entry === undefined) throw new Error(`eas.json has no profile ${name}`);
    chain.unshift(entry.env ?? {});
    name = entry.extends;
  }
  return Object.assign({}, ...chain) as Env;
}

const VARIANTS = [
  {
    appEnv: 'development',
    id: 'com.dijitalasistan.app.dev',
    scheme: 'dijitalasistan-dev',
    group: 'group.com.dijitalasistan.app.dev',
  },
  {
    appEnv: 'preview',
    id: 'com.dijitalasistan.app.preview',
    scheme: 'dijitalasistan-preview',
    group: 'group.com.dijitalasistan.app.preview',
  },
  {
    appEnv: 'e2e',
    id: 'com.dijitalasistan.app.e2e',
    scheme: 'dijitalasistan-e2e',
    group: 'group.com.dijitalasistan.app.e2e',
  },
  {
    appEnv: 'production',
    id: 'com.dijitalasistan.app',
    scheme: 'dijitalasistan',
    group: 'group.com.dijitalasistan.app',
  },
] as const;

describe('app config variants (INTEGRATION_PLAN §0.5)', () => {
  it.each(VARIANTS)('derives the $appEnv identifiers', ({ appEnv, id, scheme, group }) => {
    const expo = config({ APP_ENV: appEnv });
    expect(expo.ios?.bundleIdentifier).toBe(id);
    expect(expo.android?.package).toBe(id);
    expect(expo.scheme).toBe(scheme);
    expect(expo.ios?.entitlements?.['com.apple.security.application-groups']).toEqual([group]);
    expect(pluginOptions(expo, 'expo-share-intent').iosAppGroupIdentifier).toBe(group);
  });

  it('uses the M§108 defaults for production', () => {
    const expo = config({ APP_ENV: 'production' });
    expect(DEFAULT_IDENTIFIERS.bundleId).toBe('com.dijitalasistan.app');
    expect(expo.name).toBe('Dijital Asistan');
    expect(expo.ios?.bundleIdentifier).toBe('com.dijitalasistan.app');
    expect(expo.android?.package).toBe('com.dijitalasistan.app');
    expect(expo.scheme).toBe('dijitalasistan');
    expect(expo.ios?.associatedDomains).toEqual([
      'applinks:dijitalasistan.app',
      'webcredentials:dijitalasistan.app',
    ]);
  });

  it('defaults to development when APP_ENV is unset and rejects unknown values', () => {
    expect(config({}).ios?.bundleIdentifier).toBe('com.dijitalasistan.app.dev');
    expect(() => config({ APP_ENV: 'staging' })).toThrow(/APP_ENV/);
  });

  it('treats the identifier variables as bases and suffixes them per variant', () => {
    const expo = config({
      APP_ENV: 'preview',
      IOS_BUNDLE_IDENTIFIER: 'com.example.assistant',
      ANDROID_PACKAGE: 'com.example.assistant_android',
    });
    expect(expo.ios?.bundleIdentifier).toBe('com.example.assistant.preview');
    expect(expo.android?.package).toBe('com.example.assistant_android.preview');
    // The App Group defaults to group.<IOS_BUNDLE_IDENTIFIER>, suffixed the same way.
    expect(expo.ios?.entitlements?.['com.apple.security.application-groups']).toEqual([
      'group.com.example.assistant.preview',
    ]);
    const grouped = config({ APP_ENV: 'e2e', IOS_APP_GROUP: 'group.com.example.shared' });
    expect(grouped.ios?.entitlements?.['com.apple.security.application-groups']).toEqual([
      'group.com.example.shared.e2e',
    ]);
  });

  it('resolves the .env.example values to the development identifiers', () => {
    const expo = config(parseEnvFile(join(REPO_ROOT, '.env.example')));
    expect(expo.ios?.bundleIdentifier).toBe('com.dijitalasistan.app.dev');
    expect(expo.scheme).toBe('dijitalasistan-dev');
    expect(expo.ios?.entitlements?.['com.apple.security.application-groups']).toEqual([
      'group.com.dijitalasistan.app.dev',
    ]);
  });

  it.each(VARIANTS)('builds the eas.json $appEnv profile with its identifiers', (variant) => {
    const env = easProfileEnv(variant.appEnv);
    expect(env.APP_ENV).toBe(variant.appEnv);
    expect(env.EXPO_PUBLIC_APP_ENV).toBe(variant.appEnv);
    const expo = config(env);
    expect(expo.ios?.bundleIdentifier).toBe(variant.id);
    expect(expo.scheme).toBe(variant.scheme);
    expect(env.EXPO_PUBLIC_APP_SCHEME).toBe(variant.scheme);
  });
});

describe('build guards', () => {
  it('refuses demo mode in production without the allowance (INTEGRATION_PLAN §13.1)', () => {
    expect(() => config({ APP_ENV: 'production', EXPO_PUBLIC_DEMO_MODE: 'true' })).toThrow(
      /ALLOW_DEMO_IN_PRODUCTION/,
    );
    expect(() => config({ APP_ENV: 'production', EXPO_PUBLIC_DEMO_MODE: '1' })).toThrow();
    expect(() =>
      config({
        APP_ENV: 'production',
        EXPO_PUBLIC_DEMO_MODE: 'true',
        ALLOW_DEMO_IN_PRODUCTION: 'true',
      }),
    ).not.toThrow();
    expect(() => config({ APP_ENV: 'e2e', EXPO_PUBLIC_DEMO_MODE: 'true' })).not.toThrow();
    expect(() => config({ APP_ENV: 'production', EXPO_PUBLIC_DEMO_MODE: 'false' })).not.toThrow();
  });

  it('keeps the RevenueCat Test Store key out of production', () => {
    const key = { EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: 'test_abc123' };
    expect(() => config({ APP_ENV: 'production', ...key })).toThrow(/non-production/);
    expect(() => config({ APP_ENV: 'preview', ...key })).not.toThrow();
  });

  it('refuses EXPO_PUBLIC_* keys outside the allow-list and secret-shaped values', () => {
    expect(() => config({ EXPO_PUBLIC_SUPABASE_SECRET_KEY: 'x' })).toThrow(/allow-listed/);
    const secret = 'sb_secret_abcdefghijklmnop';
    expect(() => config({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret })).toThrow(/secret-shaped/);
    try {
      config({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('requires EXPO_PUBLIC_APP_ENV to match APP_ENV', () => {
    expect(() => config({ APP_ENV: 'production', EXPO_PUBLIC_APP_ENV: 'development' })).toThrow(
      /EXPO_PUBLIC_APP_ENV/,
    );
  });

  it('passes a valid Apple team ID through and rejects a malformed one', () => {
    expect(config({ APPLE_TEAM_ID: 'ABCDE12345' }).ios?.appleTeamId).toBe('ABCDE12345');
    expect(config({}).ios?.appleTeamId).toBeUndefined();
    expect(() => config({ APPLE_TEAM_ID: 'team' })).toThrow(/APPLE_TEAM_ID/);
  });

  it('requires an https web URL for universal links and app links', () => {
    const custom = config({ EXPO_PUBLIC_WEB_URL: 'https://example.dijitalasistan.app' });
    expect(custom.ios?.associatedDomains).toContain('applinks:example.dijitalasistan.app');
    expect(() => config({ EXPO_PUBLIC_WEB_URL: 'http://dijitalasistan.app' })).toThrow(
      /EXPO_PUBLIC_WEB_URL/,
    );
    expect(() => config({ EXPO_PUBLIC_WEB_URL: 'not a url' })).toThrow(/EXPO_PUBLIC_WEB_URL/);
  });

  it('rejects an invalid scheme', () => {
    expect(() => config({ EXPO_PUBLIC_APP_SCHEME: 'Dijital Asistan' })).toThrow(/scheme/);
  });
});

describe('native configuration (INTEGRATION_PLAN §12.1)', () => {
  const expo = config({ APP_ENV: 'production' });

  it('lists the required plugins and none of the later local modules', () => {
    const names = pluginNames(expo);
    for (const required of [
      'expo-router',
      'expo-localization',
      'expo-secure-store',
      'expo-apple-authentication',
      'expo-background-task',
      'expo-build-properties',
      'expo-notifications',
      'expo-calendar',
      'expo-image-picker',
      'expo-audio',
      'expo-speech-recognition',
      'expo-local-authentication',
      'expo-share-intent',
      '@bacons/apple-targets',
      '@sentry/react-native/expo',
      'expo-font',
      'expo-splash-screen',
    ]) {
      expect(names).toContain(required);
    }
    expect(names.some((name) => name.startsWith('./modules/'))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names the share extension so its Xcode target never collides with the app target', () => {
    const target = SHARE_EXTENSION_NAME.replace(/[^a-zA-Z0-9]/g, '');
    expect(target).toBe('DijitalAsistanaEkle');
    for (const { appEnv } of VARIANTS) {
      expect(config({ APP_ENV: appEnv }).name.replace(/[^a-zA-Z0-9]/g, '')).not.toBe(target);
    }
    expect(pluginOptions(expo, 'expo-share-intent')).toMatchObject({
      iosShareExtensionName: "Dijital Asistan'a Ekle",
      androidIntentFilters: ['text/*', 'image/*', 'application/pdf'],
      androidMainActivityAttributes: { 'android:launchMode': 'singleTask' },
    });
  });

  it('adds Google sign-in only with the reversed iOS client ID', () => {
    expect(pluginNames(expo)).not.toContain('@react-native-google-signin/google-signin');
    const scheme = 'com.googleusercontent.apps.123456789012-abcdefghijklmnopqrstuvwxyz012345';
    const withGoogle = config({ APP_ENV: 'production', GOOGLE_IOS_URL_SCHEME: scheme });
    expect(pluginOptions(withGoogle, '@react-native-google-signin/google-signin')).toEqual({
      iosUrlScheme: scheme,
    });
    expect(() => config({ GOOGLE_IOS_URL_SCHEME: 'not-a-client-id' })).toThrow(
      /GOOGLE_IOS_URL_SCHEME/,
    );
  });

  it('pins the build properties: iOS 16.4, Android SDK 36/36/24, Hermes V1', () => {
    expect(expo.ios?.deploymentTarget).toBe('16.4');
    expect(pluginOptions(expo, 'expo-build-properties')).toEqual({
      useHermesV1: true,
      android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 24 },
    });
    expect(expo.runtimeVersion).toEqual({ policy: 'fingerprint' });
    expect(expo.experiments?.reactCompiler).toBe(true);
  });

  it('configures fonts, splash and notification branding from the tokens', () => {
    const fonts = pluginOptions(expo, 'expo-font').fonts as string[];
    expect(fonts).toHaveLength(8);
    for (const font of fonts) expect(existsSync(join(APP_ROOT, font))).toBe(true);
    expect(fonts.some((f) => f.endsWith('Geist_400Regular.ttf'))).toBe(true);
    expect(fonts.some((f) => f.endsWith('Lora_400Regular_Italic.ttf'))).toBe(true);
    expect(pluginOptions(expo, 'expo-splash-screen')).toMatchObject({
      image: './assets/splash.png',
      imageWidth: 96,
      backgroundColor: '#F5F4F0',
      dark: { backgroundColor: '#141311' },
    });
    expect(pluginOptions(expo, 'expo-notifications')).toMatchObject({
      icon: './assets/notification-icon.png',
      color: '#5B5CE2',
      defaultChannel: 'briefings',
      mode: 'production',
    });
    for (const asset of ['icon', 'adaptive-icon', 'splash', 'notification-icon']) {
      expect(existsSync(join(APP_ROOT, 'assets', `${asset}.png`))).toBe(true);
    }
  });

  it('declares entitlements, background modes, Turkish usage strings and English locale', () => {
    expect(expo.ios?.usesAppleSignIn).toBe(true);
    expect(expo.ios?.entitlements?.['com.apple.developer.usernotifications.time-sensitive']).toBe(
      true,
    );
    const plist = expo.ios?.infoPlist ?? {};
    expect(plist.CFBundleDevelopmentRegion).toBe('tr');
    expect(plist.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(plist.UIBackgroundModes).toEqual(['remote-notification', 'processing', 'audio']);
    expect(plist.NSMicrophoneUsageDescription).toMatch(/sesle soru/);
    expect(JSON.stringify(expo.locales?.en)).toMatch(/ask the assistant by voice/);
    expect(expo.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
  });

  it('blocks the permissions the product never requests and verifies app links', () => {
    expect(expo.android?.allowBackup).toBe(false);
    expect(expo.android?.blockedPermissions).toEqual(ANDROID_BLOCKED_PERMISSIONS);
    expect(expo.android?.permissions).toContain('POST_NOTIFICATIONS');
    expect(expo.android?.permissions).not.toContain('READ_CONTACTS');
    expect(expo.android?.intentFilters?.[0]).toMatchObject({
      autoVerify: true,
      data: [
        { scheme: 'https', host: 'dijitalasistan.app', pathPrefix: '/app' },
        { scheme: 'https', host: 'dijitalasistan.app', pathPrefix: '/r' },
      ],
    });
  });

  it('publishes only the EAS project ID in extra and wires updates to it', () => {
    expect(expo.extra).toEqual({ eas: {} });
    expect(expo.updates).toBeUndefined();
    const projectId = '0f6b3b8e-1c1d-4d57-9a0a-4a3cc2a1b9f1';
    const linked = config({ APP_ENV: 'production', EXPO_PUBLIC_EAS_PROJECT_ID: projectId });
    expect(linked.extra).toEqual({ eas: { projectId } });
    expect(linked.updates?.url).toBe(`https://u.expo.dev/${projectId}`);
    const leaked = JSON.stringify(
      config({ APP_ENV: 'production', ALLOW_DEMO_IN_PRODUCTION: 'true', SENTRY_ORG: 'da-org' }),
    );
    expect(leaked).not.toContain('ALLOW_DEMO_IN_PRODUCTION');
  });
});
