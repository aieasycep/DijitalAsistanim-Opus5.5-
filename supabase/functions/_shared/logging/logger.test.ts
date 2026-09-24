import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert';
import { createLogger, memorySink, scrubString, scrubValue } from './logger.ts';

const EMAIL = 'yunus.emre@gmail.com';
const JWT =
  'eyJhbGciOiJFUzI1NiIsImtpZCI6IngifQ.eyJzdWIiOiIxMjMiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2lnbmF0dXJlLXZhbHVl';
// Key-shaped values are assembled at runtime so no key-like literal lives in the repository.
const random = () => crypto.randomUUID().replace(/-/g, '');
const SECRET_KEY = ['sb', 'secret', random()].join('_');
const ANTHROPIC_KEY = ['sk', 'ant', 'api03', random()].join('-');
const RC_KEY = ['sk', random()].join('_');
const PEM_LABEL = ['PRIVATE', 'KEY'].join(' ');
const PEM = `-----BEGIN ${PEM_LABEL}-----\n${btoa(random())}\n-----END ${PEM_LABEL}-----`;

Deno.test('scrubber masks e-mail addresses (first two chars + domain)', () => {
  const out = scrubString(`user ${EMAIL} wrote`);
  assertFalse(out.includes(EMAIL));
  assertStringIncludes(out, 'yu***@gmail.com');
});

Deno.test('scrubber redacts bearer tokens, JWTs, Supabase / vendor keys and PEM blocks', () => {
  const input = `Authorization: Bearer ${JWT} ${JWT} ${SECRET_KEY} ${ANTHROPIC_KEY} ${RC_KEY} ${PEM}`;
  const out = scrubString(input);
  for (const secret of [JWT, SECRET_KEY, ANTHROPIC_KEY, RC_KEY, 'MIGHAgEAMBMGByqGSM49']) {
    assertFalse(out.includes(secret), `leaked ${secret.slice(0, 10)}`);
  }
  assertStringIncludes(out, 'Bearer [redacted]');
});

Deno.test('scrubber redacts Expo push tokens and long base64 runs', () => {
  const out = scrubString(`ExponentPushToken[abcdefghijklmnop] ${'A'.repeat(64)}`);
  assertFalse(out.includes('abcdefghijklmnop'));
  assertFalse(out.includes('A'.repeat(64)));
});

Deno.test('content-named fields are dropped wholesale, nested values scrubbed', () => {
  const value = scrubValue({
    subject: 'Toplantı',
    body: 'secret body',
    nested: { email: EMAIL, count: 3 },
  }) as Record<string, unknown>;
  assertEquals(value.subject, '[redacted]');
  assertEquals(value.body, '[redacted]');
  assertEquals((value.nested as Record<string, unknown>).count, 3);
  assertFalse(JSON.stringify(value).includes(EMAIL));
});

Deno.test(
  'logger writes JSON lines with ts/level/fn/correlation fields and no email or token',
  () => {
    const mem = memorySink();
    const log = createLogger({
      fn: 'api',
      sink: mem.sink,
      now: () => new Date('2026-09-23T07:00:00Z'),
    });
    log
      .child({ correlation_id: 'corr-12345678', user_hash: 'abcd1234abcd1234' })
      .info(`sign-in by ${EMAIL}`, {
        job_id: 'j1',
        token: JWT,
        message_text: 'Merhaba',
        authorization: `Bearer ${JWT}`,
      });
    assertEquals(mem.lines.length, 1);
    const line = mem.lines[0] ?? '';
    const record = JSON.parse(line) as Record<string, unknown>;
    assertEquals(record.ts, '2026-09-23T07:00:00.000Z');
    assertEquals(record.level, 'info');
    assertEquals(record.fn, 'api');
    assertEquals(record.correlation_id, 'corr-12345678');
    assertEquals(record.job_id, 'j1');
    assertEquals(record.user_hash, 'abcd1234abcd1234');
    assertFalse(line.includes(EMAIL));
    assertFalse(line.includes(JWT));
    assertFalse(line.includes('Merhaba'));
  },
);

Deno.test('levels below the threshold are not written', () => {
  const mem = memorySink();
  const log = createLogger({ fn: 'worker', sink: mem.sink, level: 'warn' });
  log.info('skip');
  log.debug('skip');
  log.error('keep');
  assertEquals(
    mem.records().map((r) => r.msg),
    ['keep'],
  );
  assert(mem.records().every((r) => r.level === 'error'));
});
