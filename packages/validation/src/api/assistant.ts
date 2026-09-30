import { z } from 'zod';
import { AssistantAnswerV1, AssistantRichCardV1 } from '../ai/assistant.ts';
import { ErrorObject } from '../errors.ts';
import { ApprovalView } from './approvals.ts';
import { EntityRefInput, IsoDateTime, Locale, SourceRef, Uuid } from './common.ts';
import { Success } from './envelope.ts';

// API-AST-01 · POST /assistant/threads
export const AssistantThreadScope = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('global') }),
  z.strictObject({ type: z.literal('person'), contact_id: Uuid }),
]);
export const AssistantThreadBody = z.strictObject({
  scope: AssistantThreadScope.default({ type: 'global' }),
  client_thread_id: Uuid,
});
export const AssistantThreadResponse = Success(
  z.object({ id: Uuid, scope: z.unknown(), created_at: IsoDateTime }),
);

// API-AST-02 · POST /assistant/threads/:id/messages (SSE)
export const AssistantThreadParams = z.strictObject({ id: Uuid });
export const AssistantMessageBody = z.strictObject({
  client_message_id: Uuid,
  content: z.string().trim().min(1).max(2000),
  input_mode: z.enum(['text', 'voice']),
  context: z
    .strictObject({
      screen: z.string().max(64).optional(),
      entity: EntityRefInput.optional(),
    })
    .optional(),
  locale: Locale.optional(),
});

/** SSE `event:` names, in the order a normal answer emits them (`card`/`citation`/`action_proposal` interleave). */
export const ASSISTANT_SSE_EVENT_NAMES = [
  'meta',
  'status',
  'delta',
  'citation',
  'card',
  'action_proposal',
  'done',
  'error',
] as const;
export type AssistantSseEventName = (typeof ASSISTANT_SSE_EVENT_NAMES)[number];

export const AssistantMetaEvent = z.object({
  event: z.literal('meta'),
  data: z.object({
    thread_id: Uuid,
    user_message_id: Uuid,
    assistant_message_id: Uuid,
    correlation_id: z.string(),
  }),
});
export const AssistantStatusEvent = z.object({
  event: z.literal('status'),
  data: z.object({ stage: z.enum(['retrieving', 'generating', 'verifying']) }),
});
export const AssistantDeltaEvent = z.object({
  event: z.literal('delta'),
  data: z.object({ text: z.string().min(1).max(512) }),
});
export const AssistantCitationEvent = z.object({
  event: z.literal('citation'),
  data: z.object({
    index: z.int().min(0),
    source: SourceRef,
    title: z.string(),
    snippet: z.string().max(200),
  }),
});
/** `card {type:'mail'|'event'|'person'|'life'|'list', data, route}`: `AssistantRichCardV1`. */
export const AssistantCardEvent = z.object({ event: z.literal('card'), data: AssistantRichCardV1 });
/** A pending approval the server built through the API-APR-01 code path (R-04); never a model tool. */
export const AssistantActionProposalEvent = z.object({
  event: z.literal('action_proposal'),
  data: z.object({ approval: ApprovalView }),
});
export const AssistantFinishReason = z.enum([
  'stop',
  'length',
  'client_disconnected',
  'refused_ungrounded',
]);
export const AssistantDoneEvent = z.object({
  event: z.literal('done'),
  data: z.object({
    assistant_message_id: Uuid,
    finish_reason: AssistantFinishReason,
    grounded: z.boolean(),
    usage: z.object({ remaining_messages: z.int().min(0) }),
    /** Calibrated answer confidence; only once the learned `assistant_qa` calibration is active. */
    confidence_pct: z.int().min(0).max(100).optional(),
  }),
});
/** `ErrorBody.error`; the stream closes after it. */
export const AssistantErrorEvent = z.object({ event: z.literal('error'), data: ErrorObject });

/** The API-AST-02 SSE event union `meta|status|delta|citation|card|action_proposal|done|error`. */
export const AssistantSseEvent = z.discriminatedUnion('event', [
  AssistantMetaEvent,
  AssistantStatusEvent,
  AssistantDeltaEvent,
  AssistantCitationEvent,
  AssistantCardEvent,
  AssistantActionProposalEvent,
  AssistantDoneEvent,
  AssistantErrorEvent,
]);
export type AssistantSseEvent = z.infer<typeof AssistantSseEvent>;

/** Parses one SSE frame (`event:` name + JSON `data:`) into a typed event. */
export function parseAssistantSseFrame(
  event: string,
  data: string,
): z.ZodSafeParseResult<AssistantSseEvent> {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    json = undefined;
  }
  return AssistantSseEvent.safeParse({ event, data: json });
}

/**
 * Validates a whole stream's ordering: `meta` first, exactly one terminal `done` or `error` last, no
 * `delta` after the terminal event. Returns the violated rules.
 */
export function assistantStreamViolations(events: readonly AssistantSseEvent[]): string[] {
  const violations: string[] = [];
  if (events.length === 0) return ['empty_stream'];
  if (events[0]?.event !== 'meta') violations.push('meta_not_first');
  const terminal = events.findIndex((e) => e.event === 'done' || e.event === 'error');
  if (terminal === -1) violations.push('no_terminal_event');
  else if (terminal !== events.length - 1) violations.push('events_after_terminal');
  if (events.filter((e) => e.event === 'meta').length > 1) violations.push('duplicate_meta');
  return violations;
}

/** Replay after completion: non-stream JSON with the stored answer (`Idempotency-Replayed: true`). */
export const AssistantMessageReplayResponse = Success(
  z.object({
    assistant_message: z.object({
      id: Uuid,
      thread_id: Uuid,
      answer: AssistantAnswerV1,
      finish_reason: AssistantFinishReason,
      created_at: IsoDateTime,
    }),
  }),
);

// API-AST-03 · POST /assistant/transcribe (multipart/form-data)
export const TRANSCRIBE_AUDIO_MIME_VALUES = [
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
] as const;
export const TRANSCRIBE_LIMITS = { max_bytes: 10 * 1024 * 1024, max_seconds: 120 } as const;
/** The non-file form fields; the `audio` part is checked with `TranscribeAudioMeta`. */
export const TranscribeForm = z.strictObject({
  language: Locale,
  purpose: z.enum(['assistant', 'post_meeting', 'meeting_note', 'capture_text']),
  duration_ms: z.coerce
    .number()
    .int()
    .min(1)
    .max(TRANSCRIBE_LIMITS.max_seconds * 1000),
});
export const TranscribeAudioMeta = z.strictObject({
  mime: z.enum(TRANSCRIBE_AUDIO_MIME_VALUES),
  size_bytes: z.int().min(1).max(TRANSCRIBE_LIMITS.max_bytes),
});
export const TranscribeResponse = Success(
  z.object({
    text: z.string().max(10000),
    duration_s: z.number(),
    language: z.string(),
    confidence: z.number().nullable(),
  }),
);
