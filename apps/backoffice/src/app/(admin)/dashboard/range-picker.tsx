'use client';

import { useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useTransition } from 'react';

import { setDashboardRangeAction } from '@/actions/preferences';
import { cn } from '@/lib/cn';
import { RANGES, type Range } from './ranges';

const LABEL_KEYS = { '24h': 'r24h', '7d': 'r7d', '30d': 'r30d', '90d': 'r90d' } as const;

/**
 * "24 saat · 7 gün · 30 gün · 90 gün" (BACKOFFICE_PLAN §6.1): URL state (`?range=`, re-renders the
 * server component) plus `PATCH /preferences {dashboard_range}` so the choice follows the admin.
 */
export function RangePicker({ value }: { value: Range }) {
  const t = useTranslations('backoffice.dashboard.range');
  const [pending, startTransition] = useTransition();
  const [, setRange] = useQueryState(
    'range',
    parseAsStringLiteral(RANGES).withOptions({ shallow: false, history: 'push', startTransition }),
  );
  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      aria-busy={pending}
      className="inline-flex rounded-tile bg-surface-sunken p-1"
    >
      {RANGES.map((range) => {
        const checked = range === value;
        return (
          <button
            key={range}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onKeyDown={(event) => {
              const index = RANGES.indexOf(value);
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              event.preventDefault();
              const next = RANGES[(index + step + RANGES.length) % RANGES.length] ?? value;
              void setRange(next);
              void setDashboardRangeAction(next);
              const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                `[data-range="${next}"]`,
              );
              target?.focus();
            }}
            data-range={range}
            onClick={() => {
              void setRange(range);
              void setDashboardRangeAction(range);
            }}
            className={cn(
              'min-h-8 rounded-[8px] px-3 text-bo-body font-semibold text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              checked && 'bg-surface text-ink shadow-s1',
            )}
          >
            {t(LABEL_KEYS[range])}
          </button>
        );
      })}
    </div>
  );
}
