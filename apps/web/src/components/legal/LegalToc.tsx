import type { ReactNode } from 'react';
import { IconExpandMore } from '../icons/generated/index.ts';
import { TocSpy } from './TocSpy.tsx';

/**
 * Table of contents (`nav[aria-label="İçindekiler"]`): sticky list on ≥1200 px, a collapsible
 * `<details>` below. `TocSpy` marks the section in view with `aria-current`.
 */
export function LegalToc({
  items,
  label,
}: {
  items: readonly { readonly id: string; readonly heading: string }[];
  label: string;
}): ReactNode {
  const list = (
    <ol className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            data-toc={item.id}
            className="block rounded-inline px-3 py-2 text-secondary text-ink-2 hover:bg-surface-sunken hover:text-ink aria-[current=true]:bg-brand-soft aria-[current=true]:text-brand-on-soft"
          >
            {item.heading}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <nav
        aria-label={label}
        className="sticky top-24 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto xl:block"
      >
        <p className="px-3 pb-2 text-web-kicker text-ink-3">{label}</p>
        {list}
      </nav>
      <details className="group rounded-card bg-surface shadow-s1-soft xl:hidden">
        <summary className="flex min-h-12 items-center justify-between px-4 text-label">
          {label}
          <IconExpandMore size={22} className="transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label={label} className="px-1 pb-3">
          {list}
        </nav>
      </details>
      <TocSpy ids={items.map((item) => item.id)} />
    </>
  );
}
