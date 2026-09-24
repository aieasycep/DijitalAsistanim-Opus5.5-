/**
 * M-APPR-04 inline approval sheet (single and batch), opened in place where the intent happened
 * (SREQ-43) — Today, capture results (batch), the reminder sheet, Plan/Assistant proposals.
 *
 * R-06: "Onayla" starts a client-side 5 s delay with the toast "Onaylandı · {N} işlem" + "Geri al";
 * nothing is sent during it. "Geri al" reopens the sheet with every approval still `pending`;
 * backgrounding or closing the app sends nothing either (the approvals wait in the Approval
 * Center). When the delay ends the selected approvals are approved one after another
 * (`approved_via` `inline_sheet`, or `capture_batch` for a capture) and deselected rows are
 * rejected with `user_cancel` (no learning). Offline, the buttons are disabled (never queued).
 */
import { ApprovalRow, AssuranceNote, BottomSheet, Button, KeyValueGrid, Text } from '@da/ui';
import { onlineManager } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { translator } from '../../i18n/translate';
import { track } from '../../lib/events';
import { isScreenAvailable } from '../../lib/deeplinks';
import { useOnline } from '../../lib/query/online-manager';
import { registerSheet, sheets, type SheetRenderProps } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { approve, reject, type ApprovedVia } from './api';
import { blockOffline, followUntilTerminal, handleDecisionError, toastOutcome } from './decide';
import { APPROVAL_SHEET } from './editor-key';
import { editApproval, openApprovalSource } from './ApprovalItem';
import type { ApprovalModel } from './model';
import { useApprovalPresenter } from './present';

/** R-06 client undo delay. */
export const APPROVE_UNDO_MS = 5_000;

export interface ApprovalSheetParams {
  readonly approvals: readonly ApprovalModel[];
  readonly mode: 'single' | 'batch';
  /** `approval_actions.origin` of the proposal (analytics). */
  readonly origin: string;
  /** Capture batch: M-CAP-07 follows at `capture/{captureId}`. */
  readonly captureId?: string;
  /** Rows the user deselected before an undo (batch). */
  readonly deselected?: readonly string[];
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCancel: (() => void) | null = null;

/** Cancels a running undo delay (tests, sign-out); nothing is sent. */
export function cancelPendingApprovals(): void {
  pendingCancel?.();
}

function viaOf(params: ApprovalSheetParams): ApprovedVia {
  return params.captureId === undefined ? 'inline_sheet' : 'capture_batch';
}

async function send(params: ApprovalSheetParams, selected: readonly ApprovalModel[]) {
  const via = viaOf(params);
  const deselected = params.approvals.filter((a) => !selected.some((s) => s.id === a.id));
  const sent: string[] = [];
  let rejected = 0;
  // Sequential: per-provider limiters and a deterministic per-row status (M-APPR-04).
  for (const model of selected) {
    const result = await approve(model, via);
    if (result.ok) {
      sent.push(result.model.id);
      track('approval_decided', {
        action_type: model.actionType,
        type: model.actionType,
        decision: 'approved',
        via,
        origin: model.origin,
      });
    } else {
      handleDecisionError(model.id, result.error);
    }
  }
  for (const model of deselected) {
    const result = await reject(model, 'user_cancel');
    if (result.ok) rejected += 1;
  }
  if (params.captureId !== undefined) {
    const route = `/capture/${params.captureId}`;
    followUntilTerminal(sent, (models) => {
      track('approval_batch_result', {
        executed: models.filter((m) => m.status === 'executed').length,
        failed: models.filter((m) => m.status === 'failed').length,
        rejected,
      });
    });
    if (isScreenAvailable(route)) router.navigate(route);
    return;
  }
  if (sent.length === 0) return;
  followUntilTerminal(sent, (models) => {
    if (params.mode === 'batch') {
      track('approval_batch_result', {
        executed: models.filter((m) => m.status === 'executed').length,
        failed: models.filter((m) => m.status === 'failed').length,
        rejected,
      });
    }
    toastOutcome(models);
  });
}

/** Starts the R-06 delay for the selected approvals; returns false when nothing was scheduled. */
export function scheduleApprovals(
  params: ApprovalSheetParams,
  selected: readonly ApprovalModel[],
): boolean {
  if (!onlineManager.isOnline()) {
    blockOffline('approve');
    return false;
  }
  cancelPendingApprovals();
  const t = translator();
  let done = false;
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') cancel();
  });
  const finish = () => {
    done = true;
    pendingTimer = null;
    pendingCancel = null;
    subscription.remove();
  };
  function cancel() {
    if (done) return;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    finish();
  }
  pendingCancel = cancel;
  pendingTimer = setTimeout(() => {
    if (done) return;
    finish();
    void send(params, selected);
  }, APPROVE_UNDO_MS);
  showToast({
    message: t('approvals.undo', { count: selected.length }),
    kind: 'success',
    durationMs: APPROVE_UNDO_MS,
    action: {
      label: t('common.actions.undo'),
      onPress: () => {
        if (done) return;
        cancel();
        track('approval_undo', { mode: params.mode, count: selected.length });
        sheets.open(APPROVAL_SHEET, {
          ...params,
          deselected: params.approvals
            .filter((a) => !selected.some((s) => s.id === a.id))
            .map((a) => a.id),
        } satisfies ApprovalSheetParams);
      },
    },
  });
  return true;
}

/** Opens the inline sheet for proposals created in place. */
export function openApprovalSheet(params: ApprovalSheetParams): void {
  if (params.approvals.length === 0) return;
  track('approval_sheet_view', {
    mode: params.mode,
    count: params.approvals.length,
    origin: params.origin,
  });
  sheets.open(APPROVAL_SHEET, params);
}

function ApprovalSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<ApprovalSheetParams>) {
  const t = useTranslations('approvals');
  const common = useTranslations('common');
  const present = useApprovalPresenter();
  const online = useOnline();
  const [selected, setSelected] = useState<readonly string[]>(() =>
    params.approvals.filter((a) => !(params.deselected ?? []).includes(a.id)).map((a) => a.id),
  );
  const decided = useRef(false);
  const batch = params.mode === 'batch';
  const single = params.approvals[0];
  const push = (href: string) => {
    onDismiss();
    router.push(href);
  };

  useEffect(
    () => () => {
      if (decided.current || !isScreenAvailable('/approvals')) return;
      // Dismissed undecided: the approvals stay pending in the Approval Center.
      if (onlineManager.isOnline() && pendingTimer === null) {
        showToast({
          message: t('toasts.waiting'),
          kind: 'neutral',
          action: {
            label: t('toasts.view'),
            onPress: () => {
              router.push('/approvals');
            },
          },
        });
      }
    },
    [t],
  );

  const chosen = params.approvals.filter((a) => selected.includes(a.id));
  const approveAll = () => {
    if (chosen.length === 0) return;
    if (scheduleApprovals(params, chosen)) {
      decided.current = true;
      onDismiss();
    }
  };
  const cancelAll = () => {
    if (!online) {
      blockOffline('reject');
      return;
    }
    decided.current = true;
    onDismiss();
    void (async () => {
      for (const model of params.approvals) {
        const result = await reject(model, batch ? 'user_cancel' : 'user_reject');
        if (result.ok) {
          track('approval_decided', {
            action_type: model.actionType,
            type: model.actionType,
            decision: batch ? 'cancelled' : 'rejected',
            via: viaOf(params),
            origin: model.origin,
          });
        }
      }
      if (!batch) showToast({ message: t('toasts.rejected'), kind: 'neutral' });
    })();
  };
  const edit = single === undefined ? null : editApproval(single, push);

  const footer = (
    <View style={styles.footer}>
      {!online ? (
        <Text variant="meta" tone="warning" testID="approvalSheet.offline">
          {t('offline.sheet')}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <Button
          label={batch ? t('sheet.approveCount', { count: chosen.length }) : t('actions.approve')}
          onPress={approveAll}
          disabled={!online || chosen.length === 0}
          flex
          testID="approvalSheet.approve"
        />
        {!batch && edit !== null ? (
          <Button
            label={t('actions.edit')}
            variant="tonal"
            onPress={() => {
              decided.current = true;
              onDismiss();
              edit();
            }}
            disabled={!online}
            testID="approvalSheet.edit"
          />
        ) : null}
        <Button
          label={batch ? common('actions.nevermind') : t('actions.reject')}
          variant="neutralTonal"
          onPress={cancelAll}
          disabled={!online}
          testID="approvalSheet.reject"
        />
      </View>
      <AssuranceNote text={t('sheet.footer')} />
    </View>
  );

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={batch ? t('sheet.batchTitle', { count: params.approvals.length }) : t('sheet.title')}
      subtitle={batch ? t('sheet.batchSubtitle') : t('sheet.subtitle')}
      footer={footer}
      testID="sheet.approval"
    >
      {batch ? (
        <View>
          {params.approvals.map((model) => (
            <ApprovalRow
              key={model.id}
              actionType={model.actionType}
              typeLabel={present.typeLabel(model)}
              title={model.title}
              meta={model.summary}
              details={present.details(model)}
              selected={selected.includes(model.id)}
              onToggle={() => {
                setSelected((current) =>
                  current.includes(model.id)
                    ? current.filter((id) => id !== model.id)
                    : [...current, model.id],
                );
              }}
              testID={`approvalSheet.row.${model.id}`}
            />
          ))}
        </View>
      ) : single === undefined ? null : (
        <View style={styles.single} testID={`approvalSheet.single.${single.id}`}>
          <Text variant="kickerAi" tone="secondary">
            {present.typeLabel(single)}
          </Text>
          <Text variant="h3">{single.title}</Text>
          <KeyValueGrid
            items={present.details(single, { onSource: openApprovalSource(single, push) })}
          />
        </View>
      )}
    </BottomSheet>
  );
}

registerSheet<ApprovalSheetParams>(APPROVAL_SHEET, (props) => <ApprovalSheet {...props} />, {
  analyticsKey: 'approval',
});

const styles = StyleSheet.create({
  footer: { gap: 12 },
  buttons: { flexDirection: 'row', gap: 8 },
  single: { gap: 8 },
});
