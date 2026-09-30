/**
 * Id and address lists that grow with user data reach PostgREST in URL-sized chunks
 * (`db/in-chunks.ts`): the API gateway refuses request lines over 8 KB. Each store method keeps its
 * single-request result: rows concatenated, ordering and limits re-applied, duplicates dropped.
 */
import { assert, assertEquals } from '@std/assert';
import { USER_A } from '../../testing/jwt.ts';
import { messageRow, NOW, threadRow, uuid } from '../../testing/intel.ts';
import { postgrest, type PgRequest } from '../../testing/postgrest.ts';
import {
  supabaseBriefingStore,
  supabaseInsightStore,
  supabaseMailStore,
  supabaseMemoryStore,
} from './supabase-store.ts';

/** The values of an `in.(…)` filter. */
function inList(value: string | undefined): string[] {
  const list = /^in\.\((.*)\)$/.exec(value ?? '')?.[1];
  return list === undefined || list === '' ? [] : list.split(',').map((v) => v.replace(/"/g, ''));
}

/** The values of an `ov.{…}` filter. */
function ovList(value: string | undefined): string[] {
  const list = /^ov\.\{(.*)\}$/.exec(value ?? '')?.[1];
  return list === undefined || list === '' ? [] : list.split(',').map((v) => v.replace(/"/g, ''));
}

const ids = (n: number) => Array.from({ length: n }, () => uuid());

Deno.test('mail store: 250 message ids → 3 reads of ≤ 100 ids, rows in request order', async () => {
  const want = ids(250);
  const pg = postgrest((req) => inList(req.params.id).map((id) => messageRow({ id })));
  const got = await supabaseMailStore(pg.db).messages(want);
  const reads = pg.to('email_messages');
  assertEquals(
    reads.map((r) => inList(r.params.id).length),
    [100, 100, 50],
  );
  assertEquals(
    got.map((m) => m.id),
    want,
  );
  for (const r of reads) assert(r.url.length < 8_000, `URL of ${r.url.length} bytes`);
});

Deno.test(
  'mail store: sender lookups by address overlap in chunks; a contact is kept once',
  async () => {
    const shared = { id: 'c-shared', display_name: 'Ahmet Yılmaz', emails: [] as string[] };
    const emails = Array.from({ length: 230 }, (_, i) => `Kisi${i}@Kuzeylojistik.com`);
    const pg = postgrest((req) => {
      const chunk = ovList(req.params.emails);
      return [
        { ...shared, emails: [chunk[0]] },
        { id: `c-${chunk[0]}`, display_name: chunk[0] },
      ];
    });
    const got = await supabaseMailStore(pg.db).contactsByEmail(USER_A, [...emails, emails[0]!]);
    const reads = pg.to('contacts');
    assertEquals(
      reads.map((r) => ovList(r.params.emails).length),
      [100, 100, 30],
    );
    assert(ovList(reads[0]!.params.emails).every((e) => e === e.toLowerCase()));
    assertEquals(got.filter((c) => c.id === 'c-shared').length, 1, 'deduplicated by id');
    assertEquals(got.length, 4);
  },
);

Deno.test(
  'insight snapshot: 150 awaiting-reply threads → the newest inbound message per thread across chunks',
  async () => {
    const threads = Array.from({ length: 150 }, (_, i) =>
      threadRow({
        reply_state: 'awaiting_my_reply',
        last_message_at: NOW.toISOString(),
        subject: `t${i}`,
      }),
    );
    const pg = postgrest((req: PgRequest) => {
      if (req.path === 'email_threads') return threads;
      if (req.path === 'email_messages') {
        // Two inbound messages per thread, newest first within the chunk.
        return inList(req.params.thread_id).flatMap((threadId, i) => [
          messageRow({
            thread_id: threadId,
            direction: 'inbound',
            received_at: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString(),
          }),
          messageRow({
            thread_id: threadId,
            direction: 'inbound',
            received_at: new Date(NOW.getTime() - (i + 1) * 60_000 - 3_600_000).toISOString(),
          }),
        ]);
      }
      return [];
    });
    const snapshot = await supabaseInsightStore(pg.db).snapshot(USER_A, NOW);
    const reads = pg.to('email_messages');
    assertEquals(
      reads.map((r) => inList(r.params.thread_id).length),
      [100, 50],
    );
    assertEquals(
      reads.map((r) => r.params.limit),
      ['500', '250'],
    );
    assertEquals(snapshot.latestInbound.length, 150, 'one message per thread');
    assertEquals(new Set(snapshot.latestInbound.map((m) => m.thread_id)).size, 150);
    const times = snapshot.latestInbound.map((m) => Date.parse(m.received_at));
    assertEquals(
      times,
      [...times].sort((a, b) => b - a),
      'merged newest first',
    );
    for (const m of snapshot.latestInbound) {
      const index = inList(
        reads.find((r) => inList(r.params.thread_id).includes(m.thread_id))!.params.thread_id,
      ).indexOf(m.thread_id);
      assertEquals(m.received_at, new Date(NOW.getTime() - (index + 1) * 60_000).toISOString());
    }
  },
);

Deno.test('insight store: expiring 250 insights → 3 scoped updates', async () => {
  const pg = postgrest(() => undefined);
  await supabaseInsightStore(pg.db).expireInsights(USER_A, ids(250));
  const updates = pg.to('insights', 'PATCH');
  assertEquals(
    updates.map((r) => inList(r.params.id).length),
    [100, 100, 50],
  );
  for (const u of updates) {
    assertEquals(u.params.user_id, `eq.${USER_A}`);
    assertEquals(u.body, { status: 'expired' });
  }
});

Deno.test(
  'briefing and memory stores: job ids and pending chunk ids in chunks; the limit holds',
  async () => {
    const pg = postgrest((req) => {
      if (req.path === 'briefings') return inList(req.params.job_id).map((job_id) => ({ job_id }));
      return inList(req.params.id).map((id) => ({ id, user_id: USER_A, content: 'x' }));
    });
    const jobIds = ids(150);
    assertEquals(
      (await supabaseBriefingStore(pg.db).byJobIds(jobIds)).map((b) => b.job_id),
      jobIds,
    );
    assertEquals(pg.to('briefings').length, 2);
    const pending = await supabaseMemoryStore(pg.db).pendingChunks(USER_A, ids(250), 120);
    assertEquals(pending.length, 120);
    assertEquals(pg.to('memory_chunks').length, 3);
    assertEquals(
      (await supabaseMemoryStore(pg.db).pendingChunks(USER_A, null, 5)).length,
      0,
      'without ids: one unfiltered read',
    );
  },
);
