import { assertEquals, assertThrows } from '@std/assert';
import { clip, copy, copyLocale, formatDue, formatTime, withCases } from './copy.ts';

Deno.test('copy: select branches, nested args and the none sentinel', () => {
  assertEquals(
    copy('tr', 'life.generated.shipment', { merchant: 'Trendyol', status: 'delivered' }),
    'Trendyol · Teslim edildi',
  );
  assertEquals(copy('tr', 'life.generated.flight', { flight: 'none', route: 'IST–ESB' }), 'Uçuş · IST–ESB');
  assertEquals(copy('tr', 'life.generated.flight', { flight: 'TK2124', route: 'none' }), 'TK2124 uçuşu');
  assertEquals(
    copy('tr', 'flow.generated.why.rule', { rule: '@acme.com', outcome: 'always_important' }),
    'Kuralın: “@acme.com” → Her zaman önemli say.',
  );
});

Deno.test('copy: plural with =0 and # in both locales', () => {
  assertEquals(
    copy('tr', 'briefing.generated.morning.template', { meetings: 2, replies: 0, deadlines: 1, waiting: 3 }),
    'Bugün 2 etkinliğin var, yanıt bekleyen mail yok. 1 son tarih yaklaşıyor; 3 konuda yanıt bekliyorsun.',
  );
  assertEquals(
    copy('en', 'briefing.generated.morning.template', { meetings: 1, replies: 2, deadlines: 0, waiting: 0 }),
    'Today you have 1 event, 2 emails are waiting for your reply. No deadline is coming up.',
  );
  assertEquals(copy('tr', 'today.hero.morningReady.title', { count: 4 }), 'Bugün bilmen gereken 4 şey var.');
});

Deno.test('copy: pre-inflected Turkish cases and helpers', () => {
  const cases = withCases({ time: '17:00' });
  assertEquals(cases.time, '17:00');
  assertEquals(typeof cases.time_loc, 'string');
  assertEquals(cases.time_loc?.startsWith('17:00'), true);
  assertEquals(copyLocale('en-US'), 'en');
  assertEquals(copyLocale(null), 'tr');
  assertEquals(clip('bir iki üç dört beş', 10), 'bir iki…');
  assertEquals(formatTime('2026-09-24T11:30:00Z', 'Europe/Istanbul'), '14:30');
  assertEquals(formatDue('tr', '2026-09-24T11:30:00Z', 'Europe/Istanbul', true), '24 Eylül');
  assertThrows(() => copy('tr', 'flow.generated.missing.key'));
});
