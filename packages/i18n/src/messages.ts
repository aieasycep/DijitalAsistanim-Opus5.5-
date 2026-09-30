/**
 * The merged ICU catalogs. JSON files are imported statically so every bundler (Metro, Next.js,
 * Vite) inlines them and TypeScript infers `Messages` from the Turkish source of truth. English is
 * typed as `Messages`, so a key missing in `en` is a compile error; extra keys and argument
 * drift are caught by `scripts/check-catalogs.ts`.
 */

import trCommon from '../messages/tr/common.json';
import trStates from '../messages/tr/states.json';
import trErrors from '../messages/tr/errors.json';
import trOnboarding from '../messages/tr/onboarding.json';
import trAuth from '../messages/tr/auth.json';
import trToday from '../messages/tr/today.json';
import trBriefing from '../messages/tr/briefing.json';
import trFlow from '../messages/tr/flow.json';
import trMail from '../messages/tr/mail.json';
import trReply from '../messages/tr/reply.json';
import trWaiting from '../messages/tr/waiting.json';
import trFollowups from '../messages/tr/followups.json';
import trCommitments from '../messages/tr/commitments.json';
import trLife from '../messages/tr/life.json';
import trPlan from '../messages/tr/plan.json';
import trMeeting from '../messages/tr/meeting.json';
import trAssistant from '../messages/tr/assistant.json';
import trVoice from '../messages/tr/voice.json';
import trMemory from '../messages/tr/memory.json';
import trSearch from '../messages/tr/search.json';
import trPerson from '../messages/tr/person.json';
import trCapture from '../messages/tr/capture.json';
import trReminder from '../messages/tr/reminder.json';
import trApprovals from '../messages/tr/approvals.json';
import trExplain from '../messages/tr/explain.json';
import trCorrection from '../messages/tr/correction.json';
import trSettings from '../messages/tr/settings.json';
import trPrivacy from '../messages/tr/privacy.json';
import trNotifications from '../messages/tr/notifications.json';
import trPush from '../messages/tr/push.json';
import trSubscription from '../messages/tr/subscription.json';
import trPaywall from '../messages/tr/paywall.json';
import trReferral from '../messages/tr/referral.json';
import trAndroidNi from '../messages/tr/android_ni.json';
import trWidgets from '../messages/tr/widgets.json';
import trWeb from '../messages/tr/web.json';
import trLegal from '../messages/tr/legal.json';
import trFaq from '../messages/tr/faq.json';
import trBackoffice from '../messages/tr/backoffice.json';
import trBackofficeEmail from '../messages/tr/backoffice_email.json';
import enCommon from '../messages/en/common.json';
import enStates from '../messages/en/states.json';
import enErrors from '../messages/en/errors.json';
import enOnboarding from '../messages/en/onboarding.json';
import enAuth from '../messages/en/auth.json';
import enToday from '../messages/en/today.json';
import enBriefing from '../messages/en/briefing.json';
import enFlow from '../messages/en/flow.json';
import enMail from '../messages/en/mail.json';
import enReply from '../messages/en/reply.json';
import enWaiting from '../messages/en/waiting.json';
import enFollowups from '../messages/en/followups.json';
import enCommitments from '../messages/en/commitments.json';
import enLife from '../messages/en/life.json';
import enPlan from '../messages/en/plan.json';
import enMeeting from '../messages/en/meeting.json';
import enAssistant from '../messages/en/assistant.json';
import enVoice from '../messages/en/voice.json';
import enMemory from '../messages/en/memory.json';
import enSearch from '../messages/en/search.json';
import enPerson from '../messages/en/person.json';
import enCapture from '../messages/en/capture.json';
import enReminder from '../messages/en/reminder.json';
import enApprovals from '../messages/en/approvals.json';
import enExplain from '../messages/en/explain.json';
import enCorrection from '../messages/en/correction.json';
import enSettings from '../messages/en/settings.json';
import enPrivacy from '../messages/en/privacy.json';
import enNotifications from '../messages/en/notifications.json';
import enPush from '../messages/en/push.json';
import enSubscription from '../messages/en/subscription.json';
import enPaywall from '../messages/en/paywall.json';
import enReferral from '../messages/en/referral.json';
import enAndroidNi from '../messages/en/android_ni.json';
import enWidgets from '../messages/en/widgets.json';
import enWeb from '../messages/en/web.json';
import enLegal from '../messages/en/legal.json';
import enFaq from '../messages/en/faq.json';
import enBackoffice from '../messages/en/backoffice.json';
import enBackofficeEmail from '../messages/en/backoffice_email.json';

import type { Locale } from './locales.ts';
import type { Namespace } from './namespaces.ts';

const tr = {
  common: trCommon,
  states: trStates,
  errors: trErrors,
  onboarding: trOnboarding,
  auth: trAuth,
  today: trToday,
  briefing: trBriefing,
  flow: trFlow,
  mail: trMail,
  reply: trReply,
  waiting: trWaiting,
  followups: trFollowups,
  commitments: trCommitments,
  life: trLife,
  plan: trPlan,
  meeting: trMeeting,
  assistant: trAssistant,
  voice: trVoice,
  memory: trMemory,
  search: trSearch,
  person: trPerson,
  capture: trCapture,
  reminder: trReminder,
  approvals: trApprovals,
  explain: trExplain,
  correction: trCorrection,
  settings: trSettings,
  privacy: trPrivacy,
  notifications: trNotifications,
  push: trPush,
  subscription: trSubscription,
  paywall: trPaywall,
  referral: trReferral,
  android_ni: trAndroidNi,
  widgets: trWidgets,
  web: trWeb,
  legal: trLegal,
  faq: trFaq,
  backoffice: trBackoffice,
  backoffice_email: trBackofficeEmail,
};

/** The catalog shape, inferred from the Turkish catalog (the default locale). */
export type Messages = typeof tr;

const en: Messages = {
  common: enCommon,
  states: enStates,
  errors: enErrors,
  onboarding: enOnboarding,
  auth: enAuth,
  today: enToday,
  briefing: enBriefing,
  flow: enFlow,
  mail: enMail,
  reply: enReply,
  waiting: enWaiting,
  followups: enFollowups,
  commitments: enCommitments,
  life: enLife,
  plan: enPlan,
  meeting: enMeeting,
  assistant: enAssistant,
  voice: enVoice,
  memory: enMemory,
  search: enSearch,
  person: enPerson,
  capture: enCapture,
  reminder: enReminder,
  approvals: enApprovals,
  explain: enExplain,
  correction: enCorrection,
  settings: enSettings,
  privacy: enPrivacy,
  notifications: enNotifications,
  push: enPush,
  subscription: enSubscription,
  paywall: enPaywall,
  referral: enReferral,
  android_ni: enAndroidNi,
  widgets: enWidgets,
  web: enWeb,
  legal: enLegal,
  faq: enFaq,
  backoffice: enBackoffice,
  backoffice_email: enBackofficeEmail,
};

const CATALOGS: Readonly<Record<Locale, Messages>> = { tr, en };

/** Every namespace of a locale, merged into one object (use-intl / next-intl `messages`). */
export function loadMessages(locale: Locale): Messages {
  return CATALOGS[locale];
}

/**
 * A subset of namespaces, e.g. for a next-intl client provider that only needs `common` and
 * `states`, or the backoffice, which never ships mobile copy.
 */
export function loadNamespaces<N extends Namespace>(
  locale: Locale,
  namespaces: readonly N[],
): Pick<Messages, N> {
  const catalog = CATALOGS[locale];
  const picked: Partial<Pick<Messages, N>> = {};
  for (const namespace of namespaces) picked[namespace] = catalog[namespace];
  return picked as Pick<Messages, N>;
}

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every dot-separated message key, e.g. `'common.actions.approve'`. */
export type MessageKey = Leaves<Messages>;

/**
 * Looks a dot-separated key up in a catalog and returns the raw ICU message, or `undefined` when
 * the key does not resolve to a string. Used by server-side renderers and tests; screens use
 * `useTranslations`.
 */
export function lookupMessage(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment))
      return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}
