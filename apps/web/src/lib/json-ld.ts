import type { Locale } from '@da/i18n';
import type { PricingView } from './pricing.ts';
import { BRAND_NAME, SUPPORT_EMAIL } from './site.ts';

/**
 * Structured data (SCREEN_AND_FLOW_MAP Part 5 §0.9). `aggregateRating` and `review` are never
 * emitted: there are no ratings to cite (§0.5). Pro offers appear only with verified store prices.
 */

type JsonLd = Record<string, unknown>;

export function organizationLd(input: {
  readonly siteUrl: string;
  readonly legalName: string | undefined;
  readonly storeUrls: readonly string[];
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.legalName ?? BRAND_NAME,
    brand: { '@type': 'Brand', name: BRAND_NAME },
    url: input.siteUrl,
    logo: `${input.siteUrl}/icon`,
    email: SUPPORT_EMAIL,
    ...(input.storeUrls.length === 0 ? {} : { sameAs: input.storeUrls }),
  };
}

export function websiteLd(siteUrl: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND_NAME,
    url: siteUrl,
    inLanguage: ['tr-TR', 'en'],
  };
}

export function mobileApplicationLd(input: {
  readonly siteUrl: string;
  readonly description: string;
  readonly pricing: PricingView | null;
}): JsonLd {
  const offers: JsonLd[] = [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'TRY' }];
  if (input.pricing !== null) {
    offers.push(
      {
        '@type': 'Offer',
        name: 'Pro (monthly)',
        priceCurrency: 'TRY',
        price: input.pricing.monthly.min.toFixed(2),
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: input.pricing.monthly.min.toFixed(2),
          priceCurrency: 'TRY',
          billingDuration: 'P1M',
        },
      },
      {
        '@type': 'Offer',
        name: 'Pro (annual)',
        priceCurrency: 'TRY',
        price: input.pricing.annual.min.toFixed(2),
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: input.pricing.annual.min.toFixed(2),
          priceCurrency: 'TRY',
          billingDuration: 'P1Y',
        },
      },
    );
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: BRAND_NAME,
    operatingSystem: 'iOS, Android',
    applicationCategory: 'BusinessApplication',
    description: input.description,
    url: input.siteUrl,
    offers,
  };
}

export function faqPageLd(items: readonly { readonly q: string; readonly a: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

export function webPageLd(input: {
  readonly url: string;
  readonly name: string;
  readonly locale: Locale;
  readonly dateModified: string;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: input.name,
    url: input.url,
    inLanguage: input.locale === 'tr' ? 'tr-TR' : 'en',
    dateModified: input.dateModified,
  };
}

/** Serialises JSON-LD for a `<script type="application/ld+json">`, escaping `<` so no tag can close. */
export function serializeJsonLd(data: JsonLd | readonly JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
