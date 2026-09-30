'use client';

import { useTranslations } from 'next-intl';

import { Icon } from '@/components/icon';
import { cn } from '@/lib/cn';

/** The parts of a TanStack header the column header needs (kept structural for tests). */
export interface SortableHeader {
  readonly id: string;
  readonly isPlaceholder: boolean;
  readonly column: {
    getCanSort(): boolean;
    getIsSorted(): false | 'asc' | 'desc';
    toggleSorting(desc?: boolean, isMulti?: boolean): void;
    clearSorting(): void;
  };
}

/**
 * Table header cell (BACKOFFICE_PLAN §5.3 "Sorting"): 12/16/600 sentence case, `aria-sort`, and a
 * button for allow-listed columns that cycles ascending → descending → default with Enter or Space.
 */
export function ColumnHeader({
  header,
  label,
  align,
  className,
}: {
  header: SortableHeader;
  label: string;
  align?: 'start' | 'end' | undefined;
  className?: string;
}) {
  const t = useTranslations('backoffice.table');
  const sortable = header.column.getCanSort();
  const sorted = header.column.getIsSorted();
  const ariaSort =
    sorted === 'asc'
      ? 'ascending'
      : sorted === 'desc'
        ? 'descending'
        : sortable
          ? 'none'
          : undefined;

  function cycle() {
    if (sorted === false) header.column.toggleSorting(false);
    else if (sorted === 'asc') header.column.toggleSorting(true);
    else header.column.clearSorting();
  }

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'text-left text-bo-meta font-semibold whitespace-nowrap text-ink-2',
        align === 'end' && 'text-right',
        className,
      )}
    >
      {header.isPlaceholder ? null : sortable ? (
        <button
          type="button"
          onClick={cycle}
          className="-mx-1 inline-flex min-h-8 items-center gap-1 rounded-[6px] px-1 hover:text-ink focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label={`${t('sortBy', { column: label })}. ${
            sorted === 'asc'
              ? t('sortAscending')
              : sorted === 'desc'
                ? t('sortDescending')
                : t('sortNone')
          }`}
        >
          {label}
          <Icon
            name={
              sorted === 'asc'
                ? 'arrow_upward'
                : sorted === 'desc'
                  ? 'arrow_downward'
                  : 'expand_more'
            }
            size={16}
            className={sorted === false ? 'text-ink-3' : 'text-ink'}
          />
        </button>
      ) : (
        label
      )}
    </th>
  );
}
