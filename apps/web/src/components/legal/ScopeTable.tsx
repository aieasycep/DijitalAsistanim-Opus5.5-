import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DELETION_SCOPE } from '@/content/deletion-scope.ts';
import { StackedTable } from './tables.tsx';

/** W-DEL-01 §6.3 "Neler silinir?", rendered from `DELETION_SCOPE`. */
export async function ScopeTable(): Promise<ReactNode> {
  const t = await getTranslations('webPages.deletion.scope');
  return (
    <StackedTable
      testId="deletion-scope"
      caption={t('caption')}
      head={[t('colData'), t('colAccount'), t('colHistory')]}
      rows={DELETION_SCOPE.map((row) => ({
        key: row.id,
        cells: [t(`rows.${row.id}`), t(`outcomes.${row.account}`), t(`outcomes.${row.history}`)],
      }))}
    />
  );
}
