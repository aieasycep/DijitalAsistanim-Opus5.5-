/**
 * JOB-10 `email_triage` (IMPLEMENTATION_PLAN T-5.01; API_CONTRACTS §11): T0 for every message,
 * T1 micro-batches (≤5) for the survivors, grounded persistence, thread state, life events,
 * contacts, and the follow-ups `email_analysis` (Pro escalations), `insight_refresh` and
 * `embedding` (Pro). A budget refusal or a kill switch leaves the deterministic result with
 * `ai_status='skipped_budget'` / `'skipped_flag'`; messages are never blocked.
 */
import type { LearnedPreference, PriorityRule } from '@da/domain';
import { emailDomain } from '@da/domain';
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobContext } from '../../_shared/jobs/types.ts';
import {
  type AiTriage,
  classifyBatch,
  finalClassification,
  keyPointRows,
  prepareMessage,
  type PreparedMessage,
  TRIAGE_BATCH_SIZE,
  type TriageContext,
  topicLabel,
} from '../../_shared/services/ai/triage.ts';
import { resolveContacts } from '../../_shared/services/contacts/resolve.ts';
import { refreshPersonStats } from '../../_shared/services/contacts/stats.ts';
import { computeThreadState } from '../../_shared/services/followups.ts';
import { lifeEventRow } from '../../_shared/services/life/classify.ts';
import type { MailMessageRow, ThreadPatch } from '../../_shared/services/intel/types.ts';
import {
  enqueueEmailAnalysis,
  enqueueEmbedding,
  enqueueInsightRefresh,
  fetchBody,
  type IntelDeps,
  pipelineFor,
} from './intel.ts';

export const EmailTriagePayload = z.object({
  connected_account_id: Uuid,
  email_message_ids: z.array(Uuid).min(1).max(50),
  origin: z.enum(['initial', 'incremental', 'resync']),
});
export type EmailTriagePayload = z.infer<typeof EmailTriagePayload>;

const TERMINAL = new Set(['classified', 't0_final', 'skipped_source_control']);
const BUDGET_REASONS = new Set(['ai_budget_exhausted']);
const FLAG_REASONS = new Set(['kill_switch', 'feature_disabled', 'not_configured', 'no_target']);

function statusForT0(reason: string | undefined): 'skipped_budget' | 'skipped_flag' | 't0_final' {
  if (reason !== undefined && BUDGET_REASONS.has(reason)) return 'skipped_budget';
  if (reason !== undefined && FLAG_REASONS.has(reason)) return 'skipped_flag';
  return 't0_final';
}

export interface TriageRunResult {
  readonly [key: string]: number;
  readonly messages: number;
  readonly t0: number;
  readonly t1: number;
  readonly skipped: number;
  readonly deduped: number;
  readonly life_events: number;
}

export async function runEmailTriage(
  deps: IntelDeps,
  ctx: JobContext<EmailTriagePayload>,
): Promise<TriageRunResult> {
  const p = ctx.payload;
  const empty = { messages: 0, t0: 0, t1: 0, skipped: 0, deduped: 0, life_events: 0 };
  const account = await deps.mail.account(p.connected_account_id);
  if (account === null) return empty;
  const userId = account.user_id;
  const now = ctx.now();
  const all = (await deps.mail.messages(p.email_message_ids)).filter(
    (m) => m.user_id === userId && m.connected_account_id === account.id,
  );
  if (account.data_source_toggles.mail_read === false) {
    for (const m of all) {
      if (!TERMINAL.has(m.ai_status))
        await deps.mail.updateMessage(m.id, { ai_status: 'skipped_source_control' });
    }
    return { ...empty, messages: all.length, skipped: all.length };
  }
  const pending = all.filter((m) => p.origin === 'resync' || !TERMINAL.has(m.ai_status));
  if (pending.length === 0) return { ...empty, messages: all.length };

  const user = await deps.ai.users.load(userId);
  const threads = new Map(
    (await deps.mail.threads([...new Set(pending.map((m) => m.thread_id))])).map(
      (t) => [t.id, t] as const,
    ),
  );
  const [rules, learned, vip, own] = await Promise.all([
    deps.mail.rules(userId),
    deps.mail.learned(userId) as Promise<LearnedPreference[]>,
    deps.mail.vip(userId),
    deps.mail.ownAddresses(userId),
  ]);
  const senders = [...new Set(pending.map((m) => m.from_email.toLowerCase()))];
  const history = await deps.mail.senderHistory(
    userId,
    senders,
    new Date(now.getTime() - 90 * 86_400_000),
  );
  const tctx: TriageContext = {
    rules,
    learned,
    vip,
    ownAddresses: own,
    history,
    isPro: user.isPro,
    learnFromInteractions: user.learnFromInteractions,
    timeZone: user.timeZone,
    now,
    mailBodyAllowed: user.dataAccess.mailBody,
  };
  const ruleById = new Map<string, PriorityRule>(rules.map((r) => [r.id, r]));

  // Content-hash dedupe: identical content in one run is classified once.
  const byHash = new Map<string, MailMessageRow>();
  const duplicates = new Map<string, string>();
  for (const m of pending) {
    const first = byHash.get(m.content_hash);
    if (first !== undefined && m.direction === first.direction) duplicates.set(m.id, first.id);
    else byHash.set(m.content_hash, m);
  }
  const unique = pending.filter((m) => !duplicates.has(m.id));

  const prepared: PreparedMessage[] = [];
  for (const m of unique) {
    const bulkHeaders = m.list_unsubscribe || m.precedence_bulk || m.auto_submitted;
    const body =
      user.dataAccess.mailBody && !bulkHeaders
        ? await fetchBody(deps, ctx, {
            userId,
            accountId: account.id,
            provider: m.provider,
            providerMessageId: m.provider_message_id,
          })
        : null;
    prepared.push(prepareMessage(m, threads.get(m.thread_id) ?? null, body, tctx));
  }

  const pipeline = pipelineFor(deps, user, ctx);
  const survivors = prepared.filter((m) => !m.t0Final && m.row.direction === 'inbound');
  const ai = new Map<string, AiTriage>();
  const skipped = new Map<string, string>();
  const promptVersion = new Map<string, string | null>();
  for (let i = 0; i < survivors.length; i += TRIAGE_BATCH_SIZE) {
    const batch = survivors.slice(i, i + TRIAGE_BATCH_SIZE);
    const outcome = await classifyBatch(pipeline, batch, tctx);
    if (outcome.kind === 'ai') {
      for (const [id, r] of outcome.results) {
        ai.set(id, r);
        promptVersion.set(id, outcome.promptVersionId);
      }
      for (const m of batch) if (!outcome.results.has(m.row.id)) skipped.set(m.row.id, 't0_final');
    } else {
      for (const m of batch) skipped.set(m.row.id, statusForT0(outcome.reason));
    }
  }

  // Persist messages; collect thread updates.
  const needsReply = new Map<string, boolean>();
  const expects = new Map<string, 'yes' | 'no' | 'ambiguous'>();
  const threadPatch = new Map<string, ThreadPatch>();
  const lifeRows = [];
  const analysis: { m: PreparedMessage; reasons: string[] }[] = [];
  const important: string[] = [];
  for (const m of prepared) {
    const result = ai.get(m.row.id) ?? null;
    const final = finalClassification(m, result, tctx, ruleById);
    const status = result !== null ? 'classified' : (skipped.get(m.row.id) ?? 't0_final');
    const evidence = [
      ...(result?.replyEvidence ? [result.replyEvidence] : []),
      ...(result?.deadlines.map((d) => d.evidence) ?? []),
      ...(m.t0Deadline === null ? [] : [m.t0Deadline.evidence]),
    ];
    await deps.mail.updateMessage(m.row.id, {
      ai_status: status,
      classification: final.category,
      classification_tier: final.priority.decision_tier,
      classification_reason: final.reason,
      classification_rule_id: final.priority.rule_id,
      classification_confidence: Math.round(final.priority.confidence * 1000) / 1000,
      ...(result?.summary ? { ai_summary: result.summary } : {}),
      key_points:
        final.important && result !== null ? keyPointRows(result.keyPoints, evidence) : [],
      analyzed_at: now.toISOString(),
      prompt_version_id: promptVersion.get(m.row.id) ?? null,
      injection_suspected: m.injection.suspected,
      dropped_fields: [...(result?.droppedFields ?? [])],
      life_signal:
        m.life.candidates[0]?.type === 'security'
          ? 'none'
          : (m.life.candidates[0]?.type ?? result?.item.life_signal ?? 'none'),
    });
    if (m.row.direction === 'inbound') needsReply.set(m.row.id, final.needsReply);
    if (m.expectsReply !== null) expects.set(m.row.id, m.expectsReply);
    if (final.important) important.push(m.row.thread_id);

    const thread = m.thread;
    if (
      thread !== null &&
      m.row.direction === 'inbound' &&
      Date.parse(m.row.received_at) >= Date.parse(thread.last_message_at) - 1000
    ) {
      const deadline =
        result?.deadlines[0] ??
        (m.t0Deadline === null
          ? null
          : { dueAt: m.t0Deadline.dueAt, evidence: m.t0Deadline.evidence });
      threadPatch.set(thread.id, {
        ...threadPatch.get(thread.id),
        category: final.category,
        category_tier: final.priority.decision_tier,
        category_reason: final.reason,
        category_rule_id: final.priority.rule_id,
        category_learned_preference_id: final.priority.learned_preference_id,
        category_confidence: Math.round(final.priority.confidence * 1000) / 1000,
        urgency: final.urgency,
        ...(thread.topic_label === null
          ? { topic_label: topicLabel(m.row.subject ?? thread.subject) }
          : {}),
        ...(result?.threadNote ? { rolling_summary: result.threadNote } : {}),
        ...(deadline === null
          ? {}
          : { deadline_at: deadline.dueAt.toISOString(), deadline_evidence: [deadline.evidence] }),
      });
    }
    for (const c of m.life.candidates) {
      lifeRows.push(
        lifeEventRow(c, {
          userId,
          messageId: m.row.id,
          provider: m.row.provider,
          receivedAt: m.row.received_at,
          text: `${m.row.subject ?? ''}\n${m.visible ?? m.row.snippet ?? ''}`,
          locale: user.locale,
        }),
      );
    }
    if (user.isPro) {
      const reasons: string[] = [];
      if (result?.item.needs_deep_extract) reasons.push('summary', 'key_points', 'deadline');
      if (m.commitmentSignal || result?.counterpartyCommitment) reasons.push('commitment');
      if (m.row.direction === 'outbound' && m.expectsReply !== null) reasons.push('follow_up');
      if (result?.lifeEvidence && m.life.candidates.length === 0) reasons.push('life_event');
      if (reasons.length > 0 && !m.injection.suspected) analysis.push({ m, reasons });
    }
  }
  // Duplicates copy the classification of their first occurrence.
  for (const [dup, first] of duplicates) {
    const src = prepared.find((x) => x.row.id === first);
    if (src === undefined) continue;
    const r = ai.get(first) ?? null;
    const final = finalClassification(src, r, tctx, ruleById);
    await deps.mail.updateMessage(dup, {
      ai_status: r !== null ? 'classified' : (skipped.get(first) ?? 't0_final'),
      classification: final.category,
      classification_tier: final.priority.decision_tier,
      classification_reason: final.reason,
      classification_rule_id: final.priority.rule_id,
      classification_confidence: Math.round(final.priority.confidence * 1000) / 1000,
      analyzed_at: now.toISOString(),
    });
  }

  // Thread reply / follow-up state (T0 from message metadata, M§17).
  for (const threadId of new Set(prepared.map((m) => m.row.thread_id))) {
    const thread = threads.get(threadId);
    if (thread === undefined) continue;
    const messages = await deps.mail.threadMessages(threadId, 20);
    const state = computeThreadState({
      thread,
      messages,
      expectsReply: expects,
      needsReply,
      now,
      timeZone: user.timeZone,
      followUpAfterDays: user.followUpAfterDays,
      vip: vip.emails.some((e) => thread.participants.some((p) => p.email.toLowerCase() === e)),
      muted: thread.is_muted,
    });
    await deps.mail.updateThread(threadId, { ...threadPatch.get(threadId), ...state });
  }

  const life = await deps.mail.upsertLifeEvents(lifeRows);
  const contacts = await resolveContacts(deps.mail, {
    userId,
    ownAddresses: own,
    messages: pending,
  });
  await refreshPersonStats(deps.mail, userId, contacts);

  for (const a of analysis) {
    await enqueueEmailAnalysis(ctx, {
      userId,
      accountId: account.id,
      messageId: a.m.row.id,
      contentHash: a.m.row.content_hash,
      reasons: a.reasons,
    });
  }
  await enqueueInsightRefresh(ctx, userId, 'mail', 'email_triage');
  if (user.isPro && important.length > 0) {
    await enqueueEmbedding(
      ctx,
      userId,
      [...new Set(important)].map((id) => ({ kind: 'email_summary' as const, id })),
    );
  }
  const t1 = ai.size;
  ctx.log.info('email_triage_done', {
    messages: all.length,
    t0: prepared.length - t1,
    t1,
    sender_domains: new Set(pending.map((m) => emailDomain(m.from_email))).size,
  });
  return {
    messages: all.length,
    t0: prepared.length - t1,
    t1,
    skipped: [...skipped.values()].filter((s) => s !== 't0_final').length,
    deduped: duplicates.size,
    life_events: life.length,
  };
}

export function emailTriageJob(deps: IntelDeps) {
  return defineJob({
    type: 'email_triage',
    payload: EmailTriagePayload,
    handler: async (ctx) => ({ ...(await runEmailTriage(deps, ctx)) }),
  });
}
