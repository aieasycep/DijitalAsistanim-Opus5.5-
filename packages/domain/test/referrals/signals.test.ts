import { describe, expect, it } from 'vitest';
import {
  isApplePrivateRelayEmail,
  networkDaySignalMaterial,
  normalizeEmailForSignal,
  referralSignalMaterial,
} from '../../src/referrals/signals.ts';

describe('e-mail normalisation for duplicate detection (UT-REF-02)', () => {
  it.each([
    ['a.b+x@gmail.com', 'ab@gmail.com'],
    ['AB@Gmail.com', 'ab@gmail.com'],
    ['a.b@googlemail.com', 'ab@gmail.com'],
    ['selin.kaya+promo@outlook.com', 'selin.kaya@outlook.com'],
    ['  Ahmet.Yilmaz@KuzeyLojistik.example ', 'ahmet.yilmaz@kuzeylojistik.example'],
    ['x@privaterelay.appleid.com', 'x@privaterelay.appleid.com'],
  ])('%s → %s', (input, normalized) => {
    expect(normalizeEmailForSignal(input)).toBe(normalized);
  });

  it.each(['', 'no-at-sign', '@example.com', 'user@', '+tag@gmail.com'])(
    '%j is not an address',
    (input) => {
      expect(normalizeEmailForSignal(input)).toBeNull();
    },
  );

  it('equal mailboxes produce equal HMAC material', () => {
    expect(referralSignalMaterial('email', 'a.b+x@gmail.com')).toBe(
      referralSignalMaterial('email', 'ab@gmail.com'),
    );
    expect(referralSignalMaterial('email', 'ab@gmail.com')).toBe('v1:email:ab@gmail.com');
    expect(referralSignalMaterial('installation', ' ABC-123 ')).toBe('v1:installation:abc-123');
    expect(referralSignalMaterial('apple_sub', '001234.abcd')).toBe('v1:apple_sub:001234.abcd');
    expect(referralSignalMaterial('provider_email', 'bad')).toBeNull();
    expect(referralSignalMaterial('installation', '   ')).toBeNull();
  });

  it('recognises Apple private relay addresses', () => {
    expect(isApplePrivateRelayEmail('q7x2@privaterelay.appleid.com')).toBe(true);
    expect(isApplePrivateRelayEmail('user@icloud.com')).toBe(false);
  });

  it('builds same-network-same-day material from /24 (IPv4) or /48 (IPv6)', () => {
    expect(networkDaySignalMaterial('88.230.14.77', '2026-09-23')).toBe(
      'v1:ip24_day:88.230.14.0/24:2026-09-23',
    );
    expect(networkDaySignalMaterial('88.230.14.1', '2026-09-23')).toBe(
      networkDaySignalMaterial('88.230.14.200', '2026-09-23'),
    );
    expect(networkDaySignalMaterial('2a02:ff0:3::1', '2026-09-23')).toBe(
      'v1:ip48_day:2a02:ff0:3::/48:2026-09-23',
    );
    expect(networkDaySignalMaterial('not-an-ip', '2026-09-23')).toBeNull();
    expect(networkDaySignalMaterial('88.230.14.1', '23.09.2026')).toBeNull();
  });
});
