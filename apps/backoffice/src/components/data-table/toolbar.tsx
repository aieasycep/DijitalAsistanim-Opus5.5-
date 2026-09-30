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
  /** Enum filters; text and date filters leave this empty. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** The route accepts one value for this filter: choosing an option replaces the previous one. */
  readonly single?: boolean;
  /** `text` (an exact id or key) or `date` (`YYYY-MM-DD`) input instead of an option menu. */
  readonly kind?: 'options' | 'text' | 'date';
  /** Allowed input for `text` filters (e.g. a uuid), checked before the URL changes. */
  readonly pattern?: string;
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
  searchPattern,
  onFilterChange,
  onSearch,
  onClear,
}: {
  table: ToolbarTable;
  filters: readonly DataTableFilter[];
  state: TableUrlState;
  searchable: boolean;
  /** Accepted identifier shape; anything else (e.g. an email) never reaches the URL. */
  searchPattern?: string;
  onFilterChange: (key: string, values: string[]) => void;
  onSearch: (q: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations('backoffice.table');
  const searchId = useId();
  const [q, setQ] = useState(state.q ?? '');
  const [searchInvalid, setSearchInvalid] = useState(false);

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
    const next = q.trim();
    if (next !== '' && searchPattern !== undefined && !new RegExp(searchPattern).test(next)) {
      setSearchInvalid(true);
      return;
    }
    setSearchInvalid(false);
    onSearch(next);
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
              aria-invalid={searchInvalid}
            />
            <Button type="submit" variant="secondary" size="sm">
              <Icon name="search" size={16} />
              {t('searchSubmit')}
            </Button>
            {searchInvalid ? (
              <span role="alert" className="text-bo-meta text-tone-critical-text">
                {t('searchInvalid')}
              </span>
            ) : null}
          </form>
        ) : null}
        {filters.map((filter) => {
          const selected = state[`f.${filter.key}`] ?? [];
          if (filter.kind === 'text' || filter.kind === 'date') {
            return (
              <InputFilter
                key={filter.key}
                filter={filter}
                value={selected[0] ?? ''}
                onApply={(value) => {
                  onFilterChange(filter.key, value === '' ? [] : [value]);
                }}
              />
            );
          }
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
                      const others = filter.single === true ? [] : selected;
                      onFilterChange(
                        filter.key,
                        checked
                          ? [...others.filter((v) => v !== option.value), option.value]
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

/** A text (exact id, key) or date filter: typed, checked against its pattern, then applied. */
function InputFilter({
  filter,
  value,
  onApply,
}: {
  filter: DataTableFilter;
  value: string;
  onApply: (value: string) => void;
}) {
  const t = useTranslations('backoffice.table');
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (next !== '' && filter.pattern !== undefined && !new RegExp(filter.pattern).test(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onApply(next);
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <label htmlFor={id} className="text-bo-meta font-semibold text-ink-2">
        {filter.label}
      </label>
      <Input
        id={id}
        type={filter.kind === 'date' ? 'date' : 'text'}
        value={draft}
        aria-invalid={invalid}
        autoComplete="off"
        spellCheck={false}
        className={filter.kind === 'date' ? 'h-8 w-40' : 'h-8 w-56 font-mono'}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <Button type="submit" variant="secondary" size="sm">
        {t('applyFilter')}
      </Button>
      {invalid ? (
        <span role="alert" className="text-bo-meta text-tone-critical-text">
          {t('invalidFilter')}
        </span>
      ) : null}
    </form>
  );
}
