'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { PAGE_SIZES, type PageSize } from './url-state';

/** Server pagination footer: range, page status, previous/next and page size (§5.3). */
export function Pagination({
  page,
  pageSize,
  rowCount,
  total,
  totalIsEstimate,
  pageCount,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  rowCount: number;
  total: number;
  totalIsEstimate: boolean;
  pageCount: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSize: (size: PageSize) => void;
}) {
  const t = useTranslations('backoffice.table');
  const sizeId = useId();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + rowCount;
  const values = { from, to, total };
  return (
    <nav
      aria-label={t('pageStatus', { page, pages: Math.max(1, pageCount) })}
      className="flex flex-wrap items-center justify-between gap-3 text-bo-meta text-ink-2"
    >
      <p className="tabular-nums">
        {totalIsEstimate ? t('rangeEstimate', values) : t('range', values)}
      </p>
      <div className="flex items-center gap-3">
        <label htmlFor={sizeId} className="flex items-center gap-2">
          {t('rowsPerPage')}
          <select
            id={sizeId}
            value={pageSize}
            onChange={(e) => {
              onPageSize(Number(e.target.value) as PageSize);
            }}
            className="h-8 rounded-tile border border-border-control bg-surface px-2 text-bo-body text-ink"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="tabular-nums" aria-hidden="true">
          {t('pageStatus', { page, pages: Math.max(1, pageCount) })}
        </span>
        <Button variant="secondary" size="sm" disabled={!canPrevious} onClick={onPrevious}>
          <Icon name="arrow_back" size={16} />
          {t('previous')}
        </Button>
        <Button variant="secondary" size="sm" disabled={!canNext} onClick={onNext}>
          {t('next')}
          <Icon name="arrow_forward" size={16} />
        </Button>
      </div>
    </nav>
  );
}
