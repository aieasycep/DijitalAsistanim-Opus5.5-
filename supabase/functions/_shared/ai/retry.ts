/**
 * Retries inside a synchronous AI call (AI_PIPELINE_PLAN §15.1 `retry.ts`, §15.3): at most 2 retries
 * of a retryable failure within the route deadline, full-jitter backoff (base 400 ms, cap 8 s). A
 * provider `Retry-After` is honoured when it fits the deadline.
 */
import { AiError, normalizeAiError } from './errors.ts';
import type { ProviderId } from './types.ts';

export interface RetryOptions {
  readonly provider: ProviderId;
  readonly retries?: number;
  readonly baseMs?: number;
  readonly capMs?: number;
  /** Absolute deadline (epoch ms); no retry starts after it. */
  readonly deadline?: number;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called after each failed attempt (telemetry: one `ai_requests` row per attempt). */
  readonly onAttemptError?: (error: AiError, attempt: number) => Promise<void> | void;
}

export function fullJitterDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number,
): number {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** attempt));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const retries = options.retries ?? 2;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (thrown) {
      const error = normalizeAiError(options.provider, thrown);
      await options.onAttemptError?.(error, attempt);
      if (!error.retryable || attempt >= retries) throw error;
      const backoff = fullJitterDelay(
        attempt,
        options.baseMs ?? 400,
        options.capMs ?? 8_000,
        random,
      );
      const wait = error.retryAfterMs !== null ? Math.max(backoff, error.retryAfterMs) : backoff;
      if (options.deadline !== undefined && now() + wait >= options.deadline) throw error;
      await sleep(wait);
    }
  }
}
