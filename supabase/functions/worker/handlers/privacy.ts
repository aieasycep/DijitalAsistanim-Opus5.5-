/**
 * Privacy jobs of the `worker` (IMPLEMENTATION_PLAN T-11.01…T-11.04): JOB-20 `retention`, JOB-21
 * `export`, JOB-22 `history_deletion`, JOB-23 `account_deletion`. Payload schemas accept the
 * documented contract shapes plus the shapes the database enqueues (the retention-change trigger
 * `{mode:'recompute', user_id}`, the daily cron `{}`, admin retries `{request_id}`); the user id is
 * always taken from the request row.
 */
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobDefinition } from '../../_shared/jobs/types.ts';
import {
  type AccountDeletionDeps,
  runAccountDeletionJob,
} from '../../_shared/services/privacy/account-deletion.ts';
import { type ExportJobDeps, runExportJob } from '../../_shared/services/privacy/export.ts';
import { runHistoryDeletionJob } from '../../_shared/services/privacy/history.ts';
import {
  type RetentionJobDeps,
  runRetentionJob,
} from '../../_shared/services/privacy/retention.ts';

const Uuid = z.uuid();

export const ExportJobPayload = z
  .object({
    data_export_request_id: Uuid.optional(),
    request_id: Uuid.optional(),
    user_id: Uuid.optional(),
  })
  .refine((p) => p.data_export_request_id !== undefined || p.request_id !== undefined, {
    message: 'request_id_required',
  });

export const HistoryDeletionJobPayload = z
  .object({
    data_deletion_request_id: Uuid.optional(),
    request_id: Uuid.optional(),
    user_id: Uuid.optional(),
    scope: z.enum(['all_analysis', 'connected_account']).nullable().optional(),
    connected_account_id: Uuid.nullable().optional(),
  })
  .refine((p) => p.data_deletion_request_id !== undefined || p.request_id !== undefined, {
    message: 'request_id_required',
  });

export const AccountDeletionJobPayload = z
  .object({
    data_deletion_request_id: Uuid.optional(),
    request_id: Uuid.optional(),
    user_id: Uuid.optional(),
    source: z.enum(['app', 'web', 'admin']).optional(),
  })
  .refine((p) => p.data_deletion_request_id !== undefined || p.request_id !== undefined, {
    message: 'request_id_required',
  });

export const RetentionJobPayload = z.object({
  mode: z.enum(['sweep', 'recompute']).optional(),
  recompute: z.boolean().optional(),
  user_id: Uuid.nullable().optional(),
  shard: z.int().min(0).max(15).optional(),
  batch_size: z.int().min(1).max(5000).optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
});

export interface PrivacyJobDeps {
  readonly export: ExportJobDeps;
  readonly account: AccountDeletionDeps;
  readonly retention: RetentionJobDeps;
}

export function privacyJobDefinitions(deps: PrivacyJobDeps): JobDefinition<never>[] {
  return [
    defineJob({
      type: 'export',
      payload: ExportJobPayload,
      timeoutMs: 360_000,
      handler: (ctx) => runExportJob(deps.export, ctx),
    }),
    defineJob({
      type: 'history_deletion',
      payload: HistoryDeletionJobPayload,
      timeoutMs: 240_000,
      handler: (ctx) => runHistoryDeletionJob(deps.account, ctx),
    }),
    defineJob({
      type: 'account_deletion',
      payload: AccountDeletionJobPayload,
      timeoutMs: 300_000,
      handler: (ctx) => runAccountDeletionJob(deps.account, ctx),
    }),
    defineJob({
      type: 'retention',
      payload: RetentionJobPayload,
      timeoutMs: 240_000,
      handler: (ctx) => runRetentionJob(deps.retention, ctx),
    }),
  ] as unknown as JobDefinition<never>[];
}
