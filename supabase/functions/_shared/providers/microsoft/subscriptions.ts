/**
 * Graph change-notification subscriptions (INTEGRATION_PLAN §5.4, §5.5; API_CONTRACTS JOB-07, WH-03/04;
 * T-4.09): created with `created,updated,deleted`, the `notifications` + `lifecycle` URLs, a random
 * 64-character `clientState` (only its sha256 is stored) and TLS 1.2; renewed with `PATCH
 * expirationDateTime` when < 48 h remain; `reauthorize` on `reauthorizationRequired`; deleted on
 * disconnect or deselect (404 counts as gone). Subscriptions are never listed (state is ours).
 */
import { type ProviderContext, ProviderError, type WatchHandle } from '@da/domain';
import { toBase64Url } from '../../crypto/encoding.ts';
import { sha256Hex } from '../../crypto/hmac.ts';
import { GRAPH_SUBSCRIPTION_MINUTES } from './config.ts';
import type { GraphClient } from './graph.ts';

export interface GraphWebhookConfig {
  readonly notificationUrl: string;
  readonly lifecycleUrl: string;
}

/** 64 URL-safe random characters (48 random bytes). */
export function newClientState(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(48)));
}

export class GraphSubscriptions {
  constructor(
    private readonly graph: GraphClient,
    private readonly webhook: GraphWebhookConfig | null,
  ) {}

  private expiry(ctx: ProviderContext): string {
    return new Date(ctx.clock.now().getTime() + GRAPH_SUBSCRIPTION_MINUTES * 60_000).toISOString();
  }

  async create(
    ctx: ProviderContext,
    input: { resource: string; handleResource: string; resourceKey: string },
  ): Promise<WatchHandle> {
    if (this.webhook === null) {
      throw new ProviderError(
        'external_credential_required',
        null,
        null,
        'graph_webhook_not_configured',
      );
    }
    const clientState = newClientState();
    const created = await this.graph.json<{ id: string; expirationDateTime?: string }>(
      ctx,
      '/subscriptions',
      {
        method: 'POST',
        priority: 'interactive',
        body: {
          changeType: 'created,updated,deleted',
          notificationUrl: this.webhook.notificationUrl,
          lifecycleNotificationUrl: this.webhook.lifecycleUrl,
          resource: input.resource,
          expirationDateTime: this.expiry(ctx),
          clientState,
          latestSupportedTlsVersion: 'v1_2',
        },
      },
    );
    return {
      resource: input.handleResource,
      resourceKey: input.resourceKey,
      watchId: created.id,
      providerResourceId: input.resource,
      expiresAt: created.expirationDateTime ?? this.expiry(ctx),
      tokenHash: await sha256Hex(clientState),
    };
  }

  async renew(ctx: ProviderContext, handle: WatchHandle): Promise<WatchHandle> {
    const renewed = await this.graph.json<{ expirationDateTime?: string }>(
      ctx,
      `/subscriptions/${encodeURIComponent(handle.watchId)}`,
      {
        method: 'PATCH',
        priority: 'interactive',
        idempotent: true,
        body: { expirationDateTime: this.expiry(ctx) },
      },
    );
    return { ...handle, expiresAt: renewed.expirationDateTime ?? this.expiry(ctx) };
  }

  async reauthorize(ctx: ProviderContext, handle: WatchHandle): Promise<void> {
    await this.graph.json(ctx, `/subscriptions/${encodeURIComponent(handle.watchId)}/reauthorize`, {
      method: 'POST',
      priority: 'interactive',
      idempotent: true,
    });
  }

  async remove(ctx: ProviderContext, handle: WatchHandle): Promise<void> {
    try {
      await this.graph.json(ctx, `/subscriptions/${encodeURIComponent(handle.watchId)}`, {
        method: 'DELETE',
        priority: 'interactive',
      });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'not_found') return;
      throw error;
    }
  }
}
