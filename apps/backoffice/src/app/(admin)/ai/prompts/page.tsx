import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Panel, ReadError } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { readAdmin } from '@/server/read';
import { PromptTabs } from '../ai-tabs';
import { KeyFilter } from './key-filter';

/*
 * Prompt Yönetimi (BACKOFFICE_PLAN §6.11; M§58; T-10.10): every prompt key of the AI pipeline
 * catalogue with its active version. A key opens its versions (draft, active, archived), telemetry,
 * the diff view and activate / rollback / archive.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.prompts');
  return { title: t('title') };
}

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, result] = await Promise.all([
    getTranslations('backoffice.prompts'),
    searchParams,
    readAdmin('GET /ai/prompts'),
  ]);
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PromptTabs active="prompts" />
      {!result.ok ? (
        <Card>
          <ReadError error={result.error} />
        </Card>
      ) : (
        <Panel title={t('keys')} actions={<KeyFilter value={q} />}>
          {(() => {
            const rows = result.data.filter((row) => q === '' || row.key.includes(q));
            if (rows.length === 0) return <p className="text-bo-body text-ink-2">{t('noKeys')}</p>;
            return (
              <table className="w-full text-bo-table tabular-nums" data-testid="prompt-keys">
                <caption className="sr-only">{t('keys')}</caption>
                <thead>
                  <tr className="text-left text-bo-meta text-ink-2">
                    <th scope="col" className="py-1.5 pr-3 font-semibold">
                      {t('columns.key')}
                    </th>
                    <th scope="col" className="py-1.5 font-semibold">
                      {t('columns.active')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t border-border-row">
                      <td className="py-1.5 pr-3">
                        <Link
                          href={`/ai/prompts/${row.key}`}
                          className="font-mono font-semibold text-text-link hover:underline"
                        >
                          {row.key}
                        </Link>
                      </td>
                      <td className="py-1.5 text-ink">
                        {row.active_version === null
                          ? t('noActive')
                          : t('version', { v: row.active_version })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </Panel>
      )}
    </>
  );
}
