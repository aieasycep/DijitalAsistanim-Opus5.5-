/**
 * Microsoft `OAuthProvider` (INTEGRATION_PLAN §5.3; API_CONTRACTS OAUTH-02; T-4.07):
 * - `common` authority, PKCE S256, `response_mode=query`, `prompt=select_account` on first connect
 *   and `consent` on reauth / upgrade;
 * - confidential-client **certificate assertion** (`client_assertion_type=…jwt-bearer`, PS256 JWT with
 *   `x5t#S256`, `aud` = the token endpoint used); no client secret is ever sent;
 * - refresh at the tenant endpoint (`consumers` for personal accounts); the refresh token rotates on
 *   every use and the newest one is persisted by the token source;
 * - identity from the id_token (`oid`, `tid`) confirmed by `GET /me`; `provider_account_id = oid:tid`;
 * - revoke is local-only: no per-app delegated revoke exists, the user gets the consent link.
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
import { decodeJwt } from 'jose';
import { signMicrosoftClientAssertion } from '../../crypto/jwt-sign.ts';
import { parseRetryAfter } from '../errors.ts';
import {
  classifyUnknown,
  FORM_HEADERS,
  formBody,
  nonceMatches,
  toTokenSet,
} from '../oauth-common.ts';
import {
  CONSUMER_TENANT_ID,
  type MicrosoftEndpoints,
  microsoftCapabilitiesFromScope,
  microsoftScopesFor,
} from './config.ts';
import { classifyAadError } from './errors.ts';
import { microsoftLocalRevoke } from './revoke.ts';

export interface MicrosoftOAuthConfig {
  readonly clientId: string;
  readonly privateKeyPem: string;
  readonly thumbprintS256: string;
  readonly authorityTenant: string;
  readonly endpoints: MicrosoftEndpoints;
  readonly fetch: typeof fetch;
  readonly now?: () => Date;
  readonly assertionAlg?: 'PS256' | 'RS256';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MicrosoftOAuth implements OAuthProvider {
  readonly provider = 'microsoft' as const;
  constructor(private readonly config: MicrosoftOAuthConfig) {}

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  tokenEndpoint(tenant: string): string {
    return `${this.config.endpoints.login}/${tenant}/oauth2/v2.0/token`;
  }

  /** Refreshes go to the account's tenant (`consumers` for personal Microsoft accounts). */
  tenantFor(tenantId: string | null | undefined): string {
    if (tenantId === CONSUMER_TENANT_ID) return 'consumers';
    if (tenantId !== null && tenantId !== undefined && UUID_RE.test(tenantId)) return tenantId;
    return this.config.authorityTenant;
  }

  scopesFor(capabilities: readonly Capability[], opts: { includeIdentity: boolean }): string[] {
    return microsoftScopesFor(capabilities, opts);
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
    const url = new URL(
      `${this.config.endpoints.login}/${this.config.authorityTenant}/oauth2/v2.0/authorize`,
    );
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('redirect_uri', p.redirectUri);
    url.searchParams.set('scope', p.scopes.join(' '));
    url.searchParams.set('state', p.state);
    url.searchParams.set('code_challenge', p.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', p.prompt ?? 'select_account');
    if (p.loginHint !== undefined && p.loginHint !== null)
      url.searchParams.set('login_hint', p.loginHint);
    url.searchParams.set('ui_locales', p.locale === 'tr' ? 'tr-TR' : 'en-US');
    return url.toString();
  }

  private async token(tenant: string, values: Record<string, string>): Promise<TokenSet> {
    const endpoint = this.tokenEndpoint(tenant);
    const assertion = await signMicrosoftClientAssertion({
      clientId: this.config.clientId,
      tokenEndpoint: endpoint,
      privateKeyPem: this.config.privateKeyPem,
      thumbprintS256: this.config.thumbprintS256,
      alg: this.config.assertionAlg ?? 'PS256',
      now: this.now(),
    });
    const body = formBody({
      ...values,
      client_id: this.config.clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    });
    let response: Response;
    try {
      response = await this.config.fetch(endpoint, {
        method: 'POST',
        headers: FORM_HEADERS,
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ProviderError('provider_unavailable', null, null, 'network');
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    if (!response.ok) {
      throw classifyAadError(
        response.status,
        {
          error: typeof json.error === 'string' ? json.error : null,
          error_description:
            typeof json.error_description === 'string' ? json.error_description : null,
          error_codes: Array.isArray(json.error_codes) ? (json.error_codes as number[]) : null,
        },
        parseRetryAfter(response.headers.get('Retry-After')),
      );
    }
    return toTokenSet(json, this.now());
  }

  async exchangeCode(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TokenSet> {
    return await this.token(this.config.authorityTenant, {
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.codeVerifier,
    });
  }

  async refresh(p: { refreshToken: string; tenantId?: string | null }): Promise<TokenSet> {
    return await this.token(this.tenantFor(p.tenantId), {
      grant_type: 'refresh_token',
      refresh_token: p.refreshToken,
    });
  }

  /** Local-only (§3.14): the caller deletes the tokens; the user removes consent at Microsoft. */
  revoke(p: {
    refreshToken: string;
    tenantType?: 'personal' | 'work' | null;
  }): Promise<RevokeResult> {
    return Promise.resolve(microsoftLocalRevoke(p.tenantType ?? null));
  }

  async identify(
    tokens: TokenSet,
    opts?: { expectedNonceHash?: Uint8Array | null },
  ): Promise<ProviderIdentity> {
    if (tokens.idToken === null)
      throw new ProviderError('payload_invalid', null, null, 'id_token_missing');
    let claims: Record<string, unknown>;
    try {
      claims = decodeJwt(tokens.idToken);
    } catch {
      throw new ProviderError('payload_invalid', null, null, 'id_token_invalid');
    }
    const oid = claims.oid;
    const tid = claims.tid;
    if (typeof oid !== 'string' || typeof tid !== 'string' || claims.aud !== this.config.clientId) {
      throw new ProviderError('payload_invalid', null, null, 'id_token_invalid');
    }
    if (!(await nonceMatches(claims.nonce, opts?.expectedNonceHash))) {
      throw new ProviderError('payload_invalid', null, null, 'id_token_nonce');
    }
    let me: { id?: string; mail?: string | null; userPrincipalName?: string; displayName?: string };
    try {
      const response = await this.config.fetch(
        `${this.config.endpoints.graph}/me?$select=id,mail,userPrincipalName,displayName`,
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Prefer: 'IdType="ImmutableId"',
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(
          response.status >= 500 ? 'provider_unavailable' : 'payload_invalid',
          response.status,
        );
      }
      me = (await response.json()) as typeof me;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('provider_unavailable', null, null, 'network');
    }
    if (me.id !== undefined && me.id !== oid) {
      throw new ProviderError('account_mismatch', null, null, 'me_oid_mismatch');
    }
    const email =
      me.mail ??
      me.userPrincipalName ??
      (typeof claims.preferred_username === 'string' ? claims.preferred_username : null);
    return {
      providerAccountId: `${oid}:${tid}`,
      email: email === null || email === undefined ? null : email.toLowerCase(),
      displayName:
        me.displayName?.slice(0, 120) ??
        (typeof claims.name === 'string' ? claims.name.slice(0, 120) : null),
      tenantId: tid,
      tenantType: tid === CONSUMER_TENANT_ID ? 'personal' : 'work',
    };
  }

  capabilitiesFromGrantedScope(grantedScope: string): Capability[] {
    return microsoftCapabilitiesFromScope(grantedScope);
  }

  classifyError(e: unknown): ProviderErrorCode {
    return classifyUnknown(e);
  }
}
