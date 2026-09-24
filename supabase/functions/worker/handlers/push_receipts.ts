/** JOB-19 `push_receipts` handler definition (IMPLEMENTATION_PLAN T-6.07). */
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobDefinition } from '../../_shared/jobs/types.ts';
import type { ExpoPushClient } from '../../_shared/services/notifications/expo-push.ts';
import type { NotificationsRepo } from '../../_shared/services/notifications/model.ts';
import {
  processPushReceipts,
  PushReceiptsPayload,
} from '../../_shared/services/notifications/receipts.ts';

export function pushReceiptsJob(deps: {
  readonly repo: NotificationsRepo;
  readonly expo: ExpoPushClient | null;
}): JobDefinition<PushReceiptsPayload> {
  return defineJob({
    type: 'push_receipts',
    payload: PushReceiptsPayload,
    handler: (ctx) => processPushReceipts(deps, ctx),
  });
}
