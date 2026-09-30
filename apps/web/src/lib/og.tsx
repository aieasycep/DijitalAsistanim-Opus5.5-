import 'server-only';
import { color, gradient, gradientToCss } from '@da/design-tokens';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheLife } from 'next/cache';
import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@da/i18n';
import { IMAGE_ICON_PATHS } from '@/components/icons/generated/paths.ts';
import { REFERRAL_TERMS } from '@/content/referral.ts';
import { BRAND_NAME } from './site.ts';

export interface OgParams {
  readonly params: Promise<{ locale: string }> | { locale: string };
}

/** `generateImageMetadata` for a route: one 1200×630 PNG whose `alt` is headline + sub. */
export async function ogImageMetadata(route: OgRoute, { params }: OgParams) {
  const { locale } = await params;
  const resolved: Locale = locale === 'en' ? 'en' : 'tr';
  return [
    { id: 'card', alt: await ogAlt(route, resolved), size: OG_SIZE, contentType: OG_CONTENT_TYPE },
  ];
}

/**
 * Open Graph images (SCREEN_AND_FLOW_MAP Part 5 W-SYS-05): 1200×630 PNG per route and locale,
 * PRIMARY composition in light colours from `@da/design-tokens`. Fonts are Geist and Lora TTFs
 * (Satori cannot read woff2). The brief card shows the marketing demo scenario and says so.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

export type OgRoute =
  'home' | 'pricing' | 'privacy' | 'terms' | 'support' | 'deletion' | 'referral';

const CARD: Readonly<Record<OgRoute, 'brief' | 'promise'>> = {
  home: 'brief',
  pricing: 'brief',
  privacy: 'promise',
  terms: 'promise',
  support: 'brief',
  deletion: 'promise',
  referral: 'brief',
};

const light = color.light;

/**
 * Font bytes, cached (`'use cache'`): with Cache Components an uncached file read would make the
 * image route dynamic, and the images are meant to be prerendered at build time.
 */
async function font(pkg: 'geist' | 'lora', file: string): Promise<ArrayBuffer> {
  'use cache';
  cacheLife('max');
  const bytes = await readFile(
    join(process.cwd(), 'node_modules', '@expo-google-fonts', pkg, file),
  );
  return new Uint8Array(bytes).buffer;
}

/** The OG namespace is addressed by route id, so it is looked up by string (keys are tested). */
type OgTranslator = (key: string, values?: Record<string, number>) => string;

async function ogTranslator(locale: Locale): Promise<OgTranslator> {
  return (await getTranslations({ locale, namespace: 'webPages.og' })) as unknown as OgTranslator;
}

export async function ogAlt(route: OgRoute, locale: Locale): Promise<string> {
  const t = await ogTranslator(locale);
  return `${t(`${route}.headline`, { days: REFERRAL_TERMS.rewardDays })} ${t(`${route}.sub`, { days: REFERRAL_TERMS.rewardDays })}`;
}

export async function renderOgImage(route: OgRoute, locale: Locale): Promise<ImageResponse> {
  const t = await ogTranslator(locale);
  const promises = await getTranslations({ locale, namespace: 'privacy.promises' });
  const [semibold, medium, lora] = await Promise.all([
    font('geist', '600SemiBold/Geist_600SemiBold.ttf'),
    font('geist', '500Medium/Geist_500Medium.ttf'),
    font('lora', '500Medium/Lora_500Medium.ttf'),
  ]);
  const values = { days: REFERRAL_TERMS.rewardDays };
  const star = IMAGE_ICON_PATHS.auto_awesome;
  const shield = IMAGE_ICON_PATHS.verified_user;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        backgroundColor: light.bg,
        fontFamily: 'Geist',
        padding: 72,
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: 580 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: light.brand.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="38" height="38" viewBox={star.viewBox}>
              <path d={star.fill} fill={light.text.onPrimary} />
            </svg>
          </div>
          <span
            style={{ marginLeft: 16, fontSize: 32, fontWeight: 600, color: light.text.primary }}
          >
            {BRAND_NAME}
          </span>
        </div>
        <div
          style={{
            marginTop: 56,
            fontSize: 54,
            lineHeight: 1.12,
            fontWeight: 600,
            letterSpacing: -1.3,
            color: light.text.primary,
          }}
        >
          {t(`${route}.headline`, values)}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 26,
            lineHeight: 1.4,
            fontWeight: 500,
            color: light.text.secondary,
          }}
        >
          {t(`${route}.sub`, values)}
        </div>
      </div>
      {CARD[route] === 'brief' ? (
        <div
          style={{
            width: 420,
            height: 470,
            borderRadius: 40,
            backgroundImage: gradientToCss(gradient.dawn),
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 40,
            color: light.text.onGradient,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 1.6,
              color: light.text.onGradientTertiary,
            }}
          >
            {t('briefKicker')}
          </div>
          <div style={{ marginTop: 16, fontSize: 40, lineHeight: 1.15, fontWeight: 600 }}>
            {t('briefTitle')}
          </div>
          <div style={{ marginTop: 16, fontSize: 21, color: light.text.onGradientSecondary }}>
            {t('briefMeta')}
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 16,
              fontFamily: 'Lora',
              color: light.text.onGradientTertiary,
            }}
          >
            {t('sample')}
          </div>
        </div>
      ) : (
        <div
          style={{
            width: 420,
            height: 470,
            borderRadius: 40,
            backgroundColor: light.surfaceInk,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 40,
            color: light.text.onInk,
          }}
        >
          {[promises('approval'), promises('encrypted'), promises('ads')].map((line) => (
            <div key={line} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 26 }}>
              <svg
                width="30"
                height="30"
                viewBox={shield.viewBox}
                style={{ marginTop: 2, flexShrink: 0 }}
              >
                <path d={shield.fill} fill={light.tone.success.onGradient} />
              </svg>
              <span style={{ marginLeft: 16, fontSize: 25, lineHeight: 1.4 }}>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Geist', data: semibold, weight: 600, style: 'normal' },
        { name: 'Geist', data: medium, weight: 500, style: 'normal' },
        { name: 'Lora', data: lora, weight: 500, style: 'normal' },
      ],
    },
  );
}
