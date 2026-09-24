/**
 * An `ApprovalView` for an approval opened by id (deep link, push, plan timeline) when the
 * proposing call's response is not in memory: the owner's `approval_actions` row (RLS) mapped to
 * the card contract. The proposing screens seed `['approvals', id]` with the server's view, which
 * wins when present.
 */
import { qk } from '@da/api-client';
import type { ApprovalView } from '@da/validation/api/approvals';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { unwrap } from '../../lib/data/rpc';

const ExactChange = z.object({
  kind: z.enum(['send', 'create', 'update']),
  fields: z.array(
    z.object({ field: z.string(), before: z.string().nullable(), after: z.string().nullable() }),
  ),
});
const SideEffects = z.array(z.object({ code: z.string(), text: z.string() }));
const Time = z.looseObject({ kind: z.literal('timed'), start: z.string(), end: z.string() });
const Payload = z.looseObject({
  time: Time.optional(),
  changes: z.looseObject({ time: Time.optional() }).optional(),
  title: z.string().optional(),
});

const COLUMNS =
  'id,action_type,status,payload,payload_version,idempotency_key,what,why,change_summary,exact_change,side_effects,destination_label,origin,origin_ref_id,executor,device_installation_id,batch_id,created_at,approval_expires_at,approved_at,rejected_at,approved_via,executed_at,result,last_error_code,requires_scope,source_type,source_id,source_provider,source_timestamp';

export interface ApprovalDetail {
  readonly view: ApprovalView;
  /** The proposed block (`calendar_create` time or `calendar_update` new time). */
  readonly time: { readonly start: string; readonly end: string } | null;
  readonly title: string | null;
}

export async function fetchApprovalView(id: string): Promise<ApprovalDetail> {
  const row = unwrap(
    await getSupabase().from('approval_actions').select(COLUMNS).eq('id', id).single(),
  );
  const exact = ExactChange.safeParse(row.exact_change);
  const effects = SideEffects.safeParse(row.side_effects);
  const payload = Payload.safeParse(row.payload);
  const time = payload.success ? (payload.data.time ?? payload.data.changes?.time ?? null) : null;
  const result = z
    .looseObject({ web_link: z.string().nullable().optional(), summary: z.string().optional() })
    .safeParse(row.result);
  const view = {
    id: row.id,
    action_type: row.action_type,
    status: row.status,
    payload_version: row.payload_version,
    idempotency_key: row.idempotency_key,
    type_label_key: `approvals.types.${row.action_type}`,
    what: { title: row.what, summary: row.change_summary },
    why: { text: row.why ?? '', reason_code: row.origin },
    source: {
      source_type: row.source_type,
      source_id: row.source_id,
      source_provider: row.source_provider ?? 'in_app',
      source_timestamp: row.source_timestamp,
    },
    exact_change: exact.success
      ? exact.data
      : {
          kind:
            row.action_type === 'email_send'
              ? 'send'
              : row.action_type === 'calendar_update'
                ? 'update'
                : 'create',
          fields: [],
        },
    destination: {
      target_kind:
        row.executor === 'device'
          ? 'device'
          : row.destination_label === null
            ? 'in_app'
            : 'provider',
      provider:
        row.destination_label === null && row.executor !== 'device'
          ? 'in_app'
          : (row.source_provider ?? 'in_app'),
      account_label: row.destination_label,
      container_label: null,
    },
    side_effects: effects.success ? effects.data : [],
    scope_status: { state: row.requires_scope === null ? 'granted' : 'upgrade_required' },
    requires_confirmation: false,
    pro_required: false,
    origin: row.origin,
    origin_ref_id: row.origin_ref_id,
    executor: row.executor === 'device' ? 'device' : 'server',
    device_installation_id: row.device_installation_id,
    batch_id: row.batch_id,
    created_at: row.created_at,
    approval_expires_at: row.approval_expires_at,
    approved_at: row.approved_at,
    rejected_at: row.rejected_at,
    approved_via: row.approved_via,
    executed_at: row.executed_at,
    result: result.success
      ? { web_link: result.data.web_link ?? null, summary: result.data.summary ?? '' }
      : null,
    failure:
      row.last_error_code === null
        ? null
        : { code: row.last_error_code, message: row.last_error_code, retryable: true },
  } as unknown as ApprovalView;
  return {
    view,
    time: time === null ? null : { start: time.start, end: time.end },
    title: payload.success ? (payload.data.title ?? null) : null,
  };
}

/** `['approvals', id]`: seeded by proposing screens, fetched from the row otherwise. */
export function approvalDetailOptions(id: string) {
  return queryOptions({
    queryKey: qk.approvals.detail(id),
    queryFn: () => fetchApprovalView(id),
    staleTime: 30_000,
  });
}
