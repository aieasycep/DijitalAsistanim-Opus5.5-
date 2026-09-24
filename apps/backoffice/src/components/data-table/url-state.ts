import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType,
} from 'nuqs/server';

/*
 * DataTable URL state (BACKOFFICE_PLAN §5.3 "URL state (nuqs)"): `?page=&size=&sort=&order=&q=` and
 * `f.<filter>=a,b` for enum filters. Every table state is deep-linkable and survives reload. The same
 * parsers run on the server (page loaders build the admin-api query) and in the client hook.
 */

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export function tableParsers(filterKeys: readonly string[] = []) {
  const filters: Record<`f.${string}`, ReturnType<typeof parseAsArrayOf<string>>> = {};
  for (const key of filterKeys) filters[`f.${key}`] = parseAsArrayOf(parseAsString, ',');
  return {
    page: parseAsInteger.withDefault(1),
    size: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
    sort: parseAsString,
    order: parseAsStringLiteral(['asc', 'desc'] as const).withDefault('desc'),
    q: parseAsString,
    ...filters,
  };
}

export type TableUrlState = inferParserType<ReturnType<typeof tableParsers>> &
  Record<`f.${string}`, string[] | null>;

/** Server-side loader for a page's `searchParams`. */
export function loadTableState(
  searchParams: Record<string, string | string[] | undefined>,
  filterKeys: readonly string[] = [],
): TableUrlState {
  return createLoader(tableParsers(filterKeys))(searchParams);
}

export function serializeTableState(
  state: Partial<TableUrlState>,
  filterKeys: readonly string[] = [],
): string {
  return createSerializer(tableParsers(filterKeys))(state as never);
}

function clampSize(size: number): PageSize {
  return (PAGE_SIZES as readonly number[]).includes(size) ? (size as PageSize) : DEFAULT_PAGE_SIZE;
}

/**
 * The admin-api list query (`@da/validation` `adminListQuery`: `page`, `page_size`, `sort`,
 * `order`, `q`, `filter[<key>]`). Only allow-listed sort columns and filter keys are forwarded; the
 * route's zod contract validates the rest.
 */
export function toAdminListQuery(
  state: TableUrlState,
  options: {
    sortable: readonly string[];
    filterKeys?: readonly string[];
    /** Per-filter conversion (e.g. a `YYYY-MM-DD` day → an ISO bound); `undefined` drops it. */
    transform?: Readonly<Record<string, (values: readonly string[]) => string | undefined>>;
    /** `false` for routes whose contract has no `q` (identifier search). */
    search?: boolean;
  },
): Record<string, string | number | undefined> {
  const query: Record<string, string | number | undefined> = {
    page: Math.max(1, Math.floor(state.page)),
    page_size: clampSize(state.size),
    order: state.order,
  };
  if (state.sort !== null && options.sortable.includes(state.sort)) query.sort = state.sort;
  if (options.search !== false && state.q !== null && state.q.trim() !== '') {
    query.q = state.q.trim();
  }
  for (const key of options.filterKeys ?? []) {
    const values = state[`f.${key}`];
    if (values !== null && values !== undefined && values.length > 0) {
      const convert = options.transform?.[key];
      const value = convert === undefined ? values.join(',') : convert(values);
      if (value !== undefined) query[`filter[${key}]`] = value;
    }
  }
  return query;
}

/** `YYYY-MM-DD` → the ISO instant at the start (`from`) or end (`to`) of that UTC day. */
export function dayBound(edge: 'from' | 'to') {
  return (values: readonly string[]): string | undefined => {
    const day = values[0];
    if (day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
    return edge === 'from' ? `${day}T00:00:00Z` : `${day}T23:59:59Z`;
  };
}

/** Keeps only the first value (routes whose filter takes one enum value). */
export function firstValue(values: readonly string[]): string | undefined {
  return values[0];
}

/** True when any filter or identifier search narrows the list (drives the filtered-empty copy). */
export function hasActiveFilters(
  state: TableUrlState,
  filterKeys: readonly string[] = [],
): boolean {
  if (state.q !== null && state.q.trim() !== '') return true;
  return filterKeys.some((key) => (state[`f.${key}`]?.length ?? 0) > 0);
}
