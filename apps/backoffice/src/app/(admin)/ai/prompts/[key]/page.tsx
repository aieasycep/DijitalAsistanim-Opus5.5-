import { PROMPT_KEY_VALUES } from '@da/validation/ai/index';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { Icon } from '@/components/icon';
import { KeyValueList, Panel, ReadError, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { PromptTabs } from '../../ai-tabs';
import { CompareForm, PromptVersionActions } from './prompt-controls';

/*
 * Prompt key (BACKOFFICE_PLAN §6.11; M§58; REQ-BO-PROMPT-01..06): the versions with their status
 * (drafts dashed), author, dates and 7-day telemetry (requests, error rate, positive feedback), the
 * selected version's templates, output schema and notes, the unified diff between two versions and
 * the draft → edit → test → activate → rollback / archive actions. Prompts are product content; the
 * test runs synthetic fixtures only.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.prompts');
  return { title: t('title') };
}

function isPromptKey(value: string): value is (typeof PROMPT_KEY_VALUES)[number] {
  return (PROMPT_KEY_VALUES as readonly string[]).includes(value);
}

export default async function PromptKeyPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  if (!isPromptKey(key)) notFound();
  const [t, f, sp, result] = await Promise.all([
    getTranslations('backoffice.prompts'),
    getFormatters(),
    searchParams,
    readAdmin('GET /ai/prompts/:key', { params: { key } }),
  ]);
  const back = (
    <Link
      href="/ai/prompts"
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
        <PageHeader title={key} />
        <Card>
          <ReadError error={result.error} backHref="/ai/prompts" />
        </Card>
      </>
    );
  }
  const versions = [...result.data.versions].sort((a, b) => b.version - a.version);
  const active = versions.find((v) => v.status === 'active');
  const requested = Number(Array.isArray(sp.version) ? sp.version[0] : sp.version);
  const selected = versions.find((v) => v.version === requested) ?? active ?? versions[0] ?? null;
  const compare = typeof sp.compare === 'string' ? /^(\d+)\.\.(\d+)$/.exec(sp.compare) : null;
  return (
    <>
      {back}
      <PageHeader title={key} description={t('keyDescription')} />
      <PromptTabs active="prompts" />
      <Panel title={t('versions')}>
        {versions.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noVersions')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-bo-table tabular-nums" data-testid="prompt-versions">
              <caption className="sr-only">{t('versions')}</caption>
              <thead>
                <tr className="text-left text-bo-meta text-ink-2">
                  {(
                    [
                      'version',
                      'status',
                      'createdBy',
                      'created',
                      'activated',
                      'requests',
                      'errorRate',
                      'positive',
                    ] as const
                  ).map((column) => (
                    <th key={column} scope="col" className="py-1.5 pr-3 font-semibold">
                      {t(`columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr
                    key={version.version}
                    aria-current={selected?.version === version.version ? 'true' : undefined}
                    className={cn(
                      'border-t border-border-row',
                      selected?.version === version.version && 'bg-primary-soft',
                      version.status === 'draft' &&
                        'outline-1 -outline-offset-1 outline-border-strong outline-dashed',
                    )}
                  >
                    <td className="py-1.5 pr-3">
                      <Link
                        href={withParam(`/ai/prompts/${key}`, sp, {
                          version: String(version.version),
                          compare: null,
                        })}
                        className="font-mono font-semibold text-text-link hover:underline"
                      >
                        {t('version', { v: version.version })}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge group="promptStatus" value={version.status} />
                    </td>
                    <td className="py-1.5 pr-3 text-ink">{version.created_by ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-ink">{f.dateTime(version.created_at)}</td>
                    <td className="py-1.5 pr-3 text-ink">{f.dateTime(version.activated_at)}</td>
                    <td className="py-1.5 pr-3 text-ink">{f.number(version.telemetry.requests)}</td>
                    <td className="py-1.5 pr-3 text-ink">
                      {f.percent(version.telemetry.error_rate)}
                    </td>
                    <td className="py-1.5 pr-3 text-ink">
                      {f.percent(version.telemetry.feedback_positive_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {versions.length >= 2 ? (
          <CompareForm promptKey={key} versions={versions.map((v) => v.version)} />
        ) : null}
      </Panel>
      {compare === null ? null : (
        <Suspense fallback={<LoadingState rows={6} />}>
          <DiffPanel promptKey={key} from={Number(compare[1])} to={Number(compare[2])} />
        </Suspense>
      )}
      {selected === null ? null : (
        <Suspense key={selected.version} fallback={<LoadingState rows={6} />}>
          <VersionPanel
            promptKey={key}
            version={selected.version}
            activeVersion={active?.version ?? null}
          />
        </Suspense>
      )}
    </>
  );
}

async function VersionPanel({
  promptKey,
  version,
  activeVersion,
}: {
  promptKey: (typeof PROMPT_KEY_VALUES)[number];
  version: number;
  activeVersion: number | null;
}) {
  const [t, f] = await Promise.all([getTranslations('backoffice.prompts'), getFormatters()]);
  const result = await readAdmin('GET /ai/prompts/:key/versions/:v', {
    params: { key: promptKey, v: String(version) },
  });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const detail = result.data;
  return (
    <Panel
      title={t('versionTitle', { v: detail.version })}
      testId="prompt-version"
      className={
        detail.status === 'draft' ? 'border border-dashed border-border-strong' : undefined
      }
      actions={
        <PromptVersionActions
          promptKey={promptKey}
          version={detail.version}
          status={detail.status}
          activeVersion={activeVersion}
          templateSystem={detail.template_system}
          templateUser={detail.template_user}
          outputSchema={detail.output_schema}
          notes={detail.notes}
        />
      }
    >
      <KeyValueList
        columns={3}
        items={[
          {
            label: t('columns.status'),
            value: <StatusBadge group="promptStatus" value={detail.status} />,
          },
          { label: t('outputSchema'), value: detail.output_schema, mono: true },
          { label: t('schemaHash'), value: detail.schema_hash?.slice(0, 16) ?? '—', mono: true },
          { label: t('columns.createdBy'), value: detail.created_by ?? '—' },
          { label: t('columns.created'), value: f.dateTime(detail.created_at) },
          { label: t('columns.activated'), value: f.dateTime(detail.activated_at) },
        ]}
      />
      {detail.notes === null ? null : <p className="text-bo-body text-ink-2">{detail.notes}</p>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <section className="flex flex-col gap-1">
          <h3 className="text-bo-kicker text-ink-3 uppercase">{t('systemTemplate')}</h3>
          <pre className="max-h-96 overflow-auto rounded-tile bg-surface-sunken p-3 font-mono text-bo-mono whitespace-pre-wrap text-ink">
            {detail.template_system}
          </pre>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="text-bo-kicker text-ink-3 uppercase">{t('userTemplate')}</h3>
          <pre className="max-h-96 overflow-auto rounded-tile bg-surface-sunken p-3 font-mono text-bo-mono whitespace-pre-wrap text-ink">
            {detail.template_user}
          </pre>
        </section>
      </div>
    </Panel>
  );
}

async function DiffPanel({
  promptKey,
  from,
  to,
}: {
  promptKey: (typeof PROMPT_KEY_VALUES)[number];
  from: number;
  to: number;
}) {
  const t = await getTranslations('backoffice.prompts');
  const result = await readAdmin('GET /ai/prompts/:key/diff', {
    params: { key: promptKey },
    query: { from, to },
  });
  return (
    <Panel title={t('diffTitle', { from, to })} testId="prompt-diff">
      {!result.ok ? (
        <ReadError error={result.error} compact />
      ) : result.data.diff.trim() === '' ? (
        <p className="text-bo-body text-ink-2">{t('noDiff')}</p>
      ) : (
        <pre className="max-h-[32rem] overflow-auto rounded-tile bg-surface-sunken p-3 font-mono text-bo-mono">
          {result.data.diff.split('\n').map((line, index) => (
            <span
              key={index}
              className={cn(
                'block min-h-4 whitespace-pre-wrap',
                line.startsWith('+') &&
                  !line.startsWith('+++') &&
                  'bg-tone-success-soft text-tone-success-text',
                line.startsWith('-') &&
                  !line.startsWith('---') &&
                  'bg-tone-critical-soft text-tone-critical-text-strong',
                line.startsWith('@@') && 'text-ink-3',
              )}
            >
              {line}
            </span>
          ))}
        </pre>
      )}
    </Panel>
  );
}
