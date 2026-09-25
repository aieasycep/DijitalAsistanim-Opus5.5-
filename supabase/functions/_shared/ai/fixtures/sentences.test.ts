/**
 * Regression: the fixture synthesiser split "1.842,00 TL" at the thousands separator and quoted
 * "842,00 TL" (the capture flow then showed the wrong amount). Sentences now keep domain-parsed
 * amounts and digit-dot-digit dates whole.
 */
import { assertEquals } from '@std/assert';
import { z } from 'zod';
import { wrapAll } from '../untrusted.ts';
import { generateFixture } from './generate.ts';
import { sentences } from './sentences.ts';

Deno.test('sentences keep TR amounts and numeric dates whole; quotes stay exact substrings', () => {
  const text = 'CK Enerji faturanız: 1.842,00 TL. Son ödeme 25.09.2026! Sorular?\nTeşekkürler';
  const out = sentences(text);
  assertEquals(
    out.map((s) => s.text),
    ['CK Enerji faturanız: 1.842,00 TL.', 'Son ödeme 25.09.2026!', 'Sorular?', 'Teşekkürler'],
  );
  for (const s of out) assertEquals(text.slice(s.start, s.start + s.text.length), s.text);
  assertEquals(sentences('  a.  '), []);
  assertEquals(sentences('Tutar ₺12.500 ödendi. Bitti...'), [
    { text: 'Tutar ₺12.500 ödendi.', start: 0 },
    { text: 'Bitti...', start: 22 },
  ]);
});

Deno.test('capture synthesiser quotes the full amount "1.842,00 TL"', () => {
  const docs = [
    {
      ref: 'c1',
      kind: 'capture_text' as const,
      text: 'CK Enerji elektrik faturası. Tutar: 1.842,00 TL. Son ödeme 30 Eylül.',
    },
  ];
  const out = generateFixture({
    feature: 'capture_extract',
    schema: z.unknown(),
    schemaName: 'CaptureExtractV1',
    prompt: { system: '', userContext: '', untrusted: wrapAll(docs).text, instruction: '' },
    userRef: null,
    correlationId: 'c',
  }) as { items: { kind: string; amount_quote?: string; evidence: { quote: string } }[] };
  const payment = out.items.find((i) => i.kind === 'payment');
  assertEquals(payment?.amount_quote, '1.842,00 TL');
  assertEquals(payment?.evidence.quote, 'Tutar: 1.842,00 TL.');
});
