import type { AnchorHTMLAttributes, ReactNode } from 'react';

/** Stand-in for `@/i18n/navigation.ts`: a plain anchor with the Turkish (unprefixed) path. */
type Href = string | { pathname: string; hash?: string; query?: Record<string, string> };

export function hrefOf(href: Href): string {
  if (typeof href === 'string') return href;
  const query = href.query === undefined ? '' : `?${new URLSearchParams(href.query).toString()}`;
  return `${href.pathname}${query}${href.hash === undefined ? '' : `#${href.hash}`}`;
}

export function Link({
  href,
  children,
  locale,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: Href;
  children?: ReactNode;
  locale?: string;
}) {
  const path = hrefOf(href);
  const localized = locale === 'en' ? (path === '/' ? '/en' : `/en${path}`) : path;
  return (
    <a href={localized} {...rest}>
      {children}
    </a>
  );
}

export function usePathname(): string {
  return '/';
}

export function useRouter(): Record<string, () => void> {
  const noop = () => undefined;
  return { push: noop, replace: noop, refresh: noop, back: noop, prefetch: noop };
}

export function getPathname({ href }: { href: Href; locale?: string }): string {
  return hrefOf(href);
}

export function redirect(): never {
  throw new Error('redirect');
}
