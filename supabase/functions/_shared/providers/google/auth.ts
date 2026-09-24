/**
 * Google `OAuthProvider` (INTEGRATION_PLAN §4.3; API_CONTRACTS API-INT-01, OAUTH-01; T-4.02):
 * - authorization: web client, PKCE S256, `access_type=offline`, `include_granted_scopes=true`,
 *   `prompt=consent` (a refresh token is guaranteed on first connect, reauth and upgrade), `hl`;
 * - token exchange and refresh at `oauth2.googleapis.com/token` (refresh returns no new refresh
 *   token; the stored one is kept); `invalid_grant` → `auth_invalid_grant` (→ `needs_reauth`);
 * - id_token verified with `jose` against Google's JWKS: issuer, audience, expiry, `email_verified`
 *   and the OIDC nonce (stored only as a hash on the state row);
 * - granular consent: capabilities are derived from the granted scope string, never assumed.
 */
import {
  type Capability,
  type OAuthProvider,
  type ProviderErrorCode,
  type ProviderIdentity,
  ProviderError,
  type RevokeResult,
  type TokenSet,
} from '@da/domain';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { providerFetch } from '../http.ts';
import {
  classifyUnknown,
  FORM_HEADERS,
  formBody,
  nonceMatches,
  toTokenSet,
} from '../oauth-common.ts';
import type { GoogleEndpoints } from './config.ts';
import { revokeGoogleToken } from './revoke.ts';
import { googleCapabilitiesFromScope, googleScopesFor } from './scopes.ts';

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly endpoints: GoogleEndpoints;
  readonly jwks: JWTVerifyGetKey;
  readonly fetch: typeof fetch;
  readonly now?: () => Date;
}

export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export class GoogleOAuth implements OAuthProvider {
  readonly provider = 'google' as const;
  constructor(private readonly config: GoogleOAuthConfig) {}

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  scopesFor(capabilities: readonly Capability[], opts: { includeIdentity: boolean }): string[] {
    return googleScopesFor(capabilities, opts);
  }

  buildAuthorizationUrl(p: {
    state: string;
    codeChallenge: string;
    scopes: string[];
    redirectUri: string;
    loginHint?: string | null;
    prompt?: 'consent' | 'select_account' | null;
    locale: 'tr' | 'en';
  }): string {
    const url = new URL(`${this.config.endpoints.accounts}/o/oauth2/v2/auth`);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', p.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', p.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', p.state);
    url.searchParams.set('code_challenge', p.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', p.prompt ?? 'consent');
    if (p.loginHint !== undefined && p.loginHint !== null)
      url.searchParams.set('login_hint', p.loginHint);
    url.searchParams.set('hl', p.locale);
    return url.toString();
  }

  private async token(form: URLSearchParams): Promise<TokenSet> {
    const response = await providerFetch(
      {
        url: `${this.config.endpoints.oauth2}/token`,
        method: 'POST',
        headers: FORM_HEADERS,
        body: form,
        idempotent: true,
      },
      { fetch: this.config.fetch, retryDelaysMs: [250] },
    );
    return toTokenSet((await response.json()) as Record<string, unknown>, this.now());
  }

  async exchangeCode(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TokenSet> {
    return await this.token(
      formBody({
        grant_type: 'authorization_code',
        code: p.code,
        code_verifier: p.codeVerifier,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: p.redirectUri,
      }),
    );
  }

  async refresh(p: { refreshToken: string }): Promise<TokenSet> {
    return await this.token(
      formBody({
        grant_type: 'refresh_token',
        refresh_token: p.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    );
  }

  async revoke(p: { refreshToken: string }): Promise<RevokeResult> {
    return await revokeGoogleToken(this.config.endpoints, this.config.fetch, p.refreshToken);
  }

  /** Verifies the id_token; `expectedNonceHash` is the state's `nonce_hash` (R-07 callback). */
  async identify(
    tokens: TokenSet,
    opts?: { expectedNonceHash?: Uint8Array | null },
  ): Promise<ProviderIdentity> {
    if (tokens.idToken === null)
      throw new ProviderError('payload_invalid', null, null, 'id_token_missing');
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(tokens.idToken, this.config.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: this.config.clientId,
        currentDate: this.now(),
      }));
    } catch {
      throw new ProviderError('payload_invalid', null, null, 'id_token_invalid');
    }
    if (payload.email_verified !== true || typeof payload.sub !== 'string') {
      throw new ProviderError('payload_invalid', null, null, 'id_token_invalid');
    }
    if (!(await nonceMatches(payload.nonce, opts?.expectedNonceHash))) {
      throw new ProviderError('payload_invalid', null, null, 'id_token_nonce');
    }
    return {
      providerAccountId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      displayName: typeof payload.name === 'string' ? payload.name.slice(0, 120) : null,
      tenantId: null,
      tenantType: null,
    };
  }

  capabilitiesFromGrantedScope(grantedScope: string): Capability[] {
    return googleCapabilitiesFromScope(grantedScope);
  }

  classifyError(e: unknown): ProviderErrorCode {
    return classifyUnknown(e);
  }
}
