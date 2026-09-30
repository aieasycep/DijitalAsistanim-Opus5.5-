'use client';

import type { JobRow } from '@da/validation/admin/jobs';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';

import { ActionButton } from '@/components/action-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { BULK_RETRY_TYPED_THRESHOLD } from '@/lib/job-policy';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { JobActions } from '@/components/job-actions';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';
import { JOB_STATUSES, JOB_TYPES_ORDERED } from './config';

type Row = z.infer<typeof JobRow>;
const UUID_SOURCE = '^[0-9a-fA-F-]{36}$';
/** "Canlı (10 sn)" (§6.6): client polling through `/api/admin/jobs` (R-19: no Realtime). */
export const LIVE_INTERVAL_MS = 10_000;
/** Only failed and dead-letter jobs can be retried (the SQL guard re-checks each one). */
const RETRYABLE = new Set(['failed', 'dead_letter']);

interface LiveData {
  readonly rows: Row[];
  readonly total: number;
  readonly totalIsEstimate: boolean;
}

/** The live view: re-reads the current page every 10 s while on; background activity only. */
function useLiveJobs(on: boolean, query: Readonly<Record<string, string | number | undefined>>) {
  // Results are keyed by the page query, so a stale page's rows never show after navigation.
  const [state, setState] = useState<{
    readonly key: string;
    readonly data: LiveData | null;
    readonly failed: boolean;
  }>({ key: '', data: null, failed: false });
  const search = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return params.toString();
  }, [query]);
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/admin/jobs?${search}`, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`jobs_${String(response.status)}`);
        const body = (await response.json()) as {
          rows: Row[];
          total: number;
          total_is_estimate: boolean;
        };
        if (cancelled) return;
        setState({
          key: search,
          data: { rows: body.rows, total: body.total, totalIsEstimate: body.total_is_estimate },
          failed: false,
        });
      } catch {
        if (!cancelled) {
          setState((prev) => ({
            key: search,
            data: prev.key === search ? prev.data : null,
            failed: true,
          }));
        }
      }
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, LIVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [on, search]);
  return on && state.key === search
    ? { data: state.data, failed: state.failed }
    : { data: null, failed: false };
}

export function JobsTable({
  data,
  deadOnly,
  listQuery,
  canRetry,
}: {
  data: TableData<Row>;
  deadOnly: boolean;
  /** The admin-api query of the current page (the live view re-reads exactly this page). */
  listQuery: Readonly<Record<string, string | number | undefined>>;
  canRetry: boolean;
}) {
  const t = useTranslations('backoffice.jobs');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('jobs');
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const liveJobs = useLiveJobs(live && data.status === 'ready', listQuery);
  const rows = liveJobs.data?.rows ?? data.rows;
  const selectedIds = [...selected];
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'id',
      header: t('columns.id'),
      required: true,
      cell: (row) => <span className="font-mono">{row.id.slice(0, 8)}</span>,
    },
    {
      id: 'type',
      header: t('columns.type'),
      cell: (row) => <EnumLabel group="jobType" value={row.type} />,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="jobStatus" value={row.status} />,
    },
    {
      id: 'user',
      header: t('columns.user'),
      cell: (row) =>
        row.user_id === null ? (
          '—'
        ) : (
          <Link
            href={`/users/${row.user_id}/overview`}
            className="font-mono text-text-link hover:underline"
          >
            {row.user_id.slice(0, 8)}
          </Link>
        ),
    },
    {
      id: 'attempts',
      header: t('columns.attempts'),
      sortable: true,
      align: 'end',
      cell: (row) => `${f.number(row.attempts)}/${f.number(row.max_attempts)}`,
    },
    {
      id: 'run_after',
      header: t('columns.runAfter'),
      sortable: true,
      cell: (row) => f.dateTime(row.run_after),
    },
    {
      id: 'created_at',
      header: t('columns.created'),
      sortable: true,
      cell: (row) => f.dateTime(row.created_at),
    },
    {
      id: 'error',
      header: t('columns.error'),
      cell: (row) => <span className="font-mono">{row.last_error_code ?? '—'}</span>,
    },
    {
      id: 'correlation',
      header: t('columns.correlation'),
      cell: (row) => <span className="font-mono">{row.correlation_id?.slice(0, 8) ?? '—'}</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={live ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={live}
          data-testid="jobs-live"
          onClick={() => {
            setLive((on) => !on);
          }}
        >
          <Icon name="refresh" size={16} />
          {t('live.toggle')}
        </Button>
        {live ? (
          <span role="status" className="text-bo-meta text-ink-3" data-testid="jobs-live-status">
            {liveJobs.failed ? t('live.failed') : t('live.on')}
          </span>
        ) : null}
        {canRetry && selected.size > 0 ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-tile bg-primary-soft px-3 py-1.5"
            data-testid="jobs-selection"
          >
            <span className="text-bo-body font-semibold text-ink">
              {t('selection.count', { count: selected.size })}
            </span>
            <ActionButton
              route="POST /jobs/retry-bulk"
              label={t('selection.retry')}
              variant="primary"
              testId="jobs-retry-selected"
              body={() => ({ job_ids: selectedIds })}
              title={t('selection.title', { count: selectedIds.length })}
              effects={t('selection.effects', { count: selectedIds.length })}
              {...(selectedIds.length > BULK_RETRY_TYPED_THRESHOLD
                ? { typedToken: t('bulk.token') }
                : {})}
              confirmLabel={t('bulk.confirm')}
              successMessage={(result) =>
                t('selection.done', {
                  retried: result.retried,
                  skipped: result.skipped?.length ?? 0,
                })
              }
              onSuccess={() => {
                setSelected(new Set());
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(new Set());
              }}
            >
              {t('selection.clear')}
            </Button>
          </div>
        ) : null}
      </div>
      <DataTable<Row>
        tableId="jobs"
        caption={t('caption')}
        columns={columns}
        rows={rows}
        total={liveJobs.data?.total ?? data.total}
        totalIsEstimate={liveJobs.data?.totalIsEstimate ?? data.totalIsEstimate}
        {...(canRetry
          ? {
              selection: {
                selected,
                onChange: setSelected,
                isSelectable: (row: Row) => RETRYABLE.has(row.status),
                rowLabel: (row: Row) => t('selection.row', { id: row.id.slice(0, 8) }),
                pageLabel: t('selection.page'),
              },
            }
          : {})}
        status={data.status}
        {...(data.error === undefined ? {} : { error: data.error })}
        getRowId={(row) => row.id}
        rowHref={(row) => `/jobs/${row.id}`}
        searchable
        searchPattern="^[0-9a-fA-F-]{8,64}$"
        emptyTitle={deadOnly ? t('emptyDead') : t('empty')}
        rowActions={(row) => <JobActions jobId={row.id} type={row.type} status={row.status} />}
        actionsLabel={t('columns.actions')}
        filters={[
          {
            key: 'status',
            label: t('filters.status'),
            single: true,
            options: JOB_STATUSES.map((value) => ({ value, label: label('jobStatus', value) })),
          },
          {
            key: 'type',
            label: t('filters.type'),
            single: true,
            options: JOB_TYPES_ORDERED.map((value) => ({ value, label: label('jobType', value) })),
          },
          {
            key: 'user_id',
            label: t('filters.user'),
            kind: 'text',
            pattern: UUID_SOURCE,
            options: [],
          },
          {
            key: 'account_id',
            label: t('filters.account'),
            kind: 'text',
            pattern: UUID_SOURCE,
            options: [],
          },
          { key: 'from', label: t('filters.from'), kind: 'date', options: [] },
          { key: 'to', label: t('filters.to'), kind: 'date', options: [] },
        ]}
        prefs={table.prefs}
        onPrefsChange={table.onPrefsChange}
        density={table.density}
      />
    </div>
  );
}
