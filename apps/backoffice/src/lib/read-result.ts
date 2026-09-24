/** A failed page read, as handed from a server component to its state component (serialisable). */
export interface ReadFailure {
  readonly code: string;
  readonly correlationId: string;
  /** admin-api refused the read for this admin (`FORBIDDEN`). */
  readonly forbidden: boolean;
  /** The record does not exist or was deleted (`NOT_FOUND`). */
  readonly notFound: boolean;
}

/** What a list page hands its client DataTable: one page of rows and the page meta, or a state. */
export interface TableData<Row> {
  readonly rows: readonly Row[];
  readonly total: number;
  readonly totalIsEstimate: boolean;
  readonly status: 'ready' | 'error' | 'forbidden' | 'aggregatesOnly';
  readonly error?: { readonly code: string; readonly correlationId: string };
}

type ListResult<Row> =
  | {
      readonly ok: true;
      readonly data: readonly Row[];
      readonly meta: { readonly total: number; readonly total_is_estimate: boolean };
    }
  | { readonly ok: false; readonly error: ReadFailure };

/**
 * Page rows + meta, or the table state for a failure. A refused row-level read shows the
 * aggregates-only copy when the admin can still see the page's aggregate panels (§4.2 notes).
 */
export function toTableData<Row>(
  result: ListResult<Row>,
  options: { aggregatesVisible?: boolean } = {},
): TableData<Row> {
  if (result.ok) {
    return {
      rows: result.data,
      total: result.meta.total,
      totalIsEstimate: result.meta.total_is_estimate,
      status: 'ready',
    };
  }
  if (result.error.forbidden) {
    return {
      rows: [],
      total: 0,
      totalIsEstimate: false,
      status: options.aggregatesVisible === true ? 'aggregatesOnly' : 'forbidden',
    };
  }
  return {
    rows: [],
    total: 0,
    totalIsEstimate: false,
    status: 'error',
    error: { code: result.error.code, correlationId: result.error.correlationId },
  };
}

/** A whole list (small, unpaginated route) cut to one page for the DataTable (`?page=&size=`). */
export function pageOf<Row>(
  rows: readonly Row[],
  page: number,
  size: number,
): { rows: readonly Row[]; total: number } {
  const start = Math.max(0, (Math.max(1, page) - 1) * size);
  return { rows: rows.slice(start, start + size), total: rows.length };
}
