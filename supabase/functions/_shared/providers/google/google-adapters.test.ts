/**
 * Google Calendar / Gmail / Tasks adapters over a stubbed Google API (response shapes per the
 * Calendar v3, Gmail v1 and Tasks v1 references; no network). TEST_PLAN IT-SYNC-01/02/03/04/07/
 * 08/09/10/16, IT-APR-01/06/07/09/11/13, CT-07; INTEGRATION_PLAN §4–§5.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { deriveMarker, type ProviderContext, ProviderError } from '@da/domain';
import { hmacSha256Base64Url, sha256Hex } from '../../crypto/hmac.ts';
import { jsonResponse, type RecordedCall, stubFetch } from '../../testing/fetch.ts';
import { GoogleCalendarAdapter, normalizeGoogleEvent } from './calendar.ts';
import { GOOGLE_ENDPOINTS } from './config.ts';
import { GmailAdapter, gmailQuery } from './gmail.ts';
import { GoogleTasksAdapter, normalizeGoogleTask } from './tasks.ts';

const NOW = new Date('2026-09-24T07:30:00.000Z');
const APPROVAL = '8f14e45f-ceea-4e67-a8c4-2b3e1d0f9a11';
const MARKER = deriveMarker(APPROVAL, 'approval:calendar_create:k1', {
  mailDomain: 'mail.dijitalasistan.app',
  webUrl: 'https://dijitalasistan.app',
});
const SECRET = 'webhook-hmac-secret-for-tests-0123456789';

function ctx(): ProviderContext {
  return {
    account: {
      connectedAccountId: '55555555-5555-4555-8555-555555555555',
      userId: '11111111-1111-4111-8111-111111111111',
      provider: 'google',
      providerAccountId: '1098765432109876543',
      email: 'yunus@gmail.com',
      tenantId: null,
      tenantType: null,
      capabilitiesGranted: [
        'mail_read',
        'mail_send',
        'calendar_read',
        'calendar_write',
        'tasks_read',
        'tasks_write',
      ],
      dataSourceToggles: {} as ProviderContext['account']['dataSourceToggles'],
    },
    tokens: { get: () => Promise.resolve('ya29.test-access-token') },
    quota: { acquire: () => Promise.resolve() },
    clock: { now: () => NOW },
    log: { info() {}, warn() {}, error() {} },
    correlationId: 'test',
  };
}

type Route = (call: RecordedCall, url: URL) => Response | undefined;
const http = (route: Route) => {
  const stub = stubFetch(
    (call) => route(call, new URL(call.url)) ?? new Response('unexpected', { status: 599 }),
  );
  return { stub, http: { fetch: stub.fetch, sleep: () => Promise.resolve() } };
};
const gError = (status: number, reason: string) =>
  jsonResponse(
    { error: { code: status, message: 'redacted', errors: [{ reason }], status: reason } },
    status,
  );

function calendar(route: Route, webhook = true) {
  const h = http(route);
  let n = 0;
  const adapter = new GoogleCalendarAdapter({
    endpoints: GOOGLE_ENDPOINTS,
    http: h.http,
    webhook: webhook
      ? {
          address: 'https://api.example.test/functions/v1/webhooks-google/calendar',
          hmacSecret: SECRET,
        }
      : null,
    newId: () => `channel-${String(++n)}`,
  });
  return { ...h, adapter };
}

// ── Calendar ─────────────────────────────────────────────────────────────────

Deno.test(
  'google calendar: event normalisation — video links vetted, attendees, private marker',
  () => {
    const e = normalizeGoogleEvent(
      {
        id: 'ev1',
        status: 'confirmed',
        summary: 'Yılmaz Endüstri teklif',
        description: 'Gündem '.repeat(200),
        start: { dateTime: '2026-09-24T12:00:00+03:00', timeZone: 'Europe/Istanbul' },
        end: { dateTime: '2026-09-24T13:00:00+03:00', timeZone: 'Europe/Istanbul' },
        attendees: [
          { email: 'Yunus@Gmail.com', self: true, responseStatus: 'accepted' },
          {
            email: 'mehmet@yilmazendustri.example',
            displayName: 'Mehmet Yılmaz',
            organizer: true,
            responseStatus: 'needsAction',
          },
        ],
        organizer: { email: 'mehmet@yilmazendustri.example', self: false },
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+90' },
            { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
          ],
        },
        etag: '"3181161784712000"',
        transparency: 'transparent',
        visibility: 'private',
        extendedProperties: { private: { da_approval_id: APPROVAL } },
        updated: '2026-09-23T10:00:00.000Z',
      } as never,
      'primary',
    );
    assertEquals(
      [e.start, e.conferenceUrl, e.transparency, e.visibility],
      [
        { dateTime: '2026-09-24T09:00:00.000Z', timeZone: 'Europe/Istanbul' },
        'https://meet.google.com/abc-defg-hij',
        'free',
        'private',
      ],
    );
    assert((e.descriptionSnippet?.length ?? 0) <= 500);
    assertEquals(
      e.attendees.map((a) => [a.email, a.responseStatus, a.isSelf, a.isOrganizer]),
      [
        ['yunus@gmail.com', 'accepted', true, false],
        ['mehmet@yilmazendustri.example', 'needs_action', false, true],
      ],
    );
    assertEquals(e.daApprovalId, APPROVAL);
    const cancelled = normalizeGoogleEvent(
      {
        id: 'ev2',
        status: 'cancelled',
        recurringEventId: 'series',
        originalStartTime: { date: '2026-09-25' },
        hangoutLink: 'https://evil.example/x',
      } as never,
      'primary',
    );
    assertEquals(
      [
        cancelled.status,
        cancelled.deleted,
        cancelled.start,
        cancelled.isOccurrence,
        cancelled.conferenceUrl,
      ],
      ['cancelled', true, { date: '2026-09-25' }, true, null],
    );
  },
);

Deno.test('google calendar: calendar list pages, kinds, colours and write rights', async () => {
  const { stub, adapter } = calendar((_c, url) =>
    url.searchParams.get('pageToken') === 'p2'
      ? jsonResponse({
          items: [
            {
              id: 'tr.turkish#holiday@group.v.calendar.google.com',
              summary: 'Türkiye tatilleri',
              accessRole: 'reader',
            },
            { id: 'addressbook#contacts@group.v.calendar.google.com', accessRole: 'reader' },
          ],
        })
      : jsonResponse({
          items: [
            {
              id: 'yunus@gmail.com',
              summary: 'Yunus',
              primary: true,
              accessRole: 'owner',
              backgroundColor: '#9fe1e7',
              timeZone: 'Europe/Istanbul',
            },
            {
              id: 'ekip@group.calendar.google.com',
              summary: 'Ekip',
              summaryOverride: 'Ekip Takvimi',
              accessRole: 'writer',
              backgroundColor: 'red',
            },
            { id: 'selin@ajans.example', accessRole: 'freeBusyReader', deleted: true },
          ],
          nextPageToken: 'p2',
        }),
  );
  const list = await adapter.listCalendars(ctx());
  assertEquals(
    list.map((c) => [c.name, c.kind, c.accessRole, c.canWrite, c.color, c.deleted]),
    [
      ['Yunus', 'default', 'owner', true, '#9fe1e7', false],
      ['Ekip Takvimi', 'other', 'writer', false, null, false],
      ['selin@ajans.example', 'shared', 'free_busy_reader', false, null, true],
      ['Türkiye tatilleri', 'holidays', 'reader', false, null, false],
      [
        'addressbook#contacts@group.v.calendar.google.com',
        'birthdays',
        'reader',
        false,
        null,
        false,
      ],
    ],
  );
  assertEquals(stub.calls.length, 2);
  assertEquals(new URL(stub.calls[0]!.url).searchParams.get('maxResults'), '250');
  const tz = calendar(() => jsonResponse({ value: 'Europe/Istanbul' }));
  assertEquals(await tz.adapter.getUserTimeZone(ctx()), 'Europe/Istanbul');
});

Deno.test(
  'google calendar (IT-SYNC-08/09): full sync pages to a syncToken; 410 forces a full resync',
  async () => {
    const window = { start: '2026-09-22T00:00:00.000Z', end: '2026-11-23T00:00:00.000Z' };
    const { stub, adapter } = calendar((_c, url) =>
      url.searchParams.get('pageToken') === 'p2'
        ? jsonResponse({ items: [{ id: 'gone', status: 'cancelled' }], nextSyncToken: 'sync-2' })
        : jsonResponse({
            items: [
              {
                id: 'ev1',
                status: 'confirmed',
                start: { date: '2026-09-25' },
                end: { date: '2026-09-26' },
              },
            ],
            nextPageToken: 'p2',
          }),
    );
    const first = await adapter.fullSync(ctx(), 'primary', window);
    const q = new URL(stub.calls[0]!.url).searchParams;
    assertEquals(
      [q.get('timeMin'), q.get('singleEvents'), q.get('maxResults'), q.get('syncToken')],
      [window.start, 'true', '250', null],
    );
    assert(q.get('fields')?.includes('extendedProperties/private'));
    assertEquals([first.upserts.length, first.pageToken, first.nextCursor], [1, 'p2', null]);
    const second = await adapter.fullSync(ctx(), 'primary', window, 'p2');
    assertEquals(
      [second.deleted, second.nextCursor],
      [['gone'], { kind: 'gcal_sync_token', value: 'sync-2', window }],
    );
    const inc = await adapter.changesSince(ctx(), 'primary', {
      kind: 'gcal_sync_token',
      value: 'sync-2',
    });
    assertEquals(new URL(stub.calls[2]!.url).searchParams.get('syncToken'), 'sync-2');
    assertEquals(
      [inc.nextCursor, inc.pageToken],
      [null, 'p2'],
      'the sync token arrives on the last page only',
    );

    const expired = calendar(() => gError(410, 'fullSyncRequired'));
    const e = await assertRejects(
      () =>
        expired.adapter.changesSince(ctx(), 'primary', { kind: 'gcal_sync_token', value: 'old' }),
      ProviderError,
    );
    assertEquals([e.code, e.providerReason], ['cursor_invalid', 'full_sync_required']);
    const denied = calendar(() => gError(403, 'insufficientPermissions'));
    assertEquals(
      (await assertRejects(() => denied.adapter.fullSync(ctx(), 'primary', window), ProviderError))
        .code,
      'scope_missing',
    );
  },
);

Deno.test(
  'google calendar: instances, single events (404/410 → null) and description excerpts',
  async () => {
    const { adapter } = calendar((_c, url) => {
      if (url.pathname.endsWith('/instances'))
        return jsonResponse({
          items: [
            { id: 'i1', start: { date: '2026-09-25' } },
            { id: 'i2', start: { date: '2026-10-02' } },
          ],
        });
      if (url.pathname.endsWith('/missing')) return gError(404, 'notFound');
      if (url.pathname.endsWith('/deleted')) return gError(410, 'deleted');
      if (url.pathname.endsWith('/nodesc')) return jsonResponse({ id: 'nodesc' });
      return jsonResponse({
        id: 'ev1',
        description: 'Açıklama '.repeat(50),
        start: { date: '2026-09-25' },
      });
    });
    const c = ctx();
    assertEquals(
      (await adapter.expandSeries(c, 'primary', 'series', { start: 'a', end: 'b' })).map(
        (e) => e.providerEventId,
      ),
      ['i1', 'i2'],
    );
    assertEquals((await adapter.getEvent(c, 'primary', 'ev1'))?.providerEventId, 'ev1');
    assertEquals(await adapter.getEvent(c, 'primary', 'missing'), null);
    assertEquals(await adapter.getEvent(c, 'primary', 'deleted'), null);
    assertEquals(
      (await adapter.getEventDescription(c, 'primary', 'ev1', { maxBytes: 40 }))?.length,
      40,
    );
    assertEquals(await adapter.getEventDescription(c, 'primary', 'nodesc', { maxBytes: 40 }), null);
    const broken = calendar(() => gError(500, 'backendError'));
    await assertRejects(() => broken.adapter.getEvent(c, 'primary', 'x'), ProviderError);
  },
);

Deno.test(
  'google calendar (IT-SYNC-10): channels carry an HMAC token (only its hash is kept); renewal overlaps',
  async () => {
    const { stub, adapter } = calendar((call, url) => {
      if (url.pathname.endsWith('/channels/stop'))
        return JSON.parse(call.body ?? '{}').id === 'gone'
          ? gError(404, 'notFound')
          : new Response(null, { status: 204 });
      const body = JSON.parse(call.body ?? '{}') as { id: string };
      return jsonResponse({
        id: body.id,
        resourceId: 'res-1',
        expiration: String(Date.parse('2026-10-01T07:30:00Z')),
      });
    });
    const c = ctx();
    const handle = await adapter.watch(c, 'primary');
    const body = JSON.parse(stub.calls[0]?.body ?? '{}') as Record<string, unknown>;
    const token = await hmacSha256Base64Url(SECRET, 'channel-1');
    assertEquals(
      [body.id, body.type, body.token, body.params],
      ['channel-1', 'web_hook', token, { ttl: '604800' }],
    );
    assertEquals(handle, {
      resource: 'google_calendar',
      resourceKey: 'primary',
      watchId: 'channel-1',
      providerResourceId: 'res-1',
      expiresAt: '2026-10-01T07:30:00.000Z',
      tokenHash: await sha256Hex(token),
    });
    const renewed = await adapter.renewWatch(c, handle);
    assertEquals(renewed.watchId, 'channel-2');
    assertEquals(
      stub.calls.map((x) => new URL(x.url).pathname.split('/').slice(-2).join('/')),
      ['events/watch', 'events/watch', 'channels/stop'],
      'the new channel exists before the old one stops',
    );
    assertEquals(JSON.parse(stub.calls[2]?.body ?? '{}'), { id: 'channel-1', resourceId: 'res-1' });
    await adapter.stopWatch(c, { ...handle, watchId: 'gone' });

    const noHook = calendar(() => undefined, false);
    assertEquals(
      (await assertRejects(() => noHook.adapter.watch(c, 'primary'), ProviderError)).code,
      'external_credential_required',
    );
  },
);

Deno.test(
  'google calendar (IT-APR-07/13): deterministic event id; sendUpdates only with attendees; 409 replay',
  async () => {
    let conflict = false;
    const { stub, adapter } = calendar((call, url) => {
      if (call.method === 'POST')
        return conflict
          ? gError(409, 'duplicate')
          : jsonResponse({
              id: MARKER.googleEventId,
              htmlLink: 'https://www.google.com/calendar/event?eid=x',
            });
      if (url.pathname.endsWith(`/events/${MARKER.googleEventId}`))
        return jsonResponse({
          id: MARKER.googleEventId,
          htmlLink: 'https://www.google.com/calendar/event?eid=y',
        });
      return undefined;
    });
    const c = ctx();
    const spec = {
      providerCalendarId: 'primary',
      title: 'Mehmet ile toplantı',
      description: 'Teklif',
      start: { dateTime: '2026-09-25T07:00:00.000Z', timeZone: 'Europe/Istanbul' },
      end: { dateTime: '2026-09-25T08:00:00.000Z', timeZone: 'Europe/Istanbul' },
      location: 'Ofis',
      attendees: [{ address: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' }],
      sendUpdates: 'all' as const,
      reminderMinutes: [30, 10],
      marker: MARKER,
    };
    assertEquals(await adapter.createEvent(c, spec), {
      kind: 'created',
      providerId: MARKER.googleEventId,
      webLink: 'https://www.google.com/calendar/event?eid=x',
    });
    const create = stub.calls[0]!;
    assertEquals(new URL(create.url).searchParams.get('sendUpdates'), 'all');
    const body = JSON.parse(create.body ?? '{}') as Record<string, unknown>;
    assertEquals(
      [body.id, body.extendedProperties],
      [MARKER.googleEventId, { private: { da_approval_id: APPROVAL } }],
    );
    assertEquals(body.reminders, {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 10 },
      ],
    });

    await adapter.createEvent(c, {
      ...spec,
      attendees: [],
      reminderMinutes: [],
      description: null,
      location: null,
      start: { date: '2026-10-01' },
      end: { date: '2026-10-02' },
    });
    const solo = stub.calls[1]!;
    assertEquals(
      new URL(solo.url).searchParams.get('sendUpdates'),
      'none',
      'no invitations without attendees',
    );
    const soloBody = JSON.parse(solo.body ?? '{}') as Record<string, unknown>;
    assertEquals(
      [soloBody.start, soloBody.reminders, soloBody.description],
      [{ date: '2026-10-01' }, { useDefault: true }, undefined],
    );

    conflict = true;
    assertEquals(await adapter.createEvent(c, spec), {
      kind: 'already_exists',
      providerId: MARKER.googleEventId,
      webLink: 'https://www.google.com/calendar/event?eid=y',
    });
  },
);

Deno.test(
  'google calendar (IT-APR-11): updates send If-Match; 412 is precondition_failed; non-organizer',
  async () => {
    const { stub, adapter } = calendar((call) => {
      if (call.headers.get('If-Match') === '"stale"') return gError(412, 'conditionNotMet');
      if (call.headers.get('If-Match') === '"guest"')
        return gError(403, 'forbiddenForNonOrganizer');
      return jsonResponse({ id: 'ev1' });
    });
    const c = ctx();
    const patch = {
      providerCalendarId: 'primary',
      providerEventId: 'ev1',
      expectedEtag: '"3181"',
      start: { dateTime: '2026-09-25T08:00:00.000Z', timeZone: null },
      end: { dateTime: '2026-09-25T09:00:00.000Z', timeZone: null },
      title: 'Ertelendi',
      location: null,
      sendUpdates: 'all' as const,
      marker: MARKER,
    };
    assertEquals(await adapter.updateEvent(c, patch as never), {
      kind: 'updated',
      providerId: 'ev1',
    });
    assertEquals(stub.calls[0]?.headers.get('If-Match'), '"3181"');
    const body = JSON.parse(stub.calls[0]?.body ?? '{}') as Record<string, unknown>;
    assertEquals(
      [body.summary, body.location, body.start, body.extendedProperties],
      [
        'Ertelendi',
        '',
        { dateTime: '2026-09-25T08:00:00.000Z' },
        { private: { da_last_approval_id: APPROVAL } },
      ],
    );
    const stale = await assertRejects(
      () => adapter.updateEvent(c, { ...patch, expectedEtag: '"stale"' } as never),
      ProviderError,
    );
    assertEquals(stale.code, 'precondition_failed');
    const guest = await assertRejects(
      () => adapter.updateEvent(c, { ...patch, expectedEtag: '"guest"' } as never),
      ProviderError,
    );
    assertEquals(guest.code, 'not_organizer');
    await adapter.updateEvent(c, {
      providerCalendarId: 'primary',
      providerEventId: 'ev1',
      expectedEtag: null,
      sendUpdates: 'none',
      marker: MARKER,
    });
    assertEquals(stub.calls.at(-1)?.headers.get('If-Match'), null);
  },
);

Deno.test(
  'google calendar (IT-APR-07): the replay probe tries the deterministic id, then the update marker',
  async () => {
    const { stub, adapter } = calendar((_c, url) => {
      if (url.pathname.endsWith(`/events/${MARKER.googleEventId}`))
        return jsonResponse({ id: MARKER.googleEventId, status: 'cancelled' });
      return jsonResponse({
        items: [
          { id: 'evX', status: 'cancelled' },
          { id: 'evUpdated', status: 'confirmed', htmlLink: 'https://g/u' },
        ],
      });
    });
    const around = { start: '2026-09-25T00:00:00Z', end: '2026-09-26T00:00:00Z' };
    assertEquals(await adapter.findEventByMarker(ctx(), 'primary', MARKER, around), {
      kind: 'already_exists',
      providerId: 'evUpdated',
      webLink: 'https://g/u',
    });
    assertEquals(
      new URL(stub.calls[1]!.url).searchParams.get('privateExtendedProperty'),
      `da_last_approval_id=${APPROVAL}`,
    );
    const direct = calendar(() => jsonResponse({ id: MARKER.googleEventId, status: 'confirmed' }));
    assertEquals(
      (await direct.adapter.findEventByMarker(ctx(), 'primary', MARKER, around))?.providerId,
      MARKER.googleEventId,
    );
    const none = calendar((_c, url) =>
      url.pathname.endsWith(`/events/${MARKER.googleEventId}`)
        ? gError(404, 'notFound')
        : jsonResponse({}),
    );
    assertEquals(await none.adapter.findEventByMarker(ctx(), 'primary', MARKER, around), null);
  },
);

// ── Gmail ────────────────────────────────────────────────────────────────────

const unix = (iso: string) => String(Date.parse(iso) / 1000);
const b64url = (s: string) =>
  btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function gmail(route: Route, topic: string | null = 'projects/da-test/topics/gmail-push') {
  const h = http(route);
  return {
    ...h,
    adapter: new GmailAdapter({ endpoints: GOOGLE_ENDPOINTS, http: h.http, pubsubTopic: topic }),
  };
}

Deno.test(
  'gmail (IT-SYNC-01): search query, id pages, count across pages, profile history id',
  async () => {
    assertEquals(
      gmailQuery({
        receivedAfter: '2026-09-21T07:30:00Z',
        receivedBefore: '2026-09-24T07:30:00Z',
        folder: 'inbox',
        excludeBulkCategories: true,
        fromAnyOf: ['mehmet@yilmazendustri.example', 'selin@ajans.example'],
      } as never),
      `in:inbox after:${unix('2026-09-21T07:30:00Z')} before:${unix('2026-09-24T07:30:00Z')} -category:promotions -category:social -category:forums from:(mehmet@yilmazendustri.example OR selin@ajans.example) -in:chats`,
    );
    assertEquals(
      gmailQuery({ receivedAfter: '2026-09-21T07:30:00Z', folder: 'sent' } as never),
      `in:sent after:${unix('2026-09-21T07:30:00Z')} -in:chats`,
    );
    const { stub, adapter } = gmail((_c, url) => {
      if (url.pathname.endsWith('/profile'))
        return jsonResponse({ emailAddress: 'Yunus@Gmail.com', historyId: '987654' });
      return url.searchParams.get('pageToken') === 'p2'
        ? jsonResponse({ messages: [{ id: 'm3', threadId: 't2' }] })
        : jsonResponse({
            messages: [
              { id: 'm1', threadId: 't1' },
              { id: 'm2', threadId: 't1' },
            ],
            nextPageToken: 'p2',
          });
    });
    const c = ctx();
    assertEquals(
      await adapter.countMessages(c, {
        receivedAfter: '2026-09-21T07:30:00Z',
        folder: 'inbox',
      } as never),
      3,
    );
    assertEquals(new URL(stub.calls[0]!.url).searchParams.get('maxResults'), '500');
    const profile = await adapter.getProfile(c);
    assertEquals([profile.email, profile.mailboxCursorHint], ['yunus@gmail.com', '987654']);
    assertEquals(await adapter.baseline(c), { kind: 'gmail_history', value: '987654' });
    const noHistory = gmail(() => jsonResponse({ emailAddress: 'yunus@gmail.com' }));
    assertEquals(
      (await assertRejects(() => noHistory.adapter.baseline(c), ProviderError)).code,
      'mailbox_unavailable',
    );
  },
);

Deno.test(
  'gmail (IT-SYNC-01): metadata only with the header list; a vanished message is notFound',
  async () => {
    const { stub, adapter } = gmail((_c, url) =>
      url.pathname.endsWith('/gone')
        ? gError(404, 'notFound')
        : jsonResponse({
            id: 'm1',
            threadId: 't1',
            labelIds: ['INBOX', 'UNREAD'],
            snippet: 'Merhaba',
            internalDate: String(Date.parse('2026-09-24T06:00:00Z')),
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Mehmet Yılmaz <mehmet@yilmazendustri.example>' },
                { name: 'Subject', value: 'Teklif' },
              ],
            },
          }),
    );
    const out = await adapter.getMessagesMetadata(ctx(), ['m1', 'gone']);
    assertEquals((out[0] as { providerMessageId: string }).providerMessageId, 'm1');
    assertEquals(out[1], { providerMessageId: 'gone', notFound: true });
    const q = new URL(stub.calls[0]!.url).searchParams;
    assertEquals(q.get('format'), 'metadata');
    assert(q.getAll('metadataHeaders').includes('From'));
    const failing = gmail(() => gError(500, 'backendError'));
    await assertRejects(() => failing.adapter.getMessagesMetadata(ctx(), ['m1']), ProviderError);
  },
);

Deno.test(
  'gmail: full bodies are fetched interactively and capped; attachments are size-checked',
  async () => {
    const b64 = b64url;
    const { stub, adapter } = gmail((_c, url) => {
      if (url.pathname.includes('/attachments/'))
        return jsonResponse(
          url.pathname.endsWith('big') ? { size: 30_000_000 } : { data: b64('%PDF-1.7'), size: 8 },
        );
      return jsonResponse({
        id: 'm1',
        payload: { mimeType: 'text/plain', body: { data: b64('Fatura tutarı 1.250,50 TL') } },
      });
    });
    const c = ctx();
    const body = await adapter.getMessageBody(c, 'm1', { maxBytes: 1000 });
    assertEquals(body.text.includes('1.250,50 TL'), true);
    assertEquals(new URL(stub.calls[0]!.url).searchParams.get('format'), 'full');
    const att = await adapter.getAttachment(c, 'm1', 'a1', { maxBytes: 1000 });
    assertEquals(new TextDecoder().decode(att.bytes), '%PDF-1.7');
    const e = await assertRejects(
      () => adapter.getAttachment(c, 'm1', 'big', { maxBytes: 1000 }),
      ProviderError,
    );
    assertEquals(e.providerReason, 'attachment_too_large');
  },
);

Deno.test(
  'gmail (IT-SYNC-02/03/04): history → new ids, label changes, trash as delete; 404 → cursor_invalid',
  async () => {
    const { stub, adapter } = gmail(() =>
      jsonResponse({
        history: [
          {
            messagesAdded: [
              { message: { id: 'new1', labelIds: ['INBOX', 'UNREAD'] } },
              { message: { id: 'chat', labelIds: ['CHAT'] } },
            ],
          },
          { messagesAdded: [{ message: { id: 'sent1', labelIds: ['SENT'] } }] },
          {
            labelsAdded: [{ message: { id: 'old1', labelIds: ['INBOX'] }, labelIds: ['STARRED'] }],
          },
          {
            labelsRemoved: [
              { message: { id: 'old2', labelIds: ['INBOX', 'UNREAD'] }, labelIds: ['IMPORTANT'] },
            ],
          },
          {
            labelsAdded: [{ message: { id: 'binned', labelIds: ['TRASH'] }, labelIds: ['TRASH'] }],
          },
          { messagesDeleted: [{ message: { id: 'sent1' } }] },
        ],
        historyId: '1000',
        nextPageToken: 'hp2',
      }),
    );
    const set = await adapter.changesSince(ctx(), { kind: 'gmail_history', value: '900' });
    const q = new URL(stub.calls[0]!.url).searchParams;
    assertEquals(
      [q.get('startHistoryId'), q.getAll('historyTypes')],
      ['900', ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']],
    );
    assertEquals(set.needsMetadata, ['new1']);
    assertEquals(set.deleted.sort(), ['binned', 'sent1']);
    assertEquals(set.labelChanges, [
      { providerMessageId: 'old1', labels: ['INBOX'], isRead: true },
      { providerMessageId: 'old2', labels: ['INBOX', 'UNREAD'], isRead: false },
    ]);
    assertEquals(
      [set.nextCursor, set.pageToken],
      [{ kind: 'gmail_history', value: '1000' }, 'hp2'],
    );

    const expired = gmail(() => gError(404, 'notFound'));
    const e = await assertRejects(
      () => expired.adapter.changesSince(ctx(), { kind: 'gmail_history', value: '1' }),
      ProviderError,
    );
    assertEquals([e.code, e.providerReason], ['cursor_invalid', 'history_id_expired']);
    const quiet = gmail(() => jsonResponse({}));
    assertEquals(
      (await quiet.adapter.changesSince(ctx(), { kind: 'gmail_history', value: '5' })).nextCursor
        .value,
      '5',
    );
  },
);

Deno.test(
  'gmail (IT-SYNC-07): watch on INBOX+SENT to the Pub/Sub topic; renew re-watches; stop',
  async () => {
    const { stub, adapter } = gmail((_c, url) =>
      url.pathname.endsWith('/stop')
        ? new Response(null, { status: 204 })
        : jsonResponse({
            historyId: '555',
            expiration: String(Date.parse('2026-10-01T07:30:00Z')),
          }),
    );
    const c = ctx();
    const handle = await adapter.watch(c, 'mailbox');
    assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
      topicName: 'projects/da-test/topics/gmail-push',
      labelIds: ['INBOX', 'SENT'],
      labelFilterBehavior: 'include',
    });
    assertEquals(
      [handle.watchId, handle.providerResourceId, handle.expiresAt, handle.tokenHash],
      [`gmail:${c.account.connectedAccountId}`, '555', '2026-10-01T07:30:00.000Z', null],
    );
    assertEquals((await adapter.renewWatch(c, handle)).expiresAt, '2026-10-01T07:30:00.000Z');
    await adapter.stopWatch(c);
    assertEquals(stub.calls.length, 3);
    const noTopic = gmail(() => undefined, null);
    assertEquals(
      (await assertRejects(() => noTopic.adapter.watch(c, 'mailbox'), ProviderError)).code,
      'external_credential_required',
    );
  },
);

Deno.test(
  'gmail (IT-APR-01/06): the reply MIME threads correctly; replay found by rfc822msgid or body',
  async () => {
    const b64 = (s: string) =>
      btoa(unescape(encodeURIComponent(s)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    let byId = false;
    const { stub, adapter } = gmail((_call, url) => {
      if (url.pathname.endsWith('/messages/send'))
        return jsonResponse({ id: 'sent1', threadId: 'thread-9' });
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('rfc822msgid:'))
        return jsonResponse(byId ? { messages: [{ id: 'sentA', threadId: 'thread-9' }] } : {});
      if (q.startsWith('in:sent'))
        return jsonResponse({
          messages: [
            { id: 'other', threadId: 't' },
            { id: 'sentB', threadId: 'thread-9' },
          ],
        });
      if (url.pathname.endsWith('/messages/other'))
        return jsonResponse({
          payload: { mimeType: 'text/plain', body: { data: b64('Başka bir metin') } },
        });
      return jsonResponse({
        payload: {
          mimeType: 'text/plain',
          body: { data: b64('Merhaba Mehmet Bey,\n\nrevize teklifi cuma gönderiyorum.') },
        },
      });
    });
    const reply = {
      inReplyToProviderMessageId: 'm1',
      providerThreadId: 'thread-9',
      originalRfc822MessageId: '<CAB123@mail.yilmazendustri.example>',
      originalReferences: ['<CAA000@mail.yilmazendustri.example>'],
      from: { address: 'yunus@gmail.com', name: 'Yunus Kaya' },
      to: [{ address: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' }],
      cc: [],
      subject: 'Re: "Teklif"',
      bodyText: 'Merhaba Mehmet Bey, revize teklifi cuma gönderiyorum.',
      marker: MARKER,
    };
    const c = ctx();
    const sent = await adapter.sendReply(c, reply);
    assertEquals(
      [sent.kind, sent.providerId, (sent as { providerThreadId?: string }).providerThreadId],
      ['created', 'sent1', 'thread-9'],
    );
    assert((sent as { webLink?: string | null }).webLink?.includes('#all/thread-9'));
    const payload = JSON.parse(stub.calls[0]?.body ?? '{}') as { raw: string; threadId: string };
    assertEquals(payload.threadId, 'thread-9');
    const mime = decodeURIComponent(
      escape(atob(payload.raw.replace(/-/g, '+').replace(/_/g, '/'))),
    );
    assert(mime.includes('In-Reply-To: <CAB123@mail.yilmazendustri.example>'));
    assert(
      mime.includes(
        'References: <CAA000@mail.yilmazendustri.example> <CAB123@mail.yilmazendustri.example>',
      ),
    );
    assert(mime.includes(`Message-ID: ${MARKER.rfc822MessageId}`));

    byId = true;
    assertEquals(
      (await adapter.findSentByMarker(c, MARKER, reply, '2026-09-24T07:29:00Z'))?.providerId,
      'sentA',
    );
    const idQuery = new URL(stub.calls.at(-1)!.url).searchParams;
    assertEquals(
      [idQuery.get('q'), idQuery.get('includeSpamTrash')],
      [`rfc822msgid:${MARKER.rfc822MessageId.replace(/[<>]/g, '')}`, 'true'],
    );
    byId = false;
    assertEquals(
      (await adapter.findSentByMarker(c, MARKER, reply, '2026-09-24T07:29:00Z'))?.providerId,
      'sentB',
    );
    const subjectQuery = stub.calls
      .map((x) => new URL(x.url).searchParams.get('q'))
      .find((x) => x?.startsWith('in:sent'));
    assertEquals(
      subjectQuery,
      `in:sent after:${String(Date.parse('2026-09-24T07:29:00Z') / 1000 - 60)} subject:"Re: Teklif"`,
    );
    const none = gmail(() => jsonResponse({}));
    assertEquals(
      await none.adapter.findSentByMarker(c, MARKER, reply, '2026-09-24T07:29:00Z'),
      null,
    );
  },
);

// ── Tasks ────────────────────────────────────────────────────────────────────

function tasks(route: Route) {
  const h = http(route);
  return { ...h, adapter: new GoogleTasksAdapter({ endpoints: GOOGLE_ENDPOINTS, http: h.http }) };
}

Deno.test(
  'google tasks (IT-SYNC-16): updatedMin = last − 60 s; old completed skipped on first sync',
  async () => {
    const { stub, adapter } = tasks((_c, url) =>
      url.pathname.endsWith('/users/@me/lists')
        ? jsonResponse({
            items: [
              { id: 'l1', title: 'Görevlerim' },
              { id: 'l2', title: 'Alışveriş' },
            ],
          })
        : jsonResponse({
            items: [
              {
                id: 't1',
                title: 'KDV beyannamesi',
                status: 'needsAction',
                due: '2026-09-26T00:00:00.000Z',
                notes: `Muhasebe\n\n${MARKER.textMarker}`,
              },
              {
                id: 't2',
                title: 'Eski iş',
                status: 'completed',
                completed: '2026-07-01T00:00:00.000Z',
              },
              { id: 't3', title: 'Silinen', deleted: true },
            ],
            nextPageToken: 'tp2',
          }),
    );
    const c = ctx();
    assertEquals(
      (await adapter.listTaskLists(c)).map((l) => [l.providerListId, l.isDefault]),
      [
        ['l1', true],
        ['l2', false],
      ],
    );
    const first = await adapter.changesSince(c, 'l1', null);
    assertEquals(
      first.upserts.map((t) => [t.providerTaskId, t.due, t.daMarker]),
      [['t1', { date: '2026-09-26' }, MARKER.textMarker]],
    );
    assertEquals(
      [first.deleted, first.pageToken, first.nextCursor],
      [['t3'], 'tp2', { kind: 'gtasks_updated_min', value: NOW.toISOString() }],
    );
    assertEquals(new URL(stub.calls[1]!.url).searchParams.get('updatedMin'), null);
    const next = await adapter.changesSince(
      c,
      'l1',
      { kind: 'gtasks_updated_min', value: '2026-09-24T07:00:00.000Z' },
      'tp2',
    );
    const q = new URL(stub.calls[2]!.url).searchParams;
    assertEquals(
      [q.get('updatedMin'), q.get('showDeleted'), q.get('pageToken')],
      ['2026-09-24T06:59:00.000Z', 'true', 'tp2'],
    );
    assertEquals(next.upserts.length, 2, 'incremental syncs keep completed tasks');
    assertEquals(
      normalizeGoogleTask(
        { id: 'x', status: 'completed', completed: '2026-09-20T10:00:00.000Z' } as never,
        'l',
      ).status,
      'completed',
    );
  },
);

Deno.test(
  'google tasks (IT-APR-09): the text marker goes into notes; the probe finds it before insert',
  async () => {
    const { stub, adapter } = tasks((call, url) => {
      if (call.method === 'POST')
        return jsonResponse({ id: 'tNew', webViewLink: 'https://tasks.google.com/task/tNew' });
      return url.searchParams.get('pageToken') === 'p2'
        ? jsonResponse({
            items: [
              {
                id: 'tOurs',
                notes: `Not\n\n${MARKER.textMarker}`,
                webViewLink: 'https://tasks.google.com/task/tOurs',
              },
            ],
          })
        : jsonResponse({
            items: [
              { id: 'tDel', deleted: true, notes: MARKER.textMarker },
              { id: 'tOther', notes: 'x' },
            ],
            nextPageToken: 'p2',
          });
    });
    const c = ctx();
    assertEquals(
      await adapter.createTask(c, {
        providerListId: 'l1',
        title: 'KDV',
        notes: 'Muhasebe',
        due: { dateTime: '2026-09-26T09:00:00Z', timeZone: 'UTC' },
        importance: 'high',
        marker: MARKER,
      }),
      {
        kind: 'created',
        providerId: 'tNew',
        webLink: 'https://tasks.google.com/task/tNew',
      },
    );
    assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
      title: 'KDV',
      notes: `Muhasebe\n\n${MARKER.textMarker}`,
      due: '2026-09-26T00:00:00.000Z',
    });
    await adapter.createTask(c, {
      providerListId: 'l1',
      title: 'Ara',
      notes: null,
      due: null,
      importance: 'normal',
      marker: MARKER,
    });
    assertEquals(JSON.parse(stub.calls[1]?.body ?? '{}'), {
      title: 'Ara',
      notes: MARKER.textMarker,
    });
    assertEquals(await adapter.findTaskByMarker(c, 'l1', MARKER, '2026-09-24T07:25:00Z'), {
      kind: 'already_exists',
      providerId: 'tOurs',
      webLink: 'https://tasks.google.com/task/tOurs',
    });
    assertEquals(
      new URL(stub.calls[2]!.url).searchParams.get('updatedMin'),
      '2026-09-24T07:20:00.000Z',
    );
    const none = tasks(() => jsonResponse({ items: [] }));
    assertEquals(
      await none.adapter.findTaskByMarker(c, 'l1', MARKER, '2026-09-24T07:25:00Z'),
      null,
    );
  },
);
