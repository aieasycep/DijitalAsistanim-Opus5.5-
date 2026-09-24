/**
 * Integration connect flow (T-8.07, R-07/D-31, M-ON-06, M-SET-11/14):
 *   `POST /integrations/:provider/start` (or `/:accountId/upgrade`) with `device_nonce_hash`
 *   → `WebBrowser.openAuthSessionAsync(auth_url, <scheme>://integrations/callback)`
 *   → the redirect (`result=pending_confirmation&completion_code=…`), received by the auth session
 *     or, when that promise is lost, by `app/integrations/callback`
 *   → `POST /integrations/oauth/complete {completion_code, device_nonce}` → accounts refetch.
 * Both receivers share `completeOAuth`, locked per completion code, so the completion is sent once.
 * Only the completion response turns a row into "Bağlandı" / "Eksik izin"; the SecureStore entry is
 * deleted after every final outcome. A callback without a pending entry on this device never calls
 * `/complete` (the server revokes the unbound account after 10 minutes).
 */
import { isApiError, qk, type ApiClient } from '@da/api-client';
import { parseOAuthCallback, type OAuthCallback } from '@da/domain/deeplinks';
import * as WebBrowser from 'expo-web-browser';

import { getApiClient } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { appLink } from '../../lib/env';
import { track } from '../../lib/events';
import { intentKey } from '../../lib/idempotency';
import { getQueryClient } from '../../lib/query/client';
import {
  clearPendingOAuth,
  newDeviceNonce,
  readPendingOAuth,
  savePendingOAuth,
  type OAuthProvider,
  type PendingOAuth,
  type ReadCapability,
  type ReturnTo,
} from './pending';

export const INTEGRATION_CALLBACK_PATH = 'integrations/callback';

export type CompleteResult =
  'success' | 'partial' | 'account_mismatch' | 'already_linked' | 'plan_limit';

export type ConnectOutcome =
  | {
      readonly kind: 'completed';
      readonly result: CompleteResult;
      readonly accountId: string | null;
      readonly missing: readonly string[];
      readonly resumeApprovalId: string | null;
    }
  | { readonly kind: 'already_granted' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'denied' }
  | {
      readonly kind: 'failed';
      readonly reason: 'error' | 'expired_state';
      readonly code: string | null;
    }
  | { readonly kind: 'admin_consent_required'; readonly adminConsentUrl: string | null }
  /** The server refused the completion (foreign user, wrong nonce, reused or expired code). */
  | { readonly kind: 'rejected' }
  /** No flow was started on this device (or it expired): nothing was sent. */
  | { readonly kind: 'no_pending' }
  /** `/start` or `/upgrade` failed (402 → Pro gate, 503 external credential, offline, …). */
  | { readonly kind: 'start_failed'; readonly error: unknown };

export interface ConnectRequest {
  readonly provider: OAuthProvider;
  readonly capabilities: readonly ReadCapability[];
  readonly returnTo: ReturnTo;
  /** Reconnect of an existing account (re-consent keeps the old tokens until completion). */
  readonly accountId?: string;
  readonly loginHint?: string;
}

export interface UpgradeRequest {
  readonly accountId: string;
  readonly provider: OAuthProvider;
  readonly capability: ReadCapability;
  readonly returnTo: ReturnTo;
}

export interface ConnectDeps {
  readonly api?: ApiClient;
  readonly openAuthSession?: (
    url: string,
    redirect: string,
  ) => Promise<{ readonly type: string; readonly url?: string }>;
}

function queryOf(url: string): Record<string, string> {
  const q = url.indexOf('?');
  if (q === -1) return {};
  const end = url.indexOf('#', q);
  const params = new URLSearchParams(url.slice(q + 1, end === -1 ? undefined : end));
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Parses the redirect URL the auth session returned. */
export function parseCallbackUrl(url: string): OAuthCallback | null {
  return parseOAuthCallback(queryOf(url));
}

function refreshAfterConnect(): void {
  const client = getQueryClient();
  void client.invalidateQueries({ queryKey: qk.integrations.all });
  void client.invalidateQueries({ queryKey: qk.me.bootstrap() });
  void client.invalidateQueries({ queryKey: qk.today.all });
}

const inflight = new Map<string, Promise<ConnectOutcome>>();
let lastPending: PendingOAuth | null = null;

/** The flow the last completion belonged to (for routing the callback screen). */
export function lastCompletedFlow(): PendingOAuth | null {
  return lastPending;
}

async function sendCompletion(code: string, api: ApiClient): Promise<ConnectOutcome> {
  const pending = await readPendingOAuth();
  if (pending === null) {
    await clearPendingOAuth();
    return { kind: 'no_pending' };
  }
  lastPending = pending;
  try {
    const response = await api.call(
      'POST /integrations/oauth/complete',
      { body: { completion_code: code, device_nonce: pending.device_nonce } },
      { idempotencyKey: await intentKey(`oauth_complete:${code}`) },
    );
    await clearPendingOAuth();
    const data = response.data;
    track('account_connected', { provider: pending.provider, result: data.result });
    refreshAfterConnect();
    return {
      kind: 'completed',
      result: data.result,
      accountId: data.account?.id ?? null,
      missing: data.missing,
      resumeApprovalId: data.resume?.approval_id ?? null,
    };
  } catch (error) {
    if (isApiError(error) && (error.kind === 'offline' || error.kind === 'network')) {
      // Kept for a retry while the 10-minute window lasts.
      return { kind: 'start_failed', error };
    }
    await clearPendingOAuth();
    track('account_connected', { provider: pending.provider, result: 'error' });
    return { kind: 'rejected' };
  }
}

/** Sends the completion once per code, whoever received the redirect first. */
export function completeOAuth(
  code: string,
  api: ApiClient = getApiClient(),
): Promise<ConnectOutcome> {
  const existing = inflight.get(code);
  if (existing !== undefined) return existing;
  const run = sendCompletion(code, api);
  inflight.set(code, run);
  return run;
}

/** Handles any callback outcome (pending confirmation → completion; the rest are final). */
export async function handleOAuthCallback(
  callback: OAuthCallback,
  api: ApiClient = getApiClient(),
): Promise<ConnectOutcome> {
  switch (callback.result) {
    case 'pending_confirmation':
      return completeOAuth(callback.completionCode ?? '', api);
    case 'denied':
      await clearPendingOAuth();
      track('account_connected', { provider: callback.provider, result: 'denied' });
      return { kind: 'denied' };
    case 'admin_consent_required':
      await clearPendingOAuth();
      return { kind: 'admin_consent_required', adminConsentUrl: callback.adminConsentUrl };
    case 'expired_state':
      await clearPendingOAuth();
      track('account_connected', { provider: callback.provider, result: 'expired_state' });
      return { kind: 'failed', reason: 'expired_state', code: callback.errorCode };
    default:
      await clearPendingOAuth();
      track('account_connected', { provider: callback.provider, result: 'error' });
      return { kind: 'failed', reason: 'error', code: callback.errorCode };
  }
}

async function runAuthSession(
  authUrl: string,
  pending: PendingOAuth,
  deps: ConnectDeps,
): Promise<ConnectOutcome> {
  await savePendingOAuth(pending);
  const open = deps.openAuthSession ?? WebBrowser.openAuthSessionAsync;
  const session = await open(authUrl, appLink(INTEGRATION_CALLBACK_PATH));
  if (session.type === 'success' && session.url !== undefined) {
    const callback = parseCallbackUrl(session.url);
    if (callback === null) {
      await clearPendingOAuth();
      return { kind: 'failed', reason: 'error', code: null };
    }
    return handleOAuthCallback(callback, deps.api ?? getApiClient());
  }
  // Android may deliver the redirect to the callback route instead; wait for that completion.
  const delivered = [...inflight.values()].at(-1);
  if (delivered !== undefined && lastPending?.state_id === pending.state_id) return delivered;
  await clearPendingOAuth();
  return { kind: 'cancelled' };
}

/** API-INT-01: connects a provider for read capabilities (or re-consents an account). */
export async function startConnect(
  request: ConnectRequest,
  deps: ConnectDeps = {},
): Promise<ConnectOutcome> {
  const api = deps.api ?? getApiClient();
  const { nonce, hash } = await newDeviceNonce();
  for (const capability of request.capabilities) {
    track('integration_connect_started', { provider: request.provider, capability });
  }
  track('account_connect_started', {
    provider: request.provider,
    capabilities: request.capabilities.length,
  });
  let started;
  try {
    started = await api.call('POST /integrations/:provider/start', {
      params: { provider: request.provider },
      body: {
        capabilities: [...request.capabilities],
        device_nonce_hash: hash,
        ...(request.accountId === undefined ? {} : { account_id: request.accountId }),
        ...(request.loginHint === undefined ? {} : { login_hint: request.loginHint }),
      },
    });
  } catch (error) {
    return { kind: 'start_failed', error };
  }
  return runAuthSession(
    started.data.auth_url,
    {
      device_nonce: nonce,
      provider: request.provider,
      capabilities: request.capabilities,
      return_to: request.returnTo,
      ...(request.accountId === undefined ? {} : { account_id: request.accountId }),
      state_id: started.data.state_id,
      started_at: now().toISOString(),
    },
    deps,
  );
}

/** API-INT-02: adds a read capability to an existing account (incremental consent). */
export async function startUpgrade(
  request: UpgradeRequest,
  deps: ConnectDeps = {},
): Promise<ConnectOutcome> {
  const api = deps.api ?? getApiClient();
  const { nonce, hash } = await newDeviceNonce();
  track('integration_connect_started', {
    provider: request.provider,
    capability: request.capability,
  });
  let started;
  try {
    started = await api.call('POST /integrations/:accountId/upgrade', {
      params: { accountId: request.accountId },
      body: { capability: request.capability, device_nonce_hash: hash },
    });
  } catch (error) {
    return { kind: 'start_failed', error };
  }
  if (started.data.already_granted) {
    refreshAfterConnect();
    return { kind: 'already_granted' };
  }
  return runAuthSession(
    started.data.auth_url,
    {
      device_nonce: nonce,
      provider: request.provider,
      capabilities: [request.capability],
      return_to: request.returnTo,
      account_id: request.accountId,
      state_id: started.data.state_id,
      started_at: now().toISOString(),
    },
    deps,
  );
}

/** Where the callback route continues after a completion (M-SET-14). */
export function returnRouteOf(outcome: ConnectOutcome, pending: PendingOAuth | null): string {
  if (outcome.kind === 'completed' && outcome.resumeApprovalId !== null) {
    const approval = `/approvals/${outcome.resumeApprovalId}`;
    if (isScreenAvailable(approval)) return approval;
  }
  if (pending?.return_to === 'onboarding') {
    return pending.capabilities.includes('calendar_read') ? '/connect-calendar' : '/connect-mail';
  }
  if (pending?.return_to === 'error_card') return '/today';
  if (outcome.kind === 'completed' && outcome.accountId !== null) {
    return `/settings/accounts/${outcome.accountId}`;
  }
  return '/settings/accounts';
}
