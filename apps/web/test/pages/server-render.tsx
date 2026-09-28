import type { Locale } from '@da/i18n';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { loadWebMessages } from '../../src/i18n/messages.ts';

/**
 * Renders a server component tree (async components included) to static HTML the way the build
 * prerenders it, then mounts the markup in the happy-dom document so tests query it with the
 * DOM / Testing Library APIs. Client components render their initial (server) output.
 */
export async function renderServer(node: ReactNode, locale: Locale = 'tr'): Promise<HTMLElement> {
  const { prelude } = await prerender(
    <NextIntlClientProvider
      locale={locale}
      messages={loadWebMessages(locale)}
      timeZone="Europe/Istanbul"
    >
      {node}
    </NextIntlClientProvider>,
  );
  const html = await new Response(prelude).text();
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.replaceChildren(container);
  return container;
}

/** Text content with whitespace collapsed (for readable `toContain` assertions). */
export function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
