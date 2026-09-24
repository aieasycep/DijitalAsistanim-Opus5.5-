import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { Icon } from '@/components/icon';
import { JobActions } from '@/components/job-actions';
import { KeyValueList, Panel, ReadError } from '@/components/module-kit';
import { LoadingState } from '@/components/states/loading-state';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { UUID_PATTERN } from '@/lib/ids';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';

/*
 * Job detail (BACKOFFICE_PLAN §6.6, §8; M§53, M§118): the job, its payload redacted to ids, the
 * attempts timeline, child jobs and the correlation chain (webhook → sync → analysis → AI request →
 * briefing → notification → audit) with links into each module.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.jobs');
  return { title: t('detailTitle') };
}

/** In-app routes the correlation trace may link to (never external URLs). */
function safeLink(link: string | null): string | null {
  return link !== null && /^\/[A-Za-z0-9/_\-.?=&%]*$/.test(link) ? link : null;
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [t, f, result] = await Promise.all([
    getTranslations('backoffice.jobs'),
    getFormatters(),
    readAdmin('GET /jobs/:id', { params: { id } }),
  ]);
  const back = (
    <Link
      href="/jobs"
      className="flex items-center gap-1 text-bo-body font-semibold text-text-link hover:underline"
    >
      <Icon name="arrow_back" size={16} />
      {t('back')}
    </Link>
  );
  if (!result.ok) {
    return (
      <>
        {back}
        <h1 className="text-bo-page-title text-ink">{t('detailTitle')}</h1>
        <Card>
          <ReadError error={result.error} backHref="/jobs" />
        </Card>
      </>
    );
  }
  const job = result.data;
  return (
    <>
      {back}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-bo-mono text-ink-3">{job.id}</p>
          <h1 className="flex items-center gap-2 text-bo-page-title text-ink">
            <EnumLabel group="jobType" value={job.type} />
            <StatusBadge group="jobStatus" value={job.status} />
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <JobActions jobId={job.id} type={job.type} status={job.status} size="md" />
        </div>
      </header>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={t('detail.summary')}>
          <KeyValueList
            items={[
              {
                label: t('columns.attempts'),
                value: `${f.number(job.attempts)}/${f.number(job.max_attempts)}`,
              },
              { label: t('columns.error'), value: job.last_error_code ?? '—', mono: true },
              { label: t('columns.runAfter'), value: f.dateTime(job.run_after) },
              { label: t('columns.created'), value: f.dateTime(job.created_at) },
              {
                label: t('columns.user'),
                value:
                  job.user_id === null ? (
                    '—'
                  ) : (
                    <Link
                      href={`/users/${job.user_id}/overview`}
                      className="font-mono text-text-link hover:underline"
                    >
                      {job.user_id.slice(0, 8)}
                    </Link>
                  ),
              },
              { label: t('columns.correlation'), value: job.correlation_id ?? '—', mono: true },
            ]}
          />
        </Panel>
        <Panel title={t('detail.payload')} description={t('detail.payloadHint')}>
          {Object.keys(job.payload).length === 0 ? (
            <p className="text-bo-body text-ink-2">{t('detail.noPayload')}</p>
          ) : (
            <KeyValueList
              columns={1}
              items={Object.entries(job.payload).map(([key, value]) => ({
                label: key,
                value: value === null ? '—' : String(value),
                mono: true,
              }))}
            />
          )}
        </Panel>
        <Panel title={t('detail.attempts')}>
          {job.attempts_history.length === 0 ? (
            <p className="text-bo-body text-ink-2">{t('detail.noAttempts')}</p>
          ) : (
            <ol className="flex flex-col gap-2" data-testid="attempts-timeline">
              {job.attempts_history.map((attempt) => (
                <li
                  key={attempt.attempt}
                  className="flex flex-wrap items-center gap-2 border-l-2 border-border-strong pl-3 text-bo-table"
                >
                  <span className="font-semibold text-ink">
                    {t('detail.attempt', { n: attempt.attempt })}
                  </span>
                  <StatusBadge group="attemptOutcome" value={attempt.outcome} />
                  <span className="text-ink-3">{f.dateTime(attempt.started_at)}</span>
                  <span className="text-ink-3">{f.duration(attempt.duration_ms)}</span>
                  {attempt.error_code === null ? null : (
                    <span className="font-mono text-tone-critical-text">{attempt.error_code}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title={t('detail.children')}>
          {job.children.length === 0 ? (
            <p className="text-bo-body text-ink-2">{t('detail.noChildren')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {job.children.map((child) => (
                <li key={child.id} className="flex items-center gap-2 text-bo-table">
                  <Link
                    href={`/jobs/${child.id}`}
                    className="font-mono text-text-link hover:underline"
                  >
                    {child.id.slice(0, 8)}
                  </Link>
                  <EnumLabel group="jobType" value={child.type} />
                  <StatusBadge group="jobStatus" value={child.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {job.correlation_id === null ? null : (
          <Suspense fallback={<LoadingState rows={5} />}>
            <CorrelationChain correlationId={job.correlation_id} />
          </Suspense>
        )}
      </div>
    </>
  );
}

async function CorrelationChain({ correlationId }: { correlationId: string }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.jobs'), getFormatters()]);
  const result = await readAdmin('GET /correlation/:id', { params: { id: correlationId } });
  return (
    <Panel
      title={t('detail.chain')}
      description={t('detail.chainHint', { id: correlationId })}
      className="xl:col-span-2"
    >
      {!result.ok ? (
        <ReadError error={result.error} compact />
      ) : result.data.length === 0 ? (
        <p className="text-bo-body text-ink-2">{t('detail.noChain')}</p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="correlation-chain">
          {result.data.map((entry, index) => {
            const first = result.data[0];
            const offset = first === undefined ? 0 : Date.parse(entry.ts) - Date.parse(first.ts);
            const link = safeLink(entry.link);
            return (
              <li
                key={`${entry.kind}-${entry.id}-${String(index)}`}
                className="flex flex-wrap items-center gap-2 border-l-2 border-primary pl-3 text-bo-table"
              >
                <span className="font-semibold text-ink">
                  <EnumLabel group="traceKind" value={entry.kind} />
                </span>
                {entry.status === null ? null : (
                  <StatusBadge group="jobStatus" value={entry.status} />
                )}
                <span className="font-mono text-ink-2">{entry.label_key}</span>
                <span className="text-ink-3 tabular-nums">
                  {index === 0 ? f.dateTime(entry.ts) : `+${f.duration(offset)}`}
                </span>
                {link === null ? null : (
                  <Link href={link} className="text-text-link hover:underline">
                    {t('detail.open')}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
