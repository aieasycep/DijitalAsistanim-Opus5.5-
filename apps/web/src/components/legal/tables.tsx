import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { RETENTION_SCHEDULE, type RetentionPeriod } from '@/content/retention.ts';
import type { Subprocessor } from '@/content/subprocessors.ts';

/**
 * Tables rendered from the single sources (`RETENTION_SCHEDULE`, `SUBPROCESSORS`,
 * `DELETION_SCOPE`): a real `<table>` from 768 px, a stacked definition list below it so nothing
 * scrolls horizontally (Part 5 §3.3).
 */
export interface StackedTableProps {
  readonly caption: string;
  readonly head: readonly string[];
  readonly rows: readonly { readonly key: string; readonly cells: readonly ReactNode[] }[];
  readonly testId?: string;
}

export function StackedTable({ caption, head, rows, testId }: StackedTableProps): ReactNode {
  return (
    <div data-testid={testId} className="my-6">
      <table className="hidden w-full border-collapse overflow-hidden rounded-card-sm bg-surface text-left shadow-s1-soft md:table">
        <caption className="pb-3 text-left text-label text-ink-2">{caption}</caption>
        <thead>
          <tr className="border-b border-border-row bg-surface-sunken">
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-4 py-3 align-bottom text-label text-ink">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              data-row={row.key}
              className="border-b border-border-row align-top last:border-b-0"
            >
              {row.cells.map((cell, index) =>
                index === 0 ? (
                  <th
                    key={index}
                    scope="row"
                    className="px-4 py-3 text-secondary font-medium text-ink"
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={index} className="px-4 py-3 text-secondary text-ink-2">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="md:hidden">
        <p className="pb-3 text-label text-ink-2">{caption}</p>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.key} className="rounded-card-sm bg-surface p-4 shadow-s1-soft">
              <p className="text-label text-ink">{row.cells[0]}</p>
              <dl className="mt-2 flex flex-col gap-2">
                {row.cells.slice(1).map((cell, index) => (
                  <div key={index}>
                    <dt className="text-meta text-ink-3">{head[index + 1]}</dt>
                    <dd className="text-secondary text-ink-2">{cell}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export async function retentionRows(
  backupDays: number | undefined,
): Promise<{ key: string; label: string; period: string }[]> {
  const t = await getTranslations('webPages.legal.retention');
  const period = (value: RetentionPeriod): string => {
    switch (value.kind) {
      case 'userChoice':
        return t('periods.userChoice');
      case 'notStored':
        return t('periods.notStored');
      case 'afterAnalysisHours':
        return t('periods.afterAnalysisHours', { hours: value.hours });
      case 'exportHours':
        return t('periods.exportHours', { hours: value.hours });
      case 'untilDisconnect':
        return t('periods.untilDisconnect');
      case 'untilSignOut':
        return t('periods.untilSignOut');
      case 'analyticsDays':
        return t('periods.analyticsDays', { days: value.days });
      case 'days':
        return t('periods.days', { days: value.days });
      case 'upToDays':
        return t('periods.upToDays', { days: value.days });
      case 'yearsAfterClosure':
        return t('periods.yearsAfterClosure', { years: value.years });
      case 'auditYears':
        return t('periods.auditYears', { years: value.years });
      case 'deletionYears':
        return t('periods.deletionYears', { years: value.years });
      case 'backup':
        return backupDays === undefined
          ? t('periods.backupUnset')
          : t('periods.backupDays', { days: backupDays });
      case 'aiProviders':
        return t('periods.aiProviders');
    }
  };
  return RETENTION_SCHEDULE.map((row) => ({
    key: row.id,
    label: t(`rows.${row.id}`),
    period: period(row.period),
  }));
}

export async function RetentionTable({
  backupDays,
}: {
  backupDays: number | undefined;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.legal.retention');
  const rows = await retentionRows(backupDays);
  return (
    <StackedTable
      testId="retention-table"
      caption={t('caption')}
      head={[t('colData'), t('colPeriod')]}
      rows={rows.map((row) => ({ key: row.key, cells: [row.label, row.period] }))}
    />
  );
}

export async function SubprocessorTable({
  rows,
}: {
  rows: readonly Subprocessor[];
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.legal.subprocessors');
  return (
    <StackedTable
      testId="subprocessor-table"
      caption={t('caption')}
      head={[t('colProvider'), t('colPurpose'), t('colData'), t('colLocation'), t('colCondition')]}
      rows={rows.map((row) => ({
        key: row.id,
        cells: [
          row.id === 'email'
            ? t('rows.email.name', { provider: row.providerName ?? t('emailProviderGeneric') })
            : t(`rows.${row.id}.name`),
          t(`rows.${row.id}.purpose`),
          t(`rows.${row.id}.data`),
          row.location.kind === 'custom'
            ? t('locations.custom', { label: row.location.label })
            : t(`locations.${row.location.key}`),
          t(`conditions.${row.condition}`),
        ],
      }))}
    />
  );
}
