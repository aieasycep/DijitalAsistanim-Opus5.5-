/**
 * API-DEV-04 `POST /notifications/test` (T-6.07): a real test push through the pipeline to the
 * calling installation, refused with `409 STATE_CONFLICT {reason}` when it could not arrive, and
 * `EXTERNAL_CREDENTIAL_REQUIRED` without an Expo token. 3 per hour.
 */
import { assertEquals, assertExists } from '@std/assert';
import { UserTestPushResponse } from '@da/validation';
import { USER_A } from '../_shared/testing/jwt.ts';
import { call, createHarness, type Harness } from './testing.ts';

const INST_CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INST_ROW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function seed(h: Harness, withToken = true) {
  h.workflow.approvals.installations.set(INST_ROW, {
    id: INST_ROW,
    user_id: USER_A,
    installation_id: INST_CLIENT,
    platform: 'ios',
  });
  if (withToken) h.workflow.notifications.addTarget(USER_A, { installationRowId: INST_ROW });
}

function testPush(h: Harness, jwt: string, category = 'critical_email') {
  return call(h, 'POST', '/notifications/test', {
    jwt,
    key: crypto.randomUUID(),
    body: { installation_id: INST_CLIENT, category },
  });
}

Deno.test(
  'API-DEV-04 creates one scheduled test row and one notification job for the installation',
  async () => {
    const h = await createHarness({ capabilities: { push: true } });
    seed(h);
    const jwt = await h.token(USER_A);
    const res = await testPush(h, jwt);
    assertEquals(res.status, 202);
    const data = UserTestPushResponse.parse(await res.json()).data;
    assertEquals(data.deferred_until, null);
    const row = h.workflow.notifications.rows.get(data.notification_id);
    assertExists(row);
    assertEquals(row.is_test, true);
    assertEquals(row.decision, 'scheduled');
    assertEquals(row.dedupe_key, `user_push_test:${INST_CLIENT}:202609230700`);
    const job = h.workflow.queue.jobs.get(row.dedupe_key);
    assertExists(job);
    assertEquals(job.id, data.job.job_id);
    assertEquals(job.payload, {
      user_id: USER_A,
      notification_id: row.id,
      trigger: 'user_test',
      category: 'critical_email',
      installation_id: INST_ROW,
    });
    // A second tap in the same minute returns the same row and job.
    const again = UserTestPushResponse.parse(await (await testPush(h, jwt)).json()).data;
    assertEquals(again.notification_id, data.notification_id);
    assertEquals(h.workflow.notifications.rows.size, 1);
  },
);

Deno.test(
  'API-DEV-04 refusals: no device, disabled category, quiet hours (with quiet_end), no Expo token',
  async () => {
    const h = await createHarness({ capabilities: { push: true } });
    seed(h, false);
    const jwt = await h.token(USER_A);
    const none = await testPush(h, jwt);
    assertEquals(none.status, 409);
    assertEquals((await none.json()).error.details.reason, 'no_active_device');

    h.workflow.notifications.addTarget(USER_A, { installationRowId: INST_ROW });
    const disabled = await testPush(h, jwt, 'life_intel');
    assertEquals(disabled.status, 409);
    assertEquals((await disabled.json()).error.details.reason, 'category_disabled');

    // 10:00 local is inside a 09:00–11:00 quiet window: test pushes never bypass it (R-13).
    h.workflow.notifications.states.set(USER_A, {
      prefs: { quiet_start: '09:00', quiet_end: '11:00' },
    });
    const quiet = await testPush(h, jwt);
    assertEquals(quiet.status, 409);
    const error = (await quiet.json()).error;
    assertEquals(error.details, { reason: 'quiet_hours', quiet_end: '2026-09-23T08:00:00.000Z' });
    assertEquals(h.workflow.notifications.rows.size, 0);

    const unconfigured = await createHarness({ capabilities: { push: false } });
    seed(unconfigured);
    const res = await testPush(unconfigured, await unconfigured.token(USER_A));
    assertEquals((await res.json()).error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
  },
);

Deno.test('API-DEV-04 is limited to 3 per hour', async () => {
  const h = await createHarness({ capabilities: { push: true } });
  seed(h);
  const jwt = await h.token(USER_A);
  for (let i = 0; i < 3; i++) {
    const ok = await testPush(h, jwt);
    assertEquals(ok.status, 202);
    await ok.body?.cancel();
  }
  const limited = await testPush(h, jwt);
  assertEquals(limited.status, 429);
  await limited.body?.cancel();
});
