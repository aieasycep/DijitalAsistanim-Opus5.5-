/**
 * EF-WDG-01 · API-WDG-01 `GET /widgets/snapshot`: `WidgetSnapshotV1` under the detail level
 * (`generic` counts only, `title_only` category labels, `full` titles), ETag / 304, foreign
 * installation 404 and 60 requests per hour per installation.
 */
import { assert, assertEquals } from '@std/assert';
import { WidgetSnapshotV1 } from '@da/validation';
import { USER_A } from '../_shared/testing/jwt.ts';
import { call, createHarness, type Harness } from './testing.ts';

const INSTALLATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function seed(h: Harness) {
  const w = h.workflow.widgets.state;
  w.installations.add(INSTALLATION);
  w.priorities.push({
    id: crypto.randomUUID(),
    kind: 'reply_needed',
    urgency: 'urgent',
    title: 'Ahmet Yılmaz · Revize teklif 48.500 TL',
    entity_type: 'email_thread',
    entity_id: crypto.randomUUID(),
    due_at: '2026-09-23T14:00:00Z',
    event_at: null,
    source: {
      source_type: 'email_message',
      provider: 'google',
      source_timestamp: '2026-09-23T06:30:00Z',
    },
  });
  w.events.push({
    id: crypto.randomUUID(),
    title: 'Bütçe görüşmesi · Kuzey Lojistik',
    start_at: '2026-09-23T11:00:00Z',
    end_at: '2026-09-23T12:00:00Z',
  });
  w.followUps.push({
    insight_id: crypto.randomUUID(),
    entity_id: crypto.randomUUID(),
    title: 'Mehmet Yılmaz · Sözleşme',
    due_at: '2026-09-20T07:00:00Z',
  });
}

function snapshot(
  h: Harness,
  jwt: string,
  installation = INSTALLATION,
  headers: Record<string, string> = {},
) {
  return call(h, 'GET', '/widgets/snapshot', {
    jwt,
    headers: { 'X-DA-Installation-Id': installation, ...headers },
  });
}

const SENSITIVE = ['Ahmet', 'Revize', '48.500', 'Bütçe', 'Kuzey', 'Mehmet', 'Sözleşme', 'Gmail'];

Deno.test(
  'EF-WDG-01 generic: counts only, no names, subjects, amounts or source labels',
  async () => {
    const h = await createHarness();
    seed(h);
    h.workflow.widgets.state.prefs.detail_level = 'generic';
    const res = await snapshot(h, await h.token(USER_A));
    assertEquals(res.status, 200);
    const text = await res.text();
    for (const word of SENSITIVE) assert(!text.includes(word), word);
    const data = WidgetSnapshotV1.parse(JSON.parse(text).data);
    assertEquals(data.detail_mode, 'generic');
    assertEquals(data.counts.important, 1);
    assertEquals(data.counts.follow_ups, 1);
    assertEquals(data.priorities[0]?.title_private, undefined);
    assertEquals(data.priorities[0]?.title_full, undefined);
  },
);

Deno.test('EF-WDG-01 title_only: category labels only; full: titles', async () => {
  const h = await createHarness();
  seed(h);
  const jwt = await h.token(USER_A);
  const res = await snapshot(h, jwt);
  const text = await res.text();
  for (const word of ['Ahmet', 'Revize', '48.500', 'Bütçe', 'Mehmet'])
    assert(!text.includes(word), word);
  const data = WidgetSnapshotV1.parse(JSON.parse(text).data);
  assertEquals(data.detail_mode, 'title_only');
  assertEquals(data.priorities[0]?.badge, 'ACİL');
  assert((data.priorities[0]?.title_private ?? '').length > 0);
  assert((data.next_meeting?.title_private ?? '').length > 0);
  assertEquals(data.next_meeting?.time_label, '14:00');

  h.workflow.widgets.state.prefs.detail_level = 'full';
  const full = WidgetSnapshotV1.parse((await (await snapshot(h, jwt)).json()).data);
  assertEquals(full.priorities[0]?.title_full, 'Ahmet Yılmaz · Revize teklif 48.500 TL');
  assertEquals(full.next_meeting?.title_full, 'Bütçe görüşmesi · Kuzey Lojistik');
  assertEquals(full.entitlement, 'free');
  assertEquals(full.next_meeting?.prep_topic_count, null);
});

Deno.test('EF-WDG-01 ETag: If-None-Match answers 304; a changed snapshot answers 200', async () => {
  const h = await createHarness();
  seed(h);
  const jwt = await h.token(USER_A);
  const first = await snapshot(h, jwt);
  const etag = first.headers.get('ETag');
  await first.body?.cancel();
  assert(etag !== null && etag.startsWith('W/'));
  const second = await snapshot(h, jwt, INSTALLATION, { 'If-None-Match': etag });
  assertEquals(second.status, 304);
  h.workflow.widgets.state.followUps.length = 0;
  const third = await snapshot(h, jwt, INSTALLATION, { 'If-None-Match': etag });
  assertEquals(third.status, 200);
  await third.body?.cancel();
});

Deno.test(
  'EF-WDG-01 a foreign or missing installation is 404; the 61st request in an hour is 429',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const foreign = await snapshot(h, jwt, FOREIGN);
    assertEquals(foreign.status, 404);
    await foreign.body?.cancel();
    const missing = await call(h, 'GET', '/widgets/snapshot', { jwt });
    assertEquals(missing.status, 404);
    await missing.body?.cancel();

    const h2 = await createHarness();
    seed(h2);
    const jwt2 = await h2.token(USER_A);
    for (let i = 0; i < 60; i++) {
      const ok = await snapshot(h2, jwt2);
      assertEquals(ok.status, 200, `request ${i + 1}`);
      await ok.body?.cancel();
    }
    const limited = await snapshot(h2, jwt2);
    assertEquals(limited.status, 429);
    assertEquals((await limited.json()).error.code, 'RATE_LIMITED');
  },
);
