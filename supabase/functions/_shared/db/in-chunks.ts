/**
 * PostgREST `in` filters travel in the request URL, and the API gateway in front of PostgREST
 * (Kong / nginx) refuses request lines over 8 KB. A filter over a list that grows with user data
 * (one key per device, one id per ticket) runs in chunks of `IN_FILTER_CHUNK` values: about 6 KB of
 * URL for 100 prefixed UUID keys once percent-encoded.
 */
export const IN_FILTER_CHUNK = 100;

/** Runs `query` once per chunk of `values` (in order) and concatenates the rows. */
export async function inChunks<V, R>(
  values: readonly V[],
  query: (chunk: V[]) => Promise<readonly R[]>,
  size: number = IN_FILTER_CHUNK,
): Promise<R[]> {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('inChunks: size must be ≥ 1');
  const out: R[] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(...(await query(values.slice(i, i + size))));
  }
  return out;
}
