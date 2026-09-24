import { describe, expect, it } from 'vitest';
import { findAirports, findFlightNumbers, isKnownAirline } from '../../src/extract/flight.ts';
import { findPnrs, findTicketNumbers, isPlausiblePnr } from '../../src/extract/pnr.ts';
import { detectCarrier, findTrackingNumbers, isValidS10 } from '../../src/extract/tracking.ts';

describe('tracking numbers (AI_PIPELINE_PLAN §6.9.4)', () => {
  it.each([
    ['RR123456785TR', true],
    ['RR123456784TR', false],
    ['CP000000000TR', false],
    ['RB987654321TR', false],
    ['EE000000005TR', true],
    ['rr123456785tr', false],
  ])('S10 check digit %s → %s', (code, ok) => {
    expect(isValidS10(code)).toBe(ok);
  });

  it('finds a PTT S10 code and names the carrier', () => {
    const [t] = findTrackingNumbers('Gönderiniz RR123456785TR numarası ile yola çıktı.');
    expect(t).toMatchObject({ value: 'RR123456785TR', kind: 's10', carrier: 'ptt' });
  });

  it('rejects an S10 code with a wrong check digit', () => {
    expect(findTrackingNumbers('Kod: RR123456784TR')).toEqual([]);
  });

  it('accepts a Yurtiçi domestic number with a label and sender domain', () => {
    const [t] = findTrackingNumbers('Kargo takip no: 7301234567', {
      senderDomain: 'bildirim.yurticikargo.com',
    });
    expect(t).toMatchObject({ value: '7301234567', kind: 'domestic', carrier: 'yurtici' });
  });

  it.each([
    ['Aras Kargo ile gönderildi. Takip numarası: 4052118877', 'aras'],
    ['MNG Kargo gönderi kodu: 99887766554', 'mng'],
    ['HepsiJet barkod no: HJ12345678', 'hepsijet'],
    ['Trendyol Express kargo takip kodu: TEX10020030', 'trendyol_express'],
    ['Sendeo takip no: 5500112233', 'sendeo'],
    ['Sürat Kargo gönderi no: 123456789012', 'surat'],
    ['Kolay Gelsin takip kodu: KG-2026-778899', 'kolay_gelsin'],
  ])('domestic carrier from text: %s', (text, carrier) => {
    const [t] = findTrackingNumbers(text);
    expect(t?.carrier).toBe(carrier);
    expect(t?.kind).toBe('domestic');
  });

  it('rejects a bare number without label or carrier', () => {
    expect(findTrackingNumbers('7301234567')).toEqual([]);
    expect(findTrackingNumbers('Kargo takip no: 7301234567')).toEqual([]);
  });

  it('UPS by format; DHL and FedEx only with carrier context', () => {
    expect(findTrackingNumbers('1Z999AA10123456784')[0]?.kind).toBe('ups');
    expect(findTrackingNumbers('DHL Express waybill 1234567890')[0]?.kind).toBe('dhl');
    expect(findTrackingNumbers('Waybill 1234567890')).toEqual([]);
    expect(findTrackingNumbers('FedEx tracking 123456789012')[0]?.kind).toBe('fedex');
  });

  it('reads carrier link parameters without fetching', () => {
    const [t] = findTrackingNumbers(
      'Takip: https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=7301234567',
    );
    expect(t).toMatchObject({ value: '7301234567', kind: 'link_param', carrier: 'yurtici' });
    expect(findTrackingNumbers('https://evil.example.com/x?code=7301234567')).toEqual([]);
  });

  it('detects carriers by domain and name', () => {
    expect(detectCarrier('', 'noreply@araskargo.com.tr'.split('@')[1])?.id).toBe('aras');
    expect(detectCarrier('PTT Kargo şubesi')?.id).toBe('ptt');
    expect(detectCarrier('Aras bey aradı')).toBeNull();
  });
});

describe('flight numbers (§6.9.5)', () => {
  it.each([
    ['TK2412 · İstanbul → Antalya uçuşunuz', 'TK2412'],
    ['PC 2015 kalkış 09:15', 'PC2015'],
    ['VF3021 sefer sayılı uçuş', 'VF3021'],
    ['XQ 123 biniş kartı', 'XQ123'],
    ['Flight LH1301 departure 10:40', 'LH1301'],
    ['TK1 · kapı B12', 'TK1'],
  ])('%s → %s', (text, flightNo) => {
    expect(findFlightNumbers(text).map((f) => f.flightNo)).toEqual([flightNo]);
  });

  it.each(['AB1234 uçuşu', 'TK2412', 'XX1234 uçuş', 'TL2412 bilet', 'Sipariş TK2412A1'])(
    '%s is rejected',
    (text) => {
      expect(findFlightNumbers(text)).toEqual([]);
    },
  );

  it('validates airports and airlines', () => {
    expect(findAirports('IST → AYT, sonra XYZ')).toEqual(['IST', 'AYT']);
    expect(isKnownAirline('TK')).toBe(true);
    expect(isKnownAirline('XX')).toBe(false);
  });
});

describe('PNR and ticket numbers (§6.9.5)', () => {
  it.each([
    ['PNR: X7K2QA', 'X7K2QA'],
    ['PNR: ABC12D', 'ABC12D'],
    ['Rezervasyon kodu: QWE9RT', 'QWE9RT'],
    ['Rezervasyon numarası: KL3M9P', 'KL3M9P'],
    ['Booking reference: ZX81QP', 'ZX81QP'],
    ['Confirmation code # H7J8K9', 'H7J8K9'],
  ])('%s → %s', (text, code) => {
    expect(findPnrs(text).map((p) => p.code)).toEqual([code]);
  });

  it.each(['PNR: 123456', 'Booking reference: ONLINE', 'X7K2QA', 'PNR: abc123'])(
    '%s is rejected',
    (text) => {
      expect(findPnrs(text)).toEqual([]);
    },
  );

  it('a THY e-ticket is a ticket number, not a PNR', () => {
    expect(findTicketNumbers('Bilet no 235-1234567890')).toEqual([
      { ticketNumber: '2351234567890', span: [9, 23] },
    ]);
    expect(findPnrs('Bilet no 235-1234567890')).toEqual([]);
    expect(isPlausiblePnr('TICKET')).toBe(false);
  });
});
