/**
 * JOB-13 `first_analysis` (IMPLEMENTATION_PLAN T-5.15; API_CONTRACTS §11; AI_PIPELINE_PLAN §1.7;
 * M§34). One job per user (`first_analysis:{user_id}`) orchestrates the onboarding analysis of the
 * last 72 h of mail and the next 48 h of calendar:
 *
 * 1. ensure an `initial_sync(first_pass)` exists per connected account (A's sync engine);
 * 2. poll the child jobs (initial sync, triage) — each check is one short run, re-queued after 3 s
 *    (a retry with `retry_after=3`; the job is enqueued with enough attempts for 200 checks);
 * 3. write real step states and counts to `jobs.progress` (API-ONB-02 polls them, R-19);
 * 4. once mail and calendar are processed: `insight_refresh` and the first morning briefing
 *    (`origin='first_analysis'` → `briefings.origin='onboarding'`);
 * 5. complete with the top items. `partial` when an account failed, no AI provider is configured
 *    (deterministic-only analysis) or the 10-minute deadline passed.
 * Every count comes from stored rows (`first_analysis_counts`).
 */
import { localDate } from '@da/domain';
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { type Json, type JobContext, JobError } from '../../_shared/jobs/types.ts';
import type { AccountSource, JobView } from '../../_shared/services/assist/store.ts';
import { sha1Hex } from '../../_shared/services/integrations/enqueue.ts';
import {
  FIRST_ANALYSIS_TICK_S,
  INITIAL_STEPS,
  type Progress,
  type StepKey,
  type StepStatus,
  ZERO_COUNTS,
} from '../../_shared/services/assist/first-analysis.ts';
import type { AssistJobDeps } from './assist.ts';

export const FirstAnalysisPayload = z.object({
  user_id: Uuid,
  window_hours: z.int().min(24).max(72).default(72),
  connected_account_ids: z.array(Uuid).default([]),
});
export type FirstAnalysisPayload = z.infer<typeof FirstAnalysisPayload>;

const DEADLINE_MS = 10 * 60_000;
const REAL_FAILURES = 3;
const PENDING = new Set(['queued', 'running', 'retrying']);
const FAILED_ACCOUNT = new Set(['needs_reauth', 'error', 'revoked']);
const SERVER_PROVIDERS = new Set(['google', 'microsoft', 'demo']);

function readProgress(raw: unknown, now: Date): Progress {
  const p = (raw ?? {}) as Partial<Progress>;
  return {
    started_at: p.started_at ?? now.toISOString(),
    checks: p.checks ?? 0,
    failures: p.failures ?? 0,
    partial: p.partial ?? false,
    phase: p.phase ?? 'sync',
    steps: p.steps ?? [...INITIAL_STEPS],
    counts: p.counts ?? { ...ZERO_COUNTS },
    ...(p.briefing_job_key === undefined ? {} : { briefing_job_key: p.briefing_job_key }),
  };
}

function setStep(p: Progress, key: StepKey, status: StepStatus, count: number | null): void {
  p.steps = p.steps.map((s) => (s.key === key ? { key, status, count } : s));
}

async function ensureInitialSync(
  deps: AssistJobDeps,
  ctx: JobContext<FirstAnalysisPayload>,
  account: AccountSource,
  windowHours: number,
): Promise<void> {
  if (!SERVER_PROVIDERS.has(account.provider)) return;
  const existing = await deps.store.jobsByKeyPrefix(`initial_sync:${account.id}:`);
  const resources = [
    ...(account.capabilities_granted.includes('mail_read') ? (['mail'] as const) : []),
    ...(account.capabilities_granted.includes('calendar_read') ? (['calendar'] as const) : []),
  ];
  for (const resource of resources) {
    if (
      existing.some((j) =>
        j.idempotency_key.startsWith(`initial_sync:${account.id}:${resource}:first_pass:`),
      )
    )
      continue;
    const discriminator = await sha1Hex('start|first_analysis');
    await ctx.enqueue({
      type: 'initial_sync',
      idempotencyKey: `initial_sync:${account.id}:${resource}:first_pass:-:${discriminator}`,
      payload: {
        connected_account_id: account.id,
        resource,
        phase: 'first_pass',
        window_start: new Date(ctx.now().getTime() - windowHours * 3_600_000).toISOString(),
        page_token: null,
        origin: 'first_analysis',
      } as unknown as Json,
      userId: ctx.payload.user_id,
      accountId: account.id,
      priority: 10,
      maxAttempts: 8,
    });
  }
}

function pending(jobs: readonly JobView[], resource?: string): boolean {
  return jobs.some(
    (j) =>
      PENDING.has(j.status) &&
      (resource === undefined || j.idempotency_key.split(':')[2] === resource),
  );
}

export async function runFirstAnalysis(
  deps: AssistJobDeps,
  ctx: JobContext<FirstAnalysisPayload>,
): Promise<Record<string, Json>> {
  const userId = ctx.payload.user_id;
  const now = ctx.now();
  const current = await deps.store.job(ctx.job.id);
  const p = readProgress(current?.progress, now);
  p.checks += 1;
  const since = new Date(Date.parse(p.started_at) - ctx.payload.window_hours * 3_600_000);
  try {
    const user = await deps.intel.ai.users.load(userId);
    const accounts = (await deps.store.accountSources(userId)).filter(
      (a) =>
        ctx.payload.connected_account_ids.length === 0 ||
        ctx.payload.connected_account_ids.includes(a.id),
    );
    if (accounts.some((a) => FAILED_ACCOUNT.has(a.status))) p.partial = true;
    if (
      !deps.intel.ai.providers.available('anthropic') &&
      !deps.intel.ai.providers.available('openai')
    ) {
      p.partial = true;
    }
    const children: JobView[] = [];
    for (const account of accounts) {
      if (p.checks === 1) await ensureInitialSync(deps, ctx, account, ctx.payload.window_hours);
      children.push(
        ...(await deps.store.jobsByKeyPrefix(`initial_sync:${account.id}:`)),
        ...(await deps.store.jobsByKeyPrefix(`email_triage:${account.id}:`)),
      );
    }
    const syncs = children.filter((j) => j.type === 'initial_sync');
    const triage = children.filter((j) => j.type === 'email_triage');
    if (syncs.some((j) => j.status === 'failed' || j.status === 'dead_letter')) p.partial = true;
    const counts = await deps.store.firstAnalysisCounts(userId, since, now);
    p.counts = {
      mails_found: counts.mails_found,
      potential_important: counts.potential_important,
      upcoming_events: counts.upcoming_events,
      possible_followups: counts.possible_followups,
    };
    const hasMail = accounts.some((a) => a.capabilities_granted.includes('mail_read'));
    const hasCalendar = accounts.some(
      (a) => a.capabilities_granted.includes('calendar_read') || !SERVER_PROVIDERS.has(a.provider),
    );
    const mailSyncing = pending(syncs, 'mail');
    const classifying = mailSyncing || pending(triage);
    const calendarSyncing = pending(syncs, 'calendar');
    setStep(
      p,
      'scan_mail',
      hasMail ? (mailSyncing ? 'running' : 'done') : 'skipped',
      hasMail ? counts.mails_found : null,
    );
    setStep(
      p,
      'classify',
      hasMail ? (classifying ? 'running' : 'done') : 'skipped',
      hasMail ? counts.potential_important : null,
    );
    setStep(
      p,
      'calendar',
      hasCalendar ? (calendarSyncing ? 'running' : 'done') : 'skipped',
      hasCalendar ? counts.upcoming_events : null,
    );

    const overdue =
      now.getTime() - Date.parse(p.started_at) > DEADLINE_MS ||
      ctx.job.attempts >= ctx.job.max_attempts;
    if (p.phase === 'sync' && (!(classifying || calendarSyncing) || overdue)) {
      p.phase = 'ranking';
      if (overdue) p.partial = true;
      setStep(p, 'open_loops', 'running', counts.possible_followups);
      await ctx.enqueue({
        type: 'insight_refresh',
        idempotencyKey: `insight_refresh:${userId}:first_analysis`,
        payload: { user_id: userId, scope: 'all', reason: 'first_analysis' },
        userId,
        priority: 10,
      });
      const today = localDate(now, user.timeZone);
      p.briefing_job_key = `briefing:${userId}:morning:${today}`;
      await ctx.enqueue({
        type: 'briefing',
        idempotencyKey: p.briefing_job_key,
        payload: { user_id: userId, kind: 'morning', local_date: today, origin: 'first_analysis' },
        userId,
        priority: 10,
      });
    }
    if (p.phase === 'ranking') {
      const refresh = await deps.store.jobByKey(`insight_refresh:${userId}:first_analysis`);
      const briefing =
        p.briefing_job_key === undefined ? null : await deps.store.jobByKey(p.briefing_job_key);
      const waiting =
        (refresh !== null && PENDING.has(refresh.status)) ||
        (briefing !== null && PENDING.has(briefing.status));
      if (!waiting || overdue) {
        p.phase = 'done';
        if (overdue && waiting) p.partial = true;
        setStep(p, 'open_loops', 'done', counts.possible_followups);
        await ctx.progress(p as unknown as Record<string, Json>);
        const top = await deps.store.topInsights(userId, 5);
        const morning = await deps.intel.briefings.forDate(
          userId,
          'morning',
          localDate(now, user.timeZone),
        );
        await deps.store.setOnboardingStep(userId, 'ready');
        return {
          partial: p.partial,
          top_items: top.items.map((i) => ({
            insight_id: i.id,
            kind: i.kind,
            title: i.title.slice(0, 200),
            at: i.due_at ?? i.event_at,
          })),
          total_items: top.total,
          briefing_id: morning?.id ?? null,
          counts: p.counts,
        } as unknown as Record<string, Json>;
      }
    }
    await ctx.progress(p as unknown as Record<string, Json>);
  } catch (error) {
    if (error instanceof JobError) throw error;
    p.failures += 1;
    await ctx.progress(p as unknown as Record<string, Json>);
    if (p.failures >= REAL_FAILURES) {
      throw new JobError(
        'FIRST_ANALYSIS_FAILED',
        false,
        null,
        error instanceof Error ? error.name : undefined,
      );
    }
  }
  // Not finished: check again in 3 s (a retry that does not count as a failure).
  throw new JobError('FIRST_ANALYSIS_PENDING', true, FIRST_ANALYSIS_TICK_S);
}

export function firstAnalysisJob(deps: AssistJobDeps) {
  return defineJob({
    type: 'first_analysis',
    payload: FirstAnalysisPayload,
    handler: async (ctx) => await runFirstAnalysis(deps, ctx),
    timeoutMs: 20_000,
  });
}
