import { describe, expect, it } from 'vitest';
import {
  aiProposalIdempotencyKey,
  approvalExecuteJobKey,
  approvalIdempotencyKey,
  briefingAudioKey,
  briefingKey,
  briefingNotificationDedupeKey,
  captureAnalysisKey,
  conflictPairKey,
  deletionKey,
  exportKey,
  firstAnalysisKey,
  identityPart,
  initialSyncKey,
  insightDedupeKey,
  isUuid,
  lifeEventDedupeKey,
  meetingPrepKey,
  meetingPrepNotifyKey,
  notificationDedupeKey,
  notificationJobKey,
  notifyKey,
  nudgeKey,
  postMeetingKey,
  referralCreditKey,
  reminderKey,
  sha256Hex,
  shortHash,
  syncKey,
  utf8Bytes,
  webhookKey,
} from '../src/ids.ts';

const U = '5b3a1c9e-2f4d-4a8b-9c7e-1d2f3a4b5c6d';

describe('sha256Hex (FIPS 180-4 vectors)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['a'.repeat(1000), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'],
  ])('sha256(%j)', (input, hex) => {
    expect(sha256Hex(input)).toBe(hex);
  });

  it('encodes UTF-8 (Turkish letters, emoji)', () => {
    expect(utf8Bytes('ş')).toEqual([0xc5, 0x9f]);
    expect(utf8Bytes('€')).toEqual([0xe2, 0x82, 0xac]);
    expect(utf8Bytes('😀')).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect(sha256Hex('çğıöşü')).toMatch(/^[0-9a-f]{64}$/);
    expect(shortHash('abc')).toBe('ba7816bf8f01cfea');
  });
});

describe('key builders (UT-KEY-01)', () => {
  it.each([
    [briefingKey(U, 'morning', '2026-09-23'), `briefing:${U}:morning:2026-09-23`],
    [approvalIdempotencyKey(U, 3), `approval:${U}:v3`],
    [approvalExecuteJobKey(U, 1), `approval_execute:${U}:v1`],
    [syncKey(U, 'h-123'), `sync:${U}:h-123`],
    [notifyKey(U), `notify:${U}`],
    [
      notificationJobKey(U, 'meeting:calendar_event:x:2026-09-23'),
      `notif:${U}:meeting:calendar_event:x:2026-09-23`,
    ],
    [meetingPrepKey(U, 1790000000.7), `meeting_prep:${U}:1790000000`],
    [meetingPrepNotifyKey(U, 1790000000), `meeting_prep_notify:${U}:1790000000`],
    [postMeetingKey(U), `post_meeting:${U}`],
    [reminderKey(U), `reminder:${U}`],
    [nudgeKey(U, '2026-09-23'), `nudge:${U}:2026-09-23`],
    [referralCreditKey(U, 'referee'), `referral:${U}:referee`],
    [webhookKey('gmail', 'm-1'), 'webhook:gmail:m-1'],
    [firstAnalysisKey(U), `first_analysis:${U}`],
    [initialSyncKey(U, 1790000000), `initial_sync:${U}:1790000000`],
    [captureAnalysisKey(U), `capture_analysis:${U}`],
    [briefingAudioKey(U, 2), `briefing_audio:${U}:2`],
    [exportKey(U), `export:${U}`],
    [deletionKey(U), `deletion:${U}`],
    [
      insightDedupeKey({ kind: 'reply_needed', entityType: 'email_thread', entityId: U }),
      `reply_needed:email_thread:${U}`,
    ],
    [
      insightDedupeKey({
        kind: 'deadline',
        entityType: 'email_message',
        entityId: U,
        discriminator: '2026-09-25',
      }),
      `deadline:email_message:${U}:2026-09-25`,
    ],
    [
      notificationDedupeKey({
        category: 'meeting',
        entityType: 'calendar_event',
        entityId: U,
        localDate: '2026-09-23',
      }),
      `meeting:calendar_event:${U}:2026-09-23`,
    ],
    [briefingNotificationDedupeKey(U), `briefing:${U}`],
  ])('%s', (key, expected) => {
    expect(key).toBe(expected);
  });

  it('validates inputs', () => {
    expect(() => approvalIdempotencyKey(U, 0)).toThrow(RangeError);
    expect(() => approvalIdempotencyKey('', 1)).toThrow(RangeError);
    expect(() => briefingAudioKey(U, 1.5)).toThrow(RangeError);
  });

  it('AI proposal keys hash the item fingerprint', () => {
    const k = aiProposalIdempotencyKey(
      'calendar_create',
      'email_message',
      'm1',
      'Toplantı 25 Eylül',
    );
    expect(k).toMatch(/^ai:calendar_create:email_message:m1:[0-9a-f]{16}:1$/);
    expect(k).toBe(
      aiProposalIdempotencyKey('calendar_create', 'email_message', 'm1', 'Toplantı 25 Eylül'),
    );
  });

  it('stable and collision-free for 10k random inputs', () => {
    let seed = 42;
    const rnd = (): string => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed.toString(16).padStart(8, '0');
    };
    const keys = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = `${rnd()}-${rnd().slice(0, 4)}-4${rnd().slice(0, 3)}-8${rnd().slice(0, 3)}-${rnd()}${rnd().slice(0, 4)}`;
      const k = approvalIdempotencyKey(id, 1);
      expect(approvalIdempotencyKey(id, 1)).toBe(k);
      keys.add(k);
    }
    expect(keys.size).toBe(10_000);
  });

  it('conflict pair keys are order independent', () => {
    const a = { id: 'e2', startEpoch: 200 };
    const b = { id: 'e1', startEpoch: 100 };
    expect(conflictPairKey(a, b)).toBe('e1:e2:100:200');
    expect(conflictPairKey(b, a)).toBe('e1:e2:100:200');
  });

  it('life event keys normalise identity fields', () => {
    const k1 = lifeEventDedupeKey('shipment', ['Yurtiçi Kargo', '7301234567']);
    const k2 = lifeEventDedupeKey('shipment', ['  YURTİÇİ kargo ', 7301234567]);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^shipment:[0-9a-f]{64}$/);
    expect(lifeEventDedupeKey('flight', ['TK2412', '2026-09-30'])).not.toBe(
      lifeEventDedupeKey('flight', ['TK2412', '2026-10-01']),
    );
    expect(identityPart(null)).toBe('');
  });

  it('isUuid', () => {
    expect(isUuid(U)).toBe(true);
    expect(isUuid('5b3a1c9e-2f4d-0a8b-9c7e-1d2f3a4b5c6d')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
