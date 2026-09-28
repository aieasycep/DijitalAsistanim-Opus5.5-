import { createTranslator } from 'next-intl';

import { TR_MESSAGES } from './render';

/*
 * Stand-ins for the Next.js / next-intl server APIs that module pages read in component tests:
 * translators over the real `backoffice` catalog, request cookies/headers set per test, and
 * `redirect()` / `notFound()` that throw a tagged error the test can assert.
 */

export const request = {
  cookies: new Map<string, string>(),
  headers: new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '203.0.113.7' }),
};

export class NavigationSignal extends Error {
  constructor(
    readonly kind: 'redirect' | 'not_found',
    readonly location: string | null = null,
  ) {
    super(kind === 'redirect' ? `redirect:${location ?? ''}` : 'not_found');
  }
}

export function getTranslations(arg?: string | { namespace?: string }): Promise<unknown> {
  const namespace = typeof arg === 'string' ? arg : arg?.namespace;
  return Promise.resolve(
    createTranslator({
      locale: 'tr',
      messages: TR_MESSAGES,
      timeZone: 'Europe/Istanbul',
      ...(namespace === undefined ? {} : { namespace: namespace as never }),
    }),
  );
}

export function getLocale(): Promise<string> {
  return Promise.resolve('tr');
}

export function getRequestConfig<T>(factory: T): T {
  return factory;
}

export function cookies() {
  return Promise.resolve({
    get: (name: string) => {
      const value = request.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
    has: (name: string) => request.cookies.has(name),
    set: (name: string, value: string) => {
      request.cookies.set(name, value);
    },
    delete: (name: string) => {
      request.cookies.delete(name);
    },
  });
}

export function headers(): Promise<Headers> {
  return Promise.resolve(request.headers);
}

export function redirect(location: string): never {
  throw new NavigationSignal('redirect', location);
}

export function notFound(): never {
  throw new NavigationSignal('not_found');
}

export const router = {
  push: (_href: string) => undefined,
  replace: (_href: string) => undefined,
  refresh: () => undefined,
  back: () => undefined,
  prefetch: () => undefined,
};

export function useRouter() {
  return router;
}

export function usePathname(): string {
  return '/dashboard';
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useParams(): Record<string, string> {
  return {};
}

export function revalidatePath(): void {
  /* nothing is cached in tests */
}
