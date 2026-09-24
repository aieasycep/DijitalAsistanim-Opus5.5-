import { assert, assertEquals, assertNotEquals, assertRejects } from '@std/assert';
import { randomBase64 } from '../testing/env.ts';
import { sha256 } from './hmac.ts';
import { utf8 } from './encoding.ts';
import {
  decryptToken,
  encryptToken,
  loadKeyring,
  reencryptToActive,
  type TokenBinding,
  TokenCipherError,
  tokenAad,
} from './token-cipher.ts';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const binding: TokenBinding = { account: ACCOUNT, provider: 'google', kind: 'refresh' };

Deno.test('round trip: AES-256-GCM with a 96-bit IV, tag appended, AAD hash stored', async () => {
  const keyring = await loadKeyring({
    token_encryption_keys: { 1: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
  const token = '1//0g-refresh-token-value';
  const encrypted = await encryptToken(keyring, token, binding);
  assertEquals(encrypted.keyVersion, 1);
  assertEquals(encrypted.iv.byteLength, 12);
  assertEquals(encrypted.ciphertext.byteLength, utf8.encode(token).byteLength + 16);
  assertEquals(encrypted.aadHash, await sha256(`v1|${ACCOUNT}|google|refresh`));
  assert(!new TextDecoder().decode(encrypted.ciphertext).includes(token));
  assertEquals(await decryptToken(keyring, encrypted, binding), token);
});

Deno.test('every encryption uses a fresh IV', async () => {
  const keyring = await loadKeyring({
    token_encryption_keys: { 1: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
  const a = await encryptToken(keyring, 'same', binding);
  const b = await encryptToken(keyring, 'same', binding);
  assertNotEquals(a.iv, b.iv);
  assertNotEquals(a.ciphertext, b.ciphertext);
});

Deno.test('decryption fails on an AAD mismatch (other account, provider or kind)', async () => {
  const keyring = await loadKeyring({
    token_encryption_keys: { 1: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
  const encrypted = await encryptToken(keyring, 'secret-token', binding);
  for (const other of [
    { ...binding, account: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { ...binding, provider: 'microsoft' },
    { ...binding, kind: 'access' as const },
  ]) {
    const error = await assertRejects(
      () => decryptToken(keyring, encrypted, other),
      TokenCipherError,
    );
    assertEquals(error.reason, 'aad_mismatch');
  }
  // A forged aad_hash does not help: GCM authenticates the AAD itself.
  const forged = {
    ...encrypted,
    aadHash: await sha256(tokenAad({ ...binding, provider: 'microsoft' })),
  };
  const error = await assertRejects(
    () => decryptToken(keyring, forged, { ...binding, provider: 'microsoft' }),
    TokenCipherError,
  );
  assertEquals(error.reason, 'decrypt_failed');
});

Deno.test(
  'old key versions still decrypt after rotation; re-encryption moves to the active version',
  async () => {
    const v1 = randomBase64(32);
    const old = await loadKeyring({
      token_encryption_keys: { 1: v1 },
      TOKEN_ENC_ACTIVE_VERSION: 1,
    });
    const encrypted = await encryptToken(old, 'rotating-token', binding);
    const rotated = await loadKeyring({
      token_encryption_keys: { 1: v1, 2: randomBase64(32) },
      TOKEN_ENC_ACTIVE_VERSION: 2,
    });
    assertEquals(rotated.versions, [1, 2]);
    assertEquals(await decryptToken(rotated, encrypted, binding), 'rotating-token');
    const next = await reencryptToActive(rotated, encrypted, binding);
    assert(next !== null);
    assertEquals(next.keyVersion, 2);
    assertEquals(await decryptToken(rotated, next, binding), 'rotating-token');
    assertEquals(await reencryptToActive(rotated, next, binding), null);
  },
);

Deno.test('unknown key versions, missing active keys and malformed keys are refused', async () => {
  const keyring = await loadKeyring({
    token_encryption_keys: { 1: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
  const encrypted = await encryptToken(keyring, 'x', binding);
  const other = await loadKeyring({
    token_encryption_keys: { 3: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 3,
  });
  assertEquals(
    (await assertRejects(() => decryptToken(other, encrypted, binding), TokenCipherError)).reason,
    'unknown_key_version',
  );
  assertEquals(
    (
      await assertRejects(
        () =>
          loadKeyring({
            token_encryption_keys: { 1: randomBase64(32) },
            TOKEN_ENC_ACTIVE_VERSION: 2,
          }),
        TokenCipherError,
      )
    ).reason,
    'active_key_missing',
  );
  assertEquals(
    (
      await assertRejects(
        () =>
          loadKeyring({
            token_encryption_keys: { 1: randomBase64(16) },
            TOKEN_ENC_ACTIVE_VERSION: 1,
          }),
        TokenCipherError,
      )
    ).reason,
    'invalid_key',
  );
});

Deno.test('the SIWA token AAD binds user id, apple_device and apple_siwa_refresh', () => {
  assertEquals(
    tokenAad({ account: ACCOUNT, provider: 'apple_device', kind: 'apple_siwa_refresh' }),
    `v1|${ACCOUNT}|apple_device|apple_siwa_refresh`,
  );
});
