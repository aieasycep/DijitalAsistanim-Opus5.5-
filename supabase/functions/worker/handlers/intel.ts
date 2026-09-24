/**
 * Shared wiring of the AI pipeline job handlers (IMPLEMENTATION_PLAN T-5.01…T-5.08, T-5.17): the
 * stores, the AI services, the transient mail-body source and the follow-up enqueue helpers with
 * the documented idempotency keys (API_CONTRACTS §11).
 */
import type { Json } from '../../_shared/jobs/types.ts';
import type { JobContext } from '../../_shared/jobs/types.ts';
import type { RawEnv } from '../../_shared/env.ts';
import type { AuditWriter } from '../../_shared/services/audit.ts';
import type { PipelineContext } from '../../_shared/services/ai/pipeline.ts';
import type { OurCost, ReconciliationRow } from '../../_shared/services/ai/reconcile.ts';
import type { AiServices, AiUser } from '../../_shared/services/ai/runtime.ts';
import type { NotificationBuild } from '../../_shared/services/insights/build.ts';
import type {
  InsightStore,
  MailBodySource,
  MailStore,
  MemoryItem,
  MemoryStore,
  StatsStore,
} from '../../_shared/services/intel/store.ts';
import type { BriefingJobStore } from '../../_shared/services/intel/supabase-store.ts';
import type { AndroidLifeStore } from '../../_shared/services/life/android.ts';

export interface ReconciliationPorts {
  readonly env: RawEnv;
  readonly fetch: typeof fetch;
  costByModel(utcDate: string): Promise<OurCost[]>;
  recordHealth(rows: readonly ReconciliationRow[]): Promise<void>;
  readonly audit: AuditWriter;
}

export interface IntelDeps {
  readonly ai: AiServices;
  readonly mail: MailStore;
  readonly insights: InsightStore;
  readonly briefings: BriefingJobStore;
  readonly stats: StatsStore;
  readonly memory: MemoryStore;
  /** Transient provider bodies (integration runtime); null → metadata-only triage. */
  readonly bodies: MailBodySource | null;
  readonly reconciliation: ReconciliationPorts;
  /** Android notification signals → life events in `insight_refresh` (API-ANI-01, JOB-12). */
  readonly android?: AndroidLifeStore;
}

export function pipelineFor(
  deps: IntelDeps,
  user: AiUser,
  ctx: JobContext<unknown>,
): PipelineContext {
  return {
    runtime: deps.ai.runtime,
    user,
    correlationId: ctx.correlationId,
    jobId: ctx.job.id,
    canary: deps.ai.canary,
    signal: ctx.signal,
  };
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** JOB-12, coalesced per user (`insight_refresh:{user}:pending`). */
export function enqueueInsightRefresh(
  ctx: JobContext<unknown>,
  userId: string,
  scope: 'mail' | 'calendar' | 'tasks' | 'life' | 'followups' | 'all',
  reason: string,
): Promise<string> {
  return ctx.enqueue({
    type: 'insight_refresh',
    idempotencyKey: `insight_refresh:${userId}:pending`,
    payload: { user_id: userId, scope, reason: reason.slice(0, 40) },
    userId,
  });
}

/** JOB-16 (Pro only): `embedding:{user}:{sha1(sorted kind:id)}`. */
export async function enqueueEmbedding(
  ctx: JobContext<unknown>,
  userId: string,
  items: readonly MemoryItem[],
): Promise<string | null> {
  const unique = [...new Map(items.map((i) => [`${i.kind}:${i.id}`, i])).values()].slice(0, 100);
  if (unique.length === 0) return null;
  const key = await sha1Hex(
    unique
      .map((i) => `${i.kind}:${i.id}`)
      .sort()
      .join(','),
  );
  return await ctx.enqueue({
    type: 'embedding',
    idempotencyKey: `embedding:${userId}:${key}`,
    payload: {
      user_id: userId,
      items: unique.map((i) => ({ kind: i.kind, id: i.id })),
    } as unknown as Json,
    userId,
  });
}

/** JOB-11: `email_analysis:{message_id}:{analysis_input_hash}`. */
export async function enqueueEmailAnalysis(
  ctx: JobContext<unknown>,
  input: {
    readonly userId: string;
    readonly accountId: string;
    readonly messageId: string;
    readonly contentHash: string;
    readonly reasons: readonly string[];
  },
): Promise<string> {
  const reasons = [...new Set(input.reasons)].sort();
  const hash = (await sha1Hex(`${input.contentHash}|${reasons.join(',')}`)).slice(0, 16);
  return await ctx.enqueue({
    type: 'email_analysis',
    idempotencyKey: `email_analysis:${input.messageId}:${hash}`,
    payload: {
      email_message_id: input.messageId,
      connected_account_id: input.accountId,
      reasons,
    },
    userId: input.userId,
    accountId: input.accountId,
  });
}

/** JOB-18 with B's `build` payload (the send decision happens there). */
export function enqueueNotification(
  ctx: JobContext<unknown>,
  userId: string,
  build: NotificationBuild,
): Promise<string> {
  return ctx.enqueue({
    type: 'notification',
    idempotencyKey: `notif:${userId}:${build.dedupe_key}`,
    payload: { user_id: userId, build: build as unknown as Json },
    userId,
  });
}

/** Transient body fetch; failures degrade to metadata-only processing. */
export async function fetchBody(
  deps: IntelDeps,
  ctx: JobContext<unknown>,
  input: { userId: string; accountId: string; provider: string; providerMessageId: string },
): Promise<{ text: string; html: string | null } | null> {
  if (deps.bodies === null) return null;
  try {
    const body = await deps.bodies.fetch({
      userId: input.userId,
      accountId: input.accountId,
      provider: input.provider as Parameters<MailBodySource['fetch']>[0]['provider'],
      providerMessageId: input.providerMessageId,
      maxBytes: 200_000,
      correlationId: ctx.correlationId,
      signal: ctx.signal,
    });
    return body === null ? null : { text: body.text, html: body.html };
  } catch {
    ctx.log.warn('mail_body_unavailable');
    return null;
  }
}
