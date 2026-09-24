/**
 * T-8.21 AI personalization and priority rules: the learned-preference list (toggle, soft delete
 * with undo, priority edit writing only `priority_override`), the rules list grouped by outcome
 * with optimistic toggles, the editor (validation, RPC-11 preview, insert, duplicate, delete +
 * undo) and the acceptance check that an explicit rule overrides the AI result.
 */
import { evaluatePriority } from '@da/domain';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';

import {
  EMPTY_DRAFT,
  conditionValueOf,
  ruleFromDraft,
  validateDraft,
  type RuleDraft,
} from '../src/features/rules/rules';
import { suggestedDomains } from '../src/features/rules/RuleEditorScreen';
import { resetAppState } from './helpers/app';
import { uuid } from './helpers/fixtures';
import { events, openApp } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

beforeEach(async () => {
  await resetAppState();
});

const RULE_ID = uuid(501);

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    condition_type: 'domain',
    condition_value: { domain: 'yilmazendustri.com' },
    outcome: 'always_important',
    applies_to: 'mail',
    enabled: true,
    search_body: false,
    exceptions: [],
    match_count_30d: 14,
    last_matched_at: null,
    deleted_at: null,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    ...overrides,
  };
}

function learned(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(601),
    group_key: 'topics',
    statement: 'Toplu bültenler düşük öncelikli.',
    target_type: 'category',
    effect: { priority: 'low' },
    priority_override: null,
    evidence_summary: '3 kez “önemli değil” dedin',
    enabled: true,
    deleted_at: null,
    updated_at: '2026-09-20T08:00:00Z',
    ...overrides,
  };
}

describe('acceptance: an explicit rule overrides the AI result', () => {
  it('ranks a mail low when a domain rule says so, even if the AI calls it important', () => {
    const draft: RuleDraft = {
      ...EMPTY_DRAFT,
      condition: 'domain',
      domain: '@Firma.com',
      outcome: 'low',
    };
    expect(validateDraft(draft)).toBeNull();
    expect(conditionValueOf(draft)).toEqual({ domain: 'firma.com' });
    const result = evaluatePriority(
      { source: 'mail', fromEmail: 'ceo@firma.com', subject: 'Acil teklif' },
      {
        rules: [
          ruleFromDraft(draft, { id: RULE_ID, userId: uuid(1), now: '2026-09-24T08:00:00Z' }),
        ],
        learned: [],
        vip: { contactIds: [] },
        isPro: false,
        learnFromInteractions: true,
      },
      { category: 'important', confidence: 0.95 },
    );
    expect(result.decision_tier).toBe('explicit_rule');
    expect(result.rule_id).toBe(RULE_ID);
    expect(result.importance).toBe('low');
  });

  it('validates each condition', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, domain: 'not a domain' })).toBe('domain');
    expect(validateDraft({ ...EMPTY_DRAFT, condition: 'keyword' })).toBe('keywords');
    expect(validateDraft({ ...EMPTY_DRAFT, condition: 'sender', sender: 'noreply@*' })).toBeNull();
    expect(validateDraft({ ...EMPTY_DRAFT, condition: 'sender', sender: 'x' })).toBe('sender');
    expect(validateDraft({ ...EMPTY_DRAFT, condition: 'category' })).toBe('category');
    expect(validateDraft({ ...EMPTY_DRAFT, condition: 'person' })).toBe('person');
  });

  it('suggests uncovered domains from own contacts', () => {
    const contacts = [
      {
        id: uuid(1),
        display_name: 'A',
        primary_email: 'a@kuzeylojistik.com',
        message_count_30d: 9,
      },
      {
        id: uuid(2),
        display_name: 'B',
        primary_email: 'b@yilmazendustri.com',
        message_count_30d: 20,
      },
      { id: uuid(3), display_name: 'C', primary_email: null, message_count_30d: 50 },
    ];
    expect(suggestedDomains(contacts, [rule() as never])).toEqual(['kuzeylojistik.com']);
  });
});

describe('M-SET-50 priority rules list', () => {
  it('groups rules by outcome with their 30-day counts and toggles optimistically', async () => {
    const { db } = await openApp({
      path: '/settings/priority-rules',
      setup: (fake) => {
        fake.setTable('priority_rules', [
          rule(),
          rule({
            id: uuid(502),
            condition_type: 'keyword',
            condition_value: { keywords: ['teklif', 'fatura'] },
            outcome: 'high',
            match_count_30d: 22,
          }),
        ]);
      },
    });
    expect(await screen.findByText('@yilmazendustri.com adresinden gelenler')).toBeTruthy();
    expect(screen.getByText('Alan adı · 14 mail · son 30 gün')).toBeTruthy();
    expect(screen.getByText('“teklif”, “fatura” içerenler')).toBeTruthy();
    expect(screen.getByTestId('rules.group.always_important')).toBeTruthy();
    expect(screen.getByTestId('rules.group.high')).toBeTruthy();
    expect(screen.queryByTestId('rules.group.mute')).toBeNull();
    await fireEvent(screen.getByTestId(`rules.toggle.${RULE_ID}`), 'valueChange', false);
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'priority_rules',
        values: { enabled: false },
      });
    });
    expect(events('priority_rules_opened').at(-1)?.props).toMatchObject({ count: 2 });
    await fireEvent.press(screen.getByTestId('rules.precedence'));
    expect(await screen.findByText('Öncelik nasıl belirlenir?')).toBeTruthy();
  });

  it('shows the empty state with a real CTA', async () => {
    const { router } = await openApp({ path: '/settings/priority-rules' });
    expect(await screen.findByTestId('rules.empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rules.add'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/priority-rules/new');
    });
  });
});

describe('M-SET-51 rule editor', () => {
  it('previews over the last 30 days and inserts the rule', async () => {
    const { db } = await openApp({
      path: '/settings/priority-rules/new?type=domain&value=kuzeylojistik.com',
      setup: (fake) => {
        fake.setRpc('preview_priority_rule', {
          match_count: 14,
          sample: [
            { sender_label: 'Kuzey Lojistik', subject: 'Sevkiyat', date: '2026-09-20T08:00:00Z' },
          ],
          already_important: 3,
          will_move_up: 11,
        });
      },
    });
    expect(
      await screen.findByText('14 mail bu kurala uydu'.toLocaleUpperCase('tr-TR')),
    ).toBeTruthy();
    expect(db.rpcCalls.find((c) => c.name === 'preview_priority_rule')?.args).toEqual({
      p_condition_type: 'domain',
      p_condition_value: { domain: 'kuzeylojistik.com' },
      p_outcome: 'always_important',
    });
    await fireEvent.press(screen.getByTestId('rule.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'priority_rules',
        op: 'insert',
        values: {
          condition_type: 'domain',
          condition_value: { domain: 'kuzeylojistik.com' },
          outcome: 'always_important',
          user_id: uuid(1),
        },
      });
    });
    expect(events('priority_rule_created').at(-1)?.props).toMatchObject({
      condition_type: 'domain',
      outcome: 'always_important',
    });
  });

  it('reports a duplicate rule and a failed save', async () => {
    const { db } = await openApp({
      path: '/settings/priority-rules/new?type=domain&value=kuzeylojistik.com',
      setup: (fake) => {
        fake.failWrites('priority_rules', 'duplicate key value violates unique constraint');
      },
    });
    await fireEvent.press(await screen.findByTestId('rule.save'));
    expect(await screen.findByText('Bu kural zaten var.')).toBeTruthy();
    db.failWrites('priority_rules', 'permission denied');
    await fireEvent.press(screen.getByTestId('rule.save'));
    expect(await screen.findByText('Kaydedilemedi. Tekrar dene.')).toBeTruthy();
  });

  it('deletes with a confirmation and restores with undo', async () => {
    const { db } = await openApp({
      path: `/settings/priority-rules/${RULE_ID}`,
      setup: (fake) => {
        fake.setTable('priority_rules', [rule()]);
      },
    });
    await fireEvent.press(await screen.findByTestId('rule.delete'));
    await fireEvent.press(await screen.findByTestId('ui.confirmDialog.confirm'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toMatchObject({ deleted_at: expect.any(String) });
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({ deleted_at: null });
    });
    expect(events('priority_rule_restored')).toHaveLength(1);
  });
});

describe('M-SET-45 / M-SET-46 AI personalization', () => {
  it('toggles, edits only priority_override, deletes with undo', async () => {
    const { db } = await openApp({
      path: '/settings/personalization',
      setup: (fake) => {
        fake.setTable('learned_preferences', [learned()]);
      },
    });
    expect(await screen.findByText('Toplu bültenler düşük öncelikli.')).toBeTruthy();
    expect(screen.getByText('3 kez “önemli değil” dedin')).toBeTruthy();

    await fireEvent(
      screen.getByTestId(`personalization.toggle.${uuid(601)}`),
      'valueChange',
      false,
    );
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'learned_preferences',
        values: { enabled: false },
      });
    });

    await fireEvent.press(screen.getByTestId(`personalization.edit.${uuid(601)}`));
    await fireEvent.press(await screen.findByTestId('learnedEdit.high'));
    await fireEvent.press(screen.getByTestId('learnedEdit.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({ priority_override: 'high' });
    });

    await fireEvent.press(screen.getByTestId(`personalization.delete.${uuid(601)}`));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toMatchObject({ deleted_at: expect.any(String) });
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({ deleted_at: null });
    });
    expect(events('learned_pref_restored')).toHaveLength(1);
  });

  it('turns learning off through user_preferences', async () => {
    const { db } = await openApp({ path: '/settings/personalization' });
    expect(await screen.findByTestId('personalization.empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('personalization.learn'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'user_preferences',
        values: { learn_from_interactions: false },
      });
    });
  });
});
