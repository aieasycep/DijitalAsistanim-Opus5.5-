/**
 * `text/event-stream` reader (API_CONTRACTS API-AST-02). Works on any streaming body: a WHATWG
 * `ReadableStream` (web fetch, `expo/fetch` in React Native — RN's global fetch cannot stream) or
 * an async iterable of chunks. Follows the WHATWG event-stream parsing rules: `\n`, `\r\n` and `\r`
 * line endings (also when split across chunks), `:` comment lines (the 15 s `: ping`), multi-line
 * `data:`, one optional space after the colon, and an unterminated trailing event is discarded.
 */
import { parseAssistantSseFrame, type AssistantSseEvent } from '@da/validation/api/assistant';
import { ErrorObject } from '@da/validation/errors';

import { ApiError } from './errors.ts';

export interface SseFrame {
  /** `event:` field; `message` when absent. */
  readonly event: string;
  /** `data:` lines joined with `\n`. */
  readonly data: string;
  /** Last `id:` seen, if any. */
  readonly id: string | null;
}

export type SseSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>;

async function* chunksOf(source: SseSource): AsyncGenerator<Uint8Array | string> {
  if ('getReader' in source) {
    const reader = source.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    yield* source;
  }
}

/** Splits decoded text into lines, holding a trailing `\r` until the next chunk decides it. */
function takeLines(buffer: string, final: boolean): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch === '\n') {
      lines.push(buffer.slice(start, i));
      start = i + 1;
    } else if (ch === '\r') {
      if (i === buffer.length - 1 && !final) break;
      lines.push(buffer.slice(start, i));
      start = buffer[i + 1] === '\n' ? i + 2 : i + 1;
      if (buffer[i + 1] === '\n') i++;
    }
  }
  return { lines, rest: buffer.slice(start) };
}

/** Parses an event stream into frames. */
export async function* readSseFrames(source: SseSource): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | null = null;

  function* consume(lines: readonly string[]): Generator<SseFrame> {
    for (const line of lines) {
      if (line === '') {
        if (data.length > 0) {
          yield { event: event === '' ? 'message' : event, data: data.join('\n'), id };
        }
        event = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id' && !value.includes('\0')) id = value;
    }
  }

  for await (const chunk of chunksOf(source)) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const { lines, rest } = takeLines(buffer, false);
    buffer = rest;
    yield* consume(lines);
  }
  buffer += decoder.decode();
  // A final line without its terminator still counts as a line; the event it may start is only
  // dispatched by a blank line, so an unterminated trailing event is dropped (WHATWG rule).
  const { lines } = takeLines(buffer, true);
  yield* consume(lines);
}

/** An `event: error` payload as an `ApiError` (the stream closes after it). */
export function apiErrorFromSseError(payload: unknown, status = 200): ApiError {
  const parsed = ErrorObject.safeParse(payload);
  if (!parsed.success) {
    return new ApiError({ code: 'INTERNAL_ERROR', kind: 'invalid_response', status });
  }
  const e = parsed.data;
  return new ApiError({
    code: e.code,
    kind: 'server',
    status,
    message: e.message,
    messageKey: e.message_key,
    retryable: e.retryable,
    correlationId: e.correlation_id,
    ...(e.details === undefined ? {} : { details: e.details }),
  });
}

/**
 * Typed assistant events (`meta | status | delta | citation | card | action_proposal | done |
 * error`) parsed with `@da/validation`'s `parseAssistantSseFrame`. A frame that fails the schema is
 * a contract violation and ends the iteration with an `invalid_response` `ApiError`. Iteration stops
 * after the terminal `done` or `error` event.
 */
export async function* readAssistantEvents(
  source: SseSource,
  correlationId: string | null = null,
): AsyncGenerator<AssistantSseEvent> {
  for await (const frame of readSseFrames(source)) {
    const parsed = parseAssistantSseFrame(frame.event, frame.data);
    if (!parsed.success) {
      throw new ApiError({
        code: 'INTERNAL_ERROR',
        kind: 'invalid_response',
        status: 200,
        correlationId,
        details: { sse_event: frame.event },
      });
    }
    yield parsed.data;
    if (parsed.data.event === 'done' || parsed.data.event === 'error') return;
  }
}
