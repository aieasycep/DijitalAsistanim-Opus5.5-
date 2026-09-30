import { FAQ_ITEMS } from '@da/i18n';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import type { FreeLimits } from '@/lib/pricing.ts';
import { renderFaqItems } from '../faq/faq-content.tsx';
import { FaqList } from '../faq/FaqList.tsx';
import { IconArrowForward } from '../icons/generated/index.ts';
import { Section, SectionHeading } from '../ui/Section.tsx';

/** S11 · FAQ: the eight `featured` items of the shared FAQ catalog. */
export async function HomeFaq({
  limits,
  microsoftClientId,
}: {
  limits: FreeLimits | null;
  microsoftClientId: string | undefined;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.home.faq');
  const featured = FAQ_ITEMS.filter((item) => item.featured).map((item) => item.key);
  const items = await renderFaqItems({ keys: featured, limits, microsoftClientId });
  return (
    <Section id="faq" dataSection="faq" headingId="faq-title">
      <div className="mx-auto max-w-[760px]">
        <SectionHeading id="faq-title">{t('title')}</SectionHeading>
        <div className="mt-8">
          <FaqList items={items} />
        </div>
        <p className="mt-6">
          <Link
            href="/support"
            data-ev="web_cta_click"
            data-cta="faq_all"
            data-placement="final"
            className="inline-flex min-h-11 items-center gap-2 text-label-lg text-text-link hover:underline underline-offset-4"
          >
            {t('link')}
            <IconArrowForward size={18} />
          </Link>
        </p>
      </div>
    </Section>
  );
}
