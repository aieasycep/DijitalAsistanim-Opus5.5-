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
  options: { sortable: readonly string[]; filterKeys?: readonly string[] },
): Record<string, string | number | undefined> {
  const query: Record<string, string | number | undefined> = {
    page: Math.max(1, Math.floor(state.page)),
    page_size: clampSize(state.size),
    order: state.order,
  };
  if (state.sort !== null && options.sortable.includes(state.sort)) query.sort = state.sort;
  if (state.q !== null && state.q.trim() !== '') query.q = state.q.trim();
  for (const key of options.filterKeys ?? []) {
    const values = state[`f.${key}`];
    if (values !== null && values !== undefined && values.length > 0) {
      query[`filter[${key}]`] = values.join(',');
    }
  }
  return query;
}

/** True when any filter or identifier search narrows the list (drives the filtered-empty copy). */
export function hasActiveFilters(
  state: TableUrlState,
  filterKeys: readonly string[] = [],
): boolean {
  if (state.q !== null && state.q.trim() !== '') return true;
  return filterKeys.some((key) => (state[`f.${key}`]?.length ?? 0) > 0);
}
