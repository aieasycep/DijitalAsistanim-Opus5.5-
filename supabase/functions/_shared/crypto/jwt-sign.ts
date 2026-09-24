/**
 * JWT signing for provider client authentication (IMPLEMENTATION_PLAN T-3.04):
 * - Sign in with Apple client secret: ES256, `kid` = `APPLE_SIWA_KEY_ID`, `iss` = team id,
 *   `sub` = client id, `aud` = `https://appleid.apple.com`, short lifetime (API-DEV-03).
 * - Microsoft Entra client assertion (certificate credential): RS256 or PS256 with the
 *   `x5t#S256` header = base64url SHA-256 thumbprint of the certificate (INTEGRATION_PLAN §5.3).
 */
import { importPKCS8, SignJWT } from 'jose';

export const APPLE_AUDIENCE = 'https://appleid.apple.com';

export interface AppleClientSecretInput {
  readonly teamId: string;
  readonly clientId: string;
  readonly keyId: string;
  /** PKCS#8 PEM of the `.p8` key. */
  readonly privateKeyPem: string;
  readonly now?: Date;
  /** Lifetime in seconds (Apple allows up to 6 months; we mint per exchange). */
  readonly ttlSeconds?: number;
}

export async function signAppleClientSecret(input: AppleClientSecretInput): Promise<string> {
  const key = await importPKCS8(input.privateKeyPem, 'ES256');
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: input.keyId })
    .setIssuer(input.teamId)
    .setSubject(input.clientId)
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (input.ttlSeconds ?? 300))
    .sign(key);
}

export interface MicrosoftAssertionInput {
  readonly clientId: string;
  /** Token endpoint, e.g. `https://login.microsoftonline.com/common/oauth2/v2.0/token`. */
  readonly tokenEndpoint: string;
  readonly privateKeyPem: string;
  /** base64url SHA-256 thumbprint of the certificate (`MICROSOFT_CERT_THUMBPRINT_S256`). */
  readonly thumbprintS256: string;
  readonly alg?: 'RS256' | 'PS256';
  readonly now?: Date;
  readonly ttlSeconds?: number;
  readonly jti?: string;
}

export async function signMicrosoftClientAssertion(
  input: MicrosoftAssertionInput,
): Promise<string> {
  const alg = input.alg ?? 'PS256';
  const key = await importPKCS8(input.privateKeyPem, alg);
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg, typ: 'JWT', 'x5t#S256': input.thumbprintS256 })
    .setIssuer(input.clientId)
    .setSubject(input.clientId)
    .setAudience(input.tokenEndpoint)
    .setJti(input.jti ?? crypto.randomUUID())
    .setNotBefore(iat)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (input.ttlSeconds ?? 600))
    .sign(key);
}
