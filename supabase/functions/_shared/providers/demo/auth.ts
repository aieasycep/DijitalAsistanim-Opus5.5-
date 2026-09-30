/**
 * Demo `OAuthProvider` (INTEGRATION_PLAN §13.2; API_CONTRACTS OAUTH-03/04; T-4.10). It runs the real
 * state / PKCE / R-07 completion pipeline without provider credentials:
 * - scopes are `demo:flavor:{google|microsoft}` plus `demo:cap:{capability}`;
 * - `GET /oauth/demo/authorize` issues a code bound to the PKCE challenge, the granted capability mask,
 *   the flavour and a pseudonymous subject of the initiating user, signed with an HMAC of
 *   `HASH_PEPPER` (`demo_{mask}{flavour}{subject}_{signature}`);
 * - `exchangeCode` recomputes the challenge from the verifier and checks the signature, so a wrong
 *   verifier or a forged code fails exactly like a provider `invalid_grant`;
 * - tokens are random opaque strings, encrypted and stored like real ones; revoke ends the grant by
 *   the credentials being deleted (no provider exists behind it).
 * Constructed only while demo mode is allowed (the registry enforces `isDemoEnabled`).
 */
import {
  CAPABILITY_VALUES,
  type Capability,
  type OAuthProvider,
  type ProviderErrorCode,
  type ProviderIdentity,
  ProviderError,
  type RevokeResult,
  type TokenSet,
} from '@da/domain';
import { hmacSha256Base64Url, hmacSha256Hex, timingSafeEqual } from '../../crypto/hmac.ts';
import { utf8 } from '../../crypto/encoding.ts';
import { codeChallengeS256, randomToken } from '../../crypto/pkce.ts';
import { classifyUnknown } from '../oauth-common.ts';
import { DEMO_SELF, type DemoFlavor } from './fixtures/index.ts';

const CAP_ORDER: readonly Capability[] = CAPABILITY_VALUES;
const CODE_RE = /^demo_([0-9a-f]{2})([gm])([0-9a-f]{16})_([A-Za-z0-9_-]{22})$/;

export function demoFlavorScope(flavor: DemoFlavor): string {
  return `demo:flavor:${flavor}`;
}

export function demoFlavorFromScopes(scopes: readonly string[] | string): DemoFlavor {
  const list = typeof scopes === 'string' ? scopes.split(/\s+/) : scopes;
  return list.includes('demo:flavor:microsoft') ? 'microsoft' : 'google';
}

export function demoCapabilitiesFromScope(grantedScope: string): Capability[] {
  const granted = new Set(grantedScope.split(/\s+/));
  return CAP_ORDER.filter((c) => granted.has(`demo:cap:${c}`));
}

function mask(capabilities: readonly Capability[]): string {
  let m = 0;
  CAP_ORDER.forEach((c, i) => {
    if (capabilities.includes(c)) m |= 1 << i;
  });
  return m.toString(16).padStart(2, '0');
}

function unmask(hex: string): Capability[] {
  const m = Number.parseInt(hex, 16);
  return CAP_ORDER.filter((_c, i) => (m & (1 << i)) !== 0);
}

export interface DemoOAuthConfig {
  /** `API_PUBLIC_BASE_URL` (or `SUPABASE_URL`): the demo authorize page lives on our `oauth` function. */
  readonly apiBaseUrl: string;
  /** `HASH_PEPPER`: signs demo codes. */
  readonly secret: string;
  readonly now?: () => Date;
}

export class DemoOAuth implements OAuthProvider {
  readonly provider = 'demo' as const;
  constructor(private readonly config: DemoOAuthConfig) {}

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  scopesFor(capabilities: readonly Capability[], opts: { includeIdentity: boolean }): string[] {
    return [
      ...(opts.includeIdentity ? ['demo:identity'] : []),
      ...CAP_ORDER.filter((c) => capabilities.includes(c)).map((c) => `demo:cap:${c}`),
    ];
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
      `${this.config.apiBaseUrl.replace(/\/+$/, '')}/functions/v1/oauth/demo/authorize`,
    );
    url.searchParams.set('state', p.state);
    url.searchParams.set('code_challenge', p.codeChallenge);
    url.searchParams.set('flavor', demoFlavorFromScopes(p.scopes));
    return url.toString();
  }

  /** Pseudonymous, stable demo subject of a user (16 hex chars). */
  async subjectFor(userId: string): Promise<string> {
    return (await hmacSha256Hex(this.config.secret, `demo-subject:${userId}`)).slice(0, 16);
  }

  /** OAUTH-03: the code handed to the demo callback (granted capabilities ⊆ requested). */
  async issueCode(input: {
    codeChallenge: string;
    capabilities: readonly Capability[];
    flavor: DemoFlavor;
    userId: string;
  }): Promise<string> {
    const head = `${mask(input.capabilities)}${input.flavor === 'microsoft' ? 'm' : 'g'}${await this.subjectFor(input.userId)}`;
    const sig = (
      await hmacSha256Base64Url(this.config.secret, `demo-code:${input.codeChallenge}:${head}`)
    ).slice(0, 22);
    return `demo_${head}_${sig}`;
  }

  private tokens(
    flavor: DemoFlavor,
    subject: string,
    capabilities: readonly Capability[],
    withRefresh: boolean,
  ): TokenSet {
    return {
      accessToken: `demo-at.${flavor}.${subject}.${randomToken(24)}`,
      accessTokenExpiresAt: new Date(this.now().getTime() + 3_600_000).toISOString(),
      refreshToken: withRefresh ? `demo-rt.${flavor}.${subject}.${randomToken(24)}` : null,
      grantedScope: [demoFlavorScope(flavor), ...capabilities.map((c) => `demo:cap:${c}`)].join(
        ' ',
      ),
      idToken: null,
    };
  }

  async exchangeCode(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TokenSet> {
    const match = CODE_RE.exec(p.code);
    if (match === null) throw new ProviderError('auth_invalid_grant', 400, null, 'invalid_grant');
    const [, maskHex = '00', flavorChar = 'g', subject = '', sig = ''] = match;
    const challenge = await codeChallengeS256(p.codeVerifier).catch(() => '');
    const expected = (
      await hmacSha256Base64Url(
        this.config.secret,
        `demo-code:${challenge}:${maskHex}${flavorChar}${subject}`,
      )
    ).slice(0, 22);
    if (!timingSafeEqual(utf8.encode(expected), utf8.encode(sig))) {
      throw new ProviderError('auth_invalid_grant', 400, null, 'invalid_grant');
    }
    return this.tokens(flavorChar === 'm' ? 'microsoft' : 'google', subject, unmask(maskHex), true);
  }

  refresh(p: { refreshToken: string }): Promise<TokenSet> {
    const parts = p.refreshToken.split('.');
    if (parts.length !== 4 || parts[0] !== 'demo-rt') {
      return Promise.reject(new ProviderError('auth_invalid_grant', 400, null, 'invalid_grant'));
    }
    const flavor: DemoFlavor = parts[1] === 'microsoft' ? 'microsoft' : 'google';
    const set = this.tokens(flavor, parts[2] ?? '', [], false);
    return Promise.resolve({ ...set, grantedScope: '' });
  }

  revoke(): Promise<RevokeResult> {
    return Promise.resolve({ mode: 'provider_revoked' });
  }

  identify(tokens: TokenSet): Promise<ProviderIdentity> {
    const parts = tokens.accessToken.split('.');
    if (parts.length !== 4 || parts[0] !== 'demo-at') {
      return Promise.reject(new ProviderError('payload_invalid', null, null, 'id_token_invalid'));
    }
    const flavor: DemoFlavor = parts[1] === 'microsoft' ? 'microsoft' : 'google';
    const self = DEMO_SELF[flavor];
    return Promise.resolve({
      providerAccountId: `demo-${flavor}-${parts[2] ?? ''}`,
      email: self.email,
      displayName: self.name,
      tenantId: null,
      tenantType: null,
    });
  }

  capabilitiesFromGrantedScope(grantedScope: string): Capability[] {
    return demoCapabilitiesFromScope(grantedScope);
  }

  classifyError(e: unknown): ProviderErrorCode {
    return classifyUnknown(e);
  }
}
