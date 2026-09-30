/**
 * The `job_type` values the production worker claims (`worker/handlers/index.ts` registers a
 * definition for each; `worker/handlers/health_check.test.ts` asserts the two lists agree). The
 * `cron` health probe measures queue lag over these types only, so a type without a handler can
 * never masquerade as a stalled queue.
 */
import { JOB_TYPE_VALUES, type JobType } from '@da/domain';

/** Types in the enum that no worker definition claims (none since `ai_eval` got its handler). */
export const UNCLAIMED_JOB_TYPES: readonly JobType[] = [];

export const WORKER_JOB_TYPES: readonly JobType[] = JOB_TYPE_VALUES.filter(
  (type) => !UNCLAIMED_JOB_TYPES.includes(type),
);
