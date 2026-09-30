/**
 * Private-bucket storage adapters (`storage.ts` for captures / briefing audio, `privacy/storage.ts`
 * for export and retention) over supabase-js storage against a stubbed Storage API: signed upload
 * URLs (7,200 s) and signed read URLs (300 s audio, export TTL), size caps on download, listing by
 * folder recursion and batched removal (IT-PRIV-01/02). Failures surface as `SERVICE_UNAVAILABLE`.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../errors.ts';
import { testDb } from '../testing/db.ts';
import { TEST_SUPABASE_URL } from '../testing/env.ts';
import { jsonResponse, type RecordedCall, stubFetch } from '../testing/fetch.ts';
import { removeInBatches, supabaseObjectStore } from './privacy/storage.ts';
import { SIGNED_AUDIO_TTL_S, SIGNED_UPLOAD_TTL_S, supabaseStorage } from './storage.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const STORAGE = `${TEST_SUPABASE_URL}/storage/v1`;

function storage(route: (call: RecordedCall, path: string) => Response | undefined) {
  const stub = stubFetch((call) => {
    const path = new URL(call.url).pathname.replace('/storage/v1', '');
    return (
      route(call, path) ??
      jsonResponse({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 404)
    );
  });
  return { stub, db: testDb(stub.fetch) };
}

const failing = () =>
  storage(() => jsonResponse({ statusCode: '500', error: 'internal', message: 'boom' }, 500));

Deno.test('storage: signed upload (7,200 s) and signed read URLs for private buckets', async () => {
  const path = `${USER}/cap-1.pdf`;
  const { stub, db } = storage((_call, p) => {
    if (p === `/object/upload/sign/captures/${path}`)
      return jsonResponse({ url: `/object/upload/sign/captures/${path}?token=up-token` });
    if (p === `/object/sign/briefing-audio/${USER}/b1.mp3`)
      return jsonResponse({
        signedURL: `/object/sign/briefing-audio/${USER}/b1.mp3?token=read-token`,
      });
    return undefined;
  });
  const s = supabaseStorage(db);
  const up = await s.signedUploadUrl('captures', path);
  assertEquals([up.token, up.path], ['up-token', path]);
  assert(up.signedUrl.startsWith(`${STORAGE}/object/upload/sign/captures/`));
  assertEquals(SIGNED_UPLOAD_TTL_S, 7_200);
  const url = await s.signedUrl('briefing-audio', `${USER}/b1.mp3`, SIGNED_AUDIO_TTL_S);
  assert(url.includes('token=read-token'));
  assertEquals(JSON.parse(stub.calls[1]?.body ?? '{}').expiresIn, 300);

  const bad = supabaseStorage(failing().db);
  const e1 = await assertRejects(() => bad.signedUploadUrl('captures', path), AppError);
  assertEquals([e1.code, e1.details], ['SERVICE_UNAVAILABLE', { reason: 'signed_upload_failed' }]);
  const e2 = await assertRejects(() => bad.signedUrl('captures', path, 60), AppError);
  assertEquals(e2.details, { reason: 'signed_url_failed' });
});

Deno.test(
  'storage: upload upserts; download caps size; stat reads metadata; remove batches',
  async () => {
    const bytes = new TextEncoder().encode('ID3 audio bytes');
    const { stub, db } = storage((call, p) => {
      if (call.method === 'POST' && p === `/object/briefing-audio/${USER}/b1.mp3`)
        return jsonResponse({ Key: `briefing-audio/${USER}/b1.mp3` });
      if (call.method === 'GET' && p.endsWith(`/briefing-audio/${USER}/b1.mp3`))
        return new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } });
      if (p === '/object/list/captures') {
        return jsonResponse([
          { name: 'cap-1.pdf', id: 'o1', metadata: { size: 2048 } },
          { name: 'cap-1.pdf.bak', id: 'o2', metadata: { size: 'x' } },
        ]);
      }
      if (call.method === 'DELETE' && p === '/object/captures')
        return jsonResponse([{ name: 'a' }, { name: 'b' }]);
      return undefined;
    });
    const s = supabaseStorage(db);
    await s.upload('briefing-audio', `${USER}/b1.mp3`, bytes, 'audio/mpeg');
    const upload = stub.calls[0]!;
    assertEquals(upload.headers.get('x-upsert'), 'true');
    assertEquals(
      new TextDecoder().decode(
        (await s.download('briefing-audio', `${USER}/b1.mp3`, 1000)) ?? new Uint8Array(),
      ),
      'ID3 audio bytes',
    );
    const big = await assertRejects(
      () => s.download('briefing-audio', `${USER}/b1.mp3`, 3),
      AppError,
    );
    assertEquals(big.code, 'PAYLOAD_TOO_LARGE');
    assertEquals(await s.download('captures', `${USER}/missing.pdf`, 1000), null);

    assertEquals(await s.stat('captures', `${USER}/cap-1.pdf`), { size: 2048 });
    const list = JSON.parse(
      stub.calls.find((c) => c.url.endsWith('/object/list/captures'))?.body ?? '{}',
    ) as Record<string, unknown>;
    assertEquals([list.prefix, list.search], [USER, 'cap-1.pdf']);
    assertEquals(await s.stat('captures', `${USER}/nope.pdf`), null);
    assertEquals(
      await s.stat('captures', 'cap-1.pdf.bak'),
      { size: 0 },
      'a root path lists the bucket root; bad sizes read as 0',
    );

    await s.remove('captures', []);
    assertEquals(stub.calls.filter((c) => c.method === 'DELETE').length, 0);
    await s.remove('captures', ['a', 'b']);
    assertEquals(JSON.parse(stub.calls.find((c) => c.method === 'DELETE')?.body ?? '{}'), {
      prefixes: ['a', 'b'],
    });

    const bad = supabaseStorage(failing().db);
    assertEquals(
      (await assertRejects(() => bad.upload('captures', 'x', bytes, 'application/pdf'), AppError))
        .details,
      { reason: 'upload_failed' },
    );
    assertEquals((await assertRejects(() => bad.stat('captures', 'a/b'), AppError)).details, {
      reason: 'list_failed',
    });
    assertEquals((await assertRejects(() => bad.remove('captures', ['a']), AppError)).details, {
      reason: 'remove_failed',
    });
  },
);

Deno.test(
  'privacy storage (IT-PRIV-01/02): recursive listing, batched unique removal, export signing',
  async () => {
    const listed: string[] = [];
    const { stub, db } = storage((call, p) => {
      if (p === '/object/list/exports') {
        const body = JSON.parse(call.body ?? '{}') as { prefix: string; offset: number };
        listed.push(`${body.prefix}@${String(body.offset)}`);
        if (body.prefix === USER)
          return jsonResponse([
            { name: '2026-09', id: null },
            { name: 'a.zip', id: 'o1' },
          ]);
        if (body.prefix === `${USER}/2026-09`) return jsonResponse([{ name: 'b.zip', id: 'o2' }]);
        return jsonResponse([]);
      }
      if (call.method === 'DELETE') {
        const body = JSON.parse(call.body ?? '{}') as { prefixes: string[] };
        return jsonResponse(body.prefixes.map((name) => ({ name })));
      }
      if (call.method === 'POST' && p.startsWith('/object/exports/'))
        return jsonResponse({ Key: p });
      if (p.startsWith('/object/sign/exports/')) return jsonResponse({ signedURL: `${p}?token=t` });
      return undefined;
    });
    const store = supabaseObjectStore(db);
    assertEquals(await store.list('exports', `${USER}/`), [
      `${USER}/a.zip`,
      `${USER}/2026-09/b.zip`,
    ]);
    assertEquals(listed, [`${USER}@0`, `${USER}/2026-09@0`]);
    const paths = Array.from({ length: 205 }, (_, i) => `${USER}/f${String(i)}.zip`);
    assertEquals(await removeInBatches(store, 'exports', [...paths, paths[0]!, '']), 205);
    assertEquals(
      stub.calls
        .filter((c) => c.method === 'DELETE')
        .map((c) => (JSON.parse(c.body ?? '{}') as { prefixes: string[] }).prefixes.length),
      [100, 100, 5],
    );
    assertEquals(await store.remove('exports', []), 0);
    await store.upload('exports', `${USER}/x.zip`, new Blob(['PK']), 'application/zip');
    assert((await store.signedUrl('exports', `${USER}/x.zip`, 300)).includes('token=t'));

    const bad = supabaseObjectStore(failing().db);
    for (const op of [
      () => bad.upload('exports', 'a', new Blob(['x']), 'application/zip'),
      () => bad.remove('exports', ['a']),
      () => bad.list('exports', USER),
      () => bad.signedUrl('exports', 'a', 60),
    ]) {
      const e = await assertRejects(op, AppError);
      assertEquals(
        [e.code, e.retryable, (e.details as { reason: string }).reason],
        ['SERVICE_UNAVAILABLE', true, 'storage_unavailable'],
      );
    }
  },
);
