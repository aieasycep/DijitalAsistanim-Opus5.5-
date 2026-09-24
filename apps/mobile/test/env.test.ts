import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ENV_KEYS } from '@da/validation/env';
import { describe, expect, it } from '@jest/globals';

import { parseClientEnv, readExpoPublicEnv } from '../src/lib/env';

const APP_ROOT = join(__dirname, '..');

const VALID = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://api.dijitalasistan.app',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
};

describe('client env (src/lib/env.ts)', () => {
  it('reads exactly the client-safe allow-list', () => {
    expect(Object.keys(readExpoPublicEnv()).sort()).toEqual([...ENV_KEYS.expo_client].sort());
  });

  it('returns only inlined strings or unset values', () => {
    for (const value of Object.values(readExpoPublicEnv())) {
      expect(value === undefined || typeof value === 'string').toBe(true);
    }
  });

  it('parses a minimal environment with the schema defaults', () => {
    const env = parseClientEnv(VALID);
    expect(env.EXPO_PUBLIC_APP_ENV).toBe('development');
    expect(env.EXPO_PUBLIC_DEMO_MODE).toBe(false);
    expect(env.EXPO_PUBLIC_ANALYTICS_ENABLED).toBe(true);
  });

  it('gives the scheme the same variant suffix as the native project', () => {
    expect(parseClientEnv(VALID).EXPO_PUBLIC_APP_SCHEME).toBe('dijitalasistan-dev');
    const preview = { ...VALID, EXPO_PUBLIC_APP_ENV: 'preview' };
    expect(parseClientEnv(preview).EXPO_PUBLIC_APP_SCHEME).toBe('dijitalasistan-preview');
    const suffixed = { ...preview, EXPO_PUBLIC_APP_SCHEME: 'dijitalasistan-preview' };
    expect(parseClientEnv(suffixed).EXPO_PUBLIC_APP_SCHEME).toBe('dijitalasistan-preview');
    const production = { ...VALID, EXPO_PUBLIC_APP_ENV: 'production' };
    expect(parseClientEnv(production).EXPO_PUBLIC_APP_SCHEME).toBe('dijitalasistan');
  });

  it('names missing keys without echoing values', () => {
    expect(() => parseClientEnv({})).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
    const secret = 'sb_secret_abcdefghijklmnop';
    let message = '';
    try {
      parseClientEnv({ ...VALID, EXPO_PUBLIC_SENTRY_DSN: secret });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/EXPO_PUBLIC_SENTRY_DSN/);
    expect(message).not.toContain(secret);
  });

  it('refuses demo mode and the Test Store key in production', () => {
    const production = { ...VALID, EXPO_PUBLIC_APP_ENV: 'production' };
    expect(() => parseClientEnv({ ...production, EXPO_PUBLIC_DEMO_MODE: 'true' })).toThrow(
      /demo_mode_in_production/,
    );
    expect(() =>
      parseClientEnv({ ...production, EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: 'test_abc' }),
    ).toThrow(/test_store_in_production/);
  });
});

describe('app code never touches server-only or build-time keys', () => {
  const forbidden = [
    ...[...ENV_KEYS.server, ...ENV_KEYS.build].map((key) => new RegExp(`\\b${key}\\b`)),
    /\bTOKEN_ENC_KEY_V\d/,
  ];
  const allowed = new Set(ENV_KEYS.expo_client);

  function* sourceFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) yield* sourceFiles(full);
      else if (/\.(ts|tsx|js|jsx|json)$/.test(name)) yield full;
    }
  }

  const files = ['src', 'app'].flatMap((dir) => [...sourceFiles(join(APP_ROOT, dir))]);

  it('scans the route and source trees', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [relative(APP_ROOT, file), file]))(
    '%s references no server-only or build-time key',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      const hits = forbidden.filter((pattern) => pattern.test(text)).map(String);
      expect(hits).toEqual([]);
      const reads = [...text.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[)/g)];
      for (const read of reads) expect(allowed.has(read[1] ?? '')).toBe(true);
    },
  );
});
