import { EXTERNAL_LINKS } from '../../lib/site.ts';
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '../meta.ts';
import {
  link,
  mail,
  md,
  p,
  page,
  strong,
  ul,
  type LegalContext,
  type LegalDocument,
} from './types.ts';

/** Terms of Use, English translation of `terms.tr.ts` (the Turkish text prevails). */
export function termsEn(ctx: LegalContext): LegalDocument {
  const c = ctx.company;
  const r = ctx.referral;
  return {
    id: 'terms',
    title: 'Terms of Use',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        id: 'taraflar',
        heading: 'Parties and acceptance',
        blocks: [
          p(
            `These Terms of Use apply between you and ${c.displayName}, which provides the Dijital Asistan service. By creating a Dijital Asistan account you accept these terms.`,
          ),
        ],
      },
      {
        id: 'hizmet',
        heading: 'The service',
        blocks: [
          p(
            'Dijital Asistan is a personal command center that analyses the email, calendar and task accounts you connect and prepares briefings, priorities, reply drafts and suggestions. It is not primarily a chatbot. It does not replace professional legal, financial or medical advice.',
          ),
        ],
      },
      {
        id: 'uygunluk',
        heading: 'Account and eligibility',
        blocks: [
          ul(
            'You must be 18 or older to use the service.',
            'Each person uses one account.',
            'You are responsible for keeping your sign-in methods secure.',
            md`If you think your account is being used without permission, email ${mail(c.securityEmail)} right away.`,
          ),
        ],
      },
      {
        id: 'baglantilar',
        heading: 'Connected accounts and permissions',
        blocks: [
          p(
            'You authorise read access for each connected account. Write permissions (sending email, creating events or tasks) are requested only when you first approve a write of that kind. The terms of Google, Microsoft and Apple also apply. You can remove a connection at any time.',
          ),
        ],
      },
      {
        id: 'onay',
        heading: 'Approved actions',
        blocks: [
          ul(
            'No email is sent and no calendar event or task is created or changed without your approval.',
            'We carry out exactly the action shown on the approval screen, once.',
            'If an action fails, you are told and can retry; we never report success that didn’t happen.',
            'You are responsible for the content you approve.',
          ),
        ],
      },
      {
        id: 'yapay-zeka',
        heading: 'AI output',
        blocks: [
          p(
            'AI output may be incomplete or wrong. Check the source with “Where did this come from?”; details that can’t be verified are marked “Not confirmed in the source.” You can correct classifications at any time.',
          ),
        ],
      },
      {
        id: 'kabul-edilebilir-kullanim',
        heading: 'Acceptable use',
        blocks: [
          ul(
            'You may not use the service for unlawful purposes, spam or harassment.',
            'You may not try to bypass limits, security measures or the isolation of other users’ data.',
            'You may not reverse engineer the app beyond what the law allows.',
            'You may not scrape the service with automated tools.',
            'You may not abuse the referral programme or seek advantage through multiple accounts.',
          ),
        ],
      },
      {
        id: 'planlar',
        heading: 'Free plan and Pro',
        blocks: [
          p(
            md`The current Free plan limits are published on the ${page('/pricing', 'Pricing page')}. Pro AI usage follows a fair-use policy with high daily limits for personal use and may be slowed temporarily under abnormal automated load.`,
          ),
        ],
      },
      {
        id: 'abonelik',
        heading: 'Subscriptions, billing, cancellation and refunds',
        blocks: [
          ul(
            'Purchases are processed by Apple or Google under their terms.',
            'Subscriptions renew automatically unless cancelled at least 24 hours before the end of the period.',
            md`To cancel: on iPhone, Settings › [your name] › Subscriptions (${link(EXTERNAL_LINKS.appStoreSubscriptions, 'App Store subscriptions')}); on Android, Google Play › Profile › Payments & subscriptions (${link(EXTERNAL_LINKS.playSubscriptions, 'Google Play subscriptions')}).`,
            'A trial is offered only when it is shown on the store’s purchase screen, and it follows the store’s conditions.',
            'Price changes follow store rules and notices.',
            md`Refunds are handled through Apple (${link(EXTERNAL_LINKS.appleReportProblem, 'reportaproblem.apple.com')}) or Google Play.`,
            md`${strong('Deleting your account does not cancel a store subscription.')}`,
            'Your statutory consumer rights under Turkish Consumer Protection Law No. 6502 and related regulations are reserved.',
          ),
        ],
      },
      {
        id: 'davet',
        heading: 'Referral programme',
        blocks: [
          ul(
            `If the person you invite adds your code within ${String(r.applyWindowDays)} days of signing up, connects at least one account and receives their first briefing, and their account is at least ${String(r.minAccountAgeHours)} hours old, you both get ${String(r.rewardDays)} days of Pro.`,
            `A referrer can earn at most ${String(r.maxRewardsPerYear)} rewards per year.`,
            'Rewards are stacked Pro periods; they have no cash value and are not transferable.',
            'Abusive referrals (self-referral, duplicate accounts, loops) are rejected, and rewards obtained this way may be revoked.',
            'Changes to the programme apply only to new invitations; rewards already earned are honoured.',
          ),
        ],
      },
      {
        id: 'fikri-mulkiyet',
        heading: 'Intellectual property and licence',
        blocks: [
          p(
            'We grant you a personal, non-exclusive, non-transferable licence to use the app. Your content stays yours; you grant us a limited licence to process it only to provide the service. The “Dijital Asistan” name and marks are ours.',
          ),
        ],
      },
      {
        id: 'ucuncu-taraf',
        heading: 'Third-party services and stores',
        blocks: [
          p(
            'Apple and Google are not parties to these terms and have no obligation to support the app. For App Store users, Apple and its subsidiaries are third-party beneficiaries of these terms. Google, Microsoft and Apple services have their own terms.',
          ),
        ],
      },
      {
        id: 'hizmet-degisiklikleri',
        heading: 'Service continuity and changes',
        blocks: [
          p(
            'We may change features. We announce material changes in the app at least 15 days ahead. Maintenance is announced through in-app announcements.',
          ),
        ],
      },
      {
        id: 'fesih',
        heading: 'Termination',
        blocks: [
          p(
            md`You can delete your account at any time: in the app or on the ${page('/data-deletion', 'Data Deletion page')}. We may suspend an account for serious violations, with notice where lawful.`,
          ),
        ],
      },
      {
        id: 'sorumluluk',
        heading: 'Limitation of liability',
        blocks: [
          p(
            'Our liability is limited to the extent permitted by law. Liability for intent and gross negligence is not excluded, and your consumer rights are unaffected.',
          ),
        ],
      },
      {
        id: 'uygulanacak-hukuk',
        heading: 'Governing law and disputes',
        blocks: [
          p(
            'These terms are governed by the laws of the Republic of Türkiye. Consumer arbitration committees are competent within the statutory monetary thresholds, and consumer courts above them. Mandatory protections of your country of residence are unaffected.',
          ),
        ],
      },
      {
        id: 'degisiklikler',
        heading: 'Changes to these terms',
        blocks: [
          p(
            'Every version of these terms is published with its version number and effective date. We announce material changes in the app at least 15 days before they take effect.',
          ),
        ],
      },
      {
        id: 'iletisim',
        heading: 'Contact',
        blocks: [
          {
            type: 'dl',
            items: [
              { term: 'Support', desc: [mail(c.supportEmail)] },
              { term: 'Privacy', desc: [mail(c.privacyEmail)] },
              ...(c.address === undefined ? [] : [{ term: 'Postal address', desc: [c.address] }]),
              ...(c.kepAddress === undefined ? [] : [{ term: 'KEP', desc: [c.kepAddress] }]),
            ],
          },
          p(md`Privacy details are in the ${page('/privacy', 'Privacy Policy')}.`),
        ],
      },
    ],
  };
}
