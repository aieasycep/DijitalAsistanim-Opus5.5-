/**
 * `capture/{id}` renders by `captures.status` (M-CAP-05…07):
 * - analysing (`uploaded` / `analyzing`): progress from the real pipeline step
 *   (`progress.step` reading → extracting → done; no timers, no progress bar), "İptal" discards;
 *   polled every 1 s up to 120 s, then every 5 s; after 30 s it may be closed (the job continues);
 * - `failed`: the mapped reason with "Tekrar dene" (analyze again) and "Kapat";
 * - `extracted`: detected items with evidence, suggestions marked "Öneri", selection (low
 *   confidence and past dates start unselected), per-item edits, "Hafızaya kaydet" (internal) and
 *   "{N} Öğeyi Onaya Gönder" → `POST /captures/:id/actions` → the batch approval sheet;
 * - after the batch approve (`approval_actions?batch_id=eq.{captureId}` has approved rows): progress,
 *   then the truthful success once every approved row is terminal and one executed (M§98), or the
 *   partial success with "Başarısızları gör".
 */
import { formatRelativeDay, toUpper } from '@da/i18n';
import type { Capture } from '@da/validation/api/common';
import {
  AnalysisProgressCard,
  BottomSheet,
  Button,
  ChipWrap,
  ChoiceChip,
  DetailHeader,
  EmptyState,
  ErrorCard,
  ExtractedItemRow,
  ListRow,
  NotFoundState,
  OfflineBanner,
  PrivacyNote,
  StickyCTABar,
  SuccessState,
  Text,
  TextField,
  useTheme,
} from '@da/ui';
import { qk } from '@da/api-client';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { toDataError } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { DateTimeFields, useLang, userTimeZone } from '../common/DateTimeFields';
import { openApprovalSheet } from '../approvals/ApprovalSheet';
import { APPROVAL_COLUMNS } from '../approvals/api';
import {
  fromApprovalRow,
  fromApprovalView,
  isTerminal,
  type ApprovalModel,
} from '../approvals/model';
import {
  analyzeCapture,
  discardCapture,
  proposeCaptureActions,
  type CaptureActionType,
} from './flows';

const LOW_CONFIDENCE = 0.7;
const SLOW_MS = 30_000;

export interface CaptureRowView {
  readonly id: string;
  readonly kind: Capture['kind'];
  readonly status: Capture['status'];
  readonly primaryType: string | null;
  readonly items: readonly Capture['items'][number][];
  readonly step: string | null;
  readonly reason: string | null;
  readonly errorCode: string | null;
  readonly title: string | null;
  readonly createdAt: string;
  readonly linkPreview: { readonly title: string | null; readonly domain: string } | null;
}

function parseCapture(raw: Record<string, unknown>): CaptureRowView {
  const progress = (raw.progress ?? {}) as Record<string, unknown>;
  const items = Array.isArray(raw.extracted) ? (raw.extracted as Capture['items'][number][]) : [];
  return {
    id: String(raw.id),
    kind: raw.kind as Capture['kind'],
    status: raw.status as Capture['status'],
    primaryType: typeof raw.primary_type === 'string' ? raw.primary_type : null,
    items,
    step: typeof progress.step === 'string' ? progress.step : null,
    reason: typeof progress.reason === 'string' ? progress.reason : null,
    errorCode: typeof raw.error_code === 'string' ? raw.error_code : null,
    title: typeof progress.title === 'string' ? progress.title : null,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    linkPreview:
      typeof raw.link_preview === 'object' && raw.link_preview !== null
        ? (raw.link_preview as { title: string | null; domain: string })
        : null,
  };
}

export async function fetchCapture(id: string): Promise<CaptureRowView | null> {
  const { data, error } = (await getSupabase()
    .from('captures')
    .select(
      'id, kind, status, primary_type, extracted, progress, error_code, link_preview, created_at',
    )
    .eq('id', id)
    .maybeSingle()) as {
    data: Record<string, unknown> | null;
    error: { message?: string; code?: string } | null;
  };
  if (error !== null) throw toDataError(error);
  return data === null ? null : parseCapture(data);
}

async function fetchBatch(captureId: string): Promise<readonly ApprovalModel[]> {
  const { data, error } = (await getSupabase()
    .from('approval_actions')
    .select(APPROVAL_COLUMNS)
    .eq('batch_id', captureId)) as {
    data: unknown[] | null;
    error: { message?: string; code?: string } | null;
  };
  if (error !== null) throw toDataError(error);
  return (data ?? [])
    .map((row) => fromApprovalRow(row))
    .filter((m): m is ApprovalModel => m !== null);
}

const ANALYZING: readonly string[] = ['pending_upload', 'uploaded', 'analyzing'];

function durationBucket(ms: number): '<5s' | '5-15s' | '15-60s' | '>60s' {
  if (ms < 5_000) return '<5s';
  if (ms < 15_000) return '5-15s';
  return ms < 60_000 ? '15-60s' : '>60s';
}

type FailureKey =
  'pdf_encrypted' | 'ocr_failed' | 'link_unreadable' | 'link_blocked' | 'timeout' | 'generic';

function failureKey(view: CaptureRowView): FailureKey {
  const reason = view.reason ?? view.errorCode ?? '';
  if (/encrypt|password/i.test(reason)) return 'pdf_encrypted';
  if (/ocr/i.test(reason)) return 'ocr_failed';
  if (/blocked|ssrf/i.test(reason)) return 'link_blocked';
  if (/link|fetch|unreadable/i.test(reason)) return 'link_unreadable';
  if (/timeout|UPSTREAM_TIMEOUT/i.test(reason)) return 'timeout';
  return 'generic';
}

function isPast(item: Capture['items'][number]): boolean {
  const date = item.fields.date ?? item.fields.start ?? item.fields.due;
  if (typeof date !== 'string') return false;
  const at = Date.parse(date.length === 10 ? `${date}T23:59:00` : date);
  return Number.isFinite(at) && at < now().getTime();
}

function defaultSelected(item: Capture['items'][number]): boolean {
  return (
    item.proposed_action !== null &&
    item.selected &&
    item.confidence >= LOW_CONFIDENCE &&
    !isPast(item)
  );
}

const ENTITY_TYPES = new Set([
  'event',
  'task',
  'deadline',
  'person',
  'payment',
  'reservation',
  'flight',
  'shipment',
  'product',
  'note',
]);

export function CaptureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTranslations('capture');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const tz = userTimeZone();
  const opened = useRef(now().getTime());
  const [slow, setSlow] = useState(false);
  const query = useQuery({
    queryKey: qk.captures.detail(id),
    queryFn: () => fetchCapture(id),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === undefined || !ANALYZING.includes(status)) return false;
      return now().getTime() - opened.current < 120_000 ? 1_000 : 5_000;
    },
  });
  const capture = query.data;
  const batch = useQuery({
    queryKey: qk.approvals.batch(id),
    queryFn: () => fetchBatch(id),
    enabled: capture?.status === 'extracted' || capture?.status === 'actioned',
    refetchInterval: (q) => ((q.state.data ?? []).some((m) => !isTerminal(m)) ? 2_000 : false),
  });
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [editing, setEditing] = useState<Capture['items'][number] | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAt, setEditAt] = useState<Date>(now());
  const [saveMemory, setSaveMemory] = useState(false);
  const [sending, setSending] = useState(false);
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (capture === undefined || capture === null) return;
    const key = `${capture.id}:${capture.status}`;
    if (tracked.current === key) return;
    tracked.current = key;
    if (capture.status === 'extracted') {
      track('capture_analyze_result', {
        kind: capture.kind,
        status: 'extracted',
        duration_bucket: durationBucket(now().getTime() - opened.current),
      });
      track('capture_results_view', {
        kind: capture.kind,
        item_count: capture.items.length,
        suggestion_count: capture.items.filter((i) => i.proposed_action !== null).length,
      });
    } else if (capture.status === 'failed') {
      track('capture_analyze_result', {
        kind: capture.kind,
        status: 'failed',
        duration_bucket: durationBucket(now().getTime() - opened.current),
      });
    }
  }, [capture]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  };

  const header = (
    <DetailHeader
      leading="close"
      onLeadingPress={close}
      leadingAccessibilityLabel={common('actions.close')}
      kicker={toUpper(t('title'), lang)}
    />
  );

  const frame = (children: React.ReactNode, footer?: React.ReactNode) => (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.captureDetail"
    >
      {header}
      {!online ? (
        <View style={{ paddingHorizontal: theme.layout.screenX }}>
          <OfflineBanner
            message={t('offlineAnalyzing')}
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
        {children}
      </ScrollView>
      {footer}
    </View>
  );

  if (query.isPending)
    return frame(<ListSkeleton rows={4} accessibilityLabel={common('a11y.loading')} />);
  if (query.isError && capture === undefined) {
    return frame(
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
        testID="capture.detail.error"
      />,
    );
  }
  if (capture === null || capture === undefined || capture.status === 'discarded') {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}>
        <NotFoundState
          variant="entity"
          title={states('notFound.entity.title')}
          body={states('notFound.entity.body')}
          backAction={{ label: common('actions.goBack'), onPress: close }}
          testID="capture.notFound"
        />
      </View>
    );
  }

  if (ANALYZING.includes(capture.status)) {
    const step = capture.step;
    const steps = [
      {
        key: 'read',
        label: t('steps.read'),
        state: step === null ? ('active' as const) : ('done' as const),
      },
      {
        key: 'extract',
        label: t('steps.extract'),
        state:
          step === 'extracting'
            ? ('active' as const)
            : step === 'done'
              ? ('done' as const)
              : ('pending' as const),
      },
      {
        key: 'ready',
        label: t('steps.ready'),
        state: step === 'done' ? ('active' as const) : ('pending' as const),
      },
    ];
    return frame(
      <View style={styles.section} testID="capture.analyzing">
        <AnalysisProgressCard
          kicker={slow ? t('slowKicker') : t('statuses.analyzing')}
          steps={steps}
          stateLabels={{
            done: t('stepStates.done'),
            active: t('stepStates.active'),
            pending: t('stepStates.pending'),
          }}
          cancel={{
            label: common('actions.cancel'),
            onPress: () => {
              track('capture_cancel', { stage: 'analyzing' });
              void discardCapture(capture.id)
                .catch(() => undefined)
                .finally(() => {
                  router.replace('/capture');
                });
            },
          }}
          testID="capture.progress"
        />
        <PrivacyNote text={capture.kind === 'link' ? t('privacy.link') : t('privacy.file')} />
      </View>,
    );
  }

  if (capture.status === 'failed') {
    const key = failureKey(capture);
    return frame(
      <ErrorCard
        icon="error"
        tone="neutral"
        title={t(`failures.${key}`)}
        primaryAction={{
          label: t('retry'),
          onPress: () => {
            void analyzeCapture(capture.id)
              .then(() => query.refetch())
              .catch(() => {
                showToast({ message: common('toast.saveFailed'), kind: 'error' });
              });
          },
        }}
        secondaryAction={{ label: common('actions.close'), onPress: close }}
        testID="capture.failed"
      />,
    );
  }

  const batchModels = batch.data ?? [];
  const batchStarted = batchModels.some(
    (m) =>
      m.status === 'approved' ||
      m.status === 'executing' ||
      m.status === 'executed' ||
      m.status === 'failed',
  );
  if (capture.status === 'actioned' || batchStarted) {
    const models = batchModels.filter((m) => m.status !== 'rejected' && m.status !== 'pending');
    const allTerminal = models.length > 0 && models.every(isTerminal);
    const executed = models.filter((m) => m.status === 'executed');
    const failed = models.filter((m) => m.status === 'failed');
    if (!allTerminal) {
      return frame(
        <View style={styles.section} testID="capture.executing">
          <Text variant="h3">{t('executing')}</Text>
          {batch.isPending ? (
            <ListSkeleton rows={2} accessibilityLabel={common('a11y.loading')} />
          ) : null}
          {models.map((model) => (
            <ListRow
              key={model.id}
              title={model.title}
              subtitle={model.summary}
              icon="hourglass_top"
            />
          ))}
        </View>,
      );
    }
    if (executed.length === 0) {
      return frame(
        <EmptyState
          icon="error"
          tone="neutral"
          title={t('success.noneTitle')}
          {...(isScreenAvailable('/approvals')
            ? {
                action: {
                  label: t('success.seeFailed'),
                  onPress: () => {
                    router.push('/approvals?view=history&status=failed');
                  },
                },
              }
            : {})}
          testID="capture.none"
        />,
      );
    }
    return frame(
      <View testID="capture.success">
        <SuccessOnce executed={executed.length} failed={failed.length} />
        <SuccessState
          title={
            failed.length === 0
              ? t('success.title')
              : t('success.partialTitle', { done: executed.length, total: models.length })
          }
          body={executed.map((m) => m.title).join(' · ')}
          results={
            <View style={styles.section}>
              {[...executed, ...failed].map((model) => (
                <ListRow
                  key={model.id}
                  title={model.title}
                  subtitle={model.status === 'executed' ? t('success.done') : t('success.failed')}
                  icon={model.status === 'executed' ? 'check_circle' : 'error'}
                  {...(isScreenAvailable(`/approvals/${model.id}`)
                    ? {
                        trailing: { kind: 'chevron' as const },
                        onPress: () => {
                          router.push(`/approvals/${model.id}`);
                        },
                      }
                    : {})}
                />
              ))}
              {failed.length > 0 && isScreenAvailable('/approvals') ? (
                <Button
                  label={t('success.seeFailed')}
                  variant="tonal"
                  onPress={() => {
                    router.push('/approvals?view=history&status=failed');
                  }}
                  testID="capture.success.failed"
                />
              ) : null}
            </View>
          }
          action={{
            label: common('actions.backToToday'),
            onPress: () => {
              router.replace('/today');
            },
          }}
          testID="capture.successState"
        />
      </View>,
    );
  }

  // extracted
  const items = capture.items;
  const isSelected = (item: Capture['items'][number]) =>
    selection[item.item_id] ?? defaultSelected(item);
  const chosen = items.filter((i) => i.proposed_action !== null && isSelected(i));
  const typeLabel = (type: string) =>
    ENTITY_TYPES.has(type) ? t(`entityTypes.${type as 'event'}`) : t('entityTypes.note');
  const send = async () => {
    if (!online || (chosen.length === 0 && !saveMemory)) return;
    setSending(true);
    try {
      const result = await proposeCaptureActions(
        capture.id,
        chosen.map((item) => ({
          itemId: item.item_id,
          action: item.proposed_action as CaptureActionType,
          ...(overrides[item.item_id] === undefined ? {} : { overrides: overrides[item.item_id] }),
        })),
        saveMemory,
      );
      for (const item of chosen) {
        if (ENTITY_TYPES.has(item.type))
          track('capture_action_proposed', { entity_type: item.type });
      }
      if (result.memory_saved) showToast({ message: t('memorySaved'), kind: 'success' });
      const approvals = result.approvals.map(fromApprovalView);
      if (approvals.length > 0) {
        openApprovalSheet({ approvals, mode: 'batch', origin: 'capture', captureId: capture.id });
      }
      void query.refetch();
    } catch {
      showToast({ message: common('toast.saveFailed'), kind: 'error' });
    } finally {
      setSending(false);
    }
  };

  const quickTypes = [
    ...new Set(
      items.map((i) => i.proposed_action).filter((a): a is NonNullable<typeof a> => a !== null),
    ),
  ];

  return frame(
    <View style={styles.section} testID="capture.results">
      {capture.title !== null ? <Text variant="h2">{capture.title}</Text> : null}
      {capture.linkPreview !== null ? (
        <Text variant="meta" tone="tertiaryStrong">
          {capture.linkPreview.domain}
        </Text>
      ) : null}
      {items.length === 0 ? (
        <View style={styles.section} testID="capture.results.empty">
          <Text variant="h3">{t('result.nothingFound')}</Text>
        </View>
      ) : (
        <>
          <Text variant="kicker" tone="tertiaryStrong">
            {toUpper(
              t('result.detectedCount', {
                count: items.length,
                type: typeLabel(capture.primaryType ?? 'note'),
              }),
              lang,
            )}
          </Text>
          {quickTypes.length > 1 ? (
            <ChipWrap>
              {quickTypes.map((action) => {
                const rows = items.filter((i) => i.proposed_action === action);
                const all = rows.every((i) => isSelected(i));
                return (
                  <ChoiceChip
                    key={action}
                    label={t(`quick.${action as CaptureActionType}`, { count: rows.length })}
                    selected={all}
                    onPress={() => {
                      setSelection((current) => {
                        const next = { ...current };
                        for (const row of rows) next[row.item_id] = !all;
                        return next;
                      });
                    }}
                    testID={`capture.quick.${action}`}
                  />
                );
              })}
            </ChipWrap>
          ) : null}
          {items.map((item) => {
            const page = item.evidence.find((e) => e.page !== undefined)?.page;
            const quote = item.evidence[0]?.quote;
            const warnings = [
              isPast(item) ? t('warnings.past') : null,
              item.confidence < LOW_CONFIDENCE ? t('warnings.lowConfidence') : null,
            ].filter((w): w is string => w !== null);
            const title =
              typeof overrides[item.item_id]?.title === 'string'
                ? String(overrides[item.item_id]?.title)
                : item.title;
            return (
              <View key={item.item_id} style={styles.item}>
                <ExtractedItemRow
                  type={ENTITY_TYPES.has(item.type) ? item.type : 'note'}
                  typeLabel={typeLabel(item.type)}
                  title={title}
                  {...(page === undefined
                    ? quote === undefined
                      ? {}
                      : { sourceRef: quote }
                    : { sourceRef: t('pageRef', { page }) })}
                  {...(item.proposed_action === null ? {} : { suggestionLabel: t('suggestion') })}
                  selected={isSelected(item)}
                  onToggle={() => {
                    if (item.proposed_action === null) return;
                    const next = !isSelected(item);
                    setSelection((current) => ({ ...current, [item.item_id]: next }));
                  }}
                  testID={`capture.item.${item.item_id}`}
                />
                {warnings.length > 0 ? (
                  <Text variant="meta" tone="warning">
                    {warnings.join(' · ')}
                  </Text>
                ) : null}
                {item.proposed_action !== null ? (
                  <Text variant="meta" tone="tertiaryStrong">
                    {t(`actions.${item.proposed_action as CaptureActionType}`)}
                  </Text>
                ) : null}
                {item.proposed_action !== null ? (
                  <Button
                    label={common('actions.edit')}
                    variant="ghost"
                    size="xs"
                    onPress={() => {
                      setEditing(item);
                      setEditTitle(title);
                      const date = item.fields.start ?? item.fields.date;
                      setEditAt(
                        typeof date === 'string' && Number.isFinite(Date.parse(date))
                          ? new Date(date)
                          : now(),
                      );
                    }}
                    testID={`capture.item.edit.${item.item_id}`}
                  />
                ) : null}
              </View>
            );
          })}
        </>
      )}
      <ListRow
        title={t('saveToMemory')}
        subtitle={t('noApprovalNeeded')}
        trailing={{ kind: 'switch', value: saveMemory }}
        density="twoLineTrailing"
        onPress={() => {
          setSaveMemory(!saveMemory);
        }}
        testID="capture.saveMemory"
      />
      <Text variant="meta" tone="tertiaryStrong">
        {formatRelativeDay(capture.createdAt === '' ? now().toISOString() : capture.createdAt, {
          locale: lang,
          now: now().getTime(),
          timeZone: tz,
        })}
      </Text>
      <BottomSheet
        visible={editing !== null}
        onDismiss={() => {
          setEditing(null);
        }}
        title={t('editItem')}
        testID="sheet.captureItem"
        footer={
          <Button
            label={common('actions.save')}
            fullWidth
            onPress={() => {
              if (editing === null) return;
              const title = editTitle.trim();
              setOverrides((current) => ({
                ...current,
                [editing.item_id]: {
                  ...(title === '' ? {} : { title }),
                  date: editAt.toISOString(),
                },
              }));
              if (ENTITY_TYPES.has(editing.type))
                track('capture_item_edit', { entity_type: editing.type });
              setEditing(null);
            }}
            testID="captureItem.save"
          />
        }
      >
        <View style={styles.section}>
          <TextField
            label={t('itemTitle')}
            value={editTitle}
            onChangeText={setEditTitle}
            testID="captureItem.title"
          />
          <DateTimeFields value={editAt} onChange={setEditAt} testID="captureItem.when" />
        </View>
      </BottomSheet>
    </View>,
    <StickyCTABar>
      {!online ? (
        <Text variant="meta" tone="warning">
          {states('offline.blockedReason')}
        </Text>
      ) : null}
      <Button
        label={
          chosen.length === 0 && saveMemory
            ? t('saveToMemory')
            : t('sendToApproval', { count: chosen.length })
        }
        onPress={() => {
          void send();
        }}
        disabled={!online || (chosen.length === 0 && !saveMemory)}
        loading={sending}
        fullWidth
        testID="capture.send"
      />
    </StickyCTABar>,
  );
}

function SuccessOnce({ executed, failed }: { readonly executed: number; readonly failed: number }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    track('capture_success_view', { executed, failed });
  }, [executed, failed]);
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 14, paddingBottom: 140 },
  section: { gap: 10 },
  item: { gap: 4 },
});
