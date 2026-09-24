/** Local JWT issuer for auth tests: ES256 keys generated per run, verified via a local JWKS. */
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { jwksVerifier, type TokenVerifier } from '../auth/user.ts';
import { TEST_SUPABASE_URL } from './env.ts';

export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;

export interface TestIssuer {
  readonly verifier: TokenVerifier;
  sign(
    claims: JWTPayload,
    options?: { expiresInSeconds?: number; issuedAt?: number },
  ): Promise<string>;
}

export async function createTestIssuer(kid = 'test-key'): Promise<TestIssuer> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] });
  return {
    verifier: jwksVerifier({ jwks, issuer: TEST_ISSUER }),
    async sign(claims, options = {}) {
      const iat = options.issuedAt ?? Math.floor(Date.now() / 1000);
      return await new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(TEST_ISSUER)
        .setAudience('authenticated')
        .setIssuedAt(iat)
        .setExpirationTime(iat + (options.expiresInSeconds ?? 3600))
        .sign(privateKey);
    },
  };
}

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';
export const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

export function userClaims(sub: string = USER_A, extra: JWTPayload = {}): JWTPayload {
  return {
    sub,
    role: 'authenticated',
    aal: 'aal1',
    session_id: '44444444-4444-4444-8444-444444444444',
    email: 'yunus@example.com',
    app_metadata: { provider: 'apple', providers: ['apple'] },
    is_anonymous: false,
    ...extra,
  };
}
