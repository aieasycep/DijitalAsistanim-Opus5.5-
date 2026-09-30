/**
 * The approval card driven by an approval runner, rendered in place (M-APPR-04 "inline card
 * variant uses the same component"): the plan proposal (M-PLAN-03) and conflict sheets. The
 * six-row card contract (Ne · Neden · Kaynak · Değişim · Hesap · Etkisi), "Onayla" through the
 * runner (R-03 tap, optional R-06 5 s undo), "İptal" (`user_cancel`, no learning signal), honest
 * `executing` → `executed` / `failed` states from polling and "Tekrar dene" with the same key.
 * The sheet form of every approval is the one `ApprovalSheet` (M-APPR-04).
 */
import type { MessageKey } from '@da/i18n';
import { ApprovalCard, HintRow, type KeyValueItem } from '@da/ui';
import type { ApprovalView } from '@da/validation/api/approvals';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { makeFormats, useSessionContext, type Formats } from '../../lib/data/session';
import type { ApprovalPhase, ApprovalRunner } from './runner';

/** The card status for a runner phase (the undo window shows the transient "approved"). */
export function cardStatus(phase: ApprovalPhase, view: ApprovalView): ApprovalView['status'] {
  switch (phase) {
    case 'undo':
      return 'approved';
    case 'sending':
    case 'executing':
      return 'executing';
    case 'device':
      return 'executing';
    case 'review':
      return 'pending';
    default:
      return view.status === 'pending' ? phaseStatus(phase) : view.status;
  }
}

function phaseStatus(phase: ApprovalPhase): ApprovalView['status'] {
  switch (phase) {
    case 'executed':
      return 'executed';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'rejected';
    case 'expired':
      return 'expired';
    default:
      return 'pending';
  }
}

function changeText(view: ApprovalView, formats: Formats): string {
  if (view.what.summary !== '') return view.what.summary;
  const parts = view.exact_change.fields.map((f) => {
    const fmt = (v: string | null) =>
      v !== null && /^\d{4}-\d{2}-\d{2}T/.test(v) ? `${formats.dayMonth(v)} ${formats.time(v)}` : v;
    const before = fmt(f.before);
    const after = fmt(f.after);
    return before === null ? (after ?? '') : `${before} → ${after ?? ''}`;
  });
  return parts.filter((p) => p !== '').join(' · ');
}

/** The six-row details of the card contract (M§33). */
export interface DetailLabels {
  readonly why: string;
  readonly change: string;
  readonly source: string;
  readonly sourceHint: string;
  readonly destination: string;
  readonly sideEffect: string;
  readonly inApp: string;
}

export function useDetailLabels(): DetailLabels {
  const t = useTranslations('approvals');
  return {
    why: t('row.why'),
    change: t('row.change'),
    source: t('row.source'),
    sourceHint: t('row.sourceHint'),
    destination: t('row.destination'),
    sideEffect: t('row.sideEffect'),
    inApp: t('destination.inApp'),
  };
}

export function approvalDetails(
  view: ApprovalView,
  labels: DetailLabels,
  formats: Formats,
  onSource: (() => void) | undefined,
): KeyValueItem[] {
  const destination = [view.destination.account_label, view.destination.container_label]
    .filter((p): p is string => p !== null && p !== '')
    .join(' · ');
  const items: KeyValueItem[] = [
    { key: 'why', label: labels.why, value: view.why.text },
    { key: 'change', label: labels.change, value: changeText(view, formats) },
  ];
  if (view.source !== null) {
    items.push({
      key: 'source',
      label: labels.source,
      value:
        view.source.label ??
        `${formats.dayMonth(view.source.source_timestamp)} ${formats.time(view.source.source_timestamp)}`,
      ...(onSource === undefined
        ? {}
        : { onPress: onSource, accessibilityHint: labels.sourceHint }),
    });
  }
  items.push({
    key: 'destination',
    label: labels.destination,
    value: destination === '' ? labels.inApp : destination,
  });
  if (view.side_effects.length > 0) {
    items.push({
      key: 'side_effect',
      label: labels.sideEffect,
      value: view.side_effects.map((s) => s.text).join(' · '),
    });
  }
  return items;
}

export interface ApprovalCardViewProps {
  readonly runner: ApprovalRunner;
  /** "Düzenle" (the typed editor or the reply screen); hidden when the surface has its own. */
  readonly onEdit?: () => void;
  /** Neutral button label: "İptal" (sheet) or "Reddet". */
  readonly rejectReason?: 'user_cancel' | 'user_reject';
  readonly onSource?: () => void;
  readonly testID?: string;
}

/** The approval card driven by a runner (in place). */
export function ApprovalCardView({
  runner,
  onEdit,
  rejectReason = 'user_cancel',
  onSource,
  testID,
}: ApprovalCardViewProps) {
  const t = useTranslations('approvals');
  const tRoot = useTranslations();
  const labels = useDetailLabels();
  const session = useSessionContext();
  const formats = makeFormats(session.timeZone, session.locale);
  const { view, phase } = runner;
  const status = cardStatus(phase, view);
  const busyLabel =
    phase === 'undo'
      ? t('progress.approved')
      : view.action_type === 'email_send'
        ? t('progress.sending')
        : t('progress.processing');
  const failure = runner.failure;
  return (
    <View style={{ gap: 10 }}>
      <ApprovalCard
        actionType={view.action_type}
        typeLabel={t(`types.${view.action_type}`)}
        status={status}
        statusLabel={t(`statuses.${status}`)}
        title={view.what.title}
        details={approvalDetails(view, labels, formats, onSource)}
        approve={{
          label: t('actions.approve'),
          onPress: runner.approve,
          busyLabel,
          doneLabel: t(`results.${view.action_type}`),
        }}
        {...(onEdit === undefined ? {} : { edit: { label: t('actions.edit'), onPress: onEdit } })}
        reject={{
          label: rejectReason === 'user_cancel' ? t('m2.cancel') : t('actions.reject'),
          onPress: () => {
            runner.reject(rejectReason);
          },
        }}
        {...(failure === null
          ? {}
          : {
              failure: {
                reason: tRoot(failure.messageKey as MessageKey),
                ...(failure.retryable
                  ? { retry: { label: t('actions.retry'), onPress: runner.retry } }
                  : {}),
              },
            })}
        expiredNote={t('m2.expired')}
        testID={testID ?? 'm2.approvalCard'}
      />
      {runner.slow ? <HintRow text={t('m2.slow')} /> : null}
      {phase === 'device' ? <HintRow text={t('m2.device')} /> : null}
    </View>
  );
}
