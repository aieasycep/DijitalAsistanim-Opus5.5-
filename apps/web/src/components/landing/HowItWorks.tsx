import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Kicker, Section, SectionHeading } from '../ui/Section.tsx';

const STEPS = ['connect', 'analysis', 'daily'] as const;

/** S3 · How it works: three numbered steps (W-CMP-09). */
export async function HowItWorks(): Promise<ReactNode> {
  const t = await getTranslations('webPages.home.how');
  return (
    <Section id="how-it-works" dataSection="how-it-works" headingId="how-title">
      <Kicker>{t('kicker')}</Kicker>
      <SectionHeading id="how-title">{t('title')}</SectionHeading>
      <ol className="mt-10 grid gap-6 xl:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step} className="rounded-card bg-surface p-6 shadow-card">
            <span
              aria-hidden="true"
              className="tabular inline-flex size-8 items-center justify-center rounded-pill bg-surface-sunken text-label text-ink"
            >
              {index + 1}
            </span>
            <h3 className="mt-4 text-web-h3 xl:text-web-h3-lg">{t(`steps.${step}.title`)}</h3>
            <p className="mt-2 text-body text-ink-2">{t(`steps.${step}.body`)}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
