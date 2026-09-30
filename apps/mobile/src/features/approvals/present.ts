/**
 * Presentation of an approval (M§33, Part 2 §0.5, Part 3 §0.4): type label, status label and
 * tone, the six card rows (Ne · Neden · Kaynak · Değişim · Hesap · Yan etki), the executed copy
 * and the failure copy, all from `approvals.*` messages. A hook for screens; `approvalCopy()` for
 * toasts raised outside React.
 */
import { formatRelativeDay } from '@da/i18n';
import type { KeyValueItem } from '@da/ui';
import { useTranslations } from 'use-intl';

import { translator } from '../../i18n/translate';
import { now } from '../../lib/clock';
import { userTimeZone, useLang } from '../common/DateTimeFields';
import { failureMessageKey, type ApprovalModel } from './model';

type FailureKey =
  | 'stale'
  | 'reauth'
  | 'scope'
  | 'rejected'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'device_missing'
  | 'device_failed'
  | 'device_cancelled'
  | 'generic';

const FAILURE_KEYS: readonly FailureKey[] = [
  'stale',
  'reauth',
  'scope',
  'rejected',
  'rate_limited',
  'unavailable',
  'timeout',
  'device_missing',
  'device_failed',
  'device_cancelled',
  'generic',
];

export function failureKeyOf(model: ApprovalModel): FailureKey {
  const key = failureMessageKey(model).replace('approvals.failure.', '');
  return (FAILURE_KEYS as readonly string[]).includes(key) ? (key as FailureKey) : 'generic';
}

/** "Etkinlik taşı" for a time-only `calendar_update`, otherwise the type label key. */
export function typeKeyOf(
  model: Pick<ApprovalModel, 'actionType' | 'changes'>,
): ApprovalModel['actionType'] | 'calendar_move' {
  if (model.actionType !== 'calendar_update') return model.actionType;
  const timeOnly =
    model.changes.length > 0 &&
    model.changes.every((c) => c.field === 'time' || c.field === 'start' || c.field === 'end');
  return timeOnly ? 'calendar_move' : 'calendar_update';
}

const DAY_MS = 86_400_000;

export function useApprovalPresenter() {
  const t = useTranslations('approvals');
  const common = useTranslations('common');
  const lang = useLang();
  const tz = userTimeZone();
  const when = (iso: string | null) =>
    iso === null
      ? ''
      : formatRelativeDay(iso, { locale: lang, now: now().getTime(), timeZone: tz });

  return {
    typeLabel: (model: ApprovalModel) => t(`types.${typeKeyOf(model)}`),
    statusLabel: (model: ApprovalModel) => t(`statuses.${model.status}`),
    busyLabel: (model: ApprovalModel) =>
      model.actionType === 'email_send' ? t('progress.sending') : t('progress.processing'),
    doneLabel: (model: ApprovalModel) => t(`results.${model.actionType}`),
    failureReason: (model: ApprovalModel) => t(`failure.${failureKeyOf(model)}`),
    expiredNote: (model: ApprovalModel) => t('progress.expired', { time: when(model.expiresAt) }),
    sourceText: (model: ApprovalModel) => sourceTextOf(model, common, t, when),
    details: (
      model: ApprovalModel,
      options: { readonly onSource?: (() => void) | null } = {},
    ): KeyValueItem[] => {
      const change =
        model.changeKind === 'update' && model.changes.length > 0
          ? model.changes
              .map((c) => t('rows.diff', { before: c.before ?? '—', after: c.after ?? '—' }))
              .join(' · ')
          : model.summary;
      const rows: KeyValueItem[] = [
        {
          key: 'why',
          label: t('card.why'),
          value: model.why !== '' ? model.why : whyFallback(t, model.origin),
        },
        { key: 'change', label: t('card.change'), value: change === '' ? '—' : change },
        {
          key: 'source',
          label: t('rows.source'),
          value: sourceTextOf(model, common, t, when),
          ...(options.onSource === undefined || options.onSource === null
            ? {}
            : { onPress: options.onSource, accessibilityHint: t('rows.sourceHint') }),
        },
        {
          key: 'account',
          label: t('rows.account'),
          value:
            model.destinationLabel ??
            (model.destinationKind === 'device' ? t('destination.device') : t('destination.inApp')),
        },
      ];
      if (model.sideEffects.length > 0) {
        rows.push({
          key: 'side_effect',
          label: t('rows.sideEffect'),
          value: model.sideEffects.map((e) => e.text).join(' · '),
        });
      }
      if (
        model.status === 'pending' &&
        model.expiresAt !== null &&
        Date.parse(model.expiresAt) - now().getTime() < DAY_MS
      ) {
        rows.push({
          key: 'expiry',
          label: t('rows.expiry'),
          value: when(model.expiresAt),
        });
      }
      return rows;
    },
  };
}

const SOURCE_TYPES = {
  email_message: true,
  email_thread: true,
  calendar_event: true,
  device_calendar_event: true,
  task: true,
  capture: true,
  meeting_note: true,
  post_meeting_note: true,
  android_notification: true,
  assistant_message: true,
  user_input: true,
  commitment: true,
  life_event: true,
  contact: true,
} as const;
type SourceType = keyof typeof SOURCE_TYPES;

type WhyOrigin =
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

const WHY_ORIGINS: readonly WhyOrigin[] = [
  'reply_draft',
  'assistant',
  'voice',
  'capture',
  'plan_proposal',
  'conflict_resolution',
  'post_meeting',
  'email_detail',
  'life_event',
  'follow_up',
  'reminder_sheet',
  'commitment_detection',
  'insight',
  'manual',
];

function whyFallback(t: ReturnType<typeof useTranslations<'approvals'>>, origin: string): string {
  return (WHY_ORIGINS as readonly string[]).includes(origin)
    ? t(`why.${origin as WhyOrigin}`)
    : t('why.manual');
}

function sourceTextOf(
  model: ApprovalModel,
  common: ReturnType<typeof useTranslations<'common'>>,
  t: ReturnType<typeof useTranslations<'approvals'>>,
  when: (iso: string | null) => string,
): string {
  const source = model.source;
  if (source === null) return t('rows.sourceSelf');
  const kind =
    source.label ??
    (source.type in SOURCE_TYPES ? common(`sourceTypes.${source.type as SourceType}`) : '');
  return [kind, when(source.timestamp)].filter((p) => p !== '').join(' · ');
}

/** Toast copy for decisions made outside a screen's render. */
export function approvalCopy() {
  const t = translator();
  return {
    executed: (model: ApprovalModel) => t(`approvals.results.${model.actionType}`),
    conflict: () => t('approvals.toasts.conflict'),
    expired: () => t('approvals.toasts.expired'),
    rejected: (learned: boolean) =>
      learned ? t('approvals.toasts.rejectedLearned') : t('approvals.toasts.rejected'),
    offline: () => t('approvals.toasts.offline'),
    failed: () => t('common.toast.saveFailed'),
    waiting: () => t('approvals.toasts.waiting'),
    longRunning: () => t('approvals.toasts.longRunning'),
    undo: () => t('common.actions.undo'),
    view: () => t('approvals.toasts.view'),
  };
}

/** Origins whose reject is a learning signal (M-APPR-01 "Reddedildi · Öğrendim"). */
export const AI_ORIGINS: readonly string[] = [
  'commitment_detection',
  'conflict_resolution',
  'plan_proposal',
  'post_meeting',
  'life_event',
];
