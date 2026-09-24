import { assert, assertEquals } from '@std/assert';
import { ERROR_CODE_VALUES, errorEnvelopeSchema, ERROR_HTTP_STATUS } from '@da/validation';
import { z } from 'zod';
import {
  AppError,
  localizedMessage,
  mapDbError,
  normalizeError,
  resolveLocale,
  toErrorBody,
  validationError,
} from './errors.ts';

Deno.test('every server error code renders an envelope that matches @da/validation', () => {
  for (const code of ERROR_CODE_VALUES) {
    if (ERROR_HTTP_STATUS[code] === null) continue;
    const error = new AppError(code, { details: { feature: 'x' } });
    for (const locale of ['tr-TR', 'en-US'] as const) {
      const body = toErrorBody(error, 'corr-abcdefgh', locale);
      const parsed = errorEnvelopeSchema.safeParse(body);
      assert(parsed.success, `${code}: ${JSON.stringify(parsed.error?.issues)}`);
      assertEquals(body.error.message_key, `errors.${code.toLowerCase()}`);
      assert(body.error.message.length > 0);
      assertEquals(body.error.correlation_id, 'corr-abcdefgh');
    }
    assertEquals(error.status, ERROR_HTTP_STATUS[code]);
  }
});

Deno.test('messages follow Accept-Language (tr default, en on request)', () => {
  assertEquals(resolveLocale(null), 'tr-TR');
  assertEquals(resolveLocale('en-US,en;q=0.9'), 'en-US');
  assertEquals(resolveLocale('tr-TR'), 'tr-TR');
  assert(localizedMessage('NOT_FOUND', 'tr-TR') !== localizedMessage('NOT_FOUND', 'en-US'));
});

Deno.test('zod failures become VALIDATION_FAILED with prefixed field errors', () => {
  const schema = z.strictObject({ a: z.string().min(3) });
  const result = schema.safeParse({ a: 'x' });
  assert(!result.success);
  const error = validationError(result.error, 'query');
  assertEquals(error.code, 'VALIDATION_FAILED');
  assertEquals(error.status, 422);
  assertEquals(error.fieldErrors?.[0]?.path, 'query.a');
  assertEquals(error.fieldErrors?.[0]?.message_key, 'validation.too_small');
});

Deno.test('database errors map to API codes without leaking SQL', () => {
  assertEquals(mapDbError({ code: 'P0002', message: 'no rows' }).code, 'NOT_FOUND');
  assertEquals(mapDbError({ code: '23505', message: 'duplicate key' }).code, 'STATE_CONFLICT');
  const ent = mapDbError({ code: 'P0001', message: 'ENTITLEMENT_REQUIRED:capture' });
  assertEquals(ent.code, 'ENTITLEMENT_REQUIRED');
  assertEquals(ent.details, { feature: 'capture' });
  assertEquals(mapDbError({ code: 'P0001', message: 'PLAN_LIMIT:max_mail_accounts' }).details, {
    limit_key: 'max_mail_accounts',
  });
  assertEquals(
    mapDbError({ code: '42501', message: 'permission denied for table x' }).code,
    'FORBIDDEN',
  );
  assertEquals(mapDbError({ message: 'fetch failed' }).code, 'SERVICE_UNAVAILABLE');
  const body = toErrorBody(
    mapDbError({ code: 'XX000', message: 'select * from secrets' }),
    'c-12345678',
    'tr-TR',
  );
  assert(!JSON.stringify(body).includes('select'));
});

Deno.test('unknown throwables become INTERNAL_ERROR (retryable)', () => {
  const error = normalizeError(new TypeError('boom'));
  assertEquals(error.code, 'INTERNAL_ERROR');
  assertEquals(error.retryable, true);
});
