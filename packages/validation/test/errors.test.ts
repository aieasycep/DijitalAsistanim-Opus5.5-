import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ERROR_CODE_VALUES,
  ERROR_HTTP_STATUS,
  ERROR_RETRYABLE,
  ErrorBody,
  errorEnvelopeSchema,
  errorMessageKey,
  toFieldErrors,
} from '../src/errors.ts';

const envelope = {
  error: {
    code: 'NOT_FOUND',
    message: 'Bulunamadı.',
    message_key: 'errors.not_found',
    retryable: false,
    correlation_id: 'corr-12345678',
  },
};

describe('error envelope (API_CONTRACTS §2.4)', () => {
  it.each([
    ['minimal', envelope],
    [
      'with details and field errors',
      {
        error: {
          ...envelope.error,
          code: 'VALIDATION_FAILED',
          message_key: 'errors.validation_failed',
          details: { reason: 'x' },
          field_errors: [
            {
              path: 'payload.title',
              code: 'too_big',
              message_key: 'validation.too_big',
              params: { max: 300 },
            },
          ],
        },
      },
    ],
  ])('accepts %s', (_name, value) => {
    expect(ErrorBody.safeParse(value).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['unknown code', { error: { ...envelope.error, code: 'NOPE' } }],
    ['missing correlation id', { error: { ...envelope.error, correlation_id: undefined } }],
    ['missing retryable', { error: { ...envelope.error, retryable: undefined } }],
    ['message key outside errors.*', { error: { ...envelope.error, message_key: 'not_found' } }],
    ['no error member', { code: 'NOT_FOUND' }],
  ])('rejects %s', (_name, value) => {
    expect(ErrorBody.safeParse(value).success).toBe(false);
  });
});

describe('error catalogue (§2.5, §2.6)', () => {
  it('maps every code to an HTTP status and a retryable default', () => {
    for (const code of ERROR_CODE_VALUES) {
      expect(code in ERROR_HTTP_STATUS).toBe(true);
      expect(typeof ERROR_RETRYABLE[code]).toBe('boolean');
    }
    expect(ERROR_HTTP_STATUS.OFFLINE_BLOCKED).toBeNull();
    expect(ERROR_HTTP_STATUS.OAUTH_COMPLETION_INVALID).toBe(403);
    expect(ERROR_HTTP_STATUS.PROVIDER_SCOPE_MISSING).toBe(424);
    expect(ERROR_HTTP_STATUS.CLIENT_UPGRADE_REQUIRED).toBe(426);
    expect(ERROR_RETRYABLE.AI_UNAVAILABLE).toBe(true);
    expect(ERROR_RETRYABLE.ENTITLEMENT_REQUIRED).toBe(false);
  });

  it('derives errors.<code_lower> message keys', () => {
    expect(errorMessageKey('PROVIDER_REAUTH_REQUIRED')).toBe('errors.provider_reauth_required');
  });

  it('renders zod issues as field errors', () => {
    const result = z.strictObject({ title: z.string().max(3) }).safeParse({ title: 'uzun başlık' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toEqual([
        { path: 'title', code: 'too_big', message_key: 'validation.too_big' },
      ]);
    }
  });
});
