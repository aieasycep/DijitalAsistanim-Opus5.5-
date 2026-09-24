/**
 * API-APR-04 `POST /approvals/:id/reject` ("Reddet", voice card "İptal"). Only `pending → rejected`;
 * there is no `approved → rejected` edge (R-06), so any other status is a conflict except a repeat
 * on an already rejected approval, which returns the current view. With `learn` and
 * `reason='user_reject'` (and learning enabled) the rejection becomes an `ai_feedback` signal and a
 * learned-preference proposal. A rejected `email_send` returns its reply draft to `draft`.
 */
import type { ApprovalView } from '@da/validation';
import { AppError } from '../../errors.ts';
import { translate } from '../../i18n/catalog.ts';
import { type ApprovalServiceDeps, requireApproval, stateConflict } from './context.ts';
import type { ApprovalRow } from './model.ts';
import { toApprovalView } from './view.ts';

export interface RejectRequest {
  readonly userId: string;
  readonly approvalId: string;
  readonly reason: 'user_reject' | 'user_cancel';
  readonly learn: boolean;
  readonly note?: string | undefined;
}

export async function rejectApproval(
  deps: ApprovalServiceDeps,
  input: RejectRequest,
): Promise<{ approval: ApprovalRow; view: ApprovalView }> {
  const row = await requireApproval(deps, input.userId, input.approvalId);
  if (row.status === 'rejected') {
    return { approval: row, view: toApprovalView(row, { locale: deps.locale }) };
  }
  if (row.status !== 'pending') throw stateConflict(row);
  let rejected: ApprovalRow;
  try {
    rejected = await deps.repo.transition({
      id: row.id,
      to: 'rejected',
      actor: 'user',
      actorId: input.userId,
      idempotencyKey: null,
      reason: input.reason,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'APPROVAL_STATE_CONFLICT') {
      throw stateConflict(await requireApproval(deps, input.userId, input.approvalId));
    }
    throw error;
  }

  if (input.learn && input.reason === 'user_reject') {
    const user = await deps.repo.userContext(input.userId);
    if (user.learnFromInteractions) {
      await deps.repo.recordRejectionFeedback({
        userId: input.userId,
        approval: rejected,
        note: input.note ?? null,
        statement: translate(deps.locale, 'approvals.learned.statement', {
          type: translate(deps.locale, `approvals.types.${rejected.action_type}`),
        }),
      });
    }
  }
  if (rejected.payload.action_type === 'email_send') {
    await deps.repo.replyDraftStatus(input.userId, rejected.payload.reply_draft_id, 'draft');
  }
  await deps.audit.append({
    actorType: 'user',
    actorId: input.userId,
    action: 'user.approval.rejected',
    targetType: 'approval_action',
    targetId: rejected.id,
    targetUserId: input.userId,
    result: 'success',
    details: { reason: input.reason, action_type: rejected.action_type },
    correlationId: deps.correlationId,
  });
  return { approval: rejected, view: toApprovalView(rejected, { locale: deps.locale }) };
}
