import { describe, expect, it } from 'vitest';
import {
  approvalMessageId,
  deriveMarker,
  findTextMarker,
  googleEventIdFor,
  textMarkerFor,
  uuidBase32Hex,
} from '../../src/providers/markers.ts';

const APPROVAL = '8a4f1c9e-1111-4222-8333-944455556666';
const KEY = `approval:${APPROVAL}:v1`;

describe('idempotency markers (INTEGRATION_PLAN §2.3)', () => {
  it('encodes the 16 UUID bytes as RFC 4648 base32hex without padding', () => {
    expect(uuidBase32Hex('00000000-0000-4000-8000-000000000000')).toBe(
      '00000000010010000000000000',
    );
    expect(uuidBase32Hex(APPROVAL)).toBe('h97hp7gh251250pjih25alb6co');
    expect(uuidBase32Hex('ffffffff-ffff-4fff-bfff-ffffffffffff')).toHaveLength(26);
    expect(uuidBase32Hex('ffffffff-ffff-4fff-bfff-ffffffffffff')).toMatch(/^[0-9a-v]+$/);
  });

  it('derives a 28-character Google event id in the allowed charset', () => {
    const id = googleEventIdFor(APPROVAL);
    expect(id).toHaveLength(28);
    expect(id).toMatch(/^da[0-9a-v]{26}$/);
    expect(googleEventIdFor(APPROVAL.toUpperCase())).toBe(id);
  });

  it('derives every marker deterministically', () => {
    const cfg = { mailDomain: 'mail.dijitalasistan.app', webUrl: 'https://dijitalasistan.app/' };
    const marker = deriveMarker(APPROVAL, KEY, cfg);
    expect(marker).toEqual(deriveMarker(APPROVAL, KEY, cfg));
    expect(marker.rfc822MessageId).toBe(`<approval-${APPROVAL}@mail.dijitalasistan.app>`);
    expect(marker.graphTransactionId).toBe(APPROVAL);
    expect(marker.deepLinkUrl).toBe(`https://dijitalasistan.app/app/approvals/${APPROVAL}`);
    expect(marker.textMarker).toMatch(/^\[DA:[0-9a-f]{12}\]$/);
    expect(deriveMarker(APPROVAL, `approval:${APPROVAL}:v2`, cfg).textMarker).not.toBe(
      marker.textMarker,
    );
  });

  it('finds a text marker inside notes and rejects invalid inputs', () => {
    const marker = textMarkerFor(KEY);
    expect(findTextMarker(`Teklifi gönder\n${marker}`)).toBe(marker);
    expect(findTextMarker('no marker here')).toBeNull();
    expect(findTextMarker(null)).toBeNull();
    expect(() => googleEventIdFor('not-a-uuid')).toThrow(RangeError);
    expect(() => approvalMessageId(APPROVAL, 'bad domain')).toThrow(RangeError);
    expect(() => textMarkerFor('')).toThrow(RangeError);
  });
});
