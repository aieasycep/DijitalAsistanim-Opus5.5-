import { describe, expect, it } from 'vitest';
import {
  actionableCommitments,
  type CommitmentCandidate,
  type CommitmentDetectOptions,
  detectCommitments,
  stripQuotedHistory,
} from '../../src/commitments/detect.ts';
import { resolveCommitmentDue } from '../../src/commitments/due.ts';
import { commitmentDedupeKey } from '../../src/ids.ts';

const IST = 'Europe/Istanbul';
const A1 = '2026-09-23T06:00:00Z'; // Wed 09:00 Istanbul
const sent: CommitmentDetectOptions = { sourceKind: 'sent_mail', anchor: A1, timeZone: IST };

function only(text: string, opts: CommitmentDetectOptions = sent): CommitmentCandidate {
  const all = detectCommitments(text, opts);
  expect(all, text).toHaveLength(1);
  const c = all[0];
  if (!c) throw new Error('unreachable');
  return c;
}

describe('M§18 example phrases (acceptance)', () => {
  it.each([
    ['Cuma gönderirim.', '2026-09-25', 'firm', false],
    ['Yarın ararım.', '2026-09-24', 'firm', false],
    ['Haftaya dönerim.', '2026-09-30', 'firm', true],
  ] as const)('%s → due %s', (text, date, certainty, confirm) => {
    const c = only(text);
    expect(c.direction).toBe('user_owes');
    expect(c.due?.localDate).toBe(date);
    expect(c.certainty).toBe(certainty);
    expect(c.needsConfirmation).toBe(confirm);
  });

  it('UT-COM-03: "Haftaya" is week precision and ambiguous → approval proposal', () => {
    const c = only('Haftaya dönerim.');
    expect(c.due).toMatchObject({ precision: 'week', ambiguous: true, dateOnly: true });
    expect(c.confidence).toBeLessThanOrEqual(0.7);
  });

  it('a firm, dated commitment may be created directly', () => {
    const c = only('Cuma gönderirim.');
    expect(c.confidence).toBeGreaterThanOrEqual(0.8);
    expect(c.due?.dueAt.toISOString()).toBe('2026-09-25T15:00:00.000Z'); // date-only → 18:00 local
  });
});

describe('certainty (UT-COM-04/05/09)', () => {
  it.each([
    'Belki Cuma gönderirim.',
    'Sanırım yarın bakarım.',
    'Yarın bakabilirim.',
    'Umarım yarın iletirim.',
  ])('%s → hedged, needs confirmation', (text) => {
    const c = only(text);
    expect(c.certainty).toBe('hedged');
    expect(c.needsConfirmation).toBe(true);
    expect(c.confidence).toBeLessThanOrEqual(0.65);
  });

  it('negation is detected and dropped', () => {
    const c = only('Cuma göndermeyeceğim.');
    expect(c.certainty).toBe('negated');
    expect(actionableCommitments([c])).toEqual([]);
    expect(only('Yarın aramam.').certainty).toBe('negated');
  });

  it('"İnşallah" is neutral', () => {
    const c = only('İnşallah yarın hallederim.');
    expect(c.certainty).toBe('firm');
    expect(c.due?.localDate).toBe('2026-09-24');
  });

  it('"Tamam" is not a negation', () => {
    expect(only('Tamam, yarın gönderirim.').certainty).toBe('firm');
  });
});

describe('triggers and gating', () => {
  it.each([
    ['Dosyayı yarın yollarım.', '2026-09-24'],
    ['Teklifi Perşembe iletirim.', '2026-09-24'],
    ['Raporu Cuma’ya kadar göndereceğim.', '2026-09-25'],
    ['Sözleşmeyi ay sonuna kadar hallederiz.', '2026-09-30'],
    ['Yarın 14:00’te ararım.', '2026-09-24'],
    ['Pazartesi toplantıda sunarım.', '2026-09-28'],
  ])('%s', (text, date) => {
    expect(only(text).due?.localDate).toBe(date);
  });

  it('UT-COM-08: post-meeting note with "Perşembe\'ye kadar … isteyeceğim"', () => {
    const c = only("Perşembe'ye kadar hukuktan yorum isteyeceğim.", {
      ...sent,
      sourceKind: 'user_note',
    });
    expect(c.direction).toBe('user_owes');
    expect(c.due).toMatchObject({ localDate: '2026-09-24', by: true });
  });

  it('keeps the datetime of a timed promise', () => {
    const c = only('Yarın 14:00’te ararım.');
    expect(c.due?.localTime).toBe('14:00');
    expect(c.due?.dateOnly).toBe(false);
  });

  it.each([
    'Bakarız.',
    'Teşekkür ederim, yarın görüşürüz.',
    'Rica ederim, Cuma görüşelim.',
    'İyi günler dilerim, yarın toplantıda.',
    'Merhaba, nasılsınız?',
    'Dün gönderdim.',
  ])('"%s" is not a commitment (UT-COM-06)', (text) => {
    expect(detectCommitments(text, sent)).toEqual([]);
  });

  it('without the date requirement a dateless promise is kept with no due', () => {
    const [c] = detectCommitments('Dosyayı göndereceğim.', { ...sent, requireDate: false });
    expect(c?.due).toBeNull();
    expect(c?.certainty).toBe('firm');
  });

  it('a date far from the verb does not attach', () => {
    const text = `Yarın ${'çok uzun bir açıklama metni '.repeat(4)}gönderirim.`;
    expect(detectCommitments(text, sent)).toEqual([]);
  });
});

describe('direction and quoting (UT-COM-07/10)', () => {
  it('a received mail promise is they_owe with the sender as counterparty', () => {
    const c = only('Cuma gönderirim.', {
      ...sent,
      sourceKind: 'received_mail',
      counterpartyName: 'Mehmet Yılmaz',
    });
    expect(c.direction).toBe('they_owe');
    expect(c.counterpartyName).toBe('Mehmet Yılmaz');
  });

  it('ignores quoted history', () => {
    const body = [
      'Teşekkürler, aldım.',
      '',
      '22 Eylül 2026 Salı 10:05 tarihinde Ahmet Yılmaz şunu yazdı:',
      'Yarın ararım.',
    ].join('\n');
    expect(detectCommitments(body, sent)).toEqual([]);
    expect(detectCommitments('> Yarın ararım.\nTamam.', sent)).toEqual([]);
    expect(stripQuotedHistory('a\n-----Original Message-----\nb')).toBe('a');
    expect(stripQuotedHistory('a\nOn Mon, Ahmet wrote:\nb')).toBe('a');
  });

  it('several sentences yield several candidates with original spans', () => {
    const text = 'Cuma gönderirim. Ayrıca yarın ararım.';
    const all = detectCommitments(text, sent);
    expect(all.map((c) => c.due?.localDate)).toEqual(['2026-09-25', '2026-09-24']);
    const second = all[1];
    expect(second && text.slice(second.span[0], second.span[1])).toBe('yarın ararım');
    expect(second?.quote).toBe('yarın ararım');
  });

  it('a decimal-looking time does not split a sentence', () => {
    expect(only('Saat 17.00’de ararım.').due?.localTime).toBe('17:00');
  });
});

describe('due resolution and dedupe', () => {
  it('ignores past dates as due dates', () => {
    expect(
      resolveCommitmentDue('Dün konuştuk, Cuma gönderirim', { anchor: A1, timeZone: IST, near: 20 })
        ?.localDate,
    ).toBe('2026-09-25');
    expect(resolveCommitmentDue('teşekkürler', { anchor: A1, timeZone: IST })).toBeNull();
  });

  it('UT-COM-12: the dedupe key is stable across re-analysis', () => {
    const c = only('Cuma gönderirim.');
    const key = (text: string): string =>
      commitmentDedupeKey({
        sourceType: 'email_message',
        sourceId: 'm-1',
        text,
        direction: c.direction,
        counterpartyName: 'Mehmet Yılmaz',
      });
    expect(key(c.text)).toBe(key('  CUMA gönderirim. '));
    expect(key(c.text)).not.toBe(key('Pazartesi gönderirim.'));
    expect(key(c.text)).toMatch(/^email_message:m-1:[0-9a-f]{64}$/);
  });
});
