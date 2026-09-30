import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Icon } from '@/components/icon';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { ReadFailure } from '@/lib/read-result';
import type { StatusTone } from '@/lib/status-tone';

/*
 * Module building blocks shared by every admin page (BACKOFFICE_PLAN §5.1, §5.3, §5.6): KPI tiles,
 * titled panels with independent states, key/value lists, breakdown bars, link tabs and the state for
 * a failed read (error with correlation id and retry, forbidden, not found). Server-compatible.
 */

export function StatGrid({
  children,
  label,
  columns = 4,
}: {
  children: ReactNode;
  label: string;
  columns?: 3 | 4 | 5;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2',
        columns === 3 && 'xl:grid-cols-3',
        columns === 4 && 'xl:grid-cols-4',
        columns === 5 && 'xl:grid-cols-5',
      )}
    >
      {children}
    </ul>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  testId,
  tone,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  testId?: string;
  tone?: StatusTone;
}) {
  return (
    <li className="rounded-card-sm bg-surface p-5 shadow-card">
      <p className="text-bo-kicker text-ink-3 uppercase">{label}</p>
      <p
        className={cn(
          'mt-2 text-h1 tabular-nums',
          tone === 'critical' ? 'text-tone-critical-text' : 'text-ink',
          tone === 'warning' && 'text-tone-warning-text',
        )}
        data-testid={testId}
      >
        {value}
      </p>
      {hint === undefined ? null : <div className="mt-2 text-bo-meta text-ink-3">{hint}</div>}
    </li>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
  testId,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  testId?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-4', className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          {headingLevel === 2 ? (
            <CardTitle>{title}</CardTitle>
          ) : (
            <h3 className="text-h3 text-ink">{title}</h3>
          )}
          {description === undefined ? null : (
            <p className="text-bo-meta text-ink-2">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </Card>
  );
}

export interface KeyValueItem {
  readonly label: string;
  readonly value: ReactNode;
  readonly mono?: boolean;
}

export function KeyValueList({
  items,
  columns = 2,
}: {
  items: readonly KeyValueItem[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 xl:grid-cols-3',
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-bo-meta text-ink-3">{item.label}</dt>
          <dd
            className={cn(
              'text-bo-body break-words text-ink',
              item.mono === true && 'font-mono text-bo-mono',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface BarItem {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly display: string;
}

/** Horizontal breakdown bars; each row carries its label and value as text (never colour alone). */
export function BarList({
  items,
  label,
  tone = 'info',
  emptyText,
}: {
  items: readonly BarItem[];
  label: string;
  tone?: 'info' | 'critical' | 'warning' | 'success' | 'primary';
  emptyText: string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0 || max === 0) {
    return <p className="py-4 text-center text-bo-body text-ink-2">{emptyText}</p>;
  }
  const bar = {
    info: 'bg-tone-info-solid',
    critical: 'bg-tone-critical-solid',
    warning: 'bg-tone-warning-solid',
    success: 'bg-tone-success-solid',
    primary: 'bg-primary',
  }[tone];
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-3"
        >
          <span className="truncate text-bo-body text-ink">{item.label}</span>
          <span aria-hidden="true" className="h-2 rounded-pill bg-surface-sunken">
            <span
              className={cn('block h-2 rounded-pill', bar)}
              style={{ width: `${String(Math.max(2, (item.value / max) * 100))}%` }}
            />
          </span>
          <span className="text-bo-table text-ink tabular-nums">{item.display}</span>
        </li>
      ))}
    </ul>
  );
}

export interface TabItem {
  readonly key: string;
  readonly href: string;
  readonly label: string;
}

/** Link tabs (the selected tab uses the primary-soft background, §5.1). */
export function TabNav({
  items,
  active,
  label,
}: {
  items: readonly TabItem[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border-hairline">
        {items.map((item) => {
          const current = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px flex min-h-10 items-center border-b-2 px-3 text-bo-body font-semibold outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  current
                    ? 'border-primary text-on-soft'
                    : 'border-transparent text-ink-2 hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A segmented control of links (ranges, groupings) that keeps the rest of the URL. */
export function SegmentedLinks({
  items,
  active,
  label,
}: {
  items: readonly TabItem[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="inline-flex rounded-tile bg-surface-sunken p-1">
        {items.map((item) => {
          const current = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-8 items-center rounded-[8px] px-3 text-bo-body font-semibold text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  current && 'bg-surface text-ink shadow-s1',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** `?key=value` merged into the current search params (for links that change one setting). */
export function withParam(
  path: string,
  params: Readonly<Record<string, string | string[] | undefined>>,
  changes: Readonly<Record<string, string | null>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  for (const [key, value] of Object.entries(changes)) {
    search.delete(key);
    if (value !== null) search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** The state for a failed read: forbidden (or aggregates-only), not found, or error + retry. */
export function ReadError({
  error,
  aggregatesOnly = false,
  backHref,
  title,
  compact = false,
}: {
  error: ReadFailure;
  aggregatesOnly?: boolean;
  backHref?: string;
  title?: string;
  compact?: boolean;
}) {
  const t = useTranslations('backoffice.states');
  if (error.forbidden) return <ForbiddenState aggregatesOnly={aggregatesOnly} />;
  if (error.notFound) {
    return (
      <EmptyState
        icon="search_off"
        title={t('notFound')}
        action={
          backHref === undefined ? undefined : (
            <Link href={backHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <Icon name="arrow_back" size={16} />
              {t('backToList')}
            </Link>
          )
        }
      />
    );
  }
  return (
    <ErrorState
      {...(title === undefined ? {} : { title })}
      code={error.code}
      correlationId={error.correlationId}
      refreshOnRetry
      compact={compact}
    />
  );
}

/** A short, monospaced id with the full value as the accessible name and tooltip. */
export function ShortId({ id, href }: { id: string; href?: string }) {
  const text = <span className="font-mono text-bo-mono">{id.slice(0, 8)}</span>;
  if (href === undefined) {
    return (
      <span title={id} aria-label={id}>
        {text}
      </span>
    );
  }
  return (
    <Link href={href} title={id} aria-label={id} className="text-text-link hover:underline">
      {text}
    </Link>
  );
}
