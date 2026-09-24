import { describe, expect, it } from 'vitest';
import {
  APPROVAL_ACTION_TYPES,
  APPROVAL_PAYLOAD_SCHEMAS,
  ApprovalChangeSet,
  ApprovalExecution,
  ApprovalPayload,
  EXACT_CHANGE_KIND_BY_ACTION,
  SIDE_EFFECTS_BY_ACTION,
  TARGET_KINDS_BY_ACTION,
  applyApprovalPayloadPatch,
  approvalTargetKind,
} from '../src/api/approvals.ts';
import {
  B64_32,
  SHA,
  TS,
  TS_LATER,
  calendarCreatePayload,
  evidence,
  recipient,
  sourceRef,
  uuid,
  withPath,
} from './fixtures/samples.ts';

const emailSend = {
  action_type: 'email_send',
  connected_account_id: uuid(10),
  provider: 'microsoft',
  mode: 'follow_up',
  reply_draft_id: uuid(20),
  thread: { email_thread_id: uuid(91), reply_to_message_id: uuid(90) },
  to: [recipient],
  cc: [],
  subject: 'Re: Teklif',
  body_text: 'Merhaba, dönüşünüzü bekliyorum.',
  language: 'tr',
  attachments: [
    { storage_path: 'u/replies/a.pdf', name: 'a.pdf', mime: 'application/pdf', size_bytes: 1000 },
  ],
};
const calendarUpdate = {
  action_type: 'calendar_update',
  target: { kind: 'provider', connected_account_id: uuid(10), calendar_id: uuid(12) },
  calendar_event_id: uuid(61),
  changes: { time: { kind: 'timed', start: TS, end: TS_LATER, time_zone: 'Europe/Istanbul' } },
};
const taskCreate = {
  action_type: 'task_create',
  target: { kind: 'in_app' },
  title: 'İmzalı kopyayı gönder',
  due: { kind: 'date', date: '2026-09-26' },
};
const reminderCreate = {
  action_type: 'reminder_create',
  destination: { kind: 'in_app', channel: 'push' },
  title: 'Teklifi gönder',
  preset: 'before_30m',
  fire_at: TS,
  anchor_at: TS_LATER,
  time_zone: 'Europe/Istanbul',
};
const commitmentCreate = {
  action_type: 'commitment_create',
  text: 'Teklifi yarın gönder',
  direction: 'user_owes',
  counterparty: { name: 'Mehmet Yılmaz' },
  due_at: TS_LATER,
  due_precision: 'date',
  source: sourceRef,
  evidence,
  confidence: 0.82,
};

const payloads = {
  email_send: emailSend,
  calendar_create: calendarCreatePayload,
  calendar_update: calendarUpdate,
  task_create: taskCreate,
  reminder_create: reminderCreate,
  commitment_create: commitmentCreate,
} as const;

const invalidPayloads: [string, unknown][] = [
  ['email without recipients', { ...emailSend, to: [] }],
  [
    'email attachments above 3 MiB',
    { ...emailSend, attachments: [{ ...emailSend.attachments[0], size_bytes: 4 * 1024 * 1024 }] },
  ],
  ['email with an unknown provider', { ...emailSend, provider: 'yahoo' }],
  [
    'all-day event ending on its start date',
    {
      ...calendarCreatePayload,
      time: { kind: 'all_day', start_date: '2026-09-24', end_date: '2026-09-24' },
    },
  ],
  [
    'timed event with an invalid zone',
    withPath(calendarCreatePayload, 'time.time_zone', 'Europe/Nowhere'),
  ],
  [
    'device target with a bad calendar hash',
    {
      ...calendarCreatePayload,
      target: {
        kind: 'device',
        provider: 'apple_device',
        installation_id: uuid(1),
        device_calendar_hash: 'abc',
      },
    },
  ],
  ['update without changes', { ...calendarUpdate, changes: {} }],
  [
    'Android Reminders do not exist',
    {
      ...taskCreate,
      target: {
        kind: 'device',
        provider: 'android_device',
        installation_id: uuid(1),
        reminder_list_hash: SHA,
      },
    },
  ],
  ['Google Tasks title over 1,024 chars', { ...taskCreate, title: 'x'.repeat(1025) }],
  ['reminder firing after its anchor', { ...reminderCreate, fire_at: TS_LATER, anchor_at: TS }],
  ['commitment without counterparty', { ...commitmentCreate, counterparty: {} }],
  ['commitment with a due date but no precision', { ...commitmentCreate, due_precision: 'none' }],
  ['commitment confidence above 1', { ...commitmentCreate, confidence: 1.2 }],
  ['unknown action type', { ...taskCreate, action_type: 'email_forward' }],
];

describe('approval payloads (§5.1)', () => {
  it.each(APPROVAL_ACTION_TYPES)('accepts a %s payload', (type) => {
    const result = ApprovalPayload.safeParse(payloads[type]);
    expect(result.success ? [] : result.error.issues).toEqual([]);
    expect(APPROVAL_PAYLOAD_SCHEMAS[type].safeParse(payloads[type]).success).toBe(true);
  });

  it.each(invalidPayloads)('rejects %s', (_name, value) => {
    expect(ApprovalPayload.safeParse(value).success).toBe(false);
  });

  it('applies defaults for attendees, reminders and attachments', () => {
    const parsed = ApprovalPayload.parse({
      ...calendarCreatePayload,
      attendees: undefined,
      reminders_minutes: undefined,
    });
    expect(parsed).toMatchObject({ attendees: [], reminders_minutes: [] });
  });

  it('derives the destination kind of every payload', () => {
    expect(
      APPROVAL_ACTION_TYPES.map((t) => approvalTargetKind(ApprovalPayload.parse(payloads[t]))),
    ).toEqual(['provider', 'provider', 'provider', 'in_app', 'in_app', 'in_app']);
  });
});

describe('ApprovalChangeSet: exact change, destination and side effects per action type', () => {
  const destinationFor = (type: (typeof APPROVAL_ACTION_TYPES)[number]) => {
    const kind = approvalTargetKind(ApprovalPayload.parse(payloads[type]));
    return {
      target_kind: kind,
      provider: kind === 'in_app' ? 'in_app' : 'google',
      account_label: kind === 'in_app' ? null : 'yunus@example.com',
      container_label: null,
    };
  };
  const changeSet = (type: (typeof APPROVAL_ACTION_TYPES)[number]) => ({
    action_type: type,
    payload: payloads[type],
    exact_change: {
      kind: EXACT_CHANGE_KIND_BY_ACTION[type],
      fields: [{ field: 'title', before: null, after: 'x' }],
    },
    destination: destinationFor(type),
    side_effects: [{ code: SIDE_EFFECTS_BY_ACTION[type][0], text: 'Etkisi' }],
  });

  it.each(APPROVAL_ACTION_TYPES)('accepts a consistent %s change set', (type) => {
    const result = ApprovalChangeSet.safeParse(changeSet(type));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it.each(APPROVAL_ACTION_TYPES)(
    'rejects a %s change set whose exact-change kind does not match',
    (type) => {
      const wrong = EXACT_CHANGE_KIND_BY_ACTION[type] === 'create' ? 'update' : 'create';
      expect(
        ApprovalChangeSet.safeParse(withPath(changeSet(type), 'exact_change.kind', wrong)).success,
      ).toBe(false);
    },
  );

  it('rejects side effects an action type cannot have', () => {
    const set = withPath(changeSet('commitment_create'), 'side_effects', [
      { code: 'email_sent_to', text: 'x' },
    ]);
    expect(ApprovalChangeSet.safeParse(set).success).toBe(false);
  });

  it('rejects a destination the action type cannot target', () => {
    const set = withPath(changeSet('commitment_create'), 'destination', {
      target_kind: 'provider',
      provider: 'google',
      account_label: null,
      container_label: null,
    });
    expect(ApprovalChangeSet.safeParse(set).success).toBe(false);
    expect(TARGET_KINDS_BY_ACTION.email_send).toEqual(['provider']);
  });

  it('requires a device_write side effect for device targets', () => {
    const device = {
      ...changeSet('calendar_create'),
      payload: {
        ...calendarCreatePayload,
        target: {
          kind: 'device',
          provider: 'apple_device',
          installation_id: uuid(1),
          device_calendar_hash: SHA,
        },
      },
      destination: {
        target_kind: 'device',
        provider: 'apple_device',
        account_label: null,
        container_label: 'Takvim',
      },
    };
    expect(
      ApprovalChangeSet.safeParse({
        ...device,
        side_effects: [{ code: 'device_write', text: 'x' }],
      }).success,
    ).toBe(true);
    expect(
      ApprovalChangeSet.safeParse({
        ...device,
        side_effects: [{ code: 'internal_record', text: 'x' }],
      }).success,
    ).toBe(false);
  });
});

describe('applyApprovalPayloadPatch (API-APR-02)', () => {
  const calendar = ApprovalPayload.parse(calendarCreatePayload);
  const email = ApprovalPayload.parse(emailSend);

  it('merges and re-validates with the full schema', () => {
    const result = applyApprovalPayloadPatch(calendar, {
      title: 'Yeni başlık',
      time: { end: '2026-09-24T10:00:00Z' },
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toMatchObject({
        title: 'Yeni başlık',
        time: { kind: 'timed', end: '2026-09-24T10:00:00Z' },
      });
  });

  it.each([
    ['a changed action type', { action_type: 'task_create' }],
    ['a changed target kind', { target: { kind: 'device' } }],
    ['a merged payload that no longer validates', { time: { end: '2026-09-24T07:00:00Z' } }],
  ])('rejects %s', (_name, patch) => {
    expect(applyApprovalPayloadPatch(calendar, patch).success).toBe(false);
  });

  it('allows only body, subject and recipients on email_send', () => {
    expect(
      applyApprovalPayloadPatch(email, { body_text: 'Güncel metin', cc: [recipient] }).success,
    ).toBe(true);
    expect(applyApprovalPayloadPatch(email, { connected_account_id: uuid(99) }).success).toBe(
      false,
    );
  });
});

describe('ApprovalExecution (API-APR-03)', () => {
  it('pairs device mode with a token and instructions', () => {
    const instructions = {
      ...calendarCreatePayload,
      target: {
        kind: 'device',
        provider: 'apple_device',
        installation_id: uuid(1),
        device_calendar_hash: SHA,
      },
    };
    expect(
      ApprovalExecution.safeParse({ mode: 'device', device_token: B64_32, instructions }).success,
    ).toBe(true);
    expect(
      ApprovalExecution.safeParse({ mode: 'server', device_token: B64_32, instructions: null })
        .success,
    ).toBe(false);
    expect(
      ApprovalExecution.safeParse({ mode: 'device', device_token: B64_32, instructions: null })
        .success,
    ).toBe(false);
  });
});
