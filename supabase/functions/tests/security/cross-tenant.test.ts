/**
 * THR-11 Cross-tenant access (SECURITY_AND_PRIVACY_PLAN §2 THR-11, CTL-3.4, CTL-3.6, R-13; TEST_PLAN
 * TST-DB-02, TST-EF-20, TST-CI-10). RLS isolation itself is proven in SQL
 * (`300_threats_tenant.test.sql`, `002_global_invariants`, `150_column_grants`). Here the Edge side:
 * - the service-role repositories that bypass RLS (approvals, reminders, notifications) put the
 *   verified caller's id into every request they make — recorded at the PostgREST boundary;
 * - through the real `api` app another user's approval, reminder, capture and connected account
 *   are indistinguishable from missing ones (404), and nothing of theirs changes.
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { supabaseApprovalsRepo } from '../../_shared/services/approvals/repo.ts';
import { supabaseNotificationsRepo } from '../../_shared/services/notifications/repo.ts';
import { supabaseRemindersRepo } from '../../_shared/services/reminders.ts';
import { testDb } from '../../_shared/testing/db.ts';
import { jsonResponse, stubFetch } from '../../_shared/testing/fetch.ts';
import { activeDemoAccount, integrationHarness } from '../../_shared/testing/integrations.ts';
import { USER_A, USER_B } from '../../_shared/testing/jwt.ts';
import { call, createHarness } from '../../api/testing.ts';
import { assistApi, captureRow } from './helpers.ts';

const ID = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';

function recorder() {
  return stubFetch((c) => {
    const url = new URL(c.url);
    if (url.pathname.startsWith('/rest/v1/rpc/')) return jsonResponse(null);
    const accept = c.headers.get('accept') ?? '';
    return accept.includes('vnd.pgrst.object')
      ? jsonResponse({ code: 'PGRST116', message: 'no rows', details: null }, 406)
      : jsonResponse([]);
  });
}

async function attempt(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Empty stub answers may surface as NOT_FOUND; only the requests matter here.
  }
}

Deno.test(
  'THR-11: service-role repositories scope every PostgREST request to the verified caller',
  async () => {
    const stub = recorder();
    const db = testDb(stub.fetch);
    const approvals = supabaseApprovalsRepo(db);
    const reminders = supabaseRemindersRepo(db);
    const notifications = supabaseNotificationsRepo(db);
    const now = new Date('2026-09-24T08:00:00Z');
    const reads: [string, () => Promise<unknown>][] = [
      ['approvals.get', () => approvals.get(USER_A, ID)],
      ['approvals.deviceTokenHash', () => approvals.deviceTokenHash(USER_A, ID)],
      ['approvals.userContext', () => approvals.userContext(USER_A)],
      ['approvals.planFeature', () => approvals.planFeature(USER_A, 'follow_up_commitments')],
      ['approvals.account', () => approvals.account(USER_A, ID)],
      ['approvals.calendar', () => approvals.calendar(USER_A, ID)],
      ['approvals.calendarEvent', () => approvals.calendarEvent(USER_A, ID)],
      ['approvals.installationByClientId', () => approvals.installationByClientId(USER_A, ID)],
      ['approvals.installationById', () => approvals.installationById(USER_A, ID)],
      ['approvals.sourceText', () => approvals.sourceText(USER_A, 'email_message', ID)],
      ['reminders.prefs', () => reminders.prefs(USER_A)],
      ['reminders.busy', () => reminders.busy(USER_A, now, new Date(now.getTime() + 3_600_000))],
      ['reminders.hasCalendar', () => reminders.hasCalendar(USER_A)],
      ['reminders.get', () => reminders.get(USER_A, ID)],
      ['notifications.getNotification', () => notifications.getNotification(USER_A, ID)],
      ['notifications.findByDedupe', () => notifications.findByDedupe(USER_A, 'critical:x')],
      ['notifications.userState', () => notifications.userState(USER_A)],
      ['notifications.activeTargets', () => notifications.activeTargets(USER_A, null, now)],
    ];
    for (const type of [
      'email_thread',
      'email_message',
      'calendar_event',
      'commitment',
      'task',
      'capture',
      'meeting_note',
    ] as const) {
      reads.push([`approvals.owns(${type})`, () => approvals.owns(USER_A, type, ID)]);
      reads.push([`reminders.owns(${type})`, () => reminders.owns(USER_A, type, ID)]);
    }
    reads.push(['approvals.owns(contact)', () => approvals.owns(USER_A, 'contact', ID)]);
    for (const [label, read] of reads) {
      const before = stub.calls.length;
      await attempt(read);
      const made = stub.calls.slice(before);
      assert(made.length > 0, `${label} made no request`);
      for (const c of made) {
        const url = decodeURIComponent(c.url);
        const body = c.body ?? '';
        const scoped =
          url.includes(`user_id=eq.${USER_A}`) ||
          body.includes(`"${USER_A}"`) ||
          GLOBAL_READS.some((re) => re.test(url));
        assert(scoped, `${label}: ${c.method} ${url} is not pinned to the caller`);
        assertFalse(url.includes(USER_B) || body.includes(USER_B));
      }
    }
  },
);

/** Reads of non-user tables (catalogues), which carry no user data. */
const GLOBAL_READS: readonly RegExp[] = [
  /\/rest\/v1\/(app_settings|feature_flags|plan_limits|plans)\?/,
];

Deno.test(
  'THR-11: through the api another user’s approval, reminder and connected account are 404 and stay untouched',
  async () => {
    const ih = await integrationHarness();
    const h = await createHarness({ integrations: ih.runtime });
    const account = await activeDemoAccount(ih, { userId: USER_A, status: 'healthy' });
    const approval = h.workflow.approvals;
    approval.addAccount({ id: account.id, userId: USER_A, can: ['calendar_write'] });
    const jwtA = await h.token(USER_A);
    const jwtB = await h.token(USER_B);
    const reminder = await call(h, 'POST', '/reminders', {
      jwt: jwtA,
      key: crypto.randomUUID(),
      body: {
        client_reminder_id: crypto.randomUUID(),
        title: 'Faturayı öde',
        preset: 'before_1h',
        fire_at: '2026-09-23T13:00:00Z',
        anchor_at: '2026-09-23T14:00:00Z',
        origin: 'email_detail',
      },
    });
    const reminderText = await reminder.text();
    assert(reminder.status === 201 || reminder.status === 200, reminderText);
    const reminderId: string = JSON.parse(reminderText).data.id;
    const probes: [string, string, unknown][] = [
      ['POST', `/integrations/${account.id}/sync`, { resources: ['mail'] }],
      ['POST', `/integrations/${account.id}/disconnect`, { confirm: true, purge_content: true }],
      [
        'PATCH',
        `/integrations/${account.id}/data-sources`,
        {
          data_sources: { mail_read: false },
          expected_updated_at: account.updated_at,
        },
      ],
      ['GET', `/approvals/${crypto.randomUUID()}`, undefined],
    ];
    probes.push(['POST', `/reminders/${reminderId}/cancel`, {}]);
    for (const [method, path, body] of probes) {
      const res = await call(h, method, path, {
        jwt: jwtB,
        key: crypto.randomUUID(),
        ...(body === undefined ? {} : { body }),
      });
      const text = await res.text();
      assertEquals(res.status, 404, `${method} ${path} → ${text}`);
      assertEquals(JSON.parse(text).error.code, 'NOT_FOUND');
    }
    assertEquals(ih.store.accounts.get(account.id)?.status, 'healthy');
    assertEquals(ih.store.accounts.get(account.id)?.data_source_toggles, {});
    assertEquals([...ih.jobs.jobs.values()].filter((j) => j.type === 'gmail_sync').length, 0);
  },
);

Deno.test('THR-11: another user’s capture cannot be analysed, acted on or discarded', async () => {
  const s = await assistApi();
  const own = captureRow({
    kind: 'text',
    status: 'uploaded',
    text_content: 'Yarın 10:00 toplantı',
  });
  const foreign = captureRow({
    user_id: USER_B,
    kind: 'text',
    status: 'uploaded',
    text_content: 'B',
  });
  s.fx.store.captures.push(own, foreign);
  for (const [path, body] of [
    [`/captures/${foreign.id}/analyze`, {}],
    [`/captures/${foreign.id}/discard`, {}],
    [
      `/captures/${foreign.id}/actions`,
      { items: [{ item_id: 'i1', action_type: 'reminder_create', destination: null }] },
    ],
  ] as const) {
    const res = await s.request('POST', path, body, crypto.randomUUID());
    const text = await res.text();
    assertEquals(res.status, 404, `${path} → ${text}`);
    assertEquals(JSON.parse(text).error.code, 'NOT_FOUND');
  }
  assertEquals(foreign.status, 'uploaded');
  // Control: the same call on the caller's own capture is accepted.
  const control = await s.request('POST', `/captures/${own.id}/analyze`, {}, crypto.randomUUID());
  assertEquals(control.status, 202);
  await control.body?.cancel();
  const queued = [...s.h.workflow.queue.jobs.values()].filter((j) => j.type === 'capture_analysis');
  assertEquals(
    queued.map((j) => (j.payload as { capture_id: string }).capture_id),
    [own.id],
  );
});
