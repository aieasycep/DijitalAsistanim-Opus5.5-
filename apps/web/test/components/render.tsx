import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { loadWebMessages } from '../../src/i18n/messages.ts';

/** Renders a client component with the full web catalog of a locale. */
export function renderWithIntl(ui: ReactElement, locale: 'tr' | 'en' = 'tr'): RenderResult {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={loadWebMessages(locale)}
      timeZone="Europe/Istanbul"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}
