import { z } from 'zod';
import { DELETION_STATUS_VALUES, EXPORT_STATUS_VALUES } from '@da/domain';
import { IsoDateTime, Uuid } from '../api/common.ts';
import { PagedSuccess, SensitiveBody, Success, adminListQuery } from './common.ts';

/* ADM-16 · Data requests and ADM-17 · Audit logs (§12.3). No route fakes completion; audit is read-only. */

export const DataRequestKind = z.enum(['export', 'history_deletion', 'account_deletion']);
export const DataRequestsListQuery = adminListQuery({
  sort: ['requested_at', 'completed_at'],
  filters: {
    status: z.union([z.enum(EXPORT_STATUS_VALUES), z.enum(DELETION_STATUS_VALUES)]),
  },
  q: false,
}).extend({ tab: z.enum(['exports', 'history_deletion', 'account_deletion']) });
export const DataRequestRow = z.object({
  id: Uuid,
  kind: DataRequestKind,
  status: z.union([z.enum(EXPORT_STATUS_VALUES), z.enum(DELETION_STATUS_VALUES)]),
  origin: z.enum(['app', 'web_otp', 'admin']),
  requested_at: IsoDateTime,
  completed_at: IsoDateTime.nullable(),
  steps_summary: z.string().nullable(),
  user_ref: z.string(),
});
export const DataRequestsListResponse = PagedSuccess(DataRequestRow);
export const DataRequestParams = z.strictObject({ kind: DataRequestKind, id: Uuid });
export const DataRequestDetailResponse = Success(
  DataRequestRow.extend({
    job: z
      .object({
        id: Uuid,
        status: z.string(),
        progress: z.record(z.string(), z.unknown()).nullable(),
      })
      .nullable(),
    steps: z.array(
      z.object({
        step: z.string(),
        status: z.enum(['pending', 'done', 'warning', 'failed', 'skipped']),
        detail_code: z.string().nullable(),
        at: IsoDateTime.nullable(),
      }),
    ),
  }),
);
export const DataRequestRetryBody = SensitiveBody;
export const DataRequestRetryResponse = Success(z.object({ id: Uuid, job_id: Uuid }));
export const ExportRegenerateParams = z.strictObject({ id: Uuid });
export const ExportRegenerateBody = SensitiveBody;
/** The admin never receives the file, its storage path or a signed URL (strict). */
export const ExportRegenerateResponse = Success(
  z.strictObject({ export_request_id: Uuid, job_id: Uuid }),
);

// ── ADM-17 Audit logs ────────────────────────────────────────────────────────
export const AuditResult = z.enum(['success', 'failure', 'denied']);
export const AuditListQuery = adminListQuery({
  sort: ['ts'],
  filters: {
    actor_id: Uuid,
    actor_role: z.string().max(40),
    action: z.string().max(80),
    target_type: z.string().max(40),
    target_id: z.string().max(80),
    result: AuditResult,
    from: IsoDateTime,
    to: IsoDateTime,
  },
  q: false,
});
export const AuditRow = z.object({
  id: Uuid,
  ts: IsoDateTime,
  actor: z.string(),
  role: z.string().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  reason: z.string().nullable(),
  result: AuditResult,
  correlation_id: z.string().nullable(),
});
export const AuditListResponse = PagedSuccess(AuditRow);
export const AuditVerifyQuery = z
  .strictObject({ from: IsoDateTime, to: IsoDateTime })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: 'to_before_from',
    path: ['to'],
  });
export const AuditVerifyResponse = Success(
  z.object({ verified: z.boolean(), first_broken_id: Uuid.optional() }),
);
/** One audit row; never `ip_hash` or `ua_hash` (strict). */
export const AuditDetailResponse = Success(
  z.strictObject({
    id: Uuid,
    chain_seq: z.int().min(1),
    ts: IsoDateTime,
    actor_type: z.enum(['user', 'admin', 'system']),
    actor: z.string(),
    role: z.string().nullable(),
    action: z.string(),
    target_type: z.string().nullable(),
    target_id: z.string().nullable(),
    target_user: z.string().nullable(),
    reason: z.string().nullable(),
    result: AuditResult,
    correlation_id: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    prev_hash: z.string().nullable(),
    hash: z.string(),
  }),
);
