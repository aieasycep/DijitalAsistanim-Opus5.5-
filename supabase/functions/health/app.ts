/**
 * `health` (`/functions/v1/health`; API_CONTRACTS §14, IMPLEMENTATION_PLAN T-3.07).
 * - `GET /health/live` → `{status:'ok', version, region}` without touching the database.
 * - `POST /health/run {probes?}` runs the real dependency probes and writes one
 *   `system_health_checks` row per component (`checked_by` = `cron` for the automations secret,
 *   `admin` for an admin with `health.run`).
 * Both accept the automations secret or an admin (`health.read` / `health.run`).
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { admin as adminSchemas } from '@da/validation';
import { type AdminAuthOptions, authenticateAdmin } from '../_shared/auth/admin.ts';
import { hasSecret } from '../_shared/auth/secret.ts';
import { API_CONTRACT_VERSION } from '../_shared/config.ts';
import type { RawEnv } from '../_shared/env.ts';
import { AppError, validationError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import { sendData } from '../_shared/http/respond.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import type { HealthWriter } from './data.ts';
import type { HealthData } from './probes/types.ts';
import { executeHealthRun, type HealthCaller } from './run.ts';

export interface HealthDeps {
  readonly raw: RawEnv;
  readonly data: HealthData;
  readonly writer: HealthWriter;
  readonly admin: AdminAuthOptions | null;
  readonly log: Logger;
  readonly sentry?: Sentry;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

function authorize(deps: HealthDeps, permission: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const secret = deps.raw.CRON_SECRET?.trim();
    if (await hasSecret(c, { name: 'automations', secret })) {
      await next();
      return;
    }
    if (deps.admin === null)
      throw new AppError('AUTH_REQUIRED', { details: { reason: 'secret_required' } });
    c.set('admin', await authenticateAdmin(c, deps.admin, permission));
    await next();
  };
}

/** `checked_by`: `admin` when an admin identity was authenticated, else the automations secret. */
function callerOf(c: { get(key: 'admin'): AppEnv['Variables']['admin'] }): HealthCaller {
  return c.get('admin') === undefined ? 'cron' : 'admin';
}

export function createHealthApp(deps: HealthDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'health',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
  });
  const now = deps.now ?? (() => new Date());

  app.get('/live', authorize(deps, 'health.read'), (c) => {
    c.set('routeKey', 'GET /live');
    return sendData(c, {
      status: 'ok',
      version: API_CONTRACT_VERSION,
      region: deps.raw.SB_REGION?.trim() || 'unknown',
    });
  });

  app.post('/run', authorize(deps, 'health.run'), async (c) => {
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
    const parsed = adminSchemas.HealthRunBody.safeParse(json);
    if (!parsed.success) throw validationError(parsed.error);
    const outcome = await executeHealthRun(
      { raw: deps.raw, data: deps.data, writer: deps.writer, fetch: deps.fetch ?? fetch, now },
      {
        probes: parsed.data.probes,
        caller: callerOf(c),
        correlationId: c.get('correlationId'),
        log: c.get('log'),
      },
    );
    return sendData(c, { results: outcome.results });
  });

  return app;
}
