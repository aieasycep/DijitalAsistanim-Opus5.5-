import { describe, expect, it } from 'vitest';
import {
  detectExpectsReply,
  FOLLOW_UP_AFTER_DAYS_DEFAULT,
  followUpState,
  threadReplyState,
  waitBadge,
  waitingDays,
} from '../../src/followups/state.ts';

const IST = 'Europe/Istanbul';

describe('threadReplyState', () => {
  it('awaiting_their_reply after the user asks', () => {
    const r = threadReplyState([
      { direction: 'inbound', at: '2026-09-20T07:00:00Z', needsReply: true },
      { direction: 'outbound', at: '2026-09-21T07:00:00Z', expectsReply: 'yes' },
    ]);
    expect(r).toEqual({ state: 'awaiting_their_reply', since: new Date('2026-09-21T07:00:00Z') });
  });

  it('a sent answer without a question closes the thread', () => {
    expect(
      threadReplyState([
        { direction: 'inbound', at: '2026-09-20T07:00:00Z', needsReply: true },
        { direction: 'outbound', at: '2026-09-21T07:00:00Z', expectsReply: 'no' },
      ]).state,
    ).toBe('none');
  });

  it('awaiting_my_reply since the first unanswered inbound', () => {
    const r = threadReplyState([
      { direction: 'outbound', at: '2026-09-19T07:00:00Z', expectsReply: 'yes' },
      { direction: 'inbound', at: '2026-09-20T07:00:00Z', needsReply: true },
      { direction: 'inbound', at: '2026-09-21T07:00:00Z', needsReply: true },
    ]);
    expect(r).toEqual({ state: 'awaiting_my_reply', since: new Date('2026-09-20T07:00:00Z') });
  });

  it('automated messages never create obligations; empty thread is none', () => {
    expect(
      threadReplyState([
        { direction: 'inbound', at: '2026-09-20T07:00:00Z', needsReply: true, automated: true },
      ]).state,
    ).toBe('none');
    expect(threadReplyState([]).state).toBe('none');
    expect(
      threadReplyState([{ direction: 'inbound', at: '2026-09-20T07:00:00Z', needsReply: false }])
        .state,
    ).toBe('none');
  });

  it('order of input does not matter', () => {
    const r = threadReplyState([
      { direction: 'outbound', at: '2026-09-21T07:00:00Z', expectsReply: 'yes' },
      { direction: 'inbound', at: '2026-09-20T07:00:00Z', needsReply: true },
    ]);
    expect(r.state).toBe('awaiting_their_reply');
  });
});

describe('waiting badge (UT-FUP-01)', () => {
  it.each([
    [0, 'neutral'],
    [2, 'neutral'],
    [3, 'amber'],
    [6, 'amber'],
    [7, 'coral'],
    [30, 'coral'],
  ] as const)('%d days → %s', (days, badge) => {
    expect(waitBadge(days)).toBe(badge);
  });

  it('counts local calendar days in the user zone', () => {
    // 23:30 local on the 20th → 00:30 local on the 23rd = 3 calendar days
    expect(waitingDays('2026-09-20T20:30:00Z', '2026-09-22T21:30:00Z', IST)).toBe(3);
    expect(waitingDays('2026-09-23T06:00:00Z', '2026-09-20T06:00:00Z', IST)).toBe(0);
  });
});

describe('followUpState', () => {
  const base = {
    replyState: 'awaiting_their_reply' as const,
    awaitingSince: '2026-09-21T07:00:00Z',
    timeZone: IST,
  };

  it('default threshold is 2 days (follow_up_after_days)', () => {
    expect(FOLLOW_UP_AFTER_DAYS_DEFAULT).toBe(2);
    expect(followUpState({ ...base, now: '2026-09-22T07:00:00Z' })).toBe('waiting');
    expect(followUpState({ ...base, now: '2026-09-23T07:00:00Z' })).toBe('nudge_due');
  });

  it('respects a custom threshold and VIP tightening', () => {
    expect(followUpState({ ...base, now: '2026-09-23T07:00:00Z', followUpAfterDays: 5 })).toBe(
      'waiting',
    );
    expect(followUpState({ ...base, now: '2026-09-22T07:00:00Z', vip: true })).toBe('nudge_due');
  });

  it('nudged, muted and resolved', () => {
    expect(
      followUpState({ ...base, now: '2026-09-25T07:00:00Z', nudgedAt: '2026-09-24T07:00:00Z' }),
    ).toBe('nudged');
    expect(followUpState({ ...base, now: '2026-09-25T07:00:00Z', muted: true })).toBe('muted');
    expect(
      followUpState({
        replyState: 'none',
        awaitingSince: null,
        now: '2026-09-25T07:00:00Z',
        timeZone: IST,
        previous: 'nudge_due',
      }),
    ).toBe('resolved');
    expect(
      followUpState({
        replyState: 'none',
        awaitingSince: null,
        now: '2026-09-25T07:00:00Z',
        timeZone: IST,
      }),
    ).toBe('none');
  });
});

describe('detectExpectsReply (§6.9.7)', () => {
  it.each([
    'Teklifi inceleyip dönüşünüzü bekliyorum.',
    'Uygun musunuz?',
    'Sözleşme taslağını iletebilir misiniz',
    'Onayınızı rica ederim.',
    'Toplantı saati için ne dersiniz',
    'Haber verebilir misin',
    'Fikrinizi paylaşır mısınız',
  ])('%s → yes', (text) => {
    expect(detectExpectsReply(text)).toBe('yes');
  });

  it.each(['Teşekkürler.', 'Bilginize.', 'Teşekkür ederim, iyi çalışmalar.', 'FYI'])(
    '%s → no',
    (text) => {
      expect(detectExpectsReply(text)).toBe('no');
    },
  );

  it('otherwise ambiguous; quoted lines are ignored', () => {
    expect(detectExpectsReply('Raporu ekte gönderiyorum. Ekip toplantısında konuşuruz.')).toBe(
      'ambiguous',
    );
    expect(detectExpectsReply('Ekte.\n\n> Uygun musunuz?')).toBe('ambiguous');
  });
});
