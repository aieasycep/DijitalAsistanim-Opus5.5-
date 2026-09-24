import { z } from 'zod';
import {
  BRIEFING_KIND_VALUES,
  BRIEFING_STATUS_VALUES,
  NOTIFICATION_CATEGORY_VALUES,
  NOTIFICATION_DECISION_VALUES,
  NOTIFICATION_DETAIL_VALUES,
} from '@da/domain';
import { IsoDateTime, JobRef, LocalDate, Uuid } from '../api/common.ts';
import {
  MetricsRange,
  PagedSuccess,
  Reason,
  SensitiveBody,
  Success,
  adminListQuery,
} from './common.ts';

/* ADM-06 · Briefings and ADM-07 · Notifications (§12.3): no narrative or rendered text in any row. */

export const BriefingsMetricsQuery = z.strictObject({
  range: MetricsRange.default('7d'),
  kind: z.enum(BRIEFING_KIND_VALUES).optional(),
});
export const BriefingsMetricsResponse = Success(
  z.object({
    scheduled: z.int().min(0),
    generated: z.int().min(0),
    delivered: z.int().min(0),
    failed: z.int().min(0),
    skipped: z.int().min(0),
    p50_latency_ms: z.int().min(0).nullable(),
    p95_latency_ms: z.int().min(0).nullable(),
    ai_cost_usd: z.number().min(0),
    template_fallback_rate: z.number().min(0).max(1),
  }),
);
export const BriefingsListQuery = adminListQuery({
  sort: ['local_date', 'generated_at'],
  filters: {
    user_id: Uuid,
    kind: z.enum(BRIEFING_KIND_VALUES),
    status: z.enum(BRIEFING_STATUS_VALUES),
    local_date: LocalDate,
  },
  q: false,
});
export const AdminBriefingRow = z.strictObject({
  id: Uuid,
  user_id: Uuid,
  kind: z.enum(BRIEFING_KIND_VALUES),
  local_date: LocalDate,
  status: z.enum(BRIEFING_STATUS_VALUES),
  generated_at: IsoDateTime.nullable(),
  delivered_at: IsoDateTime.nullable(),
  latency_ms: z.int().min(0).nullable(),
  narrative_mode: z.enum(['llm', 'template']).nullable(),
});
export const BriefingsListResponse = PagedSuccess(AdminBriefingRow);
export const BriefingRegenerateBody = SensitiveBody;
export const BriefingRegenerateResponse = Success(z.object({ briefing_id: Uuid, job: JobRef }));

export const NotificationsMetricsQuery = z.strictObject({
  range: MetricsRange.default('7d'),
  category: z.enum(NOTIFICATION_CATEGORY_VALUES).optional(),
});
export const NotificationsMetricsResponse = Success(
  z.object({
    scheduled: z.int().min(0),
    sent: z.int().min(0),
    failed: z.int().min(0),
    suppressed: z.int().min(0),
    deduplicated: z.int().min(0),
    suppression_reasons: z.record(z.string(), z.int().min(0)),
    receipt_errors: z.record(z.string(), z.int().min(0)),
  }),
);
export const NotificationsListQuery = adminListQuery({
  sort: ['sent_at'],
  filters: {
    user_id: Uuid,
    category: z.enum(NOTIFICATION_CATEGORY_VALUES),
    decision: z.enum(NOTIFICATION_DECISION_VALUES),
  },
  q: false,
});
/** Category, decision and reason only; never rendered text. */
export const AdminNotificationRow = z.strictObject({
  id: Uuid,
  category: z.enum(NOTIFICATION_CATEGORY_VALUES),
  decision: z.enum(NOTIFICATION_DECISION_VALUES),
  decision_reason: z.string().nullable(),
  detail_mode: z.enum(NOTIFICATION_DETAIL_VALUES),
  sent_at: IsoDateTime.nullable(),
  receipt_status: z.string().nullable(),
});
export const NotificationsListResponse = PagedSuccess(AdminNotificationRow);
/** Generic "Dijital Asistan" / "Test bildirimi"; bypasses caps but never quiet hours (R-13). */
export const AdminTestPushBody = z.strictObject({
  user_id: Uuid,
  installation_id: Uuid.optional(),
  reason: Reason,
  confirm: z.literal(true),
});
export const AdminTestPushResponse = Success(
  z.object({ notification_id: Uuid, job: JobRef, deferred_until: IsoDateTime.nullable() }),
);
