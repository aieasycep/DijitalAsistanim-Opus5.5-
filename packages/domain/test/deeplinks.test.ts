import { describe, expect, it } from 'vitest';
import {
  deepLinkForInsight,
  parseDeepLink,
  parseOAuthCallback,
  ROUTE_PATTERNS,
  routeForInsight,
  routeForNotification,
  routeForSource,
  routePatternOf,
  routes,
  toDeepLink,
  toUniversalLink,
} from '../src/deeplinks.ts';
import { INSIGHT_KIND_VALUES, NOTIFICATION_CATEGORY_VALUES } from '../src/enums.ts';

const ID = '5b3a1c9e-2f4d-4a8b-9c7e-1d2f3a4b5c6d';
const WEB = 'https://dijitalasistan.app';

describe('route builders (MASTER_PLAN §9)', () => {
  it.each([
    [routes.today(), '/today'],
    [routes.flow('personal'), '/flow?filter=personal'],
    [routes.plan({ view: 'week' }), '/plan?view=week'],
    [routes.briefing(ID), `/briefing/${ID}`],
    [routes.briefingListen(ID), `/briefing/${ID}/listen`],
    [routes.weeklyShare(ID), `/weekly/${ID}/share`],
    [routes.mailCategory('has_deadline'), '/mail/category/has_deadline'],
    [routes.mailReply(ID, { mode: 'follow_up' }), `/mail/${ID}/reply?mode=follow_up`],
    [routes.meetingPrep(ID), `/meeting/${ID}/prep`],
    [routes.planConflict(ID), `/plan/conflict/${ID}`],
    [routes.chatNew({ contactId: ID }), `/chat/new?contactId=${ID}`],
    [routes.approval(ID), `/approvals/${ID}`],
    [
      routes.reminderNew({ preset: 'tomorrow_morning', title: 'Teklif & revize' }),
      '/reminders/new?preset=tomorrow_morning&title=Teklif%20%26%20revize',
    ],
    [routes.settingsAccount(ID), `/settings/accounts/${ID}`],
    [routes.paywall('midday_gate'), '/paywall?source=midday_gate'],
  ])('%s', (built, expected) => {
    expect(built).toBe(expected);
  });

  it('every builder output passes the allow-list', () => {
    for (const path of [
      routes.today(),
      routes.flow(),
      routes.plan(),
      routes.assistant(),
      routes.briefings(),
      routes.mail(),
      routes.waiting(),
      routes.followups(ID),
      routes.commitments(),
      routes.commitment(ID),
      routes.life(ID),
      routes.event(ID),
      routes.meetingSummary(ID),
      routes.meetingPost(ID),
      routes.planProposal(ID),
      routes.person(ID),
      routes.vip(),
      routes.search(),
      routes.memory(),
      routes.voice(),
      routes.capture(),
      routes.captureDetail(ID),
      routes.chat(ID),
      routes.approvals(),
      routes.settings(),
      routes.settingsAccounts(),
      routes.settingsNotifications(),
      routes.settingsPriorityRule(ID),
      routes.weekly(ID),
      routes.mailDetail(ID),
    ]) {
      expect(parseDeepLink(path).ok, path).toBe(true);
    }
  });

  it('rejects a non-uuid id', () => {
    expect(() => routes.mailDetail('123')).toThrow(RangeError);
  });

  it('scheme and universal links', () => {
    expect(toDeepLink(`/mail/${ID}`)).toBe(`dijitalasistan://mail/${ID}`);
    expect(toUniversalLink('/today', `${WEB}/`)).toBe(`${WEB}/app/today`);
  });
});

describe('parseDeepLink (M-GL-07, UT-LINK-01)', () => {
  it.each([
    [`dijitalasistan://mail/${ID}`, '/mail/:id'],
    [`DIJITALASISTAN://today`, '/today'],
    [`/briefing/${ID}/listen?autoplay=true`, '/briefing/:id/listen'],
    [`${WEB}/app/approvals/${ID}`, '/approvals/:id'],
    [`${WEB}/r/7K3M9PQ`, '/r/:code'],
    [`${WEB}/oauth/done?provider=google&result=denied`, '/oauth/done'],
    ['dijitalasistan://chat/new?prompt=today_summary', '/chat/new'],
    [`dijitalasistan://chat/${ID}`, '/chat/:threadId'],
    ['dijitalasistan://mail/category/important', '/mail/category/:category'],
    ['dijitalasistan://settings/privacy/delete-account', '/settings/privacy/delete-account'],
  ])('%s → %s', (url, pattern) => {
    const r = parseDeepLink(url, { webOrigin: WEB });
    expect(r.ok && r.route.pattern).toBe(pattern);
  });

  it('keeps only allow-listed query keys (+ src/w)', () => {
    const r = parseDeepLink(`dijitalasistan://today?src=widget&w=small&evil=1`);
    expect(r.ok && r.route.query).toEqual({ src: 'widget', w: 'small' });
    const q = parseDeepLink('dijitalasistan://flow?filter=personal&token=abc');
    expect(q.ok && q.route.query).toEqual({ filter: 'personal' });
  });

  it.each([
    ['javascript:alert(1)', 'scheme_not_allowed'],
    ['http://dijitalasistan.app/app/today', 'scheme_not_allowed'],
    ['https://evil.example.com/app/today', 'host_not_allowed'],
    [`${WEB}.evil.com/app/today`, 'host_not_allowed'],
    [`${WEB}/pricing`, 'not_allowed'],
    ['dijitalasistan://admin', 'not_allowed'],
    ['dijitalasistan://mail/123', 'invalid_param'],
    ['dijitalasistan://mail/category/awaiting_my_reply', 'invalid_param'],
    ['dijitalasistan://mail/../settings', 'malformed'],
    ['//evil.example.com', 'malformed'],
    ['', 'malformed'],
    ['dijitalasistan://demo/setup', 'not_allowed'],
  ])('%s → rejected (%s)', (url, reason) => {
    expect(parseDeepLink(url, { webOrigin: WEB })).toEqual({ ok: false, reason });
  });

  it('demo setup only in demo builds', () => {
    expect(parseDeepLink('dijitalasistan://demo/setup?scenario=pro', { allowDemo: true }).ok).toBe(
      true,
    );
  });

  it('universal links need a configured origin', () => {
    expect(parseDeepLink(`${WEB}/app/today`)).toEqual({ ok: false, reason: 'host_not_allowed' });
  });

  it('route patterns replace ids for analytics', () => {
    expect(routePatternOf(`/meeting/${ID}/prep?src=push`)).toBe('/meeting/:eventId/prep');
    expect(routePatternOf('/unknown')).toBeNull();
    expect(new Set(ROUTE_PATTERNS).size).toBe(ROUTE_PATTERNS.length);
  });
});

describe('notification and insight routing (M-GL-08)', () => {
  it.each([
    ['morning', `/briefing/${ID}`],
    ['midday', `/briefing/${ID}`],
    ['evening', `/briefing/${ID}`],
    ['critical_email', `/mail/${ID}`],
    ['meeting', `/meeting/${ID}/prep`],
    ['deadline', `/mail/${ID}`],
    ['follow_up', `/mail/${ID}`],
    ['life_intel', `/life/${ID}`],
    ['approval', `/approvals/${ID}`],
    ['account', `/settings/accounts/${ID}`],
    ['reminder', '/today'],
  ] as const)('%s → %s', (type, path) => {
    expect(routeForNotification(type, ID)).toBe(path);
  });

  it('every category routes; a missing entity routes to Today', () => {
    for (const c of NOTIFICATION_CATEGORY_VALUES)
      expect(parseDeepLink(routeForNotification(c, ID)).ok).toBe(true);
    expect(routeForNotification('meeting', null)).toBe('/today');
  });

  it.each([
    [{ kind: 'follow_up', entity_type: 'email_thread' }, `/followups?focus=${ID}`],
    [{ kind: 'conflict', entity_type: 'calendar_event' }, `/plan/conflict/${ID}`],
    [{ kind: 'approval_pending', entity_type: 'approval_action' }, `/approvals/${ID}`],
    [{ kind: 'schedule_suggestion', entity_type: 'approval_action' }, `/plan/proposal/${ID}`],
    [{ kind: 'schedule_suggestion', entity_type: 'task' }, '/plan'],
    [{ kind: 'meeting', entity_type: 'calendar_event' }, `/meeting/${ID}/prep`],
    [{ kind: 'commitment', entity_type: 'commitment' }, `/commitments/${ID}`],
    [{ kind: 'life_event', entity_type: 'life_event' }, `/life/${ID}`],
    [{ kind: 'security', entity_type: 'life_event' }, `/life/${ID}`],
    [{ kind: 'digest', entity_type: 'briefing' }, `/briefing/${ID}`],
    [{ kind: 'reply_needed', entity_type: 'email_thread' }, `/mail/${ID}`],
    [{ kind: 'deadline', entity_type: 'capture' }, `/capture/${ID}`],
    [{ kind: 'deadline', entity_type: 'task' }, '/plan'],
  ] as const)('insight %j → %s', (ins, path) => {
    expect(routeForInsight({ id: ID, entity_id: ID, ...ins })).toBe(path);
  });

  it('every insight kind yields an allow-listed deep link', () => {
    for (const kind of INSIGHT_KIND_VALUES) {
      const link = deepLinkForInsight({ id: ID, kind, entity_type: 'email_thread', entity_id: ID });
      expect(parseDeepLink(link).ok, `${kind} ${link}`).toBe(true);
    }
  });

  it('source routes ("Bu nereden çıktı?")', () => {
    expect(routeForSource('email_message', ID)).toBe(`/mail/${ID}`);
    expect(routeForSource('device_calendar_event', ID)).toBe(`/event/${ID}`);
    expect(routeForSource('user_input', ID)).toBeNull();
    expect(routeForSource('capture', 'nope')).toBeNull();
  });
});

describe('OAuth callback validation (R-07)', () => {
  const code = 'Q2FsbGJhY2tDb2RlXzEyMzQ1Njc4';
  it('accepts pending_confirmation with an opaque completion code', () => {
    expect(
      parseOAuthCallback({
        provider: 'google',
        result: 'pending_confirmation',
        completion_code: code,
      }),
    ).toEqual({
      provider: 'google',
      result: 'pending_confirmation',
      completionCode: code,
      errorCode: null,
      adminConsentUrl: null,
    });
  });

  it.each<Record<string, string>>([
    { provider: 'apple', result: 'denied' },
    { provider: 'google', result: 'connected' },
    { provider: 'google', result: 'pending_confirmation' },
    { provider: 'google', result: 'pending_confirmation', completion_code: 'short' },
    { provider: 'google', result: 'denied', completion_code: code },
    {
      provider: 'microsoft',
      result: 'denied',
      admin_consent_url: 'https://login.microsoftonline.com/x',
    },
    { provider: 'microsoft', result: 'admin_consent_required', admin_consent_url: 'http://x' },
    { provider: 'microsoft', result: 'error', error_code: 'bad code!' },
  ])('rejects %j', (q) => {
    expect(parseOAuthCallback(q)).toBeNull();
  });

  it('admin consent and error codes', () => {
    expect(
      parseOAuthCallback({
        provider: 'microsoft',
        result: 'admin_consent_required',
        admin_consent_url: 'https://login.microsoftonline.com/x',
      })?.adminConsentUrl,
    ).toBe('https://login.microsoftonline.com/x');
    expect(
      parseOAuthCallback({ provider: 'demo', result: 'error', error_code: 'PROVIDER_UNAVAILABLE' })
        ?.errorCode,
    ).toBe('PROVIDER_UNAVAILABLE');
  });
});
