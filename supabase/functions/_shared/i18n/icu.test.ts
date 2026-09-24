/** The server-side ICU subset and the catalog lookup used for push, approval and widget copy. */
import { assertEquals, assertThrows } from '@std/assert';
import trPush from '@da/i18n/messages/tr/push.json' with { type: 'json' };
import trApprovals from '@da/i18n/messages/tr/approvals.json' with { type: 'json' };
import trReminder from '@da/i18n/messages/tr/reminder.json' with { type: 'json' };
import trWidgets from '@da/i18n/messages/tr/widgets.json' with { type: 'json' };
import { withTrCases } from '@da/i18n/tr-suffix';
import { hasMessage, MissingMessageError, serverLocale, translate } from './catalog.ts';
import { formatIcu, IcuSyntaxError } from './icu.ts';

Deno.test('formatIcu: arguments, numbers, select and plural with # and =n', () => {
  assertEquals(formatIcu('Merhaba {name}', { name: 'Ayşe' }), 'Merhaba Ayşe');
  assertEquals(formatIcu('{n} kayıt', { n: 1500 }), '1.500 kayıt');
  assertEquals(formatIcu('{n} items', { n: 1500 }, 'en'), '1,500 items');
  const select = '{state, select, delivered {Teslim edildi} other {Yolda}}';
  assertEquals(formatIcu(select, { state: 'delivered' }), 'Teslim edildi');
  assertEquals(formatIcu(select, { state: 'x' }), 'Yolda');
  const plural = '{count, plural, =0 {No items} one {# item} other {# items}}';
  assertEquals(formatIcu(plural, { count: 0 }, 'en'), 'No items');
  assertEquals(formatIcu(plural, { count: 1 }, 'en'), '1 item');
  assertEquals(formatIcu(plural, { count: 3 }, 'en'), '3 items');
  assertEquals(
    formatIcu('{count, plural, offset:1 =0 {yok} other {# kişi daha}}', { count: 3 }),
    '2 kişi daha',
  );
  assertEquals(formatIcu('Eksik {x}.', {}), 'Eksik .');
});

Deno.test('formatIcu: apostrophes follow ICU rules (Turkish suffixes stay literal)', () => {
  assertEquals(formatIcu("Onay Bekleyenler'de"), "Onay Bekleyenler'de");
  assertEquals(formatIcu("Bugün {time}'ye kadar"), "Bugün 'ye kadar");
  assertEquals(formatIcu("Bugün {time}''ye kadar", { time: '17:00' }), "Bugün 17:00'ye kadar");
  assertEquals(formatIcu("'{literal}' {x}", { x: 'ok' }), '{literal} ok');
  assertThrows(() => formatIcu('{broken'), IcuSyntaxError);
  assertThrows(() => formatIcu('a } b'), IcuSyntaxError);
});

Deno.test(
  'translate: pre-inflected Turkish params (withTrCases), locale fallback, missing keys throw',
  () => {
    assertEquals(
      translate('tr', 'push.deadline.due_soon.full.body', withTrCases({ time: '17:00' })),
      "Bugün 17:00'de kapanıyor.",
    );
    assertEquals(serverLocale('en-GB'), 'en');
    assertEquals(serverLocale('de-DE'), 'tr');
    assertEquals(serverLocale(null), 'tr');
    assertThrows(() => translate('tr', 'push.nope.x'), MissingMessageError);
    assertEquals(hasMessage('approvals.failure.stale'), true);
  },
);

function leaves(tree: unknown, prefix: string, out: [string, string][] = []): [string, string][] {
  if (typeof tree === 'string') out.push([prefix, tree]);
  else if (typeof tree === 'object' && tree !== null) {
    for (const [k, v] of Object.entries(tree)) leaves(v, prefix === '' ? k : `${prefix}.${k}`, out);
  }
  return out;
}

Deno.test('every server-rendered catalog message parses in both locales', () => {
  const params = new Proxy({} as Record<string, string | number>, {
    get: (_t, key) =>
      typeof key === 'string' && /count|n$|days|minutes|hours/i.test(key) ? 2 : 'x',
  });
  const trees: [string, unknown][] = [
    ['push', trPush],
    ['approvals', trApprovals],
    ['reminder', trReminder],
    ['widgets', trWidgets],
  ];
  let checked = 0;
  for (const [ns, tree] of trees) {
    for (const [key] of leaves(tree, ns)) {
      for (const locale of ['tr', 'en'] as const) {
        translate(locale, key, params);
        checked++;
      }
    }
  }
  assertEquals(checked > 400, true);
});
