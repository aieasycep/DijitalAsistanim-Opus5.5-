import { z } from 'zod';

/** API error codes (docs/API_CONTRACTS.md error catalogue). */
export const ERROR_CODE_VALUES = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'ENTITLEMENT_REQUIRED',
  'EXTERNAL_CREDENTIAL_REQUIRED',
  'PROVIDER_REAUTH_REQUIRED',
  'PROVIDER_SCOPE_MISSING',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'VALIDATION_FAILED',
  'APPROVAL_STATE_CONFLICT',
  'IDEMPOTENCY_REPLAY',
  'NOT_FOUND',
  'AI_UNAVAILABLE',
  'OFFLINE_BLOCKED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

/** Standard error envelope `{error:{code, message_key, details?, correlation_id}}`. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODE_VALUES),
    message_key: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    correlation_id: z.string().min(1),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
