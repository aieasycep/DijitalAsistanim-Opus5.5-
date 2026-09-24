import type { Locale } from '@da/i18n';
import { normalizeReferralCode, validateReferralCode } from '@da/domain/referrals/code';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { TrackView } from '@/components/analytics/TrackView.tsx';
import { QrCard } from '@/components/download/QrDownload.tsx';
import { StoreBadges } from '@/components/download/StoreBadges.tsx';
import { CodeCard } from '@/components/links/CodeCard.tsx';
import { LinkPageShell, withLang } from '@/components/links/LinkPageShell.tsx';
import { Kicker } from '@/components/ui/Section.tsx';
import { REFERRAL_TERMS } from '@/content/referral.ts';
import { Link } from '@/i18n/navigation.ts';
import { resolveReferral } from '@/lib/public-api/server.ts';
import { linkPageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';
import { androidIntentUrl, buildStoreLinks, devicePlatform } from '@/lib/store-links.ts';

/** Request-bound (code, user agent) and nonce-protected. */
export const instant = false;

interface Props {
  params: Promise<{ locale: Locale; code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.referral' });
  const config = siteConfig();
  const check = validateReferralCode(code);
  return linkPageMetadata({
    title: t('title'),
    description: t('description'),
    iosAppStoreId: config.store.iosAppStoreId,
    appArgument: check.valid ? `${config.siteUrl}/r/${check.code}` : undefined,
  });
}

/**
 * W-REF-01 · referral landing. The code is normalised (upper case, no spaces or hyphens; a
 * different spelling gets a 308 to the canonical URL), checked locally (length, alphabet, check
 * character) and only then resolved through `GET /referrals/:code` (PUB-04). The page never shows
 * who sent the invite, and never promises a reward it could not confirm.
 */
export default async function ReferralPage({ params }: Props): Promise<ReactNode> {
  await connection();
  const { locale, code: raw } = await params;
  const decoded = decodeURIComponent(raw);
  const normalized = normalizeReferralCode(decoded);
  if (normalized !== decoded && normalized !== '')
    permanentRedirect(`/r/${encodeURIComponent(normalized)}`);

  const config = siteConfig();
  const t = await getTranslations('webPages');
  const check = validateReferralCode(normalized);
  const lookup = check.valid ? await resolveReferral(check.code) : null;
  const state: 'valid' | 'invalid' | 'unverified' = !check.valid
    ? 'invalid'
    : lookup?.kind === 'resolved'
      ? lookup.value.valid
        ? 'valid'
        : 'invalid'
      : 'unverified';
  const rewardDays =
    lookup?.kind === 'resolved' ? lookup.value.reward_days : REFERRAL_TERMS.rewardDays;
  const windowDays =
    lookup?.kind === 'resolved'
      ? (lookup.value.apply_window_days ?? REFERRAL_TERMS.applyWindowDays)
      : REFERRAL_TERMS.applyWindowDays;
  const code = check.valid ? check.code : null;
  const ua = (await headers()).get('user-agent');
  const platform = devicePlatform(ua);
  const selfPath = code === null ? '/r' : `/r/${code}`;
  const langHrefs = { tr: withLang(selfPath, null, 'tr'), en: withLang(selfPath, null, 'en') };

  if (state === 'invalid' || code === null) {
    return (
      <LinkPageShell page="referral" langHrefs={langHrefs}>
        <TrackView event="web_referral_view" page="referral" props={{ valid: false }} />
        <h1 className="text-web-h2 text-balance md:text-web-h2-md">{t('referral.invalidTitle')}</h1>
        <p className="mt-4 text-body text-ink-2">{t('referral.invalidBody')}</p>
        <StoreBadges locale={locale} placement="referral" store={config.store} className="mt-8" />
      </LinkPageShell>
    );
  }

  const links = buildStoreLinks(config.store, locale, 'referral', code);
  const intent =
    platform === 'android'
      ? androidIntentUrl(
          'settings/referral',
          new URLSearchParams({ code }),
          config.store.androidPackage,
          links.play,
        )
      : null;

  return (
    <LinkPageShell page="referral" langHrefs={langHrefs}>
      <TrackView event="web_referral_view" page="referral" props={{ valid: state === 'valid' }} />
      <Kicker>{t('referral.kicker')}</Kicker>
      <h1 className="mt-3 text-web-h2 text-balance md:text-web-h2-md">{t('referral.title')}</h1>
      <p className="mt-4 text-body text-ink-2">{t('referral.lead')}</p>
      <div className="mt-8">
        <CodeCard
          code={code}
          labels={{
            title: t('referral.codeLabel'),
            copy: t('referral.copy'),
            copied: t('referral.copied'),
            selected: t('referral.selected'),
          }}
        />
      </div>
      {state === 'unverified' ? (
        <p className="mt-6 text-body text-ink-2" data-testid="referral-unverified">
          {t('referral.unverified', { code })}
        </p>
      ) : null}
      <ol className="mt-8 flex flex-col gap-3">
        {[
          t('referral.steps.download'),
          t('referral.steps.add', { window: windowDays }),
          t('referral.steps.connect'),
        ].map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-body">
            <span
              aria-hidden="true"
              className="tabular inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-label"
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-secondary text-ink-2">{t('referral.android')}</p>
      {state === 'valid' ? (
        <p className="mt-5 text-body" data-testid="referral-reward">
          {t.rich('referral.reward', {
            days: rewardDays,
            terms: (chunks) => (
              <Link href="/terms#davet" className="text-text-link underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-4">
        {intent === null ? null : (
          <a
            href={intent}
            data-ev="web_cta_click"
            data-cta="open_in_app"
            data-placement="referral"
            className="inline-flex min-h-12 items-center justify-center rounded-button bg-primary px-5 text-label-lg text-text-on-primary"
          >
            {t('referral.openInApp')}
          </a>
        )}
        <StoreBadges
          locale={locale}
          placement="referral"
          store={config.store}
          referralCode={code}
        />
        <QrCard
          url={`${config.siteUrl}/r/${code}`}
          alt={t('download.qrAlt')}
          title={t('referral.qrTitle')}
          sub={t('referral.qrSub')}
          placement="referral"
          className="hidden md:flex"
        />
      </div>
    </LinkPageShell>
  );
}
