/**
 * M-MEM-01 AI Hafıza (`/memory`, params `q`, `filter`, `recent`, `contactId`): natural-language
 * questions across long-term memory (M§26). `GET /search?mode=answer` returns the grounded answer
 * (a qualitative confidence label, never a percentage), its source cards ("Orijinali Aç") and
 * related questions; every record is bound to the retention window (footer). Pro only: Free sees
 * the contextual gate and a link to the always-free Search. Not persisted; offline shows the
 * connection-required state.
 */
import { isApiError } from '@da/api-client';
import { searchQueryOptions, useApiClient } from '@da/api-client/react';
import { formatRelativeDay, toUpper } from '@da/i18n';
import type { SearchResult } from '@da/validation/api/common';
import {
  AiGlowSurface,
  ChipWrap,
  ErrorCard,
  FilterChip,
  GroupedList,
  ListRow,
  OfflineScreen,
  SearchField,
  SectionHeader,
  SkeletonBlock,
  SourceResultCard,
  SuggestionChip,
  Text,
  TextAction,
  TokenChip,
  useTheme,
  type IconName,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { isUuid } from '@da/domain';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { clearRecents, pushRecent, readRecents } from './recents';
import { rankBucket, resultRoute } from './routes';

export const MEMORY_FILTERS = ['all', 'email', 'event', 'note', 'document'] as const;
export type MemoryFilter = (typeof MEMORY_FILTERS)[number];

const TYPES: Readonly<Record<MemoryFilter, string | undefined>> = {
  all: undefined,
  email: 'email',
  event: 'event',
  note: 'memory',
  document: 'capture',
};

const ICONS: Readonly<Record<SearchResult['type'], IconName>> = {
  email: 'mail',
  person: 'person',
  event: 'event',
  task: 'task_alt',
  commitment: 'handshake',
  life_event: 'flight',
  memory: 'edit_note',
  capture: 'description',
};

const DAY_MS = 86_400_000;

const SOURCE_TYPE_KEYS = [
  'email_message',
  'email_thread',
  'calendar_event',
  'device_calendar_event',
  'task',
  'capture',
  'meeting_note',
  'post_meeting_note',
  'android_notification',
  'assistant_message',
  'user_input',
  'commitment',
  'life_event',
  'contact',
] as const;
type SourceTypeKey = (typeof SOURCE_TYPE_KEYS)[number];

function isFilter(value: unknown): value is MemoryFilter {
  return (MEMORY_FILTERS as readonly unknown[]).includes(value);
}

function countBucket(count: number): '0' | '1' | '2-3' | '4+' {
  if (count === 0) return '0';
  if (count === 1) return '1';
  return count <= 3 ? '2-3' : '4+';
}

/** The answer text with its emphasis spans as bold runs (never colour-only). */
function Emphasis({
  text,
  spans,
}: {
  readonly text: string;
  readonly spans: readonly { start: number; end: number }[];
}) {
  const parts: { text: string; bold: boolean }[] = [];
  let cursor = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start), bold: false });
    parts.push({ text: text.slice(span.start, span.end), bold: true });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), bold: false });
  return (
    <Text variant="body" selectable testID="memory.answer.text">
      {parts.map((part, index) => (
        <Text key={`${String(index)}-${part.text}`} variant="body" weight={part.bold ? 600 : 400}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

export function MemoryScreen() {
  const params = useLocalSearchParams<{
    q?: string;
    filter?: string;
    recent?: string;
    contactId?: string;
  }>();
  const t = useTranslations('memory');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const privacy = useTranslations('privacy.retention.options');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const tz = userTimeZone();
  const api = useApiClient();
  const pro = isPro();
  const sourceTypeLabel = (type: string) =>
    SOURCE_TYPE_KEYS.includes(type as SourceTypeKey)
      ? common(`sourceTypes.${type as SourceTypeKey}`)
      : '';
  const [text, setText] = useState(params.q ?? '');
  const [submitted, setSubmitted] = useState((params.q ?? '').trim());
  const [filter, setFilter] = useState<MemoryFilter>(
    isFilter(params.filter) ? params.filter : 'all',
  );
  const [recent30, setRecent30] = useState(params.recent === '30d');
  const [contactId, setContactId] = useState(
    params.contactId !== undefined && isUuid(params.contactId) ? params.contactId : null,
  );
  const [recents, setRecents] = useState(() => readRecents('memory.recents'));
  const types = TYPES[filter];
  const from = recent30 ? new Date(now().getTime() - 30 * DAY_MS).toISOString() : undefined;
  const enabled = pro && online && submitted.length >= 2;
  const query = useQuery({
    ...searchQueryOptions(api, {
      q: submitted.length >= 2 ? submitted : 'xx',
      mode: 'answer',
      ...(types === undefined ? {} : { types }),
      ...(from === undefined ? {} : { from }),
      ...(contactId === null ? {} : { contact_id: contactId }),
    }),
    enabled,
  });
  const tracked = useRef<string | null>(null);
  const policy = cachedBootstrap()?.preferences.retention_policy ?? 'd90';

  useEffect(() => {
    if (!pro)
      track('pro_gate_viewed', {
        feature: 'ai_memory',
        surface: 'screen',
        gate: 'ai_memory',
        context: 'screen',
      });
  }, [pro]);

  useEffect(() => {
    const data = query.data;
    if (!enabled || data === undefined) return;
    const key = `${submitted}|${filter}|${String(recent30)}|${contactId ?? ''}`;
    if (tracked.current === key) return;
    tracked.current = key;
    const sources = data.sources ?? data.results;
    if (data.answer !== undefined) {
      track('memory_answer_shown', {
        confidence_label:
          data.answer.confidence_label === 'high'
            ? 'assertive'
            : data.answer.confidence_label === 'partial'
              ? 'probably'
              : 'uncertain',
        source_count_bucket: countBucket(sources.length),
      });
    }
    if (sources.length === 0) {
      track('memory_no_results', {
        reason: data.excluded_by_retention === true ? 'retention' : 'none',
      });
    }
  }, [enabled, query.data, submitted, filter, recent30, contactId]);

  const submit = (value: string) => {
    const q = value.trim();
    if (q.length < 2) return;
    setText(q);
    setSubmitted(q);
    setRecents(pushRecent('memory.recents', q));
    track('memory_search_submitted', {
      filter: filter === 'document' ? 'capture' : filter === 'note' ? 'all' : filter,
      has_date_filter: recent30,
      scoped: contactId !== null,
    });
  };

  const openSource = (result: SearchResult, rank: number) => {
    const route = resultRoute(result);
    if (route === null) return;
    track('memory_result_opened', {
      source_type: result.source.source_type,
      rank_bucket: rankBucket(rank),
    });
    router.push(route);
  };

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/assistant');
  };

  if (!pro) {
    return (
      <View
        style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top + 8 }]}
        testID="screen.memory"
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        >
          <TextAction
            label={common('actions.back')}
            icon="arrow_back"
            onPress={back}
            testID="memory.back"
          />
          <ContextualGate
            feature="ai_memory"
            title={t('gate.title')}
            body={t('gate.body')}
            testID="memory.gate"
          />
          {isScreenAvailable('/search') ? (
            <TextAction
              label={t('gate.searchFree')}
              onPress={() => {
                router.replace('/search');
              }}
              testID="memory.searchFree"
            />
          ) : null}
        </ScrollView>
      </View>
    );
  }

  const data = query.data;
  const sources = data?.sources ?? data?.results ?? [];
  let body;
  if (!online) {
    body = (
      <OfflineScreen
        title={t('offlineTitle')}
        body={states('offline.noCache.body')}
        retryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="memory.offline"
      />
    );
  } else if (submitted.length < 2) {
    body = (
      <View style={styles.section} testID="memory.idle">
        {recents.length > 0 ? (
          <>
            <SectionHeader
              title={t('recents')}
              action={
                <TextAction
                  label={t('clearRecents')}
                  compact
                  onPress={() => {
                    clearRecents('memory.recents');
                    setRecents([]);
                  }}
                />
              }
            />
            <GroupedList>
              {recents.map((recent) => (
                <ListRow
                  key={recent}
                  title={recent}
                  icon="history"
                  iconStyle="bare"
                  onPress={() => {
                    submit(recent);
                  }}
                />
              ))}
            </GroupedList>
          </>
        ) : null}
        <SectionHeader title={t('examplesKicker')} />
        <ChipWrap>
          {[t('examples.flight'), t('examples.payments'), t('examples.lastTalk')].map((example) => (
            <SuggestionChip
              key={example}
              label={example}
              onPress={() => {
                submit(example);
              }}
            />
          ))}
        </ChipWrap>
      </View>
    );
  } else if (query.isPending) {
    body = (
      <View style={styles.section} testID="memory.loading">
        <Text variant="h3">{submitted}</Text>
        <SkeletonBlock width="100%" height={16} radius={6} />
        <SkeletonBlock width="85%" height={16} radius={6} />
        <SkeletonBlock width="60%" height={16} radius={6} />
      </View>
    );
  } else if (query.isError) {
    const code = isApiError(query.error) ? query.error.code : null;
    body = (
      <ErrorCard
        icon={
          code === 'AI_UNAVAILABLE'
            ? 'cloud_off'
            : code === 'QUOTA_EXCEEDED'
              ? 'hourglass_empty'
              : 'error'
        }
        tone="neutral"
        title={
          code === 'AI_UNAVAILABLE'
            ? states('error.aiUnavailable.title')
            : code === 'QUOTA_EXCEEDED'
              ? states('limit.ai.title')
              : states('error.action.title')
        }
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="memory.error"
      />
    );
  } else if (data !== undefined && sources.length === 0) {
    body =
      data.excluded_by_retention === true ? (
        <View style={styles.section} testID="memory.retention">
          <Text variant="h3">{t('retentionExcluded', { retention: privacy(policy) })}</Text>
          {isScreenAvailable('/settings/privacy/retention') ? (
            <TextAction
              label={t('retentionSetting')}
              onPress={() => {
                router.push('/settings/privacy/retention');
              }}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.section} testID="memory.noResults">
          <Text variant="h3">{t('noResultsTitle')}</Text>
          <Text variant="secondary">{t('noResultsBody')}</Text>
          {filter !== 'all' || recent30 || contactId !== null ? (
            <TextAction
              label={t('clearFilters')}
              onPress={() => {
                setFilter('all');
                setRecent30(false);
                setContactId(null);
              }}
              testID="memory.clearFilters"
            />
          ) : null}
        </View>
      );
  } else if (data !== undefined) {
    const answer = data.answer;
    body = (
      <View style={styles.section} testID="memory.results">
        <Text variant="h3">{submitted}</Text>
        {answer === undefined ? (
          <Text variant="secondary" testID="memory.noSummary">
            {t('noSummary')}
          </Text>
        ) : (
          <AiGlowSurface
            padding={16}
            radius="card"
            testID="memory.answer"
            accessibilityLiveRegion="polite"
          >
            <Text variant="kickerAi" tone="accent">
              {toUpper(t('answerKicker'), lang)}
            </Text>
            <Emphasis
              text={
                answer.confidence_label === 'unsure' &&
                !answer.text.startsWith(common('provenance.notSure'))
                  ? `${common('provenance.notSure')}; ${answer.text}`
                  : answer.text
              }
              spans={answer.confidence_label === 'unsure' ? [] : answer.emphasis_spans}
            />
            <Text variant="meta" tone="tertiaryStrong">
              {t('answerMeta', {
                count: answer.source_count,
                label: t(`confidence.${answer.confidence_label}`),
              })}
            </Text>
            {isScreenAvailable('/chat/new') ? (
              <TextAction
                label={t('askAssistant')}
                compact
                onPress={() => {
                  router.push(`/chat/new?prompt=${encodeURIComponent(submitted)}&origin=memory`);
                }}
                testID="memory.askAssistant"
              />
            ) : null}
          </AiGlowSurface>
        )}
        <SectionHeader title={toUpper(t('sourcesKicker', { count: sources.length }), lang)} />
        {sources.map((source, index) => {
          const route = resultRoute(source);
          return (
            <SourceResultCard
              key={`${source.type}-${source.id}`}
              sourceIcon={ICONS[source.type]}
              sourceName={source.source.label ?? sourceTypeLabel(source.source.source_type)}
              date={formatRelativeDay(source.source.source_timestamp, {
                locale: lang,
                now: now().getTime(),
                timeZone: tz,
              })}
              title={source.title}
              excerpt={source.snippet}
              openLabel={t('openOriginal')}
              onOpen={() => {
                openSource(source, index + 1);
              }}
              {...(route === null
                ? {}
                : {
                    onPress: () => {
                      openSource(source, index + 1);
                    },
                  })}
              testID={`memory.source.${source.id}`}
            />
          );
        })}
        {(data.related_questions ?? []).length > 0 ? (
          <>
            <SectionHeader title={toUpper(t('relatedKicker'), lang)} />
            <GroupedList>
              {(data.related_questions ?? []).map((question) => (
                <ListRow
                  key={question}
                  title={question}
                  trailing={{ kind: 'chevron' }}
                  onPress={() => {
                    submit(question);
                  }}
                />
              ))}
            </GroupedList>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top + 8 }]}
      testID="screen.memory"
    >
      <View style={[styles.header, { paddingHorizontal: theme.layout.screenX }]}>
        <TextAction
          label={common('actions.back')}
          icon="arrow_back"
          onPress={back}
          testID="memory.back"
        />
        <View style={styles.field}>
          <SearchField
            value={text}
            onChangeText={setText}
            placeholder={t('searchHint')}
            accessibilityLabel={t('title')}
            clearLabel={common('actions.remove')}
            onSubmit={() => {
              submit(text);
            }}
            testID="memory.field"
          />
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.filters, { paddingHorizontal: theme.layout.screenX }]}
        accessibilityRole="tablist"
      >
        {contactId !== null ? (
          <TokenChip
            label={t('scoped')}
            onRemove={() => {
              setContactId(null);
            }}
            removeLabel={common('actions.remove')}
          />
        ) : null}
        {MEMORY_FILTERS.map((key) => (
          <FilterChip
            key={key}
            label={t(`filters.${key}`)}
            selected={filter === key}
            role="tab"
            onPress={() => {
              setFilter(key);
            }}
            testID={`memory.filter.${key}`}
          />
        ))}
        <FilterChip
          label={t('filters.recent30')}
          selected={recent30}
          onPress={() => {
            setRecent30(!recent30);
          }}
          testID="memory.filter.recent30"
        />
      </ScrollView>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        {body}
        {isScreenAvailable('/settings/privacy/retention') ? (
          <TextAction
            label={t('retentionFooter', { retention: privacy(policy) })}
            icon="history"
            compact
            onPress={() => {
              router.push('/settings/privacy/retention');
            }}
            testID="memory.retentionFooter"
          />
        ) : (
          <Text variant="meta" tone="tertiaryStrong" testID="memory.retentionFooter">
            {t('retentionFooter', { retention: privacy(policy) })}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  field: { flex: 1 },
  filters: { gap: 8, paddingVertical: 10 },
  content: { gap: 14, paddingBottom: 40 },
  section: { gap: 10 },
});
