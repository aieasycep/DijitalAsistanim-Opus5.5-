'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type SubmitEvent } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ColumnVisibilityMenu, type VisibilityColumn } from './column-visibility-menu';
import type { TableUrlState } from './url-state';

export interface DataTableFilter {
  readonly key: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

/** The slice of a TanStack table the toolbar reads (column list and visibility). */
export interface ToolbarTable {
  getAllLeafColumns(): readonly {
    id: string;
    columnDef: { header?: unknown };
    getIsVisible(): boolean;
    getCanHide(): boolean;
    toggleVisibility(value?: boolean): void;
  }[];
}

/**
 * Toolbar (§5.3 "Filtering"): identifier search, typed enum filter menus, removable chips for the
 * active filters with "Filtreleri temizle", and the column visibility menu.
 */
export function Toolbar({
  table,
  filters,
  state,
  searchable,
  onFilterChange,
  onSearch,
  onClear,
}: {
  table: ToolbarTable;
  filters: readonly DataTableFilter[];
  state: TableUrlState;
  searchable: boolean;
  onFilterChange: (key: string, values: string[]) => void;
  onSearch: (q: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations('backoffice.table');
  const searchId = useId();
  const [q, setQ] = useState(state.q ?? '');

  const columns: VisibilityColumn[] = table.getAllLeafColumns().map((column) => ({
    id: column.id,
    label: typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
    visible: column.getIsVisible(),
    canHide: column.getCanHide(),
    toggle: (visible) => {
      column.toggleVisibility(visible);
    },
  }));

  const chips = filters.flatMap((filter) =>
    (state[`f.${filter.key}`] ?? []).map((value) => ({
      filter,
      value,
      label: filter.options.find((o) => o.value === value)?.label ?? value,
    })),
  );
  const anyActive = chips.length > 0 || (state.q !== null && state.q !== '');

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(q.trim());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {searchable ? (
          <form role="search" onSubmit={submit} className="flex items-center gap-2">
            <label htmlFor={searchId} className="sr-only">
              {t('search')}
            </label>
            <Input
              id={searchId}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
              }}
              placeholder={t('search')}
              className="h-8 w-64"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="secondary" size="sm">
              <Icon name="search" size={16} />
              {t('searchSubmit')}
            </Button>
          </form>
        ) : null}
        {filters.map((filter) => {
          const selected = state[`f.${filter.key}`] ?? [];
          return (
            <DropdownMenu key={filter.key}>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Icon name="filter_alt" size={16} />
                  {filter.label}
                  {selected.length > 0 ? (
                    <span className="rounded-pill bg-primary-soft px-1.5 text-bo-meta tabular-nums text-ink">
                      {selected.length}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {filter.options.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={selected.includes(option.value)}
                    onSelect={(event) => {
                      event.preventDefault();
                    }}
                    onCheckedChange={(checked) => {
                      onFilterChange(
                        filter.key,
                        checked
                          ? [...selected, option.value]
                          : selected.filter((v) => v !== option.value),
                      );
                    }}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        <div className="ml-auto">
          <ColumnVisibilityMenu columns={columns} />
        </div>
      </div>
      {anyActive ? (
        <ul aria-label={t('activeFilters')} className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={`${chip.filter.key}:${chip.value}`}>
              <button
                type="button"
                aria-label={t('removeFilter', { filter: `${chip.filter.label}: ${chip.label}` })}
                onClick={() => {
                  onFilterChange(
                    chip.filter.key,
                    (state[`f.${chip.filter.key}`] ?? []).filter((v) => v !== chip.value),
                  );
                }}
                className="inline-flex min-h-8 items-center gap-1 rounded-pill bg-primary-soft px-3 text-bo-meta font-semibold text-on-soft hover:bg-brand-soft-pressed"
              >
                {chip.filter.label}
                {': '}
                {chip.label}
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
          <li>
            <Button variant="link" size="sm" onClick={onClear}>
              {t('clearFilters')}
            </Button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
