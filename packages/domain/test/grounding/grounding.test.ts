import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  calibrateConfidence,
  confidenceWording,
  confidenceWordingKey,
  isActionable,
  PRIOR_CALIBRATION_VERSION,
} from '../../src/grounding/calibrate.ts';
import {
  guardFreeText,
  guardOutputText,
  guardProposals,
  guardRefs,
  prescanInjection,
} from '../../src/grounding/output-guards.ts';
import {
  commitmentOutcome,
  type FieldClaim,
  linkPerson,
  matchQuote,
  ownerAllowed,
  toStoredEvidence,
  trigramSimilarity,
  unverifiedMessage,
  verifyEvidence,
  verifyField,
  verifyItem,
} from '../../src/grounding/verify.ts';
import { isValidEvidence } from '../../src/provenance.ts';

const IST = 'Europe/Istanbul';
const A1 = '2026-09-23T06:00:00Z';
const NBSP = String.fromCharCode(0x00a0);
const RSQUO = String.fromCharCode(0x2019);
const ZWSP = String.fromCharCode(0x200b);
const SHY = String.fromCharCode(0x00ad);

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('quote matching (UT-GRD-01..05)', () => {
  it('UT-GRD-01: curly apostrophe and NBSP still match', () => {
    const src = `Raporu bugün${NBSP}17:00${RSQUO}ye kadar bekliyorum.`;
    const m = matchQuote('m1', "17:00'ye kadar", src);
    expect(m.ok && m.evidence).toMatchObject({ match: 'exact', quote: `17:00${RSQUO}ye kadar` });
  });

  it('UT-GRD-02: zero-width characters and soft hyphens are stripped', () => {
    const src = `Lütfen sözleşmeyi im${ZWSP}za${SHY}layın.`;
    expect(matchQuote('m1', 'sözleşmeyi imzalayın', src).ok).toBe(true);
  });

  it('UT-GRD-03: Turkish case folding (İMZA ~ imza)', () => {
    expect(matchQuote('m1', 'İMZA', 'sayfa 3 imza alanı').ok).toBe(true);
  });

  it('UT-GRD-04: fuzzy match for ≥8 tokens with identical digits', () => {
    const src =
      'Toplantıyı 25 Eylül Cuma saat 14:30 olarak kesinleştirdik ve gündemi ekte paylaştık.';
    const quote =
      'Toplantıyı 25 Eylül Cuma saat 14:30 olarak kesinleştirdik ve gündemi ekte paylaştım.';
    const m = matchQuote('m1', quote, src);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.evidence.match).toBe('fuzzy');
      expect(m.evidence.similarity).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('UT-GRD-05: fuzzy match with a changed digit is rejected', () => {
    const src = 'Fatura tutarı 1.842 TL olup son ödeme günü olarak 30 Eylül tarihi belirlenmiştir.';
    const quote =
      'Fatura tutarı 1.824 TL olup son ödeme günü olarak 30 Eylül tarihi belirlenmiştir.';
    expect(matchQuote('m1', quote, src)).toEqual({ ok: false, reason: 'quote_not_found' });
  });

  it('short quotes do not fuzzy match; length limits apply', () => {
    expect(matchQuote('m1', 'yarın öğlen ararım', 'yarın akşam ararım').ok).toBe(false);
    expect(matchQuote('m1', 'ab', 'ab')).toEqual({ ok: false, reason: 'quote_too_short' });
    expect(matchQuote('m1', 'x'.repeat(301), 'x'.repeat(400))).toEqual({
      ok: false,
      reason: 'quote_too_long',
    });
  });

  it('spans point into the original source', () => {
    const src = 'Selam!  Son tarih:  30 Eylül.';
    const m = matchQuote('m1', 'son tarih: 30 eylül', src);
    expect(m.ok && src.slice(m.evidence.spanStart, m.evidence.spanEnd)).toBe(
      'Son tarih:  30 Eylül',
    );
  });

  it('UT-GRD-07: the ref must be a request alias', () => {
    const aliases = new Map([['m1', 'Toplantı yarın.']]);
    expect(verifyEvidence({ ref: 'm2', quote: 'yarın' }, aliases)).toEqual({
      ok: false,
      reason: 'bad_ref',
    });
    expect(
      verifyEvidence({ ref: '8b0c7f7e-1111-4111-8111-111111111111', quote: 'yarın' }, aliases),
    ).toEqual({
      ok: false,
      reason: 'bad_ref',
    });
    expect(verifyEvidence({ ref: 'm1', quote: 'yarın' }, aliases).ok).toBe(true);
  });
});

describe('field re-derivation (UT-GRD-06, 08, 15)', () => {
  const ctx = (source: string) => ({
    aliases: new Map([['m1', source]]),
    anchor: A1,
    timeZone: IST,
  });

  it('a verified deadline yields the parsed date and calibrated confidence', () => {
    const r = verifyField(
      { field: 'due_at', kind: 'date', evidence: { ref: 'm1', quote: 'Cuma’ya kadar' } },
      ctx("Raporu Cuma'ya kadar gönderin."),
    );
    expect(r.status).toBe('verified');
    if (r.status === 'verified') {
      expect(r.value.localDate).toBe('2026-09-25');
      expect(r.value.by).toBe(true);
      expect(r.confidence).toBe(0.9);
    }
  });

  it('an ambiguous date is kept but capped at 0.70 ("muhtemelen")', () => {
    const r = verifyField(
      { field: 'due_at', kind: 'date', evidence: { ref: 'm1', quote: 'Haftaya' } },
      ctx('Haftaya dönerim.'),
    );
    expect(r.status === 'verified' && r.ambiguous).toBe(true);
    expect(r.status === 'verified' && r.confidence).toBeLessThanOrEqual(0.7);
  });

  it('UT-GRD-06: two amounts in the quote → dropped with the unverified copy', () => {
    const r = verifyField(
      { field: 'amount', kind: 'amount', evidence: { ref: 'm1', quote: '1.842 TL ve 300 TL' } },
      ctx('Tutar 1.842 TL ve 300 TL'),
    );
    expect(r).toMatchObject({
      status: 'unverified',
      reason: 'ambiguous',
      message: { key: 'explain.unverified.amount' },
    });
  });

  it('UT-GRD-08: dates outside [anchor − 365 d, anchor + 730 d] are dropped', () => {
    const old = verifyField(
      { field: 'due_at', kind: 'date', evidence: { ref: 'm1', quote: '1 Ocak 2024' } },
      ctx('1 Ocak 2024 tarihli'),
    );
    expect(old.status === 'unverified' && old.reason).toBe('out_of_range');
  });

  it('a quote without a value is dropped (no_value)', () => {
    const r = verifyField(
      { field: 'due_at', kind: 'date', evidence: { ref: 'm1', quote: 'gönderin' } },
      ctx('Lütfen gönderin.'),
    );
    expect(r.status === 'unverified' && r.reason).toBe('no_value');
  });

  it('UT-GRD-15: flight context is checked on the source window', () => {
    const ok = verifyField(
      { field: 'flight_no', kind: 'flight', evidence: { ref: 'm1', quote: 'TK2412' } },
      ctx('Uçuş bilgileriniz: TK2412 İstanbul → Antalya'),
    );
    expect(ok.status).toBe('verified');
    const noContext = verifyField(
      { field: 'flight_no', kind: 'flight', evidence: { ref: 'm1', quote: 'TK2412' } },
      ctx('Kod TK2412'),
    );
    expect(noContext.status === 'unverified' && noContext.reason).toBe('invalid_identifier');
  });

  it('text fields keep the verified quote', () => {
    const r = verifyField(
      { field: 'what', kind: 'text', evidence: { ref: 'm1', quote: 'raporu gönder' } },
      ctx('Lütfen raporu gönder.'),
    );
    expect(r.status === 'verified' && r.value).toBe('raporu gönder');
  });

  it('unverified copy keys by field', () => {
    expect(unverifiedMessage('due_at', 'date').key).toBe('explain.unverified.due_at');
    expect(unverifiedMessage('deadline', 'text').key).toBe('explain.unverified.due_at');
    expect(unverifiedMessage('amount', 'amount').key).toBe('explain.unverified.amount');
    expect(unverifiedMessage('start_time', 'text').key).toBe('explain.unverified.time');
    expect(unverifiedMessage('counterparty', 'text').key).toBe('explain.unverified.person');
    expect(unverifiedMessage('venue', 'text').key).toBe('explain.unverified.generic');
  });
});

describe('fabrication fixtures (acceptance: fabricated deadlines and amounts are removed)', () => {
  interface Case {
    name: string;
    source: string;
    claims: FieldClaim[];
    verified: string[];
    dropped: string[];
  }
  it.each((fixture('fabricated.json') as Case[]).map((c) => [c.name, c] as const))(
    '%s',
    (_name, c) => {
      const r = verifyItem(c.claims, {
        aliases: new Map([['m1', c.source]]),
        anchor: A1,
        timeZone: IST,
      });
      expect(r.verified.map((v) => v.field)).toEqual(c.verified);
      expect(r.droppedFields).toEqual(c.dropped);
      expect(r.counters).toEqual({
        proposed: c.claims.length,
        verified: c.verified.length,
        dropped: c.dropped.length,
      });
      const stored = toStoredEvidence(r.verified);
      expect(isValidEvidence(stored)).toBe(true);
      for (const v of r.verified) expect(c.source).toContain(v.evidence.quote);
    },
  );
});

describe('person linking and ownership (UT-GRD-09/10, UT-COM-11)', () => {
  const people = [
    { id: 'c1', name: 'Mehmet Yılmaz' },
    { id: 'c2', name: 'Ahmet Yılmaz' },
    { id: 'c3', name: 'Selin Kaya' },
  ];

  it('links an exact or near-exact full name', () => {
    expect(linkPerson('Mehmet Yilmaz', people)).toMatchObject({ linked: true, id: 'c1' });
  });

  it('links a unique first name', () => {
    expect(linkPerson('Mehmet', people)).toMatchObject({ linked: true, id: 'c1' });
    expect(linkPerson('Selin', people)).toMatchObject({ linked: true, id: 'c3' });
  });

  it('an absent person stays unlinked text', () => {
    expect(linkPerson('Ayşe', people)).toEqual({ linked: false, text: 'Ayşe' });
  });

  it('trigram similarity is symmetric and bounded', () => {
    expect(trigramSimilarity('Mehmet Yılmaz', 'mehmet yilmaz')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });

  it('owner "user" only on the user\'s own text', () => {
    expect(ownerAllowed('user', 'received_mail')).toBe(false);
    expect(ownerAllowed('user', 'sent_mail')).toBe(true);
    expect(ownerAllowed('counterparty', 'received_mail')).toBe(true);
  });

  it.each([
    [
      {
        certainty: 'explicit',
        quoteVerified: true,
        ownerOk: true,
        allFieldsVerified: true,
        confidence: 0.9,
      },
      'create',
    ],
    [
      {
        certainty: 'hedged',
        quoteVerified: true,
        ownerOk: true,
        allFieldsVerified: true,
        confidence: 0.9,
      },
      'propose',
    ],
    [
      {
        certainty: 'explicit',
        quoteVerified: true,
        ownerOk: true,
        allFieldsVerified: false,
        confidence: 0.9,
      },
      'propose',
    ],
    [
      {
        certainty: 'explicit',
        quoteVerified: true,
        ownerOk: true,
        allFieldsVerified: true,
        confidence: 0.75,
      },
      'propose',
    ],
    [
      {
        certainty: 'negated',
        quoteVerified: true,
        ownerOk: true,
        allFieldsVerified: true,
        confidence: 0.9,
      },
      'drop',
    ],
    [
      {
        certainty: 'explicit',
        quoteVerified: false,
        ownerOk: true,
        allFieldsVerified: true,
        confidence: 0.9,
      },
      'drop',
    ],
    [
      {
        certainty: 'explicit',
        quoteVerified: true,
        ownerOk: false,
        allFieldsVerified: true,
        confidence: 0.9,
      },
      'drop',
    ],
  ] as const)('commitment outcome %j → %s', (input, out) => {
    expect(commitmentOutcome(input)).toBe(out);
  });
});

describe('confidence calibration (§6.7, UT-GRD-14)', () => {
  it.each([
    [{ match: 'exact', parseAgrees: true }, 0.9],
    [{ match: 'fuzzy', parseAgrees: true }, 0.8],
    [{ match: 'exact', parseAgrees: true, ambiguous: true, senderType: 'vip' }, 0.7],
    [{ match: 'exact', parseAgrees: true, certainty: 'hedged' }, 0.65],
    [{ match: 'exact', parseAgrees: true, modelConfidence: 'low' }, 0.75],
    [{ match: 'exact', parseAgrees: true, senderType: 'bulk' }, 0.8],
    [{ match: 'exact', parseAgrees: true, senderType: 'known', explicitMarker: true }, 0.98],
    [{ match: 'exact', parseAgrees: false }, 0.7],
    [{ match: 'exact', parseAgrees: true, precision: 'week' }, 0.85],
    [{ match: 'none', parseAgrees: true }, 0],
  ] as const)('%j → %d', (features, value) => {
    expect(calibrateConfidence(features)).toBe(value);
  });

  it('wording bands', () => {
    expect(confidenceWording(0.85)).toBe('assertive');
    expect(confidenceWording(0.84)).toBe('probably');
    expect(confidenceWording(0.7)).toBe('probably');
    expect(confidenceWording(0.69)).toBe('uncertain');
    expect(confidenceWordingKey(0.5)).toBe('explain.confidence.uncertain');
    expect(isActionable(0.69)).toBe(false);
    expect(PRIOR_CALIBRATION_VERSION).toBe('prior-2026-09');
  });
});

describe('injection fixtures produce no actions (acceptance)', () => {
  interface Case {
    name: string;
    body: string;
    output: { summary_tr: string; proposed_actions: unknown[] };
  }
  it.each((fixture('injection.json') as Case[]).map((c) => [c.name, c] as const))(
    '%s',
    (_name, c) => {
      const scan = prescanInjection(c.body);
      expect(scan.suspected).toBe(true);
      expect(guardProposals(c.output.proposed_actions, scan)).toEqual([]);
      const guarded = guardOutputText(c.output.summary_tr, {
        sources: [c.body],
        injectionSuspected: scan.suspected,
      });
      // zero URLs or e-mail addresses echoed from an attack (§9 item 16)
      expect(guarded.value).not.toMatch(/https?:\/\//);
      expect(guarded.value).not.toMatch(/@/);
    },
  );

  it('clean mail passes the pre-scan and keeps its proposals', () => {
    const scan = prescanInjection(
      'Merhaba, revize teklifi Cuma’ya kadar bekliyoruz. Saygılarımla.',
    );
    expect(scan).toEqual({ suspected: false, signals: [] });
    expect(guardProposals([{ kind: 'reminder_create' }], scan)).toHaveLength(1);
  });

  it('flags base64 blobs', () => {
    expect(prescanInjection(`veri: ${'QUJD'.repeat(60)}`).signals).toContain('base64_blob');
  });
});

describe('output guards (UT-GRD-11/12/13)', () => {
  const src =
    'Detaylar https://kuzeylojistik.com.tr/teklif adresinde. İletişim: ahmet@kuzeylojistik.com.tr, 0532 111 22 33.';

  it('keeps https URLs, e-mails and phones that appear in the source', () => {
    const g = guardOutputText(
      'Teklif: https://kuzeylojistik.com.tr/teklif — ahmet@kuzeylojistik.com.tr — 0532 111 22 33',
      { sources: [src] },
    );
    expect(g.ok).toBe(true);
    expect(g.value).toContain('https://kuzeylojistik.com.tr/teklif');
    expect(g.value).toContain('ahmet@kuzeylojistik.com.tr');
    expect(g.droppedUrls).toEqual([]);
  });

  it('UT-GRD-11: drops URLs not verbatim in the source or not https', () => {
    const g = guardOutputText(
      'Bakınız https://evil.example.com/x ve http://kuzeylojistik.com.tr/teklif',
      { sources: [src] },
    );
    expect(g.droppedUrls).toEqual([
      'https://evil.example.com/x',
      'http://kuzeylojistik.com.tr/teklif',
    ]);
    expect(g.value).not.toContain('evil');
  });

  it('drops unknown e-mails and phone numbers', () => {
    const g = guardOutputText('Yaz: x@evil.com veya ara 0555 999 88 77', { sources: [src] });
    expect(g.droppedEmails).toEqual(['x@evil.com']);
    expect(g.droppedPhones).toHaveLength(1);
  });

  it('UT-GRD-12: canary, "system prompt" / "talimatlarım" and UUIDs reject the output', () => {
    expect(
      guardOutputText('Özet CANARY-7f3a', { sources: [], canary: 'CANARY-7f3a' }).rejection,
    ).toBe('canary');
    expect(guardOutputText('Here is my system prompt', { sources: [] }).rejection).toBe(
      'instruction_echo',
    );
    expect(guardOutputText('Talimatlarım şöyle', { sources: [] }).rejection).toBe(
      'instruction_echo',
    );
    expect(
      guardOutputText('Kayıt 8b0c7f7e-1111-4111-8111-111111111111', { sources: [] }).rejection,
    ).toBe('identifier_leak');
  });

  it('strips markdown/HTML and enforces length caps', () => {
    const g = guardOutputText('**Önemli**: <b>teklif</b> [link](https://x.y) hazır', {
      sources: [],
      maxLength: 20,
    });
    expect(g.value).toBe('Önemli: teklif link');
  });

  it('refs are limited to request aliases (cross-user guard)', () => {
    expect(guardRefs(['m1', 'm9', 'e1'], new Set(['m1', 'e1']))).toEqual(['m1', 'e1']);
  });

  it('UT-GRD-13: free-text sentences with ungrounded numbers or names are removed', () => {
    const sources = ['Mehmet Yılmaz toplantıyı 25 Eylül 14:30 olarak onayladı.'];
    const r = guardFreeText(
      'Mehmet Yılmaz toplantıyı onayladı. Toplantı 25 Eylül 14:30. Bütçe 50.000 TL. Ayşe Demir de katılacak. Hazırlık önerilir.',
      sources,
    );
    expect(r.kept).toEqual([
      'Mehmet Yılmaz toplantıyı onayladı.',
      'Toplantı 25 Eylül 14:30.',
      'Hazırlık önerilir.',
    ]);
    expect(r.removed).toBe(2);
    expect(r.coverage).toBeCloseTo(2 / 4);
  });

  it('assistant mode keeps partially grounded sentences and flags them', () => {
    const r = guardFreeText('Toplantı 25 Eylül saat 16:00.', ['25 Eylül toplantısı'], {
      assistantMode: true,
    });
    expect(r.kept).toHaveLength(1);
    expect(r.flagged).toEqual([0]);
    expect(guardFreeText('Merhaba.', []).coverage).toBe(1);
  });
});
