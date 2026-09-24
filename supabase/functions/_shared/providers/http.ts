/**
 * HTTP wrapper for provider APIs (IMPLEMENTATION_PLAN T-3.08, INTEGRATION_PLAN §3.6, API_CONTRACTS
 * §2.7/§2.10):
 * - consumes provider quota before every attempt (`QuotaGate`);
 * - retries idempotent requests on 5xx / network errors (2 quick retries: 250 ms, then 1 s); writes
 *   never retry in-run;
 * - honours `Retry-After` on 429 when it fits the request deadline, else surfaces `rate_limited`;
 * - enforces the 10 s timeout per call;
 * - classifies failures (`classifyProviderFailure`) and reports the implied `account_status` change.
 */
import type { AccountStatus, QuotaBucket, QuotaGate, QuotaPriority } from '@da/domain';
import { ProviderError } from '@da/domain';
import { OUTBOUND } from '../config.ts';
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';
import {
  accountStatusChange,
  classifyProviderFailure,
  parseRetryAfter,
  type ProviderErrorBody,
} from './errors.ts';

export interface ProviderRequest {
  readonly url: string;
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
  /** Retry on 5xx / network even for non-GET methods (the caller guarantees idempotency). */
  readonly idempotent?: boolean;
  /** Quota bucket and units to consume per attempt. */
  readonly quota?: { bucket: QuotaBucket; units: number; priority?: QuotaPriority };
}

export interface ProviderHttpOptions {
  readonly fetch?: typeof fetch;
  readonly quota?: QuotaGate;
  readonly timeoutMs?: number;
  /** Longest `Retry-After` honoured inside the call; longer waits surface as `rate_limited`. */
  readonly maxInlineRetryAfterMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
  /** Parses the provider's error body into a code/reason (never content). */
  readonly parseError?: (response: Response) => Promise<ProviderErrorBody>;
  /** Called with the account status a failure implies (the caller persists it). */
  readonly onAccountStatus?: (change: {
    status: AccountStatus;
    statusReason: string;
  }) => Promise<void> | void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads `{error: string|{code,status,errors:[{reason}]}, error_description?}` shapes. */
export async function defaultParseError(response: Response): Promise<ProviderErrorBody> {
  try {
    const json = (await response.json()) as Record<string, unknown>;
    const error = json.error;
    if (typeof error === 'string')
      return {
        code: error,
        reason: typeof json.error_codes === 'object' ? JSON.stringify(json.error_codes) : null,
      };
    if (typeof error === 'object' && error !== null) {
      const e = error as { code?: unknown; status?: unknown; errors?: { reason?: unknown }[] };
      const reason = e.errors?.[0]?.reason;
      return {
        code: typeof e.code === 'string' ? e.code : typeof e.status === 'string' ? e.status : null,
        reason: typeof reason === 'string' ? reason : null,
      };
    }
    return {};
  } catch {
    return {};
  }
}

export async function providerFetch(
  request: ProviderRequest,
  options: ProviderHttpOptions = {},
): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const method = request.method ?? 'GET';
  const idempotent = request.idempotent ?? (method === 'GET' || method === 'HEAD');
  const delays = options.retryDelaysMs ?? [250, 1000];
  const maxInline = options.maxInlineRetryAfterMs ?? 2_000;
  const parse = options.parseError ?? defaultParseError;

  let attempt = 0;
  while (true) {
    if (request.quota !== undefined && options.quota !== undefined) {
      await options.quota.acquire(request.quota.bucket, request.quota.units, {
        priority: request.quota.priority ?? 'sync',
      });
    }
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? OUTBOUND.providerTimeoutMs);
      response = await doFetch(request.url, {
        method,
        headers: request.headers ?? {},
        body: request.body ?? null,
        signal: options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      if (idempotent && attempt < delays.length) {
        await sleep(delays[attempt] ?? 1000);
        attempt++;
        continue;
      }
      throw new ProviderError('provider_unavailable', null, null, timedOut ? 'timeout' : 'network');
    }
    if (response.ok) return response;

    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
    if (response.status >= 500 && idempotent && attempt < delays.length) {
      await response.body?.cancel();
      await sleep(delays[attempt] ?? 1000);
      attempt++;
      continue;
    }
    if (
      response.status === 429 &&
      retryAfterMs !== null &&
      retryAfterMs <= maxInline &&
      attempt < delays.length
    ) {
      await response.body?.cancel();
      await sleep(retryAfterMs);
      attempt++;
      continue;
    }
    const body = await parse(response);
    const error = classifyProviderFailure(response.status, body, retryAfterMs);
    const change = accountStatusChange(error);
    if (change !== null && options.onAccountStatus !== undefined)
      await options.onAccountStatus(change);
    throw error;
  }
}

/** Per-bucket budgets (INTEGRATION_PLAN §3.6 "Our budget"). */
export const QUOTA_BUDGETS: Readonly<
  Record<QuotaBucket, { limit: number; windowSeconds: number; scope: 'account' | 'project' }>
> = {
  gmail_user_units: { limit: 4_000, windowSeconds: 60, scope: 'account' },
  gmail_project_units_day: { limit: 48_000_000, windowSeconds: 86_400, scope: 'project' },
  gcal_user_requests: { limit: 400, windowSeconds: 60, scope: 'account' },
  // Google Tasks' per-project daily quota is the Cloud Console default (50,000); raise both together.
  gtasks_project_requests_day: { limit: 50_000, windowSeconds: 86_400, scope: 'project' },
  graph_mailbox_requests: { limit: 8_000, windowSeconds: 600, scope: 'account' },
  graph_subscription_ops: { limit: 2_000, windowSeconds: 20, scope: 'project' },
};

/** Priority caps within the Gmail per-user budget (§3.6). */
const PRIORITY_SHARE: Readonly<Record<QuotaPriority, number>> = {
  interactive: 1,
  sync: 0.75,
  backfill: 0.5,
};

/**
 * `QuotaGate` over `private.consume_provider_quota(p_bucket, p_account, p_units, p_limit,
 * p_window_seconds)` (returns `wait_ms`, 0 = admitted). Waits up to `maxWaitMs`, then throws
 * `ProviderError('rate_limited')` so the job is rescheduled.
 */
export function supabaseQuotaGate(
  client: DbClient,
  accountId: string | null,
  options: { sleep?: (ms: number) => Promise<void>; defaultMaxWaitMs?: number } = {},
): QuotaGate {
  const sleep = options.sleep ?? defaultSleep;
  return {
    async acquire(bucket, units, opts) {
      const budget = QUOTA_BUDGETS[bucket];
      const share = PRIORITY_SHARE[opts?.priority ?? 'sync'];
      const limit = Math.max(1, Math.floor(budget.limit * share));
      const maxWait = opts?.maxWaitMs ?? options.defaultMaxWaitMs ?? 5_000;
      let waited = 0;
      while (true) {
        const waitMs = await rpc<number>(client, DB_FN.consumeProviderQuota, {
          p_bucket: bucket,
          p_account: budget.scope === 'account' ? accountId : null,
          p_units: units,
          p_limit: limit,
          p_window_seconds: budget.windowSeconds,
        });
        if (waitMs <= 0) return;
        if (waited + waitMs > maxWait)
          throw new ProviderError('rate_limited', null, waitMs, 'local_quota');
        await sleep(waitMs);
        waited += waitMs;
      }
    },
  };
}
