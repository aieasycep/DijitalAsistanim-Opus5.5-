import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../src/entities/preferences.ts';
import {
  countsTowardDailyCap,
  DECISION_CHECKS,
  decide,
  type DecisionContext,
  type DecisionState,
  detailModeFor,
  minDetail,
  type NotificationCandidate,
  type SentRecord,
} from '../../src/notifications/decide.ts';

const IST = 'Europe/Istanbul';
const BER = 'Europe/Berlin';
const prefs = DEFAULT_NOTIFICATION_PREFERENCES;

/** Istanbul local HH:mm on 2026-09-23 as an instant (UTC+3). */
const ist = (hhmm: string, day = '2026-09-23'): string => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)), h - 3, m),
  );
  return d.toISOString();
};

const ctx = (over: Partial<DecisionContext> = {}): DecisionContext => ({
  prefs,
  timeZone: IST,
  now: ist('12:00'),
  isPro: true,
  ...over,
});
const state = (over: Partial<DecisionState> = {}): DecisionState => ({
  dedupeKeyExists: false,
  recent: [],
  hasActiveDevice: true,
  osPermission: 'granted',
  ...over,
});
const cand = (over: Partial<NotificationCandidate> = {}): NotificationCandidate => ({
  category: 'critical_email',
  dedupeKey: 'critical_email:email_thread:t1:2026-09-23',
  urgency: 'urgent',
  ...over,
});

describe('decide() — the seven checks in order', () => {
  it('lists exactly the M§132 checks', () => {
    expect(DECISION_CHECKS).toEqual([
      'relevance',
      'urgency',
      'category_preference',
      'quiet_hours',
      'dedupe',
      'frequency_cap',
      'detail_mode',
    ]);
  });

  it('passes every check → send with the default title_only detail', () => {
    const r = decide(cand(), state(), ctx());
    expect(r).toMatchObject({
      outcome: 'send',
      ledgerDecision: 'sent',
      reason: null,
      decidedBy: 'detail_mode',
      detailMode: 'title_only',
    });
  });

  describe('1 relevance', () => {
    it.each([
      [{ relevant: false }, 'low_relevance'],
      [{ entitled: false }, 'not_entitled'],
      [{ validUntil: ist('11:00') }, 'low_relevance'],
    ] as const)('%j → %s', (over, reason) => {
      const r = decide(cand(over), state(), ctx());
      expect(r).toMatchObject({ outcome: 'suppress', reason, decidedBy: 'relevance' });
    });

    it('late delivery over 90 min is suppressed; 90 min is still sent (ADR-28)', () => {
      const late = decide(
        cand({ category: 'morning', urgency: 'normal', scheduledFor: ist('10:29') }),
        state(),
        ctx(),
      );
      expect(late.reason).toBe('late_delivery');
      const ok = decide(
        cand({ category: 'morning', urgency: 'normal', scheduledFor: ist('10:30') }),
        state(),
        ctx(),
      );
      expect(ok.outcome).toBe('send');
    });

    it('a future scheduledFor is scheduled at that time', () => {
      const r = decide(cand({ scheduledFor: ist('15:00') }), state(), ctx());
      expect(r).toMatchObject({ outcome: 'schedule', ledgerDecision: 'scheduled' });
      expect(r.scheduleAt?.toISOString()).toBe(ist('15:00'));
    });
  });

  describe('2 urgency', () => {
    it('UT-NTF-07: smart filter suppresses normal urgency', () => {
      const r = decide(cand({ category: 'follow_up', urgency: 'normal' }), state(), ctx());
      expect(r).toMatchObject({
        outcome: 'suppress',
        reason: 'smart_filter',
        decidedBy: 'urgency',
      });
    });
    it('smart filter off lets normal urgency through', () => {
      const r = decide(
        cand({ category: 'follow_up', urgency: 'normal' }),
        state(),
        ctx({ prefs: { ...prefs, smart_filter: false } }),
      );
      expect(r.outcome).toBe('send');
    });
    it('low urgency never pushes', () => {
      const r = decide(
        cand({ category: 'deadline', urgency: 'low' }),
        state(),
        ctx({ prefs: { ...prefs, smart_filter: false } }),
      );
      expect(r.reason).toBe('low_relevance');
    });
    it('briefings, account and user reminders are exempt from the urgency filter', () => {
      expect(decide(cand({ category: 'morning', urgency: 'normal' }), state(), ctx()).outcome).toBe(
        'send',
      );
      expect(decide(cand({ category: 'account', urgency: 'normal' }), state(), ctx()).outcome).toBe(
        'send',
      );
      expect(
        decide(
          cand({ category: 'deadline', urgency: 'normal', kind: 'user_reminder' }),
          state(),
          ctx(),
        ).outcome,
      ).toBe('send');
    });
  });

  describe('3 category preference', () => {
    it('UT-NTF-01: a disabled category is suppressed', () => {
      const r = decide(
        cand({ category: 'midday', urgency: 'today' }),
        state(),
        ctx({ prefs: { ...prefs, midday: false } }),
      );
      expect(r).toMatchObject({
        outcome: 'suppress',
        reason: 'category_disabled',
        decidedBy: 'category_preference',
      });
    });
    it('life_intel is off by default', () => {
      expect(
        decide(cand({ category: 'life_intel', urgency: 'today' }), state(), ctx()).reason,
      ).toBe('category_disabled');
    });
    it('"Yarına Hazırım" snooze holds non-critical categories until snooze_until', () => {
      const snoozed = { ...prefs, snooze_until: ist('08:00', '2026-09-24') };
      const r = decide(
        cand({ category: 'deadline', urgency: 'today' }),
        state(),
        ctx({ prefs: snoozed }),
      );
      expect(r).toMatchObject({ outcome: 'schedule' });
      expect(r.scheduleAt?.toISOString()).toBe(ist('08:00', '2026-09-24'));
      const stale = decide(
        cand({ category: 'deadline', urgency: 'today', validUntil: ist('18:00') }),
        state(),
        ctx({ prefs: snoozed }),
      );
      expect(stale.reason).toBe('snoozed');
      expect(decide(cand(), state(), ctx({ prefs: snoozed })).outcome).toBe('send');
    });
  });

  describe('4 quiet hours (R-13)', () => {
    it('UT-NTF-02: non-VIP critical_email at 23:10 is scheduled for 07:30', () => {
      const r = decide(cand(), state(), ctx({ now: ist('23:10') }));
      expect(r).toMatchObject({ outcome: 'schedule', decidedBy: 'quiet_hours' });
      expect(r.scheduleAt?.toISOString()).toBe(ist('07:30', '2026-09-24'));
    });

    it('UT-NTF-03: a meeting push that would be stale at 07:30 is suppressed', () => {
      const r = decide(
        cand({ category: 'meeting', urgency: 'urgent', validUntil: ist('06:30', '2026-09-24') }),
        state(),
        ctx({ now: ist('06:10', '2026-09-24') }),
      );
      expect(r).toMatchObject({ outcome: 'suppress', reason: 'quiet_hours' });
    });

    it('UT-NTF-16: a user-created reminder inside quiet hours fires at its time', () => {
      const r = decide(
        cand({
          category: 'deadline',
          kind: 'user_reminder',
          urgency: 'normal',
          scheduledFor: ist('23:15'),
        }),
        state(),
        ctx({ now: ist('23:15') }),
      );
      expect(r).toMatchObject({ outcome: 'send', bypassedQuietHours: true });
    });

    it('UT-NTF-09: VIP critical_email bypasses up to 3 times per quiet window', () => {
      const vip = { isVip: true, bypassQuietHours: true };
      const now = ist('23:30');
      const recent = (n: number): SentRecord[] =>
        Array.from({ length: n }, (_, i) => ({
          category: 'critical_email' as const,
          sentAt: ist(`22:${String(40 + i).padStart(2, '0')}`),
          bypassedQuietHours: true,
        }));
      const third = decide(cand({ vip }), state({ recent: recent(2) }), ctx({ now }));
      expect(third).toMatchObject({ outcome: 'send', bypassedQuietHours: true });
      const fourth = decide(cand({ vip }), state({ recent: recent(3) }), ctx({ now }));
      expect(fourth).toMatchObject({ outcome: 'schedule' });
      expect(fourth.scheduleAt?.toISOString()).toBe(ist('07:30', '2026-09-24'));
      // bypasses from the previous night do not count
      const old: SentRecord[] = recent(3).map((r) => ({
        ...r,
        sentAt: ist('23:00', '2026-09-22'),
      }));
      expect(decide(cand({ vip }), state({ recent: old }), ctx({ now })).outcome).toBe('send');
    });

    it.each([
      ['category is not critical_email', { category: 'deadline' as const }, {}, {}],
      ['vip_bypass_quiet off', {}, { vip_bypass_quiet: false }, {}],
      ['per-VIP override off', { vip: { isVip: true, bypassQuietHours: false } }, {}, {}],
      ['Free user', {}, {}, { isPro: false }],
    ])('no VIP bypass when %s', (_label, cOver, pOver, xOver) => {
      const r = decide(
        cand({ vip: { isVip: true, bypassQuietHours: true }, ...cOver }),
        state(),
        ctx({ now: ist('23:30'), prefs: { ...prefs, ...pOver }, ...xOver }),
      );
      expect(r.outcome).toBe('schedule');
    });

    it('VIP bypasses are still deduped', () => {
      const r = decide(
        cand({ vip: { isVip: true, bypassQuietHours: true } }),
        state({ dedupeKeyExists: true }),
        ctx({ now: ist('23:30') }),
      );
      expect(r).toMatchObject({ outcome: 'suppress', ledgerDecision: 'deduplicated' });
    });

    it('UT-NTF-17: an admin test push never bypasses and renders generic', () => {
      const r = decide(
        cand({ kind: 'admin_test', category: 'account', urgency: 'normal' }),
        state(),
        ctx({ now: ist('23:00') }),
      );
      expect(r.outcome).toBe('schedule');
      expect(r.scheduleAt?.toISOString()).toBe(ist('07:30', '2026-09-24'));
      expect(r.detail).toEqual({ ios: 'generic', android: 'generic' });
    });

    it('quiet hours disabled → send at night', () => {
      const r = decide(
        cand(),
        state(),
        ctx({ now: ist('23:10'), prefs: { ...prefs, quiet_hours_enabled: false } }),
      );
      expect(r.outcome).toBe('send');
    });

    it('quiet days: a window only on selected start days', () => {
      const r = decide(
        cand(),
        state(),
        ctx({ now: ist('23:10'), prefs: { ...prefs, quiet_days: [6, 7] } }),
      );
      expect(r.outcome).toBe('send'); // Wednesday night is not a quiet day
    });

    it('DST: Berlin quiet window across the fall-back night ends at 07:30 CET', () => {
      const r = decide(cand(), state(), ctx({ timeZone: BER, now: '2026-10-25T01:00:00Z' }));
      expect(r.scheduleAt?.toISOString()).toBe('2026-10-25T06:30:00.000Z');
      const before = decide(cand(), state(), ctx({ timeZone: BER, now: '2026-10-24T20:29:00Z' }));
      expect(before.outcome).toBe('send');
    });

    it('DST: Berlin spring-forward night ends at 07:30 CEST', () => {
      const r = decide(cand(), state(), ctx({ timeZone: BER, now: '2026-03-29T01:00:00Z' }));
      expect(r.scheduleAt?.toISOString()).toBe('2026-03-29T05:30:00.000Z');
    });
  });

  describe('5 dedupe', () => {
    it('UT-NTF-04: an existing dedupe key → deduplicated', () => {
      const r = decide(cand(), state({ dedupeKeyExists: true }), ctx());
      expect(r).toMatchObject({
        outcome: 'suppress',
        ledgerDecision: 'deduplicated',
        reason: 'deduplicated',
        decidedBy: 'dedupe',
      });
    });
  });

  describe('6 frequency caps (R-14)', () => {
    const sent = (category: SentRecord['category'], n: number, hoursAgo = 2): SentRecord[] =>
      Array.from({ length: n }, () => ({
        category,
        sentAt: new Date(Date.parse(ist('12:00')) - hoursAgo * 3_600_000).toISOString(),
      }));

    it('UT-NTF-05: the 6th non-critical push within 24 h is suppressed (daily_cap 5)', () => {
      const recent = [...sent('deadline', 2), ...sent('approval', 3)];
      const r = decide(cand({ category: 'approval', urgency: 'today' }), state({ recent }), ctx());
      expect(r).toMatchObject({
        outcome: 'suppress',
        reason: 'frequency_cap',
        decidedBy: 'frequency_cap',
      });
      const four = decide(
        cand({ category: 'approval', urgency: 'today' }),
        state({ recent: recent.slice(1) }),
        ctx(),
      );
      expect(four.outcome).toBe('send');
    });

    it('the window is rolling 24 h', () => {
      const recent = sent('approval', 5, 25);
      expect(
        decide(cand({ category: 'approval', urgency: 'today' }), state({ recent }), ctx()).outcome,
      ).toBe('send');
    });

    it('critical categories and briefings do not count toward the daily cap', () => {
      const recent = sent('approval', 5);
      expect(decide(cand(), state({ recent }), ctx()).outcome).toBe('send');
      expect(
        decide(cand({ category: 'morning', urgency: 'normal' }), state({ recent }), ctx()).outcome,
      ).toBe('send');
      expect(countsTowardDailyCap('meeting')).toBe(false);
      expect(countsTowardDailyCap('follow_up')).toBe(true);
      expect(countsTowardDailyCap('follow_up', 'user_reminder')).toBe(false);
    });

    it.each([
      ['follow_up', 2],
      ['life_intel', 3],
      ['deadline', 3],
    ] as const)('UT-NTF-06: per-category cap %s = %d', (category, cap) => {
      const p = { ...prefs, life_intel: true, daily_cap: 20 };
      const at = decide(
        cand({ category, urgency: 'today' }),
        state({ recent: sent(category, cap) }),
        ctx({ prefs: p }),
      );
      expect(at.reason).toBe('frequency_cap');
      const below = decide(
        cand({ category, urgency: 'today' }),
        state({ recent: sent(category, cap - 1) }),
        ctx({ prefs: p }),
      );
      expect(below.outcome).toBe('send');
    });

    it('caps are configurable', () => {
      const r = decide(
        cand({ category: 'follow_up', urgency: 'today' }),
        state({ recent: sent('follow_up', 2) }),
        ctx({ categoryCaps: { follow_up: 4 } }),
      );
      expect(r.outcome).toBe('send');
    });
  });

  describe('7 detail mode and deliverability', () => {
    it('iOS is capped at title_only while lock_screen_private; Android keeps full', () => {
      const r = decide(cand(), state(), ctx({ prefs: { ...prefs, detail_level: 'full' } }));
      expect(r.detail).toEqual({ ios: 'title_only', android: 'full' });
      expect(r.detailMode).toBe('title_only');
      const open = decide(
        cand(),
        state(),
        ctx({ prefs: { ...prefs, detail_level: 'full', lock_screen_private: false } }),
      );
      expect(open.detail).toEqual({ ios: 'full', android: 'full' });
    });

    it('generic stays generic', () => {
      expect(
        detailModeFor({ detail_level: 'generic', lock_screen_private: false }, 'android'),
      ).toBe('generic');
      expect(minDetail('full', 'generic')).toBe('generic');
    });

    it('no device / OS permission denied', () => {
      expect(decide(cand(), state({ hasActiveDevice: false }), ctx()).reason).toBe('no_device');
      expect(decide(cand(), state({ osPermission: 'denied' }), ctx()).reason).toBe(
        'os_permission_denied',
      );
    });
  });

  it('UT-NTF-15: defaults for a new user', () => {
    expect(prefs).toMatchObject({
      quiet_hours_enabled: true,
      quiet_start: '22:30',
      quiet_end: '07:30',
      vip_bypass_quiet: true,
      daily_cap: 5,
      detail_level: 'title_only',
      smart_filter: true,
      lock_screen_private: true,
    });
  });
});
