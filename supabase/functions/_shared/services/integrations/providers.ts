/**
 * Provider adapter factories (ADR-07; INTEGRATION_PLAN §2.10; T-4.02, T-4.06, T-4.10). The registry
 * resolves Google and Microsoft only with their OAuth credentials (`EXTERNAL_CREDENTIAL_REQUIRED`
 * names the missing keys) and the demo set only while demo mode is allowed. Push is optional per
 * provider: without Pub/Sub, calendar-webhook or Graph-webhook configuration the adapters refuse to
 * create watches and the sync engine polls instead.
 */
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { ServerProviderAdapters } from '@da/domain';
import { credentialStatus, type RawEnv } from '../../env.ts';
import type { AdapterHttp } from '../../providers/common.ts';
import { demoAdapters } from '../../providers/demo/index.ts';
import type { DemoStorePort } from '../../providers/demo/writes.ts';
import { GoogleOAuth } from '../../providers/google/auth.ts';
import { GoogleCalendarAdapter } from '../../providers/google/calendar.ts';
import { googleEndpoints } from '../../providers/google/config.ts';
import { GmailAdapter } from '../../providers/google/gmail.ts';
import { GoogleTasksAdapter } from '../../providers/google/tasks.ts';
import { MicrosoftOAuth } from '../../providers/microsoft/auth.ts';
import { GraphCalendarAdapter } from '../../providers/microsoft/calendar.ts';
import { microsoftEndpoints } from '../../providers/microsoft/config.ts';
import { GraphClient } from '../../providers/microsoft/graph.ts';
import { OutlookMailAdapter } from '../../providers/microsoft/mail.ts';
import { GraphSubscriptions } from '../../providers/microsoft/subscriptions.ts';
import { TodoAdapter } from '../../providers/microsoft/tasks.ts';
import { createProviderRegistry, type ProviderRegistry } from '../../providers/registry.ts';
import type { IntegrationConfig } from './runtime.ts';
import type { IntegrationStore } from './types.ts';

export interface ProviderFactoryDeps {
  readonly raw: RawEnv;
  readonly config: IntegrationConfig;
  readonly store: DemoStorePort & Pick<IntegrationStore, 'userTimeZone'>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** Google's OIDC key set (tests inject a local one). */
  readonly googleJwks?: JWTVerifyGetKey;
  readonly sleep?: (ms: number) => Promise<void>;
}

function configured(raw: RawEnv, name: Parameters<typeof credentialStatus>[0]): boolean {
  return credentialStatus(name, raw).status === 'configured';
}

export function googleAdapters(deps: ProviderFactoryDeps): ServerProviderAdapters {
  const raw = deps.raw;
  const endpoints = googleEndpoints(raw);
  const doFetch = deps.fetch ?? fetch;
  const http: AdapterHttp = {
    fetch: doFetch,
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
  };
  const jwks =
    deps.googleJwks ?? createRemoteJWKSet(new URL(endpoints.certs), { cacheMaxAge: 3_600_000 });
  return {
    oauth: new GoogleOAuth({
      clientId: raw.GOOGLE_OAUTH_CLIENT_ID ?? '',
      clientSecret: raw.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      endpoints,
      jwks,
      fetch: doFetch,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    }),
    mail: new GmailAdapter({
      endpoints,
      http,
      pubsubTopic: configured(raw, 'google_pubsub') ? (raw.GOOGLE_PUBSUB_TOPIC ?? null) : null,
    }),
    calendar: new GoogleCalendarAdapter({
      endpoints,
      http,
      webhook: configured(raw, 'google_calendar_webhook')
        ? {
            address: raw.GOOGLE_CALENDAR_WEBHOOK_URL ?? '',
            hmacSecret: raw.WEBHOOK_HMAC_SECRET ?? '',
          }
        : null,
    }),
    tasks: new GoogleTasksAdapter({ endpoints, http }),
  };
}

export function microsoftAdapters(deps: ProviderFactoryDeps): ServerProviderAdapters {
  const raw = deps.raw;
  const endpoints = microsoftEndpoints(raw);
  const doFetch = deps.fetch ?? fetch;
  const graph = new GraphClient({
    base: endpoints.graph,
    http: { fetch: doFetch, ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }) },
  });
  const subscriptions = new GraphSubscriptions(
    graph,
    configured(raw, 'microsoft_graph_webhook')
      ? {
          notificationUrl: raw.MICROSOFT_GRAPH_NOTIFICATION_URL ?? '',
          lifecycleUrl: raw.MICROSOFT_GRAPH_LIFECYCLE_URL ?? '',
        }
      : null,
  );
  return {
    oauth: new MicrosoftOAuth({
      clientId: raw.MICROSOFT_CLIENT_ID ?? '',
      privateKeyPem: raw.MICROSOFT_CERT_PRIVATE_KEY ?? '',
      thumbprintS256: raw.MICROSOFT_CERT_THUMBPRINT_S256 ?? '',
      authorityTenant: raw.MICROSOFT_AUTHORITY_TENANT ?? 'common',
      endpoints,
      fetch: doFetch,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    }),
    mail: new OutlookMailAdapter(graph, subscriptions),
    calendar: new GraphCalendarAdapter(graph, subscriptions),
    tasks: new TodoAdapter(graph),
  };
}

export function integrationProviders(deps: ProviderFactoryDeps): ProviderRegistry {
  return createProviderRegistry(
    {
      google: () => googleAdapters(deps),
      microsoft: () => microsoftAdapters(deps),
      demo: () =>
        demoAdapters(
          { store: deps.store, timeZone: (userId) => deps.store.userTimeZone(userId) },
          {
            apiBaseUrl: deps.config.apiBaseUrl,
            secret: deps.config.pepper,
            ...(deps.now === undefined ? {} : { now: deps.now }),
          },
        ),
    },
    deps.raw,
  );
}
