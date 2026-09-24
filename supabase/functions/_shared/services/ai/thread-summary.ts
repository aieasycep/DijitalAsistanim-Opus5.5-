/**
 * Thread summaries (IMPLEMENTATION_PLAN T-5.02; AI_PIPELINE_PLAN §4.3.2; API-MAIL-07).
 *
 * Incremental context only: the prior `rolling_summary` (alias `t1`, derived data) plus the
 * messages after `last_processed_message_id` (`m1..mN`, transient bodies or stored snippets). The
 * result is cached per (thread, last message, prompt version) in the per-user result cache, so
 * opening the same thread twice costs one model call; a refresh overwrites the entry. Every key
 * point and open question must cite a verified quote; the summary passes the free-text guard.
 */
import { localDate, type StoredEvidence, stripQuotedHistory } from '@da/domain';
import { refineThreadSummaryV1, ThreadSummaryV1 } from '@da/validation';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { clip } from '../copy.ts';
import type { MailMessageRow, MailThreadRow } from '../intel/types.ts';
import {
  aliasMap,
  type GroundingScope,
  GroundingTally,
  groundQuote,
  guardSummary,
  storedEvidence,
} from './grounding.ts';
import { modelText, THREAD_MESSAGE_TOKENS } from './hygiene.ts';
import { callModel, type PipelineContext, trustedHeader } from './pipeline.ts';

/** Newest messages sent to the model in one summary call. */
export const THREAD_SUMMARY_MAX_MESSAGES = 8;

export interface ThreadSummaryInput {
  readonly thread: MailThreadRow;
  /** Messages of the thread, oldest first (at most the newest few). */
  readonly messages: readonly MailMessageRow[];
  /** Transient visible bodies by message id (absent → snippet / stored summary). */
  readonly bodies: ReadonlyMap<string, string>;
  readonly refresh: boolean;
  readonly now: Date;
}

export interface SummaryPoint {
  readonly text: string;
  readonly message: MailMessageRow;
  readonly evidence: StoredEvidence;
}

export interface ThreadSummaryOutcome {
  readonly kind: 'ai' | 't0';
  readonly reason: string | null;
  readonly summary: string;
  readonly keyPoints: readonly SummaryPoint[];
  readonly openQuestions: readonly { text: string; owner: 'user' | 'other' | 'unclear' }[];
  readonly cached: boolean;
  readonly promptVersionId: string | null;
  readonly injectionSuspected: boolean;
  readonly lastMessageId: string | null;
  readonly tally: GroundingTally;
}

/** Messages the model needs: those after the last processed one (all when unknown). */
export function newMessages(
  thread: MailThreadRow,
  messages: readonly MailMessageRow[],
): MailMessageRow[] {
  const sorted = [...messages].sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  const at = sorted.findIndex((m) => m.id === thread.last_processed_message_id);
  const fresh = at === -1 || thread.rolling_summary === null ? sorted : sorted.slice(at + 1);
  // Nothing new since the last run: the newest message anchors the call (and its cache key).
  return (fresh.length === 0 ? sorted.slice(-1) : fresh).slice(-THREAD_SUMMARY_MAX_MESSAGES);
}

function messageText(m: MailMessageRow, body: string | undefined): string {
  if (body !== undefined && body.trim() !== '') {
    return modelText({ text: stripQuotedHistory(body), html: null }, THREAD_MESSAGE_TOKENS).text;
  }
  return [m.subject ?? '', m.snippet ?? '', m.ai_summary ?? ''].filter((t) => t !== '').join('\n');
}

/** T0 rendering from stored derived data (model unavailable or budget exhausted). */
function t0Summary(input: ThreadSummaryInput, reason: string, tally: GroundingTally): ThreadSummaryOutcome {
  const latest = [...input.messages].sort(
    (a, b) => Date.parse(b.received_at) - Date.parse(a.received_at),
  )[0];
  const summary = clip(
    input.thread.rolling_summary ?? input.thread.ai_summary ?? latest?.ai_summary ?? latest?.snippet ?? '',
    600,
  );
  return {
    kind: 't0',
    reason,
    summary,
    keyPoints: [],
    openQuestions: [],
    cached: false,
    promptVersionId: null,
    injectionSuspected: false,
    lastMessageId: latest?.id ?? null,
    tally,
  };
}

export async function summarizeThread(
  pipeline: PipelineContext,
  input: ThreadSummaryInput,
): Promise<ThreadSummaryOutcome> {
  const tally = new GroundingTally();
  const fresh = newMessages(input.thread, input.messages);
  const last = fresh[fresh.length - 1] ?? null;
  if (last === null) return t0Summary(input, 'no_messages', tally);
  const docs: UntrustedDoc[] = [];
  const byRef = new Map<string, MailMessageRow>();
  const context = [...trustedHeader(pipeline.user, input.now)];
  fresh.forEach((m, i) => {
    const ref = `m${i + 1}`;
    byRef.set(ref, m);
    docs.push({ ref, kind: 'email', text: messageText(m, input.bodies.get(m.id)) });
    context.push(
      `${ref}: ${m.direction === 'outbound' ? 'Senin mesajın' : 'Gelen mesaj'} · ${localDate(
        m.received_at,
        pipeline.user.timeZone,
      )}`,
    );
  });
  const prior = input.thread.rolling_summary;
  if (prior !== null && prior.trim() !== '' && fresh.length < input.messages.length) {
    docs.push({ ref: 't1', kind: 'summary', text: clip(prior, 1200) });
    context.push('t1: önceki özet');
  }
  const result = await callModel(pipeline, {
    feature: 'thread_summary',
    schema: ThreadSummaryV1,
    schemaName: 'ThreadSummaryV1',
    context,
    docs,
    cacheContent: `thread_summary\n${input.thread.id}\n${last.id}`,
    refreshCache: input.refresh,
    units: 1,
  });
  if (result.kind !== 'ai') return t0Summary(input, result.reason, tally);
  const refined = refineThreadSummaryV1(result.data, { aliases: docs.map((d) => d.ref) });
  if (!refined.ok) return t0Summary(input, 'refine_failed', tally);
  const data = refined.data;
  const scope: GroundingScope = {
    aliases: aliasMap(docs.map((d) => [d.ref, d.text] as const)),
    anchor: last.received_at,
    timeZone: pipeline.user.timeZone,
  };
  const trusted = [
    pipeline.user.displayName ?? '',
    ...input.thread.participants.map((p) => p.name ?? ''),
  ].filter((n) => n !== '');
  const summary =
    guardSummary(data.summary_tr, docs.map((d) => d.text), trusted, tally, 'summary') ??
    clip(prior ?? '', 600);
  const keyPoints: SummaryPoint[] = [];
  for (const k of data.key_points) {
    const ev = groundQuote(k.evidence, scope, tally, 'key_points');
    const message = byRef.get(k.evidence.ref);
    if (ev === null || message === undefined) continue;
    keyPoints.push({ text: clip(k.text_tr, 200), message, evidence: storedEvidence('key_points', ev) });
  }
  const openQuestions = data.open_questions.flatMap((q) =>
    groundQuote(q.evidence, scope, tally, 'open_questions') === null
      ? []
      : [
          {
            text: clip(q.text_tr, 200),
            owner: q.owner === 'counterparty' ? ('other' as const) : q.owner,
          },
        ],
  );
  return {
    kind: 'ai',
    reason: null,
    summary: clip(summary, 600),
    keyPoints: keyPoints.slice(0, 5),
    openQuestions: openQuestions.slice(0, 5),
    cached: result.cached,
    promptVersionId: result.promptVersionId,
    injectionSuspected: data.injection_suspected,
    lastMessageId: last.id,
    tally,
  };
}
