import type { ReactNode } from 'react';
import { IconCheck } from '../icons/generated/index.ts';
import { cx } from '../ui/cx.ts';
import { ProTag } from '../ui/ProTag.tsx';
import { Kicker, Section, SectionHeading, type SectionTone } from '../ui/Section.tsx';

export interface FeatureBullet {
  readonly text: ReactNode;
  readonly pro?: boolean;
}

/**
 * W-CMP-10: kicker (+ PRO pill) / H2 / lead / bullet list / supporting card, alternating sides on
 * ≥1200 px and stacked (text first) below.
 */
export function FeatureSection({
  id,
  headingId,
  tone,
  kicker,
  kickerPro,
  title,
  note,
  lead,
  bullets,
  aside,
  reverse = false,
  pro,
}: {
  id: string;
  headingId: string;
  tone: SectionTone;
  kicker: string;
  kickerPro?: boolean;
  title: string;
  note?: string;
  lead: ReactNode;
  bullets: readonly FeatureBullet[];
  aside: ReactNode;
  reverse?: boolean;
  pro: { readonly text: string; readonly label: string };
}): ReactNode {
  const dark = tone === 'ink' || tone === 'night' || tone === 'dawn';
  return (
    <Section id={id} dataSection={id} headingId={headingId} tone={tone}>
      <div className="grid gap-10 xl:grid-cols-12 xl:items-center xl:gap-16">
        <div className={cx('xl:col-span-6', reverse && 'xl:order-2')}>
          <Kicker
            onDark={dark}
            trailing={kickerPro === true ? <ProTag text={pro.text} label={pro.label} /> : undefined}
          >
            {kicker}
          </Kicker>
          <SectionHeading id={headingId}>{title}</SectionHeading>
          {note === undefined ? null : (
            <p
              className={cx(
                'mt-2 text-meta',
                dark ? 'text-text-on-gradient-tertiary' : 'text-ink-3',
              )}
            >
              {note}
            </p>
          )}
          <p
            className={cx(
              'mt-4 text-web-lead-sm md:text-web-lead-md',
              dark ? 'text-text-on-gradient-secondary' : 'text-ink-2',
            )}
          >
            {lead}
          </p>
          <ul className="mt-6 flex flex-col gap-3">
            {bullets.map((bullet, index) => (
              <li key={index} className="flex items-start gap-3 text-body">
                <IconCheck
                  size={20}
                  className={cx('mt-0.5 shrink-0', dark ? 'text-brand-glow' : 'text-icon-ai')}
                />
                <span>
                  {bullet.text}
                  {bullet.pro === true ? (
                    <>
                      {' '}
                      <ProTag text={pro.text} label={pro.label} />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={cx('xl:col-span-6', reverse && 'xl:order-1')}>{aside}</div>
      </div>
    </Section>
  );
}
