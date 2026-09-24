/**
 * API-MAIL-07 `POST /mail/threads/:threadId/summary` [IK] (IMPLEMENTATION_PLAN T-5.02; M§15).
 *
 * The thread must be the caller's; the `mail_read` toggle and `ai_data_access.mail_body` must be on
 * (`DATA_SOURCE_DISABLED` otherwise). Only incremental context is sent (prior rolling summary + new
 * messages, bodies fetched transiently). The per-user result cache keys on (thread, last message,
 * prompt version): opening the same thread twice costs one model call; `refresh` regenerates.
 * Free users spend 1 AI unit per generated summary (cache hits are free); an exhausted budget is
 * `QUOTA_EXCEEDED`. Pro users also get a `thread_summary` memory chunk.
 */
import { routes as appRoutes } from '@da/domain';
import { routes, ThreadIdParams, ThreadSummaryBody } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import {
  summarizeThread,
  newMessages,
  type ThreadSummaryOutcome,
} from '../../_shared/services/ai/thread-summary.ts';
import { visibleText } from '../../_shared/services/ai/hygiene.ts';
import { chunkRow, threadChunkText } from '../../_shared/services/memory/chunk.ts';
import { isOn } from '../../_shared/services/flags.ts';
import { localDate } from '@da/domain';
import type { RouteKit, RouteRegistrar } from '../deps.ts';
import type { IntelApi } from './intel-api.ts';

export interface ThreadSummaryView {
  readonly thread_id: string;
  readonly summary: string;
  readonly key_points: {
    text: string;
    source: {
      source_type: 'email_message';
      source_id: string;
      source_provider: string;
      source_timestamp: string;
      open_route: string;
    };
  }[];
  readonly open_questions: { text: string; owner: 'user' | 'other' | 'unclear' }[];
  readonly generated_at: string;
  readonly cached: boolean;
}

function intel(kit: RouteKit): IntelApi {
  const deps = kit.deps.intel;
  if (deps === undefined)
    throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'intel_not_configured' } });
  return deps;
}

export async function threadSummary(
  kit: RouteKit,
  input: { userId: string; threadId: string; refresh: boolean; correlationId: string },
): Promise<ThreadSummaryView> {
  const api = intel(kit);
  const [thread] = await api.mail.threads([input.threadId]);
  if (thread === undefined || thread.user_id !== input.userId) throw new AppError('NOT_FOUND');
  const user = await api.ai.users.load(input.userId);
  if (!isOn(user.flags, 'ai.feature.thread_summary')) {
    throw new AppError('FEATURE_DISABLED', { details: { feature: 'thread_summary' } });
  }
  const account = await api.mail.account(thread.connected_account_id);
  if (
    account === null ||
    account.data_source_toggles.mail_read === false ||
    !user.dataAccess.mailBody
  ) {
    throw new AppError('DATA_SOURCE_DISABLED', { details: { toggle: 'mail_read' } });
  }
  const messages = await api.mail.threadMessages(thread.id, 20);
  const fresh = newMessages(thread, messages);
  const bodies = new Map<string, string>();
  if (api.bodies !== null) {
    for (const m of fresh) {
      try {
        const body = await api.bodies.fetch({
          userId: input.userId,
          accountId: account.id,
          provider: m.provider,
          providerMessageId: m.provider_message_id,
          maxBytes: 200_000,
          correlationId: input.correlationId,
        });
        if (body !== null)
          bodies.set(m.id, visibleText({ text: body.text, html: body.html }, 1_500));
      } catch {
        // Transient fetch failure: the stored snippet stands in for this message.
      }
    }
  }
  const now = kit.now();
  const outcome: ThreadSummaryOutcome = await summarizeThread(
    { runtime: api.ai.runtime, user, correlationId: input.correlationId, canary: api.ai.canary },
    { thread, messages, bodies, refresh: input.refresh, now },
  );
  if (outcome.kind === 't0') {
    if (outcome.reason === 'ai_budget_exhausted') {
      throw new AppError('QUOTA_EXCEEDED', {
        details: { limit_key: 'ai_daily_budget_units', upgrade_available: !user.isPro },
      });
    }
    if (outcome.summary === '') throw new AppError('AI_UNAVAILABLE');
  } else if (!outcome.cached) {
    await api.mail.updateThread(thread.id, {
      rolling_summary: outcome.summary.slice(0, 1200),
      ...(outcome.lastMessageId === null
        ? {}
        : { last_processed_message_id: outcome.lastMessageId }),
      key_points: outcome.keyPoints.map((k) => ({
        text: k.text,
        evidence: [k.evidence],
        message_id: k.message.id,
      })),
      analyzed_at: now.toISOString(),
      prompt_version_id: outcome.promptVersionId,
    });
    if (user.isPro) {
      const row = chunkRow({
        userId: input.userId,
        chunkKind: 'thread_summary',
        sourceType: 'email_thread',
        sourceId: thread.id,
        sourceProvider: thread.provider,
        sourceTimestamp: thread.last_message_at,
        occurredAt: thread.last_message_at,
        confidence: 0.85,
        evidence: outcome.keyPoints.map((k) => k.evidence).slice(0, 5),
        contactIds: thread.participants.flatMap((p) => (p.contact_id ? [p.contact_id] : [])),
        content: threadChunkText({
          subject: thread.subject,
          people: thread.participants.map((p) => p.name ?? p.email).slice(0, 6),
          date: localDate(thread.last_message_at, user.timeZone),
          summary: outcome.summary,
          keyPoints: outcome.keyPoints.map((k) => k.text),
          topic: thread.topic_label,
        }),
        expiresAt: thread.expires_at,
      });
      if (row !== null) await api.memory.upsertChunks([row]);
    }
  }
  return {
    thread_id: thread.id,
    summary: outcome.summary.slice(0, 600),
    key_points: outcome.keyPoints.map((k) => ({
      text: k.text.slice(0, 200),
      source: {
        source_type: 'email_message' as const,
        source_id: k.message.id,
        source_provider: k.message.provider,
        source_timestamp: new Date(k.message.received_at).toISOString(),
        open_route: appRoutes.mailDetail(k.message.id),
      },
    })),
    open_questions: outcome.openQuestions.map((q) => ({
      text: q.text.slice(0, 200),
      owner: q.owner,
    })),
    generated_at: now.toISOString(),
    cached: outcome.cached,
  };
}

export const registerThreadSummaryRoutes: RouteRegistrar = (app, kit) => {
  const route = routes['POST /mail/threads/:threadId/summary'];
  mountRoute(
    app,
    route,
    ...kit.chain({ gate: true, rateLimit: 'thread_summary' }),
    parseJsonBody(route),
    validateRequest(route),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, ThreadIdParams);
      const body = validBody(c, ThreadSummaryBody);
      const correlationId = c.get('correlationId');
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: route.status,
          async execute() {
            const data = await threadSummary(kit, {
              userId: auth.userId,
              threadId: params.threadId,
              refresh: body.refresh,
              correlationId,
            });
            return { data, ref: { type: 'email_thread', id: params.threadId } };
          },
          replay: () =>
            threadSummary(kit, {
              userId: auth.userId,
              threadId: params.threadId,
              refresh: false,
              correlationId,
            }),
        },
      );
    },
  );
};
