/**
 * "Taslağı sil" (SCREEN_AND_FLOW_MAP M-REPLY-01 `more_horiz`, M-REPLY-05): the screen closes at
 * once and shows "Taslak silindi · Geri al"; the `PATCH /reply-drafts/:id {status:'discarded'}`
 * leaves the device only after the 5 s undo window (R-06), so "Geri al" keeps the draft untouched
 * on the server. The timer lives outside the screen because the screen is gone by then.
 */
import type { ApiClient } from '@da/api-client';
import { discardReplyDraftMutationOptions } from '@da/api-client/react';
import { hold } from '@da/design-tokens';
import { MutationObserver, type QueryClient } from '@tanstack/react-query';

export const DISCARD_UNDO_MS = hold.undoToast;

export interface ScheduledDiscard {
  /** "Geri al": nothing is sent. Returns false when the request already left. */
  readonly cancel: () => boolean;
}

export function scheduleDiscard(input: {
  readonly client: ApiClient;
  readonly queryClient: QueryClient;
  readonly draftId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly onDone: () => void;
  readonly onFailed: (error: unknown) => void;
}): ScheduledDiscard {
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    const observer = new MutationObserver(
      input.queryClient,
      discardReplyDraftMutationOptions(input.client),
    );
    observer
      .mutate({
        draftId: input.draftId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      })
      .then(input.onDone, input.onFailed);
  }, DISCARD_UNDO_MS);
  return {
    cancel: () => {
      if (timer === null) return false;
      clearTimeout(timer);
      timer = null;
      return true;
    },
  };
}
