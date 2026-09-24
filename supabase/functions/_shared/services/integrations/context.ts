/**
 * `ProviderContext` of one connected account (INTEGRATION_PLAN §2.1, §3.4, §3.13): the account ref
 * the adapters see, a single-flight `AccessTokenSource` over the encrypted credentials, the account's
 * provider quota and a content-free logger. A refresh that fails with `invalid_grant` moves the
 * account to `needs_reauth`; a refresh whose granted scope lost a capability moves it to `partial`.
 */
import {
  type Capability,
  type ProviderAccountRef,
  type ProviderContext,
  ProviderError,
  type ServerProvider,
  type ServerProviderAdapters,
} from '@da/domain';
import type { Logger } from '../../logging/logger.ts';
import { createTokenSource } from '../../providers/token-source.ts';
import { recordProviderFailure, togglesOf } from './status.ts';
import type { IntegrationRuntime } from './runtime.ts';
import type { AccountRecord } from './types.ts';

export const SERVER_PROVIDER_SET: ReadonlySet<string> = new Set(['google', 'microsoft', 'demo']);

export function isServerProvider(provider: string): provider is ServerProvider {
  return SERVER_PROVIDER_SET.has(provider);
}

export function accountRef(account: AccountRecord): ProviderAccountRef {
  return {
    connectedAccountId: account.id,
    userId: account.user_id,
    provider: account.provider,
    providerAccountId: account.provider_account_id,
    email: account.account_email,
    tenantId: account.tenant_id,
    tenantType: account.tenant_type,
    capabilitiesGranted: account.capabilities_granted,
    dataSourceToggles: togglesOf(account),
  };
}

export function adaptersFor(
  rt: IntegrationRuntime,
  account: Pick<AccountRecord, 'provider'>,
): ServerProviderAdapters {
  if (!isServerProvider(account.provider)) {
    throw new ProviderError('payload_invalid', null, null, 'device_provider');
  }
  return rt.providers.resolve(account.provider);
}

export interface ContextOptions {
  /** Refresh-lock owner (job id or request id). */
  readonly owner: string;
  readonly correlationId: string;
  readonly log: Logger;
  readonly signal?: AbortSignal;
}

export async function providerContextFor(
  rt: IntegrationRuntime,
  account: AccountRecord,
  opts: ContextOptions,
): Promise<ProviderContext> {
  const adapters = adaptersFor(rt, account);
  const keyring = await rt.keyring();
  const tokens = createTokenSource({
    store: rt.store,
    keyring,
    oauth: adapters.oauth,
    account,
    owner: opts.owner,
    now: rt.now,
    onReauthRequired: async (error) => {
      await recordProviderFailure(rt, account, error, opts.correlationId);
    },
    onGrantedScope: async (grantedScope) => {
      const granted = new Set(adapters.oauth.capabilitiesFromGrantedScope(grantedScope));
      const lost = account.capabilities_granted.filter((c) => !granted.has(c));
      if (lost.length === 0) return;
      const kept: Capability[] = account.capabilities_granted.filter((c) => granted.has(c));
      await rt.store.updateAccount(account.id, {
        capabilities_granted: kept,
        status: 'partial',
        status_reason: 'scope_missing',
      });
      opts.log.warn('integration_scope_lost', { account_id: account.id, lost: lost.join(',') });
    },
  });
  return {
    account: accountRef(account),
    tokens,
    quota: rt.quotaFor(account.id),
    clock: { now: rt.now },
    log: opts.log,
    correlationId: opts.correlationId,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };
}
