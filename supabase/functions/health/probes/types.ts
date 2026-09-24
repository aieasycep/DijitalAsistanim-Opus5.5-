/**
 * Health probe contract (API_CONTRACTS §14 HLT-02, BACKOFFICE_PLAN §11, IMPLEMENTATION_PLAN T-3.07).
 * A probe never reports a fake green: a missing credential is always `external_credential_required`,
 * an unreachable dependency is `down`, and a probe that cannot decide is `unknown`.
 */
import type { RawEnv } from '../../_shared/env.ts';
import type { DemoModeState } from '../../_shared/providers/demo/guard.ts';

export type HealthStatus =
  'healthy' | 'degraded' | 'down' | 'external_credential_required' | 'unknown';

/** `system_health_checks.component` values accepted by the DB check (migration 0010). */
export type HealthComponent =
  | 'api'
  | 'database'
  | 'supabase_auth'
  | 'storage'
  | 'google_oauth'
  | 'microsoft_oauth'
  | 'gmail'
  | 'microsoft_graph'
  | 'push'
  | 'ai_anthropic'
  | 'ai_openai'
  | 'ai_voyage'
  | 'revenuecat'
  | 'cron'
  | 'webhooks'
  | 'worker';

/** Probes whose component is not yet in the DB check / `HealthProbe` enum (BACKOFFICE_PLAN §16 #21). */
export type PendingComponent = 'email_delivery' | 'audit_chain';

export interface ProbeResult {
  readonly component: HealthComponent | PendingComponent;
  readonly status: HealthStatus;
  readonly latencyMs: number | null;
  readonly detailCode: string | null;
  /** Content-free details (counts, ratios, key names). */
  readonly detail?: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
}

export interface WebhookSourceStats {
  readonly lastReceivedAt: string | null;
  readonly total: number;
  readonly rejected: number;
  readonly backlog: number;
}

export interface CronStats {
  /** Latest `job_attempts.finished_at` (worker liveness). */
  readonly lastAttemptFinishedAt: string | null;
  /** `run_after` of the oldest claimable job (queue lag). */
  readonly oldestReadyJobAt: string | null;
  /** Latest `created_at` of a job enqueued by pg_cron (`health_check` / `push_receipts`, every 5 min). */
  readonly lastCronEnqueueAt: string | null;
}

/** Everything the probes read from our own database (service client). */
export interface HealthData {
  pingDatabase(): Promise<void>;
  listStorage(bucket: string): Promise<void>;
  cronStats(now: Date): Promise<CronStats>;
  webhookStats(source: string, since: Date): Promise<WebhookSourceStats>;
  aiErrorRate(provider: string, since: Date): Promise<{ total: number; errors: number }>;
  accountHealth(provider: 'google' | 'microsoft'): Promise<{ total: number; failing: number }>;
  /** The configured `embedding_query` model (`ai_model_config`, profile `balanced`). */
  embeddingQueryModel(): Promise<string | null>;
  auditChain(window: number): Promise<{ ok: boolean; checked: number; firstBadSeq: number | null }>;
}

export interface ProbeContext {
  readonly raw: RawEnv;
  readonly data: HealthData;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly timeoutMs: number;
  readonly demo: DemoModeState;
  /** Base URL of this project (`API_PUBLIC_BASE_URL` or `SUPABASE_URL`). */
  readonly baseUrl: string | null;
}

export type Probe = (ctx: ProbeContext) => Promise<ProbeResult | ProbeResult[]>;

/** Times an async check; exceptions become `down` with the error name only. */
export async function timed<T>(
  ctx: ProbeContext,
  fn: () => Promise<T>,
): Promise<
  { ok: true; value: T; latencyMs: number } | { ok: false; latencyMs: number; error: string }
> {
  const started = ctx.now().getTime();
  try {
    const value = await fn();
    return { ok: true, value, latencyMs: ctx.now().getTime() - started };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { ok: false, latencyMs: ctx.now().getTime() - started, error: name };
  }
}

/** `GET` an external endpoint with the probe timeout; resolves the status code (body discarded). */
export async function probeFetch(
  ctx: ProbeContext,
  url: string,
  init: RequestInit = {},
): Promise<number> {
  const response = await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(ctx.timeoutMs) });
  await response.body?.cancel();
  return response.status;
}

export function credentialRequired(
  component: ProbeResult['component'],
  missing: readonly string[],
): ProbeResult {
  return {
    component,
    status: 'external_credential_required',
    latencyMs: null,
    detailCode: 'credential_missing',
    detail: { credential_keys: [...missing] },
  };
}
