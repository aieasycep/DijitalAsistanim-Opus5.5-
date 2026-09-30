/**
 * Best-effort, per-instance sliding-window limiter for pre-auth POSTs (`/login`, `/mfa`, `/invite`;
 * BACKOFFICE_PLAN §2.4 step 7: 30 per 5 minutes per IP). The authoritative limits live in the
 * database behind `admin-api` `/auth/preflight` and `/auth/attempt` (§3.9); this only blunts floods
 * before they reach Supabase Auth.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the oldest hit leaves the window (only when refused). */
  readonly retryAfter: number;
}

export interface SlidingWindowLimiter {
  hit(key: string, now?: number): RateLimitDecision;
  reset(): void;
}

export function createSlidingWindowLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): SlidingWindowLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;
  return {
    hit(key, now = Date.now()) {
      const since = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > since);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? now;
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000)),
        };
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        const first = hits.keys().next();
        if (first.done !== true) hits.delete(first.value);
      }
      return { allowed: true, retryAfter: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}

/** Paths whose POSTs are throttled before authentication. */
export const PRE_AUTH_THROTTLED_PATHS: ReadonlySet<string> = new Set(['/login', '/mfa', '/invite']);

export const preAuthLimiter = createSlidingWindowLimiter({ limit: 30, windowMs: 5 * 60_000 });
