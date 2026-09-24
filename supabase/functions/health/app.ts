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
import { API_CONTRACT_VERSION, OUTBOUND } from '../_shared/config.ts';
import type { RawEnv } from '../_shared/env.ts';
import { AppError, validationError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import { sendData } from '../_shared/http/respond.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import { demoModeState } from '../_shared/providers/demo/guard.ts';
import type { HealthRow, HealthWriter } from './data.ts';
import { PERSISTED_COMPONENTS, PROBES } from './probes/index.ts';
import type { HealthData, ProbeContext, ProbeResult } from './probes/types.ts';

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

type Caller = 'cron' | 'admin';

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
function callerOf(c: { get(key: 'admin'): AppEnv['Variables']['admin'] }): Caller {
  return c.get('admin') === undefined ? 'cron' : 'admin';
}

export async function runProbes(
  ctx: ProbeContext,
  names: readonly string[],
): Promise<ProbeResult[]> {
  const results = await Promise.all(
    names.map(async (name) => {
      const entry = PROBES[name];
      if (entry === undefined) return [];
      try {
        const out = await entry.probe(ctx);
        return Array.isArray(out) ? out : [out];
      } catch {
        return entry.components.map((component): ProbeResult => ({
          component,
          status: 'unknown',
          latencyMs: null,
          detailCode: 'probe_error',
        }));
      }
    }),
  );
  return results.flat();
}

export function createHealthApp(deps: HealthDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'health',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
  });
  const now = deps.now ?? (() => new Date());
  const contractProbes = new Set<string>(adminSchemas.HEALTH_PROBE_VALUES);

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
    const requested = parsed.data.probes;
    // `ai_*` probes share one module; the pending components run with every full run.
    const names =
      requested === undefined
        ? Object.keys(PROBES)
        : [...new Set(requested.map((p) => (p.startsWith('ai_') ? 'ai' : p)))];

    const url = (deps.raw.API_PUBLIC_BASE_URL ?? deps.raw.SUPABASE_URL)?.trim();
    const ctx: ProbeContext = {
      raw: deps.raw,
      data: deps.data,
      fetch: deps.fetch ?? fetch,
      now,
      timeoutMs: OUTBOUND.healthProbeTimeoutMs,
      demo: demoModeState(deps.raw),
      baseUrl: url === undefined || url === '' ? null : url.replace(/\/+$/, ''),
    };
    const results = await runProbes(ctx, names);
    const checkedAt = now().toISOString();
    const caller = callerOf(c);
    const selected = requested === undefined ? null : new Set<string>(requested);

    const rows: HealthRow[] = [];
    for (const r of results) {
      if (!PERSISTED_COMPONENTS.has(r.component)) {
        c.get('log').info('health_probe_unpersisted', {
          component: r.component,
          status: r.status,
          detail_code: r.detailCode,
        });
        continue;
      }
      if (selected !== null && !selected.has(r.component)) continue;
      rows.push({
        component: r.component,
        status: r.status,
        latency_ms: r.latencyMs,
        detail: { code: r.detailCode, ...(r.detail ?? {}), correlation_id: c.get('correlationId') },
        checked_by: caller,
        checked_at: checkedAt,
      });
    }
    await deps.writer.insert(rows);

    return sendData(c, {
      results: results
        .filter(
          (r) =>
            contractProbes.has(r.component) && (selected === null || selected.has(r.component)),
        )
        .map((r) => ({
          probe: r.component,
          status: r.status,
          latency_ms: r.latencyMs === null ? null : Math.max(0, Math.round(r.latencyMs)),
          detail_code: r.detailCode,
          checked_at: checkedAt,
        })),
    });
  });

  return app;
}
