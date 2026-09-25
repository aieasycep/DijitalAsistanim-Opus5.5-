import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSummary,
  mintHs256,
  parseArgs,
  parseStatusEnv,
  roleKey,
  summarizeDenoOutput,
  verifyHs256,
} from '../lib.ts';

test('HS256 tokens round-trip; a wrong secret, a tampered payload or an expired token fail', () => {
  const secret = 's'.repeat(40);
  const token = mintHs256({ sub: 'u1', role: 'authenticated', exp: 4_000_000_000 }, secret);
  assert.deepEqual(verifyHs256(token, secret), {
    sub: 'u1',
    role: 'authenticated',
    exp: 4_000_000_000,
  });
  assert.equal(verifyHs256(token, 'x'.repeat(40)), null);
  const [h, , sig] = token.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'u2' })).toString('base64url')}.${sig}`;
  assert.equal(verifyHs256(forged, secret), null);
  const expired = mintHs256({ sub: 'u1', exp: 10 }, secret);
  assert.equal(verifyHs256(expired, secret, 11), null);
  assert.equal(verifyHs256('not.a.jwt.at.all', secret), null);
});

test('role keys carry the PostgREST role claim', () => {
  const secret = 'k'.repeat(40);
  const claims = verifyHs256(
    roleKey('service_role', secret, 'http://127.0.0.1:54331/auth/v1'),
    secret,
  );
  assert.ok(claims !== null);
  assert.equal(claims.role, 'service_role');
  assert.equal(claims.iss, 'http://127.0.0.1:54331/auth/v1');
});

test('arguments: tier, filter, reuse and suite files', () => {
  assert.deepEqual(
    parseArgs(['--tier', 'c', '--filter', '/IT-OAUTH/', '--reuse-db', 'x.test.ts']),
    {
      tier: 'c',
      filter: '/IT-OAUTH/',
      reuseDb: true,
      noReset: false,
      suites: ['x.test.ts'],
    },
  );
  assert.equal(parseArgs([]).tier, 'a');
  assert.throws(() => parseArgs(['--tier', 'b']));
  assert.throws(() => parseArgs(['--nope']));
});

test('supabase status env parsing strips quotes', () => {
  const env = parseStatusEnv('API_URL="http://127.0.0.1:54321"\nJWT_SECRET="abc"\nnoise\n');
  assert.equal(env.get('API_URL'), 'http://127.0.0.1:54321');
  assert.equal(env.get('JWT_SECRET'), 'abc');
  assert.equal(env.size, 2);
});

test('per-suite counts from the deno test reporter; steps and colours ignored', () => {
  const output = [
    'running 3 tests from ./supabase/tests/integration/oauth.test.ts',
    'IT-OAUTH-01 connect ... ok (1s)',
    'IT-OAUTH-02 state ... \u001b[31mFAILED\u001b[0m (2s)',
    '  nested step ... ok (1ms)',
    'IT-OAUTH-14 x [needs:gotrue] ... ignored (0ms)',
    'running 1 test from ./supabase/tests/integration/jobs.test.ts',
    'IT-JOB-01 claims ... ok (4s)',
  ].join('\n');
  const suites = summarizeDenoOutput(output);
  assert.deepEqual(suites.get('supabase/tests/integration/oauth.test.ts'), {
    passed: 1,
    failed: 1,
    ignored: 1,
  });
  assert.deepEqual(suites.get('supabase/tests/integration/jobs.test.ts'), {
    passed: 1,
    failed: 0,
    ignored: 0,
  });
  const table = formatSummary(suites);
  assert.match(table, /total\s+2\s+1\s+1/);
});
