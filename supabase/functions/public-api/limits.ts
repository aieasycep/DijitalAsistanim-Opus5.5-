/**
 * `public-api` rate limits (API_CONTRACTS §2.9). Subjects are peppered hashes: the client IP
 * (`hashId(x-forwarded-for first hop)`), the normalised e-mail, the deletion request id or the
 * inbound provider; raw IPs and addresses are never stored. A denial is `429 RATE_LIMITED` with
 * `Retry-After` and the `RateLimit-*` headers.
 */
import { clientIp, hashIdHex, normalizeEmailForHash, type Pepper } from '../_shared/crypto/hash.ts';
import type { RateLimitClass } from '../_shared/config.ts';
import { AppError } from '../_shared/errors.ts';
import type { AppContext } from '../_shared/http/context.ts';
import { rateLimitHeaders } from '../_shared/ratelimit.ts';
import type { PublicApiServices } from './deps.ts';

export const PUBLIC_RATE_LIMITS = {
  support_ip: { limit: 5, windowSeconds: 3600, subject: 'ip' },
  support_email: { limit: 3, windowSeconds: 3600, subject: 'ip' },
  deletion_start_ip: { limit: 10, windowSeconds: 3600, subject: 'ip' },
  deletion_start_email: { limit: 3, windowSeconds: 3600, subject: 'ip' },
  referral_ip: { limit: 60, windowSeconds: 60, subject: 'ip' },
  plans_ip: { limit: 120, windowSeconds: 60, subject: 'ip' },
  web_events_ip: { limit: 120, windowSeconds: 60, subject: 'ip' },
  deletion_status_request: { limit: 30, windowSeconds: 3600, subject: 'ip' },
  deletion_status_ip: { limit: 60, windowSeconds: 3600, subject: 'ip' },
  inbound_provider: { limit: 600, windowSeconds: 3600, subject: 'ip' },
} as const satisfies Record<string, RateLimitClass>;

export type PublicRateLimit = keyof typeof PUBLIC_RATE_LIMITS;

/** OTP lockout (PUB-03): 5 failed verifications within 15 minutes lock the address for 1 hour. */
export const OTP_POLICY = { maxFailures: 5, windowSeconds: 900, lockSeconds: 3600 } as const;

export async function ipSubject(c: AppContext, pepper: Pepper): Promise<string> {
  const ip = clientIp(c.req.header('X-Forwarded-For'));
  return ip === null ? 'ip:unknown' : `ip:${await hashIdHex(pepper, `ip:${ip}`)}`;
}

export function emailSubject(pepper: Pepper, email: string): Promise<string> {
  return hashIdHex(pepper, `email:${normalizeEmailForHash(email)}`);
}

export async function enforcePublicLimit(
  c: AppContext,
  services: Pick<PublicApiServices, 'rateLimits' | 'now'>,
  name: PublicRateLimit,
  subject: string,
): Promise<void> {
  const cls = PUBLIC_RATE_LIMITS[name];
  const nowMs = services.now().getTime();
  const hit = await services.rateLimits.hit(
    `public-api:${name}:${subject}`,
    cls.limit,
    cls.windowSeconds,
  );
  const headers = rateLimitHeaders(cls, hit, nowMs);
  if (!hit.allowed) {
    throw new AppError('RATE_LIMITED', {
      headers: { ...headers, 'Retry-After': headers['RateLimit-Reset'] ?? '1' },
    });
  }
  for (const [header, value] of Object.entries(headers)) c.header(header, value);
}
