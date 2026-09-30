/**
 * M-APPR-03 Onay detayı (`/approvals/{id}`, also the push `approval` target): the full exact change
 * (before → after for updates), source, destination, side effects and the status timeline from
 * `approval_events`, with the same decisions as the Approval Center (`approved_via
 * approval_center`). Executed approvals offer "Sonucu gör" (the provider link, https only);
 * expired ones "Yeniden öner" (a new proposal with the same payload). A missing or foreign row
 * shows "Bu işlem artık yok."
 */
import { formatRelativeDay } from '@da/i18n';
import {
  DetailHeader,
  ErrorCard,
  GroupedList,
  ListRow,
  NotFoundState,
  OfflineBanner,
  PrimaryButton,
  SectionHeader,
  Text,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@da/api-client';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { getSupabase } from '../../lib/auth/supabase';
import { ListSkeleton } from '../common/ListSkeleton';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import { approvalQueryOptions, fetchApprovalEvents, propose, type ProposeBody } from './api';
import { ApprovalItem } from './ApprovalItem';
import { handleDecisionError } from './decide';
import { openApprovalSheet } from './ApprovalSheet';
import type { ApprovalModel } from './model';

type EventActor =
  'created' | 'edited' | 'approved' | 'executing' | 'executed' | 'failed' | 'rejected' | 'expired';

function timelineKey(to: string, from: string | null): EventActor {
  if (to === 'pending') return from === null ? 'created' : 'edited';
  if (
    to === 'approved' ||
    to === 'executing' ||
    to === 'executed' ||
    to === 'failed' ||
    to === 'rejected' ||
    to === 'expired'
  ) {
    return to;
  }
  return 'created';
}

async function reproposeSame(model: ApprovalModel): Promise<void> {
  const { data } = (await getSupabase()
    .from('approval_actions')
    .select('payload')
    .eq('id', model.id)
    .maybeSingle()) as { data: { payload?: unknown } | null };
  if (data?.payload === undefined) return;
  const body = {
    payload: data.payload,
    origin: model.origin,
    origin_ref_id: null,
  } as unknown as ProposeBody;
  const result = await propose(body);
  if (!result.ok) {
    handleDecisionError(model.id, result.error);
    return;
  }
  track('approval_repropose', { action_type: model.actionType });
  openApprovalSheet({ approvals: [result.model], mode: 'single', origin: model.origin });
}

export function ApprovalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTranslations('approvals');
  const states = useTranslations('states');
  const common = useTranslations('common');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const tz = userTimeZone();
  const query = useQuery(approvalQueryOptions(id));
  const events = useQuery({
    queryKey: qk.approvals.events(id),
    queryFn: () => fetchApprovalEvents(id),
    enabled: query.data !== undefined && query.data !== null,
  });
  const [reproposing, setReproposing] = useState(false);
  const model = query.data;
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current || model === undefined || model === null) return;
    viewed.current = true;
    track('approval_detail_view', { action_type: model.actionType, status: model.status });
  }, [model]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/approvals');
  };
  const when = (iso: string) =>
    formatRelativeDay(iso, { locale: lang, now: now().getTime(), timeZone: tz });

  let body;
  if (query.isPending) {
    body = <ListSkeleton rows={4} accessibilityLabel={common('a11y.loading')} />;
  } else if (query.isError && model === undefined) {
    body = (
      <ErrorCard
        icon="error"
        tone="neutral"
        title={states('error.action.title')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="approval.detail.error"
      />
    );
  } else if (model === null || model === undefined) {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}>
        <NotFoundState
          variant="entity"
          title={states('notFound.approval.title')}
          body={states('notFound.entity.body')}
          backAction={{
            label: states('notFound.approval.cta'),
            onPress: () => {
              router.replace('/approvals');
            },
          }}
          testID="approval.detail.notFound"
        />
      </View>
    );
  } else {
    const link = model.resultWebLink;
    body = (
      <>
        <ApprovalItem model={model} via="approval_center" testID="approval.detail.card" />
        {model.changes.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title={t('detail.exactChange')} />
            <GroupedList>
              {model.changes.map((change) => (
                <ListRow
                  key={change.field}
                  title={change.field}
                  subtitle={t('rows.diff', {
                    before: change.before ?? '—',
                    after: change.after ?? '—',
                  })}
                  accessibilityLabel={t('detail.diffA11y', {
                    field: change.field,
                    before: change.before ?? '—',
                    after: change.after ?? '—',
                  })}
                />
              ))}
            </GroupedList>
          </View>
        ) : null}
        {model.status === 'executed' && link !== null ? (
          <PrimaryButton
            label={t('actions.viewResult')}
            onPress={() => {
              track('source_open', { kind: 'provider' });
              void WebBrowser.openBrowserAsync(link);
            }}
            testID="approval.detail.result"
          />
        ) : null}
        {model.status === 'expired' ? (
          <PrimaryButton
            label={t('actions.repropose')}
            loading={reproposing}
            disabled={!online}
            onPress={() => {
              setReproposing(true);
              void reproposeSame(model).finally(() => {
                setReproposing(false);
              });
            }}
            testID="approval.detail.repropose"
          />
        ) : null}
        {(events.data ?? []).length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title={t('detail.timeline')} />
            <GroupedList>
              {(events.data ?? []).map((event, index) => (
                <ListRow
                  key={`${event.at}-${String(index)}`}
                  title={t(`detail.events.${timelineKey(event.to, event.from)}`, {
                    version: event.version,
                  })}
                  subtitle={when(event.at)}
                  icon="history"
                  iconStyle="bare"
                />
              ))}
            </GroupedList>
          </View>
        ) : null}
        <Text variant="meta" tone="tertiaryStrong" selectable testID="approval.detail.supportCode">
          {t('detail.supportCode', { code: model.id.slice(0, 8) })}
        </Text>
      </>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.approvalDetail"
    >
      <DetailHeader
        leading="back"
        onLeadingPress={back}
        leadingAccessibilityLabel={common('actions.back')}
        kicker={t('detail.kicker')}
      />
      {!online ? (
        <View style={{ paddingHorizontal: theme.layout.screenX }}>
          <OfflineBanner
            message={t('offline.banner')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 16, paddingBottom: 40 },
  section: { gap: 8 },
});
