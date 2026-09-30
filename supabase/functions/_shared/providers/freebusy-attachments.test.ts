/**
 * Attendee availability and attachment metadata in the provider adapters over stubbed Google /
 * Graph APIs (no network): Google `freeBusy.query` and Graph `calendar/getSchedule` behind the
 * `CalendarProvider.freeBusy` contract (KNOWN_PLATFORM_LIMITATIONS KPL-46), the capability ↔
 * scope maps of `calendar_freebusy`, Gmail parts-only and Graph `messages/{id}/attachments`
 * metadata listing (API-MAIL-09), and the demo provider's deterministic free/busy.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { type ProviderContext, ProviderError } from '@da/domain';
import { jsonResponse, type RecordedCall, stubFetch } from '../testing/fetch.ts';
import { DemoCalendarAdapter } from './demo/calendar.ts';
import { PEOPLE } from './demo/fixtures/index.ts';
import { GoogleCalendarAdapter, normalizeGoogleFreeBusy } from './google/calendar.ts';
import { GOOGLE_ENDPOINTS } from './google/config.ts';
import { GmailAdapter } from './google/gmail.ts';
import { GMAIL_ATTACHMENT_FIELDS, gmailAttachments } from './google/mime.ts';
import { googleCapabilitiesFromScope, googleScopesFor } from './google/scopes.ts';
import { GraphCalendarAdapter, normalizeGraphSchedule } from './microsoft/calendar.ts';
import { microsoftCapabilitiesFromScope, microsoftScopesFor } from './microsoft/config.ts';
import { GraphClient } from './microsoft/graph.ts';
import { OutlookMailAdapter } from './microsoft/mail.ts';
import { GraphSubscriptions } from './microsoft/subscriptions.ts';

const NOW = new Date('2026-10-05T07:30:00.000Z');
const WINDOW = { start: '2026-10-05T12:00:00.000Z', end: '2026-10-12T12:00:00.000Z' };
const G = 'https://www.googleapis.com/auth/';

function ctx(provider: 'google' | 'microsoft' | 'demo' = 'google'): ProviderContext {
  return {
    account: {
      connectedAccountId: '55555555-5555-4555-8555-555555555555',
      userId: '11111111-1111-4111-8111-111111111111',
      provider,
      providerAccountId: 'sub',
      email: 'yunus@example.com',
      tenantId: null,
      tenantType: null,
      capabilitiesGranted: ['calendar_read', 'calendar_freebusy', 'mail_read'],
      dataSourceToggles: {} as ProviderContext['account']['dataSourceToggles'],
    },
    tokens: { get: () => Promise.resolve('token') },
    quota: { acquire: () => Promise.resolve() },
    clock: { now: () => NOW },
    log: { info() {}, warn() {}, error() {} },
    correlationId: 'test',
  };
}

type Route = (call: RecordedCall, url: URL) => Response | undefined;
function stub(route: Route) {
  return stubFetch(
    (call) => route(call, new URL(call.url)) ?? new Response('unexpected', { status: 599 }),
  );
}

// ── capability ↔ scope ──────────────────────────────────────────────────────────────────────

Deno.test(
  'scopes (KPL-46): calendar_freebusy is its own Google scope, never part of calendar_read',
  () => {
    assertEquals(googleScopesFor(['calendar_freebusy'], { includeIdentity: false }), [
      `${G}calendar.events.freebusy`,
    ]);
    assert(
      !googleScopesFor(['calendar_read'], { includeIdentity: false }).some((s) =>
        s.includes('freebusy'),
      ),
    );
    const read = googleCapabilitiesFromScope(
      `${G}calendar.events.readonly ${G}calendar.calendarlist.readonly ${G}calendar.settings.readonly`,
    );
    assert(read.includes('calendar_read') && !read.includes('calendar_freebusy'));
    assert(
      googleCapabilitiesFromScope(`${G}calendar.events.freebusy`).includes('calendar_freebusy'),
    );
    assert(googleCapabilitiesFromScope(`${G}calendar.readonly`).includes('calendar_freebusy'));
    // Graph getSchedule needs Calendars.Read, which calendar_read already holds.
    assertEquals(microsoftScopesFor(['calendar_freebusy'], { includeIdentity: false }), [
      'offline_access',
      'Calendars.Read',
    ]);
    assert(
      microsoftCapabilitiesFromScope('Calendars.Read offline_access').includes('calendar_freebusy'),
    );
    assert(!microsoftCapabilitiesFromScope('Mail.Read').includes('calendar_freebusy'));
  },
);

// ── Google freeBusy ─────────────────────────────────────────────────────────────────────────

Deno.test(
  'google freeBusy: one POST with the addresses, busy blocks, notFound → not_shared',
  async () => {
    const s = stub((call, url) => {
      if (call.method === 'POST' && url.pathname === '/calendar/v3/freeBusy') {
        return jsonResponse({
          kind: 'calendar#freeBusy',
          calendars: {
            'ayse@acme.com': {
              busy: [
                { start: '2026-10-05T13:00:00Z', end: '2026-10-05T14:00:00Z' },
                { start: 'bad', end: '2026-10-05T14:00:00Z' },
              ],
            },
            'dis@ornek.com': { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] },
            'grup@acme.com': { errors: [{ domain: 'global', reason: 'groupTooBig' }] },
          },
        });
      }
      return undefined;
    });
    const adapter = new GoogleCalendarAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: s.fetch, sleep: () => Promise.resolve() },
      webhook: null,
    });
    const answers = await adapter.freeBusy(ctx(), {
      emails: [
        'Ayse@Acme.com',
        'dis@ornek.com',
        'grup@acme.com',
        'kayip@acme.com',
        'ayse@acme.com',
      ],
      window: WINDOW,
    });
    assertEquals(s.calls.length, 1);
    const body = JSON.parse(s.calls[0]?.body ?? '{}') as {
      timeMin: string;
      timeMax: string;
      items: { id: string }[];
    };
    assertEquals([body.timeMin, body.timeMax], [WINDOW.start, WINDOW.end]);
    assertEquals(
      body.items.map((i) => i.id),
      ['ayse@acme.com', 'dis@ornek.com', 'grup@acme.com', 'kayip@acme.com'],
    );
    assertEquals(answers, [
      {
        email: 'ayse@acme.com',
        busy: [{ start: '2026-10-05T13:00:00.000Z', end: '2026-10-05T14:00:00.000Z' }],
        error: null,
      },
      { email: 'dis@ornek.com', busy: [], error: 'not_shared' },
      { email: 'grup@acme.com', busy: [], error: 'too_many' },
      { email: 'kayip@acme.com', busy: [], error: 'unavailable' },
    ]);
    assertEquals(await adapter.freeBusy(ctx(), { emails: [' '], window: WINDOW }), []);
    assertEquals(s.calls.length, 1);
  },
);

Deno.test(
  'google freeBusy: a grant without the free/busy scope surfaces as scope_missing',
  async () => {
    const s = stub(() =>
      jsonResponse(
        {
          error: {
            code: 403,
            message: 'redacted',
            errors: [{ reason: 'insufficientPermissions' }],
            status: 'PERMISSION_DENIED',
          },
        },
        403,
      ),
    );
    const adapter = new GoogleCalendarAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: s.fetch, sleep: () => Promise.resolve() },
      webhook: null,
    });
    const e = await assertRejects(
      () => adapter.freeBusy(ctx(), { emails: ['a@b.com'], window: WINDOW }),
      ProviderError,
    );
    assertEquals(e.code, 'scope_missing');
    assertEquals(normalizeGoogleFreeBusy(['x@y.com'], {}), [
      { email: 'x@y.com', busy: [], error: 'unavailable' },
    ]);
  },
);

// ── Graph getSchedule ───────────────────────────────────────────────────────────────────────

function graphCalendar(route: Route) {
  const s = stub(route);
  const client = new GraphClient({
    base: 'https://graph.microsoft.com/v1.0',
    http: { fetch: s.fetch, sleep: () => Promise.resolve() },
  });
  return {
    s,
    adapter: new GraphCalendarAdapter(client, new GraphSubscriptions(client, null)),
    client,
  };
}

Deno.test(
  'graph getSchedule: UTC window, busy/tentative/oof busy, per-schedule errors',
  async () => {
    const { s, adapter } = graphCalendar((call, url) => {
      if (call.method === 'POST' && url.pathname === '/v1.0/me/calendar/getSchedule') {
        return jsonResponse({
          value: [
            {
              scheduleId: 'Ayse@Acme.com',
              availabilityView: '000',
              scheduleItems: [
                {
                  status: 'busy',
                  start: { dateTime: '2026-10-05T13:00:00.0000000', timeZone: 'UTC' },
                  end: { dateTime: '2026-10-05T14:00:00.0000000', timeZone: 'UTC' },
                },
                {
                  status: 'free',
                  start: { dateTime: '2026-10-05T15:00:00.0000000', timeZone: 'UTC' },
                  end: { dateTime: '2026-10-05T16:00:00.0000000', timeZone: 'UTC' },
                },
                {
                  status: 'oof',
                  start: { dateTime: '2026-10-06T00:00:00Z', timeZone: 'UTC' },
                  end: { dateTime: '2026-10-07T00:00:00Z', timeZone: 'UTC' },
                },
              ],
            },
            {
              scheduleId: 'dis@ornek.com',
              error: { message: 'x', responseCode: 'ErrorNoFreeBusyAccess' },
            },
            {
              scheduleId: 'kayip@acme.com',
              error: { message: 'x', responseCode: 'ErrorMailRecipientNotFound' },
            },
            { scheduleId: 'view@acme.com', availabilityView: '0200' },
            { scheduleId: 'odd@acme.com', error: { responseCode: 'ErrorSomethingElse' } },
          ],
        });
      }
      return undefined;
    });
    const answers = await adapter.freeBusy(ctx('microsoft'), {
      emails: [
        'ayse@acme.com',
        'dis@ornek.com',
        'kayip@acme.com',
        'view@acme.com',
        'odd@acme.com',
        'yok@acme.com',
      ],
      window: WINDOW,
    });
    const call = s.calls[0];
    assert(call !== undefined);
    assert((call.headers.get('Prefer') ?? '').includes('outlook.timezone="UTC"'));
    const body = JSON.parse(call.body ?? '{}') as {
      schedules: string[];
      startTime: { dateTime: string; timeZone: string };
      availabilityViewInterval: number;
    };
    assertEquals(body.startTime, { dateTime: '2026-10-05T12:00:00.000', timeZone: 'UTC' });
    assertEquals(body.availabilityViewInterval, 15);
    assertEquals(body.schedules.length, 6);
    assertEquals(answers[0], {
      email: 'ayse@acme.com',
      busy: [
        { start: '2026-10-05T13:00:00.000Z', end: '2026-10-05T14:00:00.000Z' },
        { start: '2026-10-06T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z' },
      ],
      error: null,
    });
    assertEquals(answers[1]?.error, 'not_shared');
    assertEquals(answers[2]?.error, 'not_found');
    assertEquals(answers[3], {
      email: 'view@acme.com',
      busy: [{ start: '2026-10-05T12:15:00.000Z', end: '2026-10-05T12:30:00.000Z' }],
      error: null,
    });
    assertEquals(answers[4]?.error, 'unavailable');
    assertEquals(answers[5]?.error, 'unavailable');
    assertEquals(normalizeGraphSchedule(['a@b.c'], WINDOW, {}), [
      { email: 'a@b.c', busy: [], error: 'unavailable' },
    ]);
    assertEquals(await adapter.freeBusy(ctx('microsoft'), { emails: [], window: WINDOW }), []);
  },
);

// ── Attachment metadata ─────────────────────────────────────────────────────────────────────

Deno.test(
  'gmail listAttachments: a parts-only field mask; inline parts are marked, no body is read',
  async () => {
    const s = stub((_call, url) => {
      if (url.pathname.endsWith('/messages/m1')) {
        return jsonResponse({
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              { partId: '0', mimeType: 'text/plain', body: { size: 10 } },
              {
                partId: '1',
                mimeType: 'application/pdf',
                filename: 'Hizmet_Sozlesmesi_v3.pdf',
                headers: [{ name: 'Content-Disposition', value: 'attachment' }],
                body: { attachmentId: 'att-1', size: 48211 },
              },
              {
                partId: '2',
                mimeType: 'multipart/related',
                parts: [
                  {
                    partId: '2.1',
                    mimeType: 'image/png',
                    filename: 'logo.png',
                    headers: [{ name: 'Content-ID', value: '<logo>' }],
                    body: { attachmentId: 'att-2', size: 900 },
                  },
                ],
              },
            ],
          },
        });
      }
      return undefined;
    });
    const adapter = new GmailAdapter({
      endpoints: GOOGLE_ENDPOINTS,
      http: { fetch: s.fetch, sleep: () => Promise.resolve() },
      pubsubTopic: null,
    });
    const list = await adapter.listAttachments(ctx(), 'm1');
    const url = new URL(s.calls[0]?.url ?? '');
    assertEquals(url.searchParams.get('format'), 'full');
    assertEquals(url.searchParams.get('fields'), GMAIL_ATTACHMENT_FIELDS);
    assert(
      !GMAIL_ATTACHMENT_FIELDS.includes('body/data') && !GMAIL_ATTACHMENT_FIELDS.includes('data'),
    );
    assertEquals(list, [
      {
        providerAttachmentId: 'att-1',
        filename: 'Hizmet_Sozlesmesi_v3.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 48211,
        inline: false,
        kind: 'file',
      },
      {
        providerAttachmentId: 'att-2',
        filename: 'logo.png',
        mimeType: 'image/png',
        sizeBytes: 900,
        inline: true,
        kind: 'file',
      },
    ]);
    assertEquals(gmailAttachments(undefined), []);
  },
);

Deno.test(
  'outlook listAttachments: $select without contentBytes; item and reference kinds',
  async () => {
    const s = stub((_call, url) => {
      if (url.pathname.endsWith('/me/messages/AAMk1/attachments')) {
        return jsonResponse({
          value: [
            {
              '@odata.type': '#microsoft.graph.fileAttachment',
              id: 'A1',
              name: 'Teklif.PDF',
              contentType: 'Application/PDF',
              size: 1200,
              isInline: false,
            },
            {
              '@odata.type': '#microsoft.graph.itemAttachment',
              id: 'A2',
              name: 'Toplantı',
              size: 3,
            },
            {
              '@odata.type': '#microsoft.graph.referenceAttachment',
              id: 'A3',
              name: 'Paylaşılan klasör',
              isInline: false,
            },
          ],
        });
      }
      return undefined;
    });
    const client = new GraphClient({
      base: 'https://graph.microsoft.com/v1.0',
      http: { fetch: s.fetch, sleep: () => Promise.resolve() },
    });
    const mail = new OutlookMailAdapter(client, new GraphSubscriptions(client, null));
    const list = await mail.listAttachments(ctx('microsoft'), 'AAMk1');
    const url = new URL(s.calls[0]?.url ?? '');
    assertEquals(url.searchParams.get('$select'), 'id,name,contentType,size,isInline');
    assertEquals(
      list.map((a) => [a.providerAttachmentId, a.mimeType, a.kind]),
      [
        ['A1', 'application/pdf', 'file'],
        ['A2', 'application/octet-stream', 'item'],
        ['A3', 'application/octet-stream', 'reference'],
      ],
    );
  },
);

// ── Demo free/busy ──────────────────────────────────────────────────────────────────────────

Deno.test(
  'demo freeBusy: demo people are busy in their demo meetings; others are not shared',
  async () => {
    const adapter = new DemoCalendarAdapter({
      timeZone: () => Promise.resolve('Europe/Istanbul'),
      store: { demoState: () => Promise.resolve({}) } as never,
    });
    const window = { start: '2026-10-04T00:00:00.000Z', end: '2026-10-12T00:00:00.000Z' };
    const answers = await adapter.freeBusy(ctx('demo'), {
      emails: [PEOPLE.mehmet.email.toUpperCase(), 'yabanci@ornek.com'],
      window,
    });
    assertEquals(answers.length, 2);
    assertEquals(answers[0]?.email, PEOPLE.mehmet.email);
    assertEquals(answers[0]?.error, null);
    assert((answers[0]?.busy.length ?? 0) >= 1, 'Mehmet attends the demo customer meeting');
    for (const b of answers[0]?.busy ?? []) {
      assert(
        Date.parse(b.end) > Date.parse(window.start) &&
          Date.parse(b.start) < Date.parse(window.end),
      );
    }
    assertEquals(answers[1], { email: 'yabanci@ornek.com', busy: [], error: 'not_shared' });
  },
);
