import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import {
  IconAutoAwesome,
  IconEditCalendar,
  IconForum,
  IconGroups,
  IconHistory,
  IconMail,
  IconMarkEmailRead,
  IconPriorityHigh,
  IconSchedule,
  IconSearch,
  IconTaskAlt,
} from '../icons/generated/index.ts';
import { FeatureSection } from './FeatureSection.tsx';

const BRIEFING_KEYS = [
  'priorities',
  'schedule',
  'awaiting_me',
  'awaiting_them',
  'deadlines',
  'life',
] as const;
const MAIL_KEYS = [
  'important',
  'awaiting_my_reply',
  'awaiting_their_reply',
  'has_deadline',
  'informational',
  'low_priority',
] as const;

function joinList(items: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
    style: 'long',
    type: 'conjunction',
  }).format(items);
}

/**
 * S4–S8 inside `id="features"`: Morning Briefing, Mail Intelligence, Meeting Prep, Smart
 * Planning, AI Memory. Section and category names come from the app's own catalogs
 * (`briefing.sections.*`, `mail.categories.*`) so the site and the app cannot drift. Supporting
 * cards list product structure and sample prompts, labelled as samples; no screen is redrawn.
 */
export async function Features({ locale }: { locale: string }): Promise<ReactNode> {
  const t = await getTranslations('webPages');
  const sections = await getTranslations('briefing.sections');
  const categories = await getTranslations('mail.categories');
  const pro = { text: t('common.proTag'), label: t('common.proTagLabel') };
  const sectionNames = BRIEFING_KEYS.map((key) => sections(key));
  const categoryNames = MAIL_KEYS.map((key) => categories(key));

  const card = 'rounded-hero bg-surface p-6 shadow-card md:p-8';

  return (
    <div id="features">
      <FeatureSection
        id="briefing"
        headingId="briefing-title"
        tone="paper"
        kicker={t('home.briefing.kicker')}
        title={t('home.briefing.title')}
        lead={t('home.briefing.lead', { sections: joinList(sectionNames, locale) })}
        bullets={[{ text: t('home.briefing.free') }, { text: t('home.briefing.pro'), pro: true }]}
        pro={pro}
        aside={
          <div className={card}>
            <p className="flex items-center gap-2 text-web-kicker text-ink-3">
              <IconAutoAwesome filled size={16} className="text-icon-ai" />
              {t('home.briefing.kicker')}
            </p>
            <ol
              aria-label={t('home.briefing.listLabel')}
              className="mt-5 flex flex-col divide-y divide-border-row"
            >
              {sectionNames.map((name, index) => (
                <li
                  key={name}
                  className="flex items-center gap-4 py-3 font-serif text-web-editorial-sm"
                >
                  <span className="tabular w-6 font-sans text-label text-ink-3">{index + 1}</span>
                  {name}
                </li>
              ))}
            </ol>
          </div>
        }
      />
      <FeatureSection
        id="mail"
        headingId="mail-title"
        tone="bg"
        reverse
        kicker={t('home.mail.kicker')}
        title={t('home.mail.title')}
        note={t('home.mail.sample')}
        lead={t('home.mail.lead', { categories: joinList(categoryNames, locale) })}
        bullets={[
          { text: t('home.mail.tones') },
          { text: t('home.mail.inbox') },
          { text: t('home.mail.pro'), pro: true },
        ]}
        pro={pro}
        aside={
          <div className={card}>
            <p className="flex items-center gap-2 text-web-kicker text-ink-3">
              <IconMail size={16} />
              {t('home.mail.listLabel')}
            </p>
            <ul aria-label={t('home.mail.listLabel')} className="mt-5 flex flex-wrap gap-2">
              {categoryNames.map((name) => (
                <li
                  key={name}
                  className="inline-flex h-10 items-center rounded-pill bg-surface-sunken px-4 text-label text-ink"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        }
      />
      <FeatureSection
        id="meeting-prep"
        headingId="meeting-title"
        tone="ink"
        kicker={t('home.meeting.kicker')}
        kickerPro
        title={t('home.meeting.title')}
        lead={t('home.meeting.lead')}
        bullets={[{ text: t('home.meeting.summary') }, { text: t('home.meeting.after') }]}
        pro={pro}
        aside={
          <div className="rounded-hero border border-border-hairline bg-on-gradient-fill08 p-6 md:p-8">
            <p className="text-web-kicker text-text-on-gradient-secondary">
              {t('home.meeting.cardTitle')}
            </p>
            <ul className="mt-5 flex flex-col gap-3">
              {(
                [
                  ['who', IconGroups],
                  ['threads', IconForum],
                  ['open', IconTaskAlt],
                  ['promises', IconMarkEmailRead],
                  ['three', IconPriorityHigh],
                ] as const
              ).map(([key, Icon]) => (
                <li key={key} className="flex items-center gap-3 text-row-title">
                  <Icon size={20} className="text-brand-glow" />
                  {t(`home.meeting.cardItems.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
      />
      <FeatureSection
        id="planning"
        headingId="planning-title"
        tone="bg"
        reverse
        kicker={t('home.planning.kicker')}
        kickerPro
        title={t('home.planning.title')}
        lead={t('home.planning.lead')}
        bullets={[{ text: t('home.planning.approval') }, { text: t('home.planning.views') }]}
        pro={pro}
        aside={
          <figure className={card}>
            <figcaption className="flex items-center gap-2 text-web-kicker text-ink-3">
              <IconEditCalendar size={16} />
              {t('home.planning.exampleLabel')}
            </figcaption>
            <p className="mt-4 font-serif text-web-editorial-sm text-ink md:text-web-editorial">
              {t('home.planning.example')}
            </p>
          </figure>
        }
      />
      <FeatureSection
        id="memory"
        headingId="memory-title"
        tone="night"
        kicker={t('home.memory.kicker')}
        title={t('home.memory.title')}
        lead={t('home.memory.lead')}
        bullets={[{ text: t('home.memory.pro'), pro: true }, { text: t('home.memory.voice') }]}
        pro={pro}
        aside={
          <figure className="rounded-hero bg-on-gradient-fill10 p-6 md:p-8">
            <figcaption className="flex items-center gap-2 text-web-kicker text-text-on-gradient-secondary">
              <IconSearch size={16} />
              {t('home.memory.questionsLabel')}
            </figcaption>
            <ul className="mt-5 flex flex-col gap-3">
              {(['q1', 'q2', 'q3'] as const).map((q, index) => (
                <li
                  key={q}
                  className="flex items-center gap-3 rounded-card-sm bg-on-gradient-fill12 px-4 py-3 text-row-title"
                >
                  {index === 2 ? (
                    <IconHistory size={20} className="shrink-0 text-brand-glow" />
                  ) : index === 1 ? (
                    <IconSchedule size={20} className="shrink-0 text-brand-glow" />
                  ) : (
                    <IconForum size={20} className="shrink-0 text-brand-glow" />
                  )}
                  {t(`home.memory.questions.${q}`)}
                </li>
              ))}
            </ul>
          </figure>
        }
      />
    </div>
  );
}
