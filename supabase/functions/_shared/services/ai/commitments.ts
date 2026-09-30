/**
 * Commitments pipeline (IMPLEMENTATION_PLAN T-5.03; AI_PIPELINE_PLAN §4.3.3, §6.6, §6.9.6; M§18).
 *
 * 1. T0 pre-signal: the Turkish promise regex (`detectCommitments`) must fire on the message.
 * 2. T1 `CommitmentExtractV1` (prompt `commitment`) locates the claims; a `hedged` or unverified
 *    claim escalates once to the next tier of the route (T2).
 * 3. Code verifies the evidence quote, re-parses the due date from `due_quote`, enforces the owner
 *    rule (owner `user` only on the user's own text) and links the counterparty to a participant.
 * 4. `commitmentOutcome`: verified + explicit + confident → commitment (dedupe key); hedged or
 *    partly verified → a pending `commitment_create` approval ("Bu bir söz mü?"); otherwise drop.
 *    A message flagged as a possible prompt injection never produces a commitment or a proposal.
 */
import {
  aiProposalIdempotencyKey,
  commitmentDedupeKey,
  type CommitmentDirection,
  commitmentOutcome,
  detectCommitments,
  type InjectionScan,
  linkPerson,
  localDate,
  ownerAllowed,
  type PersonCandidate,
  sha256Hex,
  type StoredEvidence,
} from '@da/domain';
import {
  type AiCommitmentClaim,
  CommitmentCreatePayload,
  CommitmentExtractV1,
  refineCommitmentExtractV1,
} from '@da/validation';
import { canonicalJson } from '../../idempotency.ts';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { clip, copy, type CopyLocale, formatDue } from '../copy.ts';
import type { ApprovalInsert, CommitmentInsert, MailMessageRow } from '../intel/types.ts';
import {
  aliasMap,
  groundDate,
  type GroundingScope,
  GroundingTally,
  groundQuote,
  storedEvidence,
} from './grounding.ts';
import { injectionScan, modelText, TRIAGE_BODY_TOKENS } from './hygiene.ts';
import { callModel, type PipelineContext, trustedHeader } from './pipeline.ts';

export const COMMITMENT_BATCH_SIZE = 5;

export interface CommitmentSource {
  readonly message: MailMessageRow;
  /** Visible body (transient). */
  readonly text: string;
  /** Participants and contacts the counterparty may link to. */
  readonly people: readonly PersonCandidate[];
}

export interface CommitmentDecision {
  readonly outcome: 'create' | 'propose';
  readonly message: MailMessageRow;
  readonly direction: CommitmentDirection;
  readonly text: string;
  readonly dueAt: Date | null;
  readonly dateOnly: boolean;
  readonly dueQuote: string | null;
  readonly evidence: readonly StoredEvidence[];
  readonly confidence: number;
  readonly contactId: string | null;
  readonly counterpartyName: string | null;
  readonly counterpartyEmail: string | null;
  readonly via: 'model' | 'escalated' | 'pattern';
}

export interface CommitmentRun {
  readonly decisions: readonly CommitmentDecision[];
  readonly escalated: boolean;
  readonly kind: 'ai' | 't0' | 'skipped';
  readonly reason: string | null;
  readonly injection: InjectionScan;
  readonly tally: GroundingTally;
}

const own = (m: MailMessageRow): boolean => m.direction === 'outbound';

/** Messages where the T0 promise pattern fires (non-negated). */
export function commitmentSignals(
  sources: readonly CommitmentSource[],
  timeZone: string,
): CommitmentSource[] {
  return sources.filter((s) =>
    detectCommitments(s.text, {
      sourceKind: own(s.message) ? 'sent_mail' : 'received_mail',
      anchor: s.message.sent_at ?? s.message.received_at,
      timeZone,
      counterpartyName: s.message.from_name,
    }).some((c) => c.certainty !== 'negated'),
  );
}

/** Default counterparty: the first recipient of the user's mail, or the sender of an inbound one. */
function defaultCounterparty(source: CommitmentSource): {
  email: string | null;
  name: string | null;
} {
  if (own(source.message)) {
    const email = source.message.to_emails[0] ?? null;
    const person = source.people.find((p) => p.email?.toLowerCase() === email?.toLowerCase());
    return { email, name: person?.name ?? null };
  }
  return { email: source.message.from_email, name: source.message.from_name };
}

interface Evaluated {
  readonly decision: CommitmentDecision | null;
  /** Hedged or partly verified: worth one escalation. */
  readonly unsure: boolean;
}

function evaluateClaim(
  claim: AiCommitmentClaim,
  source: CommitmentSource,
  scope: GroundingScope,
  tally: GroundingTally,
  via: CommitmentDecision['via'],
): Evaluated {
  const kind = own(source.message) ? 'sent_mail' : 'received_mail';
  const quote = groundQuote(claim.evidence, scope, tally, 'commitment');
  const due =
    claim.due_quote === null || quote === null
      ? null
      : groundDate(
          { ref: claim.evidence.ref, quote: claim.due_quote },
          scope,
          tally,
          'due_at',
          claim.certainty === 'hedged' ? 'hedged' : 'explicit',
        );
  const ownerOk = ownerAllowed(claim.owner, kind);
  const fallback = defaultCounterparty(source);
  const link =
    claim.counterparty_quote === null ? null : linkPerson(claim.counterparty_quote, source.people);
  const contactId =
    link?.linked === true
      ? link.id
      : (source.people.find((p) => p.email?.toLowerCase() === fallback.email?.toLowerCase())?.id ??
        null);
  const counterpartyName =
    link?.linked === false
      ? clip(link.text, 120)
      : clip(fallback.name ?? fallback.email ?? '', 120);
  const dueOk = claim.due_quote === null || due !== null;
  const allFieldsVerified =
    quote !== null && dueOk && (contactId !== null || counterpartyName !== '');
  const confidence = Math.min(
    quote?.match === 'exact' ? 0.9 : 0.8,
    due?.confidence ?? 0.9,
    claim.certainty === 'hedged' ? 0.65 : 1,
  );
  const outcome = commitmentOutcome({
    certainty: claim.certainty,
    quoteVerified: quote !== null,
    ownerOk,
    allFieldsVerified,
    confidence,
  });
  const unsure = claim.certainty === 'hedged' || (quote !== null && !allFieldsVerified);
  if (outcome === 'drop' || quote === null) return { decision: null, unsure };
  const direction: CommitmentDirection = claim.owner === 'counterparty' ? 'they_owe' : 'user_owes';
  const evidence: StoredEvidence[] = [storedEvidence('commitment', quote)];
  if (due !== null) evidence.push(storedEvidence('due_at', due.evidence));
  return {
    unsure,
    decision: {
      outcome,
      message: source.message,
      direction,
      text: clip(claim.what_tr.trim() === '' ? quote.quote : claim.what_tr, 500),
      dueAt: due?.dueAt ?? null,
      dateOnly: due === null ? false : due.resolution.precision !== 'datetime',
      dueQuote: due === null ? null : claim.due_quote,
      evidence,
      confidence,
      contactId,
      counterpartyName: counterpartyName === '' ? null : counterpartyName,
      counterpartyEmail: fallback.email,
      via,
    },
  };
}

/** Deterministic fallback (model unavailable): every pattern hit becomes a proposal. */
function patternDecisions(
  sources: readonly CommitmentSource[],
  timeZone: string,
): CommitmentDecision[] {
  return sources.flatMap((s) => {
    const fallback = defaultCounterparty(s);
    const contactId =
      s.people.find((p) => p.email?.toLowerCase() === fallback.email?.toLowerCase())?.id ?? null;
    return detectCommitments(s.text, {
      sourceKind: own(s.message) ? 'sent_mail' : 'received_mail',
      anchor: s.message.sent_at ?? s.message.received_at,
      timeZone,
      counterpartyName: s.message.from_name,
    })
      .filter((c) => c.certainty !== 'negated')
      .map((c) => ({
        outcome: 'propose' as const,
        message: s.message,
        direction: c.direction,
        text: clip(c.text, 500),
        dueAt: c.due?.dueAt ?? null,
        dateOnly: c.due?.dateOnly ?? false,
        dueQuote: null,
        evidence: [
          { quote: c.quote, field: 'commitment', locator: `m1:${c.span[0]}-${c.span[1]}` },
        ],
        confidence: Math.min(c.confidence, 0.65),
        contactId,
        counterpartyName: clip(fallback.name ?? fallback.email ?? '', 120) || null,
        counterpartyEmail: fallback.email,
        via: 'pattern' as const,
      }));
  });
}

async function runModel(
  pipeline: PipelineContext,
  batch: readonly CommitmentSource[],
  docs: readonly UntrustedDoc[],
  injection: InjectionScan,
  escalate: boolean,
  now: Date,
) {
  const context = [
    ...trustedHeader(pipeline.user, now),
    ...batch.map(
      (s, i) =>
        `m${i + 1}: ${own(s.message) ? 'Senin gönderdiğin mail' : 'Gelen mail'} · ${localDate(
          s.message.sent_at ?? s.message.received_at,
          pipeline.user.timeZone,
        )}`,
    ),
  ];
  return await callModel(pipeline, {
    feature: 'commitment_extract',
    schema: CommitmentExtractV1,
    schemaName: 'CommitmentExtractV1',
    context,
    docs,
    vars: { count: batch.length },
    cacheContent: `commitment${escalate ? ':t2' : ''}\n${docs.map((d) => `${d.ref}\n${d.text}`).join('\n')}`,
    units: batch.length,
    injection,
    ...(escalate ? { skipPrimary: true } : {}),
  });
}

/** Runs the pipeline for up to {@link COMMITMENT_BATCH_SIZE} messages of one user. */
export async function extractCommitments(
  pipeline: PipelineContext,
  sources: readonly CommitmentSource[],
  now: Date,
): Promise<CommitmentRun> {
  const tally = new GroundingTally();
  const tz = pipeline.user.timeZone;
  const batch = commitmentSignals(sources, tz).slice(0, COMMITMENT_BATCH_SIZE);
  const texts = batch.map((s) => modelText({ text: s.text, html: null }, TRIAGE_BODY_TOKENS).text);
  const injection = injectionScan(texts.join('\n'));
  const noSignal: InjectionScan = { suspected: false, signals: [] };
  if (batch.length === 0) {
    return {
      decisions: [],
      escalated: false,
      kind: 'skipped',
      reason: 'no_signal',
      injection: noSignal,
      tally,
    };
  }
  if (injection.suspected) {
    return {
      decisions: [],
      escalated: false,
      kind: 'skipped',
      reason: 'injection_suspected',
      injection,
      tally,
    };
  }
  const docs: UntrustedDoc[] = batch.map((_, i) => ({
    ref: `m${i + 1}`,
    kind: 'email',
    text: texts[i]!,
  }));
  const scope: GroundingScope = {
    aliases: aliasMap(docs.map((d) => [d.ref, d.text] as const)),
    anchor: batch[0]!.message.sent_at ?? batch[0]!.message.received_at,
    timeZone: tz,
  };
  const ownRefs = batch.flatMap((s, i) => (own(s.message) ? [`m${i + 1}`] : []));
  const evaluate = (data: CommitmentExtractV1, via: CommitmentDecision['via']) => {
    const refined = refineCommitmentExtractV1(data, { aliases: docs.map((d) => d.ref), ownRefs });
    if (!refined.ok) return null;
    const out = new Map<string, Evaluated[]>();
    let flagged = false;
    for (const item of refined.data.items) {
      const index = Number(item.ref.slice(1)) - 1;
      const source = batch[index];
      if (source === undefined) continue;
      if (item.injection_suspected) flagged = true;
      const anchorScope = {
        ...scope,
        anchor: source.message.sent_at ?? source.message.received_at,
      };
      out.set(
        item.ref,
        item.commitments.map((c) => evaluateClaim(c, source, anchorScope, tally, via)),
      );
    }
    return { out, flagged };
  };
  const first = await runModel(pipeline, batch, docs, injection, false, now);
  if (first.kind !== 'ai') {
    return {
      decisions: patternDecisions(batch, tz),
      escalated: false,
      kind: 't0',
      reason: first.reason,
      injection,
      tally,
    };
  }
  const result = evaluate(first.data, 'model');
  if (result === null) {
    return {
      decisions: patternDecisions(batch, tz),
      escalated: false,
      kind: 't0',
      reason: 'refine_failed',
      injection,
      tally,
    };
  }
  if (result.flagged) {
    return {
      decisions: [],
      escalated: false,
      kind: 'ai',
      reason: 'injection_suspected',
      injection,
      tally,
    };
  }
  const unsure = [...result.out.values()].some((list) => list.some((e) => e.unsure));
  let escalated = false;
  if (unsure) {
    const second = await runModel(pipeline, batch, docs, injection, true, now);
    if (second.kind === 'ai') {
      const again = evaluate(second.data, 'escalated');
      if (again !== null && !again.flagged) {
        escalated = true;
        for (const [ref, list] of result.out) {
          const better = again.out.get(ref);
          if (list.some((e) => e.unsure) && better !== undefined) result.out.set(ref, better);
        }
      } else if (again?.flagged === true) {
        return {
          decisions: [],
          escalated: true,
          kind: 'ai',
          reason: 'injection_suspected',
          injection,
          tally,
        };
      }
    }
  }
  const decisions = [...result.out.values()].flatMap((list) =>
    list.flatMap((e) => (e.decision === null ? [] : [e.decision])),
  );
  return { decisions, escalated, kind: 'ai', reason: null, injection, tally };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function provenance(d: CommitmentDecision) {
  return {
    source_type: 'email_message' as const,
    source_id: d.message.id,
    source_provider: d.message.provider,
    source_timestamp: d.message.sent_at ?? d.message.received_at,
    confidence: Math.round(d.confidence * 1000) / 1000,
    evidence: d.evidence.slice(0, 5),
  };
}

export function commitmentRow(userId: string, d: CommitmentDecision): CommitmentInsert {
  return {
    user_id: userId,
    contact_id: d.contactId,
    counterparty_name: d.counterpartyName ?? (d.contactId === null ? d.counterpartyEmail : null),
    direction: d.direction,
    text: d.text.length >= 3 ? d.text : clip(d.evidence[0]?.quote ?? d.text, 500),
    due_at: d.dueAt?.toISOString() ?? null,
    due_is_date_only: d.dateOnly,
    dedupe_key: commitmentDedupeKey({
      sourceType: 'email_message',
      sourceId: d.message.id,
      text: d.text,
      direction: d.direction,
      contactId: d.contactId,
      counterpartyName: d.counterpartyName,
    }),
    origin: 'email_analysis',
    ...provenance(d),
  };
}

/** Pending `commitment_create` proposal (M§18 "Bu bir söz mü?"); null when the payload is invalid. */
export function approvalRow(
  userId: string,
  d: CommitmentDecision,
  locale: CopyLocale,
  timeZone: string,
): ApprovalInsert | null {
  const counterparty = {
    ...(d.contactId === null ? {} : { contact_id: d.contactId }),
    ...(d.counterpartyName === null ? {} : { name: d.counterpartyName }),
    ...(d.counterpartyEmail === null ? {} : { email: d.counterpartyEmail }),
  };
  const due = d.dueAt === null ? null : formatDue(locale, d.dueAt, timeZone, d.dateOnly);
  const candidate = {
    action_type: 'commitment_create' as const,
    text: d.text,
    direction: d.direction,
    counterparty,
    due_at: d.dueAt?.toISOString() ?? null,
    ...(d.dueQuote === null ? {} : { due_text: clip(d.dueQuote, 100) }),
    due_precision:
      d.dueAt === null ? ('none' as const) : d.dateOnly ? ('date' as const) : ('datetime' as const),
    source: {
      source_type: 'email_message' as const,
      source_id: d.message.id,
      source_provider: d.message.provider,
      source_timestamp: new Date(d.message.sent_at ?? d.message.received_at).toISOString(),
    },
    evidence: {
      quote: clip(d.evidence[0]?.quote ?? d.text, 300),
      source: {
        source_type: 'email_message' as const,
        source_id: d.message.id,
        source_provider: d.message.provider,
        source_timestamp: new Date(d.message.sent_at ?? d.message.received_at).toISOString(),
      },
    },
    confidence: Math.round(d.confidence * 1000) / 1000,
  };
  const parsed = CommitmentCreatePayload.safeParse(candidate);
  if (!parsed.success) return null;
  const payload = parsed.data as unknown as Record<string, unknown>;
  const name = d.counterpartyName ?? d.counterpartyEmail ?? '';
  const directionKey = d.direction === 'user_owes' ? 'userOwes' : 'theyOwe';
  return {
    user_id: userId,
    action_type: 'commitment_create',
    payload,
    payload_hash: `\\x${sha256Hex(canonicalJson(payload))}`,
    what: clip(copy(locale, 'commitments.generated.approval.what', { text: d.text }), 200),
    why: clip(
      copy(locale, `commitments.generated.approval.why.${directionKey}`, {
        name: name === '' ? 'none' : name,
      }),
      300,
    ),
    change_summary: clip(
      due === null
        ? copy(locale, 'commitments.generated.approval.change', { text: d.text })
        : copy(locale, 'commitments.generated.approval.changeDue', { text: d.text, due }),
      500,
    ),
    side_effects: [
      { code: 'in_app_only', text: copy(locale, 'commitments.generated.approval.sideEffect') },
    ],
    idempotency_key: aiProposalIdempotencyKey(
      'commitment_create',
      'email_message',
      d.message.id,
      `${d.direction}|${d.text}|${d.dueAt?.toISOString() ?? ''}`,
    ),
    origin: 'commitment_detection',
    origin_ref_id: d.message.id,
    exact_change: {
      text: d.text,
      direction: d.direction,
      counterparty: name,
      due_at: d.dueAt?.toISOString() ?? null,
    },
    destination_label: null,
    ...provenance(d),
  };
}
