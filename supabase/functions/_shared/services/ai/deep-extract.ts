/**
 * Deep email analysis (IMPLEMENTATION_PLAN T-5.02; AI_PIPELINE_PLAN §4.3.4; JOB-11).
 *
 * Runs on important or complex messages (triage escalation or `email_analysis.reasons`). The model
 * only locates: every key point, deadline, task, amount, schedule request and person carries a
 * verbatim quote; code verifies the quote and re-parses dates and amounts from it. Unverified
 * fields are dropped and listed in `dropped_fields` ("Kaynakta kesinleşmiyor.").
 */
import {
  type AmountMatch,
  type InjectionScan,
  localDate,
  type StoredEvidence,
  stripQuotedHistory,
} from '@da/domain';
import {
  type AiCommitmentClaim as CommitmentClaim,
  EmailDeepExtractV1,
  refineEmailDeepExtractV1,
} from '@da/validation';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { clip } from '../copy.ts';
import type { MailMessageRow, MailThreadRow } from '../intel/types.ts';
import {
  aliasMap,
  bandConfidence,
  groundAmount,
  groundDate,
  type GroundingScope,
  GroundingTally,
  groundQuote,
  guardSummary,
  storedEvidence,
} from './grounding.ts';
import { DEEP_EXTRACT_BODY_TOKENS, injectionScan, modelText } from './hygiene.ts';
import { callModel, type PipelineContext, trustedHeader } from './pipeline.ts';

export interface DeepDeadline {
  readonly what: string;
  readonly dueAt: Date;
  readonly dateOnly: boolean;
  readonly evidence: StoredEvidence;
  readonly confidence: number;
}

export interface DeepAmount {
  readonly label: string;
  readonly amount: AmountMatch;
  readonly evidence: StoredEvidence;
}

export interface DeepExtractResult {
  readonly kind: 'ai' | 't0';
  readonly reason: string | null;
  readonly summary: string | null;
  readonly keyPoints: readonly { text: string; evidence: StoredEvidence }[];
  readonly deadlines: readonly DeepDeadline[];
  readonly scheduleRequests: readonly { kind: string; evidence: StoredEvidence }[];
  readonly tasks: readonly { what: string; dueAt: Date | null; evidence: StoredEvidence }[];
  readonly amounts: readonly DeepAmount[];
  /** Refined claims (verified again by the commitments stage). */
  readonly commitments: readonly CommitmentClaim[];
  readonly people: readonly { name: string; role: string | null }[];
  readonly injectionSuspected: boolean;
  readonly confidence: number;
  readonly droppedFields: readonly string[];
  readonly promptVersionId: string | null;
  readonly tally: GroundingTally;
  /** The source text the claims were verified against (transient; never persisted). */
  readonly source: string;
}

export interface DeepExtractInput {
  readonly message: MailMessageRow;
  readonly thread: MailThreadRow | null;
  /** Visible body text (transient). */
  readonly body: string;
  readonly now: Date;
  readonly senderKnown: boolean;
}

function empty(
  reason: string,
  source: string,
  tally: GroundingTally,
  scan: InjectionScan,
): DeepExtractResult {
  return {
    kind: 't0',
    reason,
    summary: null,
    keyPoints: [],
    deadlines: [],
    scheduleRequests: [],
    tasks: [],
    amounts: [],
    commitments: [],
    people: [],
    injectionSuspected: scan.suspected,
    confidence: 0,
    droppedFields: [],
    promptVersionId: null,
    tally,
    source,
  };
}

export async function deepExtract(
  pipeline: PipelineContext,
  input: DeepExtractInput,
): Promise<DeepExtractResult> {
  const tally = new GroundingTally();
  const m = input.message;
  const visible = stripQuotedHistory(input.body);
  const redacted = modelText(
    { text: `${m.subject ?? ''}\n\n${visible}`, html: null },
    DEEP_EXTRACT_BODY_TOKENS,
  );
  const source = redacted.text;
  const scan = injectionScan(source);
  const docs: UntrustedDoc[] = [{ ref: 'm1', kind: 'email', text: source }];
  const prior = input.thread?.rolling_summary;
  if (prior !== null && prior !== undefined && prior.trim() !== '') {
    docs.push({ ref: 't1', kind: 'summary', text: clip(prior, 800) });
  }
  const context = [
    ...trustedHeader(pipeline.user, input.now),
    `m1: ${m.direction === 'outbound' ? 'Senin gönderdiğin mail' : 'Gelen mail'} · ${localDate(
      m.received_at,
      pipeline.user.timeZone,
    )}`,
  ];
  const result = await callModel(pipeline, {
    feature: 'email_deep_extract',
    schema: EmailDeepExtractV1,
    schemaName: 'EmailDeepExtractV1',
    context,
    docs,
    cacheContent: `email_deep_extract\n${docs.map((d) => `${d.ref}\n${d.text}`).join('\n')}`,
    units: 1,
    injection: scan,
  });
  if (result.kind !== 'ai') return empty(result.reason, source, tally, scan);
  const refined = refineEmailDeepExtractV1(result.data, {
    aliases: docs.map((d) => d.ref),
    ownText: m.direction === 'outbound',
  });
  if (!refined.ok) return empty('refine_failed', source, tally, scan);
  const data = refined.data;
  const scope: GroundingScope = {
    aliases: aliasMap([['m1', source]]),
    anchor: m.received_at,
    timeZone: pipeline.user.timeZone,
    senderType: input.senderKnown ? 'known' : 'unknown',
    senderDomain: m.from_email.split('@')[1]?.toLowerCase() ?? null,
  };
  const dropped = new Set<string>();
  const keep = <T>(value: T | null, field: string): value is T => {
    if (value === null) dropped.add(field);
    return value !== null;
  };
  const keyPoints = data.key_points.flatMap((k) => {
    const ev = groundQuote(k.evidence, scope, tally, 'key_points');
    return keep(ev, 'key_points')
      ? [{ text: clip(k.text_tr, 200), evidence: storedEvidence('key_points', ev) }]
      : [];
  });
  const deadlines = data.deadlines.flatMap((d) => {
    const ev = groundQuote(d.evidence, scope, tally, 'deadline_evidence');
    const date =
      ev === null
        ? null
        : groundDate({ ref: 'm1', quote: d.when_quote }, scope, tally, 'due_at', d.certainty);
    if (!keep(ev, 'due_at') || !keep(date, 'due_at')) return [];
    return [
      {
        what: clip(d.what_tr, 80),
        dueAt: date.dueAt,
        dateOnly: date.resolution.precision !== 'datetime',
        evidence: storedEvidence('due_at', date.evidence),
        confidence: Math.min(date.confidence, bandConfidence(data.confidence) + 0.1),
      },
    ];
  });
  const scheduleRequests = data.schedule_requests.flatMap((s) => {
    const ev = groundQuote(s.evidence, scope, tally, 'schedule_request');
    return keep(ev, 'schedule_request')
      ? [{ kind: s.kind, evidence: storedEvidence('schedule_request', ev) }]
      : [];
  });
  const tasks = data.tasks_for_user.flatMap((t) => {
    const ev = groundQuote(t.evidence, scope, tally, 'task');
    if (!keep(ev, 'task')) return [];
    const due =
      t.due_quote === null
        ? null
        : groundDate({ ref: 'm1', quote: t.due_quote }, scope, tally, 'task_due');
    if (t.due_quote !== null && due === null) dropped.add('task_due');
    return [
      {
        what: clip(t.what_tr, 80),
        dueAt: due?.dueAt ?? null,
        evidence: storedEvidence('task', ev),
      },
    ];
  });
  const amounts = data.amounts.flatMap((a) => {
    const ev = groundQuote(a.evidence, scope, tally, 'amount_evidence');
    const amount =
      ev === null
        ? null
        : groundAmount({ ref: 'm1', quote: a.amount_quote }, scope, tally, 'amount');
    if (!keep(ev, 'amount') || !keep(amount, 'amount')) return [];
    return [
      {
        label: clip(a.label_tr, 80),
        amount: amount.value,
        evidence: storedEvidence('amount', amount.evidence),
      },
    ];
  });
  const people = data.people.flatMap((p) =>
    groundQuote({ ref: p.evidence.ref, quote: p.name_quote }, scope, tally, 'people') === null
      ? []
      : [{ name: clip(p.name_quote, 120), role: p.role_tr }],
  );
  const trusted = [pipeline.user.displayName ?? '', m.from_name ?? ''].filter((n) => n !== '');
  const summary = guardSummary(data.summary_tr, [source], trusted, tally, 'ai_summary');
  if (data.summary_tr.trim() !== '' && summary === null) dropped.add('ai_summary');
  return {
    kind: 'ai',
    reason: null,
    summary: summary === null ? null : clip(summary, 400),
    keyPoints: keyPoints.slice(0, 5),
    deadlines,
    scheduleRequests,
    tasks,
    amounts,
    commitments: data.commitments,
    people,
    injectionSuspected: data.injection_suspected || scan.suspected,
    confidence: bandConfidence(data.confidence),
    droppedFields: [...dropped],
    promptVersionId: result.promptVersionId,
    tally,
    source,
  };
}
