/**
 * First Analysis routes (IMPLEMENTATION_PLAN T-5.15; API_CONTRACTS API-ONB-01 `POST
 * /onboarding/first-analysis`, API-ONB-02 `GET /onboarding/first-analysis/:jobId`; M§34, R-19).
 * One job per user (`first_analysis:{user_id}`): re-entering the screen returns the same job, a
 * user without any connected source gets `STATE_CONFLICT {reason:'no_sources'}` ("Şimdilik geç").
 * The app polls the progress every 1.5 s; every count is read from stored rows.
 */
import { FirstAnalysisBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import type { JobView } from '../../_shared/services/assist/store.ts';
import { formatDay, formatTime } from '../../_shared/services/copy.ts';
import {
  FIRST_ANALYSIS_MAX_CHECKS,
  FIRST_ANALYSIS_POLL_MS,
  INITIAL_STEPS,
  type Progress,
  ZERO_COUNTS,
} from '../../_shared/services/assist/first-analysis.ts';
import type { RouteKit, RouteRegistrar } from '../deps.ts';
import { assistOf } from './assist-api.ts';

const PENDING = new Set(['queued', 'running', 'retrying']);

function jobRef(job: Pick<JobView, 'id' | 'status'>) {
  return {
    job_id: job.id,
    status: job.status as
      'queued' | 'running' | 'completed' | 'retrying' | 'failed' | 'dead_letter',
    poll_after_ms: PENDING.has(job.status) ? FIRST_ANALYSIS_POLL_MS : 0,
  };
}

async function progressView(kit: RouteKit, userId: string, job: JobView) {
  const { assist, intel } = assistOf(kit);
  const p = job.progress as Partial<Progress>;
  const result = (job.result ?? {}) as {
    partial?: boolean;
    top_items?: { insight_id: string; kind: string; title: string; at: string | null }[];
    total_items?: number;
    briefing_id?: string | null;
    counts?: Progress['counts'];
  };
  const status =
    job.status === 'completed'
      ? 'completed'
      : job.status === 'failed' || job.status === 'dead_letter'
        ? 'failed'
        : (p.checks ?? 0) > 0 || job.status === 'running'
          ? 'running'
          : 'queued';
  const user = await intel.ai.users.load(userId);
  let top = result.top_items;
  let total = result.total_items;
  if (top === undefined) {
    const live = await assist.store.topInsights(userId, 5);
    top = live.items.map((i) => ({
      insight_id: i.id,
      kind: i.kind,
      title: i.title,
      at: i.due_at ?? i.event_at,
    }));
    total = live.total;
  }
  return {
    status,
    partial: result.partial ?? p.partial ?? false,
    steps: p.steps ?? INITIAL_STEPS,
    counts: result.counts ?? p.counts ?? ZERO_COUNTS,
    top_items: top.slice(0, 5).map((t) => ({
      insight_id: t.insight_id,
      kind: t.kind,
      title: t.title.slice(0, 200),
      time_label:
        t.at === null
          ? null
          : `${formatDay(user.locale, t.at, user.timeZone)} ${formatTime(t.at, user.timeZone)}`,
    })),
    total_items: total ?? 0,
    briefing_id: result.briefing_id ?? null,
  };
}

export const registerOnboardingRoutes: RouteRegistrar = (app, kit) => {
  const idem = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };

  const start = routes['POST /onboarding/first-analysis'];
  mountRoute(
    app,
    start,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(start),
    validateRequest(start),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, FirstAnalysisBody);
      const key = `first_analysis:${auth.userId}`;
      return withIdempotency(c, idem, {
        status: 202,
        async execute() {
          const { assist } = assistOf(kit);
          const existing = await assist.store.jobByKey(key);
          if (existing !== null) {
            return {
              data: { job: jobRef(existing), already_running: PENDING.has(existing.status) },
              ref: { type: 'job', id: existing.id },
              meta: { poll_after_ms: FIRST_ANALYSIS_POLL_MS },
            };
          }
          const accounts = await assist.store.accountSources(auth.userId);
          if (accounts.length === 0)
            throw new AppError('STATE_CONFLICT', { details: { reason: 'no_sources' } });
          const id = await kit.deps.repos(auth).jobs.enqueue({
            type: 'first_analysis',
            idempotencyKey: key,
            payload: {
              user_id: auth.userId,
              window_hours: body.window_hours,
              connected_account_ids: accounts.map((a) => a.id),
            },
            userId: auth.userId,
            priority: 5,
            // Each progress check is one attempt (JOB-13: ≤ 200 checks, re-queued after 3 s).
            maxAttempts: FIRST_ANALYSIS_MAX_CHECKS,
            correlationId: c.get('correlationId'),
          });
          await assist.store.setOnboardingStep(auth.userId, 'analysis');
          return {
            data: { job: jobRef({ id, status: 'queued' }), already_running: false },
            ref: { type: 'job', id },
            meta: { poll_after_ms: FIRST_ANALYSIS_POLL_MS },
          };
        },
        async replay(ref) {
          const job = await assistOf(kit).assist.store.job(ref.id ?? '');
          if (job === null) throw new AppError('NOT_FOUND');
          return { job: jobRef(job), already_running: PENDING.has(job.status) };
        },
      });
    },
  );

  const poll = routes['GET /onboarding/first-analysis/:jobId'];
  mountRoute(
    app,
    poll,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    validateRequest(poll),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, poll.request.params);
      const job = await assistOf(kit).assist.store.job(params.jobId);
      if (job === null || job.type !== 'first_analysis' || job.user_id !== auth.userId) {
        throw new AppError('NOT_FOUND', { details: { resource: 'job' } });
      }
      const data = await progressView(kit, auth.userId, job);
      return sendData(
        c,
        data,
        200,
        data.status === 'completed' || data.status === 'failed'
          ? {}
          : { poll_after_ms: FIRST_ANALYSIS_POLL_MS },
      );
    },
  );
};
