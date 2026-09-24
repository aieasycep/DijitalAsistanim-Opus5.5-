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
import {
  type TransactionalEmailDeps,
  transactionalEmailJob,
} from '../../_shared/email/transactional.ts';
import { billingSyncJob, type BillingSyncJobDeps } from './billing_sync.ts';
import { referralEvaluateJob, type ReferralEvaluateJobDeps } from './referral_evaluate.ts';

export interface HandlerDeps {
  readonly credentials: CredentialsRepo;
  readonly keyring: () => Promise<TokenKeyring>;
  /** T-7.01 / T-7.03: `billing_sync` (JOB-24) and `referral_evaluate` (JOB-25). */
  readonly business: { billing: BillingSyncJobDeps; referrals: ReferralEvaluateJobDeps };
  /** JOB-31 `transactional_email` (admin invites, support replies, security notices). */
  readonly email?: TransactionalEmailDeps;
}

export function jobDefinitions(deps: HandlerDeps): JobDefinition<never>[] {
  return [
    credentialReencryptJob({
      repo: deps.credentials,
      keyring: deps.keyring,
    }) as unknown as JobDefinition<never>,
    billingSyncJob(deps.business.billing) as unknown as JobDefinition<never>,
    referralEvaluateJob(deps.business.referrals) as unknown as JobDefinition<never>,
    ...(deps.email === undefined
      ? []
      : [transactionalEmailJob(deps.email) as unknown as JobDefinition<never>]),
  ];
}

export function createHandlerRegistry(deps: HandlerDeps): JobRegistry {
  return createRegistry(jobDefinitions(deps));
}
