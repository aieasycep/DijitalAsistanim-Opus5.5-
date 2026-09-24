import { describe, expect, it } from 'vitest';
import {
  EnvError,
  INDEXABLE_PRODUCTION_REQUIRED,
  missingLaunchKeys,
  parseClientEnv,
  parseServerEnv,
} from '../src/env/schema.ts';

const LAUNCH = {
  NEXT_PUBLIC_SITE_URL: 'https://dijitalasistan.app',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  API_PUBLIC_BASE_URL: 'https://project.supabase.co',
  IOS_APP_STORE_ID: '1234567890',
  COMPANY_LEGAL_NAME: 'Example A.Ş.',
  COMPANY_ADDRESS: 'İstanbul',
  COMPANY_MERSIS_NO: '0123456789000015',
  COMPANY_KEP_ADDRESS: 'example@hs01.kep.tr',
};

describe('server env', () => {
  it('defaults to a non-indexable development configuration', () => {
    const env = parseServerEnv({});
    expect(env.APP_ENV).toBe('development');
    expect(env.indexable).toBe(false);
    expect(env.IOS_BUNDLE_IDENTIFIER).toBe('com.dijitalasistan.app');
    expect(env.ANDROID_PACKAGE).toBe('com.dijitalasistan.app');
  });

  it('is indexable only for production with SITE_INDEXABLE=true outside Vercel previews', () => {
    expect(
      parseServerEnv({ ...LAUNCH, APP_ENV: 'production', SITE_INDEXABLE: 'true' }).indexable,
    ).toBe(true);
    expect(
      parseServerEnv({ ...LAUNCH, APP_ENV: 'production', SITE_INDEXABLE: 'false' }).indexable,
    ).toBe(false);
    expect(
      parseServerEnv({ ...LAUNCH, APP_ENV: 'staging', SITE_INDEXABLE: 'true' }).indexable,
    ).toBe(false);
    expect(
      parseServerEnv({
        ...LAUNCH,
        APP_ENV: 'production',
        SITE_INDEXABLE: 'true',
        VERCEL_ENV: 'preview',
      }).indexable,
    ).toBe(false);
  });

  it('refuses an indexable production build without the launch keys', () => {
    expect(() => parseServerEnv({ APP_ENV: 'production', SITE_INDEXABLE: 'true' })).toThrow(
      EnvError,
    );
    for (const key of INDEXABLE_PRODUCTION_REQUIRED) {
      const partial: Record<string, string> = {
        ...LAUNCH,
        APP_ENV: 'production',
        SITE_INDEXABLE: 'true',
      };
      partial[key] = '';
      expect(() => parseServerEnv(partial), key).toThrow(key);
    }
  });

  it('validates identifiers instead of accepting anything', () => {
    expect(() => parseServerEnv({ APPLE_TEAM_ID: 'abc' })).toThrow(EnvError);
    expect(() => parseServerEnv({ ANDROID_SHA256_CERT_FINGERPRINTS: 'not-a-fingerprint' })).toThrow(
      EnvError,
    );
    expect(() => parseServerEnv({ MICROSOFT_CLIENT_ID: 'x' })).toThrow(EnvError);
    const fingerprint = Array.from({ length: 32 }, () => 'AB').join(':');
    const env = parseServerEnv({
      APPLE_TEAM_ID: 'ABCDE12345',
      ANDROID_SHA256_CERT_FINGERPRINTS: `${fingerprint}, ${fingerprint.replaceAll('AB', 'CD')}`,
    });
    expect(env.APPLE_TEAM_ID).toBe('ABCDE12345');
    expect(env.ANDROID_SHA256_CERT_FINGERPRINTS).toEqual([
      fingerprint,
      fingerprint.replaceAll('AB', 'CD'),
    ]);
  });

  it('lists missing launch keys for the development notice', () => {
    expect(missingLaunchKeys({})).toEqual([...INDEXABLE_PRODUCTION_REQUIRED]);
    expect(missingLaunchKeys(LAUNCH)).toEqual([]);
  });
});

describe('client env', () => {
  it('holds only public values and rejects a Supabase secret key', () => {
    expect(parseClientEnv({}).NEXT_PUBLIC_SITE_URL).toBe('https://dijitalasistan.app');
    expect(parseClientEnv({}).NEXT_PUBLIC_ANALYTICS_ENABLED).toBe(false);
    expect(() => parseClientEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toThrow(
      EnvError,
    );
    expect(
      parseClientEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ).toBe('sb_publishable_abc');
  });

  it('exposes only NEXT_PUBLIC_ keys', () => {
    for (const key of Object.keys(parseClientEnv({})))
      expect(key.startsWith('NEXT_PUBLIC_'), key).toBe(true);
  });
});
