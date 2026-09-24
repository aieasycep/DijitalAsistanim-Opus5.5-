/**
 * Reply and follow-up drafts (IMPLEMENTATION_PLAN T-5.12; AI_PIPELINE_PLAN §13.3, §4.3.17;
 * API-MAIL-02/03/06). The thread's newest messages (transient bodies, redacted, or the stored
 * snippet) are wrapped as untrusted `t1..t3` documents; recipients, subject and account never come
 * from the model. `balanced` asks for all four tones in one call (cached per thread, so a tone
 * switch within the cache window costs nothing); `lean` asks only for the requested tone. The
 * refinement (tone coverage, word caps, no URL / e-mail / phone that is not in the thread, no
 * fill-ins) makes an invalid output `AI_OUTPUT_INVALID`.
 */
import { stripQuotedHistory } from '@da/domain';
import {
  FollowUpDraftV1,
  refineFollowUpDraftV1,
  refineReplyDraftsV1,
  ReplyDraftsV1,
} from '@da/validation';
import type { T0Reason } from '../../ai/types.ts';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { injectionScan, modelText } from '../ai/hygiene.ts';
import { callModel, type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import { clip } from '../copy.ts';
import type { MailMessageRow } from '../intel/types.ts';
import type { Tone } from '../assist/store.ts';

export const TONES: readonly Tone[] = ['short', 'professional', 'friendly', 'detailed'];
/** Thread messages sent to the model (AI_PIPELINE_PLAN §13.3: last 3, ≤2,500 tokens). */
export const REPLY_CONTEXT_MESSAGES = 3;
const MESSAGE_TOKENS = 800;

export type DraftOutcome<T> =
  | {
      readonly kind: 'ai';
      readonly data: T;
      readonly promptVersionId: string;
      readonly aiRequestId: string | null;
      readonly cached: boolean;
      readonly threadText: string;
      readonly injectionSuspected: boolean;
    }
  | { readonly kind: 't0'; readonly reason: T0Reason | 'refine_failed' };

export interface ThreadDocs {
  readonly docs: UntrustedDoc[];
  readonly context: string[];
  readonly text: string;
}

/** The newest messages as untrusted docs (`t1` oldest … `tN` newest) with trusted meta lines. */
export function threadDocs(
  messages: readonly MailMessageRow[],
  bodies: ReadonlyMap<string, string>,
): ThreadDocs {
  const recent = [...messages]
    .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at))
    .slice(-REPLY_CONTEXT_MESSAGES);
  const docs: UntrustedDoc[] = [];
  const context: string[] = [];
  recent.forEach((m, i) => {
    const ref = `t${i + 1}`;
    const body = bodies.get(m.id);
    const text =
      body !== undefined && body.trim() !== ''
        ? modelText({ text: stripQuotedHistory(body), html: null }, MESSAGE_TOKENS).text
        : [m.subject ?? '', m.snippet ?? ''].filter((t) => t !== '').join('\n');
    docs.push({ ref, kind: 'email', text });
    context.push(`${ref}: ${m.direction === 'outbound' ? 'Senin mesajın' : 'Gelen mesaj'}`);
  });
  return { docs, context, text: docs.map((d) => d.text).join('\n') };
}

export interface ReplyDraftRequest {
  readonly threadId: string;
  readonly lastMessageId: string;
  readonly messages: readonly MailMessageRow[];
  readonly bodies: ReadonlyMap<string, string>;
  /** `all_tones` (balanced) or the single requested tone (lean, regenerate with instructions). */
  readonly expect: 'all_tones' | Tone;
  readonly recipientName: string | null;
  readonly language: 'tr' | 'en';
  readonly instructions: string | null;
  readonly attachmentNames: readonly string[];
  readonly now: Date;
}

/** The balanced profile generates all tones; lean (and L1) only the requested one. */
export function expectedTones(
  profile: string,
  tone: Tone,
  level?: string | null,
): 'all_tones' | Tone {
  return profile === 'balanced' && level !== 'l1' ? 'all_tones' : tone;
}

export async function generateReplyDrafts(
  pipeline: PipelineContext,
  input: ReplyDraftRequest,
): Promise<DraftOutcome<ReplyDraftsV1>> {
  const thread = threadDocs(input.messages, input.bodies);
  const tones = input.expect === 'all_tones' ? TONES : [input.expect];
  const context = [
    ...trustedHeader(pipeline.user, input.now),
    ...thread.context,
    ...(input.recipientName === null ? [] : [`Alıcı: ${input.recipientName}`]),
    `Tonlar: ${tones.join(', ')}`,
    `Dil: ${input.language}`,
    ...(input.attachmentNames.length === 0
      ? []
      : [`Ekler: ${input.attachmentNames.map((n) => clip(n, 80)).join(', ')}`]),
    ...(input.instructions === null
      ? []
      : [`Kullanıcının isteği: ${clip(input.instructions, 500)}`]),
  ];
  const result = await callModel(pipeline, {
    feature: 'reply_draft',
    schema: ReplyDraftsV1,
    schemaName: 'ReplyDraftsV1',
    context,
    docs: thread.docs,
    vars: { tones: tones.join(', '), count: thread.docs.length },
    cacheContent: [
      'reply_draft',
      input.threadId,
      input.lastMessageId,
      tones.join(','),
      input.language,
      input.instructions ?? '',
    ].join('\n'),
    units: 1,
    injection: injectionScan(thread.text),
  });
  if (result.kind !== 'ai') return { kind: 't0', reason: result.reason };
  const refined = refineReplyDraftsV1(result.data, {
    threadText: `${thread.text}\n${input.instructions ?? ''}`,
    expect: input.expect,
    attachmentNames: input.attachmentNames,
  });
  if (!refined.ok) return { kind: 't0', reason: 'refine_failed' };
  return {
    kind: 'ai',
    data: refined.data,
    promptVersionId: result.promptVersionId,
    aiRequestId: result.aiRequestId,
    cached: result.cached,
    threadText: thread.text,
    injectionSuspected: refined.data.injection_suspected,
  };
}

export interface FollowUpRequest {
  readonly threadId: string;
  readonly sent: MailMessageRow;
  readonly body: string | null;
  readonly recipientName: string | null;
  readonly daysWaiting: number;
  readonly tone: Tone;
  readonly language: 'tr' | 'en';
  readonly instructions: string | null;
  readonly now: Date;
}

export async function generateFollowUp(
  pipeline: PipelineContext,
  input: FollowUpRequest,
): Promise<DraftOutcome<FollowUpDraftV1>> {
  const thread = threadDocs(
    [input.sent],
    input.body === null ? new Map() : new Map([[input.sent.id, input.body]]),
  );
  const docs = thread.docs.map((d) => ({ ...d, ref: 'm1' }));
  const context = [
    ...trustedHeader(pipeline.user, input.now),
    'm1: Senin gönderdiğin mail',
    ...(input.recipientName === null ? [] : [`Alıcı: ${input.recipientName}`]),
    `Bekleme: ${input.daysWaiting} gün`,
    `Dil: ${input.language}`,
    ...(input.instructions === null
      ? []
      : [`Kullanıcının isteği: ${clip(input.instructions, 500)}`]),
  ];
  const result = await callModel(pipeline, {
    feature: 'follow_up_draft',
    schema: FollowUpDraftV1,
    schemaName: 'FollowUpDraftV1',
    promptKey: 'follow_up',
    context,
    docs,
    vars: { tone: input.tone, count: 1 },
    cacheContent: [
      'follow_up',
      input.threadId,
      input.sent.id,
      input.tone,
      input.language,
      input.instructions ?? '',
    ].join('\n'),
    units: 1,
    injection: injectionScan(thread.text),
  });
  if (result.kind !== 'ai') return { kind: 't0', reason: result.reason };
  const refined = refineFollowUpDraftV1(result.data, {
    threadText: `${thread.text}\n${input.instructions ?? ''}`,
  });
  if (!refined.ok) return { kind: 't0', reason: 'refine_failed' };
  return {
    kind: 'ai',
    data: refined.data,
    promptVersionId: result.promptVersionId,
    aiRequestId: result.aiRequestId,
    cached: result.cached,
    threadText: thread.text,
    injectionSuspected: refined.data.injection_suspected,
  };
}
