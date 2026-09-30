/**
 * T-8.16 · M-APPR-05 typed approval editors (SCREEN_AND_FLOW_MAP M-APPR-05, API-APR-01/02, SREQ-44):
 * "Düzenle" on a pending approval opens the editor of its action type (calendar create / update,
 * task, reminder, commitment) with only that type's fields; the edited payload is validated with
 * the `@da/validation` schema, then sent as `PATCH /approvals/:id {expected_payload_version,
 * payload_patch}` ("Düzenlendi"), a 409 shows the reload message, and a failed approval is
 * re-proposed with `POST /approvals` and opened in the inline sheet.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { json, resetAppState, type RecordedCall, type Responder } from '../helpers/app';
import { M3, approvalRow, approvalView } from '../helpers/assist';
import { errorBody, googleAccount, ok, uuid } from '../helpers/fixtures';
import { events, openApp, proBootstrap } from '../helpers/journeys';

jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const CALENDAR = uuid(12);
const SOURCE = {
  source_type: 'email_message',
  source_id: uuid(1700),
  source_provider: 'google',
  source_timestamp: '2026-09-24T05:00:00Z',
};

const PAYLOADS: Record<string, Record<string, unknown>> = {
  calendar_create: {
    action_type: 'calendar_create',
    target: { kind: 'provider', connected_account_id: googleAccount.id, calendar_id: CALENDAR },
    title: 'Proje görüşmesi',
    time: {
      kind: 'timed',
      start: '2026-09-25T07:00:00Z',
      end: '2026-09-25T07:30:00Z',
      time_zone: 'Europe/Istanbul',
    },
    attendees: [],
    reminders_minutes: [],
  },
  calendar_update: {
    action_type: 'calendar_update',
    target: { kind: 'provider', connected_account_id: googleAccount.id, calendar_id: CALENDAR },
    calendar_event_id: uuid(1701),
    changes: {
      time: {
        kind: 'timed',
        start: '2026-09-25T08:00:00Z',
        end: '2026-09-25T09:00:00Z',
        time_zone: 'Europe/Istanbul',
      },
    },
  },
  task_create: {
    action_type: 'task_create',
    target: { kind: 'in_app' },
    title: 'Faturayı öde',
    due: { kind: 'date', date: '2026-09-26' },
  },
  reminder_create: {
    action_type: 'reminder_create',
    destination: { kind: 'in_app', channel: 'push' },
    title: 'Faturayı öde',
    preset: 'custom',
    fire_at: '2026-09-25T06:00:00Z',
    time_zone: 'Europe/Istanbul',
  },
  commitment_create: {
    action_type: 'commitment_create',
    text: 'Teklifi gönder',
    direction: 'user_owes',
    counterparty: { name: 'Mehmet Yılmaz' },
    due_at: '2026-09-26T09:00:00Z',
    due_precision: 'date',
    source: SOURCE,
    evidence: { quote: 'Teklifi Cuma atarım.', source: SOURCE },
    confidence: 0.9,
  },
};

const DESTINATIONS: Record<string, Record<string, unknown>> = {
  calendar_create: {
    target_kind: 'provider',
    provider: 'google',
    account_label: 'ahmet@example.com',
    container_label: 'İş',
  },
  calendar_update: {
    target_kind: 'provider',
    provider: 'google',
    account_label: 'ahmet@example.com',
    container_label: 'İş',
  },
};

function row(actionType: string, overrides: Record<string, unknown> = {}) {
  const destination = DESTINATIONS[actionType] ?? {
    target_kind: 'in_app',
    provider: 'in_app',
    account_label: null,
    container_label: null,
  };
  return approvalRow({
    action_type: actionType,
    payload: PAYLOADS[actionType],
    what: 'Düzenlenecek işlem',
    exact_change: {
      kind: actionType === 'calendar_update' ? 'update' : 'create',
      fields: [],
      card: { destination },
    },
    side_effects: [],
    ...overrides,
  });
}

function view(actionType: string, overrides: Record<string, unknown> = {}) {
  return approvalView({
    action_type: actionType,
    type_label_key: `approvals.types.${actionType}`,
    payload_version: 2,
    idempotency_key: `approval:${M3.approval}:v2`,
    exact_change: { kind: actionType === 'calendar_update' ? 'update' : 'create', fields: [] },
    side_effects: [],
    destination: DESTINATIONS[actionType] ?? {
      target_kind: 'in_app',
      provider: 'in_app',
      account_label: null,
      container_label: null,
    },
    ...overrides,
  });
}

async function openEditor(
  actionType: string,
  options: {
    readonly routes?: Readonly<Record<string, Responder>>;
    readonly row?: Record<string, unknown>;
  } = {},
) {
  const opened = await openApp({
    data: proBootstrap(),
    path: `/approvals/${M3.approval}`,
    setup: (db) => {
      db.setTable('approval_actions', [options.row ?? row(actionType)]);
    },
    routes: {
      [`PATCH /approvals/${M3.approval}`]: () => json(200, ok(view(actionType))),
      ...options.routes,
    },
  });
  // A pending card has its own "Düzenle" button; a failed one offers it next to "Tekrar dene".
  await fireEvent.press(await screen.findByText('Düzenle'));
  expect(await screen.findByTestId('sheet.approvalEditor')).toBeOnTheScreen();
  return opened;
}

function patchOf(calls: readonly RecordedCall[]) {
  return (calls.find((c) => c.method === 'PATCH')?.body ?? null) as {
    expected_payload_version: number;
    payload_patch: Record<string, unknown>;
  } | null;
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-APPR-05 · typed editors', () => {
  it('edits a calendar event (title, day, time, duration, location) with PATCH /approvals/:id', async () => {
    const { api } = await openEditor('calendar_create');
    const editor = await screen.findByTestId('approvalEditor.calendar_create');
    await fireEvent.changeText(within(editor).getByTestId('approvalEditor.title'), 'Proje kickoff');
    await fireEvent.changeText(
      within(editor).getByTestId('approvalEditor.location'),
      'Levent Ofis',
    );
    await fireEvent.press(within(editor).getByTestId('approvalEditor.when.day.2'));
    await fireEvent.press(within(editor).getByTestId('approvalEditor.when.hour.up'));
    await fireEvent.press(within(editor).getByTestId('approvalEditor.when.minute.up'));
    await fireEvent.press(within(editor).getByTestId('approvalEditor.duration.45'));
    await fireEvent.press(within(editor).getByTestId('approvalEditor.save'));
    await waitFor(() => {
      expect(patchOf(api.calls)).not.toBeNull();
    });
    const patch = patchOf(api.calls);
    expect(patch?.expected_payload_version).toBe(1);
    expect(patch?.payload_patch).toMatchObject({
      title: 'Proje kickoff',
      location: 'Levent Ofis',
      time: { kind: 'timed', time_zone: 'Europe/Istanbul' },
    });
    const time = patch?.payload_patch.time as { start: string; end: string };
    expect(Date.parse(time.end) - Date.parse(time.start)).toBe(45 * 60_000);
    expect(await screen.findByText('Düzenlendi')).toBeOnTheScreen();
    expect(events('approval_edit').at(-1)?.props).toEqual({
      action_type: 'calendar_create',
      fields_changed_count: 3,
    });
  });

  it('rejects an empty title and explains a version conflict', async () => {
    await openEditor('calendar_create', {
      routes: {
        [`PATCH /approvals/${M3.approval}`]: () => json(409, errorBody('APPROVAL_STATE_CONFLICT')),
      },
    });
    await fireEvent.changeText(await screen.findByTestId('approvalEditor.title'), '   ');
    await fireEvent.press(screen.getByTestId('approvalEditor.save'));
    expect(await screen.findByTestId('approvalEditor.error')).toHaveTextContent(
      'Bilgilerden biri geçersiz; kontrol et.',
    );
    await fireEvent.changeText(screen.getByTestId('approvalEditor.title'), 'Yeni başlık');
    expect(screen.queryByTestId('approvalEditor.error')).toBeNull();
    await fireEvent.press(screen.getByTestId('approvalEditor.save'));
    expect(await screen.findByTestId('approvalEditor.error')).toHaveTextContent(
      'Bu onay güncellendi; son hâlini incele.',
    );
  });

  it('moves a calendar update by duration only (no title field)', async () => {
    const { api } = await openEditor('calendar_update');
    const editor = await screen.findByTestId('approvalEditor.calendar_update');
    expect(within(editor).queryByTestId('approvalEditor.title')).toBeNull();
    await fireEvent.press(within(editor).getByTestId('approvalEditor.duration.30'));
    await fireEvent.press(within(editor).getByTestId('approvalEditor.save'));
    await waitFor(() => {
      expect(patchOf(api.calls)?.payload_patch).toMatchObject({
        changes: {
          time: {
            kind: 'timed',
            start: '2026-09-25T08:00:00.000Z',
            end: '2026-09-25T08:30:00.000Z',
          },
        },
      });
    });
  });

  it('edits a task: notes, and "Son tarih yok" drops the due date', async () => {
    const { api } = await openEditor('task_create');
    const editor = await screen.findByTestId('approvalEditor.task_create');
    await fireEvent.changeText(
      within(editor).getByTestId('approvalEditor.notes'),
      'Online ödenecek',
    );
    await fireEvent.press(within(editor).getByTestId('approvalEditor.noDue'));
    expect(within(editor).queryByTestId('approvalEditor.when')).toBeNull();
    await fireEvent.press(within(editor).getByTestId('approvalEditor.save'));
    await waitFor(() => {
      expect(patchOf(api.calls)?.payload_patch).toEqual({
        title: 'Faturayı öde',
        notes: 'Online ödenecek',
      });
    });
  });

  it('edits a reminder’s title and time', async () => {
    const { api } = await openEditor('reminder_create');
    await fireEvent.changeText(
      await screen.findByTestId('approvalEditor.title'),
      'Elektrik faturası',
    );
    await fireEvent.press(screen.getByTestId('approvalEditor.when.hour.down'));
    await fireEvent.press(screen.getByTestId('approvalEditor.save'));
    await waitFor(() => {
      expect(patchOf(api.calls)?.payload_patch).toEqual({
        title: 'Elektrik faturası',
        fire_at: '2026-09-25T05:00:00.000Z',
      });
    });
  });

  it('edits a commitment’s direction and removes its due date', async () => {
    const { api } = await openEditor('commitment_create');
    const editor = await screen.findByTestId('approvalEditor.commitment_create');
    await fireEvent.press(within(editor).getByTestId('ui.segmentedControl.they_owe'));
    await fireEvent.press(within(editor).getByTestId('approvalEditor.noDue'));
    await fireEvent.press(within(editor).getByTestId('approvalEditor.save'));
    await waitFor(() => {
      expect(patchOf(api.calls)?.payload_patch).toEqual({
        text: 'Teklifi gönder',
        direction: 'they_owe',
        due_at: null,
        due_precision: 'none',
      });
    });
  });

  it('re-proposes a failed approval with POST /approvals and opens the new one', async () => {
    const newId = uuid(1702);
    const { api } = await openEditor('task_create', {
      row: row('task_create', { status: 'failed', last_error_code: 'PROVIDER_UNAVAILABLE' }),
      routes: {
        'POST /approvals': () =>
          json(
            201,
            ok(
              view('task_create', {
                id: newId,
                idempotency_key: `approval:${newId}:v1`,
                payload_version: 1,
              }),
            ),
          ),
      },
    });
    expect(screen.getByText('Yeniden öner')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId('approvalEditor.save'));
    expect(await screen.findByTestId(`approvalSheet.single.${newId}`)).toBeOnTheScreen();
    expect(
      api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/approvals'))?.body,
    ).toMatchObject({
      payload: {
        action_type: 'task_create',
        title: 'Faturayı öde',
        due: { kind: 'date', date: '2026-09-26' },
      },
      origin_ref_id: null,
    });
    expect(events('approval_repropose').at(-1)?.props).toEqual({ action_type: 'task_create' });
  });

  it('shows "Onay yüklenemedi." for an unreadable payload', async () => {
    await openEditor('calendar_create', {
      row: row('calendar_create', { payload: { bozuk: true } }),
    });
    expect(await screen.findByTestId('approvalEditor.loadError')).toBeOnTheScreen();
  });

  it('blocks saving offline', async () => {
    await openEditor('reminder_create');
    await screen.findByTestId('approvalEditor.save');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByText('Çevrimdışıyken düzenleme kaydedilemez.')).toBeOnTheScreen();
    expect(screen.getByTestId('approvalEditor.save')).toBeDisabled();
  });
});
