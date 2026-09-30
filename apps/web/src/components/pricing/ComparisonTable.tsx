import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { FreeLimits } from '@/lib/pricing.ts';
import { IconCheck, IconRemoveCircle } from '../icons/generated/index.ts';

type Cell =
  | { readonly kind: 'yes' }
  | { readonly kind: 'no' }
  | { readonly kind: 'text'; readonly text: string };

/** Row keys shared with the in-app paywall (`paywall.features.*`), in M§44 order. */
export const COMPARISON_ROWS = [
  'mailAccounts',
  'calendars',
  'morningBriefing',
  'todayFlow',
  'mailIntel',
  'replyDrafts',
  'approvals',
  'assistant',
  'middayEvening',
  'meetingPrep',
  'followUps',
  'audioBriefing',
  'memoryVip',
  'planning',
  'capture',
  'androidNi',
  'aiLimit',
] as const;

const FREE_INCLUDED = new Set([
  'morningBriefing',
  'todayFlow',
  'mailIntel',
  'replyDrafts',
  'approvals',
  'assistant',
]);

/**
 * W-PRICE-01 P3: a real `<table>` with row and column headers and a caption. Three columns at every
 * width; long labels wrap so there is no horizontal scroll.
 */
export async function ComparisonTable({
  limits,
}: {
  limits: FreeLimits | null;
}): Promise<ReactNode> {
  const features = await getTranslations('paywall.features');
  const values = await getTranslations('paywall.values');
  const web = await getTranslations('web.pricing');
  const page = await getTranslations('webPages.pricing');
  const common = await getTranslations('webPages.common');

  const cells = (row: (typeof COMPARISON_ROWS)[number]): readonly [Cell, Cell] => {
    switch (row) {
      case 'mailAccounts':
        return [
          { kind: 'text', text: limits === null ? values('limited') : String(limits.mail) },
          { kind: 'text', text: values('moreThanOne') },
        ];
      case 'calendars':
        return [
          { kind: 'text', text: limits === null ? values('limited') : String(limits.cal) },
          { kind: 'text', text: values('moreThanOne') },
        ];
      case 'aiLimit':
        return [
          {
            kind: 'text',
            text: limits === null ? values('limited') : values('perDay', { count: limits.n }),
          },
          { kind: 'text', text: values('fairUseHigh') },
        ];
      default:
        return [FREE_INCLUDED.has(row) ? { kind: 'yes' } : { kind: 'no' }, { kind: 'yes' }];
    }
  };

  const render = (cell: Cell): ReactNode => {
    if (cell.kind === 'text') return <span className="tabular">{cell.text}</span>;
    if (cell.kind === 'yes') {
      return (
        <>
          <IconCheck size={20} className="mx-auto text-icon-ai" />
          <span className="sr-only">{common('included')}</span>
        </>
      );
    }
    return (
      <>
        <IconRemoveCircle size={18} className="mx-auto text-icon-idle" />
        <span className="sr-only">{common('notIncluded')}</span>
      </>
    );
  };

  return (
    <div className="rounded-hero bg-surface p-2 shadow-card md:p-4">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="px-3 pt-3 pb-4 text-left text-web-h3 md:px-4 xl:text-web-h3-lg">
          {web('tableCaption')}
        </caption>
        <colgroup>
          <col />
          <col className="w-[72px] md:w-[120px]" />
          <col className="w-[72px] md:w-[120px]" />
        </colgroup>
        <thead className="sticky top-16 bg-surface">
          <tr className="border-b border-border-row">
            <th scope="col" className="px-3 py-3 text-label text-ink-2 md:px-4">
              <span className="sr-only">{page('featureColumn')}</span>
            </th>
            <th scope="col" className="px-1 py-3 text-center text-label md:px-3">
              {page('freeColumn')}
            </th>
            <th scope="col" className="px-1 py-3 text-center text-label md:px-3">
              {page('proColumn')}
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => {
            const [free, pro] = cells(row);
            return (
              <tr key={row} data-row={row} className="border-b border-border-row last:border-b-0">
                <th
                  scope="row"
                  className="px-3 py-3 text-secondary font-normal text-ink md:px-4 md:text-body"
                >
                  {features(row)}
                </th>
                <td className="px-1 py-3 text-center text-secondary md:px-3">{render(free)}</td>
                <td className="px-1 py-3 text-center text-secondary md:px-3">{render(pro)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 pt-4 pb-2 text-meta text-ink-3 md:px-4">
        {(await getTranslations('paywall'))('fairUseNote')}
      </p>
    </div>
  );
}
