/**
 * `AccessTokenSource` with single-flight refresh (INTEGRATION_PLAN §3.4):
 * 1. a stored access token valid for more than 5 minutes is decrypted and returned;
 * 2. otherwise `try_lock_credential_refresh` (30 s) elects one refresher; the others poll the access
 *    row 4 × 500 ms and give up with `provider_unavailable` (the job retries);
 * 3. the refresher calls `OAuthProvider.refresh`, persists the new access token and — when the
 *    provider rotated it (Microsoft, every use) — the new refresh token, then releases the lock;
 * 4. `invalid_grant` (Google) / AADSTS invalid-grant codes → `onReauthRequired` (status
 *    `needs_reauth`) and the error is rethrown so the caller stops.
 * Plaintext tokens live only in this closure; nothing is logged.
 */
import {
  type AccessTokenSource,
  type OAuthProvider,
  ProviderError,
  type TokenSet,
} from '@da/domain';
import { decryptToken, encryptToken, type TokenKeyring } from '../crypto/token-cipher.ts';
import type { AccountRecord, IntegrationStore } from '../services/integrations/types.ts';

export type CredentialPort = Pick<
  IntegrationStore,
  'getCredential' | 'saveCredential' | 'tryLockRefresh' | 'releaseRefreshLock'
>;

export interface TokenSourceDeps {
  readonly store: CredentialPort;
  readonly keyring: TokenKeyring;
  readonly oauth: OAuthProvider;
  readonly account: AccountRecord;
  /** Lock owner (job id or request id). */
  readonly owner: string;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onReauthRequired?: (error: ProviderError) => Promise<void>;
  /** The scope string of every refresh (scope re-check, §3.13). */
  readonly onGrantedScope?: (grantedScope: string) => Promise<void>;
}

const FRESH_MS = 5 * 60_000;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function binding(account: AccountRecord, kind: 'access' | 'refresh') {
  return { account: account.id, provider: account.provider, kind } as const;
}

export function createTokenSource(deps: TokenSourceDeps): AccessTokenSource {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  let cached: { token: string; expiresAt: number } | null = null;

  const readAccess = async (): Promise<{ token: string; expiresAt: number } | null> => {
    const row = await deps.store.getCredential(deps.account.id, 'access');
    if (row === null || row.access_expires_at === null) return null;
    const expiresAt = Date.parse(row.access_expires_at);
    if (!(expiresAt - now().getTime() > FRESH_MS)) return null;
    return {
      token: await decryptToken(deps.keyring, row, binding(deps.account, 'access')),
      expiresAt,
    };
  };

  const persist = async (tokens: TokenSet): Promise<void> => {
    await deps.store.saveCredential(deps.account, {
      kind: 'access',
      token: await encryptToken(deps.keyring, tokens.accessToken, binding(deps.account, 'access')),
      accessExpiresAt: tokens.accessTokenExpiresAt,
      scopeSnapshot: tokens.grantedScope,
    });
    if (tokens.refreshToken !== null) {
      await deps.store.saveCredential(deps.account, {
        kind: 'refresh',
        token: await encryptToken(
          deps.keyring,
          tokens.refreshToken,
          binding(deps.account, 'refresh'),
        ),
        accessExpiresAt: null,
        scopeSnapshot: tokens.grantedScope,
      });
    }
  };

  const refresh = async (): Promise<{ token: string; expiresAt: number }> => {
    const acquired = await deps.store.tryLockRefresh(deps.account.id, deps.owner, 30);
    if (!acquired) {
      for (let i = 0; i < 4; i++) {
        await sleep(500);
        const fresh = await readAccess();
        if (fresh !== null) return fresh;
      }
      throw new ProviderError('provider_unavailable', null, 5_000, 'refresh_in_progress');
    }
    try {
      const row = await deps.store.getCredential(deps.account.id, 'refresh');
      if (row === null)
        throw new ProviderError('auth_invalid_grant', null, null, 'refresh_token_missing');
      const refreshToken = await decryptToken(deps.keyring, row, binding(deps.account, 'refresh'));
      let tokens: TokenSet;
      try {
        tokens = await deps.oauth.refresh({ refreshToken, tenantId: deps.account.tenant_id });
      } catch (error) {
        if (
          error instanceof ProviderError &&
          (error.code === 'auth_invalid_grant' || error.code === 'consent_admin_required')
        ) {
          await deps.onReauthRequired?.(error);
        }
        throw error;
      }
      await persist(tokens);
      if (tokens.grantedScope !== '') await deps.onGrantedScope?.(tokens.grantedScope);
      return { token: tokens.accessToken, expiresAt: Date.parse(tokens.accessTokenExpiresAt) };
    } finally {
      await deps.store.releaseRefreshLock(deps.account.id, deps.owner);
    }
  };

  return {
    async get(opts) {
      if (opts?.forceRefresh !== true) {
        if (cached !== null && cached.expiresAt - now().getTime() > FRESH_MS) return cached.token;
        const stored = await readAccess();
        if (stored !== null) {
          cached = stored;
          return stored.token;
        }
      }
      cached = await refresh();
      return cached.token;
    },
  };
}
