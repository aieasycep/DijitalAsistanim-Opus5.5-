/**
 * GAP-3 · calendar and mail intelligence on mobile: conflict options state attendee availability
 * only as the provider answered it and offer the `calendar_freebusy` upgrade (KPL-46, DEV-46);
 * the Today AI card shows one conflict or schedule suggestion with the Plan actions and is not
 * repeated as a priority card (DEV-68); mail attachments go to capture from the file sheet and the
 * mail detail through a fresh API-MAIL-09 ref (M-CAP-03, M-MAIL-03, DEV-41/47); merged calendar
 * events name every source and a link to a merged duplicate opens its canonical event (KPL-15).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../src/lib/clock';
import { resetDraftForTests } from '../src/features/capture/draft';
import {
  attachmentCandidates,
  attachmentErrorKey,
  attachmentMime,
} from '../src/features/capture/mailAttachments';
import { AttachmentGoneError } from '../src/features/capture/flows';
import { availabilityLine } from '../src/features/plan/ConflictScreen';
import { aiInsightOf } from '../src/features/today/TodayAiCard';
import type { TodayPriority } from '../src/features/today/data';
import { ApiError } from '@da/api-client';
import { json, renderApp, resetAppState } from './helpers/app';
import { M3, captureView } from './helpers/assist';
import { googleAccount, ok, TS, uuid } from './helpers/fixtures';
import { events, openApp, proBootstrap } from './helpers/journeys';
import { emptyTodayOverview, type PostgrestFake } from './helpers/postgrest';
import { setup } from './m2/harness';

// 09:30 in Istanbul on Thursday 24 September 2026.
jest.mock('../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const DAY = '2026-09-24';
const ACCOUNT = googleAccount.id;
const INSIGHT = uuid(700);
const SUGGESTION = uuid(701);
const PROPOSAL = uuid(702);
const OTHER = uuid(703);
const EVENT = uuid(704);
const DUPLICATE = uuid(705);
const MESSAGE = uuid(706);
const MESSAGE2 = uuid(707);
const REF = `v2.${MESSAGE}.0.1790000000.${'a'.repeat(32)}`;

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT,
    provider: 'google',
    account_email: 'ahmet@example.com',
    display_label: null,
    status: 'healthy',
    status_reason: null,
    capabilities_granted: ['mail_read', 'calendar_read'],
    granted_scopes: [],
    data_source_toggles: googleAccount.data_sources,
    last_sync_at: TS,
    last_error_code: null,
    updated_at: TS,
    created_at: TS,
    ...overrides,
  };
}

function priority(overrides: Record<string, unknown> = {}) {
  return {
    id: INSIGHT,
    kind: 'conflict',
    urgency: 'today',
    title: 'Müşteri toplantısı ile doktor randevusu çakışıyor',
    body: '14:00 · iki etkinlik aynı saatte',
    why_important: null,
    decision_tier: 'deterministic',
    entity_type: 'calendar_event',
    entity_id: EVENT,
    due_at: null,
    event_at: '2026-09-24T11:00:00Z',
    user_corrected: false,
    source: null,
    ...overrides,
  };
}

const REPLY = {
  ...priority({
    id: OTHER,
    kind: 'reply_needed',
    urgency: 'urgent',
    title: 'Teklif onayı bekleniyor',
    body: null,
    entity_type: null,
    entity_id: null,
    event_at: null,
  }),
};

const CONFLICT = {
  conflict: {
    insight_id: INSIGHT,
    events: [
      {
        id: EVENT,
        title: 'Müşteri toplantısı',
        start: '2026-09-24T11:00:00Z',
        end: '2026-09-24T12:00:00Z',
        is_organizer: true,
        attendee_count: 3,
      },
      {
        id: OTHER,
        title: 'Doktor randevusu',
        start: '2026-09-24T11:30:00Z',
        end: '2026-09-24T12:00:00Z',
        is_organizer: false,
        attendee_count: 1,
      },
    ],
  },
  options: [
    {
      option_id: 'move:a',
      kind: 'move_event',
      title: 'Etkinliği taşı',
      description: 'Müşteri toplantısı, Perşembe 15:00–16:00 aralığına taşınır.',
      feasibility: {
        organizer: true,
        attendee_availability: 'busy',
        availability_reason: 'partial',
        attendees: [
          { email: 'ayse@example.com', name: 'Ayşe Demir', status: 'busy', reason: null },
          { email: 'can@partner.example', name: null, status: 'unknown', reason: 'not_shared' },
        ],
      },
      proposed_slot: { start: '2026-09-24T12:00:00Z', end: '2026-09-24T13:00:00Z' },
      side_effects: [],
      requires_capability: 'calendar_write',
      pro_required: true,
    },
    {
      option_id: 'keep',
      kind: 'ignore',
      title: 'Böyle kalsın',
      description: 'Çakışma olduğu gibi kalır.',
      feasibility: {
        organizer: true,
        attendee_availability: 'unknown',
        availability_reason: 'not_applicable',
      },
      side_effects: [],
      requires_capability: null,
      pro_required: true,
    },
  ],
  availability_upgrade: {
    account_id: ACCOUNT,
    provider: 'google',
    capability: 'calendar_freebusy',
  },
};

beforeEach(async () => {
  await resetAppState();
  resetDraftForTests();
});

describe('attendee availability line (KPL-46)', () => {
  const t = (key: string, values?: Record<string, string>) =>
    values === undefined ? key : `${key}:${JSON.stringify(values)}`;

  it('names busy attendees, says when everyone is free and why it is unknown', () => {
    expect(
      availabilityLine(
        {
          attendee_availability: 'busy',
          availability_reason: 'checked',
          attendees: [
            { email: 'a@x.example', name: 'Ayşe', status: 'busy' },
            { email: 'b@x.example', name: null, status: 'busy' },
          ],
        },
        t,
      ),
    ).toBe('availability.busyNames:{"names":"Ayşe, b@x.example"}');
    expect(
      availabilityLine({ attendee_availability: 'free', availability_reason: 'checked' }, t),
    ).toBe('availability.free');
    expect(
      availabilityLine(
        { attendee_availability: 'unknown', availability_reason: 'scope_missing' },
        t,
      ),
    ).toBe('availability.scope_missing');
    expect(
      availabilityLine(
        { attendee_availability: 'unknown', availability_reason: 'device_calendar' },
        t,
      ),
    ).toBe('availability.device_calendar');
  });

  it('says nothing for options that set no new time or have no other attendees', () => {
    expect(
      availabilityLine(
        { attendee_availability: 'unknown', availability_reason: 'not_applicable' },
        t,
      ),
    ).toBeNull();
    expect(
      availabilityLine(
        { attendee_availability: 'free', availability_reason: 'no_other_attendees' },
        t,
      ),
    ).toBeNull();
    expect(availabilityLine({ attendee_availability: 'unknown' }, t)).toBeNull();
  });
});

describe('M-PLAN-07 · conflict options with availability', () => {
  it('shows who is busy and starts the free/busy upgrade for the event account', async () => {
    await openApp({
      data: proBootstrap(),
      path: `/plan/conflict/${INSIGHT}`,
      routes: {
        [`POST /plan/conflicts/${INSIGHT}/options`]: () => json(200, ok(CONFLICT)),
      },
    });
    const move = await screen.findByTestId('conflict.option.move_event');
    expect(within(move).getByText(/Bu saatte meşgul: Ayşe Demir/)).toBeOnTheScreen();
    expect(screen.getByTestId('conflict.availabilityUpgrade')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('conflict.availability.upgrade'));
    expect(await screen.findByTestId('m2.scope')).toBeOnTheScreen();
    expect(events('scope_upgrade_view').at(-1)?.props).toEqual({
      capability: 'calendar_freebusy',
      provider: 'google',
    });
  });
});

async function openToday(priorities: readonly unknown[], routes = {}) {
  return openApp({
    data: proBootstrap(),
    routes,
    setup: (db: PostgrestFake) => {
      db.setRpc('today_overview', () => ({
        data: { ...emptyTodayOverview(DAY), hero_count: priorities.length, priorities },
        error: null,
      }));
      db.setRpc('set_insight_status', () => ({ data: null, error: null }));
    },
  });
}

describe('DEV-68 · Today AI card', () => {
  it('picks the first conflict or schedule suggestion', () => {
    const rows = [REPLY, priority(), priority({ id: SUGGESTION, kind: 'schedule_suggestion' })];
    expect(aiInsightOf(rows as TodayPriority[])?.id).toBe(INSIGHT);
    expect(aiInsightOf([REPLY] as TodayPriority[])).toBeNull();
  });

  it('shows the conflict once, above the priorities, and opens its options', async () => {
    const { router } = await openToday([REPLY, priority()], {
      [`POST /plan/conflicts/${INSIGHT}/options`]: () => json(200, ok(CONFLICT)),
    });
    const card = await screen.findByTestId('today.aiCard');
    expect(
      within(card).getByText('Müşteri toplantısı ile doktor randevusu çakışıyor'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`today.card.${INSIGHT}`)).toBeNull();
    expect(screen.getByTestId(`today.card.${OTHER}`)).toBeOnTheScreen();
    expect(screen.getByText('1 konu')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Seçenekleri Gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/conflict/${INSIGHT}`);
    });
    expect(events('priority_action').at(-1)?.props).toEqual({ kind: 'conflict', action: 'open' });
  });

  it('keeps the conflict with the undo toast', async () => {
    await openToday([priority()]);
    const card = await screen.findByTestId('today.aiCard');
    expect(screen.queryByTestId('today.empty')).toBeNull();
    await fireEvent.press(within(card).getByText('Böyle Kalsın'));
    await waitFor(() => {
      expect(screen.queryByTestId('today.aiCard')).toBeNull();
    });
    expect(await screen.findByText('Tamam, böyle kalıyor.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Geri al'));
    expect(await screen.findByTestId('today.aiCard')).toBeOnTheScreen();
    expect(events('priority_undo').at(-1)?.props).toEqual({ action: 'dismiss' });
  });

  it('opens the linked proposal of a schedule suggestion', async () => {
    const { router } = await openToday([
      priority({
        id: SUGGESTION,
        kind: 'schedule_suggestion',
        title: 'Teklif hazırlığı için yarın 10:00 boş',
        entity_type: 'approval_action',
        entity_id: PROPOSAL,
      }),
    ]);
    const card = await screen.findByTestId('today.aiCard');
    await fireEvent.press(within(card).getByText('Planla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${PROPOSAL}`);
    });
  });

  it('asks for a proposal when the suggestion has none yet', async () => {
    const { api } = await openToday(
      [
        priority({
          id: SUGGESTION,
          kind: 'schedule_suggestion',
          entity_type: null,
          entity_id: null,
        }),
      ],
      {
        'POST /plan/proposals': () =>
          json(409, {
            error: { code: 'STATE_CONFLICT', message: 'no slot', details: {} },
            meta: { correlation_id: 'corr-1', request_id: 'req-1', server_time: TS },
          }),
      },
    );
    const card = await screen.findByTestId('today.aiCard');
    await fireEvent.press(within(card).getByText('Planla'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/plan/proposals'))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/plan/proposals'))?.body).toMatchObject({
      item: { type: 'insight', id: SUGGESTION },
      duration_minutes: 60,
    });
    expect(await screen.findByText(/boş zaman/i)).toBeOnTheScreen();
  });
});

function mailRow(id: string, attachments: readonly unknown[], received = TS) {
  return {
    id,
    connected_account_id: ACCOUNT,
    from_name: 'Mehmet Yılmaz',
    from_email: 'mehmet@yilmaz.example',
    received_at: received,
    has_attachments: true,
    provider_deleted_at: null,
    attachment_meta: attachments,
  };
}

const SOZLESME = {
  name: 'Hizmet_Sozlesmesi_v3.pdf',
  mime: 'application/pdf',
  size: 480_000,
  kind: 'file',
};

describe('mail attachment candidates', () => {
  it('keeps only files the capture pipeline accepts', () => {
    const rows = [
      mailRow(MESSAGE, [
        SOZLESME,
        { name: 'dev.pdf', mime: 'application/pdf', size: 30 * 1024 * 1024, kind: 'file' },
        { name: 'Toplantı', mime: 'message/rfc822', size: 1000, kind: 'item' },
        { name: 'rapor.docx', mime: 'application/vnd.openxmlformats', size: 1000 },
        { name: 'fis.JPG', mime: 'application/octet-stream', size: 1000 },
        { name: 'bozuk' },
        'değil',
      ]),
    ];
    const candidates = attachmentCandidates(rows);
    expect(candidates.map((c) => [c.name, c.index, c.mime])).toEqual([
      ['Hizmet_Sozlesmesi_v3.pdf', 0, 'application/pdf'],
      ['fis.JPG', 4, 'image/jpeg'],
    ]);
    expect(attachmentMime('a.bin', undefined)).toBe('application/octet-stream');
  });

  it('maps import failures to their messages', () => {
    const error = (code: string) =>
      new ApiError({ code: code as 'SOURCE_GONE', kind: 'server', status: 410, message: code });
    expect(attachmentErrorKey(new AttachmentGoneError())).toBe('errors.attachmentGone');
    expect(attachmentErrorKey(error('SOURCE_GONE'))).toBe('errors.attachmentGone');
    expect(attachmentErrorKey(error('DATA_SOURCE_DISABLED'))).toBe('errors.attachmentsOff');
    expect(attachmentErrorKey(error('PROVIDER_REAUTH_REQUIRED'))).toBe('errors.reconnect');
    expect(attachmentErrorKey(error('PAYLOAD_TOO_LARGE'))).toBe('errors.tooLarge');
    expect(attachmentErrorKey(error('UNSUPPORTED_MEDIA_TYPE'))).toBe('errors.unsupported');
    expect(attachmentErrorKey(new Error('x'))).toBe('errors.uploadFailed');
  });
});

const LISTING = {
  message_id: MESSAGE,
  attachments: [
    {
      attachment_ref: REF,
      name: SOZLESME.name,
      mime: 'application/pdf',
      size_bytes: SOZLESME.size,
      capturable: true,
      blocked_reason: null,
    },
  ],
  source: 'stored',
  refs_expire_at: '2026-09-24T07:30:00Z',
};

const analyzed = () =>
  json(
    202,
    ok({
      capture: captureView({ status: 'analyzing' }),
      job: { job_id: M3.job, status: 'queued', poll_after_ms: 1000 },
    }),
  );

describe('M-CAP-03 · mail attachments in the file sheet', () => {
  it('imports the selected attachment through its ref and opens the capture', async () => {
    const { api, router } = await openApp({
      data: proBootstrap(),
      path: '/capture?kind=pdf',
      setup: (db) => {
        db.setTable('connected_accounts', [accountRow()]);
        db.setTable('email_messages', [
          mailRow(MESSAGE, [SOZLESME]),
          mailRow(MESSAGE2, [{ name: 'Toplantı', mime: 'message/rfc822', size: 1, kind: 'item' }]),
        ]);
      },
      routes: {
        [`GET /mail/${MESSAGE}/attachments`]: () => json(200, ok(LISTING)),
        'POST /captures': () => json(201, ok(captureView())),
        [`POST /captures/${M3.capture}/analyze`]: analyzed,
      },
    });
    expect(
      await screen.findByText("Son dosyalar · Mail eklerinden ve Dosyalar'dan"),
    ).toBeOnTheScreen();
    const row = await screen.findByTestId(`capture.files.mail.${MESSAGE}:0`);
    expect(screen.queryByTestId(`capture.files.mail.${MESSAGE2}:0`)).toBeNull();
    expect(screen.queryByTestId('capture.files.analyze')).toBeNull();
    await fireEvent.press(row);
    await fireEvent.press(await screen.findByTestId('capture.files.analyze'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/capture/${M3.capture}`);
    });
    expect(api.calls.find((c) => c.url.endsWith('/captures'))?.body).toMatchObject({
      share_origin: 'in_app',
      source: {
        kind: 'file',
        from_email_attachment: { email_message_id: MESSAGE, attachment_ref: REF },
      },
    });
    expect(api.calls.some((c) => c.url.endsWith(`/captures/${M3.capture}/analyze`))).toBe(true);
    expect(events('capture_file_pick').at(-1)?.props).toEqual({
      origin: 'mail_attachment',
      kind: 'pdf',
    });
  });

  it('says when the listed file is gone and stays on the sheet', async () => {
    const { api } = await openApp({
      data: proBootstrap(),
      path: '/capture?kind=pdf',
      setup: (db) => {
        db.setTable('connected_accounts', [accountRow()]);
        db.setTable('email_messages', [mailRow(MESSAGE, [SOZLESME])]);
      },
      routes: {
        [`GET /mail/${MESSAGE}/attachments`]: () =>
          json(
            200,
            ok({ ...LISTING, attachments: [{ ...LISTING.attachments[0], name: 'x.pdf' }] }),
          ),
      },
    });
    await fireEvent.press(await screen.findByTestId(`capture.files.mail.${MESSAGE}:0`));
    await fireEvent.press(await screen.findByTestId('capture.files.analyze'));
    expect(await screen.findByText('Bu ek artık mailde bulunamadı.')).toBeOnTheScreen();
    expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/captures'))).toBe(false);
  });

  it('shows the empty line when recent mails hold no importable file', async () => {
    await openApp({
      data: proBootstrap(),
      path: '/capture?kind=pdf',
      setup: (db) => {
        db.setTable('connected_accounts', [accountRow()]);
        db.setTable('email_messages', [mailRow(MESSAGE, [])]);
      },
    });
    expect(await screen.findByTestId('capture.files.mailEmpty')).toBeOnTheScreen();
  });

  it('hides mail attachments when "Ekleri analiz et" is off', async () => {
    await openApp({
      data: proBootstrap(),
      path: '/capture?kind=pdf',
      setup: (db) => {
        db.setTable('connected_accounts', [
          accountRow({
            data_source_toggles: { ...googleAccount.data_sources, attachments_analyze: false },
          }),
        ]);
        db.setTable('email_messages', [mailRow(MESSAGE, [SOZLESME])]);
      },
    });
    expect(await screen.findByTestId('capture.files.device')).toBeOnTheScreen();
    expect(screen.getByText('Cihazındaki dosyalardan')).toBeOnTheScreen();
    expect(screen.queryByTestId('capture.files.mail')).toBeNull();
  });
});

describe('M-MAIL-03 · attachment to capture', () => {
  const detailRow = {
    id: MESSAGE,
    thread_id: uuid(708),
    connected_account_id: ACCOUNT,
    provider: 'google',
    direction: 'inbound',
    from_name: 'Mehmet Yılmaz',
    from_email: 'mehmet@yilmaz.example',
    to_emails: ['ahmet@example.com'],
    cc_emails: [],
    received_at: TS,
    subject: 'Sözleşme',
    ai_summary: null,
    key_points: [],
    ai_status: 'done',
    classification: 'informational',
    classification_tier: 'ai_classification',
    classification_reason: null,
    classification_confidence: 0.9,
    has_attachments: true,
    attachment_meta: [SOZLESME, { name: 'davet.ics', mime: 'text/calendar', size: 900 }],
    injection_suspected: false,
    web_link: null,
    provider_deleted_at: null,
  };

  it('sends a PDF attachment to capture after "Analiz Et"', async () => {
    const { api } = setup({
      pro: true,
      data: {
        tables: { connected_accounts: [accountRow()], email_messages: [detailRow] },
      },
      api: {
        [`GET /mail/${MESSAGE}/attachments`]: () => json(200, ok(LISTING)),
        'POST /captures': () => json(201, ok(captureView())),
        [`POST /captures/${M3.capture}/analyze`]: analyzed,
      },
    });
    const { router } = await renderApp(`/mail/${MESSAGE}`);
    const pdf = await screen.findByTestId('email.attachment.0');
    await waitFor(() => {
      expect(within(pdf).getByText("Ekle'ye gönder")).toBeOnTheScreen();
    });
    expect(
      within(screen.getByTestId('email.attachment.1')).queryByText("Ekle'ye gönder"),
    ).toBeNull();
    await fireEvent.press(pdf);
    expect(await screen.findByTestId('capture.mailSheet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('capture.mailSheet.analyze'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/capture/${M3.capture}`);
    });
    expect(api.calls.find((c) => c.url.endsWith('/captures'))?.body).toMatchObject({
      source: { from_email_attachment: { attachment_ref: REF } },
    });
  });
});

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    title: 'Proje görüşmesi',
    start_at: '2026-09-24T11:00:00Z',
    end_at: '2026-09-24T12:00:00Z',
    all_day: false,
    location: null,
    conference_url: null,
    attendees: [],
    attendee_count: 1,
    organizer_self: true,
    can_modify: true,
    description_excerpt: null,
    provider: 'google',
    calendar_id: uuid(12),
    connected_account_id: ACCOUNT,
    da_approval_id: null,
    status: 'confirmed',
    provider_updated_at: null,
    device_last_synced_at: null,
    merge_sources: [
      { event_id: EVENT, provider: 'google', connected_account_id: ACCOUNT, calendar_id: uuid(12) },
      {
        event_id: DUPLICATE,
        provider: 'microsoft',
        connected_account_id: uuid(11),
        calendar_id: uuid(13),
      },
    ],
    ...overrides,
  };
}

describe('KPL-15 · merged calendar events', () => {
  it('names every source and opens the canonical event from a duplicate link', async () => {
    const { db } = await openApp({
      path: `/event/${DUPLICATE}`,
      setup: (fake) => {
        fake.setTable('calendar_events', [eventRow()]);
        fake.setRpc('calendar_event_canonical_id', () => ({ data: EVENT, error: null }));
      },
    });
    expect(await screen.findByText('Proje görüşmesi')).toBeOnTheScreen();
    expect(screen.getByTestId('event.provenance')).toHaveTextContent(
      /2 takvimde: Google Takvim, Outlook Takvim/,
    );
    expect(db.rpcCalls.find((c) => c.name === 'calendar_event_canonical_id')?.args).toEqual({
      p_event_id: DUPLICATE,
    });
  });

  it('is not found when the link names no event of the user', async () => {
    await openApp({
      path: `/event/${DUPLICATE}`,
      setup: (fake) => {
        fake.setTable('calendar_events', []);
        fake.setRpc('calendar_event_canonical_id', () => ({ data: null, error: null }));
      },
    });
    expect(await screen.findByTestId('event.notFound')).toBeOnTheScreen();
  });
});

describe('account detail · free/busy permission', () => {
  it('lists the attendee availability permission as not requested yet', async () => {
    await openApp({
      path: `/settings/accounts/${ACCOUNT}`,
      setup: (db) => {
        db.setTable('connected_accounts', [accountRow()]);
      },
    });
    expect(
      await screen.findByText('Katılımcıların dolu/boş saatleri (çakışma seçenekleri)'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Henüz istenmedi · çakışma seçeneklerinde istenir')).toBeOnTheScreen();
  });
});
