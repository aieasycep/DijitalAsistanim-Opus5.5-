/**
 * T-8.13 · Plan detail screens with their data variants (SCREEN_AND_FLOW_MAP M-PLAN-03 Önerilen
 * zaman bloğu, M-PLAN-04 Saati Değiştir, M-PLAN-07/08 Takvim Çakışması, M-PLAN-09 Etkinlik
 * Detayı, M-MEET-02 Not Al): a proposal opened by id from its `approval_actions` row, real free
 * slots only (`GET /plan/free-slots` → `PATCH /approvals/:id`), "İptal" (`user_cancel`), an
 * expired proposal's "Yeni Saat Bul"; conflict options → `resolve` (approval preview, reply draft,
 * reminder, keep with undo) and their failures; the event detail's links, attendees, notes, the
 * organiser-only time change (`POST /approvals` calendar_update → the approval sheet) and the
 * note sheet (`POST /meetings/:eventId/notes`, discard confirmation).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { router as appRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState, type Responder } from '../helpers/app';
import { approvalView } from '../helpers/assist';
import { errorBody, googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import { events, setup } from '../m2/harness';
import { nth, sequence } from './support';

// 09:30 in Istanbul on Thursday 24 September 2026.
jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const PROPOSAL = uuid(800);
const INSIGHT = uuid(801);
const EVENT = uuid(802);
const OTHER = uuid(803);
const CONTACT = uuid(804);
const DA_APPROVAL = uuid(805);
const NEW_APPROVAL = uuid(806);
const DRAFT = uuid(807);
const MESSAGE = uuid(808);
const THREAD = uuid(809);

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL,
    action_type: 'calendar_create',
    status: 'pending',
    payload: {
      action_type: 'calendar_create',
      title: 'Sunum hazırlığı',
      time: {
        kind: 'timed',
        start: '2026-09-25T07:00:00Z',
        end: '2026-09-25T08:00:00Z',
        time_zone: 'Europe/Istanbul',
      },
    },
    payload_version: 1,
    idempotency_key: `approval:${PROPOSAL}:v1`,
    what: 'Sunum hazırlığı',
    why: 'Son tarihten önce boş zaman.',
    change_summary: 'Yarın takvimine eklenir.',
    exact_change: { kind: 'create', fields: [{ field: 'time', before: null, after: '10:00' }] },
    side_effects: [],
    destination_label: 'ahmet@example.com · Google Takvim',
    origin: 'plan_proposal',
    origin_ref_id: INSIGHT,
    executor: 'server',
    device_installation_id: null,
    batch_id: null,
    created_at: TS,
    approval_expires_at: '2026-09-27T08:00:00Z',
    approved_at: null,
    rejected_at: null,
    approved_via: null,
    executed_at: null,
    result: null,
    last_error_code: null,
    requires_scope: null,
    source_type: 'insight',
    source_id: INSIGHT,
    source_provider: 'google',
    source_timestamp: TS,
    ...overrides,
  };
}

function calendarView(id: string, actionType: 'calendar_create' | 'calendar_update', extra = {}) {
  return approvalView({
    id,
    idempotency_key: `approval:${id}:v2`,
    payload_version: 2,
    action_type: actionType,
    type_label_key: `approvals.types.${actionType}`,
    what: { title: 'Sunum hazırlığı', summary: 'Cuma 11:00–12:00' },
    exact_change: {
      kind: actionType === 'calendar_create' ? 'create' : 'update',
      fields: [{ field: 'time', before: null, after: '11:00' }],
    },
    origin: 'plan_proposal',
    origin_ref_id: INSIGHT,
    side_effects: [],
    destination: {
      target_kind: 'provider',
      provider: 'google',
      account_label: 'ahmet@example.com',
      container_label: 'İş',
    },
    ...extra,
  });
}

const SLOTS = {
  slots: [
    { start: '2026-09-25T08:00:00Z', end: '2026-09-25T10:00:00Z', minutes: 120 },
    { start: '2026-09-25T12:00:00Z', end: '2026-09-25T13:30:00Z', minutes: 90 },
  ],
  sources_considered: [
    { account_id: googleAccount.id, provider: 'google', last_sync_at: TS, stale: false },
  ],
};

beforeEach(async () => {
  await resetAppState();
});

/** Opens Plan first (so "back" has somewhere to go), then pushes `path` like an in-app tap. */
async function openFromPlan(path: string) {
  const rendered = await renderApp('/plan');
  await screen.findByTestId('plan.screen');
  await act(async () => {
    appRouter.push(path);
    await Promise.resolve();
  });
  return rendered;
}

describe('M-PLAN-03 / M-PLAN-04 · Önerilen zaman bloğu', () => {
  it('opens a proposal from its row and changes the time to a real free slot', async () => {
    const { api } = setup({
      pro: true,
      data: { tables: { approval_actions: [proposalRow()] } },
      api: {
        'GET /plan/free-slots': () => json(200, ok(SLOTS)),
        [`PATCH /approvals/${PROPOSAL}`]: () =>
          json(200, ok(calendarView(PROPOSAL, 'calendar_create'))),
      },
    });
    await renderApp(`/plan/proposal/${PROPOSAL}`);
    expect(await screen.findByTestId('proposal.time')).toHaveTextContent('10:00–11:00');
    expect(screen.getByText(/^Yarın · /)).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('schedule_proposal_opened')[0]?.props).toEqual({ origin: 'plan_day' });
    });
    await fireEvent.press(screen.getByTestId('proposal.changeTime'));
    expect(await screen.findByTestId('freeSlots')).toBeOnTheScreen();
    expect(events('free_slot_picker_opened')[0]?.props).toEqual({ origin: 'proposal' });
    const slot = await screen.findByTestId('freeSlots.slot.2026-09-25T08:00:00Z');
    const slotsCall = api.calls.find((c) => c.url.includes('/plan/free-slots'));
    expect(slotsCall?.url).toContain('min_minutes=60');
    await fireEvent.press(slot);
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      expected_payload_version: 1,
      payload_patch: {
        time: {
          kind: 'timed',
          start: '2026-09-25T08:00:00Z',
          end: '2026-09-25T09:00:00.000Z',
          time_zone: 'Europe/Istanbul',
        },
      },
    });
    expect(events('free_slot_selected')[0]?.props).toEqual({ day_offset: 1, recommended: true });
    expect(await screen.findByTestId('proposal.time')).toHaveTextContent('11:00–12:00');
    expect(events('schedule_proposal_time_changed')).toHaveLength(1);
  });

  it('explains a slot that was taken meanwhile and an empty day, then goes back', async () => {
    setup({
      pro: true,
      data: { tables: { approval_actions: [proposalRow()] } },
      api: {
        'GET /plan/free-slots': (call) =>
          call.url.includes(encodeURIComponent('2026-09-25'))
            ? json(200, ok(SLOTS))
            : json(200, ok({ ...SLOTS, slots: [] })),
        [`PATCH /approvals/${PROPOSAL}`]: () => json(409, errorBody('STATE_CONFLICT')),
      },
    });
    await renderApp(`/plan/proposal/${PROPOSAL}`);
    await fireEvent.press(await screen.findByTestId('proposal.changeTime'));
    await fireEvent.press(await screen.findByTestId('freeSlots.slot.2026-09-25T12:00:00Z'));
    expect(await screen.findByText('Bu saat artık dolu. Başka bir saat seç.')).toBeOnTheScreen();
    // Another day without room for the block.
    await fireEvent.press(screen.getByText('Bugün'));
    expect(await screen.findByText('Bu gün 1 sa boşluk yok.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Vazgeç'));
    expect(await screen.findByTestId('proposal.changeTime')).toBeOnTheScreen();
  });

  it('cancels with user_cancel (no learning) and records a dismissal on close', async () => {
    const { api } = setup({
      pro: true,
      data: { tables: { approval_actions: [proposalRow()] } },
      api: {
        [`POST /approvals/${PROPOSAL}/reject`]: () =>
          json(
            200,
            ok(
              calendarView(PROPOSAL, 'calendar_create', {
                status: 'rejected',
                rejected_at: TS,
                payload_version: 1,
              }),
            ),
          ),
      },
    });
    const { router } = await openFromPlan(`/plan/proposal/${PROPOSAL}`);
    await fireEvent.press(await screen.findByTestId('ui.approvalCard.reject'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/plan');
    });
    expect(api.calls.find((c) => c.url.endsWith('/reject'))?.body).toEqual({
      reason: 'user_cancel',
      learn: false,
    });
    expect(events('schedule_proposal_decided').at(-1)?.props).toEqual({ decision: 'cancelled' });
  });

  it('offers "Yeni Saat Bul" for an expired proposal (POST /plan/proposals)', async () => {
    const { api } = setup({
      pro: true,
      data: { tables: { approval_actions: [proposalRow({ status: 'expired' })] } },
      api: {
        'POST /plan/proposals': () =>
          json(
            201,
            ok({
              insight_id: INSIGHT,
              slot: { start: '2026-09-25T11:00:00Z', end: '2026-09-25T12:00:00Z' },
              alternatives: [],
              rationale_text: 'Cuma boşsun.',
              approval: calendarView(NEW_APPROVAL, 'calendar_create'),
            }),
          ),
      },
    });
    const { router } = await renderApp(`/plan/proposal/${PROPOSAL}`);
    expect(
      await screen.findByText(
        'Bu önerinin süresi doldu; takvim o zamandan beri değişmiş olabilir.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('proposal.changeTime')).toBeNull();
    await fireEvent.press(screen.getByTestId('proposal.findNew'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${NEW_APPROVAL}`);
    });
    expect(api.calls.find((c) => c.url.endsWith('/plan/proposals'))?.body).toMatchObject({
      item: { type: 'insight', id: INSIGHT },
      duration_minutes: 60,
    });
    expect(await screen.findByTestId('proposal.time')).toHaveTextContent('14:00–15:00');
  });

  it('shows "Bu öneri artık yok." for a missing proposal', async () => {
    setup({ pro: true });
    await renderApp(`/plan/proposal/${PROPOSAL}`);
    expect(await screen.findByTestId('proposal.notFound')).toBeOnTheScreen();
    expect(screen.getByText('Bu öneri artık yok.')).toBeOnTheScreen();
  });

  it('shows the error card when the proposal cannot be read', async () => {
    setup({ pro: true, data: { failures: { approval_actions: 'FORBIDDEN' } } });
    await renderApp(`/plan/proposal/${PROPOSAL}`);
    expect(await screen.findByTestId('proposal.error')).toBeOnTheScreen();
  });

  it('asks for a connection before listing free slots offline', async () => {
    setup({ pro: true, data: { tables: { approval_actions: [proposalRow()] } } });
    await renderApp(`/plan/proposal/${PROPOSAL}`);
    await screen.findByTestId('proposal.time');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByTestId('proposal.changeTime'));
    expect(
      await screen.findByText('Boş zamanları görmek için bağlantı gerekiyor.'),
    ).toBeOnTheScreen();
  });
});

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
    ['move', 'move_event', 'Etkinliği taşı', 'calendar_write'],
    ['mail', 'propose_new_time_email', 'Yeni saat öner', null],
    ['remind', 'remind_me', 'Hatırlatıcı kur', null],
    ['keep', 'ignore', 'Böyle kalsın', null],
  ].map(([option_id, kind, title, capability]) => ({
    option_id,
    kind,
    title,
    description: `${String(title)} açıklaması`,
    feasibility: { organizer: true, attendee_availability: 'unknown' },
    side_effects: [],
    requires_capability: capability,
    pro_required: true,
  })),
};

function resolveAnswer(body: Record<string, unknown>): Responder {
  return () =>
    json(
      200,
      ok({
        approval: null,
        reply_draft: null,
        reminder_options_route: null,
        insight_status: 'open',
        ...body,
      }),
    );
}

function conflictSetup(resolve: Responder, extra: Record<string, Responder> = {}) {
  return setup({
    pro: true,
    data: { rpc: { set_insight_status: () => null } },
    api: {
      [`POST /plan/conflicts/${INSIGHT}/options`]: () => json(200, ok(CONFLICT)),
      [`POST /plan/conflicts/${INSIGHT}/resolve`]: resolve,
      ...extra,
    },
  });
}

describe('M-PLAN-07 / M-PLAN-08 · Takvim Çakışması', () => {
  it('lists the ranked options and previews a calendar_update approval in place', async () => {
    const { api } = conflictSetup(
      resolveAnswer({ approval: calendarView(NEW_APPROVAL, 'calendar_update') }),
      {
        [`POST /approvals/${NEW_APPROVAL}/reject`]: () =>
          json(
            200,
            ok(
              calendarView(NEW_APPROVAL, 'calendar_update', {
                status: 'rejected',
                rejected_at: TS,
              }),
            ),
          ),
      },
    );
    await renderApp(`/plan/conflict/${INSIGHT}`);
    expect(await screen.findByTestId('conflict.options')).toBeOnTheScreen();
    expect(screen.getByText('İzin gerekiyor')).toBeOnTheScreen();
    expect(screen.getByTestId('conflict.pair').props.accessibilityLabel).toContain(
      'Doktor randevusu',
    );
    await waitFor(() => {
      expect(events('conflict_options_shown')[0]?.props).toEqual({ count: 4 });
    });
    await fireEvent.press(screen.getByTestId('conflict.option.move_event'));
    expect(await screen.findByTestId('ui.approvalCard.approve')).toBeOnTheScreen();
    expect(api.calls.find((c) => c.url.endsWith('/resolve'))?.body).toEqual({ option_id: 'move' });
    expect(events('conflict_option_selected')[0]?.props).toEqual({
      option_kind: 'move_own',
      recommended: true,
    });
    // "İptal" rejects the preview and returns to the options.
    await fireEvent.press(screen.getByTestId('ui.approvalCard.reject'));
    expect(await screen.findByTestId('conflict.options')).toBeOnTheScreen();
  });

  it('opens the reply draft for a new-time mail and the reminder sheet for "remind me"', async () => {
    const draft = {
      id: DRAFT,
      kind: 'reply',
      email_message_id: MESSAGE,
      email_thread_id: THREAD,
      connected_account_id: googleAccount.id,
      tone: 'professional',
      subject: 'Re: Toplantı',
      to: [{ email: 'mehmet@yilmaz.example', name: 'Mehmet' }],
      cc: [],
      body_text: 'Toplantıyı 15:00’e alabilir miyiz?',
      language: 'tr',
      version: 1,
      status: 'draft',
      attachments: [],
      grounding: { facts_used: [] },
      warnings: [],
      approval_id: null,
      web_link: null,
      created_at: TS,
      updated_at: TS,
    };
    const answers = [resolveAnswer({ reply_draft: draft }), resolveAnswer({})];
    conflictSetup((call) => nth(answers.splice(0, 1), 0)(call));
    const { router } = await renderApp(`/plan/conflict/${INSIGHT}`);
    await fireEvent.press(await screen.findByTestId('conflict.option.propose_new_time_email'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MESSAGE}/reply`);
    });
    expect(router.getSearchParams()).toMatchObject({ draftId: DRAFT, origin: 'plan' });
    await act(async () => {
      appRouter.back();
      await Promise.resolve();
    });
    await fireEvent.press(await screen.findByTestId('conflict.option.remind_me'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    expect(events('reminder_sheet_open').at(-1)?.props).toEqual({ origin: 'plan', mode: 'remind' });
  });

  it('keeps the conflict with an undo that reopens the insight', async () => {
    const { fake } = conflictSetup(resolveAnswer({ insight_status: 'dismissed' }));
    const { router } = await openFromPlan(`/plan/conflict/${INSIGHT}`);
    await fireEvent.press(await screen.findByTestId('conflict.option.ignore'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/plan');
    });
    expect(events('conflict_resolved').at(-1)?.props).toEqual({
      option_kind: 'keep',
      outcome: 'dismissed',
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toEqual({
        p_insight_id: INSIGHT,
        p_status: 'open',
      });
    });
  });

  it('explains resolve failures and opens the first event from the pair', async () => {
    conflictSetup(
      sequence(json(409, errorBody('STATE_CONFLICT')), json(500, errorBody('INTERNAL_ERROR'))),
    );
    const { router } = await renderApp(`/plan/conflict/${INSIGHT}`);
    await fireEvent.press(await screen.findByTestId('conflict.option.move_event'));
    expect(await screen.findByText('Bu çakışma artık yok.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('conflict.option.move_event'));
    expect(
      await screen.findByText('Seçenek uygulanamadı. Tekrar dene.', {}, { timeout: 5000 }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('conflict.pair'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/event/${EVENT}`);
    });
  }, 15_000);

  it('gates Free users (options are Pro)', async () => {
    const { api } = setup({});
    await renderApp(`/plan/conflict/${INSIGHT}`);
    expect(await screen.findByText('Akıllı planlama Pro ile gelir.')).toBeOnTheScreen();
    expect(events('conflict_opened')[0]?.props).toEqual({ origin: 'plan_day' });
    expect(api.calls.some((c) => c.url.includes('/plan/conflicts/'))).toBe(false);
  });

  it('shows "Bu çakışma artık yok." when the conflict resolved itself', async () => {
    setup({
      pro: true,
      api: {
        [`POST /plan/conflicts/${INSIGHT}/options`]: () => json(409, errorBody('STATE_CONFLICT')),
      },
    });
    await renderApp(`/plan/conflict/${INSIGHT}`);
    expect(await screen.findByTestId('conflict.gone')).toBeOnTheScreen();
  });

  it('falls back to the gate on 402 and asks for a connection offline', async () => {
    setup({
      pro: true,
      api: {
        [`POST /plan/conflicts/${INSIGHT}/options`]: () =>
          json(402, errorBody('ENTITLEMENT_REQUIRED')),
      },
    });
    await renderApp(`/plan/conflict/${INSIGHT}`);
    expect(await screen.findByText('Akıllı planlama Pro ile gelir.')).toBeOnTheScreen();
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByText('Seçenekler için bağlantı gerekiyor.')).toBeOnTheScreen();
  });
});

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    title: 'Müşteri toplantısı',
    start_at: '2026-09-24T11:00:00Z',
    end_at: '2026-09-24T12:00:00Z',
    all_day: false,
    location: 'Levent Ofis, İstanbul',
    conference_url: 'https://meet.google.com/abc-defg-hij',
    attendees: [
      { name: 'Ahmet', email: 'ahmet@example.com', response: 'accepted', is_self: true },
      {
        name: 'Mehmet Yılmaz',
        email: 'mehmet@yilmaz.example',
        response: 'tentative',
        contact_id: CONTACT,
      },
      { email: 'ayse@demir.example', response: 'needsAction' },
    ],
    attendee_count: 3,
    organizer_self: true,
    can_modify: true,
    description_excerpt: `Gündem: ${'teklif revizyonu, fiyat, teslim takvimi. '.repeat(6)}`,
    provider: 'google',
    calendar_id: uuid(12),
    connected_account_id: googleAccount.id,
    da_approval_id: DA_APPROVAL,
    status: 'confirmed',
    provider_updated_at: TS,
    device_last_synced_at: null,
    ...overrides,
  };
}

const NOTES = [
  {
    id: uuid(820),
    body: 'Fiyatı %10 düşürmeyi konuştuk.',
    kind: 'text',
    created_at: TS,
    calendar_event_id: EVENT,
  },
];

describe('M-PLAN-09 · Etkinlik Detayı', () => {
  it('shows a Pro meeting with its links, attendees, description and notes', async () => {
    setup({
      pro: true,
      data: {
        tables: {
          calendar_events: [eventRow()],
          calendars: [{ id: uuid(12), name: 'İş' }],
          meeting_notes: NOTES,
        },
      },
    });
    const { router } = await openFromPlan(`/event/${EVENT}?origin=plan_day`);
    expect(await screen.findByTestId('event.title')).toHaveTextContent('Müşteri toplantısı');
    await waitFor(() => {
      expect(events('event_detail_opened')[0]?.props).toEqual({
        origin: 'plan_day',
        is_meeting: true,
      });
    });
    expect(screen.getByText('Ahmet (sen)')).toBeOnTheScreen();
    expect(screen.getByText('Belki')).toBeOnTheScreen();
    expect(screen.getByText('Yanıt yok')).toBeOnTheScreen();
    expect(screen.getByText(/Kaynak: Google Takvim · İş/)).toBeOnTheScreen();

    const openURL = jest.spyOn(Linking, 'openURL');
    await fireEvent.press(screen.getByTestId('event.maps'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(expect.stringContaining('Levent'));
    });
    await fireEvent.press(screen.getByTestId('event.join'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith('https://meet.google.com/abc-defg-hij');
    });
    await fireEvent.press(screen.getByTestId('event.openCalendar'));
    await waitFor(() => {
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalled();
    });
    expect(events('external_handoff').map((e) => e.props.target)).toEqual([
      'maps',
      'meeting_link',
      'provider_calendar',
    ]);
    await fireEvent.press(screen.getByText('Devamını gör'));
    expect(await screen.findByText('Daha az göster')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Fiyatı %10 düşürmeyi konuştuk.'));

    await fireEvent.press(screen.getByText('Mehmet Yılmaz'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/person/${CONTACT}`);
    });
    await act(async () => {
      appRouter.back();
      await Promise.resolve();
    });
    await fireEvent.press(await screen.findByText('Dijital Asistan ekledi · onayı gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/approvals/${DA_APPROVAL}`);
    });
    await act(async () => {
      appRouter.back();
      await Promise.resolve();
    });
    await fireEvent.press(await screen.findByTestId('event.prepare'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${EVENT}/prep`);
    });
  });

  it('proposes a new time as a calendar_update approval (organiser, Pro)', async () => {
    const { api } = setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: {
        'GET /plan/free-slots': () => json(200, ok(SLOTS)),
        'POST /approvals': () => json(201, ok(calendarView(NEW_APPROVAL, 'calendar_update'))),
      },
    });
    await renderApp(`/event/${EVENT}`);
    await fireEvent.press(await screen.findByTestId('event.more'));
    await fireEvent.press(await screen.findByTestId('m2.menu.change'));
    expect(events('event_time_change_started')).toHaveLength(1);
    await fireEvent.press(await screen.findByTestId('freeSlots.slot.2026-09-25T08:00:00Z'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/approvals'))).toBe(true);
    });
    expect(
      api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/approvals'))?.body,
    ).toMatchObject({
      payload: {
        action_type: 'calendar_update',
        calendar_event_id: EVENT,
        target: { kind: 'provider', connected_account_id: googleAccount.id, calendar_id: uuid(12) },
        changes: {
          time: { kind: 'timed', start: '2026-09-25T08:00:00Z', end: '2026-09-25T09:00:00.000Z' },
        },
      },
      origin: 'plan_proposal',
    });
    // The one approval sheet shows the change for the tap (R-03).
    expect(await screen.findByTestId('sheet.approval')).toBeOnTheScreen();
    expect(screen.getByTestId(`approvalSheet.single.${NEW_APPROVAL}`)).toBeOnTheScreen();
  });

  it('explains a Pro-only or failed time change', async () => {
    setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: {
        'GET /plan/free-slots': () => json(200, ok(SLOTS)),
        'POST /approvals': sequence(
          json(402, errorBody('ENTITLEMENT_REQUIRED')),
          json(500, errorBody('INTERNAL_ERROR')),
        ),
      },
    });
    await renderApp(`/event/${EVENT}`);
    await fireEvent.press(await screen.findByTestId('event.more'));
    await fireEvent.press(await screen.findByTestId('m2.menu.change'));
    await fireEvent.press(await screen.findByTestId('freeSlots.slot.2026-09-25T08:00:00Z'));
    expect(await screen.findByText('Saat değiştirme önerileri Pro ile gelir.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('freeSlots.slot.2026-09-25T12:00:00Z'));
    expect(
      await screen.findByText('Saat değişikliği önerilemedi.', {}, { timeout: 5000 }),
    ).toBeOnTheScreen();
  }, 15_000);

  it('offers the post-meeting note after a Pro meeting ended', async () => {
    setup({
      pro: true,
      data: {
        tables: {
          calendar_events: [
            eventRow({
              start_at: '2026-09-24T05:00:00Z',
              end_at: '2026-09-24T06:00:00Z',
              da_approval_id: null,
            }),
          ],
        },
      },
    });
    const { router } = await renderApp(`/event/${EVENT}`);
    expect(await screen.findByText(/· Bitti$/)).toBeOnTheScreen();
    expect(screen.queryByTestId('event.join')).toBeNull();
    await fireEvent.press(screen.getByTestId('event.post'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${EVENT}/post`);
    });
  });

  it('shows a cancelled all-day event from a device calendar with a reminder (Free)', async () => {
    setup({
      data: {
        tables: {
          calendar_events: [
            eventRow({
              all_day: true,
              start_at: '2026-09-24T21:00:00Z',
              end_at: '2026-09-25T21:00:00Z',
              attendees: [],
              attendee_count: 1,
              conference_url: null,
              location: null,
              description_excerpt: null,
              provider: 'apple_device',
              status: 'cancelled',
              da_approval_id: null,
              device_last_synced_at: TS,
            }),
          ],
        },
      },
    });
    await renderApp(`/event/${EVENT}`);
    expect(await screen.findByText('Tüm gün')).toBeOnTheScreen();
    expect(screen.getByText('Bu etkinlik iptal edildi.')).toBeOnTheScreen();
    expect(screen.getByText(/Kaynak: Apple Takvim/)).toBeOnTheScreen();
    // Not a provider event and all-day: the time cannot change; only the calendar hand-off.
    await fireEvent.press(screen.getByTestId('event.more'));
    expect(await screen.findByTestId('m2.menu.calendar')).toBeOnTheScreen();
    expect(screen.queryByTestId('m2.menu.change')).toBeNull();
    const openURL = jest.spyOn(Linking, 'openURL');
    await fireEvent.press(screen.getByTestId('m2.menu.calendar'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(expect.stringMatching(/^calshow:/));
    });
    await fireEvent.press(screen.getByTestId('event.remind'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    expect(events('reminder_sheet_open').at(-1)?.props).toEqual({ origin: 'plan', mode: 'remind' });
  });

  it('shows the gone state for a removed event', async () => {
    setup({});
    await renderApp(`/event/${EVENT}`);
    expect(await screen.findByTestId('event.notFound')).toBeOnTheScreen();
  });

  it('shows the error state when the event cannot be read', async () => {
    setup({ data: { failures: { calendar_events: 'FORBIDDEN' } } });
    await renderApp(`/event/${EVENT}`);
    expect(await screen.findByTestId('event.error')).toBeOnTheScreen();
  });
});

describe('M-MEET-02 · Not Al', () => {
  it('saves a typed note with POST /meetings/:eventId/notes and confirms before discarding', async () => {
    const { api } = setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: {
        [`POST /meetings/${EVENT}/notes`]: (call) =>
          json(
            201,
            ok({
              id: uuid(821),
              calendar_event_id: EVENT,
              body: (call.body as { body: string }).body,
              source: 'text',
              created_at: TS,
            }),
          ),
      },
    });
    await renderApp(`/event/${EVENT}`);
    await fireEvent.press(await screen.findByTestId('event.note'));
    const input = await screen.findByTestId('meeting.note.input');
    await fireEvent.changeText(input, 'Teklif Cuma günü gönderilecek.');
    await fireEvent.press(screen.getByTestId('meeting.note.cancel'));
    expect(await screen.findByText('Not silinsin mi?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Vazgeç'));
    await fireEvent.press(await screen.findByTestId('meeting.note.save'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith(`/meetings/${EVENT}/notes`))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/notes'))?.body).toMatchObject({
      body: 'Teklif Cuma günü gönderilecek.',
      source: 'text',
    });
    expect(await screen.findByText('Not kaydedildi')).toBeOnTheScreen();
    expect(events('meeting_note_saved')[0]?.props).toEqual({ input_mode: 'text', origin: 'event' });
  });

  it('shows a failed save with a retry and discards a draft on request', async () => {
    const answers = [json(422, errorBody('VALIDATION_FAILED'))];
    setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: {
        [`POST /meetings/${EVENT}/notes`]: () =>
          answers.shift() ?? json(422, errorBody('VALIDATION_FAILED')),
      },
    });
    await renderApp(`/event/${EVENT}`);
    await fireEvent.press(await screen.findByTestId('event.note'));
    await fireEvent.changeText(await screen.findByTestId('meeting.note.input'), 'Kısa not');
    await fireEvent.press(screen.getByTestId('meeting.note.save'));
    const error = await screen.findByTestId('meeting.note.error');
    expect(within(error).getByText('Not kaydedilemedi.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('meeting.note.cancel'));
    await fireEvent.press(await screen.findByTestId('meeting.note.discard'));
    await waitFor(() => {
      expect(screen.queryByTestId('meeting.note.input')).toBeNull();
    });
  });
});
