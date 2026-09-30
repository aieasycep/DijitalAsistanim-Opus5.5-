/**
 * M-ASST-02 Asistan · Sohbet (`/chat/{threadId}`, `threadId='new'` = unsaved; params `prompt` (a
 * suggested prompt key or text), `name`, `contactId`, `origin`): a grounded, streaming conversation.
 * Answer anatomy: text (grounded deltas) → source rows → rich cards → pending approval cards
 * (tap-only, `approved_via='in_place'`, R-03) → follow-up chips. "Durdur" aborts and keeps the
 * partial text ("Durduruldu"); a failed stream offers "Tekrar Dene" with the same client message
 * id. Person-scoped threads restrict retrieval to one contact (SREQ-38).
 */
import { formatRelativeDay } from '@da/i18n';
import {
  AiUnavailableCard,
  Button,
  Card,
  ChatComposer,
  ChipWrap,
  DetailHeader,
  FeedbackActions,
  HeaderPill,
  LimitCard,
  NotFoundState,
  OfflineBanner,
  SuggestionChip,
  Text,
  TypingIndicator,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { isUuid } from '@da/domain';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import { fetchApproval } from '../approvals/api';
import type { ApprovalModel } from '../approvals/model';
import { AnswerParts } from './AnswerParts';
import { fetchThread, sendAnswerFeedback, useMessages, type StoredMessage } from './data';
import { buildSuggestedPrompts, topPrompts } from './prompts';
import { useChatStream, type LiveAnswer } from './stream';
import { isPromptKey, usePromptText } from './usePromptText';

function UserBubble({ text }: { readonly text: string }) {
  const theme = useTheme();
  const t = useTranslations('assistant.thread');
  return (
    <View
      style={[styles.userBubble, { backgroundColor: theme.color.brand.primary }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('youSaid', { text })}
    >
      <Text variant="body" tone="onPrimary">
        {text}
      </Text>
    </View>
  );
}

function StoredApprovals({ ids }: { readonly ids: readonly string[] }) {
  const query = useQuery({
    queryKey: ['approvals', 'thread', ...ids],
    queryFn: async () =>
      (await Promise.all(ids.map((id) => fetchApproval(id).catch(() => null)))).filter(
        (m): m is ApprovalModel => m !== null,
      ),
    enabled: ids.length > 0,
  });
  if (ids.length === 0 || query.data === undefined) return null;
  return (
    <AnswerParts citations={[]} cards={[]} approvals={query.data} via="in_place" testID="stored" />
  );
}

function AssistantMessage({
  message,
  onFollowup,
}: {
  readonly message: StoredMessage;
  readonly onFollowup: (text: string) => void;
}) {
  const t = useTranslations('assistant.thread');
  const [rating, setRating] = useState<'positive' | 'negative' | null>(null);
  const rate = (value: 1 | -1) => {
    setRating(value === 1 ? 'positive' : 'negative');
    track('assistant_answer_feedback', { rating: value === 1 ? 'up' : 'down' });
    void sendAnswerFeedback('assistant_message', message.id, value)
      .then(() => {
        showToast({ message: t('feedbackThanks'), kind: 'success' });
      })
      .catch(() => undefined);
  };
  return (
    <View style={styles.answer} testID={`chat.message.${message.id}`}>
      <Card>
        <Text
          variant="body"
          selectable
          accessibilityRole="text"
          accessibilityLabel={t('assistantSaid', { text: message.content })}
        >
          {message.content}
        </Text>
        {message.status === 'cancelled' ? (
          <Text variant="meta" tone="tertiaryStrong">
            {t('stopped')}
          </Text>
        ) : null}
      </Card>
      <AnswerParts
        citations={message.citations}
        cards={[]}
        approvals={[]}
        followups={message.followups}
        onFollowup={onFollowup}
        via="in_place"
        testID={`chat.message.${message.id}`}
      />
      <StoredApprovals ids={message.approvalIds} />
      <FeedbackActions
        positiveLabel={t('helpful')}
        negativeLabel={t('notHelpful')}
        value={rating}
        onPositive={() => {
          rate(1);
        }}
        onNegative={() => {
          rate(-1);
        }}
        testID={`chat.feedback.${message.id}`}
      />
    </View>
  );
}

function LiveMessage({
  live,
  onRetry,
  onFollowup,
  onMemory,
  onRephrase,
}: {
  readonly live: LiveAnswer;
  readonly onRetry: () => void;
  readonly onFollowup: (text: string) => void;
  readonly onMemory: (() => void) | null;
  readonly onRephrase: () => void;
}) {
  const t = useTranslations('assistant.thread');
  const states = useTranslations('states');
  const common = useTranslations('common');
  const router = useRouter();
  const waiting = live.text === '' && (live.phase === 'connecting' || live.phase === 'streaming');
  return (
    <View style={styles.answer} testID="chat.live">
      <UserBubble text={live.question} />
      {waiting ? (
        <TypingIndicator accessibilityLabel={t('thinking')} testID="chat.typing" />
      ) : live.text === '' ? null : (
        <Card>
          <Text variant="body" selectable testID="chat.live.text">
            {live.text}
          </Text>
          {live.phase === 'verifying' ? (
            <Text variant="meta" tone="tertiaryStrong" accessibilityLiveRegion="polite">
              {t('verifying')}
            </Text>
          ) : null}
          {live.phase === 'cancelled' ? (
            <Text variant="meta" tone="tertiaryStrong">
              {t('stopped')}
            </Text>
          ) : null}
        </Card>
      )}
      <AnswerParts
        citations={live.citations}
        cards={live.cards}
        approvals={live.approvals}
        onFollowup={onFollowup}
        via="in_place"
        testID="chat.live"
      />
      {live.noAnswer ? (
        <ChipWrap>
          {onMemory === null ? null : (
            <SuggestionChip
              label={t('searchMemory')}
              onPress={onMemory}
              testID="chat.noAnswer.memory"
            />
          )}
          <SuggestionChip
            label={t('rephrase')}
            onPress={onRephrase}
            testID="chat.noAnswer.rephrase"
          />
        </ChipWrap>
      ) : null}
      {live.phase === 'error' && live.error !== null ? (
        live.error.kind === 'ai_unavailable' ? (
          <AiUnavailableCard
            title={states('error.aiUnavailable.title')}
            body={states('error.aiUnavailable.body')}
            primaryAction={{ label: states('error.aiUnavailable.cta'), onPress: onRetry }}
            testID="chat.aiUnavailable"
          />
        ) : live.error.kind === 'ai_limit' ? (
          <LimitCard
            title={states('limit.ai.title')}
            body={states('limit.ai.tomorrow')}
            {...(isScreenAvailable('/paywall')
              ? {
                  primaryAction: {
                    label: states('limit.seePro'),
                    onPress: () => {
                      router.push('/paywall?source=ai_limit');
                    },
                  },
                }
              : {})}
            testID="chat.aiLimit"
          />
        ) : (
          <View style={styles.errorRow} testID="chat.error">
            <Text variant="bodyXs" tone="critical" accessibilityRole="alert">
              {live.error.kind === 'rate_limited'
                ? t('rateLimited', { seconds: live.error.retryAfterS ?? 10 })
                : live.error.kind === 'offline'
                  ? t('disconnected')
                  : t('interrupted')}
            </Text>
            <Button
              label={common('actions.retry')}
              variant="tonal"
              size="sm"
              onPress={onRetry}
              testID="chat.retry"
            />
          </View>
        )
      ) : null}
    </View>
  );
}

export function ChatScreen() {
  const params = useLocalSearchParams<{
    threadId: string;
    prompt?: string;
    name?: string;
    contactId?: string;
    origin?: string;
  }>();
  const t = useTranslations('assistant');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const tz = userTimeZone();
  const promptText = usePromptText();
  const isNew = params.threadId === 'new';
  const [threadId, setThreadId] = useState<string | null>(isNew ? null : params.threadId);
  const contactId =
    params.contactId !== undefined && isUuid(params.contactId) ? params.contactId : null;
  const thread = useQuery({
    queryKey: ['assistant', 'thread', threadId ?? 'new', contactId ?? ''],
    queryFn: async () => {
      if (threadId !== null) return fetchThread(threadId);
      return { id: '', title: null, contactId, contactName: null };
    },
  });
  const messages = useMessages(threadId);
  const stream = useChatStream({
    threadId,
    contactId: thread.data?.contactId ?? contactId,
    screen: 'M-ASST-02',
    onThread: (id) => {
      setThreadId(id);
      router.setParams({ threadId: id });
    },
  });
  const [text, setText] = useState('');
  const scroll = useRef<ScrollView>(null);
  const started = useRef(false);

  const send = (content: string, suggestedKey?: string) => {
    if (!online) return;
    void stream.send(content, {
      inputMode: 'text',
      ...(suggestedKey === undefined ? {} : { suggestedKey }),
    });
  };

  useEffect(() => {
    if (started.current || !isNew) return;
    const prompt = params.prompt;
    if (prompt === undefined || prompt === '') return;
    started.current = true;
    if (isPromptKey(prompt)) {
      send(
        promptText({ key: prompt, ...(params.name === undefined ? {} : { name: params.name }) }),
        prompt,
      );
    } else {
      send(prompt);
    }
    // The initial prompt is sent once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = stream.live;
  useEffect(() => {
    if (live?.phase === 'complete' && live.text !== '') {
      AccessibilityInfo.announceForAccessibility(live.text);
    }
  }, [live?.phase, live?.text]);

  const streaming =
    live !== null &&
    (live.phase === 'connecting' || live.phase === 'streaming' || live.phase === 'verifying');
  const history = messages.data ?? [];
  const pairs = history.filter((m) => m.status !== 'streaming');
  const liveId = live?.assistantMessageId ?? null;
  const hideLiveDuplicate = liveId !== null && pairs.some((m) => m.id === liveId);
  const scoped = thread.data?.contactName ?? null;
  const title =
    scoped !== null
      ? t('thread.personScope', { name: scoped })
      : (thread.data?.title ?? t('thread.newTitle'));
  const empty = isNew && live === null && pairs.length === 0;
  const suggestions = topPrompts(buildSuggestedPrompts({ now: now() }));

  if (!isNew && thread.data === null) {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}>
        <NotFoundState
          variant="entity"
          title={states('notFound.entity.title')}
          body={states('notFound.entity.body')}
          backAction={{
            label: common('actions.goBack'),
            onPress: () => {
              if (router.canGoBack()) router.back();
              else router.replace('/assistant');
            },
          }}
          testID="chat.notFound"
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.chat"
    >
      <DetailHeader
        leading="back"
        onLeadingPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/assistant');
        }}
        leadingAccessibilityLabel={common('actions.back')}
        kicker={title}
        trailing={
          <HeaderPill
            label={t('thread.newChat')}
            icon="add"
            onPress={() => {
              stream.stop();
              router.replace(
                (thread.data?.contactId ?? contactId) === null
                  ? '/chat/new'
                  : `/chat/new?contactId=${thread.data?.contactId ?? contactId ?? ''}`,
              );
            }}
            testID="chat.new"
          />
        }
      />
      {!online ? (
        <View style={{ paddingHorizontal: theme.layout.screenX }}>
          <OfflineBanner
            message={states('offline.assistant')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void messages.refetch();
            }}
            testID="chat.offline"
          />
        </View>
      ) : null}
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        onContentSizeChange={() => {
          scroll.current?.scrollToEnd({ animated: false });
        }}
        keyboardShouldPersistTaps="handled"
      >
        {messages.isPending && threadId !== null ? (
          <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />
        ) : null}
        {pairs.map((message) =>
          message.role === 'user' ? (
            <UserBubble key={message.id} text={message.content} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              onFollowup={(value) => {
                send(value);
              }}
            />
          ),
        )}
        {live !== null && !hideLiveDuplicate ? (
          <LiveMessage
            live={live}
            onRetry={() => {
              void stream.send(live.question, {
                inputMode: 'text',
                clientMessageId: live.clientMessageId,
              });
            }}
            onFollowup={(value) => {
              send(value);
            }}
            onMemory={
              isScreenAvailable('/memory')
                ? () => {
                    router.push(`/memory?q=${encodeURIComponent(live.question)}`);
                  }
                : null
            }
            onRephrase={() => {
              setText(live.question);
            }}
          />
        ) : null}
        {empty ? (
          <View style={styles.section} testID="chat.empty">
            <Text variant="secondary">{t('summaryFallback')}</Text>
            <ChipWrap>
              {suggestions.map((prompt) => (
                <SuggestionChip
                  key={prompt.key}
                  label={promptText(prompt)}
                  onPress={() => {
                    send(promptText(prompt), prompt.key);
                  }}
                  testID={`chat.suggestion.${prompt.key}`}
                />
              ))}
            </ChipWrap>
          </View>
        ) : null}
        {pairs.length > 0 && pairs.at(-1)?.createdAt !== undefined ? (
          <Text variant="meta" tone="tertiaryStrong" align="center">
            {formatRelativeDay(pairs.at(-1)?.createdAt ?? now().toISOString(), {
              locale: lang,
              now: now().getTime(),
              timeZone: tz,
            })}
          </Text>
        ) : null}
      </ScrollView>
      <View
        style={[
          styles.composer,
          { paddingHorizontal: theme.layout.screenX, paddingBottom: insets.bottom + 8 },
        ]}
      >
        {streaming ? (
          <Button
            label={t('thread.stop')}
            icon="stop"
            variant="ink"
            size="sm"
            onPress={stream.stop}
            testID="chat.stop"
          />
        ) : null}
        <ChatComposer
          value={text}
          onChangeText={setText}
          onSend={() => {
            const value = text.trim();
            if (value === '') return;
            setText('');
            send(value);
          }}
          onMic={() => {
            router.push(
              threadId === null
                ? '/voice?origin=assistant'
                : `/voice?origin=assistant&threadId=${threadId}`,
            );
          }}
          onAttach={() => {
            track('assistant_capture_opened');
            router.push('/capture?entry=assistant');
          }}
          placeholder={
            scoped !== null ? t('thread.askAbout', { name: scoped }) : t('composer.hint')
          }
          accessibilityLabel={t('composer.hint')}
          sendLabel={t('composer.send')}
          micLabel={t('composer.microphone')}
          attachLabel={t('composer.attach')}
          disabled={!online || streaming}
          {...(!online ? { disabledReason: states('offline.assistant') } : {})}
          sending={streaming}
          testID="chat.composer"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 14, paddingBottom: 24, paddingTop: 8 },
  section: { gap: 8 },
  answer: { gap: 10 },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  composer: { gap: 8, paddingTop: 8 },
  errorRow: { gap: 8, alignItems: 'flex-start' },
});
