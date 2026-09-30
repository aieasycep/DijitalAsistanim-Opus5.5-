/**
 * Backoffice rate classes (BACKOFFICE_PLAN §3.9, §12; API_CONTRACTS §2.9) on
 * `public.rate_limit_hit` (fixed windows, service role):
 *   R read       `bo_r:{admin}` 600 / min — applied inside `admin_api.admin_me` (the context call);
 *   S search     `bo_s:{admin}`  60 / min;
 *   M mutation   `bo_m:{admin}`  60 / min (the same counter `admin_api.authorize` uses);
 *   X sensitive  `bo_x:{admin}`  30 / h, and the refusal is audited as `admin.rate_limited`;
 *   A sign-in    limits live in the SQL sign-in functions (IP, email and recovery buckets).
 * A refusal is `429 RATE_LIMITED` with `Retry-After`.
 */
import type { RateLimitClass } from '../../_shared/config.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppContext } from '../../_shared/http/context.ts';
import type { Logger } from '../../_shared/logging/logger.ts';
import { rateLimitHeaders, type RateLimitStore } from '../../_shared/ratelimit.ts';
import type { AdminDb } from '../lib/db.ts';
import type { RateClass } from '../lib/route.ts';

export const ADMIN_RATE_CLASSES: Readonly<
  Record<'S' | 'M' | 'X', RateLimitClass & { readonly prefix: string }>
> = {
  S: { prefix: 'bo_s', limit: 60, windowSeconds: 60, subject: 'user' },
  M: { prefix: 'bo_m', limit: 60, windowSeconds: 60, subject: 'user' },
  X: { prefix: 'bo_x', limit: 30, windowSeconds: 3600, subject: 'user' },
};

export async function enforceAdminRateLimit(options: {
  readonly c: AppContext;
  readonly store: RateLimitStore;
  readonly rate: RateClass;
  readonly adminId: string;
  readonly db: AdminDb;
  readonly log: Logger;
  readonly routeKey: string;
  readonly nowMs: number;
}): Promise<void> {
  if (options.rate !== 'S' && options.rate !== 'M' && options.rate !== 'X') return;
  const cls = ADMIN_RATE_CLASSES[options.rate];
  const hit = await options.store.hit(
    `${cls.prefix}:${options.adminId}`,
    cls.limit,
    cls.windowSeconds,
  );
  const headers = rateLimitHeaders(cls, hit, options.nowMs);
  if (!hit.allowed) {
    if (options.rate === 'X') {
      try {
        await options.db.call('audit_write', {
          p_action: 'admin.rate_limited',
          p_target_type: 'route',
          p_target_id: options.routeKey.slice(0, 200),
          p_target_user_id: null,
          p_reason: 'sensitive action rate limit reached',
          p_result: 'denied',
          p_details: { route: options.routeKey, class: 'X' },
        });
      } catch (cause) {
        options.log.warn('admin_rate_limit_audit_failed', {
          error_code: cause instanceof AppError ? cause.code : 'unknown',
        });
      }
    }
    throw new AppError('RATE_LIMITED', {
      headers: { ...headers, 'Retry-After': headers['RateLimit-Reset'] ?? '1' },
    });
  }
  for (const [name, value] of Object.entries(headers)) options.c.header(name, value);
}
