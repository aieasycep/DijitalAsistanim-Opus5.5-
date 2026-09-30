'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation.ts';
import { FAQ_KEYS } from '@/lib/faq-keys.ts';
import { isPlacement } from '@/lib/store-links.ts';
import { WEB_PAGES, type WebPage } from '@/lib/web-events/schema.ts';
import { sendWebEvent } from '@/lib/web-events/send.ts';

function currentPage(): WebPage {
  const page = document.querySelector('main')?.dataset.page;
  return (WEB_PAGES as readonly string[]).includes(page ?? '') ? (page as WebPage) : 'not_found';
}

const NAV_TARGETS = ['how_it_works', 'features', 'security', 'pricing', 'faq'] as const;
const CTAS = [
  'app_store',
  'play_store',
  'get_started',
  'pricing',
  'faq_all',
  'privacy',
  'support',
  'open_in_app',
] as const;

function includes<T extends string>(list: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (list as readonly string[]).includes(value);
}

/** Focus the heading of an in-page anchor target so keyboard and screen-reader users land there. */
function focusHashTarget(hash: string): void {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (id === '') return;
  const target = document.getElementById(id);
  if (target === null) return;
  // FAQ answers open their own `<details>`; focus stays on the summary.
  if (target.closest('details') !== null) return;
  // `#main` (the skip link) focuses the landmark itself; a section focuses its heading.
  const heading = target.matches('h1, h2, h3')
    ? target
    : target.tagName === 'MAIN'
      ? null
      : target.querySelector<HTMLElement>('h1, h2');
  const focusable = heading ?? target;
  if (!focusable.hasAttribute('tabindex')) focusable.setAttribute('tabindex', '-1');
  focusable.focus({ preventScroll: true });
}

/**
 * Site-wide client behaviour, mounted once in the root layout:
 * - content-free analytics (PUB-06) from `data-ev` attributes, FAQ toggles and QR visibility;
 * - moves focus to the section heading after an in-page navigation (`/#security`).
 * No cookie, storage or identifier is used (Part 5 §0.11).
 */
export function SiteBehaviors(): null {
  const locale = useLocale();
  const pathname = usePathname();

  useEffect(() => {
    sendWebEvent('web_page_view', { page: currentPage(), locale }, {});
  }, [pathname, locale]);

  useEffect(() => {
    const context = (): { page: WebPage; locale: typeof locale } => ({
      page: currentPage(),
      locale,
    });

    const onClick = (event: MouseEvent): void => {
      const origin =
        event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ev]') : null;
      if (origin !== null) {
        const d = origin.dataset;
        if (d.ev === 'web_cta_click' && includes(CTAS, d.cta) && isPlacement(d.placement)) {
          sendWebEvent('web_cta_click', context(), { cta: d.cta, placement: d.placement });
        } else if (d.ev === 'web_nav_click' && includes(NAV_TARGETS, d.target)) {
          sendWebEvent('web_nav_click', context(), { target: d.target });
        } else if (d.ev === 'web_locale_switch' && (d.to === 'tr' || d.to === 'en')) {
          sendWebEvent('web_locale_switch', context(), { to: d.to });
        } else if (d.ev === 'web_qr_shown' && isPlacement(d.placement)) {
          sendWebEvent('web_qr_shown', context(), { placement: d.placement });
        }
      }
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (anchor !== null && anchor.hash !== '' && anchor.pathname === window.location.pathname) {
        window.setTimeout(() => {
          focusHashTarget(anchor.hash);
        }, 0);
      }
    };

    const onToggle = (event: Event): void => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      const key = details.dataset.faq;
      if (includes(FAQ_KEYS, key)) {
        sendWebEvent('web_faq_toggle', context(), { faq_id: key, open: details.open });
      }
    };

    const seen = new Set<string>();
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              const placement = (entry.target as HTMLElement).dataset.qrPlacement;
              if (!entry.isIntersecting || !isPlacement(placement) || seen.has(placement)) continue;
              if ((entry.target as HTMLElement).offsetParent === null) continue;
              seen.add(placement);
              sendWebEvent('web_qr_shown', context(), { placement });
            }
          });
    document
      .querySelectorAll('[data-qr-placement]')
      .forEach((element) => observer?.observe(element));

    const onHashChange = (): void => {
      focusHashTarget(window.location.hash);
    };

    document.addEventListener('click', onClick);
    document.addEventListener('toggle', onToggle, true);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('toggle', onToggle, true);
      window.removeEventListener('hashchange', onHashChange);
      observer?.disconnect();
    };
  }, [locale, pathname]);

  return null;
}
