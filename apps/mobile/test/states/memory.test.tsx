/**
 * T-8.15 · M-MEM-01 AI Hafıza (SCREEN_AND_FLOW_MAP M-MEM-01, API_CONTRACTS `GET /search?mode=answer`):
 * the idle state (recents, examples), the grounded answer with emphasis and its qualitative label,
 * opening a source and a related question, "Asistana sor", filters sent as `types` / `from` /
 * `contact_id` and cleared from the no-results state, the retention exclusion, the unsure and
 * no-summary answers, each error, offline, and the Free gate's link to Search.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { pushRecent, readRecents } from '../../src/features/search/recents';
import { json, resetAppState, type RecordedCall, type Responder } from '../helpers/app';
import { M3 } from '../helpers/assist';
import { errorBody, ok, TS, uuid } from '../helpers/fixtures';
import { events, openApp, proBootstrap } from '../helpers/journeys';

const MAIL = uuid(2500);

function source(id: string, title: string) {
  return {
    type: 'email',
    id,
    title,
    snippet: 'Teklif hakkında',
    source: {
      source_type: 'email_message',
      source_id: id,
      source_provider: 'google',
      source_timestamp: TS,
    },
    score: 0.9,
    route: `/mail/${id}`,
  };
}

function answer(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'hybrid',
    results: [],
    answer: {
      text: 'Teklifi 12 Eylül’de gönderdin.',
      emphasis_spans: [{ start: 8, end: 17 }],
      confidence_label: 'partial',
      source_count: 1,
    },
    sources: [source(MAIL, 'Teklif v2')],
    related_questions: ['Teklife cevap geldi mi?'],
    ...overrides,
  };
}

const searchCalls = (calls: readonly RecordedCall[]) =>
  calls.filter((c) => c.url.includes('/search?')).map((c) => new URL(c.url).searchParams);

function openMemory(respond: Responder, path = '/memory') {
  return openApp({ data: proBootstrap(), path, routes: { 'GET /search': respond } });
}

async function submit(text: string) {
  await fireEvent.changeText(await screen.findByTestId('memory.field'), text);
  await fireEvent(screen.getByTestId('memory.field'), 'submitEditing');
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-MEM-01 · AI Hafıza', () => {
  it('answers an example question with sources, related questions and "Asistana sor"', async () => {
    const { api, router } = await openMemory(() => json(200, ok(answer())));
    await fireEvent.press(await screen.findByText('Geçen ay aldığım uçak bileti neydi?'));
    expect(await screen.findByTestId('memory.answer')).toBeOnTheScreen();
    expect(screen.getByTestId('memory.answer.text')).toHaveTextContent(
      'Teklifi 12 Eylül’de gönderdin.',
    );
    expect(screen.getByText('1 kaynaktan · Kısmi eşleşme')).toBeOnTheScreen();
    expect(searchCalls(api.calls)[0]?.get('mode')).toBe('answer');
    expect(events('memory_search_submitted').at(-1)?.props).toEqual({
      filter: 'all',
      has_date_filter: false,
      scoped: false,
    });
    expect(events('memory_answer_shown').at(-1)?.props).toEqual({
      confidence_label: 'probably',
      source_count_bucket: '1',
    });
    expect(readRecents('memory.recents')).toEqual(['Geçen ay aldığım uçak bileti neydi?']);

    await fireEvent.press(screen.getByText('Teklife cevap geldi mi?'));
    await waitFor(() => {
      expect(searchCalls(api.calls).at(-1)?.get('q')).toBe('Teklife cevap geldi mi?');
    });
    await fireEvent.press(await screen.findByText('Orijinali Aç'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MAIL}`);
    });
    expect(events('memory_result_opened').at(-1)?.props).toEqual({
      source_type: 'email_message',
      rank_bucket: '1',
    });
  });

  it('hands the question to the assistant', async () => {
    const { router } = await openMemory(() => json(200, ok(answer())), '/memory?q=teklif');
    await fireEvent.press(await screen.findByTestId('memory.askAssistant'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/chat/new');
    });
    expect(router.getSearchParams()).toMatchObject({ prompt: 'teklif', origin: 'memory' });
  });

  it('reruns a recent question', async () => {
    pushRecent('memory.recents', 'uçak bileti');
    const { api } = await openMemory(() => json(200, ok(answer())));
    await fireEvent.press(await screen.findByText('uçak bileti'));
    await waitFor(() => {
      expect(searchCalls(api.calls).at(-1)?.get('q')).toBe('uçak bileti');
    });
  });

  it('clears the recent questions', async () => {
    pushRecent('memory.recents', 'uçak bileti');
    await openMemory(() => json(200, ok(answer())));
    await fireEvent.press(await screen.findByText('Temizle'));
    expect(screen.queryByText('uçak bileti')).toBeNull();
    expect(readRecents('memory.recents')).toEqual([]);
  });

  it('sends the filters and clears them from the empty result', async () => {
    const contact = M3.contact;
    const { api } = await openMemory(
      () => json(200, ok({ mode: 'hybrid', results: [], sources: [] })),
      `/memory?q=teklif&filter=email&recent=30d&contactId=${contact}`,
    );
    expect(await screen.findByTestId('memory.noResults')).toBeOnTheScreen();
    const first = searchCalls(api.calls)[0];
    expect(first?.get('types')).toBe('email');
    expect(first?.get('contact_id')).toBe(contact);
    expect(first?.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events('memory_no_results').at(-1)?.props).toEqual({ reason: 'none' });
    await fireEvent.press(screen.getByTestId('memory.clearFilters'));
    await waitFor(() => {
      const last = searchCalls(api.calls).at(-1);
      expect(last?.get('types')).toBeNull();
      expect(last?.get('contact_id')).toBeNull();
      expect(last?.get('from')).toBeNull();
    });
    expect(screen.queryByTestId('memory.clearFilters')).toBeNull();
  });

  it('switches the filter chips and removes the person scope', async () => {
    const { api } = await openMemory(
      () => json(200, ok(answer())),
      `/memory?q=teklif&contactId=${M3.contact}`,
    );
    await screen.findByTestId('memory.answer');
    await fireEvent.press(screen.getByTestId('memory.filter.note'));
    await waitFor(() => {
      expect(searchCalls(api.calls).at(-1)?.get('types')).toBe('memory');
    });
    await fireEvent.press(screen.getByTestId('memory.filter.recent30'));
    await fireEvent.press(screen.getByTestId('ui.tokenChip.remove'));
    await waitFor(() => {
      const last = searchCalls(api.calls).at(-1);
      expect(last?.get('contact_id')).toBeNull();
      expect(last?.get('from')).not.toBeNull();
    });
  });

  it('explains a date outside the retention window and opens the setting', async () => {
    const { router } = await openMemory(
      () =>
        json(200, ok({ mode: 'hybrid', results: [], sources: [], excluded_by_retention: true })),
      '/memory?q=2023%20teklif',
    );
    await screen.findByTestId('memory.retention');
    expect(
      screen.getByText('Bu tarih, veri saklama süren (90 gün) dışında kalıyor.'),
    ).toBeOnTheScreen();
    expect(events('memory_no_results').at(-1)?.props).toEqual({ reason: 'retention' });
    await fireEvent.press(screen.getByText('Saklama ayarı'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/privacy/retention');
    });
  });

  it('prefixes an unsure answer and says when there is no summary', async () => {
    let unsure = true;
    await openMemory(() => {
      const body = unsure
        ? answer({
            answer: {
              text: 'teklif 12 Eylül’de gitmiş olabilir.',
              emphasis_spans: [{ start: 0, end: 6 }],
              confidence_label: 'unsure',
              source_count: 1,
            },
          })
        : answer({ answer: undefined });
      unsure = false;
      return json(200, ok(body));
    }, '/memory?q=teklif');
    expect(await screen.findByTestId('memory.answer.text')).toHaveTextContent(
      'Emin değilim; teklif 12 Eylül’de gitmiş olabilir.',
    );
    expect(events('memory_answer_shown').at(-1)?.props).toMatchObject({
      confidence_label: 'uncertain',
    });
    await submit('başka soru');
    expect(await screen.findByTestId('memory.noSummary')).toBeOnTheScreen();
  });

  it.each([
    ['AI_UNAVAILABLE', 503, 'Asistan şu an yanıt veremiyor.'],
    ['QUOTA_EXCEEDED', 429, 'Bugünkü AI analiz hakkın doldu.'],
    ['VALIDATION_FAILED', 422, 'Bir sorun oluştu.'],
  ])('shows the %s error with retry', async (code, status, title) => {
    await openMemory(() => json(status, errorBody(code)), '/memory?q=teklif');
    expect(await screen.findByTestId('memory.error')).toHaveTextContent(new RegExp(title));
  });

  it('needs a connection', async () => {
    const { api } = await openMemory(() => json(200, ok(answer())));
    await screen.findByTestId('memory.idle');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByText('Hafıza araması için bağlantı gerekli.')).toBeOnTheScreen();
    await submit('teklif');
    expect(searchCalls(api.calls)).toHaveLength(0);
  });

  it('links Free users to the always-free Search', async () => {
    const { router } = await openApp({ path: '/memory' });
    await fireEvent.press(await screen.findByTestId('memory.searchFree'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/search');
    });
    expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({ feature: 'ai_memory' });
  });
});
