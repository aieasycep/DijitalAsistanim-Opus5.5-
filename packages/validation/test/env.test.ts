import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENV_KEYS,
  ENV_SCOPE_TAG,
  buildEnv,
  expoClientEnv,
  formatEnvError,
  nextClientEnv,
  parseServerEnv,
  serverEnv,
  type EnvScope,
} from '../src/env.ts';

/** `.env.example` parsed into `{key, tag, value}` (the tag is the comment line above each key). */
function readEnvExample(): { key: string; tag: string; value: string }[] {
  const path = fileURLToPath(new URL('../../../.env.example', import.meta.url));
  const lines = readFileSync(path, 'utf8').split('\n');
  const entries: { key: string; tag: string; value: string }[] = [];
  let tag = '';
  for (const line of lines) {
    const tagMatch = /^#\s*(client-safe|SERVER-ONLY|build-time)\s*$/.exec(line);
    if (tagMatch?.[1] !== undefined) {
      tag = tagMatch[1];
      continue;
    }
    const keyMatch = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (keyMatch?.[1] !== undefined)
      entries.push({ key: keyMatch[1], tag, value: keyMatch[2] ?? '' });
  }
  return entries;
}

const example = readEnvExample();
const scopes = Object.keys(ENV_KEYS) as EnvScope[];
const KEY_32 = 'q'.repeat(43) + '=';
const PEPPER = 'p'.repeat(40);

const baseServer = {
  SUPABASE_URL: 'https://api.dijitalasistan.app',
  HASH_PEPPER: PEPPER,
  TOKEN_ENC_KEY_V1: KEY_32,
  TOKEN_ENC_ACTIVE_VERSION: '1',
};

describe('.env.example parity (UT-ENV-07)', () => {
  it('parses a non-trivial key list with a tag on every key', () => {
    expect(example.length).toBeGreaterThan(100);
    for (const entry of example) expect(entry.tag, entry.key).not.toBe('');
  });

  it('covers every .env.example key with exactly one schema, matching its tag', () => {
    for (const { key, tag } of example) {
      const owners = scopes.filter((scope) => ENV_KEYS[scope].includes(key));
      expect(owners, key).toHaveLength(1);
      for (const owner of owners) {
        expect(ENV_SCOPE_TAG[owner], key).toBe(tag);
        if (owner === 'expo_client') expect(key.startsWith('EXPO_PUBLIC_')).toBe(true);
        if (owner === 'next_client') expect(key.startsWith('NEXT_PUBLIC_')).toBe(true);
      }
    }
  });

  it('declares no key that .env.example does not list', () => {
    const listed = new Set(example.map((e) => e.key));
    for (const scope of scopes)
      for (const key of ENV_KEYS[scope]) expect(listed.has(key), key).toBe(true);
  });

  it('keeps .env.example free of secret-shaped values', () => {
    for (const { key, value } of example) {
      expect(/sb_secret_|sk-|sk_|-----BEGIN/.test(value), key).toBe(false);
    }
  });

  it('accepts the .env.example defaults for every schema', () => {
    const raw = Object.fromEntries(example.map((e) => [e.key, e.value]));
    expect(buildEnv.safeParse(raw).success).toBe(true);
    expect(serverEnv.safeParse({ ...raw, ...baseServer }).success).toBe(true);
    expect(
      expoClientEnv.safeParse({
        ...raw,
        EXPO_PUBLIC_SUPABASE_URL: 'https://api.dijitalasistan.app',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
      }).success,
    ).toBe(true);
  });
});

describe('serverEnv', () => {
  it('parses the core keys and applies defaults', () => {
    const env = parseServerEnv(baseServer);
    expect(env.DEMO_MODE).toBe(false);
    expect(env.MICROSOFT_AUTHORITY_TENANT).toBe('common');
    expect(env.token_encryption_keys).toEqual({ 1: KEY_32 });
  });

  it('names the missing key, never a value (UT-ENV-01)', () => {
    const secret = 'sk-ant-super-secret-value';
    const raw = {
      ...baseServer,
      SUPABASE_URL: '',
      ANTHROPIC_API_KEY: 'not-a-key',
      OPENAI_API_KEY: secret,
    };
    const result = serverEnv.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatEnvError(result.error);
      expect(message).toContain('SUPABASE_URL');
      expect(message).toContain('ANTHROPIC_API_KEY');
      expect(message).not.toContain('not-a-key');
      expect(message).not.toContain(secret);
    }
    expect(() => parseServerEnv({ ...baseServer, SUPABASE_URL: undefined })).toThrow(
      /SUPABASE_URL/,
    );
  });

  it('refuses demo mode in production without the allow flag (UT-ENV-03)', () => {
    const prod = { ...baseServer, APP_ENV: 'production', DEMO_MODE: 'true' };
    expect(serverEnv.safeParse(prod).success).toBe(false);
    expect(serverEnv.safeParse({ ...prod, ALLOW_DEMO_IN_PRODUCTION: 'true' }).success).toBe(true);
    expect(serverEnv.safeParse({ ...prod, APP_ENV: 'development' }).success).toBe(true);
  });

  it('requires the active encryption key and 32-byte keys (UT-ENV-04)', () => {
    expect(serverEnv.safeParse({ ...baseServer, TOKEN_ENC_ACTIVE_VERSION: '2' }).success).toBe(
      false,
    );
    const rotated = parseServerEnv({
      ...baseServer,
      TOKEN_ENC_ACTIVE_VERSION: '2',
      TOKEN_ENC_KEY_V2: KEY_32,
    });
    expect(Object.keys(rotated.token_encryption_keys)).toEqual(['1', '2']);
    expect(serverEnv.safeParse({ ...baseServer, TOKEN_ENC_KEY_V1: 'c2hvcnQ=' }).success).toBe(
      false,
    );
    expect(serverEnv.safeParse({ ...baseServer, TOKEN_ENC_KEY_V3: 'short' }).success).toBe(false);
  });

  it('refuses test-only overrides outside development and e2e (UT-ENV-05)', () => {
    for (const key of ['DA_FIXED_NOW', 'GMAIL_API_BASE_URL']) {
      expect(
        serverEnv.safeParse({ ...baseServer, APP_ENV: 'production', [key]: 'x' }).success,
        key,
      ).toBe(false);
      expect(
        serverEnv.safeParse({ ...baseServer, APP_ENV: 'preview', [key]: 'x' }).success,
        key,
      ).toBe(false);
      expect(serverEnv.safeParse({ ...baseServer, APP_ENV: 'e2e', [key]: 'x' }).success, key).toBe(
        true,
      );
    }
    expect(
      serverEnv.safeParse({
        ...baseServer,
        APP_ENV: 'production',
        API_PUBLIC_BASE_URL: 'https://api.dijitalasistan.app',
      }).success,
    ).toBe(true);
  });

  it('accepts the LLM base-URL overrides as URLs only outside preview/production (UT-ENV-05)', () => {
    for (const key of ['ANTHROPIC_API_BASE_URL', 'OPENAI_API_BASE_URL'] as const) {
      const url = 'http://127.0.0.1:8788/anthropic';
      const dev = serverEnv.safeParse({ ...baseServer, APP_ENV: 'development', [key]: url });
      expect(dev.success, key).toBe(true);
      expect(dev.success && dev.data[key], key).toBe(url);
      expect(
        serverEnv.safeParse({ ...baseServer, APP_ENV: 'development', [key]: 'not a url' }).success,
        key,
      ).toBe(false);
      for (const appEnv of ['preview', 'production']) {
        expect(
          serverEnv.safeParse({ ...baseServer, APP_ENV: appEnv, [key]: url }).success,
          `${key} ${appEnv}`,
        ).toBe(false);
      }
    }
  });

  it('requires https URLs in production (UT-ENV-06)', () => {
    const httpLocal = { ...baseServer, SUPABASE_URL: 'http://127.0.0.1:54321' };
    expect(serverEnv.safeParse(httpLocal).success).toBe(true);
    expect(serverEnv.safeParse({ ...httpLocal, APP_ENV: 'production' }).success).toBe(false);
  });

  it('refuses the fixture AI provider in production', () => {
    expect(
      serverEnv.safeParse({
        ...baseServer,
        APP_ENV: 'production',
        AI_FIXTURE_PROVIDER_ENABLED: 'true',
      }).success,
    ).toBe(false);
  });

  it('validates secret shapes and lists', () => {
    expect(serverEnv.safeParse({ ...baseServer, SUPABASE_SECRET_KEY: 'eyJhbGciOi' }).success).toBe(
      false,
    );
    expect(serverEnv.safeParse({ ...baseServer, HASH_PEPPER: 'short' }).success).toBe(false);
    const env = parseServerEnv({
      ...baseServer,
      ADMIN_ALLOWED_EMAIL_DOMAINS: 'dijitalasistan.app, Example.COM',
    });
    expect(env.ADMIN_ALLOWED_EMAIL_DOMAINS).toEqual(['dijitalasistan.app', 'example.com']);
    expect(serverEnv.safeParse({ ...baseServer, GOOGLE_PUBSUB_TOPIC: 'gmail-push' }).success).toBe(
      false,
    );
  });

  it('drops unrelated process variables from the output', () => {
    const env = parseServerEnv({ ...baseServer, PATH: '/usr/bin', HOME: '/root' });
    expect('PATH' in env).toBe(false);
  });
});

describe('clientEnv', () => {
  const expo = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://api.dijitalasistan.app',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
  };
  const next = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://api.dijitalasistan.app',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
  };

  it('parses the mobile allow-list with defaults', () => {
    const result = expoClientEnv.safeParse(expo);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.EXPO_PUBLIC_APP_SCHEME).toBe('dijitalasistan');
      expect(result.data.EXPO_PUBLIC_ANALYTICS_ENABLED).toBe(true);
    }
  });

  it.each([
    ['EXPO_PUBLIC_SUPABASE_KEY', 'sb_secret_abc'],
    ['EXPO_PUBLIC_ANTHROPIC', 'sk-ant-abc'],
    ['EXPO_PUBLIC_OPENAI', 'sk-proj-abc'],
    ['EXPO_PUBLIC_RC', 'sk_abc'],
    ['EXPO_PUBLIC_CERT', '-----BEGIN PRIVATE KEY-----'],
  ])('rejects a secret shape in %s (UT-ENV-02)', (key, value) => {
    expect(expoClientEnv.safeParse({ ...expo, [key]: value }).success).toBe(false);
  });

  it('rejects a secret in a NEXT_PUBLIC_* variable', () => {
    expect(nextClientEnv.safeParse(next).success).toBe(true);
    expect(
      nextClientEnv.safeParse({ ...next, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' })
        .success,
    ).toBe(false);
    expect(nextClientEnv.safeParse({ ...next, NEXT_PUBLIC_EXTRA: 'sb_secret_x' }).success).toBe(
      false,
    );
  });

  it('forbids demo mode and the Test Store key in production builds', () => {
    const prod = { ...expo, EXPO_PUBLIC_APP_ENV: 'production' };
    expect(expoClientEnv.safeParse(prod).success).toBe(true);
    expect(expoClientEnv.safeParse({ ...prod, EXPO_PUBLIC_DEMO_MODE: 'true' }).success).toBe(false);
    expect(
      expoClientEnv.safeParse({ ...prod, EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: 'test_abc' })
        .success,
    ).toBe(false);
    expect(
      expoClientEnv.safeParse({
        ...prod,
        EXPO_PUBLIC_SUPABASE_URL: 'http://api.dijitalasistan.app',
      }).success,
    ).toBe(false);
  });
});

describe('buildEnv', () => {
  it('applies identifier defaults and validates fingerprints', () => {
    const result = buildEnv.safeParse({
      ANDROID_SHA256_CERT_FINGERPRINTS: Array.from({ length: 32 }, () => 'AB').join(':'),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.IOS_APP_GROUP).toBe('group.com.dijitalasistan.app');
    expect(buildEnv.safeParse({ ANDROID_SHA256_CERT_FINGERPRINTS: 'AB:CD' }).success).toBe(false);
    expect(buildEnv.safeParse({ APP_ENV: 'staging' }).success).toBe(false);
  });
});
