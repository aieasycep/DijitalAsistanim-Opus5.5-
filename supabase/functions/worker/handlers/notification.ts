/** JOB-18 `notification` handler definition (IMPLEMENTATION_PLAN T-6.07, T-6.08). */
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobDefinition } from '../../_shared/jobs/types.ts';
import { NotificationJobPayload } from '../../_shared/services/notifications/create.ts';
import {
  type NotificationPipelineDeps,
  processNotification,
} from '../../_shared/services/notifications/pipeline.ts';

export function notificationJob(
  deps: NotificationPipelineDeps,
): JobDefinition<NotificationJobPayload> {
  return defineJob({
    type: 'notification',
    payload: NotificationJobPayload,
    handler: (ctx) => processNotification(deps, ctx),
  });
}
