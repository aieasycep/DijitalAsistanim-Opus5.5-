import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { IconArrowForward, IconShield, IconVerifiedUser } from '../icons/generated/index.ts';
import { Kicker, Section, SectionHeading } from '../ui/Section.tsx';

/**
 * S9 · Security & privacy with the PRIMARY 7.2 promise card. Every statement is true of the
 * architecture (M§40; plan R-15): no end-to-end claim, no "compliant" claim, rights-oriented copy.
 * The shared promises come from `privacy.promises.*` / `privacy.storage.*` (single source).
 */
export async function Security({
  dataRegionLabel,
}: {
  dataRegionLabel: string | undefined;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.home.security');
  const common = await getTranslations('webPages.common');
  const privacy = await getTranslations('privacy');
  // `eu-central-1` (the Supabase region, ADR-53) is shown localized; any other label verbatim.
  const region =
    dataRegionLabel === undefined
      ? undefined
      : dataRegionLabel === 'eu-central-1'
        ? common('regionEuCentral1')
        : dataRegionLabel;
  const promises = [
    privacy('promises.approval'),
    privacy('promises.encrypted'),
    privacy('promises.ads'),
    privacy('promises.trainingLong'),
    privacy('storage.canonical'),
    t('retentionChoice'),
    t('exportDelete'),
  ];
  return (
    <Section id="security" dataSection="security" headingId="security-title">
      <div className="grid gap-10 xl:grid-cols-12 xl:gap-16">
        <div className="xl:col-span-5">
          <Kicker>{t('kicker')}</Kicker>
          <SectionHeading id="security-title">{t('title')}</SectionHeading>
          <p className="mt-4 text-web-lead-sm text-ink-2 md:text-web-lead-md">{t('lead')}</p>
          {region === undefined ? null : (
            <p className="mt-6 text-body text-ink-2" data-testid="data-region">
              {privacy('storage.region', { region })} {privacy('storage.crossBorder')}
            </p>
          )}
          <p className="mt-4 text-body text-ink-2">
            {t('googleLine')}{' '}
            <Link href="/privacy#google" className="text-text-link underline underline-offset-4">
              {t('googleLink')}
            </Link>
          </p>
          <p className="mt-4 text-body text-ink-2">{t('rights')}</p>
          <p className="mt-6">
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center gap-2 text-label-lg text-text-link hover:underline underline-offset-4"
            >
              {t('policyLink')}
              <IconArrowForward size={18} />
            </Link>
          </p>
        </div>
        <div className="xl:col-span-7">
          <div className="band-dark rounded-panel border border-border-hairline bg-surface-ink p-6 text-text-on-ink shadow-ink-card md:p-8">
            <p className="flex items-center gap-2 text-web-kicker text-text-on-gradient-secondary">
              <IconShield size={16} />
              {t('promiseTitle')}
            </p>
            <ul className="mt-5 flex flex-col gap-4">
              {promises.map((promise) => (
                <li key={promise} className="flex items-start gap-3 text-body">
                  <IconVerifiedUser
                    size={20}
                    className="mt-0.5 shrink-0 text-tone-success-on-gradient"
                  />
                  <span>{promise}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}
