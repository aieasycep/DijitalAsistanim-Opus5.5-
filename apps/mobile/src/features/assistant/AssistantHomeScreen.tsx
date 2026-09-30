/**
 * M-ASST-01 Asistan · Giriş (the Asistan tab root; never an empty chat): the summary banner,
 * deterministic suggested prompts (M§24 + "Ödenmesi gereken bir şey var mı?"), recent persisted
 * threads (swipe or accessibility action "Sil" with a confirm) and the composer whose primary
 * control is the mic (M§25). "+" opens Universal Capture, the search icon Search, "Hafıza" the
 * memory screen. Offline the composer and prompts are disabled; cached threads stay openable.
 */
import { qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import { formatRelativeDay, toLocalDateString, toUpper } from '@da/i18n';
import {
  ChatComposer,
  ConfirmDialog,
  ErrorCard,
  ExternalCredentialRequired,
  GroupedList,
  HeaderPill,
  IconButton,
  ListRow,
  OfflineBanner,
  OptionRow,
  RootHeader,
  SectionHeader,
  SwipeableRow,
  Text,
  TextAction,
  useTheme,
} from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useScrollToTop } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { unavailableReason } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import type { TodayData } from '../today/data';
import { deleteThread, useThreads, type ThreadRow } from './data';
import { buildSuggestedPrompts, type SuggestedPrompt } from './prompts';
import { usePromptText } from './usePromptText';

const PAGE = 20;

export function AssistantHomeScreen() {
  const t = useTranslations('assistant');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const tz = userTimeZone();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const threads = useThreads();
  const promptText = usePromptText();
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState<ThreadRow | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const scroll = useRef<ScrollView>(null);
  useScrollToTop(scroll);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current || threads.data === undefined) return;
    opened.current = true;
    track('assistant_opened', { has_threads: threads.data.length > 0 });
  }, [threads.data]);

  const data = bootstrap.data;
  const today = queryClient.getQueryData<TodayData>(qk.today.day(toLocalDateString(now(), tz)));
  const vips = queryClient.getQueryData<readonly { readonly name: string }[]>(qk.vip.list());
  const prompts = buildSuggestedPrompts({
    now: now(),
    personName: vips?.[0]?.name ?? null,
    nextMeetingAt: today?.overview.next_meeting?.start_at ?? null,
    paymentDueAt: (today?.overview.life_intel ?? [])
      .filter((l) => l.type === 'payment' || l.type === 'subscription')
      .map((l) => l.due_at)
      .filter((d): d is string => d !== null),
  });
  const aiReason = unavailableReason(data, 'assistant');
  const blocked = !online || aiReason !== null;

  const openPrompt = (prompt: SuggestedPrompt) => {
    if (blocked) return;
    router.push(
      `/chat/new?prompt=${encodeURIComponent(prompt.key)}${
        prompt.name === undefined ? '' : `&name=${encodeURIComponent(prompt.name)}`
      }&origin=assistant`,
    );
  };
  const sendText = () => {
    const value = text.trim();
    if (value === '' || blocked) return;
    setText('');
    router.push(`/chat/new?prompt=${encodeURIComponent(value)}&origin=assistant`);
  };
  const remove = async (thread: ThreadRow) => {
    setConfirm(null);
    try {
      await deleteThread(thread.id);
      track('assistant_thread_deleted');
      showToast({ message: t('thread.deleted'), kind: 'success' });
      void threads.refetch();
    } catch {
      showToast({ message: common('toast.saveFailed'), kind: 'error' });
    }
  };

  const summary = data?.accounts.length === 0 ? t('summaryNoAccounts') : t('summaryFallback');

  const header = (
    <RootHeader
      kicker={toUpper(common('tabs.assistant'), lang)}
      title={t('title')}
      trailing={
        <View style={styles.headerActions}>
          {isScreenAvailable('/search') ? (
            <IconButton
              icon="search"
              accessibilityLabel={common('actions.search')}
              onPress={() => {
                track('search_opened', { from: 'assistant' });
                router.push('/search');
              }}
              testID="assistant.search"
            />
          ) : null}
          {isScreenAvailable('/memory') ? (
            <HeaderPill
              label={t('memoryPill')}
              icon="search"
              onPress={() => {
                router.push('/memory');
              }}
              testID="assistant.memory"
            />
          ) : null}
        </View>
      }
    />
  );

  const shown = (threads.data ?? []).slice(0, visibleCount);
  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.assistant"
    >
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        keyboardShouldPersistTaps="handled"
      >
        {header}
        {!online ? (
          <OfflineBanner
            message={states('offline.assistant')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void threads.refetch();
            }}
            testID="assistant.offline"
          />
        ) : null}
        <Text variant="h3" testID="assistant.summary">
          {summary}
        </Text>
        {data?.accounts.length === 0 && isScreenAvailable('/settings/accounts') ? (
          <TextAction
            label={common('actions.connectAccount')}
            onPress={() => {
              router.push('/settings/accounts');
            }}
            testID="assistant.connect"
          />
        ) : null}
        {aiReason === null ? null : aiReason === 'provider_outage' ? (
          <ErrorCard
            icon="cloud_off"
            tone="neutral"
            title={states('error.aiUnavailable.title')}
            body={states('error.aiUnavailable.body')}
            testID="assistant.aiUnavailable"
          />
        ) : (
          <ExternalCredentialRequired
            reason={aiReason === 'external_credential_required' ? 'credential' : 'disabled'}
            message={
              aiReason === 'external_credential_required'
                ? states('unavailable.credential.generic')
                : states('unavailable.featureDisabled')
            }
            testID="assistant.unavailable"
          />
        )}
        <View style={styles.section}>
          <SectionHeader title={t('suggestedKicker')} />
          {prompts.map((prompt) => (
            <OptionRow
              key={prompt.key}
              label={promptText(prompt)}
              icon="arrow_outward"
              role="button"
              onPress={() => {
                openPrompt(prompt);
              }}
              {...(blocked ? { disabled: true, disabledReason: states('offline.assistant') } : {})}
              testID={`assistant.prompt.${prompt.key}`}
            />
          ))}
        </View>
        {threads.isPending ? (
          <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />
        ) : threads.isError && threads.data === undefined ? (
          <ErrorCard
            icon="error"
            tone="neutral"
            title={t('thread.loadFailed')}
            primaryAction={{
              label: common('actions.retry'),
              onPress: () => {
                void threads.refetch();
              },
            }}
            testID="assistant.threads.error"
          />
        ) : shown.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeader title={t('recentKicker')} />
            <GroupedList>
              {shown.map((thread) => {
                const title =
                  thread.contactName !== null
                    ? t('thread.personScope', { name: thread.contactName })
                    : (thread.title ?? t('thread.untitled'));
                const date =
                  thread.lastMessageAt === null
                    ? undefined
                    : formatRelativeDay(thread.lastMessageAt, {
                        locale: lang,
                        now: now().getTime(),
                        timeZone: tz,
                      });
                return (
                  <SwipeableRow
                    key={thread.id}
                    left={[
                      {
                        key: 'delete',
                        label: common('actions.delete'),
                        icon: 'delete',
                        onAction: () => {
                          setConfirm(thread);
                        },
                      },
                    ]}
                    accessibilityLabel={title}
                    testID={`assistant.thread.${thread.id}`}
                  >
                    <ListRow
                      title={title}
                      {...(date === undefined ? {} : { trailing: { kind: 'value', text: date } })}
                      icon={thread.contactName !== null ? 'person' : 'chat'}
                      onPress={() => {
                        track('assistant_thread_opened');
                        router.push(`/chat/${thread.id}`);
                      }}
                      testID={`assistant.thread.row.${thread.id}`}
                    />
                  </SwipeableRow>
                );
              })}
            </GroupedList>
            {threads.data.length > visibleCount ? (
              <TextAction
                label={common('actions.loadMore')}
                onPress={() => {
                  setVisibleCount((n) => n + PAGE);
                }}
                testID="assistant.threads.more"
              />
            ) : null}
          </View>
        )}
      </ScrollView>
      <View style={[styles.composer, { paddingHorizontal: theme.layout.screenX }]}>
        <ChatComposer
          value={text}
          onChangeText={setText}
          onSend={sendText}
          onMic={() => {
            if (isScreenAvailable('/voice')) router.push('/voice?origin=assistant');
          }}
          onAttach={() => {
            track('assistant_capture_opened');
            router.push('/capture?entry=assistant');
          }}
          placeholder={t('composer.hint')}
          accessibilityLabel={t('composer.hint')}
          sendLabel={t('composer.send')}
          micLabel={t('composer.microphone')}
          attachLabel={t('composer.attach')}
          disabled={blocked}
          {...(blocked ? { disabledReason: states('offline.assistant') } : {})}
          testID="assistant.composer"
        />
      </View>
      <ConfirmDialog
        visible={confirm !== null}
        title={t('thread.deleteTitle')}
        body={t('thread.deleteBody')}
        icon="delete"
        confirm={{
          label: common('actions.delete'),
          onPress: () => {
            if (confirm !== null) void remove(confirm);
          },
        }}
        cancel={{
          label: common('actions.nevermind'),
          onPress: () => {
            setConfirm(null);
          },
        }}
        testID="assistant.deleteConfirm"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 16, paddingBottom: 24 },
  section: { gap: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  composer: { paddingBottom: 110, paddingTop: 8 },
});
