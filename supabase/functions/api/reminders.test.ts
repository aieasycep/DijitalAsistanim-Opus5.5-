/**
 * API-REM-01..03 (T-6.06): preset resolution with the free-slot finder, the confirmed create
 * (server re-check, idempotent on `client_reminder_id`, one ledger row and one push job) and cancel.
 */
import { assert, assertEquals, assertExists } from '@std/assert';
import { ReminderResponse, ResolveTimeResponse } from '@da/validation';
import { USER_A, USER_B } from '../_shared/testing/jwt.ts';
import { call, createHarness, type Harness } from './testing.ts';

// NOW = 2026-09-23T07:00Z = Wednesday 10:00 Europe/Istanbul; anchor = 17:00 local.
const ANCHOR = '2026-09-23T14:00:00.000Z';

async function createBody(h: Harness, jwt: string, body: Record<string, unknown>) {
  return await call(h, 'POST', '/reminders', {
    jwt,
    body: {
      client_reminder_id: crypto.randomUUID(),
      title: 'Teklife dön',
      origin: 'email_detail',
      ...body,
    },
  });
}

Deno.test(
  'API-REM-01 resolve-time: anchor presets, smart first free slot and after-anchor presets',
  async () => {
    const h = await createHarness();
    h.workflow.reminders.busy.push(
      { start: '2026-09-23T07:00:00Z', end: '2026-09-23T08:00:00Z' },
      { start: '2026-09-23T08:00:00Z', end: '2026-09-23T08:20:00Z' },
    );
    const jwt = await h.token(USER_A);
    const res = await call(h, 'POST', '/reminders/resolve-time', {
      jwt,
      body: {
        presets: ['before_30m', 'before_1h', 'smart', 'this_evening', 'tomorrow_morning'],
        anchor_at: ANCHOR,
      },
    });
    assertEquals(res.status, 200);
    const options = ResolveTimeResponse.parse(await res.json()).data.options;
    const by = Object.fromEntries(options.map((o) => [o.preset, o]));
    assertEquals(by.before_30m?.fire_at, '2026-09-23T13:30:00.000Z');
    assertEquals(by.before_30m?.label, '16:30');
    assertEquals(by.before_1h?.fire_at, '2026-09-23T13:00:00.000Z');
    assertEquals(by.smart?.valid, true);
    assertEquals(by.smart?.fire_at, '2026-09-23T08:20:00.000Z');
    assert(by.smart?.reason_text?.includes('11:20'));
    assertEquals(by.this_evening?.valid, false);
    assertEquals(by.this_evening?.invalid_reason, 'after_anchor');
    assertEquals(by.tomorrow_morning?.invalid_reason, 'after_anchor');
  },
);

Deno.test(
  'API-REM-01 resolve-time: anchor presets in the past are invalid (UT-REM-02)',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const res = await call(h, 'POST', '/reminders/resolve-time', {
      jwt,
      body: {
        presets: ['before_30m', 'before_1h', 'tomorrow_morning'],
        anchor_at: '2026-09-23T07:20:00Z',
      },
    });
    const options = ResolveTimeResponse.parse(await res.json()).data.options;
    assertEquals(options[0]?.valid, false);
    assertEquals(options[0]?.invalid_reason, 'in_past');
    assertEquals(options[1]?.invalid_reason, 'in_past');
    const missing = await call(h, 'POST', '/reminders/resolve-time', {
      jwt,
      body: { presets: ['before_1h'] },
    });
    assertEquals(missing.status, 422);
    await missing.body?.cancel();
  },
);

Deno.test(
  'API-REM-02 create: one row, one scheduled ledger row and one push job; replay answers 200 (UT-REM-11)',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const body = {
      client_reminder_id: crypto.randomUUID(),
      title: 'Teklife dön',
      preset: 'before_1h',
      fire_at: '2026-09-23T13:00:00Z',
      anchor_at: ANCHOR,
      origin: 'email_detail',
    };
    const first = await call(h, 'POST', '/reminders', { jwt, body });
    assertEquals(first.status, 201);
    const view = ReminderResponse.parse(await first.json()).data;
    assertEquals(view.status, 'scheduled');
    assertEquals(view.fire_at, '2026-09-23T13:00:00.000Z');
    assertEquals(view.time_zone, 'Europe/Istanbul');
    const job = h.workflow.queue.jobs.get(`reminder:${view.id}`);
    assertExists(job);
    assertEquals(job.type, 'notification');
    assertEquals(job.runAfter, '2026-09-23T13:00:00.000Z');
    const ledger = [...h.workflow.notifications.rows.values()].filter(
      (r) => r.dedupe_key === `reminder:${view.id}`,
    );
    assertEquals(ledger.length, 1);
    assertEquals(ledger[0]?.decision, 'scheduled');
    assertEquals(ledger[0]?.android_channel, 'reminders');

    const replay = await call(h, 'POST', '/reminders', { jwt, body });
    assertEquals(replay.status, 200);
    const replayed = await replay.json();
    assertEquals(replayed.data.id, view.id);
    assertEquals(replayed.meta.idempotency_replayed, true);
    assertEquals(h.workflow.reminders.rows.size, 1);
    assertEquals(
      [...h.workflow.queue.jobs.values()].filter((j) => j.type === 'notification').length,
      1,
    );
  },
);

Deno.test(
  'API-REM-02 create: a time that differs from the preset is 409 with resolved_fire_at',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const res = await createBody(h, jwt, {
      preset: 'before_1h',
      fire_at: '2026-09-23T12:00:00Z',
      anchor_at: ANCHOR,
    });
    assertEquals(res.status, 409);
    const error = (await res.json()).error;
    assertEquals(error.code, 'STATE_CONFLICT');
    assertEquals(error.details.resolved_fire_at, '2026-09-23T13:00:00.000Z');
    assertEquals(h.workflow.reminders.rows.size, 0);
  },
);

Deno.test(
  'API-REM-02 create: a user-picked time inside quiet hours is kept (R-13 a); too soon is 422',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const late = await createBody(h, jwt, { preset: 'custom', fire_at: '2026-09-23T20:15:00Z' });
    assertEquals(late.status, 201);
    const view = ReminderResponse.parse(await late.json()).data;
    assertEquals(view.fire_at, '2026-09-23T20:15:00.000Z');
    assertEquals(
      h.workflow.queue.jobs.get(`reminder:${view.id}`)?.runAfter,
      '2026-09-23T20:15:00.000Z',
    );

    const soon = await createBody(h, jwt, { preset: 'custom', fire_at: '2026-09-23T07:00:30Z' });
    assertEquals(soon.status, 422);
    await soon.body?.cancel();
  },
);

Deno.test('API-REM-02 create: a subject the user does not own is 404', async () => {
  const h = await createHarness();
  const jwt = await h.token(USER_A);
  const res = await createBody(h, jwt, {
    preset: 'custom',
    fire_at: '2026-09-23T15:00:00Z',
    subject: { type: 'email_thread', id: crypto.randomUUID() },
  });
  assertEquals(res.status, 404);
  await res.body?.cancel();
});

Deno.test(
  'API-REM-03 cancel: the push job is cancelled and the ledger row suppressed; foreign ids are 404',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const created = await createBody(h, jwt, { preset: 'custom', fire_at: '2026-09-23T15:00:00Z' });
    const view = ReminderResponse.parse(await created.json()).data;
    const other = await h.token(USER_B);
    const foreign = await call(h, 'POST', `/reminders/${view.id}/cancel`, {
      jwt: other,
      key: crypto.randomUUID(),
      body: {},
    });
    assertEquals(foreign.status, 404);
    await foreign.body?.cancel();

    const key = crypto.randomUUID();
    const res = await call(h, 'POST', `/reminders/${view.id}/cancel`, {
      jwt,
      key,
      body: { reason: 'undo' },
    });
    assertEquals(res.status, 200);
    assertEquals(ReminderResponse.parse(await res.json()).data.status, 'cancelled');
    const job = h.workflow.queue.jobs.get(`reminder:${view.id}`);
    assertEquals(job?.status, 'failed');
    assertEquals(job?.lastErrorCode, 'CANCELLED');
    const ledger = [...h.workflow.notifications.rows.values()].find(
      (r) => r.dedupe_key === `reminder:${view.id}`,
    );
    assertEquals(ledger?.decision, 'suppressed');
    const again = await call(h, 'POST', `/reminders/${view.id}/cancel`, {
      jwt,
      key,
      body: { reason: 'undo' },
    });
    assertEquals(again.status, 200);
    assertEquals((await again.json()).data.status, 'cancelled');
  },
);
