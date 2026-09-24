import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createApiClient, mk, qk } from '../src/index.ts';
import { aniSignalsUploadMutationOptions } from '../src/hooks/index.ts';
import { TS, errorBody, json, mockFetch, ok, uuid } from './fixtures.ts';

const PATH = 'https://api.example.com/functions/v1/api';
const HASH = 'a'.repeat(64);

function api(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: PATH,
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

const body = {
  installation_id: uuid(1),
  signals: [
    {
      signal_hash: HASH,
      package: 'trendyol.com',
      app_label: 'Trendyol',
      category: 'cargo' as const,
      tracking_status: 'delivered' as const,
      posted_at: TS,
    },
  ],
};

describe('android NI keys', () => {
  it('keeps device-local NI state under one root', () => {
    expect(qk.ani.signals()).toEqual(['ani', 'signals']);
    expect(qk.ani.status().slice(0, 1)).toEqual(qk.ani.all);
    expect(qk.ani.apps().slice(0, 1)).toEqual(qk.ani.all);
    expect(mk.ani.uploadSignals).toEqual(['ani', 'upload-signals']);
  });
});

describe('API-ANI-01 upload options', () => {
  it('posts the batch once with the caller idempotency key', async () => {
    const mock = mockFetch(() => json(202, ok({ accepted: 1, duplicates: 0, rejected: 0 })));
    const observer = new MutationObserver(
      new QueryClient(),
      aniSignalsUploadMutationOptions(api(mock.fn)),
    );
    const result = await observer.mutate({ body, idempotencyKey: uuid(7) });
    expect(result).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toBe(`${PATH}/android-notifications/signals`);
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(uuid(7));
    const sent = mock.calls[0]?.init.body;
    expect(typeof sent === 'string' ? JSON.parse(sent) : sent).toEqual(body);
  });

  it('never retries a 402 and rejects free-text fields before sending', async () => {
    const mock = mockFetch(() => json(402, errorBody('ENTITLEMENT_REQUIRED')));
    const observer = new MutationObserver(
      new QueryClient(),
      aniSignalsUploadMutationOptions(api(mock.fn)),
    );
    await expect(observer.mutate({ body })).rejects.toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
    });
    expect(mock.calls).toHaveLength(1);

    const withText = {
      ...body,
      signals: [{ ...body.signals[0], title: 'Kargonuz teslim edildi' }],
    } as unknown as typeof body;
    await expect(observer.mutate({ body: withText })).rejects.toBeTruthy();
    expect(mock.calls).toHaveLength(1);
  });
});
