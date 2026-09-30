import { describe, expect, it } from 'vitest';

import { findForbiddenEnv, parseBackofficeEnv } from '@/env';

const SECRET_KEY_NAME = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const SECRET_VALUE = ['sb', 'secret', 'abcdefghijklmnop'].join('_');

const VALID = {
  APP_ENV: 'development',
  API_PUBLIC_BASE_URL: 'http://127.0.0.1:54321',
  ADMIN_BFF_SECRET: 'x'.repeat(40),
  ADMIN_ORIGIN: 'http://localhost:3100/',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_key',
};

describe('backoffice env (INTEGRATION_PLAN §15, BACKOFFICE_PLAN §2.7)', () => {
  it('parses a valid environment and derives the admin-api base', () => {
    const env = parseBackofficeEnv(VALID);
    expect(env.adminApiBaseUrl).toBe('http://127.0.0.1:54321/functions/v1/admin-api');
    expect(env.ADMIN_ORIGIN).toBe('http://localhost:3100');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  });

  it('refuses to boot when the Supabase secret key is present', () => {
    expect(() => parseBackofficeEnv({ ...VALID, [SECRET_KEY_NAME]: SECRET_VALUE })).toThrow(
      /forbidden_secret/,
    );
    expect(findForbiddenEnv({ [SECRET_KEY_NAME]: 'anything' })).toEqual([SECRET_KEY_NAME]);
  });

  it('refuses database, pepper, gateway and token-encryption secrets', () => {
    expect(
      findForbiddenEnv({
        SUPABASE_DB_URL: 'postgres://x',
        PII_LOOKUP_PEPPER: 'p',
        ADMIN_GATEWAY_SECRET: 'g',
        TOKEN_ENC_KEY_V1: 'k',
        ANTHROPIC_API_KEY: 'a',
      }),
    ).toEqual([
      'ADMIN_GATEWAY_SECRET',
      'ANTHROPIC_API_KEY',
      'PII_LOOKUP_PEPPER',
      'SUPABASE_DB_URL',
      'TOKEN_ENC_KEY_V1',
    ]);
    expect(findForbiddenEnv({ SUPABASE_DB_URL: '' })).toEqual([]);
  });

  it('refuses a secret-shaped value under any key-like name', () => {
    expect(findForbiddenEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET_VALUE })).toEqual([
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ]);
  });

  it('names missing or invalid keys without echoing values', () => {
    let message = '';
    try {
      parseBackofficeEnv({
        ...VALID,
        ADMIN_BFF_SECRET: 'short-secret-value',
        API_PUBLIC_BASE_URL: undefined,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('ADMIN_BFF_SECRET');
    expect(message).toContain('API_PUBLIC_BASE_URL');
    expect(message).not.toContain('short-secret-value');
  });

  it('requires https in production', () => {
    expect(() => parseBackofficeEnv({ ...VALID, APP_ENV: 'production' })).toThrow(
      /https_required_in_production/,
    );
    expect(
      parseBackofficeEnv({
        ...VALID,
        APP_ENV: 'production',
        API_PUBLIC_BASE_URL: 'https://api.dijitalasistan.app',
        ADMIN_ORIGIN: 'https://admin.dijitalasistan.app',
        NEXT_PUBLIC_SUPABASE_URL: 'https://api.dijitalasistan.app',
      }).APP_ENV,
    ).toBe('production');
  });
});
