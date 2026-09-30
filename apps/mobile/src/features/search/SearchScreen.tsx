/**
 * M-SRCH-01 Arama (`/search`, params `q`, `types`, `contactId`): keyword search across emails,
 * people, calendar, tasks, commitments, life events, memories and captures (M§95) with provenance
 * on every row and SREQ-41 routing. `GET /search?mode=results` (300 ms debounce, 2-char minimum,
 * the previous request aborted by the query signal); FTS for Free, hybrid for Pro; the "Hafıza"
 * scope is Pro. Offline it searches only this device's cached data. No query text in analytics.
 */
import { isApiError } from '@da/api-client';
import { searchQueryOptions, useApiClient } from '@da/api-client/react';
import { foldForSearch, formatRelativeDay, toUpper } from '@da/i18n';
import type { SearchResult } from '@da/validation/api/common';
import {
  ChipWrap,
  ErrorCard,
  FilterChipRow,
  GroupedList,
  ListRow,
  OptionRow,
  SearchField,
  SectionHeader,
  SuggestionChip,
  Text,
  TextAction,
  useTheme,
  type IconName,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { isUuid } from '@da/domain';
import { qk } from '@da/api-client';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { ListSkeleton } from '../common/ListSkeleton';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import type { ThreadRow } from '../assistant/data';
import { clearRecents, pushRecent, readRecents } from './recents';
import { looksLikeQuestion, rankBucket, resultRoute, resultsBucket } from './routes';

export const SEARCH_SCOPES = [
  'all',
  'email',
  'person',
  'event',
  'task',
  'commitment',
  'life_event',
  'memory',
  'capture',
] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

const ICONS: Readonly<Record<SearchResult['type'], IconName>> = {
  email: 'mail',
  person: 'person',
  event: 'event',
  task: 'task_alt',
  commitment: 'handshake',
  life_event: 'flight',
  memory: 'memory',
  capture: 'description',
};

const DEBOUNCE_MS = 300;

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return debounced;
}

function isScope(value: unknown): value is SearchScope {
  return (SEARCH_SCOPES as readonly unknown[]).includes(value);
}

export function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string; types?: string; contactId?: string }>();
  const t = useTranslations('search');
  const common = useTranslations('common');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const tz = userTimeZone();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const pro = isPro();
  const [text, setText] = useState(params.q ?? '');
  const initialScope = params.types?.split(',')[0];
  const [scope, setScope] = useState<SearchScope>(isScope(initialScope) ? initialScope : 'all');
  const [recents, setRecents] = useState(() => readRecents('search.recents'));
  const contactId =
    params.contactId !== undefined && isUuid(params.contactId) ? params.contactId : null;
  const debounced = useDebounced(text.trim(), DEBOUNCE_MS);
  const gated = scope === 'memory' && !pro;
  const enabled = debounced.length >= 2 && online && !gated;
  const query = useQuery({
    ...searchQueryOptions(api, {
      q: debounced.length >= 2 ? debounced : 'xx',
      mode: 'results',
      ...(scope === 'all' ? {} : { types: scope }),
      ...(contactId === null ? {} : { contact_id: contactId }),
    }),
    enabled,
    placeholderData: (previous) => previous,
  });
  const results = enabled ? (query.data?.results ?? []) : [];
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || query.data === undefined || query.isPlaceholderData) return;
    const key = `${debounced}|${scope}`;
    if (tracked.current === key) return;
    tracked.current = key;
    const count = query.data.results.length;
    track('search_performed', {
      mode: query.data.mode,
      scope_count: scope === 'all' ? SEARCH_SCOPES.length - 1 : 1,
      has_contact_filter: contactId !== null,
      results_bucket: resultsBucket(count),
      result_count: count,
    });
    if (count === 0) track('search_no_results');
    AccessibilityInfo.announceForAccessibility(t('resultsA11y', { count }));
    setRecents(pushRecent('search.recents', debounced));
  }, [enabled, query.data, query.isPlaceholderData, debounced, scope, contactId, t]);

  const offlineResults = useMemo(() => {
    if (online || debounced.length < 2) return [];
    const needle = foldForSearch(debounced, lang);
    const threads = queryClient.getQueryData<readonly ThreadRow[]>(qk.assistant.threads()) ?? [];
    const vips =
      queryClient.getQueryData<readonly { contactId: string; name: string }[]>(qk.vip.list()) ?? [];
    return [
      ...vips
        .filter((v) => foldForSearch(v.name, lang).includes(needle))
        .map((v) => ({
          key: `vip-${v.contactId}`,
          title: v.name,
          route: `/person/${v.contactId}`,
        })),
      ...threads
        .filter((th) => foldForSearch(th.title ?? '', lang).includes(needle))
        .map((th) => ({ key: `th-${th.id}`, title: th.title ?? '', route: `/chat/${th.id}` })),
    ].filter((r) => isScreenAvailable(r.route));
  }, [online, debounced, lang, queryClient]);

  const open = (result: SearchResult, rank: number) => {
    const route = resultRoute(result);
    if (route === null) return;
    track('search_result_opened', { result_type: result.type, rank_bucket: rankBucket(rank) });
    router.push(route);
  };

  const groups = SEARCH_SCOPES.filter((s): s is Exclude<SearchScope, 'all'> => s !== 'all')
    .map((type) => ({ type, items: results.filter((r) => r.type === type) }))
    .filter((g) => g.items.length > 0);

  const memoryRow =
    looksLikeQuestion(text) && isScreenAvailable('/memory') ? (
      <OptionRow
        label={t('askMemory')}
        icon="auto_awesome"
        ai
        role="button"
        onPress={() => {
          router.push(`/memory?q=${encodeURIComponent(text.trim())}`);
        }}
        testID="search.askMemory"
      />
    ) : null;

  let body;
  if (gated) {
    body = <ContextualGate feature="ai_memory" testID="search.memoryGate" />;
  } else if (!online) {
    body = (
      <View style={styles.section} testID="search.offline">
        <Text variant="kicker" tone="tertiaryStrong">
          {toUpper(t('offlineHeader'), lang)}
        </Text>
        {offlineResults.length === 0 ? (
          debounced.length >= 2 ? (
            <Text variant="secondary">{t('noResultsBody', { query: debounced })}</Text>
          ) : null
        ) : (
          <GroupedList>
            {offlineResults.map((row) => (
              <ListRow
                key={row.key}
                title={row.title}
                trailing={{ kind: 'chevron' }}
                onPress={() => {
                  router.push(row.route);
                }}
              />
            ))}
          </GroupedList>
        )}
      </View>
    );
  } else if (debounced.length < 2) {
    body = (
      <View style={styles.section} testID="search.idle">
        {recents.length > 0 ? (
          <>
            <SectionHeader
              title={t('recents')}
              action={
                <TextAction
                  label={t('clearRecents')}
                  compact
                  onPress={() => {
                    clearRecents('search.recents');
                    setRecents([]);
                  }}
                  testID="search.recents.clear"
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
                    setText(recent);
                  }}
                  testID={`search.recent.${recent}`}
                />
              ))}
            </GroupedList>
          </>
        ) : null}
        <SectionHeader title={t('examplesKicker')} />
        <ChipWrap>
          {[
            t('examples.flightTicket'),
            t('examples.meetings'),
            t('examples.bills'),
            t('examples.proposalMail'),
          ].map((example) => (
            <SuggestionChip
              key={example}
              label={example}
              onPress={() => {
                setText(example);
              }}
            />
          ))}
        </ChipWrap>
      </View>
    );
  } else if (query.isError && query.data === undefined) {
    const rateLimited = isApiError(query.error) && query.error.code === 'RATE_LIMITED';
    body = (
      <ErrorCard
        icon="error"
        tone="neutral"
        title={rateLimited ? t('rateLimited') : t('failed')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="search.error"
      />
    );
  } else if (query.isPending) {
    body = <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />;
  } else if (results.length === 0) {
    body = (
      <View style={styles.section} testID="search.noResults">
        <Text variant="h3">{t('noResultsTitle')}</Text>
        <Text variant="secondary">{t('noResultsBody', { query: debounced })}</Text>
        {pro ? memoryRow : null}
      </View>
    );
  } else {
    const offsets = groups.map((_, index) =>
      groups
        .slice(0, index)
        .reduce(
          (sum, g) => sum + (scope === 'all' ? Math.min(3, g.items.length) : g.items.length),
          0,
        ),
    );
    body = (
      <View
        style={[styles.section, query.isFetching ? styles.stale : null]}
        testID="search.results"
      >
        {pro ? memoryRow : null}
        <Text variant="kicker" tone="tertiaryStrong">
          {toUpper(t('count', { count: results.length }), lang)}
        </Text>
        {groups.map((group, groupIndex) => {
          const shown = scope === 'all' ? group.items.slice(0, 3) : group.items;
          const offset = offsets[groupIndex] ?? 0;
          return (
            <View key={group.type} style={styles.section}>
              <SectionHeader
                title={toUpper(t(`groups.${group.type}`), lang)}
                count={String(group.items.length)}
              />
              <GroupedList>
                {shown.map((result, index) => {
                  const position = offset + index + 1;
                  const route = resultRoute(result);
                  const time = formatRelativeDay(result.source.source_timestamp, {
                    locale: lang,
                    now: now().getTime(),
                    timeZone: tz,
                  });
                  const source = [result.source.label ?? '', time]
                    .filter((p) => p !== '')
                    .join(' · ');
                  return (
                    <ListRow
                      key={`${result.type}-${result.id}`}
                      title={result.title}
                      subtitle={[result.snippet, source].filter((p) => p !== '').join(' · ')}
                      icon={ICONS[result.type]}
                      density="twoLine"
                      {...(route === null
                        ? {}
                        : {
                            trailing: { kind: 'chevron' as const },
                            onPress: () => {
                              open(result, position);
                            },
                          })}
                      testID={`search.result.${result.id}`}
                    />
                  );
                })}
              </GroupedList>
              {scope === 'all' && group.items.length > 3 ? (
                <TextAction
                  label={t('seeAll', { count: group.items.length })}
                  onPress={() => {
                    setScope(group.type);
                    track('search_scope_changed', { scope: group.type });
                  }}
                  testID={`search.seeAll.${group.type}`}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top + 8 }]}
      testID="screen.search"
    >
      <View style={[styles.header, { paddingHorizontal: theme.layout.screenX }]}>
        <View style={styles.field}>
          <SearchField
            value={text}
            onChangeText={setText}
            placeholder={t('hint')}
            accessibilityLabel={t('title')}
            clearLabel={common('actions.remove')}
            autoFocus
            onSubmit={() => {
              setRecents(pushRecent('search.recents', text));
            }}
            testID="search.field"
          />
        </View>
        <TextAction
          label={common('actions.cancel')}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/assistant');
          }}
          testID="search.cancel"
        />
      </View>
      <View style={{ paddingHorizontal: theme.layout.screenX }}>
        <FilterChipRow
          items={SEARCH_SCOPES.map((key) => ({
            key,
            label: key === 'memory' && !pro ? t('scopes.memoryLocked') : t(`scopes.${key}`),
          }))}
          selectedKey={scope}
          onSelect={(key) => {
            if (!isScope(key)) return;
            setScope(key);
            track('search_scope_changed', { scope: key });
          }}
          semantics="tabs"
          testID="search.scopes"
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  field: { flex: 1 },
  content: { gap: 14, paddingBottom: 40, paddingTop: 12 },
  section: { gap: 8 },
  stale: { opacity: 0.6 },
});
