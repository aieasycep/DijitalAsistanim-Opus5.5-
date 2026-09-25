/**
 * M-PLAN-07 · Takvim Çakışması + "Nasıl çözelim?" and M-PLAN-08 · Çözüm onayı. The pair and the
 * ranked options come from `POST /plan/conflicts/:insightId/options` (deterministic, no invented
 * travel time or availability); choosing one calls `resolve`: a `calendar_update` approval is
 * previewed and approved here (never a direct calendar write), a new-time mail opens its draft in
 * the reply editor (`email_send` approval there), "Beni hatırlat" opens the reminder sheet and
 * "Böyle kalsın" dismisses with undo. Detection is free; the options are Pro (402 → gate).
 */
import { isApiError, qk } from '@da/api-client';
import {
  apiMutationOptions,
  conflictOptionsQueryOptions,
  useApiClient,
} from '@da/api-client/react';
import { withTrCases } from '@da/i18n';
import {
  ConflictPair,
  GroupedList,
  HintRow,
  OptionRow,
  SkeletonBlock,
  SuccessState,
  Text,
  useToast,
} from '@da/ui';
import type { ApprovalView } from '@da/validation/api/approvals';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { callRpc } from '../../lib/data/rpc';
import { useFormats, useSessionContext } from '../../lib/data/session';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { ProGate } from '../actions/ProGate';
import { openReminder } from '../actions/sheets';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import { ApprovalCardView } from '../approvals/ApprovalRunnerCard';
import { useApprovalRunner } from '../approvals/runner';

type OptionKind = 'move_own' | 'propose_time' | 'shorten' | 'keep';

function analyticsKind(kind: string): OptionKind | null {
  switch (kind) {
    case 'move_event':
      return 'move_own';
    case 'shorten_event':
      return 'shorten';
    case 'propose_new_time_email':
      return 'propose_time';
    case 'ignore':
      return 'keep';
    default:
      return null;
  }
}

function Preview({
  approval,
  kind,
  onBack,
}: {
  readonly approval: ApprovalView;
  readonly kind: string;
  readonly onBack: () => void;
}) {
  const t = useTranslations('plan.conflictScreen');
  const optionKind = analyticsKind(kind);
  const runner = useApprovalRunner(approval, {
    via: 'inline_sheet',
    undo: true,
    invalidate: [qk.plan.all, qk.flow.all],
    onExecuted: () => {
      if (optionKind !== null)
        track('conflict_resolved', { option_kind: optionKind, outcome: 'executed' });
    },
    onRejected: onBack,
  });
  const failed = runner.phase === 'failed';
  useEffect(() => {
    if (failed && optionKind !== null)
      track('conflict_resolved', { option_kind: optionKind, outcome: 'failed' });
  }, [failed, optionKind]);
  if (runner.phase === 'executed') {
    return <SuccessState title={t('resolved')} testID="conflict.resolved" />;
  }
  return <ApprovalCardView runner={runner} />;
}

export function ConflictScreen() {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const formats = useFormats();
  const session = useSessionContext();
  const online = useOnline();
  const blocked = useOfflineGuard();
  const back = useBack('/plan');
  const { insightId: id } = useLocalSearchParams<{ insightId: string }>();
  const query = useQuery({
    ...conflictOptionsQueryOptions(client, id),
    enabled: session.isPro && online,
  });
  const resolve = useMutation(
    apiMutationOptions(client, 'POST /plan/conflicts/:insightId/resolve'),
  );
  const [preview, setPreview] = useState<{ approval: ApprovalView; kind: string } | null>(null);
  const data = query.data;
  const gone = isApiError(query.error) && query.error.code === 'STATE_CONFLICT';

  useEffect(() => {
    track('conflict_opened', { origin: 'plan_day' });
  }, []);
  const optionCount = data?.options.length;
  useEffect(() => {
    if (optionCount !== undefined) track('conflict_options_shown', { count: optionCount });
  }, [optionCount]);

  const choose = (optionId: string, kind: string, recommended: boolean) => {
    if (blocked('approve')) return;
    const optionKind = analyticsKind(kind);
    if (optionKind !== null)
      track('conflict_option_selected', { option_kind: optionKind, recommended });
    resolve.mutate(
      { input: { params: { insightId: id }, body: { option_id: optionId } } },
      {
        onSuccess: (result) => {
          if (result.approval !== null) {
            setPreview({ approval: result.approval, kind });
            return;
          }
          if (result.reply_draft !== null) {
            router.push(
              `/mail/${result.reply_draft.email_message_id}/reply?draftId=${result.reply_draft.id}&origin=plan` as Href,
            );
            return;
          }
          if (result.reminder_options_route !== null || kind === 'remind_me') {
            openReminder({ title: t('conflict.title'), origin: 'plan' });
            return;
          }
          if (result.insight_status === 'dismissed') {
            track('conflict_resolved', { option_kind: 'keep', outcome: 'dismissed' });
            toast.show({
              message: t('conflictScreen.kept'),
              kind: 'success',
              action: {
                label: tc('actions.undo'),
                onPress: () => {
                  void callRpc('set_insight_status', { p_insight_id: id, p_status: 'open' });
                },
              },
            });
            back();
          }
        },
        onError: (error) => {
          toast.show({
            message:
              isApiError(error) && error.code === 'STATE_CONFLICT'
                ? t('conflictScreen.gone')
                : t('conflictScreen.resolveFailed'),
            kind: 'error',
          });
        },
      },
    );
  };

  const events = data?.conflict.events ?? [];
  const [a, b] = events;
  return (
    <DetailScreen
      kicker={a === undefined ? t('conflict.title') : formats.weekdayDate(a.start)}
      onLeadingPress={back}
      onRefresh={() => query.refetch()}
      testID="conflict.screen"
    >
      <Text variant="kicker" tone="critical">
        {t('conflict.title')}
      </Text>
      <Text variant="h1" heading>
        {t('conflictScreen.headline')}
      </Text>
      {a === undefined || b === undefined ? null : (
        <View style={{ gap: 10 }}>
          <ConflictPair
            first={{
              time: formats.range(a.start, a.end),
              title: a.title,
              meta: formats.duration(
                Math.round((Date.parse(a.end) - Date.parse(a.start)) / 60_000),
              ),
            }}
            second={{
              time: formats.range(b.start, b.end),
              title: b.title,
              meta: formats.duration(
                Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60_000),
              ),
            }}
            accessibilityLabel={t('conflictScreen.pairA11y', {
              a: a.title,
              aTime: formats.time(a.start),
              b: b.title,
              bTime: formats.time(b.start),
            })}
            onPress={() => {
              router.push(`/event/${a.id}?origin=plan_day` as Href);
            }}
            testID="conflict.pair"
          />
          <Text variant="secondary" tone="secondary">
            {t(
              'conflictScreen.explanation',
              withTrCases(
                { end: formats.time(a.end), title: b.title, start: formats.time(b.start) },
                ['end', 'start'],
              ),
            )}
          </Text>
        </View>
      )}
      {!session.isPro ? (
        <ProGate
          feature="advanced_planning"
          kicker={t('screen.gateKicker')}
          title={t('screen.gateTitle')}
          body={t('screen.gateBody')}
          surface="inline"
        />
      ) : preview !== null ? (
        <Preview
          approval={preview.approval}
          kind={preview.kind}
          onBack={() => {
            setPreview(null);
          }}
        />
      ) : gone ? (
        <SuccessState
          title={t('conflictScreen.gone')}
          body={t('conflictScreen.goneBody')}
          action={{ label: t('proposal.backToPlan'), onPress: back }}
          testID="conflict.gone"
        />
      ) : !online ? (
        <HintRow text={t('conflictScreen.offline')} />
      ) : query.isPending ? (
        <View style={{ gap: 8 }} testID="conflict.loading">
          <SkeletonBlock height={52} />
          <SkeletonBlock height={52} />
          <SkeletonBlock height={52} />
          <SkeletonBlock height={52} />
        </View>
      ) : query.isError ? (
        isApiError(query.error) && query.error.code === 'ENTITLEMENT_REQUIRED' ? (
          <ProGate
            feature="advanced_planning"
            kicker={t('screen.gateKicker')}
            title={t('screen.gateTitle')}
            body={t('screen.gateBody')}
            surface="inline"
          />
        ) : (
          <QueryFailure
            screen={t('conflictScreen.options')}
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
            testID="conflict"
          />
        )
      ) : (
        <View style={{ gap: 8 }}>
          <Text variant="sheetTitle" heading>
            {t('conflictScreen.how')}
          </Text>
          <Text variant="secondary" tone="secondary">
            {t('conflictScreen.howBody')}
          </Text>
          <GroupedList testID="conflict.options">
            {(data?.options ?? []).map((option, index) => (
              <OptionRow
                key={option.option_id}
                role="button"
                label={option.title}
                subtitle={[option.description, ...option.side_effects].join(' · ')}
                twoLine
                recommended={index === 0}
                ai={index === 0}
                {...(option.requires_capability === null
                  ? {}
                  : { meta: t('conflictScreen.needsPermission') })}
                disabled={resolve.isPending}
                onPress={() => {
                  choose(option.option_id, option.kind, index === 0);
                }}
                testID={`conflict.option.${option.kind}`}
              />
            ))}
          </GroupedList>
        </View>
      )}
    </DetailScreen>
  );
}
