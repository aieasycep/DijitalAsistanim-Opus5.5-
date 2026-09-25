/**
 * Life intelligence (AI_PIPELINE_PLAN §13.7; T-5.04): schema.org JSON-LD / microdata, the Turkish
 * sender templates, the account-security templates (DKIM/SPF required, spoofed mail rejected —
 * SREQ-25), the grounded T1 `LifeIntelV1` mapping (IT-AI-03: unverifiable values are dropped) and
 * the `life_events` rows keyed by `lifeEventDedupeKey`. Sample mails use the demo canon and
 * `.example` style addresses only.
 */
import { assert, assertEquals } from '@std/assert';
import { lifeEventDedupeKey } from '@da/domain';
import type { LifeIntelEvent } from '@da/validation';
import { aliasMap, GroundingTally, type GroundingScope } from '../ai/grounding.ts';
import { candidateFromModel, detectLife, type LifeInput, lifeEventRow } from './classify.ts';
import {
  candidateFromNode,
  extractJsonLd,
  extractMicrodata,
  structuredCandidates,
} from './jsonld.ts';
import {
  detectSecurity,
  isTemplateSender,
  parseTemplate,
  templateFor,
  type TemplateInput,
} from './templates-tr.ts';
import { allowedTrackingUrl, findTrackingUrl, securitySenderFor } from './allowlists.ts';

const ANCHOR = new Date('2026-09-24T06:30:00.000Z'); // Perşembe 09:30 Europe/Istanbul
const TZ = 'Europe/Istanbul';
const S10 = 'RR123456785TR';

const ld = (value: unknown) =>
  `<html><body><script type="application/ld+json">${JSON.stringify(value)}</script></body></html>`;

function tpl(overrides: Partial<TemplateInput>): TemplateInput {
  return {
    fromEmail: 'bildirim@trendyol.com',
    subject: '',
    text: '',
    anchor: ANCHOR,
    timeZone: TZ,
    dkimPass: true,
    spfPass: null,
    ...overrides,
  };
}

// ── JSON-LD / microdata ──────────────────────────────────────────────────────

Deno.test(
  'life jsonld: a ParcelDelivery keeps its tracking number, ETA, merchant and allow-listed link',
  () => {
    const html = ld({
      '@context': 'https://schema.org',
      '@type': 'ParcelDelivery',
      trackingNumber: '1234567890',
      carrier: { '@type': 'Organization', name: 'Yurtiçi Kargo' },
      expectedArrivalUntil: '2026-09-26T18:00:00+03:00',
      deliveryStatus: 'https://schema.org/OrderInTransit',
      trackingUrl:
        'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=1234567890',
      partOfOrder: { '@type': 'Order', orderNumber: 'TY-99887766', merchant: { name: 'Trendyol' } },
    });
    const [c] = structuredCandidates(html);
    assertEquals(c?.type, 'shipment');
    assertEquals(c?.status, 'in_transit');
    assertEquals(c?.fields, {
      merchant: 'Trendyol',
      carrier: 'Yurtiçi Kargo',
      tracking_no: '1234567890',
      order_ref: 'TY-99887766',
    });
    assertEquals(c?.eventAt?.toISOString(), '2026-09-26T15:00:00.000Z');
    assertEquals(
      c?.trackingUrl,
      'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=1234567890',
    );
    assertEquals(
      c?.evidence.map((e) => e.field),
      ['tracking_no', 'eta'],
    );
    assert(
      c?.evidence.every((e) => html.includes(e.quote.slice(0, 10))),
      'evidence quotes the HTML source',
    );
    assertEquals(c?.origin, 'jsonld');
  },
);

Deno.test(
  'life jsonld: a PTT S10 number names the carrier; a foreign tracking link is dropped',
  () => {
    const c = candidateFromNode(
      {
        '@type': 'ParcelDelivery',
        trackingNumber: S10,
        trackingUrl: 'https://kargo-takip.example/x',
      },
      ld({ trackingNumber: S10, trackingUrl: 'https://kargo-takip.example/x' }),
    );
    assertEquals([c?.fields.carrier, c?.trackingUrl, c?.status], ['PTT Kargo', null, 'unknown']);
    assertEquals(
      candidateFromNode(
        { '@type': 'ParcelDelivery', trackingNumber: 'ZZ-NOT-IN-HTML' },
        '<p>boş</p>',
      ),
      null,
      'a value that does not occur in the source has no evidence',
    );
  },
);

Deno.test(
  'life jsonld: @graph flight reservation with a PNR, lodging/restaurant/event reservations',
  () => {
    const html = ld({
      '@graph': [
        {
          '@type': 'FlightReservation',
          reservationNumber: 'K7M4QX',
          reservationFor: {
            '@type': 'Flight',
            flightNumber: '2124',
            airline: { name: 'Turkish Airlines', iataCode: 'TK' },
            departureAirport: { iataCode: 'IST' },
            arrivalAirport: { iataCode: 'ESB' },
            departureTime: '2026-09-28T07:15:00+03:00',
            departureGate: 'B12',
          },
        },
        {
          '@type': ['Thing', 'LodgingReservation'],
          reservationFor: { '@type': 'Hotel', name: 'Kaya Otel Ankara' },
          checkinTime: '2026-09-28T14:00:00+03:00',
        },
        {
          '@type': 'FoodEstablishmentReservation',
          reservationFor: { name: 'Lokanta Kızılay' },
          startTime: '2026-09-28T20:00:00+03:00',
          partySize: 4,
        },
        {
          '@type': 'EventReservation',
          reservationFor: { name: 'Caz Gecesi', startDate: '2026-10-02' },
        },
        { '@type': 'Person', name: 'ignored' },
      ],
    });
    assertEquals(extractJsonLd(html).length, 4);
    const [flight, hotel, food, event] = structuredCandidates(html);
    assertEquals(flight?.fields, {
      airline: 'Turkish Airlines',
      flight_no: 'TK2124',
      from: 'IST',
      to: 'ESB',
      gate: 'B12',
      pnr: 'K7M4QX',
      checkin_status: 'unknown',
    });
    assertEquals(flight?.identity, ['TK2124', '2026-09-28']);
    assertEquals(
      [hotel?.fields.reservation_type, hotel?.fields.venue],
      ['hotel', 'Kaya Otel Ankara'],
    );
    assertEquals([food?.fields.reservation_type, food?.fields.party_size], ['restaurant', 4]);
    assertEquals(
      [event?.fields.reservation_type, event?.eventAt?.toISOString()],
      ['event', '2026-10-02T00:00:00.000Z'],
    );
  },
);

Deno.test(
  'life jsonld: an Invoice keeps the verified amount and due date; an Order keeps its number',
  () => {
    const html = ld([
      {
        '@type': 'Invoice',
        provider: { name: 'Enerjisa' },
        totalPaymentDue: { price: '1250.50', priceCurrency: 'try' },
        paymentDueDate: '2026-09-30',
        paymentStatus: 'https://schema.org/PaymentDue',
      },
      {
        '@type': 'Order',
        merchant: { name: 'Hepsiburada' },
        orderNumber: 'HB-44556677',
        orderStatus: 'OrderDelivered',
      },
      {
        '@type': 'Invoice',
        provider: { name: 'Turkcell' },
        paymentStatus: 'PaymentComplete',
        paymentDueDate: '2026-09-20',
        totalPaymentDue: { price: 'bedava', priceCurrency: 'TRY' },
      },
    ]);
    const [invoice, order, paid] = structuredCandidates(html);
    assertEquals(
      [invoice?.type, invoice?.status, invoice?.fields.payee],
      ['payment', 'due', 'Enerjisa'],
    );
    assertEquals([invoice?.amount?.minor, invoice?.amount?.currency], [125050, 'TRY']);
    assertEquals(invoice?.dueAt?.toISOString(), '2026-09-30T00:00:00.000Z');
    assertEquals(invoice?.droppedFields, []);
    assertEquals([order?.status, order?.fields.order_ref], ['delivered', 'HB-44556677']);
    assertEquals([paid?.status, paid?.amount, paid?.droppedFields], ['paid', null, ['amount']]);
  },
);

Deno.test('life jsonld: microdata, malformed blocks and duplicates', () => {
  const micro =
    '<div itemscope itemtype="https://schema.org/ParcelDelivery"><span itemprop="trackingNumber">1234567890</span>' +
    '<meta itemprop="expectedArrivalUntil" content="2026-09-26"></div>';
  assertEquals(extractMicrodata(micro)[0], {
    '@type': 'ParcelDelivery',
    trackingNumber: '1234567890',
    expectedArrivalUntil: '2026-09-26',
  });
  assertEquals(structuredCandidates(micro)[0]?.fields.tracking_no, '1234567890');
  assertEquals(extractMicrodata('<div itemtype="https://schema.org/Person"></div>'), []);
  const broken = '<script type="application/ld+json">{ not json </script>';
  assertEquals(extractJsonLd(broken), []);
  const node = { '@type': 'Order', merchant: 'Trendyol', orderNumber: 'TY-1234567' };
  assertEquals(structuredCandidates(ld([node, node])).length, 1, 'the same identity is kept once');
  assertEquals(structuredCandidates(null), []);
  assertEquals(structuredCandidates(''), []);
  assertEquals(candidateFromNode({ '@type': 'Order', merchant: 'Trendyol' }, ''), null);
  assertEquals(candidateFromNode({ '@type': 'FlightReservation', reservationFor: {} }, ''), null);
  assertEquals(
    candidateFromNode({ '@type': 'LodgingReservation', reservationFor: { name: 'X' } }, ''),
    null,
  );
  assertEquals(candidateFromNode({ '@type': 'Invoice' }, ''), null);
});

// ── Turkish sender templates ─────────────────────────────────────────────────

Deno.test('life templates: sender registry — domains, requires patterns, lookalikes', () => {
  assertEquals(
    templateFor({ fromEmail: 'kampanya@mail.trendyol.com', subject: '', text: '' })?.id,
    'trendyol',
  );
  assertEquals(
    templateFor({
      fromEmail: 'uyelik@amazon.com.tr',
      subject: 'Prime üyeliğiniz yenilendi',
      text: '',
    })?.id,
    'prime',
  );
  assertEquals(
    templateFor({
      fromEmail: 'siparis@amazon.com.tr',
      subject: 'Siparişiniz kargoya verildi',
      text: '',
    })?.id,
    'amazon_tr',
  );
  assertEquals(
    templateFor({ fromEmail: 'no-reply@google.com', subject: 'Google One aboneliğiniz', text: '' })
      ?.id,
    'google_one',
  );
  assertEquals(
    templateFor({ fromEmail: 'destek@trendyol-kampanya.example', subject: '', text: '' }),
    null,
  );
  assert(isTemplateSender('bilgi@yurticikargo.com'));
  assert(!isTemplateSender('mehmet@yilmazendustri.example'));
});

Deno.test('life templates: a Yurtiçi shipment with a tracking label and ETA', () => {
  const text =
    'Sayın Yunus Kaya,\nGönderiniz yola çıktı.\nKargo takip no: 7012345678\nTahmini teslim: 26 Eylül 2026\n' +
    'Takip: https://www.yurticikargo.com/gonderi-sorgula?code=7012345678';
  const { template, candidate } = parseTemplate(
    tpl({ fromEmail: 'bilgi@yurticikargo.com', subject: 'Gönderiniz yolda', text }),
  );
  assertEquals(template?.id, 'yurtici');
  assertEquals(candidate?.status, 'in_transit');
  assertEquals(candidate?.fields, {
    merchant: null,
    carrier: 'Yurtiçi Kargo',
    tracking_no: '7012345678',
    order_ref: null,
  });
  assertEquals(candidate?.identity, ['yurtici', '7012345678']);
  assertEquals(
    candidate?.trackingUrl,
    'https://www.yurticikargo.com/gonderi-sorgula?code=7012345678',
  );
  assertEquals(candidate?.confidence, 0.9);
  assert(candidate?.evidence.some((e) => e.field === 'eta'));
});

Deno.test('life templates: a merchant order without tracking is keyed by its order number', () => {
  const text = 'Siparişiniz alındı!\nSipariş no: TY20260924A\nToplam: 349,90 TL';
  const { candidate } = parseTemplate(tpl({ subject: 'Siparişiniz alındı', text }));
  assertEquals(
    [candidate?.status, candidate?.fields.merchant, candidate?.fields.order_ref],
    ['ordered', 'Trendyol', 'TY20260924A'],
  );
  assertEquals(candidate?.identity, ['Trendyol', 'TY20260924A']);
  assertEquals(candidate?.confidence, 0.75);
  // A status line alone is still evidence.
  const bare = parseTemplate(
    tpl({ subject: 'Teslim edildi', text: 'Paketiniz teslim edildi.' }),
  ).candidate;
  assertEquals([bare?.status, bare?.evidence[0]?.field], ['delivered', 'status']);
  // Nothing to key a shipment on.
  assertEquals(
    parseTemplate(tpl({ subject: 'Haftanın fırsatları', text: 'İndirimler başladı' })).candidate,
    null,
  );
  // An unauthenticated sender never matches (lookalike or relay).
  assertEquals(
    parseTemplate(tpl({ dkimPass: false, spfPass: false, subject: 'Siparişiniz alındı', text }))
      .candidate,
    null,
  );
});

Deno.test('life templates: a THY flight with PNR, gate and open check-in', () => {
  const text =
    'Online check-in açıldı.\nUçuş: TK 2124 İstanbul (IST) - Ankara (ESB)\nKalkış: 28 Eylül 2026 07:15\nPNR: K7M4QX\nKapı: B12';
  const { candidate } = parseTemplate(
    tpl({ fromEmail: 'noreply@thy.com', subject: 'Check-in zamanı', text }),
  );
  assertEquals(candidate?.type, 'flight');
  assertEquals(candidate?.status, 'checkin_open');
  assertEquals(
    [
      candidate?.fields.flight_no,
      candidate?.fields.pnr,
      candidate?.fields.gate,
      candidate?.fields.checkin_status,
    ],
    ['TK2124', 'K7M4QX', 'B12', 'open'],
  );
  assertEquals(candidate?.eventAt?.toISOString(), '2026-09-28T04:15:00.000Z');
  assertEquals(candidate?.identity, ['TK2124', '2026-09-28']);
  const noDate = parseTemplate(
    tpl({ fromEmail: 'noreply@flypgs.com', subject: 'Uçuşunuz', text: 'Uçuş PC 1234 onaylandı' }),
  ).candidate;
  assertEquals(
    [noDate?.fields.airline, noDate?.droppedFields, noDate?.confidence],
    ['Pegasus', ['depart_at'], 0.75],
  );
  assertEquals(
    parseTemplate(tpl({ fromEmail: 'noreply@thy.com', subject: 'Miles&Smiles', text: 'Kampanya' }))
      .candidate,
    null,
  );
});

Deno.test(
  'life templates: Booking.com reservation with party size and a confirm-by deadline',
  () => {
    const text =
      'Rezervasyonunuz onaylandı.\nGiriş: 3 Ekim 2026\n2 yetişkin\nİptal için son tarih: 1 Ekim 2026';
    const { candidate } = parseTemplate(
      tpl({ fromEmail: 'noreply@booking.com', subject: 'Rezervasyon onayı', text }),
    );
    assertEquals(candidate?.type, 'reservation');
    assertEquals(
      [candidate?.fields.venue, candidate?.fields.reservation_type, candidate?.fields.party_size],
      ['Booking.com', 'hotel', 2],
    );
    assert(candidate?.eventAt !== null);
    assert(candidate?.dueAt !== null, 'the cancellation deadline becomes due_at');
    const obilet = parseTemplate(
      tpl({
        fromEmail: 'bilet@obilet.com',
        subject: 'Biletiniz',
        text: 'Sefer: 5 Ekim 2026 09:00',
      }),
    ).candidate;
    assertEquals(obilet?.fields.reservation_type, 'transport');
    assertEquals(
      parseTemplate(tpl({ fromEmail: 'bilet@obilet.com', subject: 'Kampanya', text: 'İndirim' }))
        .candidate,
      null,
    );
    assertEquals(
      parseTemplate(
        tpl({ fromEmail: 'bilet@biletix.com', subject: 'Biletiniz', text: 'Tarih yok' }),
      ).candidate,
      null,
    );
  },
);

Deno.test('life templates: an Enerjisa bill keeps the amount and due date; statuses', () => {
  const text =
    'Eylül 2026 faturanız oluştu.\nFatura tutarı: 1.250,50 TL\nSon ödeme tarihi: 30 Eylül 2026';
  const { candidate } = parseTemplate(
    tpl({ fromEmail: 'efatura@enerjisa.com.tr', subject: 'Faturanız hazır', text }),
  );
  assertEquals(
    [candidate?.type, candidate?.status, candidate?.fields.payee],
    ['payment', 'due', 'Enerjisa'],
  );
  assertEquals([candidate?.amount?.minor, candidate?.amount?.currency], [125050, 'TRY']);
  assertEquals(candidate?.identity, ['Enerjisa', '2026-09-30', 125050]);
  assertEquals(candidate?.confidence, 0.9);
  const paid = parseTemplate(
    tpl({
      fromEmail: 'bilgi@turkcell.com.tr',
      subject: 'Ödemeniz alındı',
      text: 'Fatura tutarı 299,00 TL ödendi.',
    }),
  ).candidate;
  assertEquals([paid?.status, paid?.droppedFields], ['paid', ['due_at']]);
  const failed = parseTemplate(
    tpl({
      fromEmail: 'bilgi@garantibbva.com.tr',
      subject: 'Ödeme gerçekleştirilemedi',
      text: 'Kart ekstre ödemesi: 2.000 TL',
    }),
  ).candidate;
  assertEquals(failed?.status, 'failed');
  const refund = parseTemplate(
    tpl({ fromEmail: 'bilgi@vodafone.com.tr', subject: 'İade', text: 'Fatura iade tutarı 50 TL' }),
  ).candidate;
  assertEquals(refund?.status, 'refund');
  assertEquals(
    parseTemplate(
      tpl({ fromEmail: 'bilgi@isbank.com.tr', subject: 'Fatura', text: 'Detaylar ektedir' }),
    ).candidate,
    null,
  );
  assertEquals(
    parseTemplate(tpl({ fromEmail: 'bilgi@isbank.com.tr', subject: 'Kampanya', text: 'Faiz' }))
      .candidate,
    null,
  );
});

Deno.test(
  'life templates: subscriptions — renewal, trial ending, cancellation, price change',
  () => {
    const renew = parseTemplate(
      tpl({
        fromEmail: 'info@netflix.com',
        subject: 'Üyeliğiniz yenilenecek',
        text: 'Aylık planınız 5 Ekim 2026 tarihinde yenilenecek. Tutar: 229,99 TL',
      }),
    ).candidate;
    assertEquals(
      [renew?.type, renew?.status, renew?.fields.period],
      ['subscription', 'renewal_upcoming', 'monthly'],
    );
    assertEquals(renew?.amount?.minor, 22999);
    const trial = parseTemplate(
      tpl({
        fromEmail: 'no-reply@spotify.com',
        subject: 'Ücretsiz deneme süreniz bitiyor',
        text: 'Yıllık plan',
      }),
    ).candidate;
    assertEquals(
      [trial?.status, trial?.fields.period, trial?.droppedFields],
      ['trial_ending', 'yearly', ['renews_at', 'amount']],
    );
    assertEquals(trial?.evidence[0]?.field, 'event');
    const cancelled = parseTemplate(
      tpl({
        fromEmail: 'hello@disneyplus.com',
        subject: 'Aboneliğiniz sona erdi',
        text: 'Görüşmek üzere',
      }),
    ).candidate;
    assertEquals(cancelled?.status, 'cancelled');
    const price = parseTemplate(
      tpl({ fromEmail: 'info@netflix.com', subject: 'Yeni fiyat', text: 'Fiyat güncellemesi' }),
    ).candidate;
    assertEquals(price?.status, 'price_change');
    assertEquals(
      parseTemplate(
        tpl({ fromEmail: 'info@netflix.com', subject: 'Yeni diziler', text: 'Bu hafta' }),
      ).candidate,
      null,
    );
  },
);

Deno.test(
  'life security (SREQ-25): a verified Google sign-in alert; a spoofed one is rejected',
  () => {
    const text = 'Hesabınızda yeni oturum açıldı.\nCihaz: Windows\n24 Eylül 2026 09:12';
    const ok = detectSecurity(
      tpl({ fromEmail: 'no-reply@accounts.google.com', subject: 'Güvenlik uyarısı', text }),
    );
    assertEquals(ok.kind, 'event');
    if (ok.kind === 'event') {
      assertEquals([ok.candidate.status, ok.candidate.fields.provider], ['new_sign_in', 'google']);
      assertEquals(
        ok.candidate.ctaUrl,
        'https://myaccount.google.com/security',
        'the CTA is the known provider page',
      );
      assertEquals(ok.candidate.eventAt?.toISOString(), '2026-09-24T06:12:00.000Z');
    }
    const spoofed = detectSecurity(
      tpl({
        fromEmail: 'no-reply@accounts.google.com',
        subject: 'Güvenlik uyarısı',
        text,
        dkimPass: false,
        spfPass: false,
      }),
    );
    assertEquals(spoofed.kind, 'rejected');
    assertEquals(
      detectSecurity(
        tpl({ fromEmail: 'guvenlik@g00gle-destek.example', subject: 'Güvenlik uyarısı', text }),
      ).kind,
      'none',
    );
    assertEquals(
      detectSecurity(
        tpl({
          fromEmail: 'no-reply@accounts.google.com',
          subject: 'Haftalık özet',
          text: 'Fotoğraflar',
        }),
      ).kind,
      'none',
    );
    const pwd = detectSecurity(
      tpl({
        fromEmail: 'account-security-noreply@accountprotection.microsoft.com',
        subject: 'Şifreniz değiştirildi',
        text: 'Hesap parolanız değiştirildi.',
      }),
    );
    assertEquals(
      pwd.kind === 'event' ? [pwd.candidate.status, pwd.candidate.eventAt?.toISOString()] : null,
      ['password_changed', ANCHOR.toISOString()],
    );
    const recovery = detectSecurity(
      tpl({
        fromEmail: 'noreply@id.apple.com',
        subject: 'Kurtarma e-postası güncellendi',
        text: '',
      }),
    );
    assertEquals(recovery.kind === 'event' ? recovery.candidate.status : null, 'recovery_changed');
    const suspicious = detectSecurity(
      tpl({
        fromEmail: 'security@facebookmail.com',
        subject: 'Şüpheli giriş denemesi engellendi',
        text: '',
      }),
    );
    assertEquals(
      suspicious.kind === 'event' ? suspicious.candidate.status : null,
      'suspicious_activity',
    );
    assertEquals(securitySenderFor('x@mail.instagram.com')?.provider, 'meta');
  },
);

Deno.test(
  'life allow-lists: tracking links need https, a verbatim occurrence and a known host',
  () => {
    const src =
      'Takip: https://www.araskargo.com.tr/takip?code=123456789012. Diğer: https://kotu.example/t';
    assertEquals(
      allowedTrackingUrl('https://www.araskargo.com.tr/takip?code=123456789012.', src),
      'https://www.araskargo.com.tr/takip?code=123456789012',
    );
    assertEquals(
      allowedTrackingUrl('http://www.araskargo.com.tr/takip', 'http://www.araskargo.com.tr/takip'),
      null,
    );
    assertEquals(allowedTrackingUrl('https://www.araskargo.com.tr/other', src), null);
    assertEquals(allowedTrackingUrl('https://kotu.example/t', src), null);
    assertEquals(allowedTrackingUrl(null, src), null);
    assertEquals(findTrackingUrl(src), 'https://www.araskargo.com.tr/takip?code=123456789012');
    assertEquals(findTrackingUrl('https://kotu.example/t'), null);
  },
);

// ── Pipeline order and rows ──────────────────────────────────────────────────

function life(overrides: Partial<LifeInput>): LifeInput {
  return {
    fromEmail: 'bildirim@trendyol.com',
    subject: '',
    text: '',
    html: null,
    anchor: ANCHOR,
    timeZone: TZ,
    dkimPass: true,
    spfPass: true,
    ...overrides,
  };
}

Deno.test('life detect: security first, then structured markup, then templates', () => {
  const security = detectLife(
    life({
      fromEmail: 'no-reply@accounts.google.com',
      subject: 'Güvenlik uyarısı',
      text: 'Yeni oturum açıldı',
    }),
  );
  assertEquals(
    [security.security, security.matched, security.candidates[0]?.type],
    ['verified', true, 'security'],
  );
  const rejected = detectLife(
    life({
      fromEmail: 'no-reply@accounts.google.com',
      subject: 'Güvenlik uyarısı',
      text: 'Yeni oturum',
      dkimPass: false,
      spfPass: false,
    }),
  );
  assertEquals(
    [rejected.security, rejected.candidates.length, rejected.transactional],
    ['rejected', 0, false],
  );

  const html = ld({ '@type': 'Order', merchant: 'Trendyol', orderNumber: 'TY-1234567' });
  const structured = detectLife(
    life({ html, subject: 'Siparişiniz alındı', text: 'Siparişiniz alındı' }),
  );
  assertEquals([structured.candidates[0]?.origin, structured.transactional], ['jsonld', true]);
  const unsignedMarkup = detectLife(
    life({ html, dkimPass: false, spfPass: false, fromEmail: 'x@shop.example' }),
  );
  assertEquals(
    [unsignedMarkup.matched, unsignedMarkup.candidates.length],
    [false, 0],
    'markup of an unauthenticated sender is ignored',
  );

  const template = detectLife(
    life({ subject: 'Siparişiniz alındı', text: 'Sipariş no: TY20260924A' }),
  );
  assertEquals(
    [template.candidates[0]?.origin, template.matched, template.transactional],
    ['template', true, true],
  );
  const nothing = detectLife(
    life({
      fromEmail: 'mehmet@yilmazendustri.example',
      subject: 'Teklif',
      text: 'Revize teklif ektedir',
    }),
  );
  assertEquals([nothing.matched, nothing.transactional], [false, false]);
});

Deno.test(
  'life rows: a candidate becomes a life_events insert with provenance and a stable dedupe key',
  () => {
    const text = 'Fatura tutarı: 1.250,50 TL\nSon ödeme tarihi: 30 Eylül 2026';
    const c = parseTemplate(
      tpl({ fromEmail: 'efatura@enerjisa.com.tr', subject: 'Faturanız', text }),
    ).candidate!;
    const row = lifeEventRow(c, {
      userId: 'u1',
      messageId: 'm1',
      provider: 'google',
      receivedAt: '2026-09-24T06:00:00.000Z',
      text,
      locale: 'tr',
    });
    assertEquals(
      [row.type, row.amount, row.currency, row.source_type, row.source_id],
      ['payment', '1250.50', 'TRY', 'email_message', 'm1'],
    );
    assertEquals(row.dedupe_key, lifeEventDedupeKey('payment', ['Enerjisa', '2026-09-30', 125050]));
    assertEquals(row.amount_evidence?.length, 1);
    assertEquals(row.payload.status, 'due');
    assert(row.title.length > 0 && !row.title.includes('{'), 'the title is rendered copy');

    const sec = detectSecurity(
      tpl({
        fromEmail: 'no-reply@accounts.google.com',
        subject: 'Güvenlik uyarısı',
        text: 'Yeni oturum açıldı',
      }),
    );
    assert(sec.kind === 'event');
    const secRow = lifeEventRow(sec.candidate, {
      userId: 'u1',
      messageId: 's1',
      provider: 'google',
      receivedAt: ANCHOR.toISOString(),
      text: '',
      locale: 'en',
      sourceType: 'android_notification',
    });
    assertEquals(
      [secRow.payload.cta_url, secRow.amount, secRow.source_type],
      ['https://myaccount.google.com/security', null, 'android_notification'],
    );

    // A tracking URL that is not in the stored source text is not persisted.
    const ship = structuredCandidates(
      ld({
        '@type': 'ParcelDelivery',
        trackingNumber: '1234567890',
        trackingUrl: 'https://www.yurticikargo.com/t?code=1234567890',
      }),
    )[0]!;
    assertEquals(ship.trackingUrl, 'https://www.yurticikargo.com/t?code=1234567890');
    const shipRow = lifeEventRow(ship, {
      userId: 'u1',
      messageId: 'm2',
      provider: 'microsoft',
      receivedAt: ANCHOR.toISOString(),
      text: 'metin',
      locale: 'tr',
    });
    assertEquals(shipRow.tracking_url, null);
    for (const [cand, needle] of [
      [
        structuredCandidates(
          ld({
            '@type': 'FlightReservation',
            reservationFor: {
              flightNumber: 'TK2124',
              departureTime: '2026-09-28T07:15:00+03:00',
              departureAirport: { iataCode: 'IST' },
              arrivalAirport: { iataCode: 'ESB' },
            },
          }),
        )[0]!,
        'TK2124',
      ],
      [
        structuredCandidates(
          ld({
            '@type': 'LodgingReservation',
            reservationFor: { name: 'Kaya Otel' },
            checkinDate: '2026-10-03',
          }),
        )[0]!,
        'Kaya Otel',
      ],
      [
        parseTemplate(
          tpl({
            fromEmail: 'info@netflix.com',
            subject: 'Yenilendi',
            text: 'Üyeliğiniz yenilendi. Tutar: 229,99 TL',
          }),
        ).candidate!,
        'Netflix',
      ],
    ] as const) {
      const r = lifeEventRow(cand, {
        userId: 'u1',
        messageId: 'm',
        provider: 'google',
        receivedAt: ANCHOR.toISOString(),
        text: '',
        locale: 'tr',
      });
      assert(r.title.includes(needle), `${r.type}: ${r.title}`);
    }
  },
);

// ── T1 LifeIntelV1 mapping ───────────────────────────────────────────────────

function scope(text: string): GroundingScope {
  return {
    aliases: aliasMap([['m1', text]]),
    anchor: ANCHOR,
    timeZone: TZ,
    senderDomain: 'magaza.example',
  };
}
const ev = (quote: string) => ({ ref: 'm1', quote });

Deno.test(
  'life model (IT-AI-03): grounded shipment/flight fields kept, unverifiable ones dropped',
  () => {
    const text =
      'Siparişiniz Aras Kargo ile yola çıktı. Takip no RR123456785TR. Tahmini teslim 26 Eylül 2026.';
    const tally = new GroundingTally();
    const shipment = candidateFromModel(
      {
        kind: 'shipment',
        merchant_quote: 'Siparişiniz',
        carrier_quote: 'Aras Kargo',
        tracking_quote: 'RR123456785TR',
        status: 'in_transit',
        eta_quote: '26 Eylül 2026',
        item_count_quote: null,
        evidence: ev('yola çıktı'),
      } as LifeIntelEvent,
      'm1',
      scope(text),
      tally,
    );
    assertEquals(
      [shipment?.origin, shipment?.status, shipment?.fields.tracking_no, shipment?.fields.carrier],
      ['llm', 'in_transit', S10, 'PTT Kargo'],
    );
    assertEquals(shipment?.identity, ['ptt', S10]);
    assert(shipment?.eventAt !== null);

    const invented = candidateFromModel(
      {
        kind: 'shipment',
        merchant_quote: null,
        carrier_quote: 'Aras Kargo',
        tracking_quote: 'ZZ999',
        status: 'shipped',
        eta_quote: '31 Aralık',
        item_count_quote: null,
        evidence: ev('yola çıktı'),
      } as LifeIntelEvent,
      'm1',
      scope(text),
      tally,
    );
    assertEquals(invented?.fields.tracking_no, null);
    assertEquals(invented?.droppedFields, ['tracking_no', 'eta']);
    assertEquals([invented?.fields.carrier, invented?.confidence], ['Aras Kargo', 0.7]);
    assert(tally.dropped >= 2);

    assertEquals(
      candidateFromModel(
        {
          kind: 'shipment',
          merchant_quote: null,
          carrier_quote: null,
          tracking_quote: null,
          status: 'unknown',
          eta_quote: null,
          item_count_quote: null,
          evidence: ev('uydurma alıntı'),
        } as LifeIntelEvent,
        'm1',
        scope(text),
        tally,
      ),
      null,
      'an event whose own evidence is not in the source is dropped',
    );

    const ftext =
      'Uçuşunuz TK 2124 IST ESB, kalkış 28 Eylül 2026 07:15, PNR K7M4QX, kapı B12. Check-in açık.';
    const flight = candidateFromModel(
      {
        kind: 'flight',
        flight_no_quote: 'TK 2124',
        from_quote: 'IST',
        to_quote: 'ESB',
        depart_quote: '28 Eylül 2026 07:15',
        arrive_quote: null,
        gate_quote: 'kapı B12',
        pnr_quote: 'PNR K7M4QX',
        checkin_status: 'open',
        evidence: ev('Check-in açık'),
      } as LifeIntelEvent,
      'm1',
      scope(ftext),
      tally,
    );
    assertEquals(
      [flight?.status, flight?.fields.flight_no, flight?.fields.pnr, flight?.fields.from],
      ['checkin_open', 'TK2124', 'K7M4QX', 'IST'],
    );
    assertEquals(flight?.identity, ['TK2124', '2026-09-28']);
    const badPnr = candidateFromModel(
      {
        kind: 'flight',
        flight_no_quote: 'TK 2124',
        from_quote: null,
        to_quote: null,
        depart_quote: null,
        arrive_quote: null,
        gate_quote: null,
        pnr_quote: 'XX',
        checkin_status: 'unknown',
        evidence: ev('Uçuşunuz'),
      } as LifeIntelEvent,
      'm1',
      scope(ftext),
      tally,
    );
    assertEquals([badPnr?.status, badPnr?.droppedFields], ['confirmed', ['pnr']]);
    assertEquals(
      candidateFromModel(
        {
          kind: 'flight',
          flight_no_quote: 'kalkış',
          from_quote: null,
          to_quote: null,
          depart_quote: null,
          arrive_quote: null,
          gate_quote: null,
          pnr_quote: null,
          checkin_status: 'unknown',
          evidence: ev('Uçuşunuz'),
        } as LifeIntelEvent,
        'm1',
        scope(ftext),
        tally,
      ),
      null,
      'a flight needs a verified flight number',
    );
  },
);

Deno.test(
  'life model: reservation, payment and subscription fields ground against the source',
  () => {
    const tally = new GroundingTally();
    const rtext =
      'Lokanta Kızılay rezervasyonunuz 28 Eylül 2026 20:00 için 4 kişi olarak alındı. Onay için son 27 Eylül 2026.';
    const res = candidateFromModel(
      {
        kind: 'reservation',
        reservation_type: 'restaurant',
        venue_quote: 'Lokanta Kızılay',
        at_quote: '28 Eylül 2026 20:00',
        party_size_quote: '4 kişi',
        confirm_deadline_quote: '27 Eylül 2026',
        address_quote: null,
        evidence: ev('rezervasyonunuz'),
      } as LifeIntelEvent,
      'm1',
      scope(rtext),
      tally,
    );
    assertEquals(
      [res?.fields.venue, res?.fields.party_size, res?.eventAt?.toISOString()],
      ['Lokanta Kızılay', 4, '2026-09-28T17:00:00.000Z'],
    );
    assert(res?.dueAt !== null);
    assertEquals(
      candidateFromModel(
        {
          kind: 'reservation',
          reservation_type: 'event',
          venue_quote: 'Uydurma Salon',
          at_quote: null,
          party_size_quote: null,
          confirm_deadline_quote: null,
          address_quote: null,
          evidence: ev('rezervasyonunuz'),
        } as LifeIntelEvent,
        'm1',
        scope(rtext),
        tally,
      ),
      null,
    );

    const ptext = 'İGDAŞ doğalgaz faturanız: 845,20 TL. Son ödeme 5 Ekim 2026.';
    const pay = candidateFromModel(
      {
        kind: 'payment',
        payee_quote: 'İGDAŞ',
        amount_quote: '845,20 TL',
        due_quote: '5 Ekim 2026',
        status: 'due',
        evidence: ev('faturanız'),
      } as LifeIntelEvent,
      'm1',
      scope(ptext),
      tally,
    );
    assertEquals(
      [pay?.amount?.minor, pay?.amount?.currency, pay?.fields.payee],
      [84520, 'TRY', 'İGDAŞ'],
    );
    assertEquals(pay?.identity[0], 'İGDAŞ');
    const wrongAmount = candidateFromModel(
      {
        kind: 'payment',
        payee_quote: 'İGDAŞ',
        amount_quote: '999 TL',
        due_quote: null,
        status: 'due',
        evidence: ev('faturanız'),
      } as LifeIntelEvent,
      'm1',
      scope(ptext),
      tally,
    );
    assertEquals(
      [wrongAmount?.amount, wrongAmount?.droppedFields, wrongAmount?.identity[2]],
      [null, ['amount'], 'na'],
    );
    assertEquals(
      candidateFromModel(
        {
          kind: 'payment',
          payee_quote: 'Başka Kurum',
          amount_quote: null,
          due_quote: null,
          status: 'due',
          evidence: ev('faturanız'),
        } as LifeIntelEvent,
        'm1',
        scope(ptext),
        tally,
      ),
      null,
    );

    const stext = 'Spotify Premium aboneliğin 12 Ekim 2026 tarihinde 59,99 TL ile yenilenecek.';
    const sub = candidateFromModel(
      {
        kind: 'subscription',
        service_quote: 'Spotify Premium',
        amount_quote: '59,99 TL',
        period: 'monthly',
        event: 'renewal_upcoming',
        renews_quote: '12 Ekim 2026',
        evidence: ev('yenilenecek'),
      } as LifeIntelEvent,
      'm1',
      scope(stext),
      tally,
    );
    assertEquals(
      [sub?.status, sub?.amount?.minor, sub?.fields.service, sub?.fields.period],
      ['renewal_upcoming', 5999, 'Spotify Premium', 'monthly'],
    );
    assertEquals(sub?.identity, ['Spotify Premium', '2026-10-12']);
    const subNoAmount = candidateFromModel(
      {
        kind: 'subscription',
        service_quote: 'Spotify Premium',
        amount_quote: '1 TL',
        period: 'unknown',
        event: 'renewed',
        renews_quote: null,
        evidence: ev('yenilenecek'),
      } as LifeIntelEvent,
      'm1',
      scope(stext),
      tally,
    );
    assertEquals([subNoAmount?.amount, subNoAmount?.droppedFields], [null, ['amount']]);
    assertEquals(
      candidateFromModel(
        {
          kind: 'subscription',
          service_quote: 'Netflix',
          amount_quote: null,
          period: 'unknown',
          event: 'renewed',
          renews_quote: null,
          evidence: ev('yenilenecek'),
        } as LifeIntelEvent,
        'm1',
        scope(stext),
        tally,
      ),
      null,
    );
  },
);
