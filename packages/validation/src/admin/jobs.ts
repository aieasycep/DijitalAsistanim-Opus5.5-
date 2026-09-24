import { z } from 'zod';
import { JOB_STATUS_VALUES, JOB_TYPE_VALUES } from '@da/domain';
import { IsoDateTime, Uuid } from '../api/common.ts';
import {
  MetricsRange,
  PagedSuccess,
  Reason,
  SensitiveBody,
  Success,
  adminListQuery,
} from './common.ts';

/* ADM-05 · Sync and jobs (§12.3). Payloads come back redacted to their id fields. */

export const JobType = z.enum(JOB_TYPE_VALUES);
export const JobStatusEnum = z.enum(JOB_STATUS_VALUES);
export const JobsListQuery = adminListQuery({
  sort: ['created_at', 'run_after', 'attempts'],
  filters: {
    type: JobType,
    status: JobStatusEnum,
    user_id: Uuid,
    account_id: Uuid,
    from: IsoDateTime,
    to: IsoDateTime,
  },
});
export const JobRow = z.object({
  id: Uuid,
  type: JobType,
  status: JobStatusEnum,
  attempts: z.int().min(0),
  max_attempts: z.int().min(1),
  last_error_code: z.string().nullable(),
  run_after: IsoDateTime,
  created_at: IsoDateTime,
  correlation_id: z.string().nullable(),
  user_id: Uuid.nullable(),
});
export const JobsListResponse = PagedSuccess(JobRow);

export const JobsStatsQuery = z.strictObject({ range: MetricsRange.default('24h') });
export const JobsStatsResponse = Success(
  z.object({
    by_type_status: z.array(
      z.object({ type: JobType, status: JobStatusEnum, count: z.int().min(0) }),
    ),
    dead_letter: z.int().min(0),
  }),
);

/** Job payloads are redacted to id fields: values are uuids, enums or numbers only. */
export const RedactedPayload = z.record(
  z.string(),
  z.union([z.string().max(80), z.number(), z.boolean(), z.null()]),
);
export const JobDetailResponse = Success(
  JobRow.extend({
    payload: RedactedPayload,
    attempts_history: z.array(
      z.object({
        attempt: z.int().min(1),
        outcome: z.enum(['completed', 'retrying', 'failed', 'dead_letter', 'running']),
        error_code: z.string().nullable(),
        duration_ms: z.int().min(0).nullable(),
        started_at: IsoDateTime,
      }),
    ),
    children: z.array(z.object({ id: Uuid, type: JobType, status: JobStatusEnum })),
  }),
);

export const CorrelationParams = z.strictObject({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) });
export const CorrelationTraceResponse = Success(
  z
    .array(
      z.object({
        kind: z.enum([
          'webhook',
          'billing_event',
          'job',
          'job_attempt',
          'ai_request',
          'briefing',
          'notification',
          'push_ticket',
          'approval',
          'audit',
        ]),
        id: z.string(),
        ts: IsoDateTime,
        status: z.string().nullable(),
        label_key: z.string(),
        link: z.string().nullable(),
      }),
    )
    .max(500),
);

export const JobRetryBody = z.strictObject({
  reason: Reason,
  confirm: z.literal(true),
  reset_attempts: z.boolean(),
});
export const JobCancelBody = SensitiveBody;
export const JobMutationResponse = Success(z.object({ id: Uuid, status: JobStatusEnum }));
export const JobsBulkRetryBody = z
  .strictObject({
    filter: z.strictObject({
      type: JobType,
      status: z.enum(['dead_letter', 'failed']),
      from: IsoDateTime,
      to: IsoDateTime,
    }),
    max: z.int().min(1).max(500),
    reason: Reason,
    confirm: z.literal(true),
  })
  .refine((b) => Date.parse(b.filter.to) > Date.parse(b.filter.from), {
    message: 'to_before_from',
    path: ['filter', 'to'],
  });
export const JobsBulkRetryResponse = Success(z.object({ retried: z.int().min(0) }));
