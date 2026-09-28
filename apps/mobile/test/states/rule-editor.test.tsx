/**
 * T-8.21 · M-SET-51 rule editor with every condition (SCREEN_AND_FLOW_MAP M-SET-51): keyword
 * tokens with "Konu ve gövdede ara", sender validation, category and person (contact picker)
 * conditions, domain suggestions from own contacts, the outcome list, RPC-11 preview states
 * (samples, error, offline), editing an existing rule (enable switch, exceptions sheet with
 * categories and senders, update), the unsaved-changes dialog and a missing rule.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { resetAppState } from '../helpers/app';
import { uuid } from '../helpers/fixtures';
import { events, openApp } from '../helpers/journeys';
import type { PostgrestFake } from '../helpers/postgrest';
import { appRouter, nth } from './support';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const RULE_ID = uuid(1400);
const CONTACT = uuid(1401);

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    condition_type: 'keyword',
    condition_value: { keywords: ['teklif'] },
    outcome: 'high',
    applies_to: 'mail',
    enabled: true,
    search_body: true,
    exceptions: [{ condition_type: 'category', condition_value: { category: 'promotions' } }],
    match_count_30d: 9,
    last_matched_at: null,
    deleted_at: null,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    ...overrides,
  };
}

const CONTACTS = [
  {
    id: CONTACT,
    display_name: 'Ayşe Demir',
    primary_email: 'ayse@demirhukuk.com',
    message_count_30d: 30,
  },
  {
    id: uuid(1402),
    display_name: 'Kerem Kaya',
    primary_email: 'kerem@kuzeylojistik.com',
    message_count_30d: 12,
  },
  { id: uuid(1403), display_name: 'Selin', primary_email: null, message_count_30d: 4 },
];

async function openEditor(path: string, setup?: (db: PostgrestFake) => void) {
  return openApp({
    path,
    setup: (db) => {
      db.setTable('contacts', CONTACTS);
      db.setRpc('preview_priority_rule', {
        match_count: 6,
        sample: [
          { sender_label: 'Kuzey Lojistik', subject: 'Teklif', date: '2026-09-20T08:00:00Z' },
          { sender_label: 'Demir Hukuk', subject: null, date: '2026-09-21T08:00:00Z' },
        ],
        already_important: 2,
        will_move_up: 4,
      });
      setup?.(db);
    },
  });
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-SET-51 · new rules', () => {
  it('builds a keyword rule with body search and a chosen outcome', async () => {
    const { db } = await openEditor('/settings/priority-rules/new?type=keyword&value=teklif');
    await fireEvent.changeText(await screen.findByTestId('rule.keyword'), 'fatura');
    await fireEvent.press(screen.getByTestId('rule.keyword.add'));
    await fireEvent.changeText(screen.getByTestId('rule.keyword'), 'sözleşme');
    await fireEvent(screen.getByTestId('rule.keyword'), 'submitEditing');
    await fireEvent.press(screen.getByTestId('rule.searchBody'));
    await fireEvent.press(screen.getByTestId('rule.outcome.mute'));
    expect(
      await screen.findByText(
        '6 mail bu kurala uydu'.toLocaleUpperCase('tr-TR'),
        {},
        { timeout: 3000 },
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(/2 tanesi bugün zaten önemli sayılıyordu/)).toBeOnTheScreen();
    await waitFor(() => {
      expect(db.rpcCalls.at(-1)?.args).toEqual({
        p_condition_type: 'keyword',
        p_condition_value: { keywords: ['teklif', 'fatura', 'sözleşme'] },
        p_outcome: 'mute',
      });
    });
    await fireEvent.press(screen.getByTestId('rule.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'priority_rules',
        op: 'insert',
        values: {
          condition_type: 'keyword',
          condition_value: { keywords: ['teklif', 'fatura', 'sözleşme'] },
          outcome: 'mute',
          search_body: true,
          applies_to: 'mail',
        },
      });
    });
    expect(events('rule_preview_loaded').length).toBeGreaterThan(0);
  });

  it('validates a sender and saves a category rule', async () => {
    const { db } = await openEditor('/settings/priority-rules/new?type=sender&value=yanlis');
    expect(await screen.findByTestId('rule.save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('rule.sender'), 'fatura@elektrik.com.tr');
    expect(screen.getByTestId('rule.save')).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId('rule.condition.category'));
    await fireEvent.press(screen.getByTestId('rule.category.has_deadline'));
    await fireEvent.press(screen.getByTestId('rule.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toMatchObject({
        condition_type: 'category',
        condition_value: { category: 'has_deadline' },
      });
    });
  });

  it('picks a person from own contacts and suggests uncovered domains', async () => {
    const { db } = await openEditor('/settings/priority-rules/new?type=person');
    await fireEvent.press(await screen.findByTestId('rule.person'));
    const picker = await screen.findByTestId('sheet.contactPicker');
    await fireEvent.changeText(within(picker).getByTestId('contactPicker.search'), 'zzz');
    expect(await within(picker).findByTestId('contactPicker.empty')).toBeOnTheScreen();
    await fireEvent.changeText(within(picker).getByTestId('contactPicker.search'), 'ayşe');
    await fireEvent.press(await within(picker).findByTestId(`contactPicker.${CONTACT}`));
    expect(await screen.findByText('Ayşe Demir')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('rule.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toMatchObject({
        condition_type: 'person',
        condition_value: { contact_id: CONTACT },
      });
    });
  });

  it('offers own contacts’ domains and validates the domain', async () => {
    await openEditor('/settings/priority-rules/new?type=domain');
    await fireEvent.press(await screen.findByTestId('rule.suggestion.demirhukuk.com'));
    expect(screen.getByDisplayValue('demirhukuk.com')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('rule.domain'), 'gecersiz');
    expect(screen.getByTestId('rule.save')).toBeDisabled();
    expect(
      await screen.findByText('Koşulu tamamladığında son 30 günün önizlemesi burada görünür.'),
    ).toBeOnTheScreen();
  });

  it('shows the preview error', async () => {
    await openEditor('/settings/priority-rules/new?type=domain&value=ornek.com', (db) => {
      db.setRpc('preview_priority_rule', () => ({ data: null, error: { message: 'boom' } }));
    });
    expect(
      await screen.findByText('Önizleme şu an yüklenemedi.', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
  });

  it('explains that the preview needs a connection offline', async () => {
    await openEditor('/settings/priority-rules/new?type=domain&value=ornek.com');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.changeText(await screen.findByTestId('rule.domain'), 'baska.com');
    expect(
      await screen.findByText('Önizleme için internet gerekiyor.', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('rule.save')).toBeDisabled();
  });
});

describe('M-SET-51 · editing a rule', () => {
  it('edits exceptions, the switch and the outcome, then updates the rule', async () => {
    const { db } = await openEditor(`/settings/priority-rules/${RULE_ID}`, (fake) => {
      fake.setTable('priority_rules', [rule()]);
    });
    expect(await screen.findByText(/son 30 günde 9 mail etkilendi/)).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('rule.enabled'), 'valueChange', false);
    expect(screen.getByText('Kural kapalı')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('rule.moreOutcomes'));
    await fireEvent.press(await screen.findByTestId('rule.outcome.always_notify'));

    await fireEvent.press(screen.getByTestId('rule.exceptions'));
    const sheet = await screen.findByTestId('sheet.exceptions');
    await fireEvent.press(within(sheet).getByTestId('exceptions.category.promotions'));
    await fireEvent.press(within(sheet).getByTestId('exceptions.category.informational'));
    await fireEvent.changeText(within(sheet).getByTestId('exceptions.sender'), 'yanlis');
    await fireEvent.press(within(sheet).getByTestId('exceptions.add'));
    expect(await within(sheet).findByText('Geçerli bir e-posta gir.')).toBeOnTheScreen();
    await fireEvent.changeText(within(sheet).getByTestId('exceptions.sender'), 'Bulten@Ornek.com');
    await fireEvent.press(within(sheet).getByTestId('exceptions.add'));
    expect(await within(sheet).findByText('bulten@ornek.com')).toBeOnTheScreen();
    await fireEvent.changeText(
      within(sheet).getByTestId('exceptions.sender'),
      'kampanya@ornek.com',
    );
    await fireEvent.press(within(sheet).getByTestId('exceptions.add'));
    await fireEvent.press(nth(within(sheet).getAllByLabelText(/Kaldır/), -1));
    await fireEvent.press(within(sheet).getByTestId('exceptions.done'));
    expect(events('rule_exceptions_changed').at(-1)?.props).toEqual({ count: 2 });

    await fireEvent.press(screen.getByTestId('rule.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'priority_rules',
        op: 'update',
        values: {
          enabled: false,
          outcome: 'always_notify',
          exceptions: [
            { condition_type: 'category', condition_value: { category: 'informational' } },
            { condition_type: 'sender', condition_value: { address: 'bulten@ornek.com' } },
          ],
        },
      });
    });
    expect(events('priority_rule_updated').at(-1)?.props).toEqual({
      condition_type: 'keyword',
      outcome: 'always_notify',
    });
  });

  it('asks before leaving with unsaved changes', async () => {
    const { router } = await openEditor('/settings/priority-rules', (fake) => {
      fake.setTable('priority_rules', [rule()]);
    });
    await act(async () => {
      appRouter.push(`/settings/priority-rules/${RULE_ID}`);
      await Promise.resolve();
    });
    await fireEvent.press(await screen.findByTestId('rule.keyword.add'));
    await fireEvent.changeText(screen.getByTestId('rule.keyword'), 'fatura');
    await fireEvent.press(screen.getByTestId('rule.keyword.add'));
    await act(async () => {
      appRouter.back();
      await Promise.resolve();
    });
    const dialog = await screen.findByTestId('rule.leaveDialog');
    await fireEvent.press(within(dialog).getByText('Kaydetme'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/priority-rules');
    });
  });

  it('shows the not-found state for a deleted rule', async () => {
    await openEditor(`/settings/priority-rules/${RULE_ID}`, (fake) => {
      fake.setTable('priority_rules', [rule({ deleted_at: '2026-09-20T08:00:00Z' })]);
    });
    expect(await screen.findByTestId('rule.notFound')).toBeOnTheScreen();
  });
});
