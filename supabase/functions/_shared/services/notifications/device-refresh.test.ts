/**
 * JOB-18 `kind: 'device_refresh'` (KPL-11, KPL-12) with an Expo stub: one data-only background
 * push to the installation that owns the device calendar — `_contentAvailable`, normal priority,
 * no title, body or sound, data `{type, entity_id, deeplink}` only — and no ledger row, no ticket,
 * no receipt job, even inside quiet hours.
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { routes, toDeepLink } from '@da/domain';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import { USER_A } from '../../testing/jwt.ts';
import { jobContext, memoryNotifications, memoryQueue } from '../../testing/workflows.ts';
import { NotificationJobPayload } from './create.ts';
import { createExpoPushClient, type ExpoPushClient } from './expo-push.ts';
import { processNotification } from './pipeline.ts';

const QUIET = new Date('2026-09-23T20:10:00.000Z'); // 23:10 Europe/Istanbul, inside 22:30–07:30
const INSTALL = 'bbbbbbbb-0000-4000-8000-000000000001';

function setup(reply?: (messages: Record<string, unknown>[]) => Response) {
  const clock = () => QUIET;
  const queue = memoryQueue(clock);
  const n = memoryNotifications(clock);
  const sent: Record<string, unknown>[][] = [];
  const stub = stubFetch((call) => {
    const messages = JSON.parse(call.body ?? '[]') as Record<string, unknown>[];
    sent.push(messages);
    if (reply !== undefined) return reply(messages);
    return jsonResponse({ data: messages.map((_, i) => ({ status: 'ok', id: `tk-${i}` })) });
  });
  const deps = {
    repo: n.repo,
    triggers: {} as never,
    expo: createExpoPushClient({ accessToken: 'expo-token', fetch: stub.fetch }),
  };
  const run = (payload: Record<string, unknown>, expo: ExpoPushClient | null = deps.expo) =>
    processNotification(
      { ...deps, expo },
      jobContext({
        type: 'notification',
        key: `device_refresh:${INSTALL}:morning:2026-09-24`,
        payload: NotificationJobPayload.parse({ user_id: USER_A, ...payload }),
        queue,
        now: clock,
        userId: USER_A,
      }),
    );
  return { n, queue, sent, run };
}

Deno.test(
  'device_refresh: a data-only background push to the device-calendar installation only',
  async () => {
    const s = setup();
    const own = s.n.addTarget(USER_A, { platform: 'ios', installationRowId: INSTALL });
    s.n.addTarget(USER_A, { platform: 'android' });
    const result = await s.run({ kind: 'device_refresh', installation_id: INSTALL });
    assertEquals(result, { device_refresh: true, tickets: 1, accepted: 1, tokens_disabled: 0 });
    assertEquals(s.sent.length, 1);
    assertEquals(s.sent[0], [
      {
        to: own.token,
        data: { type: 'device_refresh', entity_id: null, deeplink: toDeepLink(routes.today()) },
        _contentAvailable: true,
        priority: 'normal',
        ttl: 900,
      },
    ]);
    const message = s.sent[0]![0]!;
    for (const key of ['title', 'body', 'sound', 'channelId', 'categoryId'])
      assertFalse(key in message);
    // Nothing is displayed: no ledger row, no ticket, no receipt poll; quiet hours do not apply.
    assertEquals(s.n.rows.size, 0);
    assertEquals(s.n.tickets.length, 0);
    assertEquals([...s.queue.jobs.values()].length, 0);
  },
);

Deno.test('device_refresh: DeviceNotRegistered disables the token', async () => {
  const s = setup(() =>
    jsonResponse({
      data: [{ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }],
    }),
  );
  const target = s.n.addTarget(USER_A, { installationRowId: INSTALL });
  const result = await s.run({ kind: 'device_refresh', installation_id: INSTALL });
  assertEquals(result?.tokens_disabled, 1);
  assertEquals(result?.accepted, 0);
  const stored = s.n.targets.find((t) => t.tokenId === target.tokenId);
  assertEquals([stored?.enabled, stored?.disabledReason], [false, 'device_not_registered']);
});

Deno.test(
  'device_refresh: skipped without an active device or the Expo credential; the payload needs the installation',
  async () => {
    const s = setup();
    assertEquals(await s.run({ kind: 'device_refresh', installation_id: INSTALL }), {
      skipped: 'no_active_device',
    });
    s.n.addTarget(USER_A, { installationRowId: INSTALL });
    assertEquals(await s.run({ kind: 'device_refresh', installation_id: INSTALL }, null), {
      skipped: 'external_credential_required',
    });
    assertEquals(s.sent.length, 0);
    assert(!NotificationJobPayload.safeParse({ user_id: USER_A, kind: 'device_refresh' }).success);
    assert(
      !NotificationJobPayload.safeParse({
        user_id: USER_A,
        kind: 'device_refresh',
        installation_id: INSTALL,
        trigger: 'briefing',
      }).success,
    );
  },
);
