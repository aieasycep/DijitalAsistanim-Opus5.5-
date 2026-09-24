/**
 * T-8.17 Universal Capture (M-CAP-01…07) and the share intent (M-CAP-SHARE): the Free gate, the
 * text flow (`POST /captures` → analyze → the analyzing screen), extracted items proposed as one
 * batch (API-CAP-04 → the batch approval sheet), a shared URL + text staged as a `share` capture,
 * and the https-only link check (R-11).
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as ShareIntent from 'expo-share-intent';

import { resetDraftForTests } from '../src/features/capture/draft';
import { checkUrl } from '../src/features/capture/flows';
import { json, resetAppState } from './helpers/app';
import { M3, approvalView, captureRow, captureView } from './helpers/assist';
import { ok } from './helpers/fixtures';
import { events, openApp, proBootstrap } from './helpers/journeys';

const shareState = (
  ShareIntent as unknown as {
    __state: { hasShareIntent: boolean; shareIntent: Record<string, unknown> };
  }
).__state;

function analyzeResponse() {
  return {
    capture: captureView({ status: 'analyzing' }),
    job: { job_id: M3.job, status: 'queued', poll_after_ms: 1000 },
  };
}

const ITEM = {
  item_id: 'i1',
  type: 'deadline',
  title: 'Faturayı öde',
  fields: {},
  evidence: [],
  confidence: 0.92,
  proposed_action: 'reminder_create',
  selected: true,
  unresolved: [],
};

beforeEach(async () => {
  await resetAppState();
  resetDraftForTests();
  shareState.hasShareIntent = false;
  shareState.shareIntent = { text: null, webUrl: null, files: null, type: null };
});

describe('link check (R-11)', () => {
  it('accepts https only and never upgrades http', () => {
    expect(checkUrl('https://ornek.com/haber')).toBeNull();
    expect(checkUrl('http://ornek.com/haber')).toBe('scheme');
    expect(checkUrl('ornek')).toBe('invalid');
  });
});

describe('Capture composer (M-CAP-01)', () => {
  it('shows the Pro gate on Free and offers no analyze action', async () => {
    await openApp({ path: '/capture?entry=assistant' });
    expect(await screen.findByTestId('capture.gate')).toBeOnTheScreen();
    expect(screen.queryByTestId('capture.analyze')).toBeNull();
    expect(events('capture_start')[0]?.props).toEqual({ kind: 'text', entry: 'assistant' });
  });

  it('creates a text capture, starts the analysis and shows its progress', async () => {
    const { api, router } = await openApp({
      data: proBootstrap(),
      path: '/capture?entry=assistant',
      setup: (db) => {
        db.setTable('captures', [captureRow()]);
      },
      routes: {
        'POST /captures': () => json(201, ok(captureView())),
        [`POST /captures/${M3.capture}/analyze`]: () => json(202, ok(analyzeResponse())),
      },
    });
    await fireEvent.changeText(
      await screen.findByTestId('capture.text'),
      'Yarın 15:00 elektrik faturasını öde',
    );
    await fireEvent.press(screen.getByTestId('capture.analyze'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/capture/${M3.capture}`);
    });
    const create = api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/captures'));
    expect(create?.body).toMatchObject({
      share_origin: 'in_app',
      source: { kind: 'text', text: 'Yarın 15:00 elektrik faturasını öde' },
    });
    expect(api.calls.some((c) => c.url.endsWith(`/captures/${M3.capture}/analyze`))).toBe(true);
    expect(await screen.findByTestId('capture.analyzing')).toBeOnTheScreen();
    expect(events('capture_created')[0]?.props).toEqual({
      kind: 'text',
      via: 'in_app',
      file_count: 0,
    });
  });
});

describe('Capture results (M-CAP-05/06)', () => {
  it('proposes the selected items as one batch and opens the batch sheet', async () => {
    const { api } = await openApp({
      data: proBootstrap(),
      path: `/capture/${M3.capture}`,
      setup: (db) => {
        db.setTable('captures', [
          captureRow({
            status: 'extracted',
            primary_type: 'deadline',
            extracted: [ITEM],
            progress: { step: 'done' },
          }),
        ]);
        db.setTable('approval_actions', []);
      },
      routes: {
        [`POST /captures/${M3.capture}/actions`]: () =>
          json(
            200,
            ok({
              approvals: [approvalView({ origin: 'capture', batch_id: M3.capture })],
              batch_id: M3.capture,
              memory_saved: false,
            }),
          ),
      },
    });
    expect(await screen.findByTestId('capture.results')).toBeOnTheScreen();
    expect(screen.getByText('Faturayı öde')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('capture.send'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith(`/captures/${M3.capture}/actions`))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/actions'))?.body).toMatchObject({
      items: [{ item_id: 'i1', action_type: 'reminder_create' }],
    });
    expect(await screen.findByTestId('approvalSheet.approve')).toBeOnTheScreen();
    expect(events('capture_action_proposed')[0]?.props).toEqual({ entity_type: 'deadline' });
  });
});

describe('share intent (M-CAP-SHARE)', () => {
  it('stages a shared link and text into the composer and sends it as a share capture', async () => {
    shareState.hasShareIntent = true;
    shareState.shareIntent = {
      text: 'Bu habere bak',
      webUrl: 'https://ornek.com/haber',
      files: null,
      type: 'weburl',
    };
    const { api } = await openApp({
      data: proBootstrap(),
      landing: '/capture',
      setup: (db) => {
        db.setTable('captures', [captureRow({ kind: 'share' })]);
      },
      routes: {
        'POST /captures': () => json(201, ok(captureView({ kind: 'share' }))),
        [`POST /captures/${M3.capture}/analyze`]: () => json(202, ok(analyzeResponse())),
      },
    });
    expect(await screen.findByTestId('capture.analyze')).toBeOnTheScreen();
    expect(events('share_intake')[0]?.props).toMatchObject({ item_count: 2, kinds_mask: 3 });
    await fireEvent.press(screen.getByTestId('capture.analyze'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/captures'))).toBe(true);
    });
    expect(
      api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/captures'))?.body,
    ).toMatchObject({
      source: { kind: 'share', text: 'Bu habere bak', url: 'https://ornek.com/haber' },
    });
  });
});
