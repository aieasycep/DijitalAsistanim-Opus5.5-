/**
 * Provider adapter registry (ADR-07, INTEGRATION_PLAN §2.10, IMPLEMENTATION_PLAN T-3.08). Resolves the
 * `MailProvider` / `CalendarProvider` / `TaskProvider` / `OAuthProvider` set of a provider:
 * - `google` / `microsoft` need their OAuth credentials, else `EXTERNAL_CREDENTIAL_REQUIRED` with
 *   the missing key names;
 * - `demo` is available only while demo mode is allowed (`DEMO_MODE`, never in production without
 *   `ALLOW_DEMO_IN_PRODUCTION`);
 * - a provider whose adapters are not registered in this function is `FEATURE_DISABLED`.
 */
import type { ServerProvider, ServerProviderAdapters } from '@da/domain';
import { AppError } from '../errors.ts';
import { type CredentialName, credentialStatus, type RawEnv } from '../env.ts';
import { isDemoEnabled } from './demo/guard.ts';

export type AdapterFactory = () => ServerProviderAdapters;

const PROVIDER_CREDENTIAL: Readonly<Record<Exclude<ServerProvider, 'demo'>, CredentialName>> = {
  google: 'google_oauth',
  microsoft: 'microsoft_oauth',
};

export interface ProviderRegistry {
  /** Providers this function can serve right now (credentials present / demo allowed). */
  available(): ServerProvider[];
  resolve(provider: ServerProvider): ServerProviderAdapters;
}

export function createProviderRegistry(
  factories: Partial<Readonly<Record<ServerProvider, AdapterFactory>>>,
  env: RawEnv,
): ProviderRegistry {
  const cache = new Map<ServerProvider, ServerProviderAdapters>();

  const check = (provider: ServerProvider): void => {
    if (provider === 'demo') {
      if (!isDemoEnabled(env))
        throw new AppError('FEATURE_DISABLED', { details: { reason: 'demo_mode_off' } });
      return;
    }
    const status = credentialStatus(PROVIDER_CREDENTIAL[provider], env);
    if (status.status !== 'configured') {
      throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
        details: { feature: `integrations.${provider}`, credential_keys: [...status.missing] },
      });
    }
  };

  return {
    available() {
      return (Object.keys(factories) as ServerProvider[]).filter((p) => {
        try {
          check(p);
          return true;
        } catch {
          return false;
        }
      });
    },
    resolve(provider) {
      check(provider);
      const cached = cache.get(provider);
      if (cached !== undefined) return cached;
      const factory = factories[provider];
      if (factory === undefined) {
        throw new AppError('FEATURE_DISABLED', {
          details: { reason: 'provider_not_registered', provider },
        });
      }
      const adapters = factory();
      cache.set(provider, adapters);
      return adapters;
    },
  };
}
