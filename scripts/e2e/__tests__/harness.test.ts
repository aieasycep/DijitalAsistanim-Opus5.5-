import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  DEFAULT_ANCHOR,
  assertSafeEnv,
  canonExpect,
  canonIds,
  demoId,
  emailFor,
  trCatalog,
} from '../harness-server.ts';
import { PROBES } from '../probes.ts';

test('the harness refuses anything but a local / CI stack on loopback', () => {
  const ok = { APP_ENV: 'e2e', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'k' };
  assert.deepEqual(assertSafeEnv(ok), { staging: false });
  assert.throws(() => assertSafeEnv({ ...ok, APP_ENV: 'production' }), /APP_ENV/);
  assert.throws(() => assertSafeEnv({ ...ok, SUPABASE_URL: 'https://x.supabase.co' }), /loopback/);
  assert.throws(() => assertSafeEnv({ ...ok, SUPABASE_SECRET_KEY: '' }), /SECRET_KEY/);
  assert.deepEqual(assertSafeEnv({ E2E_TARGET: 'staging' }), { staging: true });
});

test('demo ids equal the seed formula md5(da-demo:entity:slug)::uuid', () => {
  const hex = createHash('md5').update('da-demo:message:revize-teklif').digest('hex');
  assert.equal(demoId('message', 'revize-teklif').replace(/-/g, ''), hex);
  assert.match(
    canonIds().meetingEvent,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

test('user keys map to the demo canon or to e2e addresses (TEST_PLAN §12.3)', () => {
  assert.equal(emailFor('u_pro', 'r1'), 'demo@dijitalasistan.app');
  assert.equal(emailFor('u_free', 'r1'), 'demo-free@dijitalasistan.app');
  assert.equal(emailFor('u_new', 'r1'), 'new+r1@e2e.dijitalasistan.test');
  assert.equal(emailFor('u_mail_only', 'r1'), 'mailonly@e2e.dijitalasistan.test');
  assert.equal(emailFor('u_android_ni', 'r1'), 'androidni@e2e.dijitalasistan.test');
});

test('expected preset times come from @da/domain for the fixed anchor', async () => {
  const expect = await canonExpect(DEFAULT_ANCHOR);
  assert.equal(expect.anchorTime, '08:45');
  assert.equal(expect.deadlineTime, '17:00');
  assert.equal(expect.preset_before_30m, '16:30');
  assert.equal(expect.preset_before_1h, '16:00');
});

test('the catalog is served nested by namespace and the probes are read-only', () => {
  const t = trCatalog() as { reply?: { approveSend?: string } };
  assert.equal(t.reply?.approveSend, 'Göndermeyi Onayla');
  for (const [name, sql] of Object.entries(PROBES)) {
    assert.match(sql, /^select /, name);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i, name);
  }
});
