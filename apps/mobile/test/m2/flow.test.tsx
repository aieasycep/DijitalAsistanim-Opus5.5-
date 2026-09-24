/**
 * T-8.10 · Akış (M-FLOW-01): the feed from RPC `flow_feed`, filter chips re-query with the chosen
 * filter, "Önemli değil" teaches the ranker for ordinary cards but only dismisses a security card
 * (security signals never learn to be quieter), and an empty filter shows its own empty state.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { renderApp, resetAppState } from '../helpers/app';
import { TS, uuid } from '../helpers/fixtures';
import { setup } from './harness';

function item(n: number, cardType: string, overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(n),
    card_type: cardType,
    kind: cardType === 'email' ? 'reply_needed' : 'security_alert',
    urgency: 'today',
    title: cardType === 'email' ? 'Teklif revizyonu bekleniyor' : 'Yeni cihazdan giriş',
    body:
      cardType === 'email' ? 'Mehmet Bey fiyatı soruyor.' : 'Hesabına yeni bir cihazdan girildi.',
    why_important: null,
    decision_tier: null,
    reason_code: null,
    entity_type: cardType === 'email' ? 'email_thread' : 'life_event',
    entity_id: uuid(n + 100),
    due_at: null,
    event_at: null,
    created_at: TS,
    source: {
      source_type: 'email_message',
      source_id: uuid(n + 200),
      provider: 'google',
      source_timestamp: TS,
    },
    ...overrides,
  };
}

const PAGE = {
  items: [item(1, 'email'), item(2, 'security')],
  next_cursor: null,
  meta: { total: 2, important: 1, last_analysis_at: null, accounts: [] },
};

beforeEach(async () => {
  await resetAppState();
});

describe('M-FLOW-01 · Akış', () => {
  it('renders the feed and re-queries with the chosen filter', async () => {
    const { fake } = setup({ data: { rpc: { flow_feed: () => PAGE } } });
    await renderApp('/flow');
    expect(await screen.findByText('Teklif revizyonu bekleniyor')).toBeOnTheScreen();
    expect(screen.getByText('Yeni cihazdan giriş')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('ui.filterChip.important'));
    await waitFor(() => {
      const filters = fake.data.calls
        .filter((c) => c.target === 'flow_feed')
        .map((c) => (c.args as { p_filter: string }).p_filter);
      expect(filters).toContain('important');
    });
  });

  it('dismisses a security card without a learning signal, but teaches the ranker for a mail card', async () => {
    const { fake } = setup({
      data: {
        rpc: {
          flow_feed: () => PAGE,
          set_insight_status: () => null,
          apply_insight_feedback: () => uuid(900),
        },
      },
    });
    await renderApp('/flow');
    const security = await screen.findByTestId(`flow.row.${uuid(2)}`);
    await fireEvent.press(within(security).getByLabelText('Diğer seçenekler'));
    await fireEvent.press(await screen.findByTestId('m2.menu.dismiss'));
    await waitFor(() => {
      expect(fake.data.calls.some((c) => c.target === 'set_insight_status')).toBe(true);
    });
    expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
      p_insight_id: uuid(2),
      p_status: 'dismissed',
    });
    expect(fake.data.calls.some((c) => c.target === 'apply_insight_feedback')).toBe(false);

    const mail = screen.getByTestId(`flow.row.${uuid(1)}`);
    await fireEvent.press(within(mail).getByLabelText('Diğer seçenekler'));
    await fireEvent.press(await screen.findByTestId('m2.menu.dismiss'));
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.target === 'apply_insight_feedback')?.args,
      ).toMatchObject({
        p_insight_id: uuid(1),
        p_kind: 'not_important',
      });
    });
  });

  it('shows the filter-specific empty state', async () => {
    setup();
    await renderApp('/flow');
    expect(await screen.findByTestId('flow.empty.all')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('ui.filterChip.personal'));
    expect(await screen.findByTestId('flow.empty.personal')).toBeOnTheScreen();
  });
});
