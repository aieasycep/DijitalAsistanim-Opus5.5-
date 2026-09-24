/**
 * Backoffice list plumbing (API_CONTRACTS §2.8, §12.1): `?page=&page_size=&sort=&order=&q=&
 * filter[k]=` → the `admin_api` list arguments `(p_page, p_page_size, p_sort, p_filter)`, and the
 * SQL `{rows, total, page, page_size}` → the paged envelope.
 */
import { arr, count, filterArg, type Json, obj, sortArg } from './map.ts';
import type { PageInfo, RouteResult } from './route.ts';

export interface ListQuery {
  readonly page: number;
  readonly page_size: number;
  readonly sort?: string | undefined;
  readonly order: 'asc' | 'desc';
  readonly q?: string | undefined;
}

export function listArgs(
  query: Json,
  options: {
    readonly filters?: Readonly<Record<string, string>>;
    readonly sortAliases?: Readonly<Record<string, string>>;
    readonly extraFilter?: Json;
  } = {},
): { p_page: number; p_page_size: number; p_sort: string | null; p_filter: Json } {
  const q = query as unknown as ListQuery;
  return {
    p_page: q.page,
    p_page_size: q.page_size,
    p_sort: sortArg(q.sort, q.order, options.sortAliases),
    p_filter: { ...filterArg(query, options.filters ?? {}), ...(options.extraFilter ?? {}) },
  };
}

export function pageOf(query: Json, out: Json): PageInfo {
  const q = query as unknown as ListQuery;
  return { page: q.page, page_size: q.page_size, total: count(out.total) };
}

/** Maps `{rows, total}` to a paged result. */
export function paged(query: Json, out: unknown, row: (r: Json) => unknown): RouteResult {
  const o = obj(out);
  return { data: arr(o.rows).map(row), page: pageOf(query, o) };
}

/** Pages an in-memory list (SQL functions that return every row). */
export function pageRows<T>(query: Json, rows: readonly T[]): RouteResult {
  const q = query as unknown as ListQuery;
  const start = (q.page - 1) * q.page_size;
  return {
    data: rows.slice(start, start + q.page_size),
    page: { page: q.page, page_size: q.page_size, total: rows.length },
  };
}

/** `filter[key]` of the validated query (`undefined` when absent or not a string). */
export function filterValue(query: Json, key: string): string | undefined {
  const value = query[`filter[${key}]`];
  return typeof value === 'string' ? value : undefined;
}

/** The free-text `q` of the validated query. */
export function qValue(query: Json): string | undefined {
  return typeof query.q === 'string' && query.q !== '' ? query.q : undefined;
}

/** An empty page (an exact-match search that matched nothing). */
export function emptyPage(query: Json): RouteResult {
  const q = query as unknown as ListQuery;
  return { data: [], page: { page: q.page, page_size: q.page_size, total: 0 } };
}
