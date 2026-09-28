import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { loadWebMessages } from '../src/i18n/messages.ts';

/*
 * Generated images and small route handlers (W-SYS-05 Open Graph cards, W-SYS-07 icons,
 * security.txt, the next-intl request config). `next/og` is replaced by a recorder so the tests
 * assert what is drawn (headline copy, size) without rasterising.
 */

vi.mock('next-intl/server', () => import('./stubs/next-intl-server.ts'));
vi.mock('next/cache', () => import('./stubs/next-runtime.ts'));
vi.mock('next/server', () => import('./stubs/next-runtime.ts'));
vi.mock('next/root-params', () => ({ locale: () => Promise.resolve('en') }));
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(
      readonly element: ReactElement,
      readonly options: { width?: number; height?: number; fonts?: unknown[] },
    ) {}
  },
}));

interface Recorded {
  element: ReactElement;
  options: { width?: number; height?: number; fonts?: { name: string }[] };
}

function textIn(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textIn).join(' ');
  if (isValidElement(node)) return textIn((node.props as { children?: unknown }).children);
  return '';
}

const TR = loadWebMessages('tr');
const EN = loadWebMessages('en');

const OG_ROUTES = [
  ['home', () => import('../src/app/[locale]/(site)/opengraph-image.tsx')],
  ['pricing', () => import('../src/app/[locale]/(site)/pricing/opengraph-image.tsx')],
  ['privacy', () => import('../src/app/[locale]/(site)/privacy/opengraph-image.tsx')],
  ['terms', () => import('../src/app/[locale]/(site)/terms/opengraph-image.tsx')],
  ['support', () => import('../src/app/[locale]/(site)/support/opengraph-image.tsx')],
  ['deletion', () => import('../src/app/[locale]/(site)/data-deletion/opengraph-image.tsx')],
  ['referral', () => import('../src/app/[locale]/(links)/r/opengraph-image.tsx')],
] as const;

describe('W-SYS-05 Open Graph images', () => {
  it.each(OG_ROUTES)(
    '%s: 1200×630 card with the localized headline and alt text',
    async (route, load) => {
      const mod = await load();
      const og = (key: string, locale: 'tr' | 'en') =>
        (
          (locale === 'tr' ? TR : EN).webPages.og as unknown as Record<
            string,
            Record<string, string>
          >
        )[route]?.[key] ?? '';
      for (const locale of ['tr', 'en'] as const) {
        const image = (await mod.default({
          params: Promise.resolve({ locale }),
        })) as unknown as Recorded;
        expect(image.options).toMatchObject({ width: 1200, height: 630 });
        expect(image.options.fonts?.map((f) => f.name)).toEqual(
          expect.arrayContaining(['Geist', 'Lora']),
        );
        const headline =
          og('headline', locale)
            .replace(/\{days\}/g, '14')
            .split(' ')[0] ?? '';
        expect(textIn(image.element)).toContain(headline);
        const [meta] = await mod.generateImageMetadata({ params: Promise.resolve({ locale }) });
        expect(meta).toMatchObject({
          id: 'card',
          contentType: 'image/png',
          size: { width: 1200, height: 630 },
        });
        expect(meta?.alt.length).toBeGreaterThan(10);
      }
      const fallback = (await mod.default({ params: { locale: 'de' } })) as unknown as Recorded;
      expect(textIn(fallback.element)).toContain(
        og('headline', 'tr')
          .replace(/\{days\}/g, '14')
          .split(' ')[0] ?? '',
      );
    },
  );
});

describe('W-SYS-07 app icons', () => {
  it('draws the favicon at 512 px and the apple-touch icon at 180 px', async () => {
    const icon = await import('../src/app/icon.tsx');
    const apple = await import('../src/app/apple-icon.tsx');
    expect((icon.default() as unknown as Recorded).options).toEqual({ width: 512, height: 512 });
    expect((apple.default() as unknown as Recorded).options).toEqual({ width: 180, height: 180 });
    expect(icon.size).toEqual({ width: 512, height: 512 });
    expect(apple.contentType).toBe('image/png');
  });
});

describe('route handlers and request config', () => {
  it('security.txt is plain text with a contact and an expiry', async () => {
    const { GET } = await import('../src/app/well-known/security.txt/route.ts');
    const response = await GET();
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await response.text();
    expect(body).toMatch(/^Contact: /m);
    expect(body).toMatch(/^Expires: /m);
  });

  it('the manifest names the app and uses the generated icon', async () => {
    const { default: manifest } = await import('../src/app/manifest.ts');
    const value = manifest();
    expect(value.name).toBeTruthy();
    expect(value.icons?.some((i) => i.src.includes('icon'))).toBe(true);
  });

  it('resolves the request locale from the segment, then the root param, else Turkish', async () => {
    const { default: config } = await import('../src/i18n/request.ts');
    const resolve = config as unknown as (arg: {
      locale?: string;
    }) => Promise<{ locale: string; timeZone: string }>;
    expect((await resolve({ locale: 'tr' })).locale).toBe('tr');
    expect((await resolve({})).locale).toBe('en');
    expect((await resolve({ locale: 'de' })).locale).toBe('tr');
    expect((await resolve({ locale: 'tr' })).timeZone).toBe('Europe/Istanbul');
  });
});
