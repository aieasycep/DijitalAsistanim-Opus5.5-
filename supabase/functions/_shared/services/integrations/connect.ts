/**
 * OAuth connect, reconnect and scope upgrade with the client-bound completion (API_CONTRACTS
 * API-INT-01, API-INT-02, API-INT-07, OAUTH-01…04; INTEGRATION_PLAN §3.2, §3.2.1; R-07; T-4.01).
 *
 * start / upgrade → `oauth_states` row (state, PKCE verifier ciphertext, nonce hash, device nonce
 * hash, 10-minute TTL) and the provider authorization URL.
 * callback → atomic single-use consume, token exchange, identity check, then either a `connecting`
 * account with its encrypted credentials (new identity) or the encrypted token set held on the state
 * row (reconnect / upgrade). Nothing is usable and nothing syncs before completion; the redirect
 * carries only `result=pending_confirmation`, the state id and a one-time completion code.
 * complete → the same user, the device nonce and the 10-minute window are checked, then the account
 * is activated (or the held tokens are swapped in) atomically and `initial_sync` is enqueued.
 */
import {
  type Capability,
  type OAuthProvider,
  ProviderError,
  type ReadCapability,
  READ_CAPABILITIES,
  type ServerProvider,
  type TokenSet,
} from '@da/domain';
import { toBase64Url } from '../../crypto/encoding.ts';
import { sha256, timingSafeEqual } from '../../crypto/hmac.ts';
import { codeChallengeS256, createCodeVerifier } from '../../crypto/pkce.ts';
import { decryptToken, encryptToken, type TokenKeyring } from '../../crypto/token-cipher.ts';
import { AppError, fieldError, isAppError } from '../../errors.ts';
import { GoogleOAuth } from '../../providers/google/auth.ts';
import { demoFlavorScope } from '../../providers/demo/auth.ts';
import { microsoftAuthorizeOutcome } from '../../providers/microsoft/errors.ts';
import {
  enqueueInitialSync,
  enqueueResourceSync,
  jobRef,
  type JobRefData,
  type SyncResourceKind,
} from './enqueue.ts';
import type { IntegrationRuntime } from './runtime.ts';
import { openStateSecret, nonceValueFor, sealStateSecret, stateValueFor } from './state-secrets.ts';
import { accountSummary, summaryOf, togglesOf } from './status.ts';
import type { AccountRecord, CredentialWrite, OAuthPreResult, OAuthStateRecord } from './types.ts';
import type { AccountSummary } from '@da/validation';

const STATE_TTL_MS = 10 * 60_000;
const COMPLETION_WINDOW_MS = 10 * 60_000;

export type FlowProvider = ServerProvider;
type Flavor = 'google' | 'microsoft';

const ACTION_CAPABILITY: Readonly<Record<string, Capability>> = {
  email_send: 'mail_send',
  calendar_create: 'calendar_write',
  calendar_update: 'calendar_write',
  task_create: 'tasks_write',
};

const PLAN_KEYS: Partial<
  Readonly<Record<Capability, { key: string; feature: 'mail_accounts' | 'calendars' }>>
> = {
  mail_read: { key: 'max_mail_accounts', feature: 'mail_accounts' },
  calendar_read: { key: 'max_calendar_accounts', feature: 'calendars' },
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function localeOf(locale: string): 'tr' | 'en' {
  return locale.toLowerCase().startsWith('en') ? 'en' : 'tr';
}

/** Which adapter set serves a start request (INTEGRATION_PLAN §13.2: demo stands in without credentials). */
export function resolveFlowProvider(
  rt: IntegrationRuntime,
  requested: 'google' | 'microsoft' | 'demo',
): { provider: FlowProvider; flavor: Flavor | null } {
  if (requested === 'demo') {
    rt.providers.resolve('demo');
    return { provider: 'demo', flavor: 'google' };
  }
  try {
    rt.providers.resolve(requested);
    return { provider: requested, flavor: null };
  } catch (error) {
    if (
      isAppError(error) &&
      error.code === 'EXTERNAL_CREDENTIAL_REQUIRED' &&
      rt.providers.available().includes('demo')
    ) {
      return { provider: 'demo', flavor: requested };
    }
    throw error;
  }
}

/** Plan allowance for adding read capabilities (§4.1): `ENTITLEMENT_REQUIRED {feature, limit, current}`. */
export async function assertPlanRoom(
  rt: IntegrationRuntime,
  userId: string,
  capabilities: readonly Capability[],
  exceptAccountId?: string,
): Promise<void> {
  for (const capability of capabilities) {
    const plan = PLAN_KEYS[capability];
    if (plan === undefined) continue;
    const limit = await rt.store.planLimit(userId, plan.key);
    if (limit === null) continue;
    const current = await rt.store.countActiveWithCapability(userId, capability, exceptAccountId);
    if (current >= limit) {
      throw new AppError('ENTITLEMENT_REQUIRED', {
        details: { feature: plan.feature, limit, current },
      });
    }
  }
}

function scopesForFlow(
  oauth: OAuthProvider,
  provider: FlowProvider,
  flavor: Flavor | null,
  caps: readonly Capability[],
): string[] {
  const scopes = oauth.scopesFor(caps, { includeIdentity: true });
  return provider === 'demo' ? [demoFlavorScope(flavor ?? 'google'), ...scopes] : scopes;
}

export interface AuthUrlOptions {
  readonly loginHint: string | null;
  readonly prompt: 'consent' | 'select_account';
  readonly locale: 'tr' | 'en';
}

/** Re-renders the authorization URL of a stored state (API-INT-01/02 idempotent replay). */
export async function authorizationUrl(
  rt: IntegrationRuntime,
  state: OAuthStateRecord,
  opts: AuthUrlOptions,
): Promise<string> {
  const oauth = rt.providers.resolve(state.provider).oauth;
  const keyring = await rt.keyring();
  const verifier = await openStateSecret(keyring, state.id, 'code_verifier', {
    ciphertext: state.code_verifier_ciphertext,
    iv: state.code_verifier_iv,
    keyVersion: state.key_version,
  });
  const url = new URL(
    oauth.buildAuthorizationUrl({
      state: await stateValueFor(rt.config.pepper, state.id),
      codeChallenge: await codeChallengeS256(verifier),
      scopes: [...state.requested_scopes],
      redirectUri: rt.config.redirectUris[state.provider],
      loginHint: opts.loginHint,
      prompt: opts.prompt,
      locale: opts.locale,
    }),
  );
  if (state.provider !== 'demo')
    url.searchParams.set('nonce', await nonceValueFor(rt.config.pepper, state.id));
  return url.toString();
}

async function createState(
  rt: IntegrationRuntime,
  input: {
    userId: string;
    provider: FlowProvider;
    purpose: 'connect' | 'reauth' | 'upgrade';
    accountId: string | null;
    capabilities: readonly Capability[];
    scopes: readonly string[];
    deviceNonceHash: string;
    approvalId: string | null;
  },
): Promise<OAuthStateRecord> {
  const id = crypto.randomUUID();
  const keyring = await rt.keyring();
  const verifier = createCodeVerifier(64);
  const sealed = await sealStateSecret(keyring, id, 'code_verifier', verifier);
  const now = rt.now();
  const state = {
    id,
    user_id: input.userId,
    provider: input.provider,
    purpose: input.purpose,
    connected_account_id: input.accountId,
    requested_capabilities: [...input.capabilities],
    requested_scopes: [...input.scopes],
    code_verifier_iv: sealed.iv,
    code_verifier_ciphertext: sealed.ciphertext,
    key_version: sealed.keyVersion,
    nonce_hash:
      input.provider === 'demo' ? null : await sha256(await nonceValueFor(rt.config.pepper, id)),
    return_to: rt.config.returnTo,
    expires_at: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
    device_nonce_hash: hexToBytes(input.deviceNonceHash),
    approval_id: input.approvalId,
    state_hash: await sha256(await stateValueFor(rt.config.pepper, id)),
  };
  await rt.store.insertState(state);
  return {
    ...state,
    used_at: null,
    completion_code_hash: null,
    token_ciphertext: null,
    token_iv: null,
    result: null,
    error_code: null,
    completed_at: null,
    created_at: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// API-INT-01

export interface StartInput {
  readonly userId: string;
  readonly provider: 'google' | 'microsoft' | 'demo';
  readonly capabilities: readonly ReadCapability[];
  readonly accountId?: string;
  readonly loginHint?: string;
  readonly deviceNonceHash: string;
  readonly locale: string;
}

export interface StartResult {
  readonly state_id: string;
  readonly auth_url: string;
  readonly state_expires_at: string;
  readonly callback_url: 'dijitalasistan://integrations/callback';
  readonly requested_scopes: string[];
}

export interface StartReplay {
  readonly state_id: string;
  readonly login_hint: string | null;
  readonly prompt: 'consent' | 'select_account';
  readonly locale: 'tr' | 'en';
}

export async function startConnect(
  rt: IntegrationRuntime,
  input: StartInput,
): Promise<{ data: StartResult; replay: StartReplay }> {
  const flow = resolveFlowProvider(rt, input.provider);
  const oauth = rt.providers.resolve(flow.provider).oauth;
  let account: AccountRecord | null = null;
  if (input.accountId !== undefined) {
    account = await rt.store.getAccount(input.accountId);
    if (
      account === null ||
      account.user_id !== input.userId ||
      account.provider !== flow.provider
    ) {
      throw new AppError('NOT_FOUND', { details: { resource: 'connected_account' } });
    }
  }
  const capabilities: Capability[] = [...new Set(input.capabilities)];
  const adding =
    account === null || account.status === 'disconnected'
      ? capabilities
      : capabilities.filter((c) => !account.capabilities_granted.includes(c));
  await assertPlanRoom(rt, input.userId, adding, account?.id);

  const flavor = flow.flavor ?? account?.demo_flavor ?? null;
  const scopes = scopesForFlow(oauth, flow.provider, flavor, capabilities);
  const state = await createState(rt, {
    userId: input.userId,
    provider: flow.provider,
    purpose: account === null ? 'connect' : 'reauth',
    accountId: account?.id ?? null,
    capabilities,
    scopes,
    deviceNonceHash: input.deviceNonceHash,
    approvalId: null,
  });
  const replay: StartReplay = {
    state_id: state.id,
    login_hint: input.loginHint ?? account?.account_email ?? null,
    prompt: flow.provider === 'microsoft' && account === null ? 'select_account' : 'consent',
    locale: localeOf(input.locale),
  };
  return { data: await startResultOf(rt, state, replay), replay };
}

export async function startResultOf(
  rt: IntegrationRuntime,
  state: OAuthStateRecord,
  replay: StartReplay,
): Promise<StartResult> {
  return {
    state_id: state.id,
    auth_url: await authorizationUrl(rt, state, {
      loginHint: replay.login_hint,
      prompt: replay.prompt,
      locale: replay.locale,
    }),
    state_expires_at: state.expires_at,
    callback_url: 'dijitalasistan://integrations/callback',
    requested_scopes: [...state.requested_scopes],
  };
}

// ---------------------------------------------------------------------------------------------
// API-INT-02

export interface UpgradeInput {
  readonly userId: string;
  readonly accountId: string;
  readonly capability: Capability;
  readonly resumeApprovalId?: string;
  readonly deviceNonceHash: string;
  readonly locale: string;
}

export type UpgradeResult =
  | { already_granted: true }
  | {
      already_granted: false;
      state_id: string;
      auth_url: string;
      state_expires_at: string;
      missing_scopes: string[];
    };

export async function startUpgrade(
  rt: IntegrationRuntime,
  input: UpgradeInput,
): Promise<{ data: UpgradeResult; replay: StartReplay | null; missingScopes: string[] }> {
  const account = await rt.store.getAccount(input.accountId);
  if (account === null || account.user_id !== input.userId) {
    throw new AppError('NOT_FOUND', { details: { resource: 'connected_account' } });
  }
  if (
    account.status === 'disconnected' ||
    account.status === 'connecting' ||
    !['google', 'microsoft', 'demo'].includes(account.provider)
  ) {
    throw new AppError('STATE_CONFLICT', { details: { reason: 'account_not_active' } });
  }
  if (input.resumeApprovalId !== undefined) {
    const approval = await rt.store.approvalForResume(input.resumeApprovalId, input.userId);
    if (approval === null) throw new AppError('NOT_FOUND', { details: { resource: 'approval' } });
    if (approval.status !== 'pending' && approval.status !== 'failed') {
      throw new AppError('STATE_CONFLICT', { details: { reason: 'approval_not_resumable' } });
    }
    if (ACTION_CAPABILITY[approval.action_type] !== input.capability) {
      throw fieldError('resume.approval_id', 'capability_mismatch');
    }
  }
  if (account.capabilities_granted.includes(input.capability)) {
    return { data: { already_granted: true }, replay: null, missingScopes: [] };
  }
  const provider = account.provider as FlowProvider;
  const oauth = rt.providers.resolve(provider).oauth;
  await assertPlanRoom(rt, input.userId, [input.capability], account.id);
  const missing = oauth.scopesFor([input.capability], { includeIdentity: false });
  // Google adds only the missing scopes (include_granted_scopes keeps the rest); Microsoft and the
  // demo provider request the union. The identity scopes are always requested so the callback can
  // verify that the same account consented.
  const requestedCaps =
    provider === 'google'
      ? [input.capability]
      : [...new Set([...account.capabilities_granted, input.capability])];
  const scopes = scopesForFlow(oauth, provider, account.demo_flavor, requestedCaps);
  const state = await createState(rt, {
    userId: input.userId,
    provider,
    purpose: 'upgrade',
    accountId: account.id,
    capabilities: [input.capability],
    scopes,
    deviceNonceHash: input.deviceNonceHash,
    approvalId: input.resumeApprovalId ?? null,
  });
  const replay: StartReplay = {
    state_id: state.id,
    login_hint: account.account_email,
    prompt: 'consent',
    locale: localeOf(input.locale),
  };
  const url = await authorizationUrl(rt, state, {
    loginHint: replay.login_hint,
    prompt: replay.prompt,
    locale: replay.locale,
  });
  return {
    data: {
      already_granted: false,
      state_id: state.id,
      auth_url: url,
      state_expires_at: state.expires_at,
      missing_scopes: missing,
    },
    replay,
    missingScopes: missing,
  };
}

// ---------------------------------------------------------------------------------------------
// OAUTH-01 / OAUTH-02 / OAUTH-04

export type CallbackResult =
  'pending_confirmation' | 'denied' | 'error' | 'expired_state' | 'admin_consent_required';
export type CallbackErrorCode =
  | 'token_exchange_failed'
  | 'id_token_invalid'
  | 'no_refresh_token'
  | 'external_credential_required'
  | 'provider_unavailable'
  | 'scope_missing'
  | 'admin_consent_required';

export type CallbackOutcome =
  | { kind: 'invalid_state' }
  | {
      kind: 'redirect';
      location: string;
      result: CallbackResult;
      stateId: string;
      errorCode: CallbackErrorCode | null;
    };

export interface CallbackQuery {
  readonly state?: string;
  readonly code?: string;
  readonly error?: string;
  readonly error_description?: string;
}

const STATE_RE = /^[A-Za-z0-9_-]{43}$/;

function redirectTo(
  rt: IntegrationRuntime,
  state: Pick<OAuthStateRecord, 'id' | 'return_to'>,
  provider: FlowProvider,
  result: CallbackResult,
  extra: { completionCode?: string; errorCode?: CallbackErrorCode | null } = {},
): CallbackOutcome {
  const url = new URL(state.return_to || rt.config.returnTo);
  url.searchParams.set('result', result);
  url.searchParams.set('provider', provider);
  url.searchParams.set('state_id', state.id);
  if (extra.completionCode !== undefined)
    url.searchParams.set('completion_code', extra.completionCode);
  if (extra.errorCode !== undefined && extra.errorCode !== null)
    url.searchParams.set('error_code', extra.errorCode);
  return {
    kind: 'redirect',
    location: url.toString(),
    result,
    stateId: state.id,
    errorCode: extra.errorCode ?? null,
  };
}

function exchangeErrorCode(error: unknown): { result: CallbackResult; code: CallbackErrorCode } {
  if (error instanceof ProviderError) {
    if (error.code === 'consent_admin_required')
      return { result: 'admin_consent_required', code: 'admin_consent_required' };
    if (
      error.code === 'client_credential_invalid' ||
      error.code === 'external_credential_required'
    ) {
      return { result: 'error', code: 'external_credential_required' };
    }
    if (error.code === 'provider_unavailable' || error.code === 'rate_limited')
      return { result: 'error', code: 'provider_unavailable' };
  }
  if (isAppError(error) && error.code === 'EXTERNAL_CREDENTIAL_REQUIRED')
    return { result: 'error', code: 'external_credential_required' };
  return { result: 'error', code: 'token_exchange_failed' };
}

/** Best-effort provider revoke of a token we will not keep (Google / demo; Microsoft has none). */
async function revokeQuietly(
  rt: IntegrationRuntime,
  oauth: OAuthProvider,
  token: string | null,
): Promise<void> {
  if (token === null || token === '') return;
  try {
    await oauth.revoke({ refreshToken: token });
  } catch (error) {
    rt.log.warn('oauth_revoke_failed', {
      provider: oauth.provider,
      code: error instanceof ProviderError ? error.code : 'unknown',
    });
  }
}

interface HeldTokenSet {
  readonly access_token: string;
  readonly access_expires_at: string;
  readonly refresh_token: string | null;
  readonly scope: string;
}

async function credentialWrites(
  keyring: TokenKeyring,
  accountId: string,
  provider: string,
  tokens: HeldTokenSet,
): Promise<CredentialWrite[]> {
  const writes: CredentialWrite[] = [
    {
      kind: 'access',
      token: await encryptToken(keyring, tokens.access_token, {
        account: accountId,
        provider,
        kind: 'access',
      }),
      accessExpiresAt: tokens.access_expires_at,
      scopeSnapshot: tokens.scope,
    },
  ];
  if (tokens.refresh_token !== null) {
    writes.push({
      kind: 'refresh',
      token: await encryptToken(keyring, tokens.refresh_token, {
        account: accountId,
        provider,
        kind: 'refresh',
      }),
      accessExpiresAt: null,
      scopeSnapshot: tokens.scope,
    });
  }
  return writes;
}

async function newCompletionCode(): Promise<{ code: string; hash: Uint8Array }> {
  const code = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { code, hash: await sha256(code) };
}

async function identify(oauth: OAuthProvider, tokens: TokenSet, state: OAuthStateRecord) {
  if (oauth instanceof GoogleOAuth)
    return await oauth.identify(tokens, { expectedNonceHash: state.nonce_hash });
  return await oauth.identify(tokens);
}

/** OAUTH-01/02/04: the provider callback. */
export async function handleCallback(
  rt: IntegrationRuntime,
  provider: FlowProvider,
  query: CallbackQuery,
  correlationId: string,
): Promise<CallbackOutcome> {
  if (query.state === undefined || !STATE_RE.test(query.state)) return { kind: 'invalid_state' };
  const stateHash = await sha256(query.state);
  const state = await rt.store.consumeState(stateHash);
  if (state === null) {
    const known = await rt.store.findStateByHash(stateHash);
    if (known === null) return { kind: 'invalid_state' };
    if (known.used_at !== null) {
      await rt.audit.append({
        actorType: 'system',
        actorId: null,
        action: 'security.oauth_state_replay',
        targetType: 'oauth_state',
        targetId: known.id,
        targetUserId: known.user_id,
        result: 'denied',
        details: { provider: known.provider },
        correlationId,
      });
    }
    return redirectTo(rt, known, known.provider, 'expired_state');
  }
  if (state.provider !== provider) {
    await rt.store.closeFlow(state.id, 'error', 'token_exchange_failed');
    return redirectTo(rt, state, state.provider, 'expired_state');
  }

  const close = async (
    result: CallbackResult,
    code: CallbackErrorCode | null,
    stored: OAuthPreResult = result === 'expired_state' ? 'error' : result,
  ) => {
    await rt.store.closeFlow(state.id, stored, code);
    return redirectTo(rt, state, provider, result, { errorCode: code });
  };

  if (query.error !== undefined) {
    if (provider === 'microsoft') {
      const outcome = microsoftAuthorizeOutcome(query.error, query.error_description);
      if (outcome.result === 'admin_consent_required' && state.connected_account_id !== null) {
        await rt.store.updateAccount(state.connected_account_id, {
          status: 'admin_consent_required',
          status_reason: 'admin_consent_required',
        });
      }
      if (outcome.result === 'admin_consent_required')
        return await close('admin_consent_required', 'admin_consent_required');
      if (outcome.result === 'denied') return await close('denied', null);
      return await close('error', 'token_exchange_failed');
    }
    return await close(
      query.error === 'access_denied' ? 'denied' : 'error',
      query.error === 'access_denied' ? null : 'token_exchange_failed',
    );
  }
  if (query.code === undefined || query.code === '')
    return await close('error', 'token_exchange_failed');

  let adapters;
  try {
    adapters = rt.providers.resolve(provider);
  } catch {
    return await close('error', 'external_credential_required');
  }
  const oauth = adapters.oauth;
  const keyring = await rt.keyring();

  let tokens: TokenSet;
  try {
    const verifier = await openStateSecret(keyring, state.id, 'code_verifier', {
      ciphertext: state.code_verifier_ciphertext,
      iv: state.code_verifier_iv,
      keyVersion: state.key_version,
    });
    tokens = await oauth.exchangeCode({
      code: query.code,
      codeVerifier: verifier,
      redirectUri: rt.config.redirectUris[provider],
    });
  } catch (error) {
    const mapped = exchangeErrorCode(error);
    if (mapped.result === 'admin_consent_required' && state.connected_account_id !== null) {
      await rt.store.updateAccount(state.connected_account_id, {
        status: 'admin_consent_required',
        status_reason: 'admin_consent_required',
      });
    }
    return await close(mapped.result, mapped.code);
  }

  let identity;
  try {
    identity = await identify(oauth, tokens, state);
  } catch (error) {
    await revokeQuietly(rt, oauth, tokens.refreshToken ?? tokens.accessToken);
    const unavailable =
      error instanceof ProviderError &&
      (error.code === 'provider_unavailable' || error.code === 'rate_limited');
    return await close('error', unavailable ? 'provider_unavailable' : 'id_token_invalid');
  }

  const granted = oauth.capabilitiesFromGrantedScope(tokens.grantedScope);
  const requested = state.requested_capabilities;
  const grantedRequested = requested.filter((c) => granted.includes(c));
  const completion = await newCompletionCode();
  const held: HeldTokenSet = {
    access_token: tokens.accessToken,
    access_expires_at: tokens.accessTokenExpiresAt,
    refresh_token: tokens.refreshToken,
    scope: tokens.grantedScope,
  };
  const pending = () =>
    redirectTo(rt, state, provider, 'pending_confirmation', { completionCode: completion.code });
  const storeFailure = async (result: 'account_mismatch' | 'already_linked' | 'plan_limit') => {
    await rt.store.callbackStore(
      state.id,
      {
        result,
        completionCodeHash: completion.hash,
        errorCode: null,
        token: null,
        connectedAccountId: state.connected_account_id,
      },
      null,
      [],
    );
    return pending();
  };

  // Reconnect / upgrade of an existing account, or a connect whose identity the user already has.
  let targetId = state.connected_account_id;
  if (targetId === null) {
    const own = await rt.store.findAccount(state.user_id, provider, identity.providerAccountId);
    if (own !== null) targetId = own.id;
  }

  if (targetId !== null) {
    const target = await rt.store.getAccount(targetId);
    if (target === null || target.user_id !== state.user_id)
      return await close('error', 'token_exchange_failed');
    if (target.provider_account_id !== identity.providerAccountId) {
      // A different identity consented: its token is ours to revoke (it shares no grant with the account).
      await revokeQuietly(rt, oauth, tokens.refreshToken ?? tokens.accessToken);
      return await storeFailure('account_mismatch');
    }
    if (grantedRequested.length === 0) return await close('denied', 'scope_missing');
    if (target.status === 'disconnected' || state.purpose === 'connect') {
      try {
        await assertPlanRoom(
          rt,
          state.user_id,
          grantedRequested.filter(
            (c) => target.status === 'disconnected' || !target.capabilities_granted.includes(c),
          ),
          target.id,
        );
      } catch (error) {
        if (isAppError(error) && error.code === 'ENTITLEMENT_REQUIRED')
          return await storeFailure('plan_limit');
        throw error;
      }
    }
    // The held set shares its grant with the account's working tokens (same identity, same client),
    // so it is never revoked here; unbound, it is simply dropped.
    const sealed = await sealStateSecret(keyring, state.id, 'token_set', JSON.stringify(held));
    await rt.store.callbackStore(
      state.id,
      {
        result: grantedRequested.length < requested.length ? 'partial' : 'success',
        completionCodeHash: completion.hash,
        errorCode: null,
        token: { ciphertext: sealed.ciphertext, iv: sealed.iv, keyVersion: sealed.keyVersion },
        connectedAccountId: target.id,
      },
      null,
      [],
    );
    return pending();
  }

  // A new identity.
  if (grantedRequested.length === 0) {
    await revokeQuietly(rt, oauth, tokens.refreshToken ?? tokens.accessToken);
    return await close('denied', 'scope_missing');
  }
  if (await rt.store.linkedToOtherUser(provider, identity.providerAccountId, state.user_id)) {
    await revokeQuietly(rt, oauth, tokens.refreshToken ?? tokens.accessToken);
    return await storeFailure('already_linked');
  }
  try {
    await assertPlanRoom(rt, state.user_id, grantedRequested);
  } catch (error) {
    if (isAppError(error) && error.code === 'ENTITLEMENT_REQUIRED') {
      await revokeQuietly(rt, oauth, tokens.refreshToken ?? tokens.accessToken);
      return await storeFailure('plan_limit');
    }
    throw error;
  }
  if (tokens.refreshToken === null) {
    await revokeQuietly(rt, oauth, tokens.accessToken);
    return await close('error', 'no_refresh_token');
  }
  const accountId = crypto.randomUUID();
  const demoFlavor: Flavor | null =
    provider === 'demo'
      ? identity.providerAccountId.startsWith('demo-microsoft')
        ? 'microsoft'
        : 'google'
      : null;
  try {
    await rt.store.callbackStore(
      state.id,
      {
        result: grantedRequested.length < requested.length ? 'partial' : 'success',
        completionCodeHash: completion.hash,
        errorCode: null,
        token: null,
        connectedAccountId: accountId,
      },
      {
        id: accountId,
        provider_account_id: identity.providerAccountId,
        account_email: identity.email,
        display_label: identity.displayName,
        tenant_type: identity.tenantType,
        tenant_id: identity.tenantId,
        granted_scopes: tokens.grantedScope.split(/\s+/).filter((s) => s !== ''),
        capabilities_granted: granted,
        demo_flavor: demoFlavor,
        credential_expires_at: null,
      },
      await credentialWrites(keyring, accountId, provider, held),
    );
  } catch (error) {
    if (isAppError(error) && error.code === 'ENTITLEMENT_REQUIRED') {
      await revokeQuietly(rt, oauth, tokens.refreshToken);
      return await storeFailure('plan_limit');
    }
    throw error;
  }
  return pending();
}

// ---------------------------------------------------------------------------------------------
// API-INT-07

export type CompleteResultKind =
  'success' | 'partial' | 'account_mismatch' | 'already_linked' | 'plan_limit';

export interface CompleteResult {
  readonly result: CompleteResultKind;
  readonly account: AccountSummary | null;
  readonly granted: Capability[];
  readonly missing: Capability[];
  readonly resume: { approval_id: string } | null;
  readonly jobs: JobRefData[];
}

export interface CompleteInput {
  readonly userId: string;
  readonly completionCode: string;
  readonly deviceNonce: string;
  readonly correlationId: string;
}

async function rejectCompletion(
  rt: IntegrationRuntime,
  state: OAuthStateRecord | null,
  userId: string,
  reason: string,
  correlationId: string,
): Promise<never> {
  if (state !== null && state.completed_at === null) {
    // A new identity's `connecting` row: revoke its refresh token, then purge it with the flow.
    if (
      state.purpose === 'connect' &&
      state.connected_account_id !== null &&
      state.token_ciphertext === null
    ) {
      const account = await rt.store.getAccount(state.connected_account_id);
      if (
        account !== null &&
        account.status === 'connecting' &&
        account.pending_binding_until !== null
      ) {
        try {
          const refresh = await rt.store.getCredential(account.id, 'refresh');
          if (refresh !== null) {
            const token = await decryptToken(await rt.keyring(), refresh, {
              account: account.id,
              provider: account.provider,
              kind: 'refresh',
            });
            await revokeQuietly(rt, rt.providers.resolve(state.provider).oauth, token);
          }
        } catch (error) {
          rt.log.warn('oauth_reject_revoke_failed', {
            code: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
    }
    await rt.store.closeFlow(state.id, state.result ?? 'error', 'completion_rejected');
  }
  await rt.audit.append({
    actorType: 'user',
    actorId: userId,
    action: 'security.oauth_completion_rejected',
    targetType: 'oauth_state',
    targetId: state?.id ?? null,
    targetUserId: state?.user_id ?? userId,
    result: 'denied',
    details: { reason },
    correlationId,
  });
  throw new AppError('OAUTH_COMPLETION_INVALID');
}

export async function completeOAuth(
  rt: IntegrationRuntime,
  input: CompleteInput,
): Promise<CompleteResult & { accountId: string | null }> {
  const state = await rt.store.findStateByCompletionHash(await sha256(input.completionCode));
  if (state === null)
    return await rejectCompletion(rt, null, input.userId, 'unknown_code', input.correlationId);
  if (state.user_id !== input.userId)
    return await rejectCompletion(rt, state, input.userId, 'other_user', input.correlationId);
  const nonceOk = timingSafeEqual(await sha256(input.deviceNonce), state.device_nonce_hash);
  if (!nonceOk)
    return await rejectCompletion(rt, state, input.userId, 'device_nonce', input.correlationId);
  if (state.used_at === null || state.completed_at !== null) {
    return await rejectCompletion(rt, state, input.userId, 'not_pending', input.correlationId);
  }
  if (rt.now().getTime() >= Date.parse(state.used_at) + COMPLETION_WINDOW_MS) {
    return await rejectCompletion(rt, state, input.userId, 'expired', input.correlationId);
  }

  const requested = [...state.requested_capabilities];
  const pre = state.result;
  if (pre === 'account_mismatch' || pre === 'already_linked' || pre === 'plan_limit') {
    await rt.store.closeFlow(state.id, pre, null);
    const current =
      state.connected_account_id === null
        ? null
        : await rt.store.getAccount(state.connected_account_id);
    return {
      result: pre,
      account:
        current === null || current.status === 'connecting' ? null : await summaryOf(rt, current),
      granted: [],
      missing: requested,
      resume: null,
      jobs: [],
      accountId: null,
    };
  }
  if ((pre !== 'success' && pre !== 'partial') || state.connected_account_id === null) {
    return await rejectCompletion(rt, state, input.userId, 'no_result', input.correlationId);
  }

  const before = await rt.store.getAccount(state.connected_account_id);
  if (before === null)
    return await rejectCompletion(rt, state, input.userId, 'account_missing', input.correlationId);
  const keyring = await rt.keyring();
  const oauth = rt.providers.resolve(state.provider).oauth;
  const isNew =
    before.status === 'connecting' &&
    before.pending_binding_until !== null &&
    state.token_ciphertext === null;

  let capabilities: Capability[];
  let credentials: CredentialWrite[] = [];
  let grantedScopes: string[] | null = null;
  if (isNew) {
    capabilities = [...before.capabilities_granted];
  } else {
    if (state.token_ciphertext === null || state.token_iv === null) {
      return await rejectCompletion(rt, state, input.userId, 'no_token_set', input.correlationId);
    }
    const held = JSON.parse(
      await openStateSecret(keyring, state.id, 'token_set', {
        ciphertext: state.token_ciphertext,
        iv: state.token_iv,
        keyVersion: state.key_version,
      }),
    ) as HeldTokenSet;
    const fromScope = oauth.capabilitiesFromGrantedScope(held.scope);
    // Google's `include_granted_scopes` returns the whole grant; the union keeps capabilities the
    // provider reports only partially (demo codes carry the requested mask).
    capabilities =
      state.provider === 'google' || state.provider === 'microsoft'
        ? fromScope
        : [
            ...new Set([
              ...(before.status === 'disconnected' ? [] : before.capabilities_granted),
              ...fromScope,
            ]),
          ];
    grantedScopes = held.scope.split(/\s+/).filter((s) => s !== '');
    credentials = await credentialWrites(keyring, before.id, before.provider, held);
  }
  const missing = requested.filter((c) => !capabilities.includes(c));
  const status = isNew
    ? pre === 'partial'
      ? 'partial'
      : 'syncing'
    : pre === 'partial' || missing.length > 0
      ? 'partial'
      : before.status === 'syncing'
        ? 'syncing'
        : 'healthy';

  let account: AccountRecord & { paused_by_plan: boolean };
  try {
    account = await rt.store.completeBinding(
      state.id,
      input.userId,
      before.id,
      {
        status,
        capabilities_granted: capabilities,
        granted_scopes: grantedScopes,
        account_email: null,
        display_label: null,
        credential_expires_at: null,
      },
      credentials,
    );
  } catch (error) {
    if (isAppError(error) && error.code === 'ENTITLEMENT_REQUIRED') {
      if (isNew) {
        try {
          const refresh = await rt.store.getCredential(before.id, 'refresh');
          if (refresh !== null) {
            await revokeQuietly(
              rt,
              oauth,
              await decryptToken(keyring, refresh, {
                account: before.id,
                provider: before.provider,
                kind: 'refresh',
              }),
            );
          }
        } catch {
          rt.log.warn('oauth_plan_limit_revoke_failed', { provider: state.provider });
        }
      }
      await rt.store.closeFlow(state.id, 'plan_limit', null);
      return {
        result: 'plan_limit',
        account: null,
        granted: [],
        missing: requested,
        resume: null,
        jobs: [],
        accountId: null,
      };
    }
    if (isAppError(error) && (error.code === 'STATE_CONFLICT' || error.code === 'NOT_FOUND')) {
      return await rejectCompletion(
        rt,
        state,
        input.userId,
        'binding_conflict',
        input.correlationId,
      );
    }
    throw error;
  }

  // First sync of every newly usable read capability (JOB-01; nothing ran before this point).
  const toggles = togglesOf(account);
  const previouslyReadable =
    isNew || before.status === 'disconnected' ? [] : before.capabilities_granted;
  const newRead = READ_CAPABILITIES.filter(
    (c) =>
      account.capabilities_granted.includes(c) &&
      !previouslyReadable.includes(c) &&
      toggles[c] !== false,
  );
  const jobs: JobRefData[] = [];
  for (const cap of newRead) {
    const resource: SyncResourceKind =
      cap === 'mail_read' ? 'mail' : cap === 'calendar_read' ? 'calendar' : 'tasks';
    const folders: ('inbox' | 'sentitems' | undefined)[] =
      resource === 'mail' && account.provider === 'microsoft'
        ? ['inbox', 'sentitems']
        : [undefined];
    for (const folder of folders) {
      const id = await enqueueInitialSync(rt, account, {
        resource,
        phase: 'first_pass',
        origin: state.id,
        correlationId: input.correlationId,
        ...(folder === undefined ? {} : { folder }),
      });
      jobs.push(jobRef(id));
    }
  }
  // A reconnect resumes the incremental syncs it already had.
  if (!isNew && before.status !== 'disconnected') {
    for (const cap of READ_CAPABILITIES) {
      if (
        !account.capabilities_granted.includes(cap) ||
        newRead.includes(cap) ||
        toggles[cap] === false
      )
        continue;
      const resource: SyncResourceKind =
        cap === 'mail_read' ? 'mail' : cap === 'calendar_read' ? 'calendar' : 'tasks';
      jobs.push(
        jobRef(
          await enqueueResourceSync(rt, account, resource, 'reconcile', {
            correlationId: input.correlationId,
          }),
        ),
      );
    }
  }
  if (jobs.length > 0) await rt.poke('integration_connected');

  const action =
    state.purpose === 'upgrade'
      ? 'user.integration.scope_upgraded'
      : isNew
        ? 'user.integration.connected'
        : 'user.integration.reconnected';
  await rt.audit.append({
    actorType: 'user',
    actorId: input.userId,
    action,
    targetType: 'connected_account',
    targetId: account.id,
    targetUserId: input.userId,
    result: 'success',
    details: { provider: account.provider, capabilities: account.capabilities_granted.join(',') },
    correlationId: input.correlationId,
  });

  const { paused_by_plan: pausedByPlan, ...record } = account;
  return {
    result: missing.length > 0 ? 'partial' : 'success',
    account: accountSummary(record, pausedByPlan),
    granted: [...account.capabilities_granted],
    missing,
    resume: state.approval_id === null ? null : { approval_id: state.approval_id },
    jobs,
    accountId: account.id,
  };
}

export { hexToBytes };
