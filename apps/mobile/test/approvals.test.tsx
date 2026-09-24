/**
 * T-8.18 Approval Center (M-APPR-01…03), the inline approval sheet (M-APPR-04) and the device
 * executor: sections from RPC-10, approve with the approval's own key and `approved_via`
 * (R-03), offline blocks every decision (never queued), the R-06 client undo delay before the
 * approve request, and device writes reported through API-APR-05.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { onlineManager } from '@tanstack/react-query';
import * as Calendar from 'expo-calendar/legacy';
import { createHash } from 'node:crypto';

import { APPROVE_UNDO_MS, openApprovalSheet } from '../src/features/approvals/ApprovalSheet';
import { fromApprovalView } from '../src/features/approvals/model';
import { pollDelay } from '../src/features/approvals/api';
import { sectionize } from '../src/features/approvals/ApprovalCenterScreen';
import { installationId } from '../src/lib/auth/first-run-purge';
import { json, resetAppState } from './helpers/app';
import { M3, approvalRow, approvalView, approveResponse } from './helpers/assist';
import { ok } from './helpers/fixtures';
import { events, openApp } from './helpers/journeys';

const APPROVE = `POST /approvals/${M3.approval}/approve`;

beforeEach(async () => {
  await resetAppState();
});

describe('approval model and polling (R-19)', () => {
  it('polls 1 s for 5 s, 2 s until 20 s, 5 s until 60 s, then stops', () => {
    expect(pollDelay(0)).toBe(1_000);
    expect(pollDelay(6_000)).toBe(2_000);
    expect(pollDelay(30_000)).toBe(5_000);
    expect(pollDelay(61_000)).toBeNull();
  });

  it('sorts pending by expiry and keeps today-completed and 24 h failures', () => {
    const at = new Date('2026-09-24T10:00:00Z');
    const models = [
      fromApprovalView(
        approvalView({ id: M3.approval, approval_expires_at: '2026-09-30T08:00:00Z' }) as never,
      ),
      fromApprovalView(
        approvalView({ id: M3.approval2, approval_expires_at: '2026-09-25T08:00:00Z' }) as never,
      ),
    ];
    const sections = sectionize(models, at, 'Europe/Istanbul');
    expect(sections.pending.map((m) => m.id)).toEqual([M3.approval2, M3.approval]);
  });
});

describe('Approval Center (M-APPR-01)', () => {
  it('approves from the center with the approval key and approved_via approval_center', async () => {
    const { api } = await openApp({
      path: '/approvals',
      setup: (db) => {
        db.setRpc('list_approvals', (args: Readonly<Record<string, unknown>>) => ({
          data: {
            items: (args.p_status as string[]).includes('pending') ? [approvalRow()] : [],
            next_cursor: null,
          },
          error: null,
        }));
        db.setTable('approval_actions', [approvalRow()]);
      },
      routes: {
        [APPROVE]: () =>
          json(202, ok(approveResponse({ status: 'executing', approved_via: 'approval_center' }))),
      },
    });
    const card = await screen.findByTestId(`approvals.card.${M3.approval}`);
    expect(within(card).getByText('Faturayı öde')).toBeOnTheScreen();
    expect(screen.getByText('Onay Bekleyenler')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Onayla'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith(`/approvals/${M3.approval}/approve`))).toBe(true);
    });
    const call = api.calls.find((c) => c.url.endsWith('/approve'));
    expect(call?.body).toEqual({
      idempotency_key: `approval:${M3.approval}:v1`,
      payload_version: 1,
      approved_via: 'approval_center',
    });
    expect(call?.headers['idempotency-key']).toBe(`approval:${M3.approval}:v1`);
    expect(events('approval_decided')[0]?.props).toMatchObject({
      decision: 'approved',
      via: 'approval_center',
    });
    expect(events('approval_center_view')[0]?.props).toEqual({ pending_count_bucket: '1' });
  });

  it('blocks every decision offline and never queues it (M§94)', async () => {
    const { api } = await openApp({
      path: '/approvals',
      setup: (db) => {
        db.setRpc('list_approvals', (args: Readonly<Record<string, unknown>>) => ({
          data: {
            items: (args.p_status as string[]).includes('pending') ? [approvalRow()] : [],
            next_cursor: null,
          },
          error: null,
        }));
      },
    });
    const card = await screen.findByTestId(`approvals.card.${M3.approval}`);
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByTestId('approvals.offline')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Onayla'));
    await fireEvent.press(within(card).getByText('Reddet'));
    expect(api.calls.some((c) => c.url.includes('/approvals/'))).toBe(false);
    expect(events('offline_blocked_action').map((e) => e.props.action)).toEqual([
      'approve',
      'reject',
    ]);
  });

  it('shows the empty state and opens the history filters', async () => {
    await openApp({
      path: '/approvals',
      setup: (db) => {
        db.setRpc('list_approvals', { items: [], next_cursor: null });
      },
    });
    expect(await screen.findByText('Onay bekleyen işlem yok.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Geçmişi gör'));
    expect(await screen.findByText('Onay geçmişi')).toBeOnTheScreen();
    expect(screen.getByText('Tamamlanan')).toBeOnTheScreen();
    expect(await screen.findByText('Henüz geçmiş yok.')).toBeOnTheScreen();
  });

  it('renders the detail with the exact change and the not-found state', async () => {
    await openApp({
      path: `/approvals/${M3.approval}`,
      setup: (db) => {
        db.setTable('approval_actions', [
          approvalRow({
            action_type: 'calendar_update',
            exact_change: {
              kind: 'update',
              fields: [{ field: 'time', before: '14:30', after: '16:30' }],
              card: {
                destination: {
                  target_kind: 'provider',
                  provider: 'google',
                  account_label: 'yunus@example.com',
                  container_label: 'İş',
                },
              },
            },
          }),
        ]);
        db.setTable('approval_events', [
          {
            approval_action_id: M3.approval,
            from_status: null,
            to_status: 'pending',
            actor: 'system',
            reason: null,
            payload_version: 1,
            created_at: '2026-09-24T06:00:00Z',
          },
        ]);
      },
    });
    expect(await screen.findByTestId('screen.approvalDetail')).toBeOnTheScreen();
    expect((await screen.findAllByText('14:30 → 16:30')).length).toBeGreaterThan(0);
    expect(screen.getByText('yunus@example.com · İş')).toBeOnTheScreen();
    expect(await screen.findByText('Oluşturuldu')).toBeOnTheScreen();
    expect(screen.getByText(`Destek kodu: ${M3.approval.slice(0, 8)}`)).toBeOnTheScreen();
  });
});

describe('inline approval sheet (M-APPR-04, R-06)', () => {
  it('sends nothing during the 5 s undo window and approves only after it', async () => {
    const { api } = await openApp({
      routes: {
        [APPROVE]: () =>
          json(202, ok(approveResponse({ status: 'executing', approved_via: 'inline_sheet' }))),
      },
    });
    const model = fromApprovalView(approvalView() as never);
    await act(async () => {
      openApprovalSheet({ approvals: [model], mode: 'single', origin: 'assistant' });
      await Promise.resolve();
    });
    expect(await screen.findByText('Onay gerekiyor')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('approvalSheet.approve'));
    expect(await screen.findByText('Onaylandı · 1 işlem')).toBeOnTheScreen();
    // "Geri al" inside the window: nothing is sent and the sheet comes back.
    await fireEvent.press(screen.getByText('Geri al'));
    expect(await screen.findByText('Onay gerekiyor')).toBeOnTheScreen();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(APPROVE_UNDO_MS + 1_000);
    });
    expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(false);
    expect(events('approval_undo')[0]?.props).toEqual({ mode: 'single', count: 1 });
    await fireEvent.press(screen.getByTestId('approvalSheet.approve'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(APPROVE_UNDO_MS - 1_000);
    });
    expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_500);
    });
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/approve'))?.body).toMatchObject({
      approved_via: 'inline_sheet',
    });
  });
});

describe('device executor (API-APR-05)', () => {
  it('writes the event with the marker and reports the result with a hashed id', async () => {
    const hash = createHash('sha256').update('cal:cal-1').digest('hex');
    jest
      .mocked(Calendar.getCalendarsAsync)
      .mockResolvedValue([{ id: 'cal-1', title: 'Takvim', allowsModifications: true } as never]);
    const installation = installationId() ?? '';
    const payload = {
      action_type: 'calendar_create',
      target: {
        kind: 'device',
        provider: 'apple_device',
        installation_id: installation,
        device_calendar_hash: hash,
      },
      title: 'Planlama',
      time: {
        kind: 'timed',
        start: '2026-09-25T07:00:00Z',
        end: '2026-09-25T07:30:00Z',
        time_zone: 'Europe/Istanbul',
      },
      attendees: [],
      reminders_minutes: [],
    };
    const deviceView = {
      action_type: 'calendar_create',
      exact_change: { kind: 'create', fields: [] },
      destination: {
        target_kind: 'device',
        provider: 'apple_device',
        account_label: null,
        container_label: 'Takvim',
      },
      side_effects: [{ code: 'device_write', text: 'Etkinlik bu cihazdaki takvime yazılır.' }],
      executor: 'device',
      device_installation_id: installation,
    };
    const { api } = await openApp({
      path: '/approvals',
      setup: (db) => {
        db.setRpc('list_approvals', (args: Readonly<Record<string, unknown>>) => ({
          data: {
            items: (args.p_status as string[]).includes('pending')
              ? [
                  approvalRow({
                    action_type: 'calendar_create',
                    executor: 'device',
                    device_installation_id: installation,
                    exact_change: {
                      kind: 'create',
                      fields: [],
                      card: { destination: deviceView.destination },
                    },
                    side_effects: deviceView.side_effects,
                  }),
                ]
              : [],
            next_cursor: null,
          },
          error: null,
        }));
      },
      routes: {
        [APPROVE]: () =>
          json(
            202,
            ok(
              approveResponse(
                { ...deviceView, status: 'executing', approved_via: 'approval_center' },
                { mode: 'device', device_token: 'A'.repeat(43), instructions: payload },
              ),
            ),
          ),
        [`POST /approvals/${M3.approval}/device-execution`]: () =>
          json(
            200,
            ok(
              approvalView({
                ...deviceView,
                status: 'executed',
                executed_at: '2026-09-24T07:00:00Z',
                result: { web_link: null, summary: 'Takvimine eklendi.' },
              }),
            ),
          ),
      },
    });
    const card = await screen.findByTestId(`approvals.card.${M3.approval}`);
    await fireEvent.press(within(card).getByText('Onayla'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/device-execution'))).toBe(true);
    });
    expect(Calendar.createEventAsync).toHaveBeenCalledWith(
      'cal-1',
      expect.objectContaining({ title: 'Planlama', notes: `[da:${M3.approval}]` }),
    );
    const report = api.calls.find((c) => c.url.endsWith('/device-execution'))?.body as Record<
      string,
      unknown
    >;
    expect(report).toMatchObject({
      phase: 'result',
      installation_id: installation,
      status: 'executed',
      already_existed: false,
      device_ref_hash: createHash('sha256').update('device-event-1').digest('hex'),
    });
  });
});
