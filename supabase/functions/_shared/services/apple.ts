/**
 * Sign in with Apple token exchange (API-DEV-03, ADR-06, Apple guideline 5.1.1(v);
 * IMPLEMENTATION_PLAN T-3.11). The native `authorizationCode` is exchanged at
 * `https://appleid.apple.com/auth/token` with an ES256 client secret; the returned refresh token is
 * stored AES-GCM encrypted (`oauth_credentials`, `token_kind='apple_siwa_refresh'`, AAD
 * `v1|{user_id}|apple_device|apple_siwa_refresh`) and used only to revoke at account deletion.
 * External credential required: the Apple SIWA key (`APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`,
 * `APPLE_SIWA_PRIVATE_KEY`, `APPLE_SIWA_NATIVE_CLIENT_ID`).
 */
import { decodeJwt } from 'jose';
import { AppError, fieldError } from '../errors.ts';
import { credentialStatus, type RawEnv } from '../env.ts';
import { signAppleClientSecret } from '../crypto/jwt-sign.ts';
import { encryptToken, type TokenKeyring } from '../crypto/token-cipher.ts';
import type { AuditWriter } from './audit.ts';
import type { CredentialsRepo } from './credentials.ts';

export const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
const APPLE_ID_ORIGIN = 'https://appleid.apple.com';

/**
 * `https://appleid.apple.com`, or the test-only `APPLE_ID_BASE_URL` (mock provider server, TEST_PLAN
 * §6.1) outside preview and production, where the env schema also refuses the key.
 */
export function appleIdBase(env: RawEnv): string {
  const appEnv = (env.APP_ENV ?? '').trim();
  if (appEnv === 'production' || appEnv === 'preview') return APPLE_ID_ORIGIN;
  const override = (env.APPLE_ID_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return override === '' ? APPLE_ID_ORIGIN : override;
}
/** `oauth_credentials.provider` for the SIWA token (ARCHITECTURE_DECISIONS ADR-29). */
export const SIWA_PROVIDER = 'apple_device';

export interface AppleExchangeDeps {
  readonly env: RawEnv;
  readonly credentials: CredentialsRepo;
  readonly keyring: () => Promise<TokenKeyring>;
  /** `private.user_apple_sub(p_user)`: the caller's Apple identity `sub`, or null. */
  readonly appleSub: (userId: string) => Promise<string | null>;
  readonly audit: AuditWriter;
  readonly correlationId: string | null;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export interface AppleExchangeInput {
  readonly authorization_code: string;
  readonly identity_token_sub: string;
}

export async function exchangeAppleCode(
  deps: AppleExchangeDeps,
  userId: string,
  input: AppleExchangeInput,
): Promise<{ stored: boolean }> {
  const status = credentialStatus('apple_siwa', deps.env);
  if (status.status !== 'configured') {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'apple_siwa', credential_keys: [...status.missing] },
    });
  }
  const linkedSub = await deps.appleSub(userId);
  if (linkedSub === null || linkedSub !== input.identity_token_sub)
    throw fieldError('identity_token_sub', 'custom');

  const env = deps.env as Required<
    Pick<
      RawEnv,
      | 'APPLE_TEAM_ID'
      | 'APPLE_SIWA_KEY_ID'
      | 'APPLE_SIWA_PRIVATE_KEY'
      | 'APPLE_SIWA_NATIVE_CLIENT_ID'
    >
  >;
  const clientId = (env.APPLE_SIWA_NATIVE_CLIENT_ID ?? '').trim();
  const clientSecret = await signAppleClientSecret({
    teamId: (env.APPLE_TEAM_ID ?? '').trim(),
    clientId,
    keyId: (env.APPLE_SIWA_KEY_ID ?? '').trim(),
    privateKeyPem: (env.APPLE_SIWA_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    ...(deps.now === undefined ? {} : { now: deps.now() }),
  });

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${appleIdBase(deps.env)}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.authorization_code,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new AppError(timedOut ? 'UPSTREAM_TIMEOUT' : 'PROVIDER_UNAVAILABLE', {
      details: { provider: 'apple' },
    });
  }

  let json: { error?: string; refresh_token?: string; id_token?: string } = {};
  try {
    json = (await response.json()) as typeof json;
  } catch {
    json = {};
  }
  if (!response.ok) {
    if (response.status >= 500)
      throw new AppError('PROVIDER_UNAVAILABLE', { details: { provider: 'apple' } });
    if (json.error === 'invalid_grant') {
      const existing = await deps.credentials.findUserCredential(userId, 'apple_siwa_refresh');
      if (existing !== null) return { stored: false };
    }
    throw new AppError('PROVIDER_REJECTED', {
      details: {
        provider: 'apple',
        provider_reason: typeof json.error === 'string' ? json.error.slice(0, 40) : 'rejected',
      },
    });
  }
  if (typeof json.refresh_token !== 'string' || typeof json.id_token !== 'string') {
    throw new AppError('PROVIDER_REJECTED', {
      details: { provider: 'apple', provider_reason: 'missing_token' },
    });
  }
  let sub: unknown;
  try {
    sub = decodeJwt(json.id_token).sub;
  } catch {
    sub = null;
  }
  if (sub !== input.identity_token_sub) throw fieldError('identity_token_sub', 'custom');

  const keyring = await deps.keyring();
  const encrypted = await encryptToken(keyring, json.refresh_token, {
    account: userId,
    provider: SIWA_PROVIDER,
    kind: 'apple_siwa_refresh',
  });
  await deps.credentials.saveUserCredential(userId, SIWA_PROVIDER, 'apple_siwa_refresh', encrypted);
  await deps.audit.append({
    actorType: 'user',
    actorId: userId,
    action: 'user.siwa_token.stored',
    targetType: 'oauth_credential',
    targetId: null,
    targetUserId: userId,
    result: 'success',
    details: { key_version: encrypted.keyVersion },
    correlationId: deps.correlationId,
  });
  return { stored: true };
}
