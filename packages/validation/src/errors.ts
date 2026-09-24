import { z } from 'zod';

/**
 * API error codes: the complete catalogue of docs/API_CONTRACTS.md §2.6 (HTTP mapping in §2.5).
 * `OFFLINE_BLOCKED` is synthesized client-side by `packages/api-client` and is never sent by a server.
 */
export const ERROR_CODE_VALUES = [
  'AUTH_REQUIRED',
  'REAUTH_REQUIRED',
  'AAL2_REQUIRED',
  'FORBIDDEN',
  'ACCOUNT_DISABLED',
  'ACCOUNT_DELETION_PENDING',
  'DATA_SOURCE_DISABLED',
  'OAUTH_COMPLETION_INVALID',
  'ENTITLEMENT_REQUIRED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'SOURCE_GONE',
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPLOAD_INVALID',
  'SSRF_BLOCKED',
  'FETCH_FAILED',
  'STATE_CONFLICT',
  'APPROVAL_STATE_CONFLICT',
  'APPROVAL_STALE',
  'IDEMPOTENCY_REPLAY',
  'PROVIDER_REAUTH_REQUIRED',
  'PROVIDER_SCOPE_MISSING',
  'PROVIDER_ADMIN_CONSENT_REQUIRED',
  'PROVIDER_REJECTED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'EXTERNAL_CREDENTIAL_REQUIRED',
  'AI_UNAVAILABLE',
  'AI_OUTPUT_INVALID',
  'FEATURE_DISABLED',
  'CLIENT_UPGRADE_REQUIRED',
  'REFERRAL_CODE_INVALID',
  'REFERRAL_SELF',
  'REFERRAL_ALREADY_APPLIED',
  'REFERRAL_WINDOW_CLOSED',
  'OTP_INVALID',
  'OTP_LOCKED',
  'WEBHOOK_SIGNATURE_INVALID',
  'METHOD_NOT_ALLOWED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'OFFLINE_BLOCKED',
] as const;
export type ErrorCodeValue = (typeof ERROR_CODE_VALUES)[number];
export const ErrorCode = z.enum(ERROR_CODE_VALUES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** HTTP status per code (§2.5). `null` = never sent by a server (client-only). */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCodeValue, number | null>> = {
  AUTH_REQUIRED: 401,
  REAUTH_REQUIRED: 401,
  AAL2_REQUIRED: 401,
  FORBIDDEN: 403,
  ACCOUNT_DISABLED: 403,
  ACCOUNT_DELETION_PENDING: 403,
  DATA_SOURCE_DISABLED: 403,
  OAUTH_COMPLETION_INVALID: 403,
  ENTITLEMENT_REQUIRED: 402,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  SOURCE_GONE: 410,
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UPLOAD_INVALID: 422,
  SSRF_BLOCKED: 422,
  FETCH_FAILED: 424,
  STATE_CONFLICT: 409,
  APPROVAL_STATE_CONFLICT: 409,
  APPROVAL_STALE: 409,
  IDEMPOTENCY_REPLAY: 409,
  PROVIDER_REAUTH_REQUIRED: 424,
  PROVIDER_SCOPE_MISSING: 424,
  PROVIDER_ADMIN_CONSENT_REQUIRED: 424,
  PROVIDER_REJECTED: 422,
  PROVIDER_RATE_LIMITED: 503,
  PROVIDER_UNAVAILABLE: 502,
  UPSTREAM_TIMEOUT: 504,
  EXTERNAL_CREDENTIAL_REQUIRED: 503,
  AI_UNAVAILABLE: 503,
  AI_OUTPUT_INVALID: 502,
  FEATURE_DISABLED: 503,
  CLIENT_UPGRADE_REQUIRED: 426,
  REFERRAL_CODE_INVALID: 404,
  REFERRAL_SELF: 422,
  REFERRAL_ALREADY_APPLIED: 409,
  REFERRAL_WINDOW_CLOSED: 409,
  OTP_INVALID: 422,
  OTP_LOCKED: 429,
  WEBHOOK_SIGNATURE_INVALID: 401,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  OFFLINE_BLOCKED: null,
};

/**
 * Default `retryable` flag per code (§2.6 "Retryable" column). Codes whose retryability depends on
 * details (`IDEMPOTENCY_REPLAY` with `reason='in_progress'`, `QUOTA_EXCEEDED` after `resets_at`,
 * `OTP_LOCKED` after the lock) default to `false`; the server sets the flag per response.
 */
export const ERROR_RETRYABLE: Readonly<Record<ErrorCodeValue, boolean>> = {
  AUTH_REQUIRED: false,
  REAUTH_REQUIRED: false,
  AAL2_REQUIRED: false,
  FORBIDDEN: false,
  ACCOUNT_DISABLED: false,
  ACCOUNT_DELETION_PENDING: false,
  DATA_SOURCE_DISABLED: false,
  OAUTH_COMPLETION_INVALID: false,
  ENTITLEMENT_REQUIRED: false,
  QUOTA_EXCEEDED: false,
  RATE_LIMITED: true,
  NOT_FOUND: false,
  SOURCE_GONE: false,
  BAD_REQUEST: false,
  VALIDATION_FAILED: false,
  PAYLOAD_TOO_LARGE: false,
  UNSUPPORTED_MEDIA_TYPE: false,
  UPLOAD_INVALID: false,
  SSRF_BLOCKED: false,
  FETCH_FAILED: true,
  STATE_CONFLICT: false,
  APPROVAL_STATE_CONFLICT: false,
  APPROVAL_STALE: false,
  IDEMPOTENCY_REPLAY: false,
  PROVIDER_REAUTH_REQUIRED: false,
  PROVIDER_SCOPE_MISSING: false,
  PROVIDER_ADMIN_CONSENT_REQUIRED: false,
  PROVIDER_REJECTED: false,
  PROVIDER_RATE_LIMITED: true,
  PROVIDER_UNAVAILABLE: true,
  UPSTREAM_TIMEOUT: true,
  EXTERNAL_CREDENTIAL_REQUIRED: false,
  AI_UNAVAILABLE: true,
  AI_OUTPUT_INVALID: true,
  FEATURE_DISABLED: false,
  CLIENT_UPGRADE_REQUIRED: false,
  REFERRAL_CODE_INVALID: false,
  REFERRAL_SELF: false,
  REFERRAL_ALREADY_APPLIED: false,
  REFERRAL_WINDOW_CLOSED: false,
  OTP_INVALID: false,
  OTP_LOCKED: false,
  WEBHOOK_SIGNATURE_INVALID: false,
  METHOD_NOT_ALLOWED: false,
  INTERNAL_ERROR: true,
  SERVICE_UNAVAILABLE: true,
  OFFLINE_BLOCKED: false,
};

/** i18n key of a code: `errors.<code_lower>` (§2.6). */
export function errorMessageKey(code: ErrorCodeValue): `errors.${Lowercase<ErrorCodeValue>}` {
  return `errors.${code.toLowerCase() as Lowercase<ErrorCodeValue>}`;
}

/** One zod issue rendered for the client (§2.4). `path` is dotted, e.g. `payload.start.date_time`. */
export const FieldError = z.object({
  path: z.string(),
  code: z.string(),
  message_key: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type FieldError = z.infer<typeof FieldError>;

/** The `error` member of the envelope; also the payload of the assistant SSE `error` event. */
export const ErrorObject = z.object({
  code: ErrorCode,
  message: z.string(),
  message_key: z.string().regex(/^errors\.[a-z0-9_]+$/),
  retryable: z.boolean(),
  correlation_id: z.string().min(1).max(64),
  details: z.record(z.string(), z.unknown()).optional(),
  field_errors: z.array(FieldError).optional(),
});
export type ErrorObject = z.infer<typeof ErrorObject>;

/**
 * Standard error envelope (§2.4 `ErrorBody`):
 * `{error:{code, message, message_key, retryable, correlation_id, details?, field_errors?}}`.
 */
export const ErrorBody = z.object({ error: ErrorObject });
export type ErrorBody = z.infer<typeof ErrorBody>;

/** Alias kept for callers that name the envelope explicitly. */
export const errorEnvelopeSchema = ErrorBody;
export type ErrorEnvelope = ErrorBody;

/** Converts zod issues into `field_errors[]` with `validation.<issue code>` message keys. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message_key: `validation.${issue.code}`,
  }));
}
