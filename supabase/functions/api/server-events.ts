/**
 * API-side emission of the backend analytics events (API_CONTRACTS §17.1): the shared server
 * emitter with the request context (caller, installation, platform, app version), or only the user
 * where a shared core (reply drafts used by the mail, plan and assistant routes) has no request.
 * Emission never fails the request (`_shared/services/analytics/emit.ts`).
 */
import type { AnalyticsProps } from '@da/domain';
import { currentUser } from '../_shared/auth/user.ts';
import type { AppContext } from '../_shared/http/context.ts';
import type { ServerAnalyticsEvent } from '../_shared/services/analytics/emit.ts';
import type { RouteKit } from './deps.ts';

export async function emitServerEvent<N extends ServerAnalyticsEvent>(
  kit: RouteKit,
  c: AppContext,
  name: N,
  props: AnalyticsProps<N>,
): Promise<void> {
  const analytics = kit.deps.serverAnalytics;
  if (analytics === undefined) return;
  const client = c.get('client');
  await analytics.emit(name, props, {
    userId: currentUser(c).userId,
    installationId: c.get('installationId'),
    platform: client.platform,
    appVersion: client.version,
  });
}

export async function emitUserEvent<N extends ServerAnalyticsEvent>(
  kit: RouteKit,
  userId: string,
  name: N,
  props: AnalyticsProps<N>,
): Promise<void> {
  await kit.deps.serverAnalytics?.emit(name, props, { userId });
}
