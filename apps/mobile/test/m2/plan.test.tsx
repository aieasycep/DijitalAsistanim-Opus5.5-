/**
 * T-8.13 / T-8.12 · Plan: the proposal sheet (M-PLAN-03) shows "Planlandı" only after the approval
 * executed (R-19; never on approve alone), free gaps are computed from real events, and the event
 * detail (M-PLAN-09) offers "Saati Değiştir" only to the organiser (or `can_modify`) and gates
 * meeting prep for Free users.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { json, renderApp, resetAppState } from '../helpers/app';
import { ok, TS, uuid } from '../helpers/fixtures';
import { computeGaps } from '../../src/features/plan/data';
import { setup } from './harness';

const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const PROPOSAL = uuid(600);

function approvalRow(status: string) {
  return {
    id: PROPOSAL,
    action_type: 'calendar_create',
    status,
    payload: {
      action_type: 'calendar_create',
      title: 'Teklif hazırlama',
      time: { kind: 'timed', start: iso(24 * 60), end: iso(25 * 60), time_zone: 'Europe/Istanbul' },
    },
    payload_version: 1,
    idempotency_key: `approval:${PROPOSAL}:v1`,
    what: 'Teklif hazırlama',
    why: 'Son tarihten önce boş zaman.',
    change_summary: 'Yarın takvimine eklenir.',
    exact_change: {
      kind: 'create',
      fields: [{ field: 'time', before: null, after: '10:00–11:00' }],
    },
    side_effects: [{ code: 'internal_record', text: 'Takvimine eklenir; kimseye davet gitmez.' }],
    destination_label: 'ahmet@example.com · Google Takvim',
    origin: 'plan_proposal',
    origin_ref_id: uuid(601),
    executor: 'server',
    device_installation_id: null,
    batch_id: null,
    created_at: TS,
    approval_expires_at: iso(3 * 24 * 60),
    approved_at: null,
    rejected_at: null,
    approved_via: null,
    executed_at: null,
    result: null,
    last_error_code: null,
    requires_scope: null,
    source_type: 'email_message',
    source_id: uuid(90),
    source_provider: 'google',
    source_timestamp: TS,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(610),
    title: 'Proje görüşmesi',
    start_at: iso(120),
    end_at: iso(180),
    all_day: false,
    location: null,
    conference_url: null,
    attendees: [
      { name: 'Ahmet', email: 'ahmet@example.com', response: 'accepted', is_self: true },
      { name: 'Ayşe', email: 'ayse@example.com', response: 'declined' },
    ],
    attendee_count: 2,
    organizer_self: true,
    can_modify: true,
    description_excerpt: null,
    provider: 'google',
    calendar_id: uuid(12),
    connected_account_id: uuid(10),
    da_approval_id: null,
    status: 'confirmed',
    provider_updated_at: null,
    device_last_synced_at: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-PLAN-03 · Önerilen zaman bloğu', () => {
  it('shows "Planlandı" only once the approval executed, after the undo window', async () => {
    const row = approvalRow('pending');
    const { api } = setup({
      pro: true,
      data: { tables: { approval_actions: [row] } },
      api: {
        [`POST /approvals/${PROPOSAL}/approve`]: () => {
          const view = {
            id: PROPOSAL,
            action_type: 'calendar_create',
            status: 'executing',
            payload_version: 1,
            idempotency_key: row.idempotency_key,
            type_label_key: 'approvals.types.calendar_create',
            what: { title: 'Teklif hazırlama', summary: 'Yarın takvimine eklenir.' },
            why: { text: 'Son tarihten önce boş zaman.', reason_code: 'plan_proposal' },
            source: null,
            exact_change: row.exact_change,
            destination: {
              target_kind: 'provider',
              provider: 'google',
              account_label: row.destination_label,
              container_label: null,
            },
            side_effects: row.side_effects,
            scope_status: { state: 'granted' },
            requires_confirmation: false,
            pro_required: false,
            origin: 'plan_proposal',
            origin_ref_id: uuid(601),
            executor: 'server',
            device_installation_id: null,
            batch_id: null,
            created_at: TS,
            approval_expires_at: row.approval_expires_at,
            approved_at: TS,
            rejected_at: null,
            approved_via: 'inline_sheet',
            executed_at: null,
            result: null,
            failure: null,
          };
          // The executor finishes after the approve call returns.
          setTimeout(() => {
            row.status = 'executed';
          }, 300);
          return json(
            200,
            ok({
              approval: view,
              job: null,
              execution: { mode: 'server', device_token: null, instructions: null },
            }),
          );
        },
      },
    });
    await renderApp(`/plan/proposal/${PROPOSAL}`);
    await fireEvent.press(await screen.findByTestId('ui.approvalCard.approve'));
    // R-06: nothing is sent during the 5 s undo window.
    expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(false);
    await waitFor(
      () => {
        expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(true);
      },
      { timeout: 7000 },
    );
    expect(screen.queryByTestId('proposal.done')).toBeNull();
    const approve = api.calls.find((c) => c.url.endsWith('/approve'));
    expect(approve?.body).toEqual({
      idempotency_key: row.idempotency_key,
      payload_version: 1,
      approved_via: 'inline_sheet',
    });
    await waitFor(
      () => {
        expect(screen.getByTestId('proposal.done')).toBeOnTheScreen();
      },
      { timeout: 5000 },
    );
  }, 20_000);
});

describe('free gaps', () => {
  it('finds gaps between real events inside working hours only', () => {
    const tz = 'Europe/Istanbul';
    const gaps = computeGaps({
      date: '2026-09-24',
      timeZone: tz,
      items: [
        {
          item_type: 'event',
          start_at: '2026-09-24T07:00:00Z',
          end_at: '2026-09-24T08:00:00Z',
          all_day: false,
        },
        {
          item_type: 'event',
          start_at: '2026-09-24T11:00:00Z',
          end_at: '2026-09-24T12:00:00Z',
          all_day: false,
        },
        {
          item_type: 'task',
          start_at: '2026-09-24T13:00:00Z',
          end_at: '2026-09-24T14:00:00Z',
          all_day: false,
        },
      ],
      workStart: '09:00',
      workEnd: '18:00',
      workDays: [1, 2, 3, 4, 5],
      nowMs: 0,
    } as unknown as Parameters<typeof computeGaps>[0]);
    // 09:00–18:00 Istanbul around 10:00–11:00 and 14:00–15:00; tasks do not block time.
    expect(gaps.map((g) => g.minutes)).toEqual([60, 180, 180]);
  });
});

describe('M-PLAN-09 · Etkinlik Detayı', () => {
  it('offers "Saati Değiştir" to the organiser and gates prep for a Free user', async () => {
    setup({ data: { tables: { calendar_events: [eventRow()] } } });
    await renderApp(`/event/${uuid(610)}`);
    expect(await screen.findByText('Proje görüşmesi')).toBeOnTheScreen();
    expect(screen.getByText('Katılmıyor')).toBeOnTheScreen();
    expect(screen.getByText('Toplantı hazırlığı Pro ile gelir.')).toBeOnTheScreen();
    expect(screen.queryByTestId('event.prepare')).toBeNull();
    await fireEvent.press(screen.getByTestId('event.more'));
    expect(await screen.findByTestId('m2.menu.change')).toBeOnTheScreen();
  });

  it('hides "Saati Değiştir" from an attendee who cannot modify the event', async () => {
    setup({
      pro: true,
      data: {
        tables: { calendar_events: [eventRow({ organizer_self: false, can_modify: false })] },
      },
    });
    await renderApp(`/event/${uuid(610)}`);
    expect(await screen.findByTestId('event.prepare')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('event.more'));
    expect(await screen.findByTestId('m2.menu.calendar')).toBeOnTheScreen();
    expect(screen.queryByTestId('m2.menu.change')).toBeNull();
  });
});
