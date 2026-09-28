/**
 * Meeting prep reads keyed by the attendee list (contacts, recent mail, open commitments) reach
 * PostgREST in URL-sized chunks (`db/in-chunks.ts`), so a large meeting stays inside the gateway's
 * 8 KB request-line limit; each method keeps its single-request ordering, limit and uniqueness.
 */
import { assert, assertEquals } from '@std/assert';
import { USER_A } from '../../testing/jwt.ts';
import { messageRow, NOW, uuid } from '../../testing/intel.ts';
import { postgrest } from '../../testing/postgrest.ts';
import { supabaseAssistStore } from './supabase-store.ts';

const attendees = (n: number) => Array.from({ length: n }, (_, i) => `Katilimci${i}@Kuzey.com`);

Deno.test(
  'assist store: 300 attendees → contact lookups in chunks, deduplicated, capped at 20',
  async () => {
    const pg = postgrest((req) => {
      const list = /^ov\.\{(.*)\}$/.exec(req.params.emails ?? '')?.[1]?.split(',') ?? [];
      return [
        { id: 'c-organiser', display_name: 'Selin Kaya', emails: ['selin@kuzey.com'] },
        ...list.slice(0, 10).map((e) => ({ id: `c-${e}`, display_name: e, emails: [e] })),
      ];
    });
    const got = await supabaseAssistStore(pg.db).contactsForEmails(USER_A, attendees(300));
    const reads = pg.to('contacts');
    assertEquals(reads.length, 3);
    for (const r of reads) {
      assert(r.url.length < 8_000, `URL of ${r.url.length} bytes`);
      assertEquals(r.params.limit, '20');
    }
    assertEquals(got.length, 20);
    assertEquals(got.filter((c) => c.id === 'c-organiser').length, 1);
  },
);

Deno.test(
  'assist store: mail with 100 attendees → 40-address chunks, merged newest first, limit and ids unique',
  async () => {
    const shared = messageRow({ received_at: NOW.toISOString() });
    let n = 0;
    const pg = postgrest(() => {
      n++;
      return [
        shared,
        messageRow({ received_at: new Date(NOW.getTime() - n * 3_600_000).toISOString() }),
        messageRow({ received_at: new Date(NOW.getTime() - n * 60_000).toISOString() }),
      ];
    });
    const since = new Date(NOW.getTime() - 30 * 86_400_000);
    const got = await supabaseAssistStore(pg.db).mailsWith(USER_A, attendees(100), since, 4);
    const reads = pg.to('email_messages');
    assertEquals(reads.length, 3, '40 + 40 + 20 addresses');
    for (const r of reads) assert(r.url.length < 8_000, `URL of ${r.url.length} bytes`);
    assertEquals(got.length, 4);
    assertEquals(got.filter((m) => m.id === shared.id).length, 1);
    const times = got.map((m) => Date.parse(m.received_at));
    assertEquals(
      times,
      [...times].sort((a, b) => b - a),
    );
  },
);

Deno.test(
  'assist store: open commitments with 100 attendee names → chunked OR, soonest due first, undated last',
  async () => {
    let n = 0;
    const pg = postgrest(() => {
      n++;
      return [
        { id: uuid(), due_at: null, confidence: '0.9' },
        {
          id: uuid(),
          due_at: new Date(NOW.getTime() + n * 86_400_000).toISOString(),
          confidence: '0.8',
        },
      ];
    });
    const names = Array.from({ length: 100 }, (_, i) => `Katılımcı ${i}`);
    const got = await supabaseAssistStore(pg.db).openCommitmentsWith(USER_A, [], names);
    const reads = pg.to('commitments');
    assertEquals(reads.length, 3);
    for (const r of reads) assert(r.url.length < 8_000, `URL of ${r.url.length} bytes`);
    assertEquals(got.length, 6);
    const due = got.map((c) => c.due_at);
    assertEquals(
      due.slice(0, 3).every((d) => d !== null),
      true,
    );
    assertEquals(
      due.slice(3).every((d) => d === null),
      true,
    );
    assertEquals(got[0]!.confidence, 0.8);
  },
);
