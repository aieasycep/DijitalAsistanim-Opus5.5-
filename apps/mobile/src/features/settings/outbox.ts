/**
 * Offline outbox for `POST /feedback` (API §2.16 classes it queueable): a submit made offline is
 * stored with its Idempotency-Key in encrypted MMKV and replayed in order when the connection
 * returns, so a replay can never create a duplicate. The screen shows the queued state, never a
 * success; after a successful replay the toast "Geri bildirimin gönderildi." appears.
 */
import type { ApiInput } from '@da/api-client';

import { translator } from '../../i18n/translate';
import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { isOffline } from '../../lib/query/online-manager';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';
import { showToast } from '../../providers/ToastHost';

export type FeedbackBody = NonNullable<ApiInput<'POST /feedback'>['body']>;

interface Entry {
  readonly body: FeedbackBody;
  readonly idempotencyKey: string;
}

const KEY = 'feedback.outbox';
let memory: Entry[] = [];

function read(): Entry[] {
  if (!isEncryptedStorageOpen()) return memory;
  const raw = encryptedStorage().prefs.getString(KEY);
  if (raw === undefined) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as Entry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: readonly Entry[]): void {
  memory = [...entries];
  if (!isEncryptedStorageOpen()) return;
  if (entries.length === 0) encryptedStorage().prefs.remove(KEY);
  else encryptedStorage().prefs.set(KEY, JSON.stringify(entries));
}

export function queueFeedback(body: FeedbackBody, idempotencyKey: string): void {
  write([...read(), { body, idempotencyKey }]);
}

export function queuedFeedbackCount(): number {
  return read().length;
}

let flushing = false;

/** Replays queued feedback in order; stops at the first failure. */
export async function flushFeedbackOutbox(): Promise<void> {
  if (flushing || isOffline()) return;
  flushing = true;
  try {
    let entries = read();
    while (entries.length > 0) {
      const [head, ...rest] = entries;
      if (head === undefined) break;
      try {
        await getApiClient().call(
          'POST /feedback',
          { body: head.body },
          { idempotencyKey: head.idempotencyKey },
        );
      } catch {
        return;
      }
      entries = rest;
      write(entries);
      track('feedback_submitted', {
        type: head.body.type,
        ...(head.body.rating === undefined ? {} : { rating: head.body.rating }),
        queued: true,
        diagnostics: head.body.include_diagnostics,
      });
      showToast({ message: translator()('settings.feedback.sentLater'), kind: 'success' });
    }
  } finally {
    flushing = false;
  }
}

export function resetFeedbackOutboxForTests(): void {
  memory = [];
  flushing = false;
}
