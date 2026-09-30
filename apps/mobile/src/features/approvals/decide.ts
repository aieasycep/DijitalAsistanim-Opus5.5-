/**
 * Decision flows shared by every approval surface (Approval Center, detail, inline sheet, chat and
 * voice cards): the capability gate (an extra provider scope via API-INT-02 with
 * `resume.approval_id`, R-07), the decision error → toast mapping, analytics, and result tracking
 * after the surface is gone (a toast with the executed copy only on `executed`, SREQ-45).
 */
import { onlineManager } from '@tanstack/react-query';
import { router } from 'expo-router';

import { translator } from '../../i18n/translate';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { showToast } from '../../providers/ToastHost';
import { startUpgrade } from '../integrations/connect';
import { openProGate } from '../pro-gate/ProGate';
import {
  approve,
  fetchApproval,
  invalidateApprovals,
  pollDelay,
  publishApproval,
  reject,
  type ApprovedVia,
  type DecisionError,
} from './api';
import { isTerminal, type ApprovalModel } from './model';
import { AI_ORIGINS, approvalCopy } from './present';

const APPROVALS_ROUTE = '/approvals';

type ApprovalOrigin =
  | 'reply_draft'
  | 'assistant'
  | 'voice'
  | 'capture'
  | 'plan_proposal'
  | 'conflict_resolution'
  | 'post_meeting'
  | 'email_detail'
  | 'life_event'
  | 'follow_up'
  | 'reminder_sheet'
  | 'commitment_detection'
  | 'insight'
  | 'manual';

/** `offline_blocked_action` + the blocked-write toast (approvals are never queued). */
export function blockOffline(action: 'approve' | 'reject'): void {
  track('offline_blocked_action', { action });
  showToast({ message: approvalCopy().offline(), kind: 'offline' });
}

/** The provider of the destination account (bootstrap accounts). */
function providerOf(accountId: string | null): 'google' | 'microsoft' | null {
  const account = cachedBootstrap()?.accounts.find((a) => a.id === accountId);
  return account?.provider === 'google' || account?.provider === 'microsoft'
    ? account.provider
    : null;
}

type WriteCapability = 'mail_send' | 'calendar_write' | 'tasks_write';

function writeCapability(value: string | null): WriteCapability | null {
  return value === 'mail_send' || value === 'calendar_write' || value === 'tasks_write'
    ? value
    : null;
}

/** API §7 progressive consent for an approval; the callback reopens `approvals/{id}`. */
export async function upgradeScope(
  approvalId: string | null,
  accountId: string | null,
  capability: string | null,
  provider: 'google' | 'microsoft' | null = null,
): Promise<void> {
  const cap = writeCapability(capability);
  const resolved = provider ?? providerOf(accountId);
  if (accountId === null || cap === null || resolved === null) {
    if (isScreenAvailable('/settings/accounts')) router.push('/settings/accounts');
    return;
  }
  track('scope_upgrade_view', { capability: cap, provider: resolved });
  await startUpgrade({
    accountId,
    provider: resolved,
    capability: cap,
    returnTo: 'settings_accounts',
    ...(approvalId === null ? {} : { resumeApprovalId: approvalId }),
  });
}

/** Maps a failed decision to its UI (M-APPR-01 Error). */
export function handleDecisionError(approvalId: string | null, error: DecisionError): void {
  const copy = approvalCopy();
  switch (error.kind) {
    case 'offline':
      blockOffline('approve');
      return;
    case 'conflict':
      invalidateApprovals();
      showToast({ message: error.expired ? copy.expired() : copy.conflict(), kind: 'neutral' });
      return;
    case 'scope':
      void upgradeScope(approvalId, error.accountId, error.capability, error.provider);
      return;
    case 'entitlement':
      openProGate(error.feature === 'advanced_planning' ? 'advanced_planning' : 'capture');
      return;
    case 'not_found':
      invalidateApprovals();
      showToast({ message: copy.failed(), kind: 'error' });
      return;
    case 'failed':
      showToast({ message: copy.failed(), kind: 'error' });
      return;
  }
}

function originOf(model: ApprovalModel): ApprovalOrigin {
  return model.origin as ApprovalOrigin;
}

/** One approve tap (no undo delay: Approval Center, detail, chat and voice cards). */
export async function approveNow(model: ApprovalModel, via: ApprovedVia): Promise<boolean> {
  if (!onlineManager.isOnline()) {
    blockOffline('approve');
    return false;
  }
  if (model.scopeState === 'upgrade_required') {
    await upgradeScope(model.id, model.upgradeAccountId, model.upgradeCapability);
    return false;
  }
  const result = await approve(model, via);
  if (!result.ok) {
    handleDecisionError(model.id, result.error);
    return false;
  }
  track('approval_decided', {
    action_type: model.actionType,
    type: model.actionType,
    decision: 'approved',
    via,
    origin: originOf(model),
  });
  if (model.status === 'failed') track('approval_retry', { action_type: model.actionType });
  return true;
}

/** Reddet (`user_reject`, learns for AI-suggested origins) or İptal (`user_cancel`). */
export async function rejectNow(
  model: ApprovalModel,
  reason: 'user_reject' | 'user_cancel',
  via: ApprovedVia,
): Promise<boolean> {
  if (!onlineManager.isOnline()) {
    blockOffline('reject');
    return false;
  }
  const result = await reject(model, reason);
  if (!result.ok) {
    handleDecisionError(model.id, result.error);
    return false;
  }
  track('approval_decided', {
    action_type: model.actionType,
    type: model.actionType,
    decision: reason === 'user_reject' ? 'rejected' : 'cancelled',
    via,
    origin: originOf(model),
  });
  if (reason === 'user_reject') {
    const learning = cachedBootstrap()?.preferences.learn_from_interactions ?? true;
    showToast({
      message: approvalCopy().rejected(learning && AI_ORIGINS.includes(model.origin)),
      kind: 'neutral',
    });
  }
  return true;
}

/**
 * Follows approvals after the surface closed (R-19 schedule) and reports the outcome once: the
 * executed copy, the failure, or "İşlem sürüyor. Bitince bildireceğim." after 60 s.
 */
export function followUntilTerminal(
  ids: readonly string[],
  onDone?: (models: readonly ApprovalModel[]) => void,
): void {
  const started = now().getTime();
  const tick = async () => {
    const models = (await Promise.all(ids.map((id) => fetchApproval(id).catch(() => null)))).filter(
      (m): m is ApprovalModel => m !== null,
    );
    for (const model of models) publishApproval(model);
    if (models.length === ids.length && models.every(isTerminal)) {
      for (const model of models) {
        if (model.status === 'executed' || model.status === 'failed') {
          track('approval_execution_result', {
            action_type: model.actionType,
            status: model.status,
            ...(model.failureCode === null ? {} : { error_code: model.failureCode }),
          });
          track('approval_executed', { type: model.actionType, result: model.status });
        }
      }
      invalidateApprovals();
      onDone?.(models);
      return;
    }
    const delay = pollDelay(now().getTime() - started);
    if (delay === null) {
      showToast({
        message: approvalCopy().longRunning(),
        kind: 'neutral',
        ...(isScreenAvailable(APPROVALS_ROUTE)
          ? {
              action: {
                label: approvalCopy().view(),
                onPress: () => {
                  router.push(APPROVALS_ROUTE);
                },
              },
            }
          : {}),
      });
      return;
    }
    setTimeout(() => {
      void tick();
    }, delay);
  };
  void tick();
}

/** The single-approval outcome toast (executed copy only after `executed`). */
export function toastOutcome(models: readonly ApprovalModel[]): void {
  const copy = approvalCopy();
  const executed = models.filter((m) => m.status === 'executed');
  const failed = models.filter((m) => m.status === 'failed');
  if (models.length === 1 && executed.length === 1 && executed[0] !== undefined) {
    showToast({ message: copy.executed(executed[0]), kind: 'success' });
    return;
  }
  if (failed.length > 0) {
    showToast({
      message: translatorBatch(executed.length, models.length),
      kind: 'error',
      ...(isScreenAvailable(APPROVALS_ROUTE)
        ? {
            action: {
              label: copy.view(),
              onPress: () => {
                router.push(APPROVALS_ROUTE);
              },
            },
          }
        : {}),
    });
    return;
  }
  if (executed.length > 0) {
    showToast({ message: translatorBatch(executed.length, models.length), kind: 'success' });
  }
}

function translatorBatch(done: number, total: number): string {
  return translator()('approvals.toasts.batchSummary', { done, total });
}
