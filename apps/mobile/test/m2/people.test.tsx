/**
 * T-8.11 / T-8.12 · Waiting, Follow-ups, Commitments and the Life sheet: urgency grouping and order,
 * Free gates for follow-ups and commitments, commitment status in the user's zone, and a security
 * life event shown with guidance only (no links, no learning signal).
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { screen } from 'expo-router/testing-library';

import { renderApp, resetAppState } from '../helpers/app';
import { TS, uuid } from '../helpers/fixtures';
import { displayStatus, type CommitmentItem } from '../../src/features/commitments/data';
import { groupOf, sortWaiting, type PersonItem } from '../../src/features/followups/data';
import { setup } from './harness';

const person = (n: number, over: Partial<PersonItem>): PersonItem => ({
  id: uuid(n),
  title: `Konu ${String(n)}`,
  body: null,
  urgency: 'normal',
  dueAt: null,
  since: TS,
  messageId: null,
  threadId: null,
  person: `Kişi ${String(n)}`,
  personEmail: null,
  topic: null,
  provider: 'google',
  ...over,
});

const commitment = (over: Partial<CommitmentItem>): CommitmentItem => ({
  id: uuid(1),
  direction: 'user_owes',
  status: 'open',
  text: 'Teklifi gönder',
  quote: null,
  counterparty: 'Mehmet',
  contactId: null,
  dueAt: null,
  dueDateOnly: false,
  snoozedUntil: null,
  completedAt: null,
  sourceType: 'email_message',
  sourceId: uuid(90),
  sourceProvider: 'google',
  sourceTimestamp: TS,
  confidence: 0.9,
  corrected: false,
  ...over,
});

beforeEach(async () => {
  await resetAppState();
});

describe('M-FU-01 · Cevap Bekleyenler', () => {
  it('groups by urgency and orders by due date, then the longest wait', () => {
    expect(groupOf('urgent')).toBe('urgent');
    expect(groupOf('today')).toBe('today');
    expect(groupOf('low')).toBe('later');
    const sorted = sortWaiting([
      person(1, { since: '2026-09-20T08:00:00Z' }),
      person(2, { dueAt: '2026-09-25T08:00:00Z' }),
      person(3, { since: '2026-09-10T08:00:00Z' }),
    ]);
    expect(sorted.map((p) => p.id)).toEqual([uuid(2), uuid(3), uuid(1)]);
  });

  it('lists the people waiting for a reply from the open insights', async () => {
    setup({
      data: {
        tables: {
          insights: [
            {
              id: uuid(40),
              kind: 'reply_needed',
              status: 'open',
              title: 'Teklif sorusu',
              body: 'Fiyatı soruyor.',
              urgency: 'urgent',
              due_at: null,
              entity_type: 'email_thread',
              entity_id: uuid(91),
              source_type: 'email_message',
              source_id: uuid(90),
              source_provider: 'google',
              source_timestamp: TS,
              created_at: TS,
            },
          ],
          email_messages: [
            {
              id: uuid(90),
              thread_id: uuid(91),
              from_name: 'Mehmet Yılmaz',
              from_email: 'mehmet@example.com',
              to_emails: ['ahmet@example.com'],
              subject: 'Teklif',
              received_at: TS,
              provider: 'google',
            },
          ],
        },
      },
    });
    await renderApp('/waiting');
    expect(await screen.findByText('Mehmet Yılmaz')).toBeOnTheScreen();
    expect(screen.getByText(/^(Acil|ACİL)$/)).toBeOnTheScreen();
  });
});

describe('Pro gates', () => {
  it('shows the follow-up gate to a Free user', async () => {
    setup();
    await renderApp('/followups');
    expect(await screen.findByText('Takip hatırlatmaları Pro ile gelir.')).toBeOnTheScreen();
  });

  it('shows the commitments gate to a Free user', async () => {
    setup();
    await renderApp('/commitments');
    expect(await screen.findByText('Taahhüt takibi Pro ile gelir.')).toBeOnTheScreen();
  });
});

describe('M-COM-01 · status in the user zone', () => {
  const at = new Date('2026-09-24T09:00:00Z');
  it('derives overdue, today, open, snoozed and done', () => {
    const tz = 'Europe/Istanbul';
    expect(displayStatus(commitment({ dueAt: '2026-09-23T09:00:00Z' }), tz, at)).toBe('overdue');
    expect(displayStatus(commitment({ dueAt: '2026-09-24T15:00:00Z' }), tz, at)).toBe('today');
    expect(displayStatus(commitment({ dueAt: '2026-09-24T06:00:00Z' }), tz, at)).toBe('overdue');
    expect(
      displayStatus(commitment({ dueAt: '2026-09-24T06:00:00Z', dueDateOnly: true }), tz, at),
    ).toBe('today');
    expect(displayStatus(commitment({ dueAt: '2026-09-30T09:00:00Z' }), tz, at)).toBe('open');
    expect(displayStatus(commitment({ status: 'snoozed' }), tz, at)).toBe('snoozed');
    expect(displayStatus(commitment({ status: 'done' }), tz, at)).toBe('done');
  });

  it('lists open commitments for a Pro user', async () => {
    setup({
      pro: true,
      data: {
        tables: {
          commitments: [
            {
              id: uuid(50),
              direction: 'user_owes',
              status: 'open',
              text: 'Revize teklifi gönder',
              evidence: [],
              user_overrides: {},
              counterparty_name: 'Mehmet',
              contact: null,
              contact_id: null,
              due_at: null,
              due_is_date_only: false,
              snoozed_until: null,
              completed_at: null,
              source_type: 'email_message',
              source_id: uuid(90),
              source_provider: 'google',
              source_timestamp: TS,
              confidence: 0.9,
            },
          ],
        },
      },
    });
    await renderApp('/commitments');
    expect(await screen.findByText('Revize teklifi gönder')).toBeOnTheScreen();
  });
});

describe('M-LIFE-01 · security signal', () => {
  it('shows guidance and no link-out for a security event', async () => {
    setup({
      data: {
        tables: {
          life_events: [
            {
              id: uuid(60),
              type: 'security',
              title: 'Yeni cihazdan giriş',
              status: 'open',
              payload: { device: 'iPhone', location: 'Ankara' },
              event_at: TS,
              due_at: null,
              grounded: true,
              source_type: 'email_message',
              source_id: uuid(90),
              source_provider: 'google',
              source_timestamp: TS,
              created_at: TS,
            },
          ],
        },
      },
    });
    await renderApp(`/life/${uuid(60)}`);
    expect(await screen.findByText(/şifreni hesabın kendi uygulamasından/)).toBeOnTheScreen();
    expect(screen.queryByText('Yol Tarifi')).toBeNull();
  });
});
