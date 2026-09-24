/**
 * Runtime of the integration services (INTEGRATION_PLAN §3; IMPLEMENTATION_PLAN T-4.01…T-4.13): the
 * storage port, the provider registry, the token keyring, quota, the job queue and the audit
 * writer, plus the URLs and secrets the OAuth flow needs. `api`, `oauth`, `worker` and the webhook
 * functions build one from their env (`createIntegrationRuntime`); tests build one from in-memory
 * parts.
 */
import type { QuotaGate, ServerProvider } from '@da/domain';
import type { TokenKeyring } from '../../crypto/token-cipher.ts';
import type { RawEnv } from '../../env.ts';
import type { EnqueueInput } from '../../jobs/types.ts';
import type { Logger } from '../../logging/logger.ts';
import type { ProviderRegistry } from '../../providers/registry.ts';
import type { AuditWriter } from '../audit.ts';
import type { IntegrationStore } from './types.ts';

/** The app callback every OAuth flow returns to (API-INT-01 `callback_url`). */
export const APP_OAUTH_CALLBACK = 'dijitalasistan://integrations/callback';
const DEFAULT_MAIL_DOMAIN = 'mail.dijitalasistan.app';
const DEFAULT_WEB_URL = 'https://dijitalasistan.app';

export interface IntegrationConfig {
  /** `API_PUBLIC_BASE_URL` (falls back to `SUPABASE_URL`), without a trailing slash. */
  readonly apiBaseUrl: string;
  /** `OAUTH_RESULT_REDIRECT_URI` (default `dijitalasistan://integrations/callback`). */
  readonly returnTo: string;
  /** Provider redirect URIs registered at Google / Entra (and the demo callback). */
  readonly redirectUris: Readonly<Record<ServerProvider, string>>;
  /** `HASH_PEPPER`: derives the flow's `state` / `nonce` and signs demo codes. */
  readonly pepper: string;
  /** Marker inputs of provider writes (INTEGRATION_PLAN §2.3). */
  readonly mailDomain: string;
  readonly webUrl: string;
  /** `CRON_SECRET`: worker pokes after latency-sensitive enqueues. */
  readonly cronSecret: string | undefined;
}

export function integrationConfig(raw: RawEnv): IntegrationConfig {
  const trim = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');
  const apiBaseUrl = trim(raw.API_PUBLIC_BASE_URL) || trim(raw.SUPABASE_URL);
  const fn = (path: string) => `${apiBaseUrl}/functions/v1/${path}`;
  return {
    apiBaseUrl,
    returnTo: trim(raw.OAUTH_RESULT_REDIRECT_URI) || APP_OAUTH_CALLBACK,
    redirectUris: {
      google: trim(raw.GOOGLE_OAUTH_REDIRECT_URI) || fn('oauth/google/callback'),
      microsoft: trim(raw.MICROSOFT_OAUTH_REDIRECT_URI) || fn('oauth/microsoft/callback'),
      demo: fn('oauth/demo/callback'),
    },
    pepper: raw.HASH_PEPPER ?? '',
    mailDomain: trim(raw.MAIL_MESSAGE_ID_DOMAIN) || DEFAULT_MAIL_DOMAIN,
    webUrl: trim(raw.PUBLIC_WEB_URL) || DEFAULT_WEB_URL,
    cronSecret: raw.CRON_SECRET,
  };
}

export interface IntegrationRuntime {
  readonly store: IntegrationStore;
  readonly providers: ProviderRegistry;
  readonly keyring: () => Promise<TokenKeyring>;
  /** Provider quota of one account (`private.consume_provider_quota`). */
  readonly quotaFor: (accountId: string) => QuotaGate;
  readonly enqueue: (input: EnqueueInput) => Promise<string>;
  /** Best-effort immediate worker run (the 15 s cron poke is the backstop). */
  readonly poke: (reason: string) => Promise<void>;
  readonly audit: AuditWriter;
  readonly log: Logger;
  readonly config: IntegrationConfig;
  readonly now: () => Date;
}
