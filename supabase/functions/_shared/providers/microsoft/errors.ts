/**
 * Microsoft identity platform error mapping (INTEGRATION_PLAN §5.3 AADSTS table [verify codes];
 * API_CONTRACTS §2.7, OAUTH-02; T-4.07 acceptance "error-mapping table test"):
 *
 * | AADSTS                             | ProviderErrorCode            | account status           |
 * |------------------------------------|------------------------------|--------------------------|
 * | 65001 (admin wording), 90094, 90095 | consent_admin_required      | admin_consent_required   |
 * | 700082, 50173, 70008, 50076, 50079 | auth_invalid_grant           | needs_reauth             |
 * | 53003                              | conditional_access_blocked   | error                    |
 * | 7000215, 700027                    | client_credential_invalid    | error (ops alert)        |
 * | 65001 (user consent missing)       | scope_missing                | partial                  |
 */
import { ProviderError, type ProviderErrorCode } from '@da/domain';

export interface AadErrorBody {
  readonly error?: string | null;
  readonly error_description?: string | null;
  readonly error_codes?: readonly number[] | null;
}

export const AADSTS_MAPPING: readonly {
  readonly codes: readonly number[];
  readonly code: ProviderErrorCode;
}[] = [
  { codes: [90094, 90095], code: 'consent_admin_required' },
  { codes: [700082, 50173, 70008, 50076, 50079], code: 'auth_invalid_grant' },
  { codes: [53003], code: 'conditional_access_blocked' },
  { codes: [7000215, 700027], code: 'client_credential_invalid' },
];

/** AADSTS numbers named in `error_codes` or in the description (`AADSTS700082: …`). */
export function aadstsCodes(body: AadErrorBody): number[] {
  const out = new Set<number>(body.error_codes ?? []);
  for (const match of (body.error_description ?? '').matchAll(/AADSTS(\d{4,7})/g))
    out.add(Number(match[1]));
  return [...out];
}

export function classifyAadError(
  status: number | null,
  body: AadErrorBody,
  retryAfterMs: number | null = null,
): ProviderError {
  const codes = aadstsCodes(body);
  const description = body.error_description ?? '';
  const reason = codes.length > 0 ? `AADSTS${codes[0]}` : (body.error ?? null);
  const make = (code: ProviderErrorCode) => new ProviderError(code, status, retryAfterMs, reason);
  if (codes.includes(65001) && /admin/i.test(description)) return make('consent_admin_required');
  for (const row of AADSTS_MAPPING) {
    if (codes.some((c) => row.codes.includes(c))) return make(row.code);
  }
  if (codes.includes(65001)) return make('scope_missing');
  const error = body.error ?? '';
  if (error === 'invalid_grant' || error === 'interaction_required')
    return make('auth_invalid_grant');
  if (error === 'invalid_client' || error === 'unauthorized_client')
    return make('client_credential_invalid');
  if (error === 'consent_required' || error === 'access_denied') return make('consent_denied');
  if (status === 429 || error === 'temporarily_unavailable') return make('rate_limited');
  if (status !== null && status >= 500) return make('provider_unavailable');
  return make(status === null ? 'unknown' : 'payload_invalid');
}

/**
 * The authorize-redirect outcome (OAUTH-02 step 2): admin approval codes → `admin_consent_required`,
 * user-declined consent → `denied`, anything else → `error`.
 */
export function microsoftAuthorizeOutcome(
  error: string,
  description: string | undefined,
): { result: 'admin_consent_required' | 'denied' | 'error'; errorCode: string } {
  const codes = aadstsCodes({ error, error_description: description ?? null });
  if (
    codes.includes(90094) ||
    codes.includes(90095) ||
    (codes.includes(65001) && /admin/i.test(description ?? ''))
  ) {
    return { result: 'admin_consent_required', errorCode: 'admin_consent_required' };
  }
  if (
    error === 'access_denied' ||
    error === 'consent_required' ||
    codes.includes(65001) ||
    codes.includes(65004)
  ) {
    return { result: 'denied', errorCode: 'consent_denied' };
  }
  return { result: 'error', errorCode: 'provider_error' };
}
