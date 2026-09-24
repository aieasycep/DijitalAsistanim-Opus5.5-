import { assert, assertEquals, assertThrows } from '@std/assert';
import { credentialStatus, isConfigured, parseFunctionEnv, supabaseRuntimeKeys } from './env.ts';
import { testEnv } from './testing/env.ts';

Deno.test(
  'the server env parses with the core keys only; provider credentials are optional',
  () => {
    const env = parseFunctionEnv(testEnv());
    assertEquals(env.APP_ENV, 'development');
    assertEquals(env.TOKEN_ENC_ACTIVE_VERSION, 1);
    assert(env.token_encryption_keys[1] !== undefined);
  },
);

Deno.test('invalid env errors name keys and rules, never values', () => {
  const raw = testEnv({ HASH_PEPPER: 'short-pepper-value', TOKEN_ENC_KEY_V1: undefined });
  const error = assertThrows(() => parseFunctionEnv(raw));
  const message = (error as Error).message;
  assert(message.includes('HASH_PEPPER'));
  assert(message.includes('TOKEN_ENC_KEY_V1'));
  assert(!message.includes('short-pepper-value'));
});

Deno.test(
  'credentialStatus: missing keys → external_credential_required with key names only',
  () => {
    const empty = credentialStatus('anthropic', testEnv());
    assertEquals(empty.status, 'external_credential_required');
    assertEquals(empty.missing, ['ANTHROPIC_API_KEY']);
    const configured = credentialStatus(
      'anthropic',
      testEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-value' }),
    );
    assertEquals(configured.status, 'configured');
    assertEquals(configured.missing, []);
    const apple = credentialStatus('apple_siwa', testEnv({ APPLE_TEAM_ID: 'ABCDE12345' }));
    assertEquals(apple.missing, [
      'APPLE_SIWA_KEY_ID',
      'APPLE_SIWA_PRIVATE_KEY',
      'APPLE_SIWA_NATIVE_CLIENT_ID',
    ]);
    assert(
      !isConfigured('tts_premium', testEnv({ TTS_PREMIUM_PROVIDER: 'none', TTS_API_KEY: 'k' })),
    );
  },
);

Deno.test(
  'runtime Supabase keys prefer our env, then the platform-injected maps, then legacy keys',
  () => {
    const url = 'https://x.supabase.co';
    assertEquals(
      supabaseRuntimeKeys(
        {
          SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_a"}',
          SUPABASE_SECRET_KEYS: '{"default":"sb_secret_b"}',
        },
        url,
      ),
      { url, publishableKey: 'sb_publishable_a', secretKey: 'sb_secret_b' },
    );
    assertEquals(
      supabaseRuntimeKeys(
        {
          SUPABASE_SECRET_KEY: 'sb_secret_c',
          SUPABASE_SECRET_KEYS: '{"default":"sb_secret_b"}',
          SUPABASE_ANON_KEY: 'anon',
        },
        url,
      ),
      { url, publishableKey: 'anon', secretKey: 'sb_secret_c' },
    );
    assertEquals(supabaseRuntimeKeys({}, url), { url, publishableKey: null, secretKey: null });
  },
);
