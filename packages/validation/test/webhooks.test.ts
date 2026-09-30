import { describe, expect, it } from 'vitest';
import {
  CalendarChannelHeaders,
  GRAPH_LIFECYCLE_ACTIONS,
  GmailPushData,
  GraphLifecycleBody,
  GraphNotificationBody,
  GraphValidationQuery,
  PubSubPush,
  RevenueCatWebhook,
  RevenueCatWebhookAck,
  decodeBase64Utf8,
  graphResourceKind,
  isKnownRevenueCatEventType,
  parseGmailPush,
  revenueCatAffectedUserIds,
} from '../src/webhooks/index.ts';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
const push = (data: string) => ({
  message: { data, messageId: '1234567890', publishTime: '2026-09-24T08:00:00Z', attributes: {} },
  subscription: 'projects/dijitalasistan-prod/subscriptions/gmail-push',
});

describe('Pub/Sub push (WH-01)', () => {
  it('parses the envelope and the base64 {emailAddress, historyId} payload', () => {
    const result = parseGmailPush(
      push(b64(JSON.stringify({ emailAddress: 'yunus@gmail.com', historyId: 987654 }))),
    );
    expect(result).toMatchObject({
      success: true,
      data: { emailAddress: 'yunus@gmail.com', historyId: '987654' },
    });
  });

  it.each([
    [
      'a missing messageId',
      { ...push('e30='), message: { data: 'e30=', publishTime: 'x' } },
      'body',
    ],
    ['non-base64 data', push('%%%'), 'body'],
    ['data that is not JSON', push(b64('not json')), 'data'],
    ['data without historyId', push(b64(JSON.stringify({ emailAddress: 'a@b.co' }))), 'data'],
    [
      'a malformed address',
      push(b64(JSON.stringify({ emailAddress: 'nope', historyId: '1' }))),
      'data',
    ],
  ])('rejects %s', (_name, body, error) => {
    expect(parseGmailPush(body)).toEqual({ success: false, error });
  });

  it('decodes URL-safe base64 and multi-byte UTF-8 without globals', () => {
    const text = '{"emailAddress":"şule@örnek.com"}';
    const urlSafe = Buffer.from(text, 'utf8').toString('base64url');
    expect(decodeBase64Utf8(urlSafe)).toBe(text);
    expect(decodeBase64Utf8(b64('😀'))).toBe('😀');
    expect(decodeBase64Utf8('a')).toBeNull();
  });

  it('keeps historyId as a string', () => {
    expect(GmailPushData.parse({ emailAddress: 'a@b.co', historyId: '42' }).historyId).toBe('42');
    expect(
      PubSubPush.safeParse({ message: { data: 'x', messageId: '' }, subscription: 's' }).success,
    ).toBe(false);
  });

  it('validates Calendar channel headers (WH-02)', () => {
    const headers = {
      'x-goog-channel-id': '00000000-0000-4000-8000-000000000001',
      'x-goog-channel-token': 'tok',
      'x-goog-resource-id': 'res',
      'x-goog-resource-state': 'exists',
      'x-goog-message-number': '12',
    };
    expect(CalendarChannelHeaders.safeParse(headers).success).toBe(true);
    expect(
      CalendarChannelHeaders.safeParse({ ...headers, 'x-goog-resource-state': 'changed' }).success,
    ).toBe(false);
  });
});

describe('Microsoft Graph (WH-03, WH-04)', () => {
  const notification = {
    subscriptionId: 'sub-1',
    subscriptionExpirationDateTime: '2026-09-30T08:00:00Z',
    changeType: 'created',
    resource: "me/mailFolders('inbox')/messages/AAMk",
    clientState: 'state',
    resourceData: { id: 'AAMk', '@odata.type': '#Microsoft.Graph.Message' },
  };

  it('parses change notifications and keeps resource data ids only as given', () => {
    expect(GraphNotificationBody.safeParse({ value: [notification] }).success).toBe(true);
    expect(
      GraphNotificationBody.safeParse({ value: [{ ...notification, changeType: 'moved' }] })
        .success,
    ).toBe(false);
    expect(
      GraphNotificationBody.safeParse({ value: Array.from({ length: 1001 }, () => notification) })
        .success,
    ).toBe(false);
  });

  it('parses the validation handshake token', () => {
    expect(GraphValidationQuery.safeParse({ validationToken: 'Validation: Token' }).success).toBe(
      true,
    );
    expect(GraphValidationQuery.safeParse({ validationToken: '' }).success).toBe(false);
  });

  it('maps lifecycle events to jobs', () => {
    const body = {
      value: [
        {
          lifecycleEvent: 'subscriptionRemoved',
          subscriptionId: 'sub-1',
          clientState: 's',
          subscriptionExpirationDateTime: '2026-09-30T08:00:00Z',
        },
      ],
    };
    expect(GraphLifecycleBody.safeParse(body).success).toBe(true);
    expect(
      GraphLifecycleBody.safeParse({ value: [{ ...body.value[0], lifecycleEvent: 'renewed' }] })
        .success,
    ).toBe(false);
    expect(GRAPH_LIFECYCLE_ACTIONS.subscriptionRemoved.map((a) => a.job)).toEqual([
      'watch_renewal',
      'reconciliation',
    ]);
    expect(GRAPH_LIFECYCLE_ACTIONS.missed).toEqual([{ job: 'reconciliation', mode: 'missed' }]);
  });

  it('classifies resources', () => {
    expect(graphResourceKind("me/mailFolders('inbox')/messages")).toBe('inbox');
    expect(graphResourceKind("me/mailFolders('sentitems')/messages")).toBe('sentitems');
    expect(graphResourceKind('me/events/AAMk')).toBe('events');
    expect(graphResourceKind('me/contacts')).toBe('other');
  });
});

describe('RevenueCat (WH-05)', () => {
  const body = {
    api_version: '1.0',
    event: {
      id: 'evt_1',
      type: 'INITIAL_PURCHASE',
      app_user_id: '00000000-0000-4000-8000-000000000002',
      environment: 'PRODUCTION',
      event_timestamp_ms: 1790000000000,
      product_id: 'da_pro_monthly',
      period_type: 'TRIAL',
      store: 'APP_STORE',
      subscriber_attributes: { $email: { value: 'x' } },
    },
  };

  it('accepts events and keeps unknown fields for the finance record', () => {
    const parsed = RevenueCatWebhook.parse(body);
    expect(parsed.event).toHaveProperty('subscriber_attributes');
    expect(RevenueCatWebhookAck.safeParse({ ok: true }).success).toBe(true);
  });

  it('stores unknown event types instead of rejecting them', () => {
    const unknown = {
      ...body,
      event: { ...body.event, type: 'SOMETHING_NEW', app_user_id: undefined },
    };
    expect(RevenueCatWebhook.safeParse(unknown).success).toBe(true);
    expect(isKnownRevenueCatEventType('SOMETHING_NEW')).toBe(false);
  });

  it.each([
    ['an unknown environment', { ...body, event: { ...body.event, environment: 'STAGING' } }],
    [
      'a known event without app_user_id',
      { ...body, event: { ...body.event, app_user_id: undefined } },
    ],
    ['a transfer without ids', { ...body, event: { ...body.event, type: 'TRANSFER' } }],
    ['a missing event id', { ...body, event: { ...body.event, id: '' } }],
  ])('rejects %s', (_name, value) => {
    expect(RevenueCatWebhook.safeParse(value).success).toBe(false);
  });

  it('re-fetches both sides of a transfer', () => {
    const transfer = RevenueCatWebhook.parse({
      ...body,
      event: {
        ...body.event,
        type: 'TRANSFER',
        app_user_id: undefined,
        transferred_from: ['a'],
        transferred_to: ['b', 'a'],
      },
    });
    expect(revenueCatAffectedUserIds(transfer)).toEqual(['a', 'b']);
  });
});
