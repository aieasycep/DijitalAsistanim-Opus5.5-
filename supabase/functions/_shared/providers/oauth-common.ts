/** Helpers shared by the Google, Microsoft and demo `OAuthProvider` implementations. */
import { ProviderError, type ProviderErrorCode, type TokenSet } from '@da/domain';
import { sha256, timingSafeEqual } from '../crypto/hmac.ts';

export interface RawTokenResponse {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
  readonly refresh_token?: unknown;
  readonly scope?: unknown;
  readonly id_token?: unknown;
}

/** Normalises a token endpoint response (expiry as an absolute RFC 3339 instant). */
export function toTokenSet(raw: RawTokenResponse, now: Date, fallbackScope = ''): TokenSet {
  if (typeof raw.access_token !== 'string' || raw.access_token === '') {
    throw new ProviderError('payload_invalid', null, null, 'token_response_invalid');
  }
  const expiresIn =
    typeof raw.expires_in === 'number' ? raw.expires_in : Number(raw.expires_in ?? 3600);
  return {
    accessToken: raw.access_token,
    accessTokenExpiresAt: new Date(
      now.getTime() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    ).toISOString(),
    refreshToken:
      typeof raw.refresh_token === 'string' && raw.refresh_token !== '' ? raw.refresh_token : null,
    grantedScope: typeof raw.scope === 'string' ? raw.scope : fallbackScope,
    idToken: typeof raw.id_token === 'string' && raw.id_token !== '' ? raw.id_token : null,
  };
}

export function classifyUnknown(error: unknown): ProviderErrorCode {
  return error instanceof ProviderError ? error.code : 'unknown';
}

/** Constant-time check of an id_token `nonce` claim against the stored sha256 of the nonce. */
export async function nonceMatches(
  nonce: unknown,
  expectedHash: Uint8Array | null | undefined,
): Promise<boolean> {
  if (expectedHash === null || expectedHash === undefined) return true;
  if (typeof nonce !== 'string' || nonce === '') return false;
  return timingSafeEqual(await sha256(nonce), expectedHash);
}

export function formBody(values: Record<string, string | null | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) body.set(key, value);
  }
  return body;
}

export const FORM_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
};
