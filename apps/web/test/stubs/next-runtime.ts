/**
 * Stand-ins for the Next.js request APIs a page reads (`next/headers`, `next/navigation`,
 * `next/server` `connection`, `next/cache`). Tests set the request headers through
 * `requestHeaders`; `notFound()` and `permanentRedirect()` throw a tagged error the test asserts.
 */
export const requestHeaders: { current: Headers } = { current: new Headers() };

export class NavigationSignal extends Error {
  constructor(
    readonly kind: 'not_found' | 'redirect',
    readonly location: string | null = null,
  ) {
    super(kind === 'redirect' ? `redirect:${location ?? ''}` : 'not_found');
  }
}

export function headers(): Promise<Headers> {
  return Promise.resolve(requestHeaders.current);
}

export function notFound(): never {
  throw new NavigationSignal('not_found');
}

export function permanentRedirect(location: string): never {
  throw new NavigationSignal('redirect', location);
}

export function redirect(location: string): never {
  throw new NavigationSignal('redirect', location);
}

export function useParams(): Record<string, string> {
  return { locale: 'tr' };
}

export function usePathname(): string {
  return '/';
}

export function useRouter(): Record<string, () => void> {
  const noop = () => undefined;
  return { push: noop, replace: noop, refresh: noop, back: noop, prefetch: noop };
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function connection(): Promise<void> {
  return Promise.resolve();
}

export function cacheLife(): void {
  /* caching is a build concern; tests read fresh values */
}

export function cacheTag(): void {
  /* see cacheLife */
}
