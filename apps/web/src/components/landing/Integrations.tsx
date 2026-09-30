import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { FreeLimits } from '@/lib/pricing.ts';
import {
  IconCalendarMonth,
  IconMail,
  IconTaskAlt,
  IconVerifiedUser,
} from '../icons/generated/index.ts';
import { Kicker, Section, SectionHeading } from '../ui/Section.tsx';

const GROUPS = [
  { key: 'mail', Icon: IconMail, chips: ['gmail', 'outlook'] },
  {
    key: 'calendar',
    Icon: IconCalendarMonth,
    chips: ['googleCalendar', 'outlookCalendar', 'appleCalendar', 'deviceCalendar'],
  },
  { key: 'tasks', Icon: IconTaskAlt, chips: ['googleTasks', 'microsoftTodo', 'appleReminders'] },
] as const;

/**
 * S2 · Integrations: plain-text chips with neutral icons — no third-party logos, so nothing
 * implies an endorsement (SREQ-95). Chips are not interactive and do not look pressable.
 */
export async function Integrations({ limits }: { limits: FreeLimits | null }): Promise<ReactNode> {
  const t = await getTranslations('webPages.home.integrations');
  return (
    <Section
      id="integrations"
      dataSection="integrations"
      headingId="integrations-title"
      tone="surface"
    >
      <div className="max-w-3xl">
        <Kicker>{t('kicker')}</Kicker>
        <SectionHeading id="integrations-title">{t('title')}</SectionHeading>
        <p className="mt-4 text-web-lead-sm text-ink-2 md:text-web-lead-md">{t('lead')}</p>
      </div>
      <div className="mt-10 grid gap-6 xl:grid-cols-3">
        {GROUPS.map(({ key, Icon, chips }) => (
          <div key={key}>
            <h3
              id={`integrations-${key}`}
              className="flex items-center gap-2 text-label text-ink-2"
            >
              <Icon size={20} className="text-icon-default" />
              {t(`groups.${key}`)}
            </h3>
            <ul aria-labelledby={`integrations-${key}`} className="mt-3 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li
                  key={chip}
                  className="inline-flex h-10 items-center rounded-pill border border-border-hairline bg-bg px-4 text-label text-ink"
                >
                  {t(`chips.${chip}`)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-10 flex items-start gap-2 text-body text-ink-2">
        <IconVerifiedUser size={20} className="mt-0.5 shrink-0 text-tone-success-icon" />
        {t('reassurance')}
      </p>
      <p className="mt-2 text-secondary text-ink-3">
        {limits === null
          ? t('planNoteFallback')
          : t('planNote', { mail: limits.mail, cal: limits.cal })}
      </p>
    </Section>
  );
}
