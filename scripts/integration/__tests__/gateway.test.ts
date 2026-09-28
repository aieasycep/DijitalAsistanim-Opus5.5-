/**
 * CodeQL js/user-controlled-bypass at gateway.ts:96 (security-nightly, TST-CI-08): the tier-C+
 * `GET /auth/v1/user` stand-in verifies every request's token and decides only on the verified
 * claims, never on whether a raw `Authorization` header is present.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authUserReply } from '../gateway.ts';
import { mintHs256 } from '../lib.ts';

const SECRET = 'g'.repeat(40);
const DENIED = { status: 403, body: { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' } };

test('CodeQL js/user-controlled-bypass: a verified token yields its user', () => {
  const token = mintHs256(
    { sub: 'u-1', role: 'authenticated', email: 'a@b.co', exp: 4_000_000_000 },
    SECRET,
  );
  const reply = authUserReply(`Bearer ${token}`, SECRET);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, {
    id: 'u-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'a@b.co',
    app_metadata: {},
    user_metadata: {},
    is_anonymous: false,
    created_at: new Date(0).toISOString(),
  });
});

test('missing, malformed, forged, expired and subject-less tokens are all refused', () => {
  const other = mintHs256({ sub: 'u-1', exp: 4_000_000_000 }, 'x'.repeat(40));
  const expired = mintHs256({ sub: 'u-1', exp: 10 }, SECRET);
  const noSub = mintHs256({ role: 'service_role', exp: 4_000_000_000 }, SECRET);
  for (const header of [
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic abc',
    `Bearer ${other}`,
    `Bearer ${expired}`,
    `Bearer ${noSub}`,
    'Bearer a.b.c',
  ]) {
    assert.deepEqual(authUserReply(header, SECRET), DENIED, String(header));
  }
});
