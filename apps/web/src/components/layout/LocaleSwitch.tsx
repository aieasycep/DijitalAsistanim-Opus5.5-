'use client';

import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/navigation.ts';

function localized(locale: 'tr' | 'en', path: string): string {
  if (locale === 'tr') return path;
  return path === '/' ? '/en' : `/en${path}`;
}

/**
 * Link to the same page in the other locale (W-CMP-04), keeping the current section anchor.
 * Switching locale changes the root layout, so this is a plain document navigation. `hrefLang`
 * and `lang` describe the target language for assistive tech and crawlers.
 */
export function LocaleSwitch({
  label,
  ariaLabel,
  className,
}: {
  label: string;
  ariaLabel: string;
  className?: string;
}): ReactNode {
  const locale = useLocale();
  const pathname = usePathname();
  const target = locale === 'tr' ? 'en' : 'tr';
  return (
    <a
      href={localized(target, pathname)}
      hrefLang={target}
      lang={target}
      aria-label={ariaLabel}
      data-ev="web_locale_switch"
      data-to={target}
      className={className}
      onClick={(event) => {
        const hash = window.location.hash;
        if (hash !== '') event.currentTarget.hash = hash;
      }}
    >
      {label}
    </a>
  );
}
