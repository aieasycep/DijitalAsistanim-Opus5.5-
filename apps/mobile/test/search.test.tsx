/**
 * T-8.15 Search (M-SRCH-01) and Memory (M-MEM-01): debounced `GET /search` in results mode with
 * grouped rows that open their screen, the Pro gate on the memory scope and screen for Free, and
 * the Pro memory answer with its sources (`mode=answer`).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { json, resetAppState } from './helpers/app';
import { M3 } from './helpers/assist';
import { TS, ok } from './helpers/fixtures';
import { events, openApp, proBootstrap } from './helpers/journeys';

function result(type: string, id: string, title: string, route: string) {
  return {
    type,
    id,
    title,
    snippet: 'Teklif hakkında',
    source: {
      source_type: type === 'person' ? 'contact' : 'email_message',
      source_id: id,
      source_provider: 'google',
      source_timestamp: TS,
    },
    score: 0.9,
    route,
  };
}

async function typeQuery(testID: string, text: string) {
  await fireEvent.changeText(screen.getByTestId(testID), text);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
}

beforeEach(async () => {
  await resetAppState();
});

describe('Search (M-SRCH-01)', () => {
  it('searches after the debounce, groups the results and opens a person', async () => {
    const { api, router } = await openApp({
      path: '/search',
      routes: {
        'GET /search': () =>
          json(
            200,
            ok({
              mode: 'hybrid',
              results: [result('person', M3.contact, 'Mehmet Yılmaz', `/person/${M3.contact}`)],
            }),
          ),
      },
    });
    await screen.findByTestId('screen.search');
    await typeQuery('search.field', 'mehmet');
    expect(await screen.findByText('Mehmet Yılmaz')).toBeOnTheScreen();
    const call = api.calls.find((c) => c.url.includes('/search?'));
    expect(call?.url).toContain('q=mehmet');
    expect(call?.url).toContain('mode=results');
    expect(events('search_performed')[0]?.props).toMatchObject({
      mode: 'hybrid',
      result_count: 1,
      has_contact_filter: false,
    });
    await fireEvent.press(screen.getByTestId(`search.result.${M3.contact}`));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/person/${M3.contact}`);
    });
    expect(events('search_result_opened')[0]?.props).toEqual({
      result_type: 'person',
      rank_bucket: '1',
    });
  });

  it('gates the memory scope for Free without calling the API', async () => {
    const { api } = await openApp({ path: '/search?types=memory' });
    expect(await screen.findByTestId('search.memoryGate')).toBeOnTheScreen();
    await typeQuery('search.field', 'teklif');
    expect(api.calls.some((c) => c.url.includes('/search?'))).toBe(false);
  });
});

describe('Memory (M-MEM-01)', () => {
  it('shows the Pro gate on Free', async () => {
    await openApp({ path: '/memory' });
    expect(await screen.findByTestId('memory.gate')).toBeOnTheScreen();
  });

  it('answers with sources on Pro', async () => {
    const text = 'Teklifi 12 Eylül’de gönderdin.';
    const { api } = await openApp({
      data: proBootstrap(),
      path: '/memory?q=teklif%20ne%20zaman',
      routes: {
        'GET /search': () =>
          json(
            200,
            ok({
              mode: 'hybrid',
              results: [],
              answer: {
                text,
                emphasis_spans: [],
                confidence_label: 'high',
                source_count: 1,
              },
              sources: [result('email', M3.message, 'Teklif', `/mail/${M3.message}`)],
            }),
          ),
      },
    });
    expect(await screen.findByTestId('memory.answer')).toBeOnTheScreen();
    expect(screen.getByTestId('memory.answer.text')).toHaveTextContent(text);
    expect(screen.getByTestId(`memory.source.${M3.message}`)).toBeOnTheScreen();
    expect(api.calls.find((c) => c.url.includes('/search?'))?.url).toContain('mode=answer');
    expect(events('memory_answer_shown')[0]?.props).toEqual({
      confidence_label: 'assertive',
      source_count_bucket: '1',
    });
  });
});
