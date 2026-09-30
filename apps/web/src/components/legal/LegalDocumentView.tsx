import type { Locale } from '@da/i18n';
import { formatCalendarDate } from '@/lib/dates.ts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Block, Inline, LegalDocument } from '@/content/legal/types.ts';
import type { Subprocessor } from '@/content/subprocessors.ts';
import { Link } from '@/i18n/navigation.ts';
import { IconArrowOutward } from '../icons/generated/index.ts';
import { LegalToc } from './LegalToc.tsx';
import { RetentionTable, StackedTable, SubprocessorTable } from './tables.tsx';

const linkClass = 'text-text-link underline underline-offset-4';

function InlineContent({ content }: { content: readonly Inline[] }): ReactNode {
  return content.map((part, index) => {
    if (typeof part === 'string') return part;
    switch (part.t) {
      case 'strong':
        return <strong key={index}>{part.text}</strong>;
      case 'mail':
        return (
          <a key={index} href={`mailto:${part.address}`} className={linkClass}>
            {part.address}
          </a>
        );
      case 'link':
        return (
          <a key={index} href={part.href} rel="noopener" className={linkClass}>
            {part.text}
            <IconArrowOutward size={14} className="ml-0.5 inline align-baseline" />
          </a>
        );
      case 'page':
        return (
          <Link
            key={index}
            href={part.hash === undefined ? part.to : `${part.to}#${part.hash}`}
            className={linkClass}
          >
            {part.text}
          </Link>
        );
    }
  });
}

function BlockView({
  block,
  backupDays,
  subprocessors,
}: {
  block: Block;
  backupDays: number | undefined;
  subprocessors: readonly Subprocessor[];
}): ReactNode {
  switch (block.type) {
    case 'p':
      return (
        <p className="mt-4">
          <InlineContent content={block.content} />
        </p>
      );
    case 'ul':
      return (
        <ul className="mt-4">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineContent content={item} />
            </li>
          ))}
        </ul>
      );
    case 'h3':
      return <h3 className="mt-8 text-web-h3">{block.text}</h3>;
    case 'callout':
      return (
        <blockquote
          id={block.id}
          className="mt-6 rounded-card-sm border-l-4 border-border-selected bg-brand-soft px-5 py-4 text-body text-ink"
        >
          <p>
            <InlineContent content={block.content} />
          </p>
        </blockquote>
      );
    case 'dl':
      return (
        <dl className="mt-4 grid gap-3 rounded-card-sm bg-surface p-5 shadow-s1-soft md:grid-cols-[minmax(10rem,14rem)_1fr]">
          {block.items.map((item) => (
            <div key={item.term} className="contents">
              <dt className="text-label text-ink-2">{item.term}</dt>
              <dd className="text-body text-ink">
                <InlineContent content={item.desc} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case 'table':
      return (
        <StackedTable
          caption={block.caption}
          head={block.head}
          rows={block.rows.map((row, index) => ({
            key: String(index),
            cells: row.map((cell, cellIndex) => <InlineContent key={cellIndex} content={cell} />),
          }))}
        />
      );
    case 'retentionTable':
      return <RetentionTable backupDays={backupDays} />;
    case 'subprocessorTable':
      return <SubprocessorTable rows={subprocessors} />;
  }
}

/**
 * W-CMP-16: a legal document with its version line, table of contents (sticky on ≥1200 px, a
 * `<details>` below) and anchored sections whose ids are identical in both locales.
 */
export async function LegalDocumentView({
  doc,
  locale,
  backupDays,
  subprocessors,
  notice,
}: {
  doc: LegalDocument;
  locale: Locale;
  backupDays: number | undefined;
  subprocessors: readonly Subprocessor[];
  notice?: ReactNode;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.legal');
  const toc = doc.sections.map((section) => ({ id: section.id, heading: section.heading }));
  return (
    <div className="site-container py-12 md:py-16">
      <header className="max-w-3xl">
        <h1
          id="top"
          tabIndex={-1}
          className="text-web-hero-sm text-balance focus-visible:outline-none md:text-web-hero-md"
        >
          {doc.title}
        </h1>
        <p className="mt-4 text-secondary text-ink-2" data-testid="legal-version">
          {t('versionLine', {
            version: doc.version,
            date: formatCalendarDate(doc.effectiveDate, locale),
          })}
        </p>
        <p className="mt-1 text-secondary text-ink-3">{t('precedence')}</p>
        {notice}
      </header>
      <div className="mt-10 xl:grid xl:grid-cols-12 xl:gap-12">
        <aside className="xl:col-span-3">
          <LegalToc items={toc} label={t('toc')} />
        </aside>
        <article className="legal-prose mt-8 max-w-[720px] xl:col-span-9 xl:mt-0">
          {doc.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-h`}
              className="mt-12 first:mt-0"
            >
              <h2
                id={`${section.id}-h`}
                tabIndex={-1}
                className="text-web-h2 focus-visible:outline-none md:text-web-h2-md"
              >
                {section.heading}
              </h2>
              {section.blocks.map((block, index) => (
                <BlockView
                  key={index}
                  block={block}
                  backupDays={backupDays}
                  subprocessors={subprocessors}
                />
              ))}
            </section>
          ))}
          <p className="mt-12 no-print">
            <a
              href="#top"
              className="inline-flex min-h-11 items-center text-label text-text-link hover:underline"
            >
              {t('backToTop')}
            </a>
          </p>
        </article>
      </div>
    </div>
  );
}
