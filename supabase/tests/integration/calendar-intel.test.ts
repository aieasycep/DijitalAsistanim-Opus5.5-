/**
 * Calendar and mail intelligence gaps through the real functions, PostgREST and the mock providers
 * (TEST_PLAN §6.3; KNOWN_PLATFORM_LIMITATIONS KPL-15, KPL-46; DESIGN_MAPPING DEV-41, DEV-46):
 * - IT-SYNC-19 cross-source merge: the same meeting through Google and Microsoft is one Plan item
 *   with both sources;
 * - IT-SYNC-20 attachment metadata: triage keeps names / types / sizes only, API-MAIL-09 lists them
 *   with refs, and a ref imports the PDF into a capture (tier A: Storage);
 * - IT-PLAN-01 / IT-PLAN-02 attendee availability: Google `freeBusy.query` after the progressive
 *   `calendar_freebusy` upgrade and Graph `getSchedule` under `Calendars.Read`; without the grant
 *   the options ask for the upgrade and no free/busy request is made.
 */
import { assert, assertEquals, assertExists } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  env,
  it,
  json,
  makePro,
  mock,
  one,
  q,
  releaseJobs,
  SUPABASE_URL,
  type TestUser,
} from './_harness/mod.ts';
import { connect } from './_harness/flows.ts';

const HOUR = 3_600_000;

/** An instant `ms` from now on a whole minute (providers report event times to the second). */
function isoIn(ms: number): string {
  return new Date(Math.floor((Date.now() + ms) / 60_000) * 60_000).toISOString();
}

/** The same instant as a Graph UTC wall time (`2026-10-05T11:00:00`, `timeZone: 'UTC'`). */
function utcWall(ms: number): string {
  return isoIn(ms).slice(0, 19);
}

async function rpc<T>(user: TestUser, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env('SUPABASE_ANON_KEY'),
      Authorization: `Bearer ${user.jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  assertEquals(res.status, 200, text);
  return JSON.parse(text) as T;
}

async function connectAndDrain(user: TestUser, provider: 'google' | 'microsoft', caps: string[]) {
  const { accountId } = await connect(user, provider, caps);
  await releaseJobs();
  await drain();
  return accountId;
}

// ── IT-SYNC-19 ───────────────────────────────────────────────────────────────────────────────

it(
  'IT-SYNC-19',
  'Cross-source merge: one meeting through Google and Outlook (same iCalUID) is one Plan item with both sources',
  async () => {
    const user = await createUser({ pro: true });
    const start = isoIn(26 * HOUR);
    const end = isoIn(27 * HOUR);
    await mock.google({
      op: 'events',
      events: [
        {
          id: 'evt0ortakmusteri',
          summary: 'Ortak müşteri toplantısı',
          iCalUID: 'ortak-42@acme.example',
          start: { dateTime: start, timeZone: 'Europe/Istanbul' },
          end: { dateTime: end, timeZone: 'Europe/Istanbul' },
          organizer: { email: 'ayse@acme.example' },
          attendees: [
            { email: 'yunus.demir@example.com', self: true, responseStatus: 'accepted' },
            { email: 'ayse@acme.example', organizer: true, responseStatus: 'accepted' },
          ],
        },
      ],
    });
    await mock.graph({
      op: 'events',
      events: [
        {
          id: 'AAMkEvtOrtak',
          subject: 'Ortak müşteri toplantısı',
          iCalUId: 'ORTAK-42@acme.example',
          start: { dateTime: start.slice(0, 19), timeZone: 'UTC' },
          end: { dateTime: end.slice(0, 19), timeZone: 'UTC' },
          isOrganizer: false,
          organizer: { emailAddress: { address: 'ayse@acme.example', name: 'Ayşe' } },
          attendees: [],
          showAs: 'busy',
        },
      ],
    });
    const google = await connectAndDrain(user, 'google', ['calendar_read']);
    const outlook = await connectAndDrain(user, 'microsoft', ['calendar_read']);
    const rows = await q<{
      id: string;
      connected_account_id: string;
      merged_into_id: string | null;
    }>(
      `select id, connected_account_id, merged_into_id from public.calendar_events
       where user_id = $1 and title = 'Ortak müşteri toplantısı' order by created_at`,
      [user.id],
    );
    assertEquals(rows.length, 2, JSON.stringify(rows));
    const canonical = rows.find((r) => r.merged_into_id === null);
    const duplicate = rows.find((r) => r.merged_into_id !== null);
    assertExists(canonical);
    assertExists(duplicate);
    assertEquals(duplicate.merged_into_id, canonical.id);
    assertEquals(new Set(rows.map((r) => r.connected_account_id)), new Set([google, outlook]));
    const items = await rpc<{ items: Record<string, unknown>[] }>(user, 'plan_range', {
      p_from: isoIn(20 * HOUR),
      p_to: isoIn(32 * HOUR),
    });
    const meeting = items.items.filter((i) => i.title === 'Ortak müşteri toplantısı');
    assertEquals(meeting.length, 1, 'the Plan shows the meeting once');
    const sources = meeting[0]?.sources as { event_id: string; provider: string }[];
    assertEquals(new Set(sources.map((s) => s.provider)), new Set(['google', 'microsoft']));
    assertEquals(sources[0]?.event_id, canonical.id, 'the canonical source comes first');
    // The duplicate id resolves to the canonical event for stale links.
    assertEquals(
      await rpc<string>(user, 'calendar_event_canonical_id', { p_event_id: duplicate.id }),
      canonical.id,
    );
  },
);

// ── IT-PLAN-01 / IT-PLAN-02 ──────────────────────────────────────────────────────────────────

async function conflictInsight(
  userId: string,
  a: string,
  b: string,
  provider: 'google' | 'microsoft',
): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into public.insights (user_id, kind, title, decision_tier, reason_code, entity_type, entity_id, dedupe_key,
                                  source_type, source_id, source_provider, source_timestamp, confidence, status,
                                  urgency, event_at)
     values ($1::uuid, 'conflict', 'Takvim çakışması', 'deterministic_signal', 'calendar_conflict', 'calendar_event',
             $2::uuid, 'conflict:calendar_event:' || $2::text || ':' || $2::text || ':' || $3::text || ':1:2',
             'calendar_event', $2::text, $4::public.provider, now(), 1, 'open', 'today',
             now() + interval '26 hours')
     returning id`,
    [userId, a, b, provider],
  );
  return row.id;
}

async function eventIds(userId: string): Promise<{ own: string; foreign: string }> {
  const own = await one<{ id: string }>(
    `select id from public.calendar_events where user_id = $1 and title = 'Teklif sunumu'`,
    [userId],
  );
  const foreign = await one<{ id: string }>(
    `select id from public.calendar_events where user_id = $1 and title = 'Müşteri ziyareti'`,
    [userId],
  );
  return { own: own.id, foreign: foreign.id };
}

const GOOGLE_CONFLICT = () => [
  {
    id: 'evt0teklifsunumu',
    summary: 'Teklif sunumu',
    start: { dateTime: isoIn(26 * HOUR), timeZone: 'Europe/Istanbul' },
    end: { dateTime: isoIn(27 * HOUR), timeZone: 'Europe/Istanbul' },
    organizer: { email: 'yunus.demir@example.com', self: true },
    attendees: [
      { email: 'yunus.demir@example.com', self: true, responseStatus: 'accepted' },
      { email: 'ayse@acme.example', displayName: 'Ayşe Kaya', responseStatus: 'accepted' },
      { email: 'dis@ornek.example', responseStatus: 'needsAction' },
    ],
  },
  {
    id: 'evt0musteriziyareti',
    summary: 'Müşteri ziyareti',
    start: { dateTime: isoIn(26.5 * HOUR), timeZone: 'Europe/Istanbul' },
    end: { dateTime: isoIn(27.5 * HOUR), timeZone: 'Europe/Istanbul' },
    organizer: { email: 'mehmet@yilmazendustri.example' },
  },
];

interface Option {
  kind: string;
  option_id: string;
  proposed_slot?: { start: string; end: string } | null;
  feasibility: {
    attendee_availability: string;
    availability_reason?: string;
    attendees?: { email: string; status: string; reason: string | null }[];
  };
}

it(
  'IT-PLAN-01',
  'Google free/busy: without the grant the options ask for the upgrade; after it, freeBusy.query states availability',
  async () => {
    const user = await createUser({ pro: true });
    await mock.google({ op: 'events', events: GOOGLE_CONFLICT() });
    await mock.google({
      op: 'freebusy',
      calendars: { 'ayse@acme.example': [{ start: isoIn(27.5 * HOUR), end: isoIn(29 * HOUR) }] },
    });
    const accountId = await connectAndDrain(user, 'google', ['calendar_read']);
    const { own, foreign } = await eventIds(user.id);
    const insightId = await conflictInsight(user.id, own, foreign, 'google');

    const before = await call('api', 'POST', `/plan/conflicts/${insightId}/options`, {
      jwt: user.jwt,
      body: {},
    });
    const first = (
      await json<{ data: { options: Option[]; availability_upgrade: unknown } }>(before)
    ).data;
    assertEquals(before.status, 200, JSON.stringify(first));
    assertEquals(first.availability_upgrade, {
      account_id: accountId,
      provider: 'google',
      capability: 'calendar_freebusy',
    });
    const blocked = first.options.find((o) => o.kind === 'move_event');
    assertEquals(blocked?.feasibility.availability_reason, 'scope_missing');
    assertEquals(
      (await mock.requests('/calendar/v3/freeBusy')).length,
      0,
      'never asked without the grant',
    );

    // The progressive upgrade (API-INT-02 → consent → API-INT-07) adds calendar.events.freebusy.
    await connect(user, 'google', ['calendar_freebusy']);
    const granted = await one<{ caps: string[] }>(
      `select capabilities_granted::text[] as caps from public.connected_accounts where id = $1`,
      [accountId],
    );
    assert(granted.caps.includes('calendar_freebusy'), granted.caps.join(','));
    // The options cached while the upgrade was pending are not reused once it is granted.
    const after = await call('api', 'POST', `/plan/conflicts/${insightId}/options`, {
      jwt: user.jwt,
      body: {},
    });
    const data = (await json<{ data: { options: Option[]; availability_upgrade: unknown } }>(after))
      .data;
    assertEquals(after.status, 200, JSON.stringify(data));
    assertEquals(data.availability_upgrade, null);
    const move = data.options.find((o) => o.kind === 'move_event');
    assertExists(move?.proposed_slot);
    assertEquals(move.feasibility.availability_reason, 'partial');
    assertEquals(
      move.feasibility.attendees?.map((a) => [a.email, a.status, a.reason]),
      [
        ['ayse@acme.example', 'free', null],
        ['dis@ornek.example', 'unknown', 'not_shared'],
      ],
    );
    // The chosen slot avoids Ayşe's busy block.
    const slotStart = Date.parse(move.proposed_slot.start);
    const slotEnd = Date.parse(move.proposed_slot.end);
    assert(
      slotEnd <= Date.parse(isoIn(27.5 * HOUR)) + 60_000 ||
        slotStart >= Date.parse(isoIn(29 * HOUR)) - 60_000,
      JSON.stringify(move.proposed_slot),
    );
    const requests = await mock.requests('/calendar/v3/freeBusy');
    assertEquals(requests.length, 1);
    const asked = JSON.parse(requests[0]?.body ?? '{}') as { items: { id: string }[] };
    assertEquals(
      asked.items.map((i) => i.id).sort(),
      ['ayse@acme.example', 'dis@ornek.example'],
      'only the other attendees are asked about',
    );
    // Resolving the move proposes exactly the shown slot.
    const resolved = await call('api', 'POST', `/plan/conflicts/${insightId}/resolve`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { option_id: move.option_id },
    });
    const approval = (await json<{ data: { approval: { id: string } } }>(resolved)).data.approval;
    assertEquals(resolved.status, 200);
    const payload = await one<{ t: { start: string; end: string } }>(
      `select payload -> 'changes' -> 'time' as t from public.approval_actions where id = $1`,
      [approval.id],
    );
    assertEquals([Date.parse(payload.t.start), Date.parse(payload.t.end)], [slotStart, slotEnd]);
  },
);

it(
  'IT-PLAN-02',
  'Graph getSchedule under Calendars.Read: busy attendees are named; outsiders are unknown',
  async () => {
    const user = await createUser({ pro: true });
    await mock.graph({
      op: 'events',
      events: [
        {
          id: 'AAMkEvtSunum',
          subject: 'Teklif sunumu',
          start: { dateTime: utcWall(26 * HOUR), timeZone: 'UTC' },
          end: { dateTime: utcWall(27 * HOUR), timeZone: 'UTC' },
          isOrganizer: true,
          organizer: { emailAddress: { address: 'yunus.demir@kuzeylojistik.example' } },
          attendees: [
            {
              emailAddress: { address: 'can@kuzeylojistik.example', name: 'Can' },
              status: { response: 'accepted' },
            },
            {
              emailAddress: { address: 'dis@ornek.example', name: 'Dış' },
              status: { response: 'none' },
            },
          ],
          showAs: 'busy',
        },
        {
          id: 'AAMkEvtZiyaret',
          subject: 'Müşteri ziyareti',
          start: { dateTime: utcWall(26.5 * HOUR), timeZone: 'UTC' },
          end: { dateTime: utcWall(27.5 * HOUR), timeZone: 'UTC' },
          isOrganizer: false,
          organizer: { emailAddress: { address: 'mehmet@yilmazendustri.example' } },
          attendees: [],
          showAs: 'busy',
        },
      ],
    });
    const accountId = await connectAndDrain(user, 'microsoft', ['calendar_read']);
    const caps = await one<{ caps: string[] }>(
      `select capabilities_granted::text[] as caps from public.connected_accounts where id = $1`,
      [accountId],
    );
    assert(caps.caps.includes('calendar_freebusy'), 'Calendars.Read covers getSchedule');
    // Can is busy for the whole search window: the move falls back to the user's own slot.
    await mock.graph({
      op: 'schedules',
      schedules: {
        'can@kuzeylojistik.example': [
          { status: 'busy', start: isoIn(20 * HOUR), end: isoIn(9 * 24 * HOUR) },
        ],
      },
    });
    const { own, foreign } = await eventIds(user.id);
    const insightId = await conflictInsight(user.id, own, foreign, 'microsoft');
    const res = await call('api', 'POST', `/plan/conflicts/${insightId}/options`, {
      jwt: user.jwt,
      body: {},
    });
    const data = (await json<{ data: { options: Option[] } }>(res)).data;
    assertEquals(res.status, 200, JSON.stringify(data));
    const move = data.options.find((o) => o.kind === 'move_event');
    assertExists(move?.proposed_slot);
    assertEquals(
      [move.feasibility.attendee_availability, move.feasibility.availability_reason],
      ['busy', 'partial'],
    );
    assertEquals(
      move.feasibility.attendees?.map((a) => [a.email, a.status, a.reason]),
      [
        ['can@kuzeylojistik.example', 'busy', null],
        ['dis@ornek.example', 'unknown', 'not_shared'],
      ],
    );
    const schedule = await mock.requests('/graph/v1.0/me/calendar/getSchedule');
    assertEquals(schedule.length, 1);
    assert((schedule[0]?.headers['prefer'] ?? '').includes('outlook.timezone="UTC"'));
  },
);

// ── IT-SYNC-20 ───────────────────────────────────────────────────────────────────────────────

const PDF_B64URL = 'JVBERi0xLjcKJeLjz9MK'; // "%PDF-1.7\n%âãÏÓ\n"

function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ATTACHMENT_MAIL = {
  id: '18f2a0c1d00000c1',
  threadId: '18f2a0c1d00000c1',
  labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
  snippet: 'Yunus Bey, sözleşmenin son hâli ekte. Cuma’ya kadar imzalayabilir misiniz?',
  internalDate: '0',
  internal_offset_minutes: -30,
  sizeEstimate: 60000,
  payload: {
    partId: '',
    mimeType: 'multipart/mixed',
    filename: '',
    headers: [
      { name: 'From', value: 'Mehmet Yılmaz <mehmet@yilmazendustri.example>' },
      { name: 'To', value: 'Yunus Demir <yunus.demir@example.com>' },
      { name: 'Subject', value: 'Hizmet Sözleşmesi v3 (imza)' },
      { name: 'Message-ID', value: '<18f2a0c1d00000c1@mail.example.com>' },
    ],
    body: { size: 0 },
    parts: [
      {
        partId: '0',
        mimeType: 'text/plain',
        filename: '',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
        body: {
          size: 90,
          data: b64url(
            'Yunus Bey, sözleşmenin son hâli ekte. Cuma’ya kadar imzalayabilir misiniz?',
          ),
        },
      },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'Hizmet_Sozlesmesi_v3.pdf',
        headers: [
          { name: 'Content-Disposition', value: 'attachment; filename="Hizmet_Sozlesmesi_v3.pdf"' },
        ],
        body: { size: 14, attachmentId: 'att-sozlesme-1' },
      },
      {
        partId: '2',
        mimeType: 'image/png',
        filename: 'imza.png',
        headers: [
          { name: 'Content-Disposition', value: 'inline' },
          { name: 'Content-ID', value: '<imza>' },
        ],
        body: { size: 800, attachmentId: 'att-imza' },
      },
    ],
  },
};

async function syncedAttachmentMail(user: TestUser): Promise<string> {
  await mock.google({ op: 'mailbox', messages: [ATTACHMENT_MAIL] });
  await mock.google({ op: 'attachment', id: 'att-sozlesme-1', data: PDF_B64URL });
  await connectAndDrain(user, 'google', ['mail_read']);
  const row = await one<{ id: string }>(
    `select id from public.email_messages where user_id = $1 and provider_message_id = $2`,
    [user.id, ATTACHMENT_MAIL.id],
  );
  return row.id;
}

it(
  'IT-SYNC-20',
  'Attachment metadata: triage keeps names, types and sizes only; API-MAIL-09 lists refs; the control gates it',
  async () => {
    const user = await createUser({ pro: true });
    const messageId = await syncedAttachmentMail(user);
    const stored = await one<{ meta: Record<string, unknown>[]; has: boolean }>(
      `select attachment_meta as meta, has_attachments as has from public.email_messages where id = $1`,
      [messageId],
    );
    assertEquals(stored.has, true);
    assertEquals(stored.meta, [
      {
        name: 'Hizmet_Sozlesmesi_v3.pdf',
        mime: 'application/pdf',
        size: 14,
        provider_attachment_id: 'att-sozlesme-1',
        kind: 'file',
      },
    ]);
    assertEquals(
      (await mock.requests('/gmail/v1/users/me/messages/')).filter((r) =>
        r.path.includes('/attachments/'),
      ).length,
      0,
      'sync never downloads an attachment',
    );
    const res = await call('api', 'GET', `/mail/${messageId}/attachments`, { jwt: user.jwt });
    const data = (
      await json<{
        data: { attachments: { attachment_ref: string; capturable: boolean; name: string }[] };
      }>(res)
    ).data;
    assertEquals(res.status, 200, JSON.stringify(data));
    assertEquals(res.headers.get('cache-control'), 'no-store');
    assertEquals(
      data.attachments.map((a) => [a.name, a.capturable]),
      [['Hizmet_Sozlesmesi_v3.pdf', true]],
    );
    assert(data.attachments[0]?.attachment_ref.startsWith(`v2.${messageId}.0.`));
    // Data Source Control off: listing is refused.
    await q(
      `update public.user_preferences set ai_data_access = ai_data_access || '{"attachments": false}' where user_id = $1`,
      [user.id],
    );
    const off = await call('api', 'GET', `/mail/${messageId}/attachments`, { jwt: user.jwt });
    assertEquals((await json<{ error: { code: string } }>(off)).error.code, 'DATA_SOURCE_DISABLED');
    assertEquals(
      await count(
        `select 1 from public.email_messages where user_id = $1 and attachment_meta::text like '%data%'`,
        [user.id],
      ),
      0,
      'no content is stored',
    );
  },
);

it(
  'IT-SYNC-20',
  'Attachment capture: a v2 ref imports the PDF through Gmail attachments.get into the private bucket',
  async () => {
    const user = await createUser({ pro: true });
    await makePro(user.id);
    const messageId = await syncedAttachmentMail(user);
    const list = await call('api', 'GET', `/mail/${messageId}/attachments`, { jwt: user.jwt });
    const ref = (await json<{ data: { attachments: { attachment_ref: string }[] } }>(list)).data
      .attachments[0]?.attachment_ref;
    assertExists(ref);
    const created = await call('api', 'POST', '/captures', {
      jwt: user.jwt,
      body: {
        client_capture_id: crypto.randomUUID(),
        share_origin: 'in_app',
        source: {
          kind: 'file',
          from_email_attachment: { email_message_id: messageId, attachment_ref: ref },
        },
      },
    });
    const capture = (await json<{ data: { id: string; kind: string } }>(created)).data;
    assertEquals(created.status, 201, JSON.stringify(capture));
    assertEquals(capture.kind, 'pdf');
    const downloads = (await mock.requests('/gmail/v1/users/me/messages/')).filter((r) =>
      r.path.endsWith('/attachments/att-sozlesme-1'),
    );
    assertEquals(downloads.length, 1);
    const row = await one<{ storage_path: string; mime_type: string }>(
      `select storage_path, mime_type from public.captures where id = $1`,
      [capture.id],
    );
    assert(row.storage_path.startsWith(`${user.id}/${capture.id}/`));
    assertEquals(row.mime_type, 'application/pdf');
  },
  { needs: ['storage'] },
);
