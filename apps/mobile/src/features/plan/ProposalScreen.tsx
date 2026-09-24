/**
 * M-PLAN-03 · Önerilen zaman bloğu (routed sheet, `plan/proposal/[id]`) with M-PLAN-04 · Saati
 * Değiştir: one exact `calendar_create` block with the six-row approval contract, "Onayla" (5 s
 * undo, then approve with the proposal's key, `inline_sheet`), "Saati Değiştir" limited to real
 * free slots (`GET /plan/free-slots`, then `PATCH /approvals/:id` → new version and key) and
 * "İptal" (`user_cancel`). Closing without a choice never rejects: the proposal waits in the
 * Approval Center until it expires. "Planlandı" appears only after `executed`.
 */
import { isApiError, qk } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import { localDate } from '@da/domain';
import { Button, NotFoundState, SkeletonBlock, SuccessState, Text, useToast } from '@da/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { useFormats } from '../../lib/data/session';
import { track } from '../../lib/events';
import { ApprovalCardView } from '../approvals/InlineApprovalSheet';
import { useApprovalRunner } from '../approvals/runner';
import { approvalDetailOptions, type ApprovalDetail } from '../approvals/view';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import { createProposal } from './data';
import { FreeSlotList } from './FreeSlotList';

function SlotPicker({
  detail,
  onPicked,
  onCancel,
}: {
  readonly detail: ApprovalDetail;
  readonly onPicked: (next: ApprovalDetail) => void;
  readonly onCancel: () => void;
}) {
  const t = useTranslations('plan.proposal');
  const client = useApiClient();
  const toast = useToast();
  const formats = useFormats();
  const edit = useMutation(apiMutationOptions(client, 'PATCH /approvals/:id'));
  const time = detail.time;
  const minutes =
    time === null
      ? 60
      : Math.max(15, Math.round((Date.parse(time.end) - Date.parse(time.start)) / 60_000));
  return (
    <FreeSlotList
      durationMinutes={minutes}
      originalStart={time?.start ?? null}
      origin="proposal"
      busy={edit.isPending}
      onCancel={onCancel}
      onPick={({ start, end }) => {
        edit.mutate(
          {
            input: {
              params: { id: detail.view.id },
              body: {
                expected_payload_version: detail.view.payload_version,
                payload_patch: { time: { kind: 'timed', start, end, time_zone: formats.timeZone } },
              },
            },
          },
          {
            onSuccess: (view) => {
              track('schedule_proposal_time_changed');
              onPicked({ view, time: { start, end }, title: detail.title });
            },
            onError: (error) => {
              const taken =
                isApiError(error) &&
                (error.code === 'STATE_CONFLICT' || error.code === 'APPROVAL_STATE_CONFLICT');
              toast.show({
                message: taken ? t('slotTaken') : t('changeFailed'),
                kind: taken ? 'neutral' : 'error',
              });
            },
          },
        );
      }}
    />
  );
}

function ProposalBody({ detail: initial }: { readonly detail: ApprovalDetail }) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const router = useRouter();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const formats = useFormats();
  const blocked = useOfflineGuard();
  const [detail, setDetail] = useState(initial);
  const [picking, setPicking] = useState(false);
  const runner = useApprovalRunner(initial.view, {
    via: 'inline_sheet',
    undo: true,
    invalidate: [qk.plan.all],
    onExecuted: () => {
      track('schedule_proposal_decided', { decision: 'approved' });
    },
    onRejected: () => {
      track('schedule_proposal_decided', { decision: 'cancelled' });
      router.back();
    },
  });
  const time = detail.time;
  const day = time === null ? formats.today() : localDate(time.start, formats.timeZone);
  const dayLabel =
    time === null
      ? ''
      : formats.relativeDay(time.start) === 'today'
        ? `${tc('time.today')} · ${formats.weekdayDate(time.start)}`
        : formats.relativeDay(time.start) === 'tomorrow'
          ? `${tc('time.tomorrow')} · ${formats.weekdayDate(time.start)}`
          : formats.weekdayDate(time.start);

  if (runner.phase === 'executed') {
    return (
      <SuccessState
        title={t('proposal.planned')}
        body={
          time === null
            ? t('proposal.plannedBodyShort')
            : t('proposal.plannedBody', {
                range: formats.range(time.start, time.end),
                title: detail.title ?? runner.view.what.title,
              })
        }
        action={{
          label: t('proposal.backToPlan'),
          onPress: () => {
            router.replace(`/plan?date=${day}` as Href);
          },
        }}
        testID="proposal.done"
      />
    );
  }

  const findNew = async () => {
    if (blocked('approve') || runner.view.origin_ref_id === null) return;
    try {
      const from = now().getTime() + 5 * 60_000;
      const id = await createProposal(client, queryClient, {
        item: { type: 'insight', id: runner.view.origin_ref_id },
        durationMinutes:
          time === null ? 60 : Math.round((Date.parse(time.end) - Date.parse(time.start)) / 60_000),
        window: {
          from: new Date(from).toISOString(),
          to: new Date(from + 7 * 86_400_000).toISOString(),
        },
      });
      router.replace(`/plan/proposal/${id}` as Href);
    } catch {
      toast.show({ message: t('screen.proposalFailed'), kind: 'error' });
    }
  };

  if (picking) {
    return (
      <SlotPicker
        detail={detail}
        onPicked={(next) => {
          setDetail(next);
          runner.replace(next.view);
          setPicking(false);
        }}
        onCancel={() => {
          setPicking(false);
        }}
      />
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <Text variant="kickerAi" tone="brand">
        {t('proposal.sheetKicker')}
      </Text>
      {time === null ? null : (
        <View style={{ gap: 2 }}>
          <Text variant="h2" heading numeric testID="proposal.time">
            {formats.range(time.start, time.end)}
          </Text>
          <Text variant="secondary" tone="secondary">
            {dayLabel}
          </Text>
        </View>
      )}
      <ApprovalCardView runner={runner} />
      {runner.phase === 'review' ? (
        <Button
          label={t('proposal.changeTime')}
          variant="tonal"
          onPress={() => {
            setPicking(true);
          }}
          fullWidth
          testID="proposal.changeTime"
        />
      ) : null}
      {runner.phase === 'expired' ? (
        <View style={{ gap: 8 }}>
          <Text variant="secondary" tone="secondary">
            {t('proposal.expiredBody')}
          </Text>
          {runner.view.origin_ref_id === null ? null : (
            <Button
              label={t('proposal.findNew')}
              onPress={() => {
                void findNew();
              }}
              fullWidth
              testID="proposal.findNew"
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

export function ProposalScreen() {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const back = useBack('/plan');
  const { approvalId: id } = useLocalSearchParams<{ approvalId: string }>();
  const query = useQuery(approvalDetailOptions(id));
  const detail = query.data;
  const hasDetail = detail !== undefined;
  useEffect(() => {
    if (hasDetail) track('schedule_proposal_opened', { origin: 'plan_day' });
  }, [hasDetail]);
  return (
    <DetailScreen
      leading="close"
      onLeadingPress={() => {
        track('schedule_proposal_decided', { decision: 'dismissed' });
        back();
      }}
      testID="proposal.screen"
    >
      {detail !== undefined ? (
        <ProposalBody key={detail.view.id} detail={detail} />
      ) : query.isError ? (
        isApiError(query.error) && query.error.code === 'NOT_FOUND' ? (
          <NotFoundState
            variant="entity"
            title={t('proposal.gone')}
            backAction={{ label: tc('actions.goBack'), onPress: back }}
            testID="proposal.notFound"
          />
        ) : (
          <QueryFailure
            screen={t('proposal.sheetKicker')}
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
            testID="proposal"
          />
        )
      ) : (
        <View style={{ gap: 10 }} testID="proposal.loading">
          <SkeletonBlock height={22} width="60%" />
          <SkeletonBlock height={16} width="40%" />
          <SkeletonBlock height={120} />
        </View>
      )}
    </DetailScreen>
  );
}
