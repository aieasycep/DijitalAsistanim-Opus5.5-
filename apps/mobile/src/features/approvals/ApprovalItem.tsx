/**
 * One approval as the kit `ApprovalCard` with live status (M-ASST-03, M-APPR-01/03): Onayla ·
 * Düzenle · Reddet (İptal in voice), the six rows, per-status badge and copy, "Tekrar dene" with the
 * same key when the failure is retryable, "Yeniden Bağlan" when the destination needs a reconnect.
 * The row is polled while approved/executing (R-19); success is shown only on `executed`.
 * Every approval is a tap (R-03): `via` records the surface.
 */
import { ApprovalCard, Text, TextAction } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { sheets } from '../../providers/SheetHost';
import { routeForSource } from '../today/sources';
import { INSIGHT_WHY_SHEET } from '../today/sheets/WhySheet';
import { approvalQueryOptions, pollingExpired, type ApprovedVia } from './api';
import { approveNow, rejectNow, upgradeScope } from './decide';
import { APPROVAL_EDITOR_SHEET } from './editor-key';
import { canRetry, type ApprovalModel } from './model';
import { useApprovalPresenter } from './present';

export interface ApprovalItemProps {
  readonly model: ApprovalModel;
  readonly via: ApprovedVia;
  readonly variant?: 'full' | 'compact';
  /** `user_cancel` in voice and user-opened sheets ("İptal"), `user_reject` elsewhere. */
  readonly rejectReason?: 'user_reject' | 'user_cancel';
  /** Voice: "Onaylamak için karta dokun." */
  readonly hint?: string;
  /** Shows the "Ayrıntılar" link to `approvals/{id}`. */
  readonly detailsLink?: boolean;
  /** Replaces the default typed editor (e.g. voice closes before editing). */
  readonly onEdit?: (model: ApprovalModel) => void;
  readonly onChange?: (model: ApprovalModel) => void;
  readonly testID?: string;
}

/** The source row's destination: the in-app screen of the source, else the explain sheet. */
export function openApprovalSource(
  model: ApprovalModel,
  push: (href: string) => void,
): (() => void) | null {
  const source = model.source;
  if (source === null) return null;
  const route =
    (source.route !== null && isScreenAvailable(source.route) ? source.route : null) ??
    routeForSource(source.type, source.id);
  if (route !== null) {
    return () => {
      track('source_open', { kind: 'in_app' });
      push(route);
    };
  }
  return () => {
    sheets.open(INSIGHT_WHY_SHEET, { targetType: 'approval_action', targetId: model.id });
  };
}

/** Default "Düzenle": the reply screen for mail, the typed editor for everything else. */
export function editApproval(
  model: ApprovalModel,
  push: (href: string) => void,
): (() => void) | null {
  if (model.actionType === 'email_send') {
    const messageId = model.source?.type === 'email_message' ? model.source.id : null;
    const route = messageId === null ? null : `/mail/${messageId}/reply?approvalId=${model.id}`;
    if (route === null || !isScreenAvailable(route)) return null;
    return () => {
      track('approval_edit_open', { action_type: model.actionType });
      push(route);
    };
  }
  return () => {
    track('approval_edit_open', { action_type: model.actionType });
    sheets.open(APPROVAL_EDITOR_SHEET, {
      approvalId: model.id,
      mode: model.status === 'failed' ? 'repropose' : 'edit',
    });
  };
}

export function ApprovalItem({
  model: initial,
  via,
  variant = 'full',
  rejectReason = 'user_reject',
  hint,
  detailsLink = false,
  onEdit,
  onChange,
  testID,
}: ApprovalItemProps) {
  const t = useTranslations('approvals');
  const common = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const present = useApprovalPresenter();
  const query = useQuery({ ...approvalQueryOptions(initial.id), initialData: initial });
  const model = query.data ?? initial;
  const [busy, setBusy] = useState(false);
  const lastStatus = useRef(model.status);

  useEffect(() => {
    if (lastStatus.current === model.status) return;
    const previous = lastStatus.current;
    lastStatus.current = model.status;
    onChange?.(model);
    if ((previous === 'approved' || previous === 'executing') && model.status !== 'approved') {
      if (model.status === 'executed' || model.status === 'failed') {
        track('approval_execution_result', {
          action_type: model.actionType,
          status: model.status,
          ...(model.failureCode === null ? {} : { error_code: model.failureCode }),
        });
        track('approval_executed', { type: model.actionType, result: model.status });
      }
    }
  }, [model, onChange]);

  const push = (href: string) => {
    router.push(href);
  };
  const run = (action: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    void action().finally(() => {
      setBusy(false);
    });
  };
  const approveAction = {
    label: t('actions.approve'),
    busyLabel: present.busyLabel(model),
    doneLabel: present.doneLabel(model),
    onPress: () => {
      run(() => approveNow(model, via));
    },
  };
  const edit =
    onEdit === undefined
      ? editApproval(model, push)
      : () => {
          onEdit(model);
        };
  const retry = canRetry(model)
    ? {
        label: t('actions.retry'),
        onPress: () => {
          run(() => approveNow(model, via));
        },
      }
    : undefined;
  const reauth =
    model.scopeState === 'reauth_required' && model.status === 'pending'
      ? {
          title: t('reauth.title'),
          action: {
            label: common('actions.reconnect'),
            onPress: () => {
              void upgradeScope(model.id, model.upgradeAccountId, model.upgradeCapability);
            },
          },
        }
      : undefined;
  const time =
    model.createdAt === ''
      ? undefined
      : format.dateTime(new Date(model.createdAt), { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={styles.root}>
      <ApprovalCard
        actionType={model.actionType}
        typeLabel={present.typeLabel(model)}
        status={model.status}
        statusLabel={present.statusLabel(model)}
        {...(time === undefined ? {} : { time })}
        title={model.title}
        details={present.details(model, { onSource: openApprovalSource(model, push) })}
        approve={approveAction}
        {...(edit === null ? {} : { edit: { label: t('actions.edit'), onPress: edit } })}
        reject={{
          label: rejectReason === 'user_cancel' ? common('actions.cancel') : t('actions.reject'),
          onPress: () => {
            run(() => rejectNow(model, rejectReason, via));
          },
        }}
        {...(model.status === 'failed'
          ? {
              failure: {
                reason: present.failureReason(model),
                ...(retry === undefined ? {} : { retry }),
              },
            }
          : {})}
        expiredNote={present.expiredNote(model)}
        {...(reauth === undefined ? {} : { conflict: reauth })}
        variant={variant}
        {...(hint === undefined ? {} : { hint })}
        testID={testID ?? `approval.${model.id}`}
      />
      {(model.status === 'approved' || model.status === 'executing') && pollingExpired(model.id) ? (
        <Text variant="meta" tone="tertiaryStrong" testID={`approval.${model.id}.longRunning`}>
          {t('toasts.longRunning')}
        </Text>
      ) : null}
      {detailsLink && isScreenAvailable(`/approvals/${model.id}`) ? (
        <TextAction
          label={common('actions.details')}
          onPress={() => {
            router.push(`/approvals/${model.id}`);
          }}
          compact
          testID={`approval.${model.id}.details`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
});
