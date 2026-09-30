import type { ReactNode } from 'react';
import { IconExpandMore } from '../icons/generated/index.ts';
import type { RenderedFaq } from './faq-content.tsx';

/**
 * FAQ accordion (W-CMP-15): native `<details>/<summary>`, so it works without JavaScript and is
 * operable with Enter/Space. Each item has the anchor `faq-{key}`; the admin-consent item also
 * answers to `#kurum-yoneticileri` (INTEGRATION_PLAN M6).
 */
export function FaqList({ items }: { items: readonly RenderedFaq[] }): ReactNode {
  return (
    <div className="divide-y divide-border-hairline rounded-card bg-surface shadow-card">
      {items.map((item) => (
        <details key={item.key} id={item.anchor} data-faq={item.key} className="group">
          <summary className="flex min-h-14 items-center justify-between gap-4 px-5 py-4 md:px-6">
            <h3 className="text-web-h3 text-ink">{item.q}</h3>
            <IconExpandMore
              size={24}
              className="shrink-0 text-icon-default transition-transform duration-(--da-duration-chevron) ease-standard group-open:rotate-180"
            />
          </summary>
          {item.key === 'admin_consent' ? <span id="kurum-yoneticileri" /> : null}
          <div className="px-5 pb-5 text-body text-ink-2 md:px-6">
            <p>{item.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
