import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeJwks,
  formatSummary,
  mintHs256,
  parseArgs,
  parseStatusEnv,
  redactSecrets,
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

test('Auth diagnostics mask tokens and keys; JWKS keys are listed as alg/kid', () => {
  const token = mintHs256({ sub: 'u1' }, 's'.repeat(40));
  assert.equal(
    redactSecrets(`{"msg":"bad ${token}","k":"sb_secret_N7UND0Ug-x_1","p":"sb_publishable_AbC"}`),
    '{"msg":"bad <jwt>","k":"sb_secret_<redacted>","p":"sb_publishable_<redacted>"}',
  );
  assert.equal(
    redactSecrets('HTTP 403 {"error_code":"bad_jwt"}'),
    'HTTP 403 {"error_code":"bad_jwt"}',
  );
  assert.deepEqual(
    describeJwks({ keys: [{ kty: 'EC', alg: 'ES256', kid: 'k1', x: 'x' }, { kty: 'RSA' }] }),
    ['ES256/k1', 'RSA'],
  );
  assert.deepEqual(describeJwks({}), []);
  assert.deepEqual(describeJwks(null), []);
});

/** The former JWT mask, kept as the oracle for the differential test below. */
const ORIGINAL_JWT = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

test('redactSecrets masks exactly what the former JWT regex masked (seeded random inputs)', () => {
  let seed = 7;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const tokens = ['eyJ', 'ey', 'J', '.', '..', 'a', 'Zz9', '_', '-', ' ', '"', 'sb', '<', 'x.y'];
  for (let i = 0; i < 3000; i++) {
    let input = '';
    const len = 1 + Math.floor(next() * 24);
    for (let k = 0; k < len; k++) input += tokens[Math.floor(next() * tokens.length)] ?? '';
    assert.equal(redactSecrets(input), input.replace(ORIGINAL_JWT, '<jwt>'), JSON.stringify(input));
  }
});

/**
 * Growth-rate check (packages/domain/test/security/codeql-remediation.test.ts): thread CPU time,
 * best of three at n / 4 and at n taken in turn; a linear scan grows about 4×, the former regex
 * quadratically on `eyJ` runs without dots. A run under 100 ms passes outright.
 */
function assertLinear(run: (n: number) => void, n = 50_000): void {
  const timed = (size: number): number => {
    const start = process.threadCpuUsage();
    run(size);
    const used = process.threadCpuUsage(start);
    return (used.user + used.system) / 1000;
  };
  let small = Infinity;
  let large = Infinity;
  for (let i = 0; i < 3; i++) {
    small = Math.min(small, timed(n / 4));
    large = Math.min(large, timed(n));
  }
  assert.ok(
    large < 100 || large < 8 * Math.max(small, 1),
    `${large.toFixed(1)} ms at n vs ${small.toFixed(1)} ms at n / 4`,
  );
}

test('CodeQL js/polynomial-redos: redactSecrets is linear on crafted error bodies', () => {
  assertLinear((n) => {
    const text = 'eyJ'.repeat(n);
    assert.equal(redactSecrets(text), text);
  });
  assertLinear((n) => {
    const text = `${'eyJ'.repeat(n)}.`;
    assert.equal(redactSecrets(text), text);
  });
  assertLinear((n) => {
    const text = 'eyJa..'.repeat(n);
    assert.equal(redactSecrets(text), text);
  });
  assertLinear((n) => {
    assert.equal(redactSecrets('sb_secret_'.repeat(n)).endsWith('<redacted>'), true);
  });
});
