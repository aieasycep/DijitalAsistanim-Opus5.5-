/**
 * Job handler registry of the `worker` function (IMPLEMENTATION_PLAN T-3.06). Each later task adds
 * its `defineJob(...)` definitions here; job types without a handler are never claimed.
 */
import { createRegistry, type JobRegistry } from '../../_shared/jobs/registry.ts';
import type { JobDefinition } from '../../_shared/jobs/types.ts';
import type { TokenKeyring } from '../../_shared/crypto/token-cipher.ts';
import {
  credentialReencryptJob,
  type CredentialsRepo,
} from '../../_shared/services/credentials.ts';
import { type ApprovalExecuteDeps, approvalExecuteJob } from './approval_execute.ts';
import { notificationJob } from './notification.ts';
import { pushReceiptsJob } from './push_receipts.ts';
import type { NotificationPipelineDeps } from '../../_shared/services/notifications/pipeline.ts';

export interface HandlerDeps {
  readonly credentials: CredentialsRepo;
  readonly keyring: () => Promise<TokenKeyring>;
  /** `notification` + `push_receipts` (T-6.07/T-6.08). */
  readonly notifications?: NotificationPipelineDeps;
  /** `approval_execute` (T-6.02…T-6.04). */
  readonly approvals?: ApprovalExecuteDeps;
}

export function jobDefinitions(deps: HandlerDeps): JobDefinition<never>[] {
  return [
    credentialReencryptJob({
      repo: deps.credentials,
      keyring: deps.keyring,
    }) as unknown as JobDefinition<never>,
    ...(deps.notifications === undefined
      ? []
      : [
          notificationJob(deps.notifications) as unknown as JobDefinition<never>,
          pushReceiptsJob(deps.notifications) as unknown as JobDefinition<never>,
        ]),
    ...(deps.approvals === undefined
      ? []
      : [approvalExecuteJob(deps.approvals) as unknown as JobDefinition<never>]),
  ];
}

export function createHandlerRegistry(deps: HandlerDeps): JobRegistry {
  return createRegistry(jobDefinitions(deps));
}
