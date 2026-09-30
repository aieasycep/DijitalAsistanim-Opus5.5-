/**
 * API-APR-01 `POST /approvals` and the shared proposal path (reply-draft submit, capture actions,
 * plan proposals and assistant write intents build approvals through `proposeApproval`, R-04).
 *
 * Validates ownership and the destination, computes the card (exact change, destination, side
 * effects, expiry), checks the Pro gates and the write capability (a missing scope is shown in
 * advance as `scope_status.upgrade_required`), then stores the approval as `pending` with key
 * `approval:{id}:v1`. The approval-expiry push is scheduled 2 h before `approval_expires_at`.
 */
import { type Provider, type SourceType } from '@da/domain';
import type { ApprovalPayload, ApprovalView } from '@da/validation';
import { AppError, fieldError } from '../../errors.ts';
import { approvalExpiringJob } from '../notifications/triggers/approval-expiry.ts';
import {
  type ApprovalServiceDeps,
  cardContext,
  payloadHashHex,
  providerOrNull,
  resolveContext,
  sourceRoute,
} from './context.ts';
import { computeCard } from './exact-change.ts';
import {
  type ApprovalOriginValue,
  type ApprovalRow,
  DuplicatePendingError,
  type NewApprovalRow,
} from './model.ts';
import { toApprovalView } from './view.ts';

export interface ProposalSource {
  readonly source_type: SourceType;
  readonly source_id: string | null;
  readonly source_provider: Provider | 'in_app';
  readonly source_timestamp: string;
  readonly label?: string | undefined;
  readonly open_route?: string | undefined;
}

export interface ProposeInput {
  readonly userId: string;
  readonly payload: ApprovalPayload;
  readonly origin: ApprovalOriginValue;
  readonly originRefId: string | null;
  readonly source?: ProposalSource | undefined;
  readonly batchId?: string | undefined;
  /** `user` for API-APR-01; `system` when a server pipeline proposes on the user's behalf. */
  readonly actor?: 'user' | 'system';
  /** `email_send` is proposed only by the reply-draft submit path (API-MAIL-05). */
  readonly allowEmailSend?: boolean;
}

export interface ProposeResult {
  readonly approval: ApprovalRow;
  readonly view: ApprovalView;
}

const PROVIDER_SOURCE_TYPES = new Set<SourceType>([
  'email_message',
  'email_thread',
  'calendar_event',
  'device_calendar_event',
]);

function provenanceOf(input: ProposeInput, now: Date) {
  const payload = input.payload;
  const src: ProposalSource | undefined =
    payload.action_type === 'commitment_create' ? payload.source : input.source;
  if (src === undefined || src.source_type === 'user_input') {
    return {
      source_type: 'user_input' as SourceType,
      source_id: input.originRefId ?? input.userId,
      source_provider: null,
      source_timestamp: now.toISOString(),
      card: null,
    };
  }
  const provider = providerOrNull(src.source_provider);
  if (provider === null && PROVIDER_SOURCE_TYPES.has(src.source_type)) {
    throw fieldError('source.source_provider', 'required');
  }
  return {
    source_type: src.source_type,
    source_id: src.source_id ?? input.originRefId ?? input.userId,
    source_provider: provider,
    source_timestamp: new Date(src.source_timestamp).toISOString(),
    card: {
      type: src.source_type,
      provider: src.source_provider,
      at: src.source_timestamp,
    },
  };
}

export async function proposeApproval(
  deps: ApprovalServiceDeps,
  input: ProposeInput,
): Promise<ProposeResult> {
  const payload = input.payload;
  if (payload.action_type === 'email_send' && input.allowEmailSend !== true) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'email_send_via_reply_drafts' },
      fieldErrors: [
        {
          path: 'payload.action_type',
          code: 'email_send_via_reply_drafts',
          message_key: 'validation.custom',
        },
      ],
    });
  }
  const now = deps.now();
  const resolved = await resolveContext(deps, input.userId, payload);
  const provenance = provenanceOf(input, now);
  const ctx = cardContext(deps, resolved, input.origin, provenance.card);
  const computed = computeCard(
    payload,
    ctx,
    sourceRoute(provenance.card, provenance.card === null ? null : provenance.source_id),
  );

  if (computed.pro_feature !== null) {
    const planKey =
      computed.pro_feature === 'commitments' ? 'follow_up_commitments' : 'advanced_planning';
    if (!(await deps.repo.planFeature(input.userId, planKey))) {
      throw new AppError('ENTITLEMENT_REQUIRED', { details: { feature: computed.pro_feature } });
    }
  }

  const id = crypto.randomUUID();
  const confidence = payload.action_type === 'commitment_create' ? payload.confidence : 1;
  const evidence =
    payload.action_type === 'commitment_create'
      ? [{ quote: payload.evidence.quote.slice(0, 300), field: 'text' }]
      : [];
  const row: NewApprovalRow = {
    id,
    action_type: payload.action_type,
    payload,
    payload_hash_hex: await payloadHashHex(payload),
    what: computed.what,
    why: computed.why,
    change_summary: computed.change_summary,
    side_effects: computed.side_effects,
    destination_account_id: computed.destination_account_id,
    destination_label: computed.destination_label,
    origin: input.origin,
    origin_ref_id: input.originRefId,
    requires_scope: resolved.hasCapability === false ? computed.capability : null,
    exact_change: computed.exact_change,
    batch_id: input.batchId ?? null,
    executor: computed.executor,
    device_installation_id: computed.device_installation_id,
    approval_expires_at: computed.approval_expires_at.toISOString(),
    source_type: provenance.source_type,
    source_id: provenance.source_id.slice(0, 200),
    source_provider: provenance.source_provider,
    source_timestamp: provenance.source_timestamp,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence,
    correlation_id: deps.correlationId,
  };

  let approval: ApprovalRow;
  try {
    approval = await deps.repo.create(input.userId, row, input.actor ?? 'user');
  } catch (error) {
    if (error instanceof DuplicatePendingError) {
      throw new AppError('STATE_CONFLICT', {
        details: { reason: 'duplicate_pending', approval_id: error.existingId },
      });
    }
    throw error;
  }

  const expiring = approvalExpiringJob(approval, now);
  if (expiring !== null) await deps.enqueue(expiring);

  await deps.audit.append({
    actorType: input.actor === 'system' ? 'system' : 'user',
    actorId: input.userId,
    action: 'user.approval.proposed',
    targetType: 'approval_action',
    targetId: approval.id,
    targetUserId: input.userId,
    result: 'success',
    details: { action_type: approval.action_type, origin_kind: approval.origin },
    correlationId: deps.correlationId,
  });

  return {
    approval,
    view: toApprovalView(approval, {
      locale: deps.locale,
      account: resolved.account,
      hasCapability: resolved.hasCapability,
    }),
  };
}
