import { describe, expect, it } from 'vitest';

import {
  ApiError,
  apiErrorFromSseError,
  createApiClient,
  readAssistantEvents,
  readSseFrames,
  type SseFrame,
} from '../src/index.ts';
import { errorBody, json, mockFetch, uuid } from './fixtures.ts';

const encoder = new TextEncoder();

function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

const meta = {
  thread_id: uuid(1),
  user_message_id: uuid(2),
  assistant_message_id: uuid(3),
  correlation_id: 'corr-12345678',
};
const done = {
  assistant_message_id: uuid(3),
  finish_reason: 'stop',
  grounded: true,
  usage: { remaining_messages: 11 },
};
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('readSseFrames', () => {
  it('parses events split at arbitrary chunk boundaries', async () => {
    const text = `${frame('meta', meta)}${frame('delta', { text: 'Merhaba' })}`;
    for (let cut = 1; cut < text.length; cut += 7) {
      const frames = await collect(readSseFrames(streamOf(text.slice(0, cut), text.slice(cut))));
      expect(frames.map((f) => f.event)).toEqual(['meta', 'delta']);
      expect(JSON.parse(frames[1]?.data ?? '')).toEqual({ text: 'Merhaba' });
    }
  });

  it('handles CRLF split between chunks, CR-only lines, comments and multi-line data', async () => {
    const frames = await collect(
      readSseFrames(
        streamOf(
          ': ping\r',
          '\nevent: status\r',
          '\ndata: {"stage":\r\ndata: "retrieving"}\r\n\r\n',
          'event:delta\rdata:{"text":"a"}\r\r',
        ),
      ),
    );
    expect(frames).toEqual<SseFrame[]>([
      { event: 'status', data: '{"stage":\n"retrieving"}', id: null },
      { event: 'delta', data: '{"text":"a"}', id: null },
    ]);
  });

  it('decodes multi-byte UTF-8 characters split across chunks', async () => {
    const bytes = encoder.encode('data: {"text":"çğış"}\n\n');
    const frames = await collect(readSseFrames(streamOf(bytes.slice(0, 16), bytes.slice(16))));
    expect(JSON.parse(frames[0]?.data ?? '')).toEqual({ text: 'çğış' });
    expect(frames[0]?.event).toBe('message');
  });

  it('keeps the last id and drops an unterminated trailing event', async () => {
    const frames = await collect(
      readSseFrames(streamOf('id: 7\ndata: one\n\n', 'data: never dispatched')),
    );
    expect(frames).toEqual([{ event: 'message', data: 'one', id: '7' }]);
  });

  it('accepts async iterables of strings', async () => {
    async function* source() {
      yield 'data: x\n';
      await Promise.resolve();
      yield '\n';
    }
    expect(await collect(readSseFrames(source()))).toHaveLength(1);
  });
});

describe('readAssistantEvents', () => {
  it('yields typed events and stops after the terminal event', async () => {
    const events = await collect(
      readAssistantEvents(
        streamOf(
          frame('meta', meta),
          ': ping\n\n',
          frame('status', { stage: 'generating' }),
          frame('delta', { text: 'Yarın ' }),
          frame('delta', { text: 'yoğunsun.' }),
          frame('done', done),
          frame('delta', { text: 'ignored after done' }),
        ),
      ),
    );
    expect(events.map((e) => e.event)).toEqual(['meta', 'status', 'delta', 'delta', 'done']);
    const text = events.flatMap((e) => (e.event === 'delta' ? [e.data.text] : [])).join('');
    expect(text).toBe('Yarın yoğunsun.');
  });

  it('fails with an invalid_response ApiError on a frame that breaks the contract', async () => {
    const error = await collect(
      readAssistantEvents(streamOf(frame('delta', { text: '' })), 'corr-abcdefgh'),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'invalid_response',
      code: 'INTERNAL_ERROR',
      correlationId: 'corr-abcdefgh',
    });
  });

  it('converts an error event payload into an ApiError', () => {
    const payload = errorBody('AI_UNAVAILABLE', { retryable: true }).error;
    expect(apiErrorFromSseError(payload)).toMatchObject({
      code: 'AI_UNAVAILABLE',
      retryable: true,
      messageKey: 'errors.ai_unavailable',
    });
    expect(apiErrorFromSseError({ nope: true }).kind).toBe('invalid_response');
  });
});

describe('client.stream()', () => {
  const input = {
    params: { id: uuid(1) },
    body: {
      client_message_id: uuid(4),
      content: 'Yarın yoğun muyum?',
      input_mode: 'text' as const,
    },
  };

  it('streams typed events from a text/event-stream response', async () => {
    const mock = mockFetch(
      () =>
        new Response(
          streamOf(frame('meta', meta), frame('delta', { text: 'Evet.' }), frame('done', done)),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
    );
    const api = createApiClient({
      baseUrl: 'https://api.example.com/functions/v1/api',
      getAccessToken: () => 'token',
      streamFetch: mock.fn,
    });
    const result = await api.stream('POST /assistant/threads/:id/messages', input);
    expect(result.mode).toBe('stream');
    if (result.mode !== 'stream') return;
    const events = await collect(result.events);
    expect(events.map((e) => e.event)).toEqual(['meta', 'delta', 'done']);
    expect(mock.calls[0]?.headers.accept).toBe('text/event-stream');
    expect(mock.calls[0]?.url).toBe(
      `https://api.example.com/functions/v1/api/assistant/threads/${uuid(1)}/messages`,
    );
    // `client_id` idempotency: the key lives in the body, not in a header.
    expect(mock.calls[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('returns the JSON replay of a completed message', async () => {
    const replay = {
      data: {
        assistant_message: {
          id: uuid(3),
          thread_id: uuid(1),
          answer: {
            message_id: uuid(3),
            route: 'grounded_qa',
            blocks: [{ text: 'Evet, yarın üç toplantın var.', verified: true, citations: [] }],
            source_cards: [],
            rich_cards: [],
            proposed_actions: [],
            coverage: 1,
            confidence_label: 'high',
            unknown: false,
            followup_suggestions: [],
          },
          finish_reason: 'stop',
          created_at: '2026-09-24T08:00:00Z',
        },
      },
      meta: { correlation_id: 'c-12345678', request_id: 'r', server_time: '2026-09-24T08:00:00Z' },
    };
    const mock = mockFetch(() => json(200, replay));
    const api = createApiClient({
      baseUrl: 'https://api.example.com/functions/v1/api',
      getAccessToken: () => 'token',
      fetch: mock.fn,
    });
    const result = await api.stream('POST /assistant/threads/:id/messages', input);
    expect(result.mode).toBe('replay');
    if (result.mode !== 'replay') return;
    expect(result.response.data.assistant_message.finish_reason).toBe('stop');
  });

  it('throws the pre-stream JSON error as an ApiError', async () => {
    const mock = mockFetch(() => json(429, errorBody('QUOTA_EXCEEDED')));
    const api = createApiClient({
      baseUrl: 'https://api.example.com/functions/v1/api',
      getAccessToken: () => 'token',
      fetch: mock.fn,
    });
    const error = await api
      .stream('POST /assistant/threads/:id/messages', input)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED', status: 429 });
  });
});
