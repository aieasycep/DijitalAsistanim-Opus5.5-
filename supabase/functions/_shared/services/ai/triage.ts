/**
 * Email triage (IMPLEMENTATION_PLAN T-5.01; AI_PIPELINE_PLAN §1.4, §4.3.1, §7, §8.2; JOB-10).
 *
 * T0 first: Data Source Controls, explicit rules and VIP, learned preferences, deterministic
 * signals (List-Unsubscribe, Precedence, Auto-Submitted, ESP DKIM, no-reply, Cc-only, security
 * templates with DKIM/SPF, transactional templates / JSON-LD, verified deadlines today/tomorrow),
 * sender reputation (known contact, replied before) and the per-user content-hash cache. Survivors
 * are classified by T1 in micro-batches of ≤5 (`EmailTriageV1`), every claim is grounded, and the
 * final category is decided by the priority engine: an explicit rule always overrides the model.
 * An exhausted budget or a kill switch leaves the T0 result (`skipped_budget` / `skipped_flag`).
 */
import {
  type AiClassification,
  detectCommitments,
  detectExpectsReply,
  emailDomain,
  evaluatePriority,
  type ExpectsReply,
  foldTR,
  type InjectionScan,
  type LearnedPreference,
  localDate,
  localDateDiffDays,
  type MailCategory,
  normalizeTR,
  parseDatesTR,
  prescanInjection,
  type PriorityContext,
  type PriorityItem,
  type PriorityResult,
  type PriorityRule,
  type StoredEvidence,
  type Urgency,
} from '@da/domain';
import { EmailTriageV1, type EmailTriageItem, refineEmailTriageV1 } from '@da/validation';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { clip, copy } from '../copy.ts';
import { whyText } from '../insights/explain.ts';
import type { LifeDetection } from '../life/classify.ts';
import { detectLife } from '../life/classify.ts';
import type { MailMessageRow, MailThreadRow } from '../intel/types.ts';
import type { SenderHistory, VipSet } from '../intel/store.ts';
import {
  aliasMap,
  bandConfidence,
  evidenceList,
  groundDate,
  groundQuote,
  GroundingTally,
  type GroundingScope,
  guardSummary,
  storedEvidence,
} from './grounding.ts';
import { isHealthSender, modelText, TRIAGE_BODY_TOKENS, visibleText } from './hygiene.ts';
import { callModel, type PipelineContext, trustedHeader } from './pipeline.ts';

export const TRIAGE_BATCH_SIZE = 5;

export interface TriageBody {
  readonly text: string;
  readonly html: string | null;
}

export interface TriageContext {
  readonly rules: readonly PriorityRule[];
  readonly learned: readonly LearnedPreference[];
  readonly vip: VipSet;
  readonly ownAddresses: readonly string[];
  readonly history: SenderHistory;
  readonly isPro: boolean;
  readonly learnFromInteractions: boolean;
  readonly timeZone: string;
  readonly now: Date;
  /** `ai_data_access.mail_body`: off → no body ever reaches a model. */
  readonly mailBodyAllowed: boolean;
}

/** One message after T0. */
export interface PreparedMessage {
  readonly row: MailMessageRow;
  readonly thread: MailThreadRow | null;
  readonly item: PriorityItem;
  readonly t0: PriorityResult;
  readonly life: LifeDetection;
  readonly injection: InjectionScan;
  /** Visible text (transient) or null without a body. */
  readonly visible: string | null;
  /** Redacted, capped text for the model (transient). */
  readonly forModel: string;
  readonly redactions: number;
  /** T0 decision is final (no model call needed). */
  readonly t0Final: boolean;
  readonly t0Deadline: { dueAt: Date; evidence: StoredEvidence; days: number } | null;
  readonly expectsReply: ExpectsReply | null;
  /** Sent-mail commitment pre-signal fired (§6.9.6). */
  readonly commitmentSignal: boolean;
}

function pctx(ctx: TriageContext): PriorityContext {
  return {
    rules: ctx.rules,
    learned: ctx.learned,
    vip: ctx.vip,
    isPro: ctx.isPro,
    learnFromInteractions: ctx.learnFromInteractions,
  };
}

/** T0 deadline from the subject and first visible characters (`by` expressions only). */
function t0Deadline(
  row: MailMessageRow,
  visible: string,
  ctx: TriageContext,
): PreparedMessage['t0Deadline'] {
  const source = `${row.subject ?? ''}\n${visible.slice(0, 600)}`;
  const found = parseDatesTR(source, { anchor: row.received_at, timeZone: ctx.timeZone })
    .filter((d) => d.by && !d.past)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  if (found === undefined) return null;
  const days = localDateDiffDays(localDate(ctx.now, ctx.timeZone), found.localDate);
  if (days < 0) return null;
  const s = Math.max(0, found.span[0] - 40);
  const quote = source.slice(s, Math.min(source.length, found.span[1] + 40)).trim();
  return {
    dueAt:
      found.precision === 'datetime'
        ? found.start
        : new Date(found.end.getTime() - 6 * 3_600_000),
    evidence: { quote: quote.slice(0, 200), field: 'deadline', locator: `m1:${s}-${found.span[1]}` },
    days,
  };
}

/** T0 pass over one message (a transient body may be null: metadata-only triage). */
export function prepareMessage(
  row: MailMessageRow,
  thread: MailThreadRow | null,
  body: TriageBody | null,
  ctx: TriageContext,
): PreparedMessage {
  const from = row.from_email.toLowerCase();
  const health = isHealthSender(from);
  const bodyUsable = body !== null && ctx.mailBodyAllowed && !health;
  const visible = bodyUsable ? visibleText({ text: body.text, html: body.html }, 4_000) : null;
  const subject = row.subject ?? '';
  const life = detectLife({
    fromEmail: from,
    subject,
    text: visible ?? row.snippet ?? '',
    html: bodyUsable ? body.html : null,
    anchor: new Date(row.received_at),
    timeZone: ctx.timeZone,
    dkimPass: row.dkim_pass,
    spfPass: row.spf_pass,
  });
  const deadline = t0Deadline(row, visible ?? row.snippet ?? '', ctx);
  const known = ctx.history.known.has(from);
  const item: PriorityItem = {
    source: 'mail',
    fromEmail: from,
    toEmails: row.to_emails,
    ccEmails: row.cc_emails,
    userAddresses: ctx.ownAddresses,
    labels: row.labels,
    headers: {
      listUnsubscribe: row.list_unsubscribe,
      precedence: row.precedence_bulk ? 'bulk' : null,
      autoSubmitted: row.auto_submitted ? 'auto-generated' : null,
    },
    dkimDomain: row.dkim_pass === true ? emailDomain(from) : null,
    dkimPass: row.dkim_pass === true || row.spf_pass === true,
    securityTemplate: life.security !== 'none',
    securityProviderDomain: emailDomain(from),
    transactional: life.transactional,
    knownContact: known,
    repliedBefore: ctx.history.repliedBefore.has(from),
    awaitingUserReply: thread?.reply_state === 'awaiting_their_reply' && row.direction === 'inbound',
    verifiedDeadlineInDays: deadline?.days ?? null,
    subject,
    snippet: (visible ?? row.snippet ?? '').slice(0, 400),
    bodyText: visible,
    listKey: row.list_unsubscribe ? emailDomain(from) : null,
  };
  const t0 = evaluatePriority(item, pctx(ctx));
  const injection = prescanInjection(`${subject}\n${visible ?? row.snippet ?? ''}`);
  const redacted = modelText(
    { text: `${subject}\n\n${visible ?? row.snippet ?? ''}`, html: null },
    TRIAGE_BODY_TOKENS,
  );
  const bulk = t0.signals.some((s) =>
    [
      'list_unsubscribe',
      'precedence_bulk',
      'auto_submitted',
      'category_promotions',
      'category_social',
      'category_forums',
      'esp_bulk',
    ].includes(s),
  );
  const t0Final =
    row.direction === 'outbound' ||
    health ||
    t0.importance === 'muted' ||
    life.security !== 'none' ||
    (bulk && t0.decision_tier !== 'explicit_rule') ||
    (life.matched && !t0.realtime) ||
    (t0.decision_tier === 'learned_preference' && t0.importance === 'low') ||
    (t0.decision_tier === 'deterministic_signal' &&
      t0.category === 'informational' &&
      t0.reason_code !== 'pending_ai' &&
      !t0.realtime);
  let expects: ExpectsReply | null = null;
  let commitmentSignal = false;
  if (row.direction === 'outbound' && visible !== null) {
    expects = detectExpectsReply(visible);
    commitmentSignal =
      detectCommitments(visible, {
        sourceKind: 'sent_mail',
        anchor: row.sent_at ?? row.received_at,
        timeZone: ctx.timeZone,
      }).some((c) => c.certainty !== 'negated');
  }
  return {
    row,
    thread,
    item,
    t0,
    life,
    injection,
    visible,
    forModel: redacted.text,
    redactions: redacted.count,
    t0Final,
    t0Deadline: deadline,
    expectsReply: expects,
    commitmentSignal,
  };
}

// ── T1 classification ────────────────────────────────────────────────────────

export interface AiTriage {
  readonly item: EmailTriageItem;
  readonly needsReply: boolean;
  readonly replyEvidence: StoredEvidence | null;
  readonly deadlines: readonly { what: string; dueAt: Date; evidence: StoredEvidence }[];
  readonly summary: string | null;
  readonly keyPoints: readonly string[];
  readonly threadNote: string | null;
  readonly lifeEvidence: StoredEvidence | null;
  readonly counterpartyCommitment: StoredEvidence | null;
  readonly scheduleRequest: boolean;
  readonly reason: string;
  readonly droppedFields: readonly string[];
}

export interface BatchOutcome {
  readonly kind: 'ai' | 't0';
  readonly reason?: string;
  readonly results: ReadonlyMap<string, AiTriage>;
  readonly promptVersionId: string | null;
  readonly tally: GroundingTally;
}

function metaLine(ref: string, m: PreparedMessage, ctx: TriageContext): string {
  const from = m.row.from_email.toLowerCase();
  const toMe = (m.row.to_emails ?? []).some((t) =>
    ctx.ownAddresses.some((o) => o.toLowerCase() === t.toLowerCase()),
  );
  const vip = ctx.isPro && ctx.vip.emails.some((e) => e.toLowerCase() === from);
  return [
    `${ref}: alan adı ${emailDomain(from)}`,
    `rol ${toMe ? 'Sana' : 'Cc'}`,
    `vip ${vip ? 'evet' : 'hayır'}`,
    `tanıdık ${ctx.history.known.has(from) ? 'evet' : 'hayır'}`,
    `daha önce yanıtladın ${ctx.history.repliedBefore.has(from) ? 'evet' : 'hayır'}`,
    `tarih ${localDate(m.row.received_at, ctx.timeZone)}`,
  ].join(' · ');
}

/** Grounds one model item against its message text (§6.3); unverified claims are dropped. */
export function groundTriageItem(
  item: EmailTriageItem,
  m: PreparedMessage,
  source: string,
  ctx: TriageContext,
  tally: GroundingTally,
  trustedNames: readonly string[],
): AiTriage {
  const scope: GroundingScope = {
    aliases: aliasMap([[item.ref, source]]),
    anchor: m.row.received_at,
    timeZone: ctx.timeZone,
    senderType: ctx.history.known.has(m.row.from_email.toLowerCase()) ? 'known' : 'unknown',
  };
  const dropped = new Set<string>();
  const reply = groundQuote(item.reply_evidence, scope, tally, 'reply_evidence');
  if (item.needs_reply && reply === null) dropped.add('needs_reply');
  const deadlines = item.deadlines.flatMap((d) => {
    const ev = groundQuote(d.evidence, scope, tally, 'deadline_evidence');
    const date = ev === null ? null : groundDate({ ref: item.ref, quote: d.when_quote }, scope, tally, 'due_at', d.certainty);
    if (ev === null || date === null) {
      dropped.add('due_at');
      return [];
    }
    return [{ what: clip(d.what_tr, 80), dueAt: date.dueAt, evidence: storedEvidence('due_at', ev) }];
  });
  const sources = [source];
  const summary = guardSummary(item.summary_tr, sources, trustedNames, tally, 'ai_summary');
  if (item.summary_tr !== null && summary === null) dropped.add('ai_summary');
  const keyPoints = item.key_points_tr
    .map((k) => guardSummary(k, sources, trustedNames, tally, 'key_points'))
    .filter((k): k is string => k !== null)
    .map((k) => clip(k, 80));
  const note = guardSummary(item.thread_note_tr, sources, trustedNames, tally, 'rolling_summary');
  const life = groundQuote(item.life_evidence, scope, tally, 'life_evidence');
  const promise = groundQuote(item.counterparty_commitment, scope, tally, 'counterparty_commitment');
  const schedule =
    item.schedule_request !== null &&
    groundQuote(item.schedule_request.evidence, scope, tally, 'schedule_request') !== null;
  return {
    item,
    needsReply: item.needs_reply && reply !== null,
    replyEvidence: reply === null ? null : storedEvidence('needs_reply', reply),
    deadlines,
    summary: summary === null ? null : clip(summary, 800),
    keyPoints,
    threadNote: note === null ? null : clip(note, 1200),
    lifeEvidence: life === null ? null : storedEvidence('life_signal', life),
    counterpartyCommitment: promise === null ? null : storedEvidence('commitment', promise),
    scheduleRequest: schedule,
    reason: clip(item.reason_tr, 140),
    droppedFields: [...dropped],
  };
}

/** One T1 micro-batch (≤5 messages of one user). */
export async function classifyBatch(
  pipeline: PipelineContext,
  batch: readonly PreparedMessage[],
  ctx: TriageContext,
): Promise<BatchOutcome> {
  const tally = new GroundingTally();
  const docs: UntrustedDoc[] = [];
  const context: string[] = [...trustedHeader(pipeline.user, ctx.now)];
  const byRef = new Map<string, PreparedMessage>();
  batch.forEach((m, i) => {
    const ref = `m${i + 1}`;
    byRef.set(ref, m);
    docs.push({ ref, kind: 'email', text: m.forModel });
    context.push(metaLine(ref, m, ctx));
    const note = m.thread?.rolling_summary;
    if (note !== null && note !== undefined && note !== '') {
      docs.push({ ref: `t${i + 1}`, kind: 'summary', text: clip(note, 500) });
    }
  });
  const injection: InjectionScan = {
    suspected: batch.some((m) => m.injection.suspected),
    signals: [...new Set(batch.flatMap((m) => m.injection.signals))],
  };
  const result = await callModel(pipeline, {
    feature: 'email_triage',
    schema: EmailTriageV1,
    schemaName: 'EmailTriageV1',
    context,
    docs,
    vars: { count: batch.length },
    cacheContent: `email_classification\n${docs.map((d) => `${d.ref}\n${d.text}`).join('\n')}`,
    units: batch.length,
    injection,
  });
  if (result.kind !== 'ai') {
    return { kind: 't0', reason: result.reason, results: new Map(), promptVersionId: null, tally };
  }
  const refined = refineEmailTriageV1(result.data, {
    aliases: docs.filter((d) => d.ref.startsWith('m')).map((d) => d.ref),
    inputCount: batch.length,
  });
  if (!refined.ok) {
    return { kind: 't0', reason: 'refine_failed', results: new Map(), promptVersionId: null, tally };
  }
  const names = [pipeline.user.displayName ?? ''].filter((n) => n !== '');
  const results = new Map<string, AiTriage>();
  for (const item of refined.data.items) {
    const m = byRef.get(item.ref);
    if (m === undefined) continue;
    const trusted = [...names, m.row.from_name ?? ''].filter((n) => n !== '');
    results.set(m.row.id, groundTriageItem(item, m, m.forModel, ctx, tally, trusted));
  }
  return { kind: 'ai', results, promptVersionId: result.promptVersionId, tally };
}

// ── Final decision ───────────────────────────────────────────────────────────

export interface FinalClassification {
  readonly category: MailCategory;
  readonly priority: PriorityResult;
  readonly urgency: Urgency;
  readonly reason: string;
  readonly important: boolean;
  readonly needsReply: boolean;
  readonly hasDeadline: boolean;
}

const MODEL_CATEGORY: Readonly<Record<EmailTriageItem['category'], string>> = {
  important: 'important',
  awaiting_my_reply: 'awaiting_my_reply',
  has_deadline: 'has_deadline',
  informational: 'informational',
  low_priority: 'low_priority',
};

/**
 * Precedence (§4.3.1, §7.1): explicit rules and learned preferences decide first; otherwise the
 * grounded flags pick the category in order needs_reply → has_deadline → important → baseline.
 */
export function finalClassification(
  m: PreparedMessage,
  ai: AiTriage | null,
  ctx: TriageContext,
  ruleById: ReadonlyMap<string, PriorityRule>,
): FinalClassification {
  const locale = 'tr' as const;
  if (ai === null) {
    const hasDeadline = m.t0Deadline !== null;
    return {
      category: m.t0.category,
      priority: m.t0,
      urgency: m.t0.urgency,
      reason: whyText(m.t0, {
        locale,
        rule: m.t0.rule_id === null ? null : (ruleById.get(m.t0.rule_id) ?? null),
        vipName: m.row.from_name,
        dueTime: m.t0Deadline === null ? null : '',
      }),
      important: m.t0.importance === 'high',
      needsReply: m.t0.category === 'awaiting_my_reply',
      hasDeadline,
    };
  }
  const classification: AiClassification = {
    category: MODEL_CATEGORY[ai.item.category],
    confidence: bandConfidence(ai.item.confidence),
    urgency: ai.item.urgency,
    reasonCode: ai.item.reason_code,
  };
  const withAi = evaluatePriority(m.item, pctx(ctx), classification);
  const decisive = withAi.decision_tier === 'explicit_rule' || withAi.decision_tier === 'learned_preference';
  const hasDeadline = ai.deadlines.length > 0 || m.t0Deadline !== null;
  const important =
    withAi.importance === 'high' || (!decisive && ai.item.important && classification.confidence >= 0.5);
  let category: MailCategory = withAi.category;
  if (!decisive && withAi.importance !== 'muted') {
    if (ai.needsReply) category = 'awaiting_my_reply';
    else if (hasDeadline) category = 'has_deadline';
    else if (important) category = 'important';
  }
  const urgency: Urgency =
    withAi.importance === 'muted'
      ? 'low'
      : hasDeadline && (m.t0Deadline?.days ?? 99) <= 1 && withAi.urgency !== 'urgent'
        ? 'today'
        : withAi.urgency;
  return {
    category,
    priority: withAi,
    urgency,
    reason: whyText(withAi, {
      locale,
      rule: withAi.rule_id === null ? null : (ruleById.get(withAi.rule_id) ?? null),
      vipName: m.row.from_name,
      aiReason: ai.reason,
    }),
    important,
    needsReply: !decisive || withAi.importance !== 'low' ? ai.needsReply : false,
    hasDeadline,
  };
}

/** Topic label for person intelligence "recent topics" (cleaned subject, ≤60 chars). */
export function topicLabel(subject: string | null): string | null {
  if (subject === null) return null;
  const clean = subject
    .replace(/^\s*((re|fw|fwd|ynt|ilt|cevap|yanıt)\s*:\s*)+/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean === '' ? null : clip(clean, 60);
}

/** Key points as stored on `email_messages.key_points` / `email_threads.key_points`. */
export function keyPointRows(
  points: readonly string[],
  evidence: readonly StoredEvidence[],
): { text: string; evidence: StoredEvidence[] }[] {
  return points.slice(0, 3).map((text) => ({ text, evidence: [...evidence].slice(0, 1) }));
}

export function evidenceOf(ai: AiTriage | null, m: PreparedMessage): StoredEvidence[] {
  const list: StoredEvidence[] = [];
  if (ai?.replyEvidence) list.push(ai.replyEvidence);
  for (const d of ai?.deadlines ?? []) list.push(d.evidence);
  if (m.t0Deadline !== null) list.push(m.t0Deadline.evidence);
  return list.slice(0, 5);
}

/** Folded urgency keyword presence (realtime trigger, §8.3) for logs and routing. */
export function urgent(m: PreparedMessage): boolean {
  return /(?<!\p{L})(acil|ivedi|hemen)(?!\p{L})/u.test(foldTR(normalizeTR(m.row.subject ?? '')));
}

export { evidenceList, copy };
