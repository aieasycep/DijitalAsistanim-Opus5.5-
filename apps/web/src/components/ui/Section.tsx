import type { ReactNode } from 'react';
import { IconAutoAwesome } from '../icons/generated/index.ts';
import { cx } from './cx.ts';

/**
 * `<section aria-labelledby>` with the `data-section` attribute the E2E suite uses to check the
 * landing order (W-CMP-05). `tone` selects the band background from the PRIMARY palette.
 */
export type SectionTone = 'bg' | 'surface' | 'paper' | 'ink' | 'night' | 'dawn' | 'tint';

const TONE_CLASS: Readonly<Record<SectionTone, string>> = {
  bg: 'bg-bg text-ink',
  surface: 'bg-surface text-ink',
  paper: 'bg-bg-editorial text-ink',
  tint: 'text-ink [background:var(--da-gradient-onboarding-tint)]',
  ink: 'band-dark bg-surface-ink text-text-on-ink border-y border-border-hairline',
  night: 'band-dark text-text-on-gradient [background:var(--da-gradient-night)]',
  dawn: 'band-dark text-text-on-gradient [background:var(--da-gradient-dawn-fullbleed)]',
};

export function Section({
  id,
  dataSection,
  headingId,
  tone = 'bg',
  className,
  children,
}: {
  id: string;
  dataSection: string;
  headingId: string;
  tone?: SectionTone;
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section
      id={id}
      data-section={dataSection}
      aria-labelledby={headingId}
      className={cx('section-pad', TONE_CLASS[tone], className)}
    >
      <div className="site-container">{children}</div>
    </section>
  );
}

/** Kicker line (12/16, 600, +8 %, already upper-cased in the catalog with Turkish rules). */
export function Kicker({
  children,
  ai = false,
  onDark = false,
  trailing,
}: {
  children: ReactNode;
  ai?: boolean;
  onDark?: boolean;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <p
      className={cx(
        'flex flex-wrap items-center gap-2 text-web-kicker',
        onDark ? 'text-text-on-gradient-secondary' : 'text-ink-3',
      )}
    >
      {ai ? (
        <IconAutoAwesome filled size={16} className={onDark ? 'text-brand-glow' : 'text-icon-ai'} />
      ) : null}
      <span>{children}</span>
      {trailing}
    </p>
  );
}

export function SectionHeading({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <h2
      id={id}
      tabIndex={-1}
      className={cx(
        'mt-3 text-web-h2 text-balance md:text-web-h2-md xl:text-web-h2-lg focus-visible:outline-none',
        className,
      )}
    >
      {children}
    </h2>
  );
}
