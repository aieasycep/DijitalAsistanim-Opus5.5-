/**
 * AI error normalisation (AI_PIPELINE_PLAN §15.1 `errors.ts`, API_CONTRACTS §2.7). Adapters map vendor
 * failures to `AiError`; the orchestration decides between retry, fallback and the T0 path.
 * Messages carry codes only: provider error bodies are never kept (they may echo content).
 */
import type { ErrorCodeValue } from '@da/validation';
import { AppError } from '../errors.ts';
import type { ProviderId } from './types.ts';

export type AiErrorCode =
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTH'
  | 'BAD_REQUEST'
  | 'MODEL_UNAVAILABLE'
  | 'REFUSAL'
  | 'MAX_TOKENS'
  | 'SCHEMA_VALIDATION'
  | 'OUTPUT_REJECTED'
  | 'NOT_CONFIGURED'
  | 'CREDENTIAL_MISSING'
  | 'UNSUPPORTED_OPERATION'
  | 'KILL_SWITCH'
  | 'BUDGET_EXHAUSTED';

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set([
  'RATE_LIMITED',
  'OVERLOADED',
  'SERVER_ERROR',
  'TIMEOUT',
  'NETWORK',
]);

/** Codes that move on to the next fallback target (as opposed to stopping the chain). */
const FALLBACK: ReadonlySet<AiErrorCode> = new Set([
  'RATE_LIMITED',
  'OVERLOADED',
  'SERVER_ERROR',
  'TIMEOUT',
  'NETWORK',
  'MODEL_UNAVAILABLE',
  'REFUSAL',
  'MAX_TOKENS',
  'SCHEMA_VALIDATION',
  'OUTPUT_REJECTED',
  'AUTH',
  'CREDENTIAL_MISSING',
  'UNSUPPORTED_OPERATION',
  'BAD_REQUEST',
]);

export class AiError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: AiErrorCode,
    readonly provider: ProviderId | null = null,
    readonly httpStatus: number | null = null,
    readonly retryAfterMs: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(`ai_${code.toLowerCase()}`);
    this.name = 'AiError';
    this.retryable = RETRYABLE.has(code);
  }

  get triggersFallback(): boolean {
    return FALLBACK.has(this.code);
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

/** Maps an HTTP status (and optional vendor error type) to an `AiError`. */
export function aiErrorFromHttp(
  provider: ProviderId,
  status: number,
  options: { type?: string | null; retryAfterMs?: number | null; requestId?: string | null } = {},
): AiError {
  const type = options.type ?? '';
  const make = (code: AiErrorCode) =>
    new AiError(code, provider, status, options.retryAfterMs ?? null, options.requestId ?? null);
  if (status === 429 || type === 'rate_limit_error') return make('RATE_LIMITED');
  if (status === 529 || type === 'overloaded_error') return make('OVERLOADED');
  if (
    status === 401 ||
    status === 403 ||
    type === 'authentication_error' ||
    type === 'permission_error'
  )
    return make('AUTH');
  if (status === 404 || type === 'not_found_error') return make('MODEL_UNAVAILABLE');
  if (status === 408 || status === 504) return make('TIMEOUT');
  if (status >= 500) return make('SERVER_ERROR');
  return make('BAD_REQUEST');
}

/** Normalises anything an SDK or `fetch` throws. */
export function normalizeAiError(provider: ProviderId, error: unknown): AiError {
  if (error instanceof AiError) return error;
  const e = error as {
    status?: unknown;
    name?: string;
    headers?: Headers | Record<string, string> | null;
    error?: { type?: string; error?: { type?: string } };
    requestID?: string | null;
    request_id?: string | null;
  } | null;
  if (e !== null && typeof e === 'object') {
    if (e.name === 'TimeoutError' || e.name === 'APIConnectionTimeoutError')
      return new AiError('TIMEOUT', provider);
    if (e.name === 'AbortError' || e.name === 'APIUserAbortError')
      return new AiError('TIMEOUT', provider);
    if (typeof e.status === 'number') {
      let retryAfter: string | null = null;
      if (e.headers instanceof Headers) retryAfter = e.headers.get('retry-after');
      else if (e.headers !== null && e.headers !== undefined)
        retryAfter = e.headers['retry-after'] ?? null;
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      return aiErrorFromHttp(provider, e.status, {
        type: e.error?.error?.type ?? e.error?.type ?? null,
        retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : null,
        requestId: e.requestID ?? e.request_id ?? null,
      });
    }
    if (e.name === 'APIConnectionError' || error instanceof TypeError)
      return new AiError('NETWORK', provider);
  }
  return new AiError('SERVER_ERROR', provider);
}

/** `ai_requests.status` for a failed attempt. */
export function telemetryStatus(
  error: AiError,
): 'error' | 'refused' | 'timeout' | 'budget_blocked' | 'killed' | 'validation_failed' {
  switch (error.code) {
    case 'TIMEOUT':
      return 'timeout';
    case 'REFUSAL':
      return 'refused';
    case 'BUDGET_EXHAUSTED':
      return 'budget_blocked';
    case 'KILL_SWITCH':
      return 'killed';
    case 'SCHEMA_VALIDATION':
    case 'OUTPUT_REJECTED':
    case 'MAX_TOKENS':
      return 'validation_failed';
    default:
      return 'error';
  }
}

/** The API error an interactive route returns when AI cannot serve it (§2.6). */
export function aiErrorToAppError(error: AiError, feature: string): AppError {
  const map: Partial<Record<AiErrorCode, ErrorCodeValue>> = {
    SCHEMA_VALIDATION: 'AI_OUTPUT_INVALID',
    OUTPUT_REJECTED: 'AI_OUTPUT_INVALID',
    MAX_TOKENS: 'AI_OUTPUT_INVALID',
    KILL_SWITCH: 'FEATURE_DISABLED',
    NOT_CONFIGURED: 'FEATURE_DISABLED',
    BUDGET_EXHAUSTED: 'QUOTA_EXCEEDED',
    CREDENTIAL_MISSING: 'EXTERNAL_CREDENTIAL_REQUIRED',
    TIMEOUT: 'UPSTREAM_TIMEOUT',
  };
  return new AppError(map[error.code] ?? 'AI_UNAVAILABLE', { details: { feature }, cause: error });
}
