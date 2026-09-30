/**
 * `worker` (`/functions/v1/worker`; API_CONTRACTS §11.1 JOB-00, IMPLEMENTATION_PLAN T-3.06).
 * `POST /worker/run {types?, max_jobs?, budget_ms?, worker_id?}` requires the automations secret
 * (pg_cron → pg_net every 15 s, plus immediate pokes) and drains claimable jobs.
 */
import type { Hono } from 'hono';
import { JOB_TYPE_VALUES } from '@da/domain';
import { z } from 'zod';
import { requireSecret } from '../_shared/auth/secret.ts';
import { AppError, validationError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import { sendData } from '../_shared/http/respond.ts';
import type { JobsRepo } from '../_shared/jobs/client.ts';
import type { JobRegistry } from '../_shared/jobs/registry.ts';
import { runWorker } from '../_shared/jobs/runner.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';

export const WorkerRunBody = z.strictObject({
  types: z.array(z.enum(JOB_TYPE_VALUES)).max(30).optional(),
  max_jobs: z.int().min(1).max(50).default(25),
  budget_ms: z.int().min(5000).max(380000).default(120000),
  worker_id: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,64}$/)
    .optional(),
});

export interface WorkerDeps {
  readonly secret: string | undefined;
  readonly repo: JobsRepo;
  readonly registry: JobRegistry;
  readonly log: Logger;
  readonly sentry?: Sentry;
  readonly now?: () => number;
  readonly random?: () => number;
}

export function createWorkerApp(deps: WorkerDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'worker',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
  });
  app.post('/run', requireSecret({ name: 'automations', secret: deps.secret }), async (c) => {
    c.set('routeKey', 'POST /run');
    const text = await c.req.text();
    let json: unknown = {};
    if (text.trim() !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        throw new AppError('BAD_REQUEST', { details: { reason: 'malformed_json' } });
      }
    }
    const parsed = WorkerRunBody.safeParse(json);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;
    const summary = await runWorker({
      repo: deps.repo,
      registry: deps.registry,
      log: c.get('log'),
      maxJobs: body.max_jobs,
      budgetMs: body.budget_ms,
      ...(body.types === undefined ? {} : { types: body.types }),
      ...(body.worker_id === undefined ? {} : { workerId: body.worker_id }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.random === undefined ? {} : { random: deps.random }),
    });
    return sendData(c, {
      claimed: summary.claimed,
      completed: summary.completed,
      retried: summary.retried,
      failed: summary.failed,
      dead_lettered: summary.dead_lettered,
      duration_ms: summary.duration_ms,
    });
  });
  return app;
}
