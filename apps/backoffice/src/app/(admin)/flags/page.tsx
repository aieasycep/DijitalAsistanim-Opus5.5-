import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { KeyValueList, Panel, ReadError, SegmentedLinks, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { EnumLabel } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { targetingSummary, type TargetingLike } from '@/lib/flags';
import { UUID_PATTERN } from '@/lib/ids';
import { pageOf } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { EvaluateForm, FlagActions, NewFlagButton, OverrideControls } from './flag-controls';
import { FlagsTable } from './flags-table';

/*
 * Özellik Bayrakları (BACKOFFICE_PLAN §6.17; M§63; R-10; T-10.12): the R-10 keys with their
 * targeting (percentage, platform, plan, version range), the kill switch and the change history.
 * `?flag=<key>` opens the flag panel: targeting edit (L2), kill switch (L3, typed flag key), user
 * overrides, archive and the evaluation preview for one user. `flags.write_ai` (ai_ops) can change
 * only `ai.*` and `voice.*` keys; admin-api enforces the same rule.
 */

const PREFIXES = ['all', 'feature', 'ai', 'voice'] as const;
const FLAG_KEY = /^[a-z0-9_.]{1,80}$/;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.flags');
  return { title: t('title') };
}

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getTranslations('backoffice.flags'), searchParams]);
  const archived = params.archived === 'true';
  const prefix = PREFIXES.find((p) => p === params.prefix) ?? 'all';
  const selected =
    typeof params.flag === 'string' && FLAG_KEY.test(params.flag) ? params.flag : null;
  const result = await readAdmin('GET /flags', {
    query: { 'filter[archived]': archived ? 'true' : 'false' },
  });
  const rows = result.ok
    ? result.data.filter((row) => prefix === 'all' || row.key.startsWith(`${prefix}.`))
    : [];
  const page = Number(params.page ?? 1);
  const size = Number(params.size ?? 25);
  const sliced = pageOf(
    rows,
    Number.isInteger(page) ? page : 1,
    [25, 50, 100].includes(size) ? size : 25,
  );
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={<NewFlagButton />} />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedLinks
          label={t('prefix')}
          active={prefix}
          items={PREFIXES.map((key) => ({
            key,
            href: withParam('/flags', params, { prefix: key === 'all' ? null : key, page: null }),
            label: t(`prefixes.${key}`),
          }))}
        />
        <Link
          href={withParam('/flags', params, {
            archived: archived ? null : 'true',
            flag: null,
            page: null,
          })}
          className="text-bo-body font-semibold text-text-link hover:underline"
        >
          {archived ? t('showActive') : t('showArchived')}
        </Link>
      </div>
      {selected === null ? null : (
        <Suspense key={selected} fallback={<LoadingState rows={6} />}>
          <FlagPanel flagKey={selected} params={params} />
        </Suspense>
      )}
      {result.ok ? (
        <FlagsTable
          rows={sliced.rows}
          total={sliced.total}
          {...(selected === null ? {} : { selectedKey: selected })}
        />
      ) : (
        <Card>
          <ReadError error={result.error} />
        </Card>
      )}
    </>
  );
}

async function FlagPanel({
  flagKey,
  params,
}: {
  flagKey: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const [t, f] = await Promise.all([getTranslations('backoffice.flags'), getFormatters()]);
  const result = await readAdmin('GET /flags/:key', { params: { key: flagKey } });
  const closeHref = withParam('/flags', params, {
    flag: null,
    eval_user: null,
    eval_platform: null,
    eval_version: null,
  });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const flag = result.data;
  const evalUser =
    typeof params.eval_user === 'string' && UUID_PATTERN.test(params.eval_user)
      ? params.eval_user
      : null;
  const evalPlatform =
    params.eval_platform === 'ios' || params.eval_platform === 'android'
      ? params.eval_platform
      : undefined;
  const evalVersion =
    typeof params.eval_version === 'string' && /^\d+\.\d+\.\d+$/.test(params.eval_version)
      ? params.eval_version
      : undefined;
  const evaluation =
    evalUser === null
      ? null
      : await readAdmin('GET /flags/:key/evaluate', {
          params: { key: flagKey },
          query: {
            user_id: evalUser,
            ...(evalPlatform === undefined ? {} : { platform: evalPlatform }),
            ...(evalVersion === undefined ? {} : { app_version: evalVersion }),
          },
        });
  return (
    <Panel
      title={flag.key}
      description={flag.description ?? undefined}
      testId="flag-detail"
      actions={
        <>
          <FlagActions flag={flag} />
          <Link
            href={closeHref}
            className="text-bo-body font-semibold text-text-link hover:underline"
          >
            {t('close')}
          </Link>
        </>
      }
    >
      <KeyValueList
        columns={3}
        items={[
          {
            label: t('columns.state'),
            value: flag.enabled ? t('on') : flag.is_kill_switch ? t('killed') : t('off'),
          },
          { label: t('columns.targeting'), value: <TargetingSummary flag={flag} /> },
          { label: t('killSwitch'), value: flag.is_kill_switch ? t('yes') : t('no') },
          {
            label: t('columns.updated'),
            value: `${f.dateTime(flag.updated_at)} · ${flag.updated_by ?? '—'}`,
          },
          { label: t('archivedAt'), value: f.dateTime(flag.archived_at) },
          {
            label: t('payload'),
            value: flag.payload === null ? '—' : JSON.stringify(flag.payload),
            mono: true,
          },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="flex flex-col gap-2" aria-labelledby="flag-overrides">
          <h3 id="flag-overrides" className="text-bo-kicker text-ink-3 uppercase">
            {t('overrides')}
          </h3>
          <OverrideControls flagKey={flag.key} overrides={flag.overrides} />
        </section>
        <section className="flex flex-col gap-2" aria-labelledby="flag-evaluate">
          <h3 id="flag-evaluate" className="text-bo-kicker text-ink-3 uppercase">
            {t('evaluate')}
          </h3>
          <EvaluateForm flagKey={flag.key} />
          {evaluation === null ? null : evaluation.ok ? (
            <p
              className="flex flex-wrap gap-2 text-bo-body text-ink"
              role="status"
              data-testid="flag-evaluation"
            >
              <span>
                {t('evaluation', {
                  value: evaluation.data.value ? t('on') : t('off'),
                  bucket: evaluation.data.bucket,
                })}
              </span>
              <span className="font-semibold">
                <EnumLabel group="flagRule" value={evaluation.data.matched_rule} />
              </span>
            </p>
          ) : (
            <ReadError error={evaluation.error} compact />
          )}
        </section>
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="flag-history">
        <h3 id="flag-history" className="text-bo-kicker text-ink-3 uppercase">
          {t('history')}
        </h3>
        {flag.history.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noHistory')}</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {flag.history.map((entry, index) => (
              <li
                key={`${entry.ts}-${String(index)}`}
                className="flex flex-wrap gap-2 text-bo-table"
              >
                <span className="text-ink-3">{f.dateTime(entry.ts)}</span>
                <span className="font-mono text-ink">{entry.action}</span>
                <span className="text-ink">{entry.actor}</span>
                {entry.reason === null ? null : <span className="text-ink-2">{entry.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </Panel>
  );
}

function TargetingSummary({ flag }: { flag: TargetingLike }) {
  return <span className="font-mono text-bo-mono">{targetingSummary(flag)}</span>;
}
