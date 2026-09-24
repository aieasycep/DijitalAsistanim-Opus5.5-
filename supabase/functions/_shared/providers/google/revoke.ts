/**
 * Google revoke (INTEGRATION_PLAN §3.14; API-INT-03): `POST oauth2.googleapis.com/revoke` with the
 * refresh token as `application/x-www-form-urlencoded` body. This removes the whole grant for the
 * integration client (all incremental scopes); login is unaffected (separate client). A 400
 * `invalid_token` means the grant is already gone and counts as revoked.
 */
import { ProviderError, type RevokeResult } from '@da/domain';
import { classifyProviderFailure, parseRetryAfter } from '../errors.ts';
import { FORM_HEADERS, formBody } from '../oauth-common.ts';
import type { GoogleEndpoints } from './config.ts';

export async function revokeGoogleToken(
  endpoints: GoogleEndpoints,
  doFetch: typeof fetch,
  token: string,
): Promise<RevokeResult> {
  let response: Response;
  try {
    response = await doFetch(`${endpoints.oauth2}/revoke`, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: formBody({ token }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new ProviderError('provider_unavailable', null, null, 'network');
  }
  if (response.ok) {
    await response.body?.cancel();
    return { mode: 'provider_revoked' };
  }
  let code: string | null = null;
  try {
    const json = (await response.json()) as { error?: unknown };
    code = typeof json.error === 'string' ? json.error : null;
  } catch {
    code = null;
  }
  if (response.status === 400 && (code === 'invalid_token' || code === 'invalid_grant')) {
    return { mode: 'provider_revoked' };
  }
  throw classifyProviderFailure(
    response.status,
    { code },
    parseRetryAfter(response.headers.get('Retry-After')),
  );
}
