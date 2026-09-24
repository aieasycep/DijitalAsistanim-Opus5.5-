/**
 * Request rate limits (API_CONTRACTS §2.9, IMPLEMENTATION_PLAN T-3.03). A fixed window per key via
 * `public.rate_limit_hit(p_key, p_limit, p_window_seconds)` (service role; `true` = allowed). Every
 * limited response carries `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and
 * `RateLimit-Policy`; a denial is `429 RATE_LIMITED` with `Retry-After`.
 */
import type { MiddlewareHandler } from 'hono';
import { RATE_LIMITS, type RateLimitClass, type RateLimitClassName } from './config.ts';
import { AppError, mapDbError } from './errors.ts';
import type { DbClient } from './db/clients.ts';
import { DB_FN, rpc } from './db/functions.ts';
import type { AppContext, AppEnv } from './http/context.ts';

export interface RateLimitHit {
  readonly allowed: boolean;
  /** Requests counted in the current window, when known. */
  readonly count: number | null;
}

export interface RateLimitStore {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitHit>;
}

/** Start of the fixed window, exactly as `rate_limit_hit` computes it. */
export function windowStart(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds;
}

/** supabase-backed store: the RPC, then the window's count for `RateLimit-Remaining`. */
export function supabaseRateLimitStore(
  client: DbClient,
  now: () => number = Date.now,
): RateLimitStore {
  return {
    async hit(key, limit, windowSeconds) {
      const allowed = await rpc<boolean>(client, DB_FN.rateLimitHit, {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      const start = new Date(windowStart(now(), windowSeconds) * 1000).toISOString();
      const { data, error } = await client
        .from('rate_limits')
        .select('count')
        .eq('key', key)
        .eq('window_start', start)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      const count =
        typeof (data as { count?: unknown } | null)?.count === 'number'
          ? (data as { count: number }).count
          : null;
      return { allowed: allowed === true, count };
    },
  };
}

export interface RateLimitOptions {
  readonly store: RateLimitStore;
  /** Function prefix of the key, e.g. `api`. */
  readonly scope: string;
  readonly now?: () => number;
}

export function rateLimitHeaders(
  cls: RateLimitClass,
  hit: RateLimitHit,
  nowMs: number,
): Record<string, string> {
  const resetAt = windowStart(nowMs, cls.windowSeconds) + cls.windowSeconds;
  const reset = Math.max(1, resetAt - Math.floor(nowMs / 1000));
  const remaining = hit.allowed ? Math.max(0, cls.limit - (hit.count ?? 1)) : 0;
  return {
    'RateLimit-Limit': String(cls.limit),
    'RateLimit-Remaining': String(remaining),
    'RateLimit-Reset': String(reset),
    'RateLimit-Policy': `${cls.limit};w=${cls.windowSeconds}`,
  };
}

function subjectKey(c: AppContext, cls: RateLimitClass): string {
  const auth = c.get('auth');
  if (cls.subject === 'installation') {
    const installation = c.get('installationId');
    if (installation !== null) return `i:${installation}`;
  }
  if (auth !== undefined) return `u:${auth.userId}`;
  throw new AppError('AUTH_REQUIRED', { details: { reason: 'rate_limit_subject' } });
}

/** Checks one class for the current request; throws `RATE_LIMITED` when over the limit. */
export async function enforceRateLimit(
  c: AppContext,
  options: RateLimitOptions,
  className: RateLimitClassName,
  subject?: string,
): Promise<void> {
  const cls = RATE_LIMITS[className];
  const nowMs = (options.now ?? Date.now)();
  const key = `${options.scope}:${className}:${subject ?? subjectKey(c, cls)}`;
  const hit = await options.store.hit(key, cls.limit, cls.windowSeconds);
  const headers = rateLimitHeaders(cls, hit, nowMs);
  if (!hit.allowed) {
    throw new AppError('RATE_LIMITED', {
      headers: { ...headers, 'Retry-After': headers['RateLimit-Reset'] ?? '1' },
    });
  }
  for (const [name, value] of Object.entries(headers)) c.header(name, value);
}

export function rateLimit(
  options: RateLimitOptions,
  className: RateLimitClassName,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await enforceRateLimit(c, options, className);
    await next();
  };
}
