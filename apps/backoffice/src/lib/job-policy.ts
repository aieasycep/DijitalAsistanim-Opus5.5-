/*
 * Admin retry and cancel policy for jobs (BACKOFFICE_PLAN §6.6, M§53, M§127). admin-api and
 * `private.job_admin_policy(type)` are authoritative; this mirror only decides which controls are
 * enabled and which reason a disabled one shows.
 */

/** Periodic jobs: the next scheduled run replaces a manual retry. */
export const PERIODIC_JOB_TYPES: ReadonlySet<string> = new Set([
  'push_receipts',
  'health_check',
  'watch_renewal',
]);
/** Privacy jobs are retried from Data Requests, which resumes them step by step. */
export const DATA_REQUEST_JOB_TYPES: ReadonlySet<string> = new Set([
  'account_deletion',
  'history_deletion',
  'export',
]);

export type RetryBlock = 'status' | 'periodic' | 'data_request' | null;
export type CancelBlock = 'running' | 'status' | null;

export function retryBlock(job: { type: string; status: string }): RetryBlock {
  if (job.status !== 'failed' && job.status !== 'dead_letter') return 'status';
  if (PERIODIC_JOB_TYPES.has(job.type)) return 'periodic';
  if (DATA_REQUEST_JOB_TYPES.has(job.type)) return 'data_request';
  return null;
}

export function cancelBlock(job: { status: string }): CancelBlock {
  if (job.status === 'running') return 'running';
  if (job.status !== 'queued' && job.status !== 'retrying') return 'status';
  return null;
}

/** Bulk retry above 10 jobs is L3 with the typed token `TEKRAR DENE` (§6.6). */
export const BULK_RETRY_TYPED_THRESHOLD = 10;
