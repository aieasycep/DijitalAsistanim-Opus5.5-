/**
 * API-APR-02 `PATCH /approvals/:id` ("Düzenle", SREQ-44): only while `pending` and at the version
 * the user saw. The patch is merged and re-parsed with the type's full schema (`action_type` and
 * `target.kind` / `destination.kind` are immutable), the card is recomputed (ownership, organizer
 * rule and a fresh precondition for `calendar_update`), and `edit_approval_payload` stores the new
 * payload with `payload_version + 1` and a new key `approval:{id}:v{n}` — so an approve with the
 * old key is refused.
 */
import { applyApprovalPayloadPatch, type ApprovalView } from '@da/validation';
import { AppError, validationError } from '../../errors.ts';
import {
  type ApprovalServiceDeps,
  cardContext,
  payloadHashHex,
  requireApproval,
  resolveContext,
  stateConflict,
} from './context.ts';
import { computeCard } from './exact-change.ts';
import type { ApprovalRow } from './model.ts';
import { toApprovalView } from './view.ts';

export interface EditRequest {
  readonly userId: string;
  readonly approvalId: string;
  readonly expectedPayloadVersion: number;
  readonly patch: Record<string, unknown>;
}

export async function editApproval(
  deps: ApprovalServiceDeps,
  input: EditRequest,
): Promise<{ approval: ApprovalRow; view: ApprovalView }> {
  const current = await requireApproval(deps, input.userId, input.approvalId);
  if (current.status !== 'pending') throw stateConflict(current);
  if (current.payload_version !== input.expectedPayloadVersion) {
    throw stateConflict(current, { reason: 'version_mismatch' });
  }
  const merged = applyApprovalPayloadPatch(current.payload, input.patch);
  if (!merged.success) throw validationError(merged.error, 'payload_patch');
  const payload = merged.data;

  const resolved = await resolveContext(deps, input.userId, payload);
  const source =
    current.source_type === 'user_input'
      ? null
      : {
          type: current.source_type,
          provider: current.source_provider ?? ('in_app' as const),
          at: current.source_timestamp,
        };
  const computed = computeCard(
    payload,
    cardContext(deps, resolved, current.origin, source),
    current.exact_change.card.source_route,
  );
  const changedFields = Object.keys(input.patch).sort();

  let approval: ApprovalRow;
  try {
    approval = await deps.repo.edit({
      id: current.id,
      userId: input.userId,
      payload,
      payloadHashHex: await payloadHashHex(payload),
      changeSummary: computed.change_summary,
      exactChange: computed.exact_change,
      what: computed.what,
      sideEffects: computed.side_effects,
      destinationLabel: computed.destination_label,
      approvalExpiresAt: computed.approval_expires_at.toISOString(),
      requiresScope: resolved.hasCapability === false ? computed.capability : null,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'APPROVAL_STATE_CONFLICT') {
      const latest = await requireApproval(deps, input.userId, input.approvalId);
      throw stateConflict(latest);
    }
    throw error;
  }
  if (approval.action_type === 'email_send' && payload.action_type === 'email_send') {
    await deps.repo.syncReplyDraft(input.userId, payload.reply_draft_id, {
      subject: payload.subject,
      body: payload.body_text,
      to: payload.to.map((r) => r.email),
      cc: payload.cc.map((r) => r.email),
    });
  }

  await deps.audit.append({
    actorType: 'user',
    actorId: input.userId,
    action: 'user.approval.edited',
    targetType: 'approval_action',
    targetId: approval.id,
    targetUserId: input.userId,
    result: 'success',
    details: {
      changed_fields: changedFields.join(',').slice(0, 200),
      version: approval.payload_version,
    },
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
