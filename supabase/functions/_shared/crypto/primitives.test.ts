import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert';
import {
  decodeProtectedHeader,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importSPKI,
  jwtVerify,
} from 'jose';
import { fromBase64, fromHex, toBase64, toBase64Url, toByteaHex, toHex } from './encoding.ts';
import { clientIp, hashId, hashIdHex, logHash } from './hash.ts';
import { hmacSha256Hex, secretsEqual, timingSafeEqual, verifyHmacSha256 } from './hmac.ts';
import {
  codeChallengeS256,
  createCodeVerifier,
  createPkcePair,
  isValidCodeVerifier,
  randomToken,
} from './pkce.ts';
import { APPLE_AUDIENCE, signAppleClientSecret, signMicrosoftClientAssertion } from './jwt-sign.ts';

Deno.test('HMAC-SHA256 matches RFC 4231 test case 2', async () => {
  assertEquals(
    await hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
  assert(
    await verifyHmacSha256(
      'Jefe',
      'what do ya want for nothing?',
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    ),
  );
  assertFalse(
    await verifyHmacSha256(
      'Jefe',
      'tampered',
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    ),
  );
});

Deno.test('timingSafeEqual and secretsEqual compare full contents', async () => {
  assert(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])));
  assertFalse(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])));
  assertFalse(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 0])));
  assert(await secretsEqual('abc', 'abc'));
  assertFalse(await secretsEqual('abc', 'abcd'));
});

Deno.test('peppered hashes are deterministic per pepper and hide the input', async () => {
  const pepper = { HASH_PEPPER: 'p'.repeat(32) };
  assertEquals(await hashIdHex(pepper, '1.2.3.4'), await hashIdHex(pepper, '1.2.3.4'));
  assert(
    (await hashIdHex(pepper, '1.2.3.4')) !==
      (await hashIdHex({ HASH_PEPPER: 'q'.repeat(32) }, '1.2.3.4')),
  );
  assertEquals((await hashId(pepper, 'x')).byteLength, 32);
  assertEquals((await logHash(pepper, 'user')).length, 16);
  assertEquals(clientIp('203.0.113.9, 10.0.0.1'), '203.0.113.9');
  assertEquals(clientIp(null), null);
});

Deno.test('PKCE S256 matches the RFC 7636 appendix B vector', async () => {
  assertEquals(
    await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  const verifier = createCodeVerifier();
  assertEquals(verifier.length, 43);
  assert(isValidCodeVerifier(verifier));
  const pair = await createPkcePair();
  assertEquals(pair.method, 'S256');
  assertEquals(pair.challenge, await codeChallengeS256(pair.verifier));
  await assertRejects(() => codeChallengeS256('too-short'));
  assertEquals(randomToken().length, 43);
});

Deno.test('encodings round trip, including PostgREST bytea hex', () => {
  const bytes = new Uint8Array([0, 1, 250, 255]);
  assertEquals(fromHex(toHex(bytes)), bytes);
  assertEquals(fromBase64(toBase64(bytes)), bytes);
  assertEquals(fromBase64(toBase64Url(bytes)), bytes);
  assertEquals(toByteaHex(bytes), '\\x0001faff');
  assertEquals(fromHex('\\x0001faff'), bytes);
});

Deno.test(
  'Apple client secret: ES256 with kid, team issuer, client subject and Apple audience',
  async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const now = new Date('2026-09-23T07:00:00Z');
    const jwt = await signAppleClientSecret({
      teamId: 'ABCDE12345',
      clientId: 'com.dijitalasistan.app',
      keyId: 'KEY1234567',
      privateKeyPem: await exportPKCS8(privateKey),
      now,
    });
    assertEquals(decodeProtectedHeader(jwt), { alg: 'ES256', kid: 'KEY1234567' });
    const { payload } = await jwtVerify(
      jwt,
      await importSPKI(await exportSPKI(publicKey), 'ES256'),
      { currentDate: now },
    );
    assertEquals(payload.iss, 'ABCDE12345');
    assertEquals(payload.sub, 'com.dijitalasistan.app');
    assertEquals(payload.aud, APPLE_AUDIENCE);
    assertEquals((payload.exp ?? 0) - (payload.iat ?? 0), 300);
  },
);

Deno.test(
  'Microsoft client assertion: PS256/RS256 with the x5t#S256 thumbprint header',
  async () => {
    for (const alg of ['PS256', 'RS256'] as const) {
      const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
      const now = new Date('2026-09-23T07:00:00Z');
      const jwt = await signMicrosoftClientAssertion({
        clientId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        privateKeyPem: await exportPKCS8(privateKey),
        thumbprintS256: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
        alg,
        now,
      });
      const header = decodeProtectedHeader(jwt);
      assertEquals(header.alg, alg);
      assertEquals(header['x5t#S256'], 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ');
      const { payload } = await jwtVerify(jwt, await importSPKI(await exportSPKI(publicKey), alg), {
        currentDate: now,
      });
      assertEquals(payload.iss, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      assertEquals(payload.sub, payload.iss);
      assertEquals(payload.aud, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
      assert(typeof payload.jti === 'string');
    }
  },
);
