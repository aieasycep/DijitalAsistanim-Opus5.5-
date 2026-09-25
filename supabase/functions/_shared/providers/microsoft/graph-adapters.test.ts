/**
 * Graph calendar / To Do / Outlook mail adapters and the Graph client over a stubbed Graph API
 * (response shapes per the Graph v1.0 reference; no network). TEST_PLAN IT-SYNC-11/12/13/14/15/16,
 * IT-APR-08/09/12, CT-07; INTEGRATION_PLAN §5.4–§5.6.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { deriveMarker, type ProviderContext, ProviderError, type WatchHandle } from '@da/domain';
import { sha256Hex } from '../../crypto/hmac.ts';
import { jsonResponse, type RecordedCall, stubFetch } from '../../testing/fetch.ts';
import { GraphCalendarAdapter, normalizeGraphEvent } from './calendar.ts';
import { DA_APPROVAL_PROPERTY_ID, DA_LAST_APPROVAL_PROPERTY_ID } from './config.ts';
import { GraphClient, parseGraphError } from './graph.ts';
import { OutlookMailAdapter } from './mail.ts';
import { GraphSubscriptions } from './subscriptions.ts';
import { normalizeTodoTask, TodoAdapter } from './tasks.ts';

const BASE = 'https://graph.microsoft.com/v1.0';
const NOW = new Date('2026-09-24T07:30:00.000Z');
const APPROVAL = '8f14e45f-ceea-4e67-a8c4-2b3e1d0f9a11';
const MARKER = deriveMarker(APPROVAL, 'approval:task_create:k1', {
  mailDomain: 'mail.dijitalasistan.app',
  webUrl: 'https://dijitalasistan.app',
});
const WEBHOOK = {
  notificationUrl: 'https://api.example.test/functions/v1/webhooks-microsoft/notify',
  lifecycleUrl: 'https://api.example.test/functions/v1/webhooks-microsoft/lifecycle',
};

function ctx(): ProviderContext {
  return {
    account: {
      connectedAccountId: `acct-${crypto.randomUUID()}`,
      userId: '11111111-1111-4111-8111-111111111111',
      provider: 'microsoft',
      providerAccountId: 'oid:tid',
      email: 'yunus@contoso.example',
      tenantId: 'tid',
      tenantType: 'work',
      capabilitiesGranted: [
        'mail_read',
        'calendar_read',
        'calendar_write',
        'tasks_read',
        'tasks_write',
        'mail_send',
      ],
      dataSourceToggles: {} as ProviderContext['account']['dataSourceToggles'],
    },
    tokens: { get: () => Promise.resolve('graph-token') },
    quota: { acquire: () => Promise.resolve() },
    clock: { now: () => NOW },
    log: { info() {}, warn() {}, error() {} },
    correlationId: 'test',
  };
}

type Route = (call: RecordedCall, url: URL) => Response | undefined;

function graph(route: Route) {
  const stub = stubFetch(
    (call) => route(call, new URL(call.url)) ?? new Response('unexpected', { status: 599 }),
  );
  const client = new GraphClient({
    base: BASE,
    http: { fetch: stub.fetch, sleep: () => Promise.resolve() },
  });
  const subs = new GraphSubscriptions(client, WEBHOOK);
  return { stub, client, subs };
}

const graphError = (status: number, code: string, headers: Record<string, string> = {}) =>
  jsonResponse({ error: { code, message: 'redacted' } }, status, headers);

// ── Client ───────────────────────────────────────────────────────────────────

Deno.test(
  'graph client (IT-SYNC-11): immutable ids on every call; links stay on the Graph origin',
  async () => {
    const { stub, client } = graph(() => jsonResponse({ value: [] }));
    await client.json(ctx(), '/me/messages', { prefer: ['odata.maxpagesize=50'] });
    assertEquals(
      stub.calls[0]?.headers.get('Prefer'),
      'IdType="ImmutableId", odata.maxpagesize=50',
    );
    assertEquals(stub.calls[0]?.headers.get('Authorization'), 'Bearer graph-token');
    assertEquals(client.resolve(`${BASE}/me/x`), `${BASE}/me/x`);
    const e = await assertRejects(
      () => client.json(ctx(), 'https://evil.example/v1.0/me'),
      ProviderError,
    );
    assertEquals([e.code, e.providerReason], ['payload_invalid', 'foreign_link']);
    const empty = graph(() => new Response(null, { status: 204 }));
    assertEquals(await empty.client.json(ctx(), '/me/x', { method: 'DELETE' }), {});
  },
);

Deno.test(
  'graph client (IT-SYNC-15): throttling codes classify as rate limits; disabled mailboxes surface',
  async () => {
    assertEquals(await parseGraphError(graphError(503, 'MailboxConcurrency')), {
      code: 'TooManyRequests',
      reason: 'MailboxConcurrency',
    });
    assertEquals(await parseGraphError(jsonResponse({ error: 'invalid_grant' }, 400)), {
      code: 'invalid_grant',
    });
    assertEquals(
      await parseGraphError(
        jsonResponse(
          { error: { code: 'ErrorAccessDenied', innerError: { code: 'AccessDenied' } } },
          403,
        ),
      ),
      { code: 'ErrorAccessDenied', reason: 'AccessDenied' },
    );
    assertEquals(await parseGraphError(new Response('<html>', { status: 502 })), {});

    const throttled = graph(() => graphError(429, 'TooManyRequests', { 'Retry-After': '120' }));
    const e = await assertRejects(
      () => throttled.client.json(ctx(), '/me/messages'),
      ProviderError,
    );
    assertEquals(e.code, 'rate_limited');
    assert((e.retryAfterMs ?? 0) >= 120_000, 'a long Retry-After is handed to the job');

    const disabled = graph(() => graphError(404, 'MailboxNotEnabledForRESTAPI'));
    const d = await assertRejects(() => disabled.client.json(ctx(), '/me/messages'), ProviderError);
    assertEquals(
      [d.code, d.providerReason],
      ['mailbox_unavailable', 'MailboxNotEnabledForRESTAPI'],
    );
  },
);

Deno.test(
  'graph client: $batch chunks of 20; 404 items are null; a throttled item fails the batch',
  async () => {
    const { stub, client } = graph((call) => {
      const body = JSON.parse(call.body ?? '{}') as { requests: { id: string; url: string }[] };
      return jsonResponse({
        responses: body.requests.map((r) =>
          r.id === '3'
            ? { id: r.id, status: 404, body: { error: { code: 'ErrorItemNotFound' } } }
            : { id: r.id, status: 200, body: { id: `m${r.id}` } },
        ),
      });
    });
    const reqs = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      url: `/me/messages/m${String(i)}`,
    }));
    const out = await client.batchGet<{ id: string }>(ctx(), reqs);
    assertEquals(stub.calls.length, 2);
    assertEquals(
      (JSON.parse(stub.calls[0]?.body ?? '{}') as { requests: unknown[] }).requests.length,
      20,
    );
    assertEquals([out.get('0')?.body?.id, out.get('3')?.body, out.size], ['m0', null, 25]);
    const batchReq = (
      JSON.parse(stub.calls[1]?.body ?? '{}') as {
        requests: { headers: Record<string, string>; method: string }[];
      }
    ).requests[0];
    assertEquals([batchReq?.method, batchReq?.headers.Prefer], ['GET', 'IdType="ImmutableId"']);

    const busy = graph(() => jsonResponse({ responses: [{ id: '0', status: 429 }] }));
    const e = await assertRejects(
      () => busy.client.batchGet(ctx(), [{ id: '0', url: '/me/messages/a' }]),
      ProviderError,
    );
    assertEquals([e.code, e.providerReason], ['rate_limited', 'batch_throttled']);
  },
);

// ── Subscriptions ────────────────────────────────────────────────────────────

Deno.test(
  'graph subscriptions (IT-SYNC-14): create with a hashed clientState and lifecycle URL; renew; remove',
  async () => {
    let sentState = '';
    const { stub, subs } = graph((call, url) => {
      if (call.method === 'POST' && url.pathname.endsWith('/subscriptions')) {
        const body = JSON.parse(call.body ?? '{}') as Record<string, string>;
        sentState = body.clientState ?? '';
        return jsonResponse({ id: 'sub-1', expirationDateTime: '2026-10-01T07:20:00Z' }, 201);
      }
      if (call.method === 'PATCH')
        return jsonResponse({ id: 'sub-1', expirationDateTime: '2026-10-01T09:00:00Z' });
      if (url.pathname.endsWith('/reauthorize')) return new Response(null, { status: 204 });
      if (call.method === 'DELETE')
        return url.pathname.endsWith('gone')
          ? graphError(404, 'ResourceNotFound')
          : new Response(null, { status: 204 });
      return undefined;
    });
    const c = ctx();
    const handle = await subs.create(c, {
      resource: "me/mailFolders('inbox')/messages",
      handleResource: 'graph_mail_inbox',
      resourceKey: '',
    });
    const body = JSON.parse(stub.calls[0]?.body ?? '{}') as Record<string, unknown>;
    assertEquals(
      [
        body.changeType,
        body.notificationUrl,
        body.lifecycleNotificationUrl,
        body.latestSupportedTlsVersion,
      ],
      ['created,updated,deleted', WEBHOOK.notificationUrl, WEBHOOK.lifecycleUrl, 'v1_2'],
    );
    assert(sentState.length >= 60, 'clientState carries ≥256 bits');
    assertEquals(
      handle.tokenHash,
      await sha256Hex(sentState),
      'only the hash of clientState is kept',
    );
    assertEquals([handle.watchId, handle.expiresAt], ['sub-1', '2026-10-01T07:20:00Z']);

    const renewed = await subs.renew(c, handle);
    assertEquals(renewed.expiresAt, '2026-10-01T09:00:00Z');
    const patch = JSON.parse(stub.calls[1]?.body ?? '{}') as { expirationDateTime: string };
    assertEquals(Date.parse(patch.expirationDateTime) - NOW.getTime(), 10_070 * 60_000);
    await subs.reauthorize(c, handle);
    await subs.remove(c, handle);
    await subs.remove(c, { ...handle, watchId: 'gone' });
    assertEquals(
      stub.calls.map((x) => x.method),
      ['POST', 'PATCH', 'POST', 'DELETE', 'DELETE'],
    );

    const unconfigured = new GraphSubscriptions(
      new GraphClient({ base: BASE, http: { fetch: stub.fetch } }),
      null,
    );
    const e = await assertRejects(
      () => unconfigured.create(c, { resource: 'x', handleResource: 'y', resourceKey: '' }),
      ProviderError,
    );
    assertEquals(e.code, 'external_credential_required');
  },
);

// ── Calendar ─────────────────────────────────────────────────────────────────

const EVENT = {
  id: 'AAMkEv1',
  '@odata.etag': 'W/"etag-1"',
  iCalUId: 'ical-1',
  type: 'singleInstance',
  subject: 'Yılmaz Endüstri teklif görüşmesi',
  body: { contentType: 'text', content: 'Gündem: revize teklif.\n'.repeat(40) },
  location: { displayName: 'Toplantı Odası 3' },
  start: { dateTime: '2026-09-24T09:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-09-24T10:00:00.0000000', timeZone: 'UTC' },
  isAllDay: false,
  showAs: 'busy',
  sensitivity: 'normal',
  organizer: { emailAddress: { address: 'Mehmet@YilmazEndustri.example', name: 'Mehmet Yılmaz' } },
  isOrganizer: false,
  attendees: [
    {
      emailAddress: { address: 'yunus@contoso.example', name: 'Yunus' },
      status: { response: 'tentativelyAccepted' },
    },
    {
      emailAddress: { address: 'mehmet@yilmazendustri.example' },
      status: { response: 'organizer' },
    },
    { status: { response: 'none' } },
  ],
  onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc' },
  lastModifiedDateTime: '2026-09-23T12:00:00Z',
  transactionId: APPROVAL,
};

Deno.test(
  'graph calendar: event normalisation — UTC instants, excerpt, attendees, conference, marker',
  () => {
    const e = normalizeGraphEvent(EVENT, 'cal-1', 'yunus@contoso.example');
    assertEquals(
      [e.start, e.end],
      [
        { dateTime: '2026-09-24T09:00:00.000Z', timeZone: 'UTC' },
        { dateTime: '2026-09-24T10:00:00.000Z', timeZone: 'UTC' },
      ],
    );
    assert((e.descriptionSnippet?.length ?? 0) <= 500, 'the body is reduced to an excerpt');
    assertEquals(
      e.attendees.map((a) => [a.email, a.responseStatus, a.isSelf, a.isOrganizer]),
      [
        ['yunus@contoso.example', 'tentative', true, false],
        ['mehmet@yilmazendustri.example', 'accepted', false, true],
      ],
    );
    assertEquals(
      [e.conferenceUrl?.startsWith('https://teams.microsoft.com/'), e.daApprovalId, e.etag],
      [true, APPROVAL, 'W/"etag-1"'],
    );
    assertEquals(
      [e.status, e.transparency, e.visibility, e.deleted],
      ['confirmed', 'busy', 'default', false],
    );

    const allDay = normalizeGraphEvent(
      {
        id: 'x',
        isAllDay: true,
        start: { dateTime: '2026-09-25T00:00:00.0000000' },
        end: { dateTime: '2026-09-26T00:00:00.0000000' },
        showAs: 'free',
        sensitivity: 'personal',
        isCancelled: true,
        transactionId: 'not-a-uuid',
        onlineMeeting: { joinUrl: 'https://evil.example/join' },
        changeKey: 'ck',
      },
      'cal-1',
      null,
    );
    assertEquals(
      [allDay.start, allDay.status, allDay.transparency, allDay.visibility, allDay.deleted],
      [{ date: '2026-09-25' }, 'cancelled', 'free', 'private', true],
    );
    assertEquals(
      [allDay.daApprovalId, allDay.conferenceUrl, allDay.etag, allDay.organizer],
      [null, null, 'ck', null],
    );
    const tentative = normalizeGraphEvent(
      {
        id: 'y',
        showAs: 'tentative',
        sensitivity: 'confidential',
        type: 'occurrence',
        seriesMasterId: 'm',
        originalStart: '2026-09-24T09:00:00Z',
        bodyPreview: 'kısa',
      },
      'c',
      null,
    );
    assertEquals(
      [
        tentative.status,
        tentative.visibility,
        tentative.isOccurrence,
        tentative.descriptionSnippet,
      ],
      ['tentative', 'confidential', true, 'kısa'],
    );
  },
);

Deno.test(
  'graph calendar: calendars classify default/birthday/holiday/shared with edit rights',
  async () => {
    const { calendarAdapter } = setupCalendar(() =>
      jsonResponse({
        value: [
          {
            id: 'c1',
            name: 'Takvim',
            hexColor: '#1a73e8',
            canEdit: true,
            isDefaultCalendar: true,
            owner: { address: 'yunus@contoso.example' },
          },
          { id: 'c2', name: 'Doğum günü takvimi', canEdit: false },
          { id: 'c3', name: 'Türkiye tatil günleri', hexColor: 'blue', canEdit: false },
          { id: 'c4', name: 'Ekip', canEdit: true, owner: { address: 'selin@contoso.example' } },
          { id: 'c5', name: 'Kişisel', canEdit: true, owner: { address: 'Yunus@Contoso.example' } },
        ],
      }),
    );
    const list = await calendarAdapter.listCalendars(ctx());
    assertEquals(
      list.map((c) => [c.providerCalendarId, c.kind, c.accessRole, c.color]),
      [
        ['c1', 'default', 'owner', '#1a73e8'],
        ['c2', 'birthdays', 'reader', null],
        ['c3', 'holidays', 'reader', null],
        ['c4', 'shared', 'writer', null],
        ['c5', 'other', 'owner', null],
      ],
    );
  },
);

function setupCalendar(route: Route) {
  const g = graph(route);
  return { ...g, calendarAdapter: new GraphCalendarAdapter(g.client, g.subs) };
}

Deno.test(
  'graph calendar (IT-SYNC-13): calendarView/delta pages, @removed, deltaLink cursor with window',
  async () => {
    const window = { start: '2026-09-22T00:00:00.000Z', end: '2026-11-23T00:00:00.000Z' };
    const deltaLink = `${BASE}/me/calendars/cal-1/calendarView/delta?$deltatoken=dt2`;
    const { stub, calendarAdapter } = setupCalendar((_call, url) => {
      if (url.searchParams.get('$skiptoken') === 'p2')
        return jsonResponse({
          value: [{ id: 'gone', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': deltaLink,
        });
      return jsonResponse({
        value: [EVENT],
        '@odata.nextLink': `${BASE}/me/calendars/cal-1/calendarView/delta?$skiptoken=p2`,
      });
    });
    const first = await calendarAdapter.fullSync(ctx(), 'cal-1', window);
    const url = new URL(stub.calls[0]!.url);
    assertEquals(
      [url.searchParams.get('startDateTime'), url.searchParams.get('endDateTime')],
      [window.start, window.end],
    );
    assertEquals(
      stub.calls[0]?.headers.get('Prefer'),
      'IdType="ImmutableId", odata.maxpagesize=50, outlook.timezone="UTC"',
    );
    assertEquals(
      [first.upserts.length, first.nextCursor, first.pageToken?.includes('p2')],
      [1, null, true],
    );
    const second = await calendarAdapter.fullSync(ctx(), 'cal-1', window, first.pageToken);
    assertEquals(second.deleted, ['gone']);
    assertEquals(second.nextCursor, {
      kind: 'graph_calendar_view_delta',
      value: deltaLink,
      window,
    });
    const next = await calendarAdapter.changesSince(ctx(), 'cal-1', {
      kind: 'graph_calendar_view_delta',
      value: deltaLink,
    });
    assertEquals(next.nextCursor?.window, undefined);
  },
);

Deno.test(
  'graph calendar (IT-SYNC-12): an expired delta token is cursor_invalid; other errors pass',
  async () => {
    for (const response of [
      graphError(410, 'SyncStateNotFound'),
      graphError(400, 'resyncRequired'),
    ]) {
      const { calendarAdapter } = setupCalendar(() => response.clone());
      const e = await assertRejects(
        () =>
          calendarAdapter.changesSince(ctx(), 'cal-1', {
            kind: 'graph_calendar_view_delta',
            value: `${BASE}/delta`,
          }),
        ProviderError,
      );
      assertEquals([e.code, e.providerReason], ['cursor_invalid', 'delta_expired']);
    }
    const { calendarAdapter } = setupCalendar(() => graphError(403, 'ErrorAccessDenied'));
    const e = await assertRejects(
      () => calendarAdapter.fullSync(ctx(), 'cal-1', { start: 'a', end: 'b' }),
      ProviderError,
    );
    assertEquals(e.code, 'scope_missing');
  },
);

Deno.test(
  'graph calendar: series instances, single events, descriptions and the IANA time zone',
  async () => {
    const { stub, calendarAdapter } = setupCalendar((_call, url) => {
      if (url.pathname.endsWith('/instances'))
        return jsonResponse({ value: [EVENT, { ...EVENT, id: 'AAMkEv2' }] });
      if (url.pathname.endsWith('/mailboxSettings/timeZone'))
        return jsonResponse({ value: 'Europe/Istanbul' });
      if (url.pathname.endsWith('/missing')) return graphError(404, 'ErrorItemNotFound');
      if (url.searchParams.get('$select') === 'body')
        return jsonResponse({ body: { content: 'x'.repeat(900) } });
      return jsonResponse(EVENT);
    });
    const c = ctx();
    assertEquals(
      (await calendarAdapter.expandSeries(c, 'cal-1', 'master', { start: 'a', end: 'b' })).length,
      2,
    );
    assertEquals(
      (await calendarAdapter.getEvent(c, 'cal-1', 'AAMkEv1'))?.providerEventId,
      'AAMkEv1',
    );
    assertEquals(await calendarAdapter.getEvent(c, 'cal-1', 'missing'), null);
    assertEquals(
      (await calendarAdapter.getEventDescription(c, 'cal-1', 'AAMkEv1', { maxBytes: 200 }))?.length,
      200,
    );
    assertEquals(await calendarAdapter.getUserTimeZone(c), 'Europe/Istanbul');
    const tz = setupCalendar(() => jsonResponse({ value: 'Turkey Standard Time' }));
    assertEquals(
      await tz.calendarAdapter.getUserTimeZone(c),
      null,
      'Windows zone names are not suggested',
    );
    const eventCall = stub.calls.find((x) =>
      new URL(x.url).pathname.endsWith('/me/events/AAMkEv1'),
    )!;
    assertEquals(
      eventCall.headers.get('Prefer'),
      'IdType="ImmutableId", outlook.timezone="UTC", outlook.body-content-type="text"',
    );
  },
);

Deno.test(
  'graph calendar (IT-APR-08): create with transactionId + extended property; update with If-Match',
  async () => {
    const { stub, calendarAdapter } = setupCalendar((call) => {
      if (call.method === 'POST')
        return jsonResponse(
          { id: 'AAMkNew', webLink: 'https://outlook.office365.com/owa/?itemid=AAMkNew' },
          201,
        );
      if (call.method === 'PATCH')
        return call.headers.get('If-Match') === 'W/"stale"'
          ? graphError(412, 'ErrorIrresolvableConflict')
          : jsonResponse({ id: 'AAMkEv1' });
      return undefined;
    });
    const c = ctx();
    const created = await calendarAdapter.createEvent(c, {
      providerCalendarId: 'cal-1',
      title: 'Mehmet ile toplantı',
      description: 'Teklif',
      start: { dateTime: '2026-09-25T07:00:00Z', timeZone: 'Europe/Istanbul' },
      end: { dateTime: '2026-09-25T08:00:00Z', timeZone: 'Europe/Istanbul' },
      location: 'Ofis',
      attendees: [
        { address: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' },
        { address: 'selin@ajans.example', name: null },
      ],
      sendUpdates: 'all',
      reminderMinutes: [15],
      marker: MARKER,
    });
    assertEquals(created, {
      kind: 'created',
      providerId: 'AAMkNew',
      webLink: 'https://outlook.office365.com/owa/?itemid=AAMkNew',
    });
    const body = JSON.parse(stub.calls[0]?.body ?? '{}') as Record<string, unknown>;
    assertEquals(body.transactionId, APPROVAL);
    assertEquals(body.singleValueExtendedProperties, [
      { id: DA_APPROVAL_PROPERTY_ID, value: APPROVAL },
    ]);
    assertEquals(
      [body.start, body.isAllDay, body.isReminderOn, body.reminderMinutesBeforeStart],
      [{ dateTime: '2026-09-25T07:00:00', timeZone: 'UTC' }, false, true, 15],
    );
    assertEquals((body.attendees as unknown[]).length, 2);

    await calendarAdapter.createEvent(c, {
      providerCalendarId: 'cal-1',
      title: 'İzin',
      description: null,
      start: { date: '2026-10-01' },
      end: { date: '2026-10-02' },
      location: null,
      attendees: [],
      sendUpdates: 'none',
      reminderMinutes: [],
      marker: MARKER,
    });
    const allDay = JSON.parse(stub.calls[1]?.body ?? '{}') as Record<string, unknown>;
    assertEquals(
      [allDay.isAllDay, allDay.start, allDay.body, allDay.isReminderOn],
      [true, { dateTime: '2026-10-01T00:00:00', timeZone: 'UTC' }, undefined, false],
    );

    const updated = await calendarAdapter.updateEvent(c, {
      providerCalendarId: 'cal-1',
      providerEventId: 'AAMkEv1',
      expectedEtag: 'W/"etag-1"',
      start: { dateTime: '2026-09-25T08:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-25T09:00:00Z', timeZone: 'UTC' },
      title: 'Ertelendi',
      location: null,
      sendUpdates: 'all',
      marker: MARKER,
    });
    assertEquals(updated, { kind: 'updated', providerId: 'AAMkEv1' });
    const patch = stub.calls[2]!;
    assertEquals(patch.headers.get('If-Match'), 'W/"etag-1"');
    const pbody = JSON.parse(patch.body ?? '{}') as Record<string, unknown>;
    assertEquals([pbody.subject, pbody.location], ['Ertelendi', { displayName: '' }]);
    assertEquals(pbody.singleValueExtendedProperties, [
      { id: DA_LAST_APPROVAL_PROPERTY_ID, value: APPROVAL },
    ]);

    const stale = await assertRejects(
      () =>
        calendarAdapter.updateEvent(c, {
          providerCalendarId: 'cal-1',
          providerEventId: 'AAMkEv1',
          expectedEtag: 'W/"stale"',
          sendUpdates: 'none',
          marker: MARKER,
        }),
      ProviderError,
    );
    assertEquals(stale.code, 'precondition_failed');
    await calendarAdapter.updateEvent(c, {
      providerCalendarId: 'cal-1',
      providerEventId: 'AAMkEv1',
      expectedEtag: null,
      sendUpdates: 'none',
      marker: MARKER,
    });
    assertEquals(stub.calls.at(-1)?.headers.get('If-Match'), null);
  },
);

Deno.test(
  'graph calendar (IT-APR-08): the replay probe finds our transactionId across pages',
  async () => {
    const { stub, calendarAdapter } = setupCalendar((_call, url) =>
      url.searchParams.get('$skiptoken') === 'p2'
        ? jsonResponse({
            value: [
              {
                id: 'AAMkOurs',
                transactionId: APPROVAL,
                webLink: 'https://outlook.office365.com/x',
              },
            ],
          })
        : jsonResponse({
            value: [
              { id: 'AAMkOther', transactionId: 'another' },
              { id: 'AAMkCancelled', transactionId: APPROVAL, isCancelled: true },
            ],
            '@odata.nextLink': `${BASE}/me/calendars/cal-1/calendarView?$skiptoken=p2`,
          }),
    );
    const around = { start: '2026-09-25T00:00:00Z', end: '2026-09-26T00:00:00Z' };
    assertEquals(await calendarAdapter.findEventByMarker(ctx(), 'cal-1', MARKER, around), {
      kind: 'already_exists',
      providerId: 'AAMkOurs',
      webLink: 'https://outlook.office365.com/x',
    });
    assertEquals(
      new URL(stub.calls[0]!.url).searchParams.get('$select'),
      'id,transactionId,webLink,isCancelled',
    );
    const none = setupCalendar(() => jsonResponse({ value: [] }));
    assertEquals(
      await none.calendarAdapter.findEventByMarker(ctx(), 'cal-1', MARKER, around),
      null,
    );
  },
);

Deno.test(
  'graph calendar: watches go through subscriptions on the calendar events resource',
  async () => {
    const { stub, calendarAdapter } = setupCalendar((call) =>
      call.method === 'POST' && !call.url.endsWith('/reauthorize')
        ? jsonResponse({ id: 'sub-c' }, 201)
        : call.method === 'PATCH'
          ? jsonResponse({})
          : new Response(null, { status: 204 }),
    );
    const c = ctx();
    const handle = await calendarAdapter.watch(c, 'cal-1');
    assertEquals(
      [handle.resource, handle.resourceKey, handle.providerResourceId],
      ['graph_calendar_view', 'cal-1', 'me/calendars/cal-1/events'],
    );
    assertEquals(
      Date.parse(handle.expiresAt) - NOW.getTime(),
      10_070 * 60_000,
      'the requested expiry when Graph omits one',
    );
    const renewed = await calendarAdapter.renewWatch(c, handle);
    assertEquals(renewed.watchId, 'sub-c');
    await calendarAdapter.reauthorizeWatch(c, handle);
    await calendarAdapter.stopWatch(c, handle);
    assertEquals(
      stub.calls.map((x) => x.method),
      ['POST', 'PATCH', 'POST', 'DELETE'],
    );
  },
);

// ── To Do ────────────────────────────────────────────────────────────────────

Deno.test(
  'graph to do (IT-SYNC-16): lists, task delta with @removed, date-only due, marker',
  async () => {
    assertEquals(
      normalizeTodoTask(
        {
          id: 't1',
          title: '  KDV beyannamesi  ',
          body: { content: 'Muhasebeye ilet' },
          status: 'notStarted',
          importance: 'High',
          dueDateTime: { dateTime: '2026-09-26T00:00:00.0000000', timeZone: 'UTC' },
          lastModifiedDateTime: '2026-09-23T12:00:00Z',
          linkedResources: [{ webUrl: 'https://x' }, { externalId: APPROVAL }],
        },
        'list-1',
      ),
      {
        providerTaskId: 't1',
        providerListId: 'list-1',
        title: 'KDV beyannamesi',
        notesSnippet: 'Muhasebeye ilet',
        status: 'open',
        due: { date: '2026-09-26' },
        completedAt: null,
        importance: 'high',
        updatedAt: '2026-09-23T12:00:00.000Z',
        daMarker: APPROVAL,
        deleted: false,
      },
    );
    const timed = normalizeTodoTask(
      {
        id: 't2',
        status: 'completed',
        importance: 'urgent',
        dueDateTime: { dateTime: '2026-09-26T09:30:00.0000000', timeZone: 'Europe/Istanbul' },
        completedDateTime: { dateTime: '2026-09-25T10:00:00Z' },
      },
      'l',
    );
    assertEquals(
      [timed.status, timed.due, timed.importance, timed.completedAt],
      [
        'completed',
        { dateTime: '2026-09-26T09:30:00.000Z', timeZone: 'Europe/Istanbul' },
        null,
        '2026-09-25T10:00:00.000Z',
      ],
    );

    const deltaLink = `${BASE}/me/todo/lists/list-1/tasks/delta?$deltatoken=d1`;
    const g = graph((_call, url) => {
      if (url.pathname.endsWith('/me/todo/lists'))
        return jsonResponse({
          value: [
            { id: 'list-1', displayName: 'Görevler', wellknownListName: 'defaultList' },
            { id: 'list-2', displayName: 'Alışveriş', wellknownListName: 'none' },
          ],
        });
      if (url.searchParams.get('$skiptoken') === 'p2')
        return jsonResponse({
          value: [{ id: 'old', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': deltaLink,
        });
      return jsonResponse({
        value: [{ id: 't1', title: 'KDV' }],
        '@odata.nextLink': `${BASE}/me/todo/lists/list-1/tasks/delta?$skiptoken=p2`,
      });
    });
    const graphTasks = new TodoAdapter(g.client);
    assertEquals(
      (await graphTasks.listTaskLists(ctx())).map((l) => [l.providerListId, l.isDefault]),
      [
        ['list-1', true],
        ['list-2', false],
      ],
    );
    const page1 = await graphTasks.changesSince(ctx(), 'list-1', null);
    assertEquals(new URL(g.stub.calls[1]!.url).pathname, '/v1.0/me/todo/lists/list-1/tasks/delta');
    assertEquals([page1.upserts.length, page1.pageToken?.includes('p2')], [1, true]);
    assertEquals(page1.nextCursor.kind, 'graph_todo_delta');
    const page2 = await graphTasks.changesSince(ctx(), 'list-1', null, page1.pageToken);
    assertEquals(
      [page2.deleted, page2.nextCursor.value, page2.pageToken],
      [['old'], deltaLink, null],
    );

    const expired = new TodoAdapter(graph(() => graphError(410, 'syncStateNotFound')).client);
    const e = await assertRejects(
      () => expired.changesSince(ctx(), 'list-1', { kind: 'graph_todo_delta', value: deltaLink }),
      ProviderError,
    );
    assertEquals(e.code, 'cursor_invalid');
    const denied = new TodoAdapter(graph(() => graphError(403, 'ErrorAccessDenied')).client);
    assertEquals(
      (await assertRejects(() => denied.changesSince(ctx(), 'l', null), ProviderError)).code,
      'scope_missing',
    );
  },
);

Deno.test(
  'graph to do (IT-APR-09): created tasks carry linkedResources; the probe finds the approval id',
  async () => {
    const g = graph((call, url) => {
      if (call.method === 'POST') return jsonResponse({ id: 'tNew' }, 201);
      if (url.searchParams.get('$skiptoken') === 'p2')
        return jsonResponse({
          value: [{ id: 'tOurs', linkedResources: [{ externalId: APPROVAL }] }],
        });
      return jsonResponse({
        value: [{ id: 'tOther', linkedResources: [] }],
        '@odata.nextLink': `${BASE}/me/todo/lists/list-1/tasks?$skiptoken=p2`,
      });
    });
    const graphTasks = new TodoAdapter(g.client);
    const c = ctx();
    assertEquals(
      await graphTasks.createTask(c, {
        providerListId: 'list-1',
        title: 'KDV beyannamesi',
        notes: 'Muhasebe',
        due: { date: '2026-09-26' },
        importance: 'high',
        marker: MARKER,
      }),
      {
        kind: 'created',
        providerId: 'tNew',
        webLink: null,
      },
    );
    const body = JSON.parse(g.stub.calls[0]?.body ?? '{}') as Record<string, unknown>;
    assertEquals(body.dueDateTime, { dateTime: '2026-09-26T00:00:00', timeZone: 'UTC' });
    assertEquals(body.linkedResources, [
      {
        webUrl: MARKER.deepLinkUrl,
        applicationName: 'Dijital Asistan',
        externalId: APPROVAL,
        displayName: 'Dijital Asistan onayı',
      },
    ]);
    await graphTasks.createTask(c, {
      providerListId: 'list-1',
      title: 'Ara',
      notes: null,
      due: { dateTime: '2026-09-26T09:00:00Z', timeZone: 'UTC' },
      importance: 'normal',
      marker: MARKER,
    });
    await graphTasks.createTask(c, {
      providerListId: 'list-1',
      title: 'Not',
      notes: null,
      due: null,
      importance: 'low',
      marker: MARKER,
    });
    const [, timed, none] = g.stub.calls.map(
      (x) => JSON.parse(x.body ?? '{}') as Record<string, unknown>,
    );
    assertEquals(
      [timed?.dueDateTime, none?.dueDateTime, none?.body],
      [{ dateTime: '2026-09-26T09:00:00', timeZone: 'UTC' }, undefined, undefined],
    );

    assertEquals(await graphTasks.findTaskByMarker(c, 'list-1', MARKER, '2026-09-24T07:25:00Z'), {
      kind: 'already_exists',
      providerId: 'tOurs',
      webLink: null,
    });
    const probe = new URL(g.stub.calls[3]!.url);
    assertEquals(probe.searchParams.get('$filter'), 'createdDateTime ge 2026-09-24T07:20:00.000Z');
    assertEquals(probe.searchParams.get('$expand'), 'linkedResources');
    const miss = new TodoAdapter(graph(() => jsonResponse({ value: [] })).client);
    assertEquals(await miss.findTaskByMarker(c, 'list-1', MARKER, '2026-09-24T07:25:00Z'), null);
  },
);

// ── Outlook mail ─────────────────────────────────────────────────────────────

function outlook(route: Route) {
  const g = graph(route);
  return { ...g, mail: new OutlookMailAdapter(g.client, g.subs) };
}

Deno.test('outlook mail: profile, counts, id pages and the 72 h delta baseline', async () => {
  const { stub, mail } = outlook((_call, url) => {
    if (url.pathname.endsWith('/me'))
      return jsonResponse({
        id: 'oid',
        mail: null,
        userPrincipalName: 'Yunus@Contoso.example',
        displayName: 'Yunus Kaya',
      });
    if (url.searchParams.get('$count') === 'true')
      return jsonResponse({ '@odata.count': 214, value: [] });
    return jsonResponse({
      value: [{ id: 'm1', conversationId: 'conv-1' }, { id: 'm2' }],
      '@odata.nextLink': `${BASE}/me/mailFolders/inbox/messages?$skip=50`,
    });
  });
  const c = ctx();
  const profile = await mail.getProfile(c);
  assertEquals(
    [profile.email, profile.displayName, profile.providerAccountId],
    ['yunus@contoso.example', 'Yunus Kaya', 'oid:tid'],
  );
  assertEquals(
    await mail.countMessages(c, {
      receivedAfter: '2026-09-21T07:30:00Z',
      receivedBefore: '2026-09-24T07:30:00Z',
      folder: 'sent',
    } as never),
    214,
  );
  const count = stub.calls[1]!;
  assertEquals(count.headers.get('ConsistencyLevel'), 'eventual');
  assertEquals(new URL(count.url).pathname, '/v1.0/me/mailFolders/sentitems/messages');
  assertEquals(
    new URL(count.url).searchParams.get('$filter'),
    'receivedDateTime ge 2026-09-21T07:30:00Z and receivedDateTime lt 2026-09-24T07:30:00Z',
  );
  const page = await mail.listMessageIds(c, { receivedAfter: '2026-09-21T07:30:00Z' } as never);
  assertEquals(page.items, [
    { id: 'm1', threadId: 'conv-1' },
    { id: 'm2', threadId: 'm2' },
  ]);
  assert(page.nextPageToken?.includes('$skip=50'));
  const baseline = await mail.baseline(c, 'sentitems');
  assertEquals(
    [baseline.kind, (baseline as { folder?: string }).folder],
    ['graph_delta', 'sentitems'],
  );
  assert(baseline.value.startsWith(`${BASE}/me/mailFolders/sentitems/messages/delta?`));
  assert(
    decodeURIComponent(baseline.value).includes('receivedDateTime ge 2026-09-21T07:30:00.000Z'),
  );
});

Deno.test(
  'outlook mail: batch metadata marks missing messages; bodies are capped; attachments sized',
  async () => {
    const bigHtml = `<p>${'Merhaba '.repeat(50)}</p>`;
    const { mail } = outlook((call, url) => {
      if (url.pathname.endsWith('/$batch')) {
        const body = JSON.parse(call.body ?? '{}') as { requests: { id: string }[] };
        return jsonResponse({
          responses: body.requests.map((r) =>
            r.id === '1'
              ? { id: '1', status: 404 }
              : {
                  id: r.id,
                  status: 200,
                  body: {
                    id: 'm0',
                    conversationId: 'conv',
                    subject: 'Teklif',
                    from: { emailAddress: { address: 'mehmet@yilmazendustri.example' } },
                    receivedDateTime: '2026-09-24T06:00:00Z',
                  },
                },
          ),
        });
      }
      if (url.pathname.includes('/attachments/'))
        return jsonResponse(
          url.pathname.endsWith('big')
            ? { size: 50_000_000 }
            : { contentBytes: btoa('PDF'), contentType: 'application/pdf', size: 3 },
        );
      return jsonResponse({
        body: { contentType: 'html', content: bigHtml },
        attachments: [
          {
            id: 'a1',
            name: 'teklif.pdf',
            contentType: 'application/pdf',
            size: 1200,
            isInline: false,
          },
          { id: 'a2' },
        ],
      });
    });
    const c = ctx();
    const meta = await mail.getMessagesMetadata(c, ['m0', 'm1']);
    assertEquals((meta[0] as { providerMessageId: string }).providerMessageId, 'm0');
    assertEquals(meta[1], { providerMessageId: 'm1', notFound: true });
    const body = await mail.getMessageBody(c, 'm0', { maxBytes: 100 });
    assertEquals(
      [body.truncated, (body.html ?? '').length <= 100, body.text.includes('Merhaba')],
      [true, true, true],
    );
    assertEquals(body.attachments, [
      {
        providerAttachmentId: 'a1',
        filename: 'teklif.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1200,
        inline: false,
      },
      {
        providerAttachmentId: 'a2',
        filename: '',
        mimeType: 'application/octet-stream',
        sizeBytes: 0,
        inline: false,
      },
    ]);
    const att = await mail.getAttachment(c, 'm0', 'a1', { maxBytes: 10_000 });
    assertEquals([new TextDecoder().decode(att.bytes), att.mimeType], ['PDF', 'application/pdf']);
    const e = await assertRejects(
      () => mail.getAttachment(c, 'm0', 'big', { maxBytes: 10_000 }),
      ProviderError,
    );
    assertEquals([e.code, e.providerReason], ['payload_invalid', 'attachment_too_large']);
    const plain = outlook(() =>
      jsonResponse({ body: { contentType: 'text', content: 'Düz metin' } }),
    );
    const p = await plain.mail.getMessageBody(c, 'm0', { maxBytes: 1000 });
    assertEquals([p.text, p.html, p.truncated, p.attachments], ['Düz metin', null, false, []]);
  },
);

Deno.test(
  'outlook mail (IT-SYNC-11/12): delta per folder with @removed; expired tokens re-baseline',
  async () => {
    const deltaLink = `${BASE}/me/mailFolders/inbox/messages/delta?$deltatoken=d2`;
    const { mail } = outlook(() =>
      jsonResponse({
        value: [
          {
            id: 'm1',
            conversationId: 'c1',
            subject: 'Fatura',
            from: { emailAddress: { address: 'efatura@enerjisa.com.tr' } },
            receivedDateTime: '2026-09-24T06:00:00Z',
          },
          { id: 'm0', '@removed': { reason: 'deleted' } },
        ],
        '@odata.deltaLink': deltaLink,
      }),
    );
    const cursor = {
      kind: 'graph_delta' as const,
      folder: 'inbox',
      value: `${BASE}/me/mailFolders/inbox/messages/delta`,
    };
    const set = await mail.changesSince(ctx(), cursor as never);
    assertEquals(
      [set.upserts.length, set.deleted, set.nextCursor, set.pageToken],
      [1, ['m0'], { kind: 'graph_delta', folder: 'inbox', value: deltaLink }, null],
    );
    for (const response of [
      graphError(410, 'SyncStateNotFound'),
      graphError(400, 'resyncRequired'),
    ]) {
      const expired = outlook(() => response.clone());
      const e = await assertRejects(
        () => expired.mail.changesSince(ctx(), cursor as never),
        ProviderError,
      );
      assertEquals(e.code, 'cursor_invalid');
    }
    const unavailable = outlook(() => graphError(503, 'ServiceUnavailable'));
    assertEquals(
      (
        await assertRejects(
          () => unavailable.mail.changesSince(ctx(), cursor as never),
          ProviderError,
        )
      ).code,
      'provider_unavailable',
    );
  },
);

Deno.test(
  'outlook mail (IT-APR-12): replies use /reply with the marker; the Sent Items probe and its fallback',
  async () => {
    let filterSupported = true;
    const { stub, mail } = outlook((call, url) => {
      if (call.method === 'POST') return new Response(null, { status: 202 });
      const filter = url.searchParams.get('$filter') ?? '';
      if (filter.startsWith('singleValueExtendedProperties')) {
        return filterSupported
          ? jsonResponse({ value: [] })
          : graphError(400, 'ErrorInvalidProperty');
      }
      return jsonResponse({
        value: [
          { id: 'sentX', bodyPreview: 'Başka bir yanıt' },
          {
            id: 'sentOurs',
            bodyPreview: 'Merhaba Mehmet Bey,  revize teklifi cuma gönderiyorum.',
            webLink: 'https://outlook.office365.com/sent',
          },
        ],
      });
    });
    const reply = {
      inReplyToProviderMessageId: 'AAMkOrig',
      providerThreadId: "conv-'1",
      originalRfc822MessageId: '<orig@yilmazendustri.example>',
      originalReferences: [],
      from: { address: 'yunus@contoso.example', name: 'Yunus' },
      to: [{ address: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' }],
      cc: [{ address: 'selin@ajans.example', name: null }],
      subject: 'Re: Teklif',
      bodyText: 'Merhaba Mehmet Bey, revize teklifi cuma gönderiyorum.',
      marker: MARKER,
    };
    const c = ctx();
    assertEquals(await mail.sendReply(c, reply), {
      kind: 'created',
      providerId: MARKER.rfc822MessageId,
      providerThreadId: "conv-'1",
      webLink: null,
    });
    const send = stub.calls[0]!;
    assert(
      new URL(send.url).pathname.endsWith('/me/messages/AAMkOrig/reply'),
      'reply, never createReply',
    );
    const sent = JSON.parse(send.body ?? '{}') as {
      comment: string;
      message: Record<string, unknown>;
    };
    assertEquals(sent.comment, reply.bodyText);
    assertEquals(sent.message.singleValueExtendedProperties, [
      { id: DA_APPROVAL_PROPERTY_ID, value: APPROVAL },
    ]);
    assertEquals(sent.message.ccRecipients, [{ emailAddress: { address: 'selin@ajans.example' } }]);

    assertEquals(await mail.findSentByMarker(c, MARKER, reply, '2026-09-24T07:29:00Z'), null);
    filterSupported = false;
    assertEquals(await mail.findSentByMarker(c, MARKER, reply, '2026-09-24T07:29:00Z'), {
      kind: 'already_exists',
      providerId: 'sentOurs',
      webLink: 'https://outlook.office365.com/sent',
    });
    const fallback = new URL(stub.calls.at(-1)!.url).searchParams.get('$filter');
    assertEquals(
      fallback,
      "conversationId eq 'conv-''1' and sentDateTime ge 2026-09-24T07:28:00.000Z",
    );
    assertEquals(
      mail.webLinkFor(c, {
        providerMessageId: 'm',
        providerThreadId: 't',
        webLink: 'https://outlook.office365.com/m',
      }),
      'https://outlook.office365.com/m',
    );

    const found = outlook(() =>
      jsonResponse({ value: [{ id: 'sentOurs', webLink: 'https://o/x' }] }),
    );
    assertEquals(
      (await found.mail.findSentByMarker(c, MARKER, reply, '2026-09-24T07:29:00Z'))?.providerId,
      'sentOurs',
    );
    const down = outlook(() => graphError(403, 'ErrorAccessDenied'));
    await assertRejects(
      () => down.mail.findSentByMarker(c, MARKER, reply, '2026-09-24T07:29:00Z'),
      ProviderError,
    );
  },
);

Deno.test('outlook mail (IT-SYNC-14): inbox and sent items subscriptions', async () => {
  const { stub, mail } = outlook((call) =>
    call.method === 'POST' && !call.url.endsWith('/reauthorize')
      ? jsonResponse({ id: 'sub-m', expirationDateTime: '2026-10-01T00:00:00Z' }, 201)
      : call.method === 'PATCH'
        ? jsonResponse({ expirationDateTime: '2026-10-02T00:00:00Z' })
        : new Response(null, { status: 204 }),
  );
  const c = ctx();
  const inbox = await mail.watch(c, 'inbox');
  const sent = await mail.watch(c, 'sentitems');
  assertEquals([inbox.resource, sent.resource], ['graph_mail_inbox', 'graph_mail_sentitems']);
  assertEquals(
    (JSON.parse(stub.calls[1]?.body ?? '{}') as { resource: string }).resource,
    "me/mailFolders('sentitems')/messages",
  );
  const renewed: WatchHandle = await mail.renewWatch(c, inbox);
  assertEquals(renewed.expiresAt, '2026-10-02T00:00:00Z');
  await mail.reauthorizeWatch(c, inbox);
  await mail.stopWatch(c, inbox);
  assertEquals(stub.calls.length, 5);
});
