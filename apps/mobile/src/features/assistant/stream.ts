/**
 * The assistant answer stream (M-ASST-02, API-AST-02) shared by chat and voice: creates the thread
 * on the first send (`POST /assistant/threads` with a client thread id), then posts the message and
 * reads the SSE events with `readAssistantEvents` (`meta → status → delta/citation/card/
 * action_proposal → done | error`). Deltas are already grounded server-side, so the bubble only
 * grows. "Durdur" / unmount aborts the request; a retry resends the same `client_message_id` (the
 * server dedupes). A completed replay (non-stream JSON) is rendered from the stored answer.
 */
import { isApiError, qk } from '@da/api-client';
import { assistantThreadMutationOptions, useApiClient } from '@da/api-client/react';
import type { AssistantRichCardV1 } from '@da/validation/ai/assistant';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../lib/events';
import { now } from '../../lib/clock';
import { runMutation } from '../../lib/query/run-mutation';
import { fromApprovalView, type ApprovalModel } from '../approvals/model';
import { publishApproval } from '../approvals/api';
import type { Citation } from './data';

export type StreamPhase =
  'idle' | 'connecting' | 'streaming' | 'verifying' | 'complete' | 'error' | 'cancelled';

export type StreamErrorKind = 'ai_unavailable' | 'ai_limit' | 'rate_limited' | 'offline' | 'failed';

export interface LiveAnswer {
  readonly clientMessageId: string;
  readonly question: string;
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly cards: readonly AssistantRichCardV1[];
  readonly approvals: readonly ApprovalModel[];
  readonly phase: StreamPhase;
  readonly grounded: boolean;
  readonly noAnswer: boolean;
  readonly assistantMessageId: string | null;
  readonly error: { readonly kind: StreamErrorKind; readonly retryAfterS: number | null } | null;
}

export interface SendOptions {
  readonly inputMode: 'text' | 'voice';
  readonly suggestedKey?: string;
  readonly entity?: { readonly type: 'contact'; readonly id: string };
  readonly clientMessageId?: string;
}

function errorKind(error: unknown): StreamErrorKind {
  if (!isApiError(error)) return 'failed';
  if (error.kind === 'offline') return 'offline';
  if (error.code === 'AI_UNAVAILABLE') return 'ai_unavailable';
  if (error.code === 'QUOTA_EXCEEDED') return 'ai_limit';
  if (error.code === 'RATE_LIMITED') return 'rate_limited';
  return 'failed';
}

function bucket(count: number): '0' | '1' | '2-3' | '4+' {
  if (count === 0) return '0';
  if (count === 1) return '1';
  return count <= 3 ? '2-3' : '4+';
}

function latencyBucket(ms: number): '<1s' | '1-3s' | '3-10s' | '>10s' {
  if (ms < 1_000) return '<1s';
  if (ms < 3_000) return '1-3s';
  return ms < 10_000 ? '3-10s' : '>10s';
}

export interface ChatStreamOptions {
  /** The thread; null starts a new one on the first send. */
  readonly threadId: string | null;
  /** Person scope for a new thread (SREQ-38). */
  readonly contactId: string | null;
  readonly screen: string;
  readonly onThread?: (threadId: string) => void;
}

export function useChatStream(options: ChatStreamOptions) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [live, setLive] = useState<LiveAnswer | null>(null);
  const threadRef = useRef<string | null>(options.threadId);
  const abortRef = useRef<AbortController | null>(null);
  const onThread = useRef(options.onThread);
  useEffect(() => {
    onThread.current = options.onThread;
  }, [options.onThread]);

  useEffect(() => {
    threadRef.current = options.threadId;
  }, [options.threadId]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const patch = (next: Partial<LiveAnswer>) => {
    setLive((current) => (current === null ? current : { ...current, ...next }));
  };

  const ensureThread = async (): Promise<string> => {
    if (threadRef.current !== null) return threadRef.current;
    const created = await runMutation(assistantThreadMutationOptions(api), {
      body: {
        client_thread_id: Crypto.randomUUID(),
        ...(options.contactId === null
          ? {}
          : { scope: { type: 'person', contact_id: options.contactId } }),
      },
    });
    threadRef.current = created.id;
    onThread.current?.(created.id);
    return created.id;
  };

  const send = async (content: string, sendOptions: SendOptions): Promise<void> => {
    const text = content.trim();
    if (text === '') return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const clientMessageId = sendOptions.clientMessageId ?? Crypto.randomUUID();
    const started = now().getTime();
    setLive({
      clientMessageId,
      question: text,
      text: '',
      citations: [],
      cards: [],
      approvals: [],
      phase: 'connecting',
      grounded: false,
      noAnswer: false,
      assistantMessageId: null,
      error: null,
    });
    if (sendOptions.inputMode === 'text') {
      track('assistant_query_sent', {
        suggested: sendOptions.suggestedKey !== undefined,
        ...(sendOptions.suggestedKey === undefined ? {} : { prompt_key: sendOptions.suggestedKey }),
        input_mode: 'text',
        scoped: options.contactId !== null,
      });
    }
    let text_ = '';
    let citations: Citation[] = [];
    try {
      const threadId = await ensureThread();
      const result = await api.stream(
        'POST /assistant/threads/:id/messages',
        {
          params: { id: threadId },
          body: {
            client_message_id: clientMessageId,
            content: text.slice(0, 2000),
            input_mode: sendOptions.inputMode,
            context: {
              screen: options.screen,
              ...(sendOptions.entity === undefined ? {} : { entity: sendOptions.entity }),
            },
          },
        },
        { signal: controller.signal },
      );
      if (result.mode === 'replay') {
        const answer = result.response.data.assistant_message.answer;
        text_ = answer.blocks.map((b) => b.text).join(' ');
        patch({
          text: text_,
          phase: 'complete',
          grounded: answer.blocks.some((b) => b.verified),
          cards: answer.rich_cards,
          assistantMessageId: result.response.data.assistant_message.id,
        });
        return;
      }
      patch({ phase: 'streaming' });
      for await (const event of result.events) {
        switch (event.event) {
          case 'meta':
            patch({ assistantMessageId: event.data.assistant_message_id });
            break;
          case 'status':
            patch({ phase: event.data.stage === 'verifying' ? 'verifying' : 'streaming' });
            break;
          case 'delta':
            text_ = text_ === '' ? event.data.text : `${text_}${event.data.text}`;
            patch({ text: text_ });
            break;
          case 'citation':
            citations = [
              ...citations,
              {
                index: event.data.index,
                sourceType: event.data.source.source_type,
                sourceId: event.data.source.source_id,
                provider: event.data.source.source_provider,
                timestamp: event.data.source.source_timestamp,
                title: event.data.title,
                snippet: event.data.snippet,
                route: event.data.source.open_route ?? null,
              },
            ];
            patch({ citations });
            break;
          case 'card':
            setLive((current) =>
              current === null ? current : { ...current, cards: [...current.cards, event.data] },
            );
            break;
          case 'action_proposal': {
            const model = fromApprovalView(event.data.approval);
            publishApproval(model);
            track(
              sendOptions.inputMode === 'voice'
                ? 'voice_action_proposed'
                : 'assistant_action_proposed',
              { action_type: model.actionType },
            );
            setLive((current) =>
              current === null ? current : { ...current, approvals: [...current.approvals, model] },
            );
            break;
          }
          case 'done': {
            const noAnswer = event.data.finish_reason === 'refused_ungrounded';
            patch({
              phase: event.data.finish_reason === 'client_disconnected' ? 'cancelled' : 'complete',
              grounded: event.data.grounded,
              noAnswer,
              assistantMessageId: event.data.assistant_message_id,
            });
            track('assistant_answer_completed', {
              grounded: event.data.grounded,
              no_answer: noAnswer,
              source_count_bucket: bucket(citations.length),
              latency_bucket: latencyBucket(now().getTime() - started),
              cancelled: false,
            });
            break;
          }
          case 'error': {
            const code = event.data.code;
            track('assistant_stream_error', { code });
            patch({
              phase: 'error',
              error: {
                kind:
                  code === 'AI_UNAVAILABLE'
                    ? 'ai_unavailable'
                    : code === 'QUOTA_EXCEEDED'
                      ? 'ai_limit'
                      : code === 'RATE_LIMITED'
                        ? 'rate_limited'
                        : 'failed',
                retryAfterS: null,
              },
            });
            break;
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        patch({ phase: 'cancelled' });
        track('assistant_answer_completed', {
          grounded: false,
          no_answer: false,
          source_count_bucket: bucket(citations.length),
          latency_bucket: latencyBucket(now().getTime() - started),
          cancelled: true,
        });
        return;
      }
      const kind = errorKind(error);
      if (isApiError(error)) track('assistant_stream_error', { code: error.code });
      patch({
        phase: 'error',
        error: {
          kind,
          retryAfterS:
            isApiError(error) && error.retryAfterMs !== null
              ? Math.ceil(error.retryAfterMs / 1000)
              : null,
        },
      });
    } finally {
      if (threadRef.current !== null) {
        void queryClient.invalidateQueries({ queryKey: qk.assistant.messages(threadRef.current) });
      }
      void queryClient.invalidateQueries({ queryKey: qk.assistant.threads() });
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  return {
    live,
    send,
    stop,
    reset: () => {
      setLive(null);
    },
    threadId: () => threadRef.current,
  };
}
