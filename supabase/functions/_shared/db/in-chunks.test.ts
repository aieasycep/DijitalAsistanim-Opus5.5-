import { assertEquals, assertRejects } from '@std/assert';
import { IN_FILTER_CHUNK, inChunks } from './in-chunks.ts';

Deno.test('inChunks: runs one query per chunk in order and concatenates the rows', async () => {
  const seen: number[][] = [];
  const values = Array.from({ length: 250 }, (_, i) => i);
  const rows = await inChunks(values, (chunk) => {
    seen.push(chunk);
    return Promise.resolve(chunk.filter((v) => v % 50 === 0));
  });
  assertEquals(
    seen.map((c) => c.length),
    [IN_FILTER_CHUNK, IN_FILTER_CHUNK, 50],
  );
  assertEquals(seen.flat(), values);
  assertEquals(rows, [0, 50, 100, 150, 200]);
});

Deno.test('inChunks: no values → no query; a custom size; an invalid size is refused', async () => {
  let calls = 0;
  const query = (chunk: string[]) => {
    calls++;
    return Promise.resolve(chunk);
  };
  assertEquals(await inChunks([], query), []);
  assertEquals(calls, 0);
  assertEquals(await inChunks(['a', 'b', 'c'], query, 2), ['a', 'b', 'c']);
  assertEquals(calls, 2);
  await assertRejects(() => inChunks(['a'], query, 0), RangeError);
});
