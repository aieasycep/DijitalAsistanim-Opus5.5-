'use client';

import {
  columnVisibilityFeature,
  createColumnHelper,
  functionalUpdate,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryStates } from 'nuqs';
import { useMemo, useState, useTransition, type ReactNode } from 'react';

import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { cn } from '@/lib/cn';
import { ColumnHeader } from './column-header';
import { Pagination } from './pagination';
import { Toolbar, type DataTableFilter } from './toolbar';
import { PAGE_SIZES, hasActiveFilters, tableParsers, type TableUrlState } from './url-state';

/*
 * DataTable (BACKOFFICE_PLAN §5.3, M§70): TanStack Table v9 `useTable({features})` with manual
 * (server) sorting, pagination and filtering. Rows come from the server component; URL state lives
 * in nuqs with `shallow: false`, so every change re-renders the server component, and a transition
 * drives the pending overlay (rows at 60 % opacity + a 2 px progress bar). Column visibility is
 * persisted per table in `admin_preferences.table_prefs[tableId]`.
 */

const features = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
});
type Features = typeof features;

export interface DataTableColumn<Row> {
  readonly id: string;
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  /** Allow-listed server sort column (§5.3 "Sorting"). */
  readonly sortable?: boolean;
  /** Identifier / primary columns cannot be hidden. */
  readonly required?: boolean;
  readonly align?: 'start' | 'end';
}

export interface DataTablePrefs {
  readonly hidden?: readonly string[];
  readonly pageSize?: number;
}

export interface DataTableProps<Row> {
  readonly tableId: string;
  /** Accessible table caption (visually hidden). */
  readonly caption: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly total: number;
  readonly totalIsEstimate?: boolean;
  readonly getRowId: (row: Row) => string;
  /** Detail route per row; the first cell renders as a link (⌘-click opens a new tab). */
  readonly rowHref?: (row: Row) => string;
  readonly status?: 'ready' | 'error' | 'forbidden' | 'aggregatesOnly';
  readonly error?: { readonly code: string; readonly correlationId: string };
  readonly filters?: readonly DataTableFilter[];
  /** Identifier search box (`q`, never a content search, M§69). */
  readonly searchable?: boolean;
  /** Allowed identifier shape for the search box (regex source). */
  readonly searchPattern?: string;
  /** Per-row actions (a menu or buttons), rendered in a trailing column. */
  readonly rowActions?: (row: Row) => ReactNode;
  /** Accessible header of the actions column. */
  readonly actionsLabel?: string;
  /** A row the admin opened (detail panel), highlighted with `aria-current`. */
  readonly selectedRowId?: string;
  readonly emptyTitle?: string;
  readonly density?: 'comfortable' | 'compact';
  readonly prefs?: DataTablePrefs;
  /** Persists `table_prefs[tableId]` (e.g. `saveTablePrefsAction`). */
  readonly onPrefsChange?: (tableId: string, prefs: DataTablePrefs) => unknown;
}

function visibilityFrom(hidden: readonly string[] | undefined): ColumnVisibilityState {
  const state: ColumnVisibilityState = {};
  for (const id of hidden ?? []) state[id] = false;
  return state;
}

export function DataTable<Row extends RowData>({
  tableId,
  caption,
  columns,
  rows,
  total,
  totalIsEstimate = false,
  getRowId,
  rowHref,
  status = 'ready',
  error,
  filters = [],
  searchable = false,
  searchPattern,
  rowActions,
  actionsLabel,
  selectedRowId,
  emptyTitle,
  density = 'comfortable',
  prefs,
  onPrefsChange,
}: DataTableProps<Row>) {
  const t = useTranslations('backoffice.table');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const filterKeys = useMemo(() => filters.map((f) => f.key), [filters]);
  const parsers = useMemo(() => tableParsers(filterKeys), [filterKeys]);
  const [url, setUrl] = useQueryStates(parsers, {
    shallow: false,
    startTransition,
    history: 'push',
  });
  const state = url as TableUrlState;
  const requiredIds = useMemo(
    () => new Set(columns.filter((c) => c.required === true).map((c) => c.id)),
    [columns],
  );
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() =>
    visibilityFrom(prefs?.hidden?.filter((id) => !requiredIds.has(id))),
  );

  const columnDefs = useMemo(() => {
    const helper = createColumnHelper<Features, Row>();
    // An accessor (the row itself) makes TanStack treat the column as sortable; values are never
    // sorted client-side (`manualSorting`), the server orders the rows.
    return columns.map((column) =>
      helper.accessor((row: Row): unknown => row, {
        id: column.id,
        header: column.header,
        enableSorting: column.sortable === true,
        enableHiding: column.required !== true,
        cell: (ctx) => column.cell(ctx.row.original),
      }),
    );
  }, [columns]);

  const pageSize = (PAGE_SIZES as readonly number[]).includes(state.size)
    ? state.size
    : PAGE_SIZES[0];
  const sorting: SortingState =
    state.sort === null ? [] : [{ id: state.sort, desc: state.order === 'desc' }];
  const pagination: PaginationState = { pageIndex: Math.max(0, state.page - 1), pageSize };

  const table = useTable({
    features,
    columns: columnDefs,
    data: rows,
    getRowId: (row: Row) => getRowId(row),
    manualSorting: true,
    manualPagination: true,
    rowCount: total,
    enableSortingRemoval: true,
    sortDescFirst: false,
    state: { sorting, pagination, columnVisibility },
    onSortingChange: (updater) => {
      const next = functionalUpdate(updater, sorting)[0];
      void setUrl({
        sort: next?.id ?? null,
        order: next === undefined ? null : next.desc ? 'desc' : 'asc',
        page: null,
      });
    },
    onPaginationChange: (updater) => {
      const next = functionalUpdate(updater, pagination);
      void setUrl({
        page: next.pageIndex + 1 === 1 ? null : next.pageIndex + 1,
        size: next.pageSize === PAGE_SIZES[0] ? null : next.pageSize,
      });
    },
    onColumnVisibilityChange: (updater) => {
      const next = Object.fromEntries(
        Object.entries(functionalUpdate(updater, columnVisibility)).filter(
          ([id]) => !requiredIds.has(id),
        ),
      );
      setColumnVisibility(next);
      const hidden = Object.entries(next)
        .filter(([, visible]) => !visible)
        .map(([id]) => id);
      onPrefsChange?.(tableId, { hidden });
    },
  });

  const filtered = hasActiveFilters(state, filterKeys);
  const clearFilters = () => {
    const cleared: Record<string, null> = { q: null, page: null };
    for (const key of filterKeys) cleared[`f.${key}`] = null;
    void setUrl(cleared);
  };
  const cellPadding = density === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2.5';

  let body: ReactNode;
  if (status === 'error') {
    body = (
      <ErrorState
        code={error?.code}
        correlationId={error?.correlationId}
        onRetry={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
      />
    );
  } else if (status === 'forbidden' || status === 'aggregatesOnly') {
    body = <ForbiddenState aggregatesOnly={status === 'aggregatesOnly'} />;
  } else if (rows.length === 0) {
    body = filtered ? (
      <EmptyState
        icon="search_off"
        title={t('emptyFiltered')}
        action={
          <button
            type="button"
            className="text-bo-body font-semibold text-text-link hover:underline"
            onClick={clearFilters}
          >
            {t('clearFilters')}
          </button>
        }
      />
    ) : (
      <EmptyState title={emptyTitle ?? t('emptyDefault')} />
    );
  }

  return (
    <div data-slot="data-table" className="flex flex-col gap-3">
      <Toolbar
        table={table}
        filters={filters}
        state={state}
        searchable={searchable}
        {...(searchPattern === undefined ? {} : { searchPattern })}
        onFilterChange={(key, values) => {
          void setUrl({ [`f.${key}`]: values.length === 0 ? null : values, page: null });
        }}
        onSearch={(q) => {
          void setUrl({ q: q === '' ? null : q, page: null });
        }}
        onClear={clearFilters}
      />
      <div className="relative overflow-hidden rounded-card-sm bg-surface shadow-card">
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0 z-10 h-0.5 origin-left bg-primary transition-opacity',
            pending ? 'animate-pulse opacity-100' : 'opacity-0',
          )}
        />
        {body ?? (
          <div className="overflow-x-auto">
            <table
              className={cn(
                'w-full border-collapse text-bo-table tabular-nums',
                pending && 'opacity-60',
              )}
              aria-busy={pending}
            >
              <caption className="sr-only">{caption}</caption>
              <thead className="bg-surface-sunken">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <ColumnHeader
                        key={header.id}
                        header={header}
                        label={String(header.column.columnDef.header ?? header.id)}
                        align={columns.find((c) => c.id === header.column.id)?.align}
                        className={cellPadding}
                      />
                    ))}
                    {rowActions === undefined ? null : (
                      <th
                        scope="col"
                        className={cn(
                          cellPadding,
                          'text-right text-bo-meta font-semibold text-ink-2',
                        )}
                      >
                        <span className="sr-only">{actionsLabel ?? t('rowActions')}</span>
                      </th>
                    )}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => {
                  const href = rowHref?.(row.original);
                  return (
                    <tr
                      key={row.id}
                      aria-current={selectedRowId === row.id ? 'true' : undefined}
                      className={cn(
                        'border-t border-border-row hover:bg-surface-pressed',
                        selectedRowId === row.id && 'bg-primary-soft hover:bg-primary-soft',
                      )}
                    >
                      {row.getVisibleCells().map((cell, index) => {
                        const align = columns.find((c) => c.id === cell.column.id)?.align;
                        const content = <table.FlexRender cell={cell} />;
                        return (
                          <td
                            key={cell.id}
                            className={cn(cellPadding, 'text-ink', align === 'end' && 'text-right')}
                          >
                            {index === 0 && href !== undefined ? (
                              <Link
                                href={href}
                                className="font-semibold text-text-link hover:underline"
                              >
                                {content}
                              </Link>
                            ) : (
                              content
                            )}
                          </td>
                        );
                      })}
                      {rowActions === undefined ? null : (
                        <td className={cn(cellPadding, 'text-right whitespace-nowrap')}>
                          <div className="inline-flex items-center justify-end gap-1">
                            {rowActions(row.original)}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {status === 'ready' && rows.length > 0 ? (
        <Pagination
          page={pagination.pageIndex + 1}
          pageSize={pageSize}
          rowCount={rows.length}
          total={total}
          totalIsEstimate={totalIsEstimate}
          canPrevious={table.getCanPreviousPage()}
          canNext={table.getCanNextPage()}
          pageCount={table.getPageCount()}
          onPrevious={() => {
            table.previousPage();
          }}
          onNext={() => {
            table.nextPage();
          }}
          onPageSize={(size) => {
            table.setPagination({ pageIndex: 0, pageSize: size });
            onPrefsChange?.(tableId, { pageSize: size });
          }}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {pending ? t('loading') : ''}
      </span>
    </div>
  );
}

export type { DataTableFilter };
