import { assert, assertEquals, assertFalse } from '@std/assert';
import { forbiddenFetch, stubFetch } from '../testing/fetch.ts';
import { createSentry, parseDsn } from './sentry.ts';

Deno.test('without a DSN the adapter is a no-op and never calls fetch', async () => {
  const sentry = createSentry({
    dsn: undefined,
    environment: 'development',
    fetch: forbiddenFetch(),
  });
  assertFalse(sentry.enabled);
  await sentry.captureException(new Error('x'), { fn: 'api' });
});

Deno.test('DSN parsing builds the envelope endpoint', () => {
  assertEquals(
    parseDsn('https://pubkey@o1.ingest.sentry.io/42')?.envelopeUrl,
    'https://o1.ingest.sentry.io/api/42/envelope/',
  );
  assertEquals(parseDsn('http://pubkey@host/1'), null);
  assertEquals(parseDsn('not a dsn'), null);
});

Deno.test('captured exceptions are posted as a scrubbed envelope with tags only', async () => {
  const stub = stubFetch(() => new Response(null, { status: 200 }));
  const sentry = createSentry({
    dsn: 'https://pubkey@o1.ingest.sentry.io/42',
    environment: 'production',
    fetch: stub.fetch,
  });
  await sentry.captureException(new Error('failed for yunus@gmail.com with Bearer abc.def.ghi'), {
    fn: 'worker',
    correlationId: 'corr-1',
    code: 'INTERNAL_ERROR',
  });
  assertEquals(stub.calls.length, 1);
  const call = stub.calls[0];
  assert(call !== undefined);
  assertEquals(call.url, 'https://o1.ingest.sentry.io/api/42/envelope/');
  assert((call.headers.get('X-Sentry-Auth') ?? '').includes('sentry_key=pubkey'));
  const [header, item, event] = (call.body ?? '').split('\n').map((l) => JSON.parse(l));
  assertEquals(item.type, 'event');
  assertEquals(header.event_id, event.event_id);
  assertEquals(event.tags, { fn: 'worker', correlation_id: 'corr-1', code: 'INTERNAL_ERROR' });
  assertFalse((call.body ?? '').includes('yunus@gmail.com'));
  assertFalse((call.body ?? '').includes('abc.def.ghi'));
});

Deno.test('a failing Sentry endpoint never throws', async () => {
  const stub = stubFetch(() => {
    throw new TypeError('network down');
  });
  const sentry = createSentry({
    dsn: 'https://pubkey@o1.ingest.sentry.io/42',
    environment: 'production',
    fetch: stub.fetch,
  });
  await sentry.captureException(new Error('x'), { fn: 'api' });
});
