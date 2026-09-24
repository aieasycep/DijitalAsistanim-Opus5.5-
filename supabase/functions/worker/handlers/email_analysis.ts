/**
 * JOB-11 `email_analysis` (IMPLEMENTATION_PLAN T-5.02…T-5.04; API_CONTRACTS §11): content-hash
 * dedupe, a transient body fetch (never stored), redaction, `EmailDeepExtractV1` with grounding,
 * the commitments pipeline (Pro; hedged → `commitment_create` proposal), sent-mail follow-up state,
 * life intelligence (JSON-LD / templates first, `LifeIntelV1` fallback; security needs DKIM/SPF),
 * contacts, then `embedding` (Pro) and `insight_refresh`.
 */
import { detectExpectsReply, sha256Hex } from '@da/domain';
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobContext } from '../../_shared/jobs/types.ts';
import {
  approvalRow,
  commitmentRow,
  extractCommitments,
} from '../../_shared/services/ai/commitments.ts';
import { deepExtract } from '../../_shared/services/ai/deep-extract.ts';
import { visibleText } from '../../_shared/services/ai/hygiene.ts';
import { trustedHeader } from '../../_shared/services/ai/pipeline.ts';
import { clip } from '../../_shared/services/copy.ts';
import { personCandidates, resolveContacts } from '../../_shared/services/contacts/resolve.ts';
import { refreshPersonStats } from '../../_shared/services/contacts/stats.ts';
import { computeThreadState } from '../../_shared/services/followups.ts';
import { detectLife, lifeEventRow, lifeFromModel } from '../../_shared/services/life/classify.ts';
import type { MemoryItem } from '../../_shared/services/intel/store.ts';
import {
  enqueueEmbedding,
  enqueueInsightRefresh,
  fetchBody,
  type IntelDeps,
  pipelineFor,
} from './intel.ts';

export const EmailAnalysisPayload = z.object({
  email_message_id: Uuid,
  connected_account_id: Uuid,
  reasons: z
    .array(
      z.enum([
        'summary',
        'key_points',
        'deadline',
        'follow_up',
        'commitment',
        'life_event',
        'security',
      ]),
    )
    .min(1),
});
export type EmailAnalysisPayload = z.infer<typeof EmailAnalysisPayload>;

export async function runEmailAnalysis(
  deps: IntelDeps,
  ctx: JobContext<EmailAnalysisPayload>,
): Promise<Record<string, string | number | boolean>> {
  const p = ctx.payload;
  const account = await deps.mail.account(p.connected_account_id);
  if (account === null) return { skipped: 'account_missing' };
  const [message] = await deps.mail.messages([p.email_message_id]);
  if (message === undefined || message.user_id !== account.user_id)
    return { skipped: 'message_missing' };
  if (account.data_source_toggles.mail_read === false) return { skipped: 'source_control' };
  const userId = account.user_id;
  const user = await deps.ai.users.load(userId);
  if (!user.dataAccess.mailBody) return { skipped: 'mail_body_off' };
  const now = ctx.now();
  const [thread] = await deps.mail.threads([message.thread_id]);
  const reasons = new Set(p.reasons);

  const body = await fetchBody(deps, ctx, {
    userId,
    accountId: account.id,
    provider: message.provider,
    providerMessageId: message.provider_message_id,
  });
  const visible =
    body === null
      ? [message.subject ?? '', message.snippet ?? ''].filter((s) => s !== '').join('\n')
      : visibleText({ text: body.text, html: body.html }, 6_000);
  const analysisHash = `\\x${sha256Hex(`${message.content_hash}|${[...reasons].sort().join(',')}|${visible.length}`)}`;
  if (
    thread !== undefined &&
    thread.analysis_hash === analysisHash &&
    message.analyzed_at !== null
  ) {
    return { skipped: 'unchanged' };
  }
  const pipeline = pipelineFor(deps, user, ctx);
  const known = (
    await deps.mail.senderHistory(
      userId,
      [message.from_email.toLowerCase()],
      new Date(now.getTime() - 90 * 86_400_000),
    )
  ).known;
  const result: Record<string, string | number | boolean> = {};

  if (reasons.has('summary') || reasons.has('key_points') || reasons.has('deadline')) {
    const deep = await deepExtract(pipeline, {
      message,
      thread: thread ?? null,
      body: visible,
      now,
      senderKnown: known.has(message.from_email.toLowerCase()),
    });
    result.deep = deep.kind;
    if (deep.kind === 'ai') {
      await deps.mail.updateMessage(message.id, {
        ...(deep.summary === null ? {} : { ai_summary: deep.summary }),
        key_points: deep.keyPoints.map((k) => ({ text: k.text, evidence: [k.evidence] })),
        dropped_fields: [...deep.droppedFields],
        injection_suspected: deep.injectionSuspected,
        analyzed_at: now.toISOString(),
        prompt_version_id: deep.promptVersionId,
      });
      const nextDeadline = deep.deadlines
        .filter((d) => d.dueAt.getTime() > now.getTime())
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
      if (thread !== undefined) {
        await deps.mail.updateThread(thread.id, {
          ...(deep.summary === null ? {} : { ai_summary: clip(deep.summary, 800) }),
          key_points: deep.keyPoints
            .slice(0, 5)
            .map((k) => ({ text: k.text, evidence: [k.evidence] })),
          ...(nextDeadline === undefined
            ? {}
            : {
                deadline_at: nextDeadline.dueAt.toISOString(),
                deadline_evidence: [nextDeadline.evidence],
              }),
          analysis_hash: analysisHash,
          analyzed_at: now.toISOString(),
          prompt_version_id: deep.promptVersionId,
        });
      }
    }
  }

  const own = await deps.mail.ownAddresses(userId);
  const byEmail = await resolveContacts(deps.mail, {
    userId,
    ownAddresses: own,
    messages: [message],
  });
  const memory: MemoryItem[] =
    thread === undefined ? [] : [{ kind: 'email_summary', id: thread.id }];

  if (user.isPro && (reasons.has('commitment') || reasons.has('follow_up'))) {
    const contacts = await deps.mail.contactsByEmail(userId, Object.keys(byEmail));
    const run = await extractCommitments(
      pipeline,
      [{ message, text: visible, people: personCandidates(thread?.participants ?? [], contacts) }],
      now,
    );
    const creates = run.decisions
      .filter((d) => d.outcome === 'create')
      .map((d) => commitmentRow(userId, d));
    const proposals = run.decisions
      .filter((d) => d.outcome === 'propose')
      .flatMap((d) => {
        const row = approvalRow(userId, d, user.locale, user.timeZone);
        return row === null ? [] : [row];
      });
    const saved = await deps.mail.upsertCommitments(creates);
    const proposed = await deps.mail.insertApprovals(proposals.slice(0, 1));
    for (const c of saved) memory.push({ kind: 'commitment', id: c.id });
    result.commitments = saved.length;
    result.proposals = proposed;
    result.commitment_mode = run.kind;
  }

  if (reasons.has('follow_up') && message.direction === 'outbound' && thread !== undefined) {
    const expects = detectExpectsReply(visible);
    const messages = await deps.mail.threadMessages(thread.id, 20);
    const vip = await deps.mail.vip(userId);
    const state = computeThreadState({
      thread,
      messages,
      expectsReply: new Map([[message.id, expects]]),
      now,
      timeZone: user.timeZone,
      followUpAfterDays: user.followUpAfterDays,
      vip: vip.emails.some((e) => thread.participants.some((x) => x.email.toLowerCase() === e)),
      muted: thread.is_muted,
    });
    await deps.mail.updateThread(thread.id, state);
    result.follow_up_state = state.follow_up_state ?? 'none';
  }

  if (reasons.has('life_event') || reasons.has('security')) {
    const detection = detectLife({
      fromEmail: message.from_email,
      subject: message.subject ?? '',
      text: visible,
      html: body?.html ?? null,
      anchor: new Date(message.received_at),
      timeZone: user.timeZone,
      dkimPass: message.dkim_pass,
      spfPass: message.spf_pass,
    });
    let candidates = detection.candidates;
    if (candidates.length === 0 && detection.security !== 'rejected' && reasons.has('life_event')) {
      const fallback = await lifeFromModel(pipeline, {
        text: `${message.subject ?? ''}\n${visible}`,
        context: trustedHeader(user, now),
        anchor: new Date(message.received_at),
        senderDomain: message.from_email.split('@')[1]?.toLowerCase() ?? '',
        injectionSuspected: false,
      });
      candidates = fallback.injectionSuspected ? [] : fallback.candidates;
    }
    const rows = candidates.map((c) =>
      lifeEventRow(c, {
        userId,
        messageId: message.id,
        provider: message.provider,
        receivedAt: message.received_at,
        text: `${message.subject ?? ''}\n${visible}\n${body?.html ?? ''}`,
        locale: user.locale,
      }),
    );
    const saved = await deps.mail.upsertLifeEvents(rows);
    for (const l of saved) memory.push({ kind: 'life_event', id: l.id });
    result.life_events = saved.length;
    result.security = detection.security;
  }

  await refreshPersonStats(deps.mail, userId, byEmail);
  if (user.isPro) await enqueueEmbedding(ctx, userId, memory);
  await enqueueInsightRefresh(ctx, userId, 'mail', 'email_analysis');
  return result;
}

export function emailAnalysisJob(deps: IntelDeps) {
  return defineJob({
    type: 'email_analysis',
    payload: EmailAnalysisPayload,
    handler: async (ctx) => ({ ...(await runEmailAnalysis(deps, ctx)) }),
  });
}
