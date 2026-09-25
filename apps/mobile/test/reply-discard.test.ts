import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createApiClient } from '@da/api-client';
import { QueryClient } from '@tanstack/react-query';

import { DISCARD_UNDO_MS, scheduleDiscard } from '../src/features/reply/discard';

const DRAFT = '00000000-0000-4000-8000-000000000020';

function client(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'https://api.example.test/functions/v1/api',
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

describe('scheduleDiscard (R-06 undo window)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends nothing when "Geri al" is pressed inside the window', () => {
    const fetchFn = jest.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response('{}')),
    );
    const scheduled = scheduleDiscard({
      client: client(fetchFn),
      queryClient: new QueryClient(),
      draftId: DRAFT,
      expectedVersion: 1,
      idempotencyKey: 'k',
      onDone: jest.fn(),
      onFailed: jest.fn(),
    });
    jest.advanceTimersByTime(DISCARD_UNDO_MS - 1);
    expect(scheduled.cancel()).toBe(true);
    jest.advanceTimersByTime(DISCARD_UNDO_MS);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(scheduled.cancel()).toBe(false);
  });

  it('sends the PATCH once the window has passed', async () => {
    const fetchFn = jest.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response('{}')),
    );
    const scheduled = scheduleDiscard({
      client: client(fetchFn),
      queryClient: new QueryClient(),
      draftId: DRAFT,
      expectedVersion: 3,
      idempotencyKey: 'k',
      onDone: jest.fn(),
      onFailed: jest.fn(),
    });
    jest.advanceTimersByTime(DISCARD_UNDO_MS);
    expect(scheduled.cancel()).toBe(false);
    await jest.runAllTimersAsync();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/functions/v1/api/reply-drafts/${DRAFT}`,
    );
  });
});
