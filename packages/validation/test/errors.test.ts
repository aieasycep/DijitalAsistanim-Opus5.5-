import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../src/errors.ts';

describe('error envelope', () => {
  it('accepts a well-formed envelope', () => {
    const ok = errorEnvelopeSchema.safeParse({
      error: { code: 'NOT_FOUND', message_key: 'errors.not_found', correlation_id: 'c-1' },
    });
    expect(ok.success).toBe(true);
  });
  it('rejects unknown codes and missing correlation ids', () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: 'NOPE', message_key: 'x', correlation_id: 'c' },
      }).success,
    ).toBe(false);
    expect(
      errorEnvelopeSchema.safeParse({ error: { code: 'NOT_FOUND', message_key: 'x' } }).success,
    ).toBe(false);
  });
});
