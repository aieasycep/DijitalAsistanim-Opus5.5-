/**
 * Typed API errors (API_CONTRACTS §2.4–§2.6). Every failure of the Edge `api` client surfaces as an
 * `ApiError`: server envelopes keep their code, `message_key`, `retryable`, `details` and
 * `field_errors`; transport failures (offline, network, timeout, unparseable responses) get the
 * closest catalogue code plus a `kind` so callers can tell them apart. Caller aborts are not
 * converted: the original `AbortError` propagates, as fetch and TanStack Query expect.
 */
import {
  ERROR_CODE_VALUES,
  ERROR_HTTP_STATUS,
  ERROR_RETRYABLE,
  ErrorBody,
  errorMessageKey,
  type ErrorCodeValue,
  type FieldError,
} from '@da/validation/errors';

/** Where the error came from. `server` = a parsed error envelope. */
export type ApiErrorKind =
  'server' | 'http' | 'offline' | 'network' | 'timeout' | 'invalid_request' | 'invalid_response';

export interface ApiErrorInit {
  readonly code: ErrorCodeValue;
  readonly kind: ApiErrorKind;
  /** HTTP status, or `null` when no response was received. */
  readonly status: number | null;
  readonly message?: string;
  readonly messageKey?: string;
  readonly retryable?: boolean;
  readonly correlationId?: string | null;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly fieldErrors?: readonly FieldError[];
  /** `Retry-After` in milliseconds when the server sent one. */
  readonly retryAfterMs?: number | null;
  readonly cause?: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCodeValue;
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** i18n key (`errors.<code_lower>`); screens resolve copy from it, never from `message`. */
  readonly messageKey: string;
  readonly retryable: boolean;
  readonly correlationId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly fieldErrors: readonly FieldError[];
  readonly retryAfterMs: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message ?? init.code, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = init.code;
    this.kind = init.kind;
    this.status = init.status;
    this.messageKey = init.messageKey ?? errorMessageKey(init.code);
    this.retryable = init.retryable ?? ERROR_RETRYABLE[init.code];
    this.correlationId = init.correlationId ?? null;
    this.details = init.details ?? {};
    this.fieldErrors = init.fieldErrors ?? [];
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** True for an `AbortError` raised because the caller cancelled (not a timeout). */
export function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'name' in value && value.name === 'AbortError'
  );
}

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODE_VALUES);

/** The catalogue code for an HTTP status without a parseable envelope (gateway errors). */
export function codeForStatus(status: number): ErrorCodeValue {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'AUTH_REQUIRED';
    case 402:
      return 'ENTITLEMENT_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 409:
      return 'STATE_CONFLICT';
    case 410:
      return 'SOURCE_GONE';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 422:
      return 'VALIDATION_FAILED';
    case 426:
      return 'CLIENT_UPGRADE_REQUIRED';
    case 429:
      return 'RATE_LIMITED';
    case 502:
      return 'PROVIDER_UNAVAILABLE';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    case 504:
      return 'UPSTREAM_TIMEOUT';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

/** `Retry-After` as seconds or an HTTP date, in milliseconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export interface ResponseMeta {
  readonly status: number;
  readonly correlationId: string | null;
  readonly retryAfterMs: number | null;
}

/**
 * Maps a non-2xx response body to an `ApiError`: the standard envelope when it parses (the code
 * must be a known catalogue code), otherwise the status mapping of `codeForStatus`.
 */
export function apiErrorFromBody(body: unknown, meta: ResponseMeta): ApiError {
  const parsed = ErrorBody.safeParse(body);
  if (parsed.success && KNOWN_CODES.has(parsed.data.error.code)) {
    const e = parsed.data.error;
    return new ApiError({
      code: e.code,
      kind: 'server',
      status: meta.status,
      message: e.message,
      messageKey: e.message_key,
      retryable: e.retryable,
      correlationId: e.correlation_id,
      ...(e.details === undefined ? {} : { details: e.details }),
      ...(e.field_errors === undefined ? {} : { fieldErrors: e.field_errors }),
      retryAfterMs: meta.retryAfterMs,
    });
  }
  const code = codeForStatus(meta.status);
  return new ApiError({
    code,
    kind: 'http',
    status: meta.status,
    correlationId: meta.correlationId,
    retryAfterMs: meta.retryAfterMs,
  });
}

/** `OFFLINE_BLOCKED`: synthesized before any network call (API_CONTRACTS §2.16). */
export function offlineError(): ApiError {
  return new ApiError({
    code: 'OFFLINE_BLOCKED',
    kind: 'offline',
    status: ERROR_HTTP_STATUS.OFFLINE_BLOCKED,
  });
}
