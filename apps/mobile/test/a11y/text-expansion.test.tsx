/**
 * T-8.29 text expansion and Dynamic Type at maximum (SREQ-88, M-SET-61 tests): every catalog is
 * swapped for the `@da/i18n` pseudo-locale (accented, +40 % per text run, bracketed so a cut-off
 * end is visible) and the app text size is "En büyük" (1.3 × on top of the OS size). The key
 * screens — Today, Flow, Mail detail, the approval sheet, the Settings hub and the Paywall — render
 * without crashing, keep their labels, and no text is clipped by a fixed-size box.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, screen } from 'expo-router/testing-library';
import type * as I18n from '@da/i18n';
import type { TestInstance } from 'test-renderer';

import { openApprovalSheet } from '../../src/features/approvals/ApprovalSheet';
import { fromApprovalRow } from '../../src/features/approvals/model';
import { resetAppState } from '../helpers/app';
import { uuid } from '../helpers/fixtures';
import { a11yReport, allHosts, describeHost, openRoute, settle, styleOf } from './harness';

jest.mock('@da/i18n', () => {
  const actual = jest.requireActual<typeof I18n>('@da/i18n');
  return {
    ...actual,
    loadMessages: (locale: Parameters<typeof actual.loadMessages>[0]) =>
      actual.pseudoLocalizeMessages(actual.loadMessages(locale)),
  };
});

function texts(root: TestInstance): string[] {
  return allHosts(root)
    .filter((h) => h.type === 'Text')
    .flatMap((h) => h.children.filter((c): c is string => typeof c === 'string'));
}

/**
 * Text that expansion would cut off: a fixed height on the text or its box (clipped lines), or a
 * fixed width with a line limit (ellipsis). A fixed-width column whose text wraps (the kit's
 * key-value labels, the plan table columns) keeps every character. Text the kit caps at its
 * visual size on purpose (`maxFontSizeMultiplier` 1: avatar initials) is exempt.
 */
function clippedText(root: TestInstance): string[] {
  const out: string[] = [];
  for (const host of allHosts(root)) {
    if (host.type !== 'Text' || host.props.maxFontSizeMultiplier === 1) continue;
    const limited = typeof host.props.numberOfLines === 'number';
    for (const box of [host, host.parent].filter((b): b is TestInstance => b !== null)) {
      const style = styleOf(box);
      if (typeof style.height === 'number' || (limited && typeof style.width === 'number')) {
        out.push(`${describeHost(box)} ${JSON.stringify({ w: style.width, h: style.height })}`);
      }
    }
  }
  return out;
}

const MAX_TEXT = { theme: 'light', textScale: 'xl' } as const;

beforeEach(async () => {
  await resetAppState();
});

function check(): void {
  const root = screen.root;
  expect(root).toBeTruthy();
  if (root === null) return;
  // The pseudo-locale is active: catalog strings arrive bracketed.
  expect(texts(root).some((t) => t.includes('['))).toBe(true);
  expect(a11yReport(root).unlabeled).toEqual([]);
  expect(clippedText(root)).toEqual([]);
}

describe('pseudo-locale +40 % × "En büyük" (T-8.29)', () => {
  it.each(['/today', '/flow', '/mail/:id', '/settings', '/paywall'])('%s', async (pattern) => {
    await openRoute(pattern, MAX_TEXT);
    check();
  });

  it('the approval sheet', async () => {
    await openRoute('/settings', MAX_TEXT);
    const model = fromApprovalRow({
      id: uuid(700),
      action_type: 'calendar_create',
      status: 'pending',
      what: 'Teklif hazırlama',
      why: 'Mehmet yarın teklif bekliyor.',
      change_summary: 'Yarın 14:00–15:00',
      origin: 'insight',
      payload_version: 1,
      idempotency_key: 'approval:k:v1',
      created_at: '2026-09-23T08:00:00Z',
    });
    if (model === null) throw new Error('approval fixture');
    await act(async () => {
      openApprovalSheet({ approvals: [model], mode: 'single', origin: 'insight' });
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('sheet.approval')).toBeOnTheScreen();
    expect(screen.getByTestId('approvalSheet.approve')).toBeOnTheScreen();
    check();
  });
});
