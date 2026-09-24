/**
 * Test pushes.
 *
 * - **User test** (API-DEV-04, SCREEN_AND_FLOW_MAP §12.3 #8): the category's template rendered at the
 *   user's current effective detail level with demo parameters (PRIMARY names), the title prefixed
 *   with "Test · " in `full` and `title_only`, deep link `settings/notifications`, sent to the one
 *   installation that asked. It goes through the decision engine (quiet hours, category switch,
 *   device) but not the frequency caps.
 * - **Admin test** (`admin-api` ADM-07, R-13): category `account`, always `generic`, never bypasses
 *   quiet hours; optionally one installation.
 */
import { type NotificationCategory, routes, toDeepLink } from '@da/domain';
import { withTrCases } from '@da/i18n/tr-suffix';
import { translate } from '../../../i18n/catalog.ts';
import { baseSpec } from '../create.ts';
import type { NotificationSpec } from '../model.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

/** PRIMARY demo people (proper names, the same in every locale). */
const DEMO_SENDER = 'Ahmet Yılmaz';
const DEMO_PERSON = 'Mehmet Yılmaz';
const DEMO_COMPANY = 'Kuzey Lojistik';

type Demo = Pick<NotificationSpec, 'template' | 'variant' | 'paramsPublic' | 'paramsSensitive'>;

function demoFor(category: NotificationCategory, locale: 'tr' | 'en'): Demo {
  const d = (key: string) => translate(locale, `push.test.demo.${key}`);
  switch (category) {
    case 'morning':
      return {
        template: 'morning',
        variant: 'ready',
        paramsPublic: { count: 3 },
        paramsSensitive: { highlights: d('highlights') },
      };
    case 'midday':
      return {
        template: 'midday',
        variant: 'ready',
        paramsPublic: { count: 2 },
        paramsSensitive: { highlights: d('highlights') },
      };
    case 'evening':
      return {
        template: 'evening',
        variant: 'ready',
        paramsPublic: { count: 2 },
        paramsSensitive: { highlights: d('highlights') },
      };
    case 'critical_email':
      return {
        template: 'critical_email',
        variant: 'reply_needed',
        paramsPublic: {},
        paramsSensitive: {
          sender: DEMO_SENDER,
          subject: d('subject'),
          expectedAction: d('action'),
        },
      };
    case 'meeting':
      return {
        template: 'meeting',
        variant: 'upcoming',
        paramsPublic: { time: '14:30', minutes: 20 },
        paramsSensitive: { meeting: d('meeting') },
      };
    case 'deadline':
      return {
        template: 'deadline',
        variant: 'due_soon',
        paramsPublic: withTrCases({ time: '17:00' }),
        paramsSensitive: { title: d('title') },
      };
    case 'follow_up':
      return {
        template: 'follow_up',
        variant: 'no_reply',
        paramsPublic: { days: 3 },
        paramsSensitive: { person: DEMO_PERSON, subject: d('subject') },
      };
    case 'life_intel':
      return {
        template: 'life_intel',
        variant: 'shipment',
        paramsPublic: { state: 'other', from: '14:00', to: '16:00' },
        paramsSensitive: { seller: DEMO_COMPANY },
      };
    case 'approval':
      return {
        template: 'approval',
        variant: 'pending',
        paramsPublic: { count: 1 },
        paramsSensitive: { summary: d('summary') },
      };
    case 'account':
      return {
        template: 'account',
        variant: 'reauth_needed',
        paramsPublic: { service: 'Gmail', kind: 'mail' },
        paramsSensitive: {},
      };
  }
}

export function userTestTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const category = ctx.payload.category;
  if (category === undefined || ctx.payload.notification_id === undefined) {
    return Promise.resolve(skip('missing_test_target'));
  }
  const demo = demoFor(category, ctx.locale);
  return Promise.resolve({
    kind: 'spec',
    spec: baseSpec({
      category,
      dedupeKey: ctx.jobKey,
      ...demo,
      urgency: 'urgent',
      deeplink: toDeepLink(routes.settingsNotifications()),
      installationRowId: ctx.payload.installation_id ?? null,
      userTest: true,
      isTest: true,
    }),
  });
}

export function adminTestSpec(ctx: TriggerContext, jobId: string): NotificationSpec {
  return baseSpec({
    category: 'account',
    dedupeKey: `admin_test_push:${jobId}`,
    template: 'account',
    variant: 'reauth_needed',
    urgency: 'today',
    kind: 'admin_test',
    deeplink: toDeepLink(routes.today()),
    installationRowId: ctx.payload.installation_id ?? null,
    isTest: true,
  });
}
