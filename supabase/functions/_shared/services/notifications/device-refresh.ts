/**
 * JOB-18 `notification` with `payload.kind = 'device_refresh'` (KNOWN_PLATFORM_LIMITATIONS KPL-11,
 * KPL-12; the `briefing` job enqueues it, `services/briefings/device-refresh.ts`). One data-only
 * background push to one installation asks the app to upload its device-calendar snapshot before
 * a briefing is generated:
 * - `_contentAvailable: true`, `priority: 'normal'`, no title, body or sound: nothing is shown, so
 *   no `notifications` ledger row is written and quiet hours and caps do not apply (there is no
 *   ticket row either: `push_tickets.notification_id` belongs to the ledger);
 * - the data keeps the `{type, entity_id, deeplink}` shape (`type: 'device_refresh'`, deep link to
 *   Today) and carries nothing else;
 * - `DeviceNotRegistered` disables the token like any other send; a missing `EXPO_ACCESS_TOKEN`
 *   skips the push (the briefing is generated anyway).
 */
import { routes, toDeepLink } from '@da/domain';
import type { JobResult } from '../../jobs/types.ts';
import { DEVICE_REFRESH_TTL_S } from '../briefings/device-refresh.ts';
import type { ExpoBackgroundMessage } from './expo-push.ts';
import type { NotificationPipelineDeps } from './pipeline.ts';

export const DEVICE_REFRESH_TYPE = 'device_refresh';

export function deviceRefreshMessage(to: string): ExpoBackgroundMessage {
  return {
    to,
    data: { type: DEVICE_REFRESH_TYPE, entity_id: null, deeplink: toDeepLink(routes.today()) },
    _contentAvailable: true,
    priority: 'normal',
    ttl: DEVICE_REFRESH_TTL_S,
  };
}

export async function sendDeviceRefresh(
  deps: NotificationPipelineDeps,
  userId: string,
  installationRowId: string,
  now: Date,
): Promise<JobResult> {
  if (deps.expo === null) return { skipped: 'external_credential_required' };
  const targets = await deps.repo.activeTargets(userId, installationRowId, now);
  if (targets.length === 0) return { skipped: 'no_active_device' };
  const tickets = await deps.expo.send(targets.map((t) => deviceRefreshMessage(t.token)));
  let disabled = 0;
  for (const [i, ticket] of tickets.entries()) {
    const target = targets[i];
    if (
      ticket.status === 'error' &&
      ticket.error === 'DeviceNotRegistered' &&
      target !== undefined
    ) {
      await deps.repo.disableToken(target.tokenId, 'device_not_registered');
      disabled++;
    }
  }
  return {
    device_refresh: true,
    tickets: tickets.length,
    accepted: tickets.filter((t) => t.status === 'ok').length,
    tokens_disabled: disabled,
  };
}
